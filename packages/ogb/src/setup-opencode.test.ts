import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { configReferencesExpandedGemini } from "./project-config.js";
import { readSyncState } from "./sync-state.js";
import { setupOpenCode, STARTUP_SYNC_CONFIG_PATH, STARTUP_SYNC_PLUGIN_PATH, STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";
import { TUI_CONFIG_PATH, TUI_SIDEBAR_PLUGIN_PATH } from "./tui-sidebar.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-setup-"));
}

function projectPath(projectRoot: string, relPath: string): string {
  return path.join(projectRoot, ...relPath.split("/"));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(predicate(), true);
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

test("setupOpenCode skips project files when project root is home", () => {
  const homeDir = tempProject();
  const report = setupOpenCode({
    projectRoot: homeDir,
    homeDir,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(report.plugin.status, "unchanged");
  assert.equal(report.commandCheck.skipped, true);
  assert.equal(report.warnings.length, 0);
  assert.equal(fs.existsSync(path.join(homeDir, "opencode.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "plugins", "ogb-startup-sync.js")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated", "ogb-startup-sync.json")), false);
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

test("startup plugin uses global generated lock and status when cwd is home", async () => {
  const root = tempProject();
  const homeDir = path.join(root, "home");
  const generatedDir = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const runnerPath = path.join(root, "runner.mjs");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(runnerPath, "console.log('ok')\n", "utf8");
  fs.writeFileSync(path.join(generatedDir, "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: false,
    command: process.execPath,
    baseArgs: [runnerPath],
    syncArgs: ["sync"],
    updateArgs: ["auto-update"],
    lockTtlMs: 10 * 60_000,
  }, null, 2) + "\n");

  const previousHome = process.env.HOME;
  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  process.env.HOME = homeDir;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    assert.equal(typeof mod.OgbStartupSync, "function");
    assert.equal(typeof mod.default, "function");

    const logs: unknown[] = [];
    const plugin = await mod.default({
      directory: homeDir,
      worktree: homeDir,
      client: {
        app: { log: async (entry: unknown) => logs.push(entry) },
        tui: { showToast: async () => undefined },
      },
    });
    assert.equal(typeof plugin.event, "function");
    await plugin.event({ event: { type: "session.updated" } });

    const statusPath = path.join(generatedDir, "ogb-plugin-status.json");
    const globalLockPath = path.join(generatedDir, "ogb-startup-sync.lock");
    const oldHomeLockPath = path.join(homeDir, ".opencode", "generated", "ogb-startup-sync.lock");
    await waitFor(() => {
      if (!fs.existsSync(statusPath)) return false;
      const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      return status.state === "pass" && !fs.existsSync(globalLockPath);
    });

    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.equal(status.cwd, homeDir);
    assert.equal(status.lockPath, globalLockPath);
    assert.equal(fs.existsSync(globalLockPath), false);
    assert.equal(fs.existsSync(oldHomeLockPath), false);
    assert.equal(logs.some((entry) => JSON.stringify(entry).includes("Running ogb startup sync")), true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
  }
});
