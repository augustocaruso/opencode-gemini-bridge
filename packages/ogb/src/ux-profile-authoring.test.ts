import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUxProfileInventory, writeUxProfilePreset } from "../authoring/ux-profile-engine.js";
import { STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";
import { TUI_SIDEBAR_PLUGIN_SOURCE } from "./tui-sidebar.js";
import { UX_PROFILE_PRESET } from "./ux-profile.generated.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-author-"));
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

test("authoring engine inventories allowed UX profile candidates and excludes unsafe local files", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  const bridgeDir = path.join(homeDir, ".config", "opencode-gemini-bridge");
  writeText(path.join(opencodeDir, "opencode.json"), JSON.stringify({
    plugin: ["opencode-gemini-auth@9.9.9", "file:///tmp/local.js"],
    default_agent: "YOLO",
    provider: { openai: {} },
  }, null, 2));
  writeText(path.join(opencodeDir, "AGENTS.md"), "Global agents\n");
  writeText(path.join(opencodeDir, "commands", "research.md"), "Research command\n");
  writeText(path.join(opencodeDir, "agents", "YOLO.md"), "YOLO agent\n");
  writeText(path.join(opencodeDir, "skills", "my-skill", "SKILL.md"), "# My skill\n");
  writeText(path.join(opencodeDir, "dcp.jsonc"), "{ \"enabled\": true }\n");
  writeText(path.join(opencodeDir, "tui.json"), JSON.stringify({ plugin: ["./tui-plugins/ogb-sidebar.js"], custom: true }, null, 2));
  writeText(path.join(opencodeDir, "plugins", "fallback.json"), JSON.stringify({ enabled: false }, null, 2));
  writeText(path.join(opencodeDir, "plugins", "ogb-startup-sync.js"), "console.log('startup');\n");
  writeText(path.join(opencodeDir, "tui-plugins", "ogb-sidebar.js"), "console.log('sidebar');\n");
  writeText(path.join(bridgeDir, "ogb.config.jsonc"), "{ \"openCode\": { \"defaultAgent\": \"YOLO\" } }\n");
  writeText(path.join(bridgeDir, "local-role.json"), "{}\n");
  writeText(path.join(bridgeDir, "generated", "telemetry.json"), "{}\n");

  const inventory = createUxProfileInventory({ homeDir });
  const ids = new Set(inventory.candidates.map((candidate) => candidate.id));
  assert.equal(ids.has("file:AGENTS.md"), true);
  assert.equal(ids.has("command:research"), true);
  assert.equal(ids.has("agent:YOLO"), true);
  assert.equal(ids.has("skill:my-skill:SKILL.md"), true);
  assert.equal(ids.has("file:dcp.jsonc"), true);
  assert.equal(ids.has("file:plugins/fallback.json"), true);
  assert.equal(ids.has("file:plugins/ogb-startup-sync.js"), false);
  assert.equal(ids.has("file:tui-plugins/ogb-sidebar.js"), false);
  assert.equal(ids.has("file:ogb.config.jsonc"), true);

  const plugin = inventory.candidates.find((candidate) => candidate.id === "opencode:plugin");
  assert.deepEqual(plugin?.value, ["opencode-gemini-auth@9.9.9"]);
  assert.equal(plugin?.warnings.some((warning) => warning.includes("local plugin spec excluded")), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "local-role.json" && item.reason === "local_maintainer_flag"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "generated" && item.reason === "generated_artifact"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "plugins/ogb-startup-sync.js" && item.reason === "provided_by_ogb_runtime"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "tui-plugins/ogb-sidebar.js" && item.reason === "provided_by_ogb_runtime"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "opencode.json#provider"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "tui.json#custom"), true);
});

test("authoring engine excludes global OpenCode files managed by OGB sync", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  const statePath = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-sync-state.json");
  writeText(path.join(opencodeDir, "agents", "generated-agent.md"), "generated agent\n");
  writeText(path.join(opencodeDir, "commands", "generated-command.md"), "<!-- SOURCE_KIND: gemini-global-command -->\n");
  writeText(path.join(opencodeDir, "skills", "generated-skill", "SKILL.md"), "# generated\n");
  writeText(statePath, JSON.stringify({
    version: "0.1.0",
    managedFiles: [
      { path: ".config/opencode/agents/generated-agent.md", sha256: "abc", source: "ogb" },
      { path: ".config/opencode/skills/generated-skill/SKILL.md", sha256: "def", source: "ogb" },
    ],
  }, null, 2));

  const inventory = createUxProfileInventory({ homeDir });
  const ids = new Set(inventory.candidates.map((candidate) => candidate.id));
  assert.equal(ids.has("agent:generated-agent"), false);
  assert.equal(ids.has("command:generated-command"), false);
  assert.equal(ids.has("skill:generated-skill:SKILL.md"), false);
  assert.equal(inventory.excluded.some((item) => item.relPath === "agents/generated-agent.md" && item.reason === "managed_by_ogb_sync"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "commands/generated-command.md" && item.reason === "projected_from_gemini"), true);
  assert.equal(inventory.excluded.some((item) => item.relPath === "skills/generated-skill/SKILL.md" && item.reason === "managed_by_ogb_sync"), true);
});

