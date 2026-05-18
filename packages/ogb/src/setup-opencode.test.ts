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

function overrideProcessHome(homeDir: string): () => void {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  return () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  };
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
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /startup-sync/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /REINICIE OPENCODE/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /ogb dashboard refreshed/);
  assert.match(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH), "utf8"), /telemetry record/);
  assert.match(fs.readFileSync(projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH), "utf8"), /sidebar_content/);

  const startupConfig = JSON.parse(fs.readFileSync(projectPath(projectRoot, STARTUP_SYNC_CONFIG_PATH), "utf8"));
  assert.equal(startupConfig.command, "ogb");
  assert.equal(startupConfig.autoUpdate, false);
  assert.deepEqual(startupConfig.syncArgs, ["startup-sync"]);
  assert.deepEqual(startupConfig.updateArgs, ["check-update", "--no-write"]);
  assert.equal(startupConfig.failureBackoffMs, 10 * 60_000);

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
  const homeDir = tempProject();
  setupOpenCode({
    projectRoot,
    homeDir,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  const pluginPath = projectPath(projectRoot, STARTUP_SYNC_PLUGIN_PATH);
  fs.writeFileSync(pluginPath, "export const ManualPlugin = async () => ({})\n", "utf8");

  const conflict = setupOpenCode({
    projectRoot,
    homeDir,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(conflict.plugin.status, "conflict");
  assert.match(fs.readFileSync(pluginPath, "utf8"), /ManualPlugin/);

  const forced = setupOpenCode({
    projectRoot,
    homeDir,
    force: true,
    skipDoctor: true,
    skipCommandCheck: true,
    command: "ogb",
  });

  assert.equal(forced.plugin.status, "updated");
  assert.ok(forced.plugin.backup);
  assert.ok(forced.plugin.backup.startsWith(path.join(homeDir, ".config", "opencode-gemini-bridge", "backups", "setup-opencode")));
  assert.match(fs.readFileSync(forced.plugin.backup, "utf8"), /ManualPlugin/);
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
    syncArgs: ["startup-sync"],
    updateArgs: ["check-update", "--no-write"],
    lockTtlMs: 10 * 60_000,
  }, null, 2) + "\n");

  const restoreHome = overrideProcessHome(homeDir);
  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
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
    await plugin.event({ event: { type: "session.idle" } });
    assert.equal(fs.existsSync(path.join(generatedDir, "ogb-plugin-status.json")), false);
    await plugin.event({ event: { type: "session.created" } });

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
    restoreHome();
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
  }
});

