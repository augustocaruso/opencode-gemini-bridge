from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import Mock, patch

from textual import events
from textual.geometry import Offset
from textual.selection import Selection

from ogb_ux_profile_author.app import UxProfileAuthorApp
from ogb_ux_profile_author.__main__ import engine_args
from ogb_ux_profile_author.engine import engine_command, run_engine_json, selected_arg


def cell_text(value) -> str:
    return getattr(value, "plain", str(value))


def test_engine_command_uses_checkout_engine() -> None:
    root = Path("/tmp/opencode-gemini-bridge/packages/ogb")
    with patch("ogb_ux_profile_author.engine.shutil.which", return_value="/usr/bin/node"):
        assert engine_command(["inventory"], root)[-2:] == [
            str(root / "authoring" / "ux-profile-engine.ts"),
            "inventory",
        ]


def test_run_engine_json_parses_inventory() -> None:
    completed = Mock(returncode=0, stdout=json.dumps({"schema": "ok"}), stderr="")
    with patch("ogb_ux_profile_author.engine.run_engine", return_value=completed):
        assert run_engine_json(["inventory", "--json"]) == {"schema": "ok"}


def test_selected_arg_is_comma_joined() -> None:
    assert selected_arg(["agent:YOLO", "command:research"]) == ["--select", "agent:YOLO,command:research"]


def test_noninteractive_args_route_to_engine() -> None:
    assert engine_args(["--json"]) == ["inventory", "--json"]
    assert engine_args(["--dry-run", "--select", "command:research"]) == [
        "write-preset",
        "--dry-run",
        "--select",
        "command:research",
    ]


def fake_inventory() -> dict:
    return {
        "schema": "opencode-gemini-bridge.ux-profile-authoring.inventory.v1",
        "warnings": [],
        "excluded": [],
        "candidates": [
            {
                "id": "command:research",
                "status": "changed",
                "category": "commands",
                "summary": "Research command",
                "scope": "opencode",
                "relPath": "commands/research.md",
                "target": "files.commands.research",
                "selectable": True,
                "selectedByDefault": False,
                "warnings": [],
                "preview": "research preview",
            },
            {
                "id": "agent:YOLO",
                "status": "changed",
                "category": "agents",
                "summary": "YOLO agent",
                "scope": "opencode",
                "relPath": "agents/YOLO.md",
                "target": "files.agents.YOLO",
                "selectable": True,
                "selectedByDefault": False,
                "warnings": [],
                "preview": "yolo preview",
            },
        ],
    }


def test_tui_styles_selection_and_status_labels(monkeypatch) -> None:
    inventory = fake_inventory()
    inventory["candidates"][1]["status"] = "new"

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: inventory)
        async with UxProfileAuthorApp().run_test() as pilot:
            table = pilot.app.query_one("#candidates")
            changed_status = table.get_row_at(0)[1]
            new_status = table.get_row_at(1)[1]
            assert cell_text(changed_status) == "changed"
            assert "yellow" in changed_status.style
            assert cell_text(new_status) == "new"
            assert "cyan" in new_status.style

    asyncio.run(drive_app())