test("authoring engine always excludes OGB runtime plugins from authoring snapshots", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  writeText(path.join(opencodeDir, "plugins", "ogb-startup-sync.js"), STARTUP_SYNC_PLUGIN_SOURCE);
  writeText(path.join(opencodeDir, "tui-plugins", "ogb-sidebar.js"), TUI_SIDEBAR_PLUGIN_SOURCE);

  const defaultInventory = createUxProfileInventory({ homeDir });
  assert.equal(defaultInventory.candidates.some((candidate) => candidate.id === "file:plugins/ogb-startup-sync.js"), false);
  assert.equal(defaultInventory.candidates.some((candidate) => candidate.id === "file:tui-plugins/ogb-sidebar.js"), false);
  assert.equal(defaultInventory.excluded.some((item) => item.relPath === "plugins/ogb-startup-sync.js" && item.reason === "provided_by_ogb_runtime"), true);
  assert.equal(defaultInventory.excluded.some((item) => item.relPath === "tui-plugins/ogb-sidebar.js" && item.reason === "provided_by_ogb_runtime"), true);

  fs.appendFileSync(path.join(opencodeDir, "plugins", "ogb-startup-sync.js"), "\n// maintainer customization\n", "utf8");
  const customInventory = createUxProfileInventory({ homeDir });
  assert.equal(customInventory.candidates.some((candidate) => candidate.id === "file:plugins/ogb-startup-sync.js"), false);
  assert.equal(customInventory.excluded.some((item) => item.relPath === "plugins/ogb-startup-sync.js" && item.reason === "provided_by_ogb_runtime" && item.detail?.includes("differs")), true);
});

test("authoring engine previews without writing and writes preset plus review artifacts only with write flag", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  const outputPath = path.join(root, "ux-profile.generated.ts");
  const artifactsDir = path.join(root, "artifacts");
  writeText(path.join(opencodeDir, "commands", "research.md"), "Snapshot research command\n");

  const preview = writeUxProfilePreset({
    homeDir,
    selectedIds: ["command:research"],
    outputPath,
    artifactsDir,
  });
  assert.equal(preview.status, "preview");
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(fs.existsSync(artifactsDir), false);

  const written = writeUxProfilePreset({
    homeDir,
    selectedIds: ["command:research"],
    outputPath,
    artifactsDir,
    write: true,
  });
  assert.equal(written.status, "written");
  assert.match(fs.readFileSync(outputPath, "utf8"), /Snapshot research command/);
  assert.equal(fs.readFileSync(outputPath, "utf8").includes(homeDir), false);
  assert.equal(fs.existsSync(path.join(artifactsDir, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(artifactsDir, "diff.md")), true);
  assert.equal(fs.readFileSync(path.join(artifactsDir, "manifest.json"), "utf8").includes(homeDir), false);
});

test("authoring engine marks only unchanged candidates as selected by default", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  writeText(path.join(opencodeDir, "AGENTS.md"), UX_PROFILE_PRESET.files.globalAgentsMd);
  writeText(path.join(opencodeDir, "commands", "research.md"), "Changed local research command\n");

  const inventory = createUxProfileInventory({ homeDir });
  const agents = inventory.candidates.find((candidate) => candidate.id === "file:AGENTS.md");
  const command = inventory.candidates.find((candidate) => candidate.id === "command:research");
  assert.equal(agents?.status, "unchanged");
  assert.equal(agents?.selectedByDefault, true);
  assert.notEqual(command?.status, "unchanged");
  assert.equal(command?.selectedByDefault, false);
});

test("authoring engine does not select candidates implicitly for writes", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  const outputPath = path.join(root, "ux-profile.generated.ts");
  writeText(path.join(opencodeDir, "commands", "research.md"), "Snapshot research command\n");

  const preview = writeUxProfilePreset({
    homeDir,
    outputPath,
  });
  assert.deepEqual(preview.selectedIds, []);
});

test("authoring engine removes unselected optional TUI fields from generated preset", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodeDir = path.join(homeDir, ".config", "opencode");
  const outputPath = path.join(root, "ux-profile.generated.ts");
  writeText(path.join(opencodeDir, "tui.json"), JSON.stringify({
    "$schema": "https://opencode.ai/tui.json",
    mouse: true,
    scroll_speed: 1,
  }, null, 2));

  const result = writeUxProfilePreset({
    homeDir,
    selectedIds: ["tui:mouse"],
    outputPath,
    write: true,
  });
  assert.equal(result.status, "written");
  const generated = fs.readFileSync(outputPath, "utf8");
  assert.match(generated, /"mouse": true/);
  assert.equal(generated.includes("scroll_speed"), false);
});

test("authoring engine blocks writes when a high-confidence secret is present", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const outputPath = path.join(root, "ux-profile.generated.ts");
  const secret = `sk-${"a".repeat(40)}`;
  writeText(path.join(homeDir, ".config", "opencode", "commands", "leak.md"), `token ${secret}\n`);

  const inventory = createUxProfileInventory({ homeDir });
  assert.equal(inventory.blocked, true);
  assert.equal(inventory.candidates.find((candidate) => candidate.id === "command:leak")?.status, "blocked");

  const result = writeUxProfilePreset({
    homeDir,
    selectedIds: ["command:leak"],
    outputPath,
    write: true,
  });
  assert.equal(result.status, "blocked");
  assert.equal(fs.existsSync(outputPath), false);
});

test("authoring engine resolves Windows profile paths through PlatformAdapter", () => {
  const inventory = createUxProfileInventory({
    homeDir: "C:\\Users\\Ada",
    platform: "win32",
    env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" },
  });
  assert.equal(inventory.globalConfigRelPath, "~/.config/opencode");
  assert.equal(inventory.bridgeConfigRelPath, "~/.config/opencode-gemini-bridge");
});