test("startup plugin expands runtime home placeholders before spawning", async () => {
  const root = tempProject();
  const homeDir = path.join(root, "home");
  const generatedDir = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const runnerPath = path.join(homeDir, "runner.mjs");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(runnerPath, "console.log('RUNNER_ARGS=' + JSON.stringify(process.argv.slice(2)))\n", "utf8");
  fs.writeFileSync(path.join(generatedDir, "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: false,
    command: process.execPath,
    baseArgs: ["{OGB_HOME}/runner.mjs", "--project", "{OGB_HOME}"],
    syncArgs: ["startup-sync"],
    updateArgs: ["check-update", "--no-write"],
    lockTtlMs: 10 * 60_000,
  }, null, 2) + "\n");

  const restoreHome = overrideProcessHome(homeDir);
  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-runtime-home`);
    const plugin = await mod.default({
      directory: homeDir,
      worktree: homeDir,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    });

    await plugin.event({ event: { type: "session.created" } });

    const statusPath = path.join(generatedDir, "ogb-plugin-status.json");
    await waitFor(() => fs.existsSync(statusPath) && JSON.parse(fs.readFileSync(statusPath, "utf8")).state === "pass");

    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.deepEqual(status.args.map((arg: string) => path.normalize(arg)), [runnerPath, "--project", homeDir, "startup-sync"]);
    assert.match(status.stdoutTail, /RUNNER_ARGS=/);
  } finally {
    restoreHome();
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
  }
});

test("startup plugin sends OGB command output directly to chat", async () => {
  const root = tempProject();
  const projectRoot = path.join(root, "project");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const runnerPath = path.join(root, "runner.mjs");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(runnerPath, "console.log('RUNNER_ARGS=' + JSON.stringify(process.argv.slice(2)))\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: false,
    command: process.execPath,
    baseArgs: [runnerPath, "--project", projectRoot],
    syncArgs: ["startup-sync"],
    updateArgs: ["check-update", "--no-write"],
    lockTtlMs: 10 * 60_000,
  }, null, 2) + "\n");

  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const prompts: any[] = [];
    const plugin = await mod.default({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
        session: { prompt: async (entry: unknown) => prompts.push(entry) },
      },
    });

    const config: any = {};
    await plugin.config(config);
    assert.equal(config.command.bridge.description, "Painel principal do OpenCode Gemini Bridge");
    assert.equal(config.command.sync, undefined);

    await assert.rejects(
      () => plugin["command.execute.before"]({ command: "doctor", arguments: "--json", sessionID: "session-1" }),
      /__OGB_COMMAND_HANDLED__/,
    );

    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].path.id, "session-1");
    assert.equal(prompts[0].body.noReply, true);
    assert.equal(prompts[0].body.parts[0].ignored, true);
    assert.match(prompts[0].body.parts[0].text, /OpenCode Gemini Bridge \/doctor/);
    assert.match(prompts[0].body.parts[0].text, /RUNNER_ARGS=/);
    assert.match(prompts[0].body.parts[0].text, /"doctor"/);
    assert.match(prompts[0].body.parts[0].text, /"--project"/);
    const doctorArgs = JSON.parse(prompts[0].body.parts[0].text.match(/RUNNER_ARGS=(\[[^\n]+\])/)?.[1] ?? "[]");
    assert.equal(doctorArgs.filter((arg: string) => arg === "--project").length, 1);

    await assert.rejects(
      () => plugin["command.execute.before"]({ command: "bridge", arguments: "", sessionID: "session-2" }),
      /__OGB_COMMAND_HANDLED__/,
    );

    assert.equal(prompts.length, 2);
    assert.match(prompts[1].body.parts[0].text, /OpenCode Gemini Bridge \/bridge/);
    assert.match(prompts[1].body.parts[0].text, /"check"/);
    assert.doesNotMatch(prompts[1].body.parts[0].text, /"dashboard"/);
    const bridgeArgs = JSON.parse(prompts[1].body.parts[0].text.match(/RUNNER_ARGS=(\[[^\n]+\])/)?.[1] ?? "[]");
    assert.equal(bridgeArgs.filter((arg: string) => arg === "--project").length, 1);
  } finally {
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
  }
});

test("startup plugin runs global extension hooks from ordinary workspaces with workspace cwd", async () => {
  const root = tempProject();
  const homeDir = path.join(root, "home");
  const workspaceDir = path.join(root, "workspace");
  const generatedDir = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const hookLog = path.join(root, "hook-log.jsonl");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(path.join(generatedDir, "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: false,
    autoUpdate: false,
    command: "ogb",
    baseArgs: ["--project", homeDir],
    syncArgs: ["startup-sync"],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(generatedDir, "ogb-extension-map.json"), JSON.stringify({
    _generated: { tool: "ogb", version: "test", warning: "test" },
    projectRoot: homeDir,
    generatedAt: new Date().toISOString(),
    extensions: [{
      name: "study-pack",
      scope: "global",
      path: extensionDir,
      manifestPath: path.join(extensionDir, "gemini-extension.json"),
      commands: [],
      skills: [],
      agents: [],
      hooks: [{
        source: "hooks/hooks.json",
        projected: true,
        target: "opencode-plugin:tool.execute.before",
        reason: "Projected through the OGB OpenCode plugin.",
      }],
      scripts: [],
      docs: [],
      warnings: [],
    }],
    projectedCommands: [],
    projectedAgents: [],
    modelFallbacks: [],
    removedCommands: [],
    removedAgents: [],
    warnings: [],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{
        matcher: "^bash$",
        hooks: [{
          name: "workspace-guard",
          type: "command",
          command: `node "${"${extensionPath}"}${"${/}"}hook-runner.mjs"`,
          timeout: 2000,
        }],
      }],
    },
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(extensionDir, "hook-runner.mjs"), `
import fs from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input || "{}");
  fs.appendFileSync(process.env.OGB_TEST_HOOK_LOG, JSON.stringify(payload) + "\\n");
  if (payload.cwd === ${JSON.stringify(workspaceDir)}) {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "workspace cwd preserved" }));
  } else {
    process.stdout.write(JSON.stringify({ decision: "allow", cwd: payload.cwd }));
  }
});
`, "utf8");

  const restoreHome = overrideProcessHome(homeDir);
  const previousCwd = process.cwd();
  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  const previousHookLog = process.env.OGB_TEST_HOOK_LOG;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  process.env.OGB_TEST_HOOK_LOG = hookLog;
  try {
    process.chdir(workspaceDir);
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-global-extension-hooks`);
    const plugin = await mod.default({
      directory: workspaceDir,
      worktree: workspaceDir,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    });

    assert.equal(typeof plugin["tool.execute.before"], "function");
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1", directory: workspaceDir, worktree: workspaceDir }, { args: { command: "git add ." } }),
      /workspace cwd preserved/,
    );
    const record = JSON.parse(fs.readFileSync(hookLog, "utf8").trim());
    assert.equal(record.cwd, workspaceDir);
  } finally {
    process.chdir(previousCwd);
    restoreHome();
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
    if (previousHookLog === undefined) delete process.env.OGB_TEST_HOOK_LOG;
    else process.env.OGB_TEST_HOOK_LOG = previousHookLog;
  }
});

