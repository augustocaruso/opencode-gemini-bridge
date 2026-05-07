from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from rich.text import Text
from textual import events
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.selection import Selection
from textual.widgets import DataTable, Footer, Header, Static

from .engine import run_engine_json, selected_arg


def copy_to_clipboard(text: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
        return
    if os.name == "nt":
        subprocess.run(["clip"], input=text, text=True, check=True)
        return
    for command in (["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]):
        if shutil.which(command[0]):
            subprocess.run(command, input=text, text=True, check=True)
            return
    raise RuntimeError("No clipboard command found")


def candidate_file_path(item: dict[str, Any]) -> str:
    rel_path = str(item.get("relPath", "")).split("#", 1)[0].strip()
    if not rel_path:
        return ""
    prefix = ".config/opencode-gemini-bridge" if item.get("scope") == "bridge" else ".config/opencode"
    return f"{prefix}/{rel_path}"


def local_candidate_file(item: dict[str, Any]) -> Path | None:
    rel_path = candidate_file_path(item)
    if not rel_path or "#" in str(item.get("relPath", "")):
        return None
    return Path.home() / rel_path


class SelectableDataTable(DataTable):
    ALLOW_SELECT = True
    COPY_COLUMNS = ("Include", "Status", "Category", "ID", "Summary")

    @staticmethod
    def _plain_cell(cell: Any) -> str:
        if isinstance(cell, Text):
            return cell.plain
        return str(cell)

    @classmethod
    def _copy_line(cls, cells: tuple[Any, ...] | list[Any]) -> str:
        return "  ".join(cls._plain_cell(cell).replace("\n", " ").strip() for cell in cells)

    def get_selection(self, selection: Selection) -> tuple[str, str] | None:
        lines = [self._copy_line(self.COPY_COLUMNS)]
        for row_index in range(self.row_count):
            lines.append(self._copy_line(self.get_row_at(row_index)))
        selected_text = selection.extract("\n".join(lines))
        if not selected_text:
            return None
        return selected_text, "\n"


class UxProfileAuthorApp(App[None]):
    CSS = """
    Horizontal {
        height: 1fr;
    }

    #candidates {
        width: 58%;
        height: 1fr;
    }

    #side {
        width: 42%;
        height: 1fr;
    }

    #detail-scroll {
        height: 2fr;
        border: solid $accent;
        padding: 1;
    }

    #messages {
        height: 1fr;
        border: solid $warning;
        padding: 1;
    }
    """
    BINDINGS = [
        ("space", "toggle", "Toggle"),
        ("enter", "toggle", "Toggle"),
        ("a", "include_all", "Include all"),
        ("n", "skip_all", "Skip all"),
        ("c", "copy_files", "Copy files"),
        Binding("super+c", "copy_selection", "Copy selection", priority=True),
        Binding("ctrl+c", "quit", "Quit", show=False, priority=True),
        ("y", "copy_current", "Copy item"),
        ("[", "preview_up", "Preview up"),
        ("]", "preview_down", "Preview down"),
        ("w", "write", "Write"),
        ("r", "refresh", "Refresh"),
        ("q", "quit", "Quit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.inventory: dict[str, Any] = {}
        self.selected: set[str] = set()
        self.confirm_write = False
        self.highlighted_id: str | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Horizontal():
            table = SelectableDataTable(id="candidates")
            table.cursor_type = "row"
            yield table
            with Vertical(id="side"):
                with VerticalScroll(id="detail-scroll"):
                    yield Static("Loading inventory...", id="detail")
                yield Static("", id="messages")
        yield Footer()

    def copy_to_clipboard(self, text: str) -> None:
        self._clipboard = text
        try:
            copy_to_clipboard(text)
        except Exception:
            super().copy_to_clipboard(text)

    def copy_selected_text(self, *, warn_empty: bool) -> None:
        selected_text = self.screen.get_selected_text()
        if not selected_text:
            if warn_empty:
                self.show_messages("No selected text to copy.")
            return
        try:
            self.copy_to_clipboard(selected_text if selected_text.endswith("\n") else f"{selected_text}\n")
        except Exception as exc:
            self.show_messages(f"Could not copy selected text: {exc}")
            return
        self.show_messages("Copied selected text to the clipboard.")

    def on_mount(self) -> None:
        table = self.query_one("#candidates", DataTable)
        table.add_columns("Include", "Status", "Category", "ID", "Summary")
        self.load_inventory()

    def load_inventory(self) -> None:
        self.inventory = run_engine_json(["inventory", "--json"])
        self.selected = {
            item["id"]
            for item in self.inventory.get("candidates", [])
            if item.get("selectable", False) and item.get("selectedByDefault")
        }
        self.confirm_write = False
        self.highlighted_id = None
        self.populate_table()
        self.show_messages("Inventory loaded. Changed and new candidates start as skip; unchanged candidates start as include.")

    def selection_label(self, item: dict[str, Any]) -> Text:
        if not item.get("selectable", False):
            return Text("blocked", style="bold red")
        if item["id"] in self.selected:
            return Text("include", style="bold green")
        return Text("skip", style="dim")

    def status_label(self, item: dict[str, Any]) -> Text:
        status = str(item.get("status", ""))
        if status == "new":
            return Text(status, style="bold cyan")
        if status == "changed":
            return Text(status, style="bold yellow")
        if status == "unchanged":
            return Text(status, style="green")
        if status == "blocked":
            return Text(status, style="bold red")
        return Text(status)

    def selected_count(self) -> int:
        return len(self.selected)

    def populate_table(self) -> None:
        table = self.query_one("#candidates", DataTable)
        table.clear()
        candidates = self.inventory.get("candidates", [])
        for item in candidates:
            cid = item["id"]
            table.add_row(
                self.selection_label(item),
                self.status_label(item),
                item.get("category", ""),
                cid,
                item.get("summary", ""),
                key=cid,
            )
        if candidates:
            candidate_ids = [item["id"] for item in candidates]
            if self.highlighted_id not in candidate_ids:
                self.highlighted_id = candidates[0]["id"]
            table.move_cursor(row=candidate_ids.index(self.highlighted_id))
            self.update_detail()

    def current_candidate(self) -> dict[str, Any] | None:
        candidates = self.inventory.get("candidates", [])
        if self.highlighted_id:
            for item in candidates:
                if item.get("id") == self.highlighted_id:
                    return item
        table = self.query_one("#candidates", DataTable)
        if table.cursor_row < 0 or table.cursor_row >= len(candidates):
            return None
        return candidates[table.cursor_row]

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        row_key = getattr(event, "row_key", None)
        if row_key is not None:
            self.highlighted_id = str(row_key.value)
        self.update_detail()

    def on_text_selected(self, event: events.TextSelected) -> None:
        # Auto-copy felt surprising in terminal workflows. Keep the handler here so
        # it is easy to re-enable after we settle on the UX.
        # self.copy_selected_text(warn_empty=False)
        pass

    def update_detail(self) -> None:
        item = self.current_candidate()
        detail = self.query_one("#detail", Static)
        if not item:
            detail.update("No candidate selected.")
            return
        warnings = item.get("warnings") or []
        body = [
            item.get("id", ""),
            f"Status: {item.get('status', '')}",
            f"Target: {item.get('target', '')}",
            "",
            item.get("summary", ""),
        ]
        if warnings:
            body.extend(["", "Warnings:", *[f"- {warning}" for warning in warnings]])
        if item.get("preview"):
            body.extend(["", "Preview:", str(item["preview"])])
        detail.update("\n".join(body))
        try:
            self.query_one("#detail-scroll", VerticalScroll).scroll_home(animate=False)
        except Exception:
            pass

    def show_messages(self, message: str) -> None:
        warnings = self.inventory.get("warnings") or []
        excluded = self.inventory.get("excluded") or []
        lines = [message]
        if warnings:
            lines.extend(["", "Warnings:", *[f"- {item}" for item in warnings[:6]]])
        if excluded:
            lines.extend(["", f"Excluded: {len(excluded)} item(s)"])
        self.query_one("#messages", Static).update("\n".join(lines))

    def action_toggle(self) -> None:
        item = self.current_candidate()
        if not item:
            return
        cid = item["id"]
        if not item.get("selectable", False):
            self.show_messages(f"{cid} is not selectable.")
            return
        if cid in self.selected:
            self.selected.remove(cid)
        else:
            self.selected.add(cid)
        self.confirm_write = False
        self.highlighted_id = cid
        self.populate_table()
        self.show_messages(f"{self.selected_count()} candidate(s) marked include.")

    def action_include_all(self) -> None:
        self.selected = {
            item["id"]
            for item in self.inventory.get("candidates", [])
            if item.get("selectable", False)
        }
        self.confirm_write = False
        self.populate_table()
        self.show_messages(f"{self.selected_count()} candidate(s) marked include.")

    def action_skip_all(self) -> None:
        self.selected = set()
        self.confirm_write = False
        self.populate_table()
        self.show_messages("All candidates marked skip.")

    def action_copy_files(self) -> None:
        candidates = self.inventory.get("candidates", [])
        paths = []
        seen = set()
        for item in candidates:
            file_path = candidate_file_path(item)
            if not file_path or file_path in seen:
                continue
            seen.add(file_path)
            paths.append(file_path)
        if not paths:
            self.show_messages("No files to copy.")
            return
        try:
            copy_to_clipboard("\n".join(paths) + "\n")
        except Exception as exc:
            self.show_messages(f"Could not copy files: {exc}")
            return
        self.show_messages(f"Copied {len(paths)} file path(s) to the clipboard.")

    def action_copy_selection(self) -> None:
        self.copy_selected_text(warn_empty=True)

    def action_copy_current(self) -> None:
        item = self.current_candidate()
        if not item:
            self.show_messages("No item to copy.")
            return
        text = ""
        file_path = local_candidate_file(item)
        if file_path and file_path.exists() and file_path.is_file():
            try:
                text = file_path.read_text(encoding="utf-8")
            except Exception:
                text = ""
        if not text:
            text = str(item.get("preview") or "")
        if not text:
            self.show_messages(f"{item.get('id', 'item')} has no copyable content.")
            return
        try:
            copy_to_clipboard(text if text.endswith("\n") else f"{text}\n")
        except Exception as exc:
            self.show_messages(f"Could not copy item: {exc}")
            return
        self.show_messages(f"Copied {item.get('id', 'item')} content to the clipboard.")

    def action_preview_up(self) -> None:
        self.query_one("#detail-scroll", VerticalScroll).scroll_page_up(animate=False)

    def action_preview_down(self) -> None:
        self.query_one("#detail-scroll", VerticalScroll).scroll_page_down(animate=False)

    def action_refresh(self) -> None:
        self.load_inventory()

    def action_write(self) -> None:
        if not self.selected:
            self.show_messages("No candidates selected.")
            return
        if not self.confirm_write:
            self.confirm_write = True
            self.show_messages("Press w again to write the generated preset and review artifacts.")
            return
        result = run_engine_json(["write-preset", *selected_arg(sorted(self.selected)), "--write", "--json"])
        self.confirm_write = False
        self.show_messages(
            f"{result.get('status', 'unknown')}: {result.get('outputRelPath', '')}\n"
            f"Artifacts: {result.get('artifactsRelPath', '')}"
        )