def test_tui_confirmed_write_calls_engine(monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_engine(args: list[str]) -> dict:
        calls.append(args)
        if args[:2] == ["inventory", "--json"]:
            return fake_inventory()
        return {"status": "written", "outputRelPath": "packages/ogb/src/ux-profile.generated.ts", "artifactsRelPath": "artifacts/ux-profile-snapshot"}

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", fake_engine)
        async with UxProfileAuthorApp().run_test() as pilot:
            await pilot.press("space")
            await pilot.press("w")
            await pilot.press("w")

    asyncio.run(drive_app())
    assert ["write-preset", "--select", "command:research", "--write", "--json"] in calls


def test_tui_can_exclude_unchanged_candidate_before_write(monkeypatch) -> None:
    inventory = {
        "schema": "opencode-gemini-bridge.ux-profile-authoring.inventory.v1",
        "warnings": [],
        "excluded": [],
        "candidates": [
            {
                "id": "tui:mouse",
                "status": "unchanged",
                "category": "tui.json",
                "summary": "Mouse preference",
                "scope": "opencode",
                "relPath": "tui.json#mouse",
                "target": "tui:mouse",
                "selectable": True,
                "selectedByDefault": True,
                "warnings": [],
                "preview": "true",
            },
            {
                "id": "tui:scroll_speed",
                "status": "unchanged",
                "category": "tui.json",
                "summary": "Scroll speed preference",
                "scope": "opencode",
                "relPath": "tui.json#scroll_speed",
                "target": "tui:scroll_speed",
                "selectable": True,
                "selectedByDefault": True,
                "warnings": [],
                "preview": "1",
            },
        ],
    }
    calls: list[list[str]] = []

    def fake_engine(args: list[str]) -> dict:
        calls.append(args)
        if args[:2] == ["inventory", "--json"]:
            return inventory
        return {"status": "written", "outputRelPath": "packages/ogb/src/ux-profile.generated.ts", "artifactsRelPath": "artifacts/ux-profile-snapshot"}

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", fake_engine)
        async with UxProfileAuthorApp().run_test() as pilot:
            assert pilot.app.selected == {"tui:mouse", "tui:scroll_speed"}
            await pilot.press("down")
            assert pilot.app.current_candidate()["id"] == "tui:scroll_speed"
            await pilot.press("space")
            assert pilot.app.selected == {"tui:mouse"}
            await pilot.press("w")
            await pilot.press("w")

    asyncio.run(drive_app())
    assert ["write-preset", "--select", "tui:mouse", "--write", "--json"] in calls


def test_tui_uses_row_cursor_and_preview_tracks_highlight(monkeypatch) -> None:
    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        async with UxProfileAuthorApp().run_test() as pilot:
            table = pilot.app.query_one("#candidates")
            assert table.cursor_type == "row"
            assert table.ALLOW_SELECT is True
            assert cell_text(table.get_row_at(0)[0]) == "skip"
            assert pilot.app.query_one("#detail-scroll") is not None
            assert pilot.app.current_candidate()["id"] == "command:research"
            await pilot.press("down")
            assert pilot.app.current_candidate()["id"] == "agent:YOLO"
            await pilot.press("]")
            await pilot.press("[")

    asyncio.run(drive_app())


def test_tui_table_selection_exposes_row_text(monkeypatch) -> None:
    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        async with UxProfileAuthorApp().run_test() as pilot:
            table = pilot.app.query_one("#candidates")
            selection = Selection.from_offsets(Offset(0, 1), Offset(200, 1))
            selected_text = table.get_selection(selection)
            assert selected_text is not None
            assert "command:research" in selected_text[0]
            assert "Research command" in selected_text[0]

    asyncio.run(drive_app())


def test_tui_copies_selected_file_paths(monkeypatch) -> None:
    copied: list[str] = []

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        monkeypatch.setattr("ogb_ux_profile_author.app.copy_to_clipboard", copied.append)
        async with UxProfileAuthorApp().run_test() as pilot:
            await pilot.press("c")

    asyncio.run(drive_app())
    assert copied == [".config/opencode/commands/research.md\n.config/opencode/agents/YOLO.md\n"]


def test_tui_toggle_preserves_current_row(monkeypatch) -> None:
    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        async with UxProfileAuthorApp().run_test() as pilot:
            await pilot.press("down")
            assert pilot.app.current_candidate()["id"] == "agent:YOLO"
            await pilot.press("space")
            assert pilot.app.current_candidate()["id"] == "agent:YOLO"
            table = pilot.app.query_one("#candidates")
            assert cell_text(table.get_row_at(1)[0]) == "include"

    asyncio.run(drive_app())


def test_tui_marks_unchanged_candidates_include_by_default(monkeypatch) -> None:
    inventory = fake_inventory()
    inventory["candidates"][0]["status"] = "unchanged"
    inventory["candidates"][0]["selectedByDefault"] = True

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: inventory)
        async with UxProfileAuthorApp().run_test() as pilot:
            table = pilot.app.query_one("#candidates")
            first_cell = table.get_row_at(0)[0]
            assert cell_text(first_cell) == "include"
            assert "green" in first_cell.style
            assert pilot.app.selected == {"command:research"}

    asyncio.run(drive_app())


def test_tui_include_all_and_skip_all(monkeypatch) -> None:
    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        async with UxProfileAuthorApp().run_test() as pilot:
            await pilot.press("a")
            assert pilot.app.selected == {"command:research", "agent:YOLO"}
            await pilot.press("n")
            assert pilot.app.selected == set()

    asyncio.run(drive_app())


def test_tui_copies_current_item_content(monkeypatch) -> None:
    copied: list[str] = []

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        monkeypatch.setattr("ogb_ux_profile_author.app.copy_to_clipboard", copied.append)
        monkeypatch.setattr("ogb_ux_profile_author.app.local_candidate_file", lambda _: None)
        async with UxProfileAuthorApp().run_test() as pilot:
            await pilot.press("down")
            await pilot.press("y")

    asyncio.run(drive_app())
    assert copied == ["yolo preview\n"]


def test_tui_copies_selected_text(monkeypatch) -> None:
    copied: list[str] = []

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        monkeypatch.setattr("ogb_ux_profile_author.app.copy_to_clipboard", copied.append)
        async with UxProfileAuthorApp().run_test() as pilot:
            monkeypatch.setattr(pilot.app.screen, "get_selected_text", lambda: "selected preview text")
            await pilot.press("super+c")

    asyncio.run(drive_app())
    assert copied == ["selected preview text\n"]


def test_tui_does_not_auto_copy_textual_selection(monkeypatch) -> None:
    copied: list[str] = []

    async def drive_app() -> None:
        monkeypatch.setattr("ogb_ux_profile_author.app.run_engine_json", lambda _: fake_inventory())
        monkeypatch.setattr("ogb_ux_profile_author.app.copy_to_clipboard", copied.append)
        async with UxProfileAuthorApp().run_test() as pilot:
            monkeypatch.setattr(pilot.app.screen, "get_selected_text", lambda: "selected by drag")
            pilot.app.on_text_selected(events.TextSelected())

    asyncio.run(drive_app())
    assert copied == []