test("startup plugin runs projected Gemini extension tool hooks automatically", async () => {
  const root = tempProject();
  const projectRoot = path.join(root, "project");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const extensionDir = path.join(root, "extensions", "study-pack");
  const hookLog = path.join(root, "hook-log.jsonl");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.mkdirSync(path.join(pluginDir), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: false,
    autoUpdate: false,
    command: "ogb",
    baseArgs: [],
    syncArgs: ["startup-sync"],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), JSON.stringify({
    _generated: { tool: "ogb", version: "test", warning: "test" },
    projectRoot,
    generatedAt: new Date().toISOString(),
    extensions: [{
      name: "study-pack",
      scope: "global",
      path: extensionDir,
      manifestPath: path.join(extensionDir, "gemini-extension.json"),
      commands: [],
      skills: [],
      agents: [],
      hooks: [{
        source: "hooks/hooks.json",
        projected: true,
        target: "opencode-plugin:tool.execute.before",
        reason: "Projected through the OGB OpenCode plugin.",
      }],
      scripts: [],
      docs: [],
      warnings: [],
    }],
    projectedCommands: [],
    projectedAgents: [],
    modelFallbacks: [],
    removedCommands: [],
    removedAgents: [],
    warnings: [],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{
        matcher: "^bash$",
        hooks: [{
          name: "study-guard",
          type: "command",
          command: `node "${"${extensionPath}"}${"${/}"}hook-runner.mjs" before`,
          timeout: 2000,
        }],
      }],
      AfterTool: [{
        matcher: "^bash$",
        hooks: [{
          name: "study-capture",
          type: "command",
          command: `node "${"${extensionPath}"}${"${/}"}hook-runner.mjs" after`,
          timeout: 2000,
        }],
      }],
    },
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(extensionDir, "hook-runner.mjs"), `
import fs from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input || "{}");
  fs.appendFileSync(process.env.OGB_TEST_HOOK_LOG, JSON.stringify({
    argv: process.argv.slice(2),
    input: payload,
  }) + "\\n");
  if (payload.tool_input?.command === "deny") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "blocked by study hook" }));
  } else if (payload.tool_input?.command === "rewrite") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { tool_input: { command: "echo rewritten" } } }));
  } else {
    process.stdout.write(JSON.stringify({ suppressOutput: true }));
  }
});
`, "utf8");

  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  const previousHookLog = process.env.OGB_TEST_HOOK_LOG;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  process.env.OGB_TEST_HOOK_LOG = hookLog;
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-extension-hooks`);
    const plugin = await mod.default({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    });

    assert.equal(typeof plugin["tool.execute.before"], "function");
    assert.equal(typeof plugin["tool.execute.after"], "function");
    const beforeOutput = { args: { command: "echo ok" } };
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, beforeOutput);
    await plugin["tool.execute.after"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { output: "ok" });
    const rewriteOutput = { args: { command: "rewrite" } };
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c3" }, rewriteOutput);

    const records = fs.readFileSync(hookLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(records.map((record) => record.argv), [["before"], ["after"], ["before"]]);
    assert.equal(records[0].input.tool.name, "bash");
    assert.equal(records[0].input.tool_name, "run_shell_command");
    assert.equal(records[0].input.original_request_name, "bash");
    assert.equal(records[0].input.tool_input.command, "echo ok");
    assert.equal(records[1].input.tool_response.output, "ok");
    assert.equal(rewriteOutput.args.command, "echo rewritten");
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c2" }, { args: { command: "deny" } }),
      /blocked by study hook/,
    );
  } finally {
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
    if (previousHookLog === undefined) delete process.env.OGB_TEST_HOOK_LOG;
    else process.env.OGB_TEST_HOOK_LOG = previousHookLog;
  }
});

test("startup plugin runs Gemini settings hooks automatically without trust opt-in", async () => {
  const root = tempProject();
  const projectRoot = path.join(root, "project");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const hookLog = path.join(root, "settings-hook-log.jsonl");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.mkdirSync(path.join(pluginDir), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: false,
    autoUpdate: false,
    command: "ogb",
    baseArgs: [],
    syncArgs: ["startup-sync"],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), JSON.stringify({
    _generated: { tool: "ogb", version: "test", warning: "test" },
    projectRoot,
    generatedAt: new Date().toISOString(),
    extensions: [],
    projectedCommands: [],
    projectedAgents: [],
    modelFallbacks: [],
    removedCommands: [],
    removedAgents: [],
    warnings: [],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), `{
    // Gemini tool names should still match OpenCode tool names.
    "hooks": {
      "BeforeTool": [{
        "matcher": "run_shell_command|Bash",
        "hooks": [{
          "name": "settings-guard",
          "type": "command",
          "command": "node ./settings-hook-runner.mjs",
          "timeout": 2000,
        }],
      }],
    },
  }\n`, "utf8");
  fs.writeFileSync(path.join(projectRoot, "settings-hook-runner.mjs"), `
import fs from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input || "{}");
  fs.appendFileSync(process.env.OGB_TEST_HOOK_LOG, JSON.stringify(payload) + "\\n");
  if (payload.tool_input?.command === "block") {
    process.stderr.write("blocked by settings hook");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { tool_input: { command: "echo settings rewritten" } } }));
});
`, "utf8");

  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  const previousHookLog = process.env.OGB_TEST_HOOK_LOG;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  process.env.OGB_TEST_HOOK_LOG = hookLog;
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-settings-hooks`);
    const plugin = await mod.default({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    });

    const beforeOutput = { args: { command: "echo ok" } };
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, beforeOutput);
    assert.equal(beforeOutput.args.command, "echo settings rewritten");
    const record = JSON.parse(fs.readFileSync(hookLog, "utf8").trim());
    assert.equal(record.tool_name, "run_shell_command");
    assert.equal(record.original_request_name, "bash");
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c2" }, { args: { command: "block" } }),
      /blocked by settings hook/,
    );
  } finally {
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
    if (previousHookLog === undefined) delete process.env.OGB_TEST_HOOK_LOG;
    else process.env.OGB_TEST_HOOK_LOG = previousHookLog;
  }
});

