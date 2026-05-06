import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configReferencesExpandedGemini } from "./project-config.js";
import { readSyncState } from "./sync-state.js";
import { setupOpenCode, STARTUP_SYNC_CONFIG_PATH, STARTUP_SYNC_PLUGIN_PATH } from "./setup-opencode.js";
import { TUI_CONFIG_PATH, TUI_SIDEBAR_PLUGIN_PATH } from "./tui-sidebar.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-setup-"));
}

function projectPath(projectRoot: string, relPath: string): string {
  return path.join(projectRoot, ...relPath.split("/"));
}

test("setupOpenCode installs startup plugin, config, and project OpenCode config", () => {
  const projectRoot = tempProject();
  const report = setupOpenCode({
    projectRoot,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(report.plugin.status, "created");
  assert.equal(report.startupConfig.status, "created");
  assert.equal(report.sidebarPlugin.status, "created");
  assert.equal(report.tuiConfig.status, "created");
  assert.equal(report.pluginCheck.ok, true);
  assert.equal(report.sidebarPluginCheck.ok, true);
  assert.equal(configReferencesExpandedGemini(projectRoot), true);

  assert.equal(fs.existsSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH)), true);
  assert.equal(fs.existsSync(projectPath(projectRoot, STARTUP_SYNC_CONFIG_PATH)), true);
  assert.equal(fs.existsSync(projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH)), true);
  assert.equal(fs.existsSync(projectPath(projectRoot, TUI_CONFIG_PATH)), true);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /ogb-plugin-status\.json/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /auto-update/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /REINICIE OPENCODE/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /ogb dashboard refreshed/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /telemetry record/);
  assert.match(fs.readFileSync(projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH), "utf8"), /sidebar_content/);

  const startupConfig = JSON.parse(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_CONFIG_PATH), "utf8"));
  assert.equal(startupConfig.command, "ogb");
  assert.equal(startupConfig.autoUpdate, true);
  assert.deepEqual(startupConfig.syncArgs, ["sync"]);
  assert.deepEqual(startupConfig.updateArgs, ["auto-update"]);

  const state = readSyncState(projectRoot);
  assert.ok(state?.managedFiles.some((file) => file.path === STARTUP_SYNC_PLUGIN_PATH && file.source === "ogb"));
  assert.ok(state?.managedFiles.some((file) => file.path === STARTUP_SYNC_CONFIG_PATH && file.source === "ogb"));
  assert.ok(state?.managedFiles.some((file) => file.path === TUI_SIDEBAR_PLUGIN_PATH && file.source === "ogb"));
  assert.ok(state?.managedFiles.some((file) => file.path === TUI_CONFIG_PATH && file.source === "ogb"));
});

test("setupOpenCode refuses to overwrite a manually changed startup plugin without force", () => {
  const projectRoot = tempProject();
  setupOpenCode({
    projectRoot,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  const pluginPath = projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH);
  fs.writeFileSync(pluginPath, "export const ManualPlugin = async () => ({})\n", "utf8");

  const conflict = setupOpenCode({
    projectRoot,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(conflict.plugin.status, "conflict");
  assert.match(fs.readFileSync(pluginPath, "utf8"), /ManualPlugin/);

  const forced = setupOpenCode({
    projectRoot,
    force: true,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(forced.plugin.status, "updated");
  assert.match(fs.readFileSync(pluginPath, "utf8"), /OgbStartupSync/);
});

test("setupOpenCode dry-run previews without writing project files", () => {
  const projectRoot = tempProject();
  const report = setupOpenCode({
    projectRoot,
    dryRun: true,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(report.plugin.status, "preview");
  assert.equal(report.startupConfig.status, "preview");
  assert.equal(report.sidebarPlugin.status, "preview");
  assert.equal(report.tuiConfig.status, "preview");
  assert.equal(report.pluginCheck.ok, true);
  assert.equal(report.sidebarPluginCheck.ok, true);
  assert.equal(fs.existsSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH)), false);
  assert.equal(fs.existsSync(projectPath(projectRoot, STARTUP_SYNC_CONFIG_PATH)), false);
  assert.equal(fs.existsSync(projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH)), false);
  assert.equal(fs.existsSync(projectPath(projectRoot, TUI_CONFIG_PATH)), false);
});

test("setupOpenCode preserves existing managed MCP config", () => {
  const projectRoot = tempProject();
  setupOpenCode({
    projectRoot,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    instructions: [".opencode/generated/GEMINI.expanded.md"],
    mcp: {
      anki: {
        type: "local",
        command: ["npx", "anki"],
        enabled: true,
      },
    },
  }, null, 2) + "\n");

  setupOpenCode({
    projectRoot,
    force: true,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  assert.deepEqual(config.mcp.anki.command, ["npx", "anki"]);
});

test("setupOpenCode clears stale startup sync status", () => {
  const projectRoot = tempProject();
  const statusPath = path.join(projectRoot, ".opencode", "generated", "ogb-plugin-status.json");
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify({
    version: 1,
    state: "running",
    reason: "plugin.init",
    startedAt: "2026-05-04T12:00:00.000Z",
    command: "ogb",
    args: ["sync"],
  }, null, 2) + "\n");

  setupOpenCode({
    projectRoot,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(status.state, "pass");
  assert.equal(status.reason, "setup-opencode.recovered-stale");
});