test("startup plugin runs once for a burst of startup events", async () => {
  const root = tempProject();
  const projectRoot = path.join(root, "project");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const runnerPath = path.join(root, "runner.mjs");
  const counterPath = path.join(root, "counter.txt");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(runnerPath, "import fs from 'node:fs'; if (process.argv.slice(2).includes('startup-sync')) fs.appendFileSync(process.env.OGB_COUNTER, 'x'); console.log('ok')\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: false,
    command: process.execPath,
    baseArgs: [runnerPath],
    syncArgs: ["startup-sync"],
    updateArgs: ["check-update", "--no-write"],
    lockTtlMs: 10 * 60_000,
    failureBackoffMs: 10 * 60_000,
  }, null, 2) + "\n");

  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  const previousCounter = process.env.OGB_COUNTER;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  process.env.OGB_COUNTER = counterPath;
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-burst`);
    const toasts: any[] = [];
    const plugin = await mod.default({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async (entry: unknown) => toasts.push(entry) },
      },
    });

    await Promise.all([
      plugin.event({ event: { type: "session.created" } }),
      plugin.event({ event: { type: "session.updated" } }),
      plugin.event({ event: { type: "session.idle" } }),
      plugin.event({ event: { type: "session.created" } }),
    ]);

    const statusPath = path.join(projectRoot, ".opencode", "generated", "ogb-plugin-status.json");
    await waitFor(() => fs.existsSync(statusPath) && JSON.parse(fs.readFileSync(statusPath, "utf8")).state === "pass");

    assert.equal(fs.readFileSync(counterPath, "utf8"), "x");
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.equal(status.state, "pass");
    assert.equal(status.failureCount, 0);
    await waitFor(() => toasts.filter((toast) => JSON.stringify(toast).includes("OGB SYNC OK")).length === 1);
    assert.equal(toasts.filter((toast) => JSON.stringify(toast).includes("OGB SYNC OK")).length, 1);
  } finally {
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
    if (previousCounter === undefined) delete process.env.OGB_COUNTER;
    else process.env.OGB_COUNTER = previousCounter;
  }
});

test("startup plugin records failure diagnostics and suppresses retries during backoff", async () => {
  const root = tempProject();
  const projectRoot = path.join(root, "project");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const runnerPath = path.join(root, "runner.mjs");
  const counterPath = path.join(root, "counter.txt");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(runnerPath, [
    "import fs from 'node:fs';",
    "const isStartup = process.argv.slice(2).includes('startup-sync');",
    "if (isStartup) fs.appendFileSync(process.env.OGB_COUNTER, 'x');",
    "if (isStartup) { console.error('startup exploded clearly'); process.exit(1); }",
    "console.log('ok');",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: false,
    command: process.execPath,
    baseArgs: [runnerPath],
    syncArgs: ["startup-sync"],
    updateArgs: ["check-update", "--no-write"],
    lockTtlMs: 10 * 60_000,
    failureBackoffMs: 10 * 60_000,
  }, null, 2) + "\n");

  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  const previousCounter = process.env.OGB_COUNTER;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  process.env.OGB_COUNTER = counterPath;
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-fail`);
    const toasts: any[] = [];
    const logs: any[] = [];
    const client = {
      app: { log: async (entry: unknown) => logs.push(entry) },
      tui: { showToast: async (entry: unknown) => toasts.push(entry) },
    };
    const plugin = await mod.default({ directory: projectRoot, worktree: projectRoot, client });

    await Promise.all([
      plugin.event({ event: { type: "session.created" } }),
      plugin.event({ event: { type: "session.created" } }),
      plugin.event({ event: { type: "session.updated" } }),
    ]);

    const statusPath = path.join(projectRoot, ".opencode", "generated", "ogb-plugin-status.json");
    await waitFor(() => fs.existsSync(statusPath) && JSON.parse(fs.readFileSync(statusPath, "utf8")).state === "fail");

    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.equal(fs.readFileSync(counterPath, "utf8"), "x");
    assert.equal(status.exitCode, 1);
    assert.equal(status.signal, null);
    assert.equal(status.failureCount, 1);
    assert.equal(typeof status.nextRetryAfter, "string");
    assert.match(status.stderrTail, /startup exploded clearly/);
    assert.deepEqual(status.args.slice(-1), ["startup-sync"]);
    await waitFor(() => toasts.filter((toast) => JSON.stringify(toast).includes("OGB SYNC FALHOU")).length === 1);
    assert.equal(toasts.filter((toast) => JSON.stringify(toast).includes("OGB SYNC FALHOU")).length, 1);

    const secondPlugin = await mod.default({ directory: projectRoot, worktree: projectRoot, client });
    await secondPlugin.event({ event: { type: "session.created" } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fs.readFileSync(counterPath, "utf8"), "x");
    assert.equal(logs.some((entry) => JSON.stringify(entry).includes("failure backoff is active")), true);
  } finally {
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
    if (previousCounter === undefined) delete process.env.OGB_COUNTER;
    else process.env.OGB_COUNTER = previousCounter;
  }
});

test("startup plugin downgrades legacy auto-update startup config to check-update", async () => {
  const root = tempProject();
  const projectRoot = path.join(root, "project");
  const pluginDir = path.join(root, "plugin");
  const pluginPath = path.join(pluginDir, "ogb-startup-sync.js");
  const runnerPath = path.join(root, "runner.mjs");
  const callsPath = path.join(root, "calls.log");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "package.json"), "{\"type\":\"module\"}\n", "utf8");
  fs.writeFileSync(pluginPath, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  fs.writeFileSync(runnerPath, [
    "import fs from 'node:fs';",
    "fs.appendFileSync(process.env.OGB_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "console.log('ok');",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.json"), JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: true,
    command: process.execPath,
    baseArgs: [runnerPath],
    syncArgs: ["startup-sync"],
    updateArgs: ["auto-update"],
    lockTtlMs: 10 * 60_000,
    failureBackoffMs: 10 * 60_000,
  }, null, 2) + "\n");

  const previousDelay = process.env.OGB_STARTUP_DELAY_MS;
  const previousCalls = process.env.OGB_CALLS;
  process.env.OGB_STARTUP_DELAY_MS = "600000";
  process.env.OGB_CALLS = callsPath;
  try {
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}-autoupdate`);
    const plugin = await mod.default({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    });

    await plugin.event({ event: { type: "session.created" } });

    const statusPath = path.join(projectRoot, ".opencode", "generated", "ogb-plugin-status.json");
    await waitFor(() => fs.existsSync(statusPath) && JSON.parse(fs.readFileSync(statusPath, "utf8")).state === "pass");
    await waitFor(() => fs.existsSync(callsPath) && fs.readFileSync(callsPath, "utf8").split(/\n/).filter(Boolean).length >= 3);

    const calls = fs.readFileSync(callsPath, "utf8").trim().split(/\n/).map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args.includes("auto-update")), false);
    assert.equal(calls.some((args) => args.includes("check-update") && args.includes("--no-write")), true);
    assert.equal(calls.some((args) => args.includes("startup-sync")), true);
  } finally {
    if (previousDelay === undefined) delete process.env.OGB_STARTUP_DELAY_MS;
    else process.env.OGB_STARTUP_DELAY_MS = previousDelay;
    if (previousCalls === undefined) delete process.env.OGB_CALLS;
    else process.env.OGB_CALLS = previousCalls;
  }
});
