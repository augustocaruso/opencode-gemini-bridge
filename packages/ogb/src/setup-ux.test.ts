import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";
import { GLOBAL_AGENTS_MD } from "./global-agents.js";
import { enableMaintainerRole } from "./local-role.js";
import {
  authProbeAvailableMethods,
  globalStartupPluginSpec,
  missingAuthProbeExpectations,
  missingGlobalTuiRuntimeDependencies,
  OGB_TUI_RUNTIME_DEPENDENCIES,
  missingPluginsFromDebugInfo,
  OGB_UX_PLUGINS,
  setupUx as rawSetupUx,
  type SetupUxOptions,
} from "./setup-ux.js";
import { TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-ux-"));
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pathEndsWith(filePath: string, relPath: string): boolean {
  return filePath.replace(/\\/g, "/").endsWith(relPath);
}

function setupUx(options: SetupUxOptions = {}) {
  return rawSetupUx({ installTuiDependencies: false, ...options });
}

function expectedGlobalPlugins(configDir: string): string[] {
  return [
    ...OGB_UX_PLUGINS,
    globalStartupPluginSpec(path.join(configDir, "plugins", "ogb-startup-sync.js")),
  ];
}

test("missingPluginsFromDebugInfo detects expected plugins absent from resolved OpenCode info", () => {
  assert.deepEqual(missingPluginsFromDebugInfo(`opencode version: 1.14.39
plugins:
- opencode-gemini-auth@1.4.12
- @ex-machina/opencode-anthropic-auth@1.8.0
`, [
    "opencode-gemini-auth@1.4.12",
    "@ex-machina/opencode-anthropic-auth@1.8.0",
    "opencode-pty@0.3.4",
  ]), ["opencode-pty@0.3.4"]);
});

test("global AGENTS.md preset uses platform-neutral external terminal guidance", () => {
  assert.doesNotMatch(GLOBAL_AGENTS_MD, /macOS Terminal/);
  assert.match(GLOBAL_AGENTS_MD, /normal external terminal for the current operating system/);
});

test("setupUx writes global OpenCode UX profile and project fallback profile", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  assert.equal(report.writes.some((write) => write.path.endsWith("opencode.json") && write.status === "created"), true);
  assert.equal(report.writes.some((write) => pathEndsWith(write.path, "agents/YOLO.md") && write.status === "created"), true);
  assert.equal(report.writes.some((write) => pathEndsWith(write.path, "agents/YOLO-worker.md") && write.status === "created"), true);
  assert.equal(report.writes.some((write) => pathEndsWith(write.path, ".opencode/ogb.config.jsonc") && write.status === "created"), true);

  const globalConfig = readJson(path.join(configDir, "opencode.json"));
  assert.deepEqual(globalConfig.plugin, expectedGlobalPlugins(configDir));
  assert.equal(globalConfig.plugin.includes("file:plugins/ogb-startup-sync.js"), false);
  assert.equal(globalConfig.plugin.some((plugin: unknown) =>
    typeof plugin === "string" && plugin.startsWith("file:///") && plugin.includes("ogb-startup-sync.js")
  ), true);
  assert.equal(globalConfig.plugin.includes("opencode-auto-fallback@0.4.2"), false);
  assert.equal(globalConfig.plugin.includes("opencode-websearch-cited@1.2.0"), false);
  assert.equal(globalConfig.share, "manual");
  assert.equal(globalConfig.default_agent, "YOLO");
  assert.equal(globalConfig.agent.build.disable, true);
  assert.equal(globalConfig.agent.agent.permission.question, "allow");
  assert.equal(globalConfig.agent.agent.permission.bash["*"], "ask");
  assert.equal(globalConfig.agent.agent.permission.bash["git status*"], "allow");
  assert.equal(globalConfig.agent.agent.permission.bash["rg*"], "allow");
  assert.equal(globalConfig.agent.agent.permission.bash["stat *"], "allow");
  assert.equal(globalConfig.agent.agent.permission.read, "allow");
  assert.equal(globalConfig.agent.agent.permission.glob, "allow");
  assert.equal(globalConfig.agent.agent.permission.grep, "allow");
  assert.equal(globalConfig.agent.agent.permission.list, "allow");
  assert.equal(globalConfig.agent.agent.permission.bash["git push*"], "deny");
  assert.equal(globalConfig.agent.plan.permission.bash["*"], "ask");
  assert.equal(globalConfig.agent.plan.permission.bash["git status*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["rg*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["stat *"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["du *"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["git cat-file*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["gh auth status*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["gh pr view*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["gh release view*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["gh run view*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["gh api repos/*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["gh pr checkout*"], "deny");
  assert.equal(globalConfig.agent.plan.permission.bash["gh release delete*"], "deny");
  assert.equal(globalConfig.agent.plan.permission.bash["gh api *--method POST*"], "deny");
  assert.equal(globalConfig.agent.plan.permission.read, "allow");
  assert.equal(globalConfig.agent.plan.permission.glob, "allow");
  assert.equal(globalConfig.agent.plan.permission.grep, "allow");
  assert.equal(globalConfig.agent.plan.permission.list, "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["git push*"], "deny");
  assert.equal(globalConfig.agent.plan.permission.edit, "ask");
  assert.equal(globalConfig.agent.plan.permission.question, "allow");
  assert.equal(globalConfig.agent.compaction.model, "openai/gpt-5.4-mini");
  assert.equal(globalConfig.permission.websearch, "allow");
  assert.equal(globalConfig.permission.bash["npm run dev*"], "allow");
  assert.equal(globalConfig.permission.bash["git push*"], "deny");

  const yolo = fs.readFileSync(path.join(configDir, "agents", "YOLO.md"), "utf8");
  assert.match(yolo, /description: Direct execution with minimal friction/);
  assert.match(yolo, /edit: allow/);
  assert.match(yolo, /task: allow/);
  assert.match(yolo, /external_directory: allow/);
  assert.match(yolo, /YOLO-worker/);
  const yoloWorker = fs.readFileSync(path.join(configDir, "agents", "YOLO-worker.md"), "utf8");
  assert.match(yoloWorker, /mode: subagent/);
  assert.match(yoloWorker, /bash: allow/);
  assert.match(yoloWorker, /external_directory: allow/);
  assert.equal(fs.readFileSync(path.join(configDir, "AGENTS.md"), "utf8"), GLOBAL_AGENTS_MD);

  const fallback = readJson(path.join(configDir, "plugins", "fallback.json"));
  assert.equal(fallback.enabled, false);
  assert.equal(fallback.cooldownMs, 60_000);
  assert.equal(fallback.maxRetries, 2);
  assert.equal(fallback.agentFallbacks["med-chat-triager"][0].model, "openai/gpt-5.4-mini");
  assert.equal(fallback.agentFallbacks["med-chat-triager"][0].reasoningEffort, "medium");

  const projectConfig = parseJsonc(fs.readFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), "utf8"));
  assert.equal(projectConfig.openCode.defaultAgent, "YOLO");
  assert.equal(projectConfig.externalPlugins.autoFallback.plugin, "opencode-auto-fallback@0.4.3");
  assert.equal(projectConfig.externalPlugins.autoFallback.installProjectPlugin, false);
  assert.equal(projectConfig.modelFallbacks.agents["med-knowledge-architect"].model.variant, "high");
  assert.equal(projectConfig.modelFallbacks.agents["med-chat-triager"].model.variant, "high");

  assert.equal(fs.existsSync(path.join(configDir, "commands", "research.md")), true);
  assert.equal(fs.existsSync(path.join(configDir, "commands", "dev-server.md")), false);
  assert.equal(fs.existsSync(path.join(configDir, "commands", "upgrade-ogb.md")), true);
  assert.match(fs.readFileSync(path.join(configDir, "commands", "upgrade-ogb.md"), "utf8"), /^ogb self-update --project "\$PWD"$/m);
  assert.match(fs.readFileSync(path.join(configDir, "commands", "upgrade-ogb.md"), "utf8"), /^ogb doctor --project "\$PWD"$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(configDir, "commands", "upgrade-ogb.md"), "utf8"), /^ogb update$/m);
  assert.equal(fs.existsSync(path.join(configDir, "dcp.jsonc")), true);
  const packageJson = readJson(path.join(configDir, "package.json"));
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.dependencies["@opentui/solid"], OGB_TUI_RUNTIME_DEPENDENCIES["@opentui/solid"]);
  assert.deepEqual(packageJson.dependencies["solid-js"], OGB_TUI_RUNTIME_DEPENDENCIES["solid-js"]);
  assert.equal(fs.existsSync(path.join(configDir, "plugins", "ogb-startup-sync.js")), true);
  assert.match(fs.readFileSync(path.join(configDir, "plugins", "ogb-startup-sync.js"), "utf8"), /GLOBAL_GENERATED_DIR/);
  assert.equal(fs.existsSync(path.join(configDir, "tui-plugins", "ogb-sidebar.js")), true);
  assert.match(fs.readFileSync(path.join(configDir, "tui-plugins", "ogb-sidebar.js"), "utf8"), /GLOBAL_GENERATED_DIR/);
  const globalTuiConfig = readJson(path.join(configDir, "tui.json"));
  assert.deepEqual(globalTuiConfig.plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
  const startupConfig = readJson(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-startup-sync.json"));
  assert.equal(typeof startupConfig.command, "string");
  assert.deepEqual(startupConfig.baseArgs, ["--project", process.platform === "win32" ? "{OGB_HOME}" : homeDir]);
  assert.deepEqual(startupConfig.syncArgs, ["startup-sync"]);
  assert.equal(startupConfig.autoUpdate, false);
  assert.deepEqual(startupConfig.updateArgs, ["check-update", "--no-write"]);
  assert.equal(startupConfig.failureBackoffMs, 10 * 60_000);
});

test("setupUx backs up and replaces a stale file blocking the global OpenCode config dir", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(homeDir, ".config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(path.dirname(configDir), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(configDir, "stale projected file\n", "utf8");

  const report = setupUx({
    homeDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  assert.equal(fs.statSync(configDir).isDirectory(), true);
  assert.equal(fs.existsSync(path.join(configDir, "opencode.json")), true);
  const repair = report.writes.find((write) => write.path === configDir && write.status === "removed");
  assert.ok(repair?.backup);
  assert.equal(fs.readFileSync(repair.backup, "utf8"), "stale projected file\n");
});

test("setupUx replaces the legacy relative OGB startup plugin spec", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [
      "opencode-gemini-auth@1.4.12",
      "file:plugins/ogb-startup-sync.js",
    ],
  }, null, 2), "utf8");

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  const globalConfig = readJson(path.join(configDir, "opencode.json"));
  assert.equal(globalConfig.plugin.includes("file:plugins/ogb-startup-sync.js"), false);
  assert.equal(globalConfig.plugin.includes(globalStartupPluginSpec(path.join(configDir, "plugins", "ogb-startup-sync.js"))), true);
  assert.equal(report.warnings.some((warning) => warning.includes("file:plugins/ogb-startup-sync.js")), true);
});

test("setupUx writes runtime-expanded Windows ogb shim path for startup sync", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const appData = path.join(homeDir, "AppData", "Roaming");
  const configDir = path.join(homeDir, ".config", "opencode");
  const projectRoot = path.join(root, "project");
  const npmDir = path.join(appData, "npm");
  const ogbShim = path.join(npmDir, "ogb.cmd");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(npmDir, { recursive: true });
  fs.writeFileSync(ogbShim, "@echo off\n", "utf8");

  setupUx({
    homeDir,
    configDir,
    projectRoot,
    platform: "win32",
    env: { APPDATA: appData, Path: "" },
    installOpenCode: false,
    installPlugins: false,
  });

  const startupConfig = readJson(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-startup-sync.json"));
  assert.equal(startupConfig.command.replace(/\\/g, "/"), "{OGB_APPDATA}/npm/ogb.cmd");
  assert.deepEqual(startupConfig.baseArgs, ["--project", "{OGB_HOME}"]);
  assert.deepEqual(startupConfig.syncArgs, ["startup-sync"]);
});

test("setupUx prefers the installed ogb command for POSIX startup sync", { skip: process.platform === "win32" ? "POSIX command lookup is covered on POSIX runners" : false }, () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  const binDir = path.join(root, "bin");
  const ogbBin = path.join(binDir, "ogb");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(ogbBin, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(ogbBin, 0o755);

  setupUx({
    homeDir,
    configDir,
    projectRoot,
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
    installOpenCode: false,
    installPlugins: false,
  });

  const startupConfig = readJson(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-startup-sync.json"));
  assert.equal(startupConfig.command, ogbBin);
  assert.deepEqual(startupConfig.baseArgs, ["--project", homeDir]);
});

test("setupUx removes the retired global dev-server command and overwrites global AGENTS.md", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(path.join(configDir, "commands"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(configDir, "commands", "dev-server.md"), "old dev server command\n", "utf8");
  fs.writeFileSync(path.join(configDir, "AGENTS.md"), "User AGENTS\n", "utf8");

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  assert.equal(fs.existsSync(path.join(configDir, "commands", "dev-server.md")), false);
  assert.equal(report.writes.some((write) => pathEndsWith(write.path, "commands/dev-server.md") && write.status === "removed"), true);
  assert.equal(report.writes.some((write) => pathEndsWith(write.path, "commands/dev-server.md") && Boolean(write.backup)), true);
  assert.equal(fs.readFileSync(path.join(configDir, "AGENTS.md"), "utf8"), GLOBAL_AGENTS_MD);
});

test("setupUx protects differing OpenCode profile files when maintainer mode is enabled", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(path.join(configDir, "commands"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  enableMaintainerRole({ homeDir });

  const agentsPath = path.join(configDir, "AGENTS.md");
  const retiredCommandPath = path.join(configDir, "commands", "dev-server.md");
  fs.writeFileSync(agentsPath, "Maintainer AGENTS\n", "utf8");
  fs.writeFileSync(retiredCommandPath, "maintainer dev server command\n", "utf8");

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    force: true,
    installOpenCode: false,
    installPlugins: false,
  });

  assert.equal(fs.readFileSync(agentsPath, "utf8"), "Maintainer AGENTS\n");
  assert.equal(fs.readFileSync(retiredCommandPath, "utf8"), "maintainer dev server command\n");
  assert.equal(report.writes.some((write) => write.path === agentsPath && write.status === "protected"), true);
  assert.equal(report.writes.some((write) => write.path === retiredCommandPath && write.status === "protected"), true);
  assert.equal(report.writes.some((write) => Boolean(write.backup)), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "backups")), false);
  assert.equal(report.warnings.some((warning) => warning.includes("modo mantenedor local")), true);
});

test("setupUx still repairs startup runtime files when maintainer mode is enabled", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const generatedDir = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated");
  const projectRoot = path.join(root, "project");
  const startupConfigPath = path.join(generatedDir, "ogb-startup-sync.json");
  const startupStatusPath = path.join(generatedDir, "ogb-plugin-status.json");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(startupConfigPath, JSON.stringify({
    version: 1,
    enabled: true,
    command: "/missing/node",
    baseArgs: ["/old/ogb/dist/cli.js", "--project", homeDir],
    syncArgs: ["startup-sync"],
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(startupStatusPath, JSON.stringify({
    version: 1,
    state: "fail",
    reason: "plugin.init",
    cwd: homeDir,
    startedAt: "2026-05-12T04:00:00.000Z",
    finishedAt: "2026-05-12T04:00:00.010Z",
    exitCode: null,
    command: "/missing/node",
    args: ["/old/ogb/dist/cli.js", "--project", homeDir, "startup-sync"],
    error: "ENOENT: no such file or directory, posix_spawn '/missing/node'",
  }, null, 2) + "\n", "utf8");
  enableMaintainerRole({ homeDir });

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  const startupConfig = readJson(startupConfigPath);
  const startupStatus = readJson(startupStatusPath);
  assert.notEqual(startupConfig.command, "/missing/node");
  assert.deepEqual(startupConfig.syncArgs, ["startup-sync"]);
  assert.equal(startupStatus.state, "pass");
  assert.equal(startupStatus.reason, "setup-ux.replaced-stale-startup-launcher");
  assert.equal(report.writes.find((write) => write.path === startupConfigPath)?.status, "updated");
  assert.equal(report.warnings.some((warning) => warning.includes(`${startupConfigPath} protegido`)), false);
});

test("setupUx overwrites user profile files with backups by default", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(path.join(configDir, "commands"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  const agentsPath = path.join(configDir, "AGENTS.md");
  const retiredCommandPath = path.join(configDir, "commands", "dev-server.md");
  fs.writeFileSync(agentsPath, "User AGENTS\n", "utf8");
  fs.writeFileSync(retiredCommandPath, "old dev server command\n", "utf8");

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });
  const agentsWrite = report.writes.find((write) => write.path === agentsPath);
  const removedWrite = report.writes.find((write) => write.path === retiredCommandPath);

  assert.equal(fs.readFileSync(agentsPath, "utf8"), GLOBAL_AGENTS_MD);
  assert.equal(fs.existsSync(retiredCommandPath), false);
  assert.equal(agentsWrite?.status, "updated");
  assert.ok(agentsWrite?.backup);
  assert.equal(fs.readFileSync(agentsWrite.backup, "utf8"), "User AGENTS\n");
  assert.equal(removedWrite?.status, "removed");
  assert.ok(removedWrite?.backup);
  assert.equal(fs.readFileSync(removedWrite.backup, "utf8"), "old dev server command\n");
});

test("setupUx lets OGB-managed opencode.json fields win while preserving unknown user fields and backup", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  const configPath = path.join(configDir, "opencode.json");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    plugin: ["user-plugin@1.0.0"],
    default_agent: "agent",
    custom_user_field: { keep: true },
    agent: {
      agent: {
        permission: {
          bash: {
            "hx*": "allow",
          },
        },
      },
      plan: {
        permission: {
          bash: {
            "custom-read*": "allow",
          },
          edit: "deny",
        },
      },
    },
  }, null, 2) + "\n", "utf8");

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });
  const write = report.writes.find((item) => item.path === configPath);
  const globalConfig = readJson(configPath);

  assert.equal(globalConfig.custom_user_field.keep, true);
  assert.equal(globalConfig.default_agent, "YOLO");
  assert.deepEqual(globalConfig.plugin, expectedGlobalPlugins(configDir));
  assert.equal(globalConfig.agent.agent.permission.bash["hx*"], "allow");
  assert.equal(globalConfig.agent.agent.permission.bash["rg*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["custom-read*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.bash["rg*"], "allow");
  assert.equal(globalConfig.agent.plan.permission.edit, "ask");
  assert.equal(write?.status, "updated");
  assert.ok(write?.backup);
  const backup = readJson(write.backup);
  assert.deepEqual(backup.plugin, ["user-plugin@1.0.0"]);
  assert.equal(backup.default_agent, "agent");
});

test("setupUx installs missing global TUI runtime dependencies", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  const report = rawSetupUx({
    homeDir,
    configDir,
    projectRoot,
    dryRun: true,
    installOpenCode: false,
    installPlugins: false,
  });

  assert.deepEqual(missingGlobalTuiRuntimeDependencies(configDir), [
    "@opentui/solid@0.2.2",
    "solid-js@1.9.12",
  ]);
  assert.equal(report.writes.some((write) => write.path === path.join(configDir, "package.json") && write.status === "preview"), true);
  assert.equal(report.commands.some((command) => command.status === "preview" && command.command.includes("@opentui/solid@0.2.2") && command.command.includes("solid-js@1.9.12")), true);
  assert.equal(fs.existsSync(configDir), false);
});

test("setupUx treats the home directory as global-only and writes the global OGB profile", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  fs.mkdirSync(homeDir, { recursive: true });

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot: homeDir,
    installOpenCode: false,
    installPlugins: false,
  });

  const globalProfilePath = path.join(homeDir, ".config", "opencode-gemini-bridge", "ogb.config.jsonc");
  const globalProfile = parseJsonc(fs.readFileSync(globalProfilePath, "utf8"));

  assert.equal(report.ogbConfigPath, globalProfilePath);
  assert.equal(globalProfile.openCode.defaultAgent, "YOLO");
  assert.equal(globalProfile.modelFallbacks.agents["med-chat-triager"].model.id, "google/gemini-3-flash-preview");
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "ogb.config.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "plugins", "ogb-startup-sync.js")), false);
  assert.equal(fs.existsSync(path.join(configDir, "opencode.json")), true);
  assert.equal(fs.existsSync(path.join(configDir, "plugins", "ogb-startup-sync.js")), true);
  assert.equal(report.warnings.some((warning) => warning.includes("Diretorio home detectado")), false);
});

test("setupUx treats an accidentally quoted home path as global-only", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  fs.mkdirSync(homeDir, { recursive: true });

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot: `"${homeDir}"`,
    installOpenCode: false,
    installPlugins: false,
  });
  const startupConfig = readJson(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-startup-sync.json"));

  assert.equal(report.ogbConfigPath, path.join(homeDir, ".config", "opencode-gemini-bridge", "ogb.config.jsonc"));
  assert.equal(report.projectRoot, path.resolve(homeDir));
  assert.deepEqual(startupConfig.baseArgs, ["--project", process.platform === "win32" ? "{OGB_HOME}" : path.resolve(homeDir)]);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "ogb.config.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated")), false);
});

test("setupUx writes Windows global config under user .config, not AppData opencode", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const appData = path.join(homeDir, "AppData", "Roaming");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  const report = setupUx({
    homeDir,
    projectRoot,
    platform: "win32",
    env: { APPDATA: appData },
    installOpenCode: false,
    installPlugins: false,
  });

  const configPath = path.join(homeDir, ".config", "opencode", "opencode.json");
  assert.equal(report.configPath, configPath);
  assert.equal(fs.existsSync(configPath), true);
  assert.equal(fs.existsSync(path.join(appData, "opencode", "opencode.json")), false);
});

test("setupUx migrates and cleans legacy Windows AppData OpenCode config", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const appData = path.join(homeDir, "AppData", "Roaming");
  const legacyDir = path.join(appData, "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "opencode.json"), JSON.stringify({
    plugin: [
      "opencode-gemini-auth@1.4.12",
      "opencode-websearch-cited@1.2.0",
      "opencode-auto-fallback@0.4.2",
    ],
    provider: {
      openai: {
        options: {
          websearch_cited: { model: "gpt-5.5" },
          organization: "org-user",
        },
      },
    },
    share: "manual",
  }, null, 2), "utf8");

  const report = setupUx({
    homeDir,
    projectRoot,
    platform: "win32",
    env: { APPDATA: appData },
    installOpenCode: false,
    installPlugins: false,
  });

  const configPath = path.join(homeDir, ".config", "opencode", "opencode.json");
  const globalConfig = readJson(configPath);
  const legacyConfig = readJson(path.join(legacyDir, "opencode.json"));

  assert.deepEqual(globalConfig.plugin, expectedGlobalPlugins(path.join(homeDir, ".config", "opencode")));
  assert.equal(globalConfig.provider.openai.options.organization, "org-user");
  assert.equal(globalConfig.provider.openai.options.websearch_cited, undefined);
  assert.equal(legacyConfig.plugin.includes("opencode-websearch-cited@1.2.0"), false);
  assert.equal(legacyConfig.plugin.includes("opencode-auto-fallback@0.4.2"), false);
  assert.equal(legacyConfig.provider.openai.options.websearch_cited, undefined);
  assert.equal(report.warnings.some((warning) => warning.includes("foi migrado")), true);
});

test("auth probe parser recognizes OAuth methods and fails API-key-only output", () => {
  const openaiOutput = 'Unknown method "__ogb_probe__" for openai. Available: ChatGPT Pro/Plus (browser), ChatGPT Pro/Plus (headless), Manually enter API Key';
  const googleOutput = 'Unknown method "__ogb_probe__" for google. Available: OAuth with Google (Gemini CLI), Manually enter API Key';
  const apiKeyOnly = 'Unknown method "__ogb_probe__" for openai. Available: Manually enter API Key';

  assert.deepEqual(authProbeAvailableMethods(openaiOutput), [
    "ChatGPT Pro/Plus (browser)",
    "ChatGPT Pro/Plus (headless)",
    "Manually enter API Key",
  ]);
  assert.deepEqual(missingAuthProbeExpectations("openai", openaiOutput), []);
  assert.deepEqual(missingAuthProbeExpectations("google", googleOutput), []);
  assert.deepEqual(missingAuthProbeExpectations("openai", apiKeyOnly), ["ChatGPT Pro/Plus"]);
});

test("setupUx dry-run previews without writing files", () => {
  const root = tempRoot();
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");

  const report = setupUx({
    homeDir: path.join(root, "home"),
    configDir,
    projectRoot,
    dryRun: true,
    installOpenCode: false,
    installPlugins: false,
  });

  assert.equal(report.writes.every((write) => write.status === "preview"), true);
  assert.equal(fs.existsSync(configDir), false);
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc")), false);
});

test("setupUx removes stale websearch_cited provider option without dropping user provider config", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [
      "opencode-gemini-auth@1.4.12",
      "opencode-auto-fallback@0.4.2",
      "opencode-websearch-cited@1.2.0",
    ],
    provider: {
      openai: {
        options: {
          websearch_cited: { model: "gpt-5.5" },
          organization: "org-user",
        },
      },
      "my-provider": {
        name: "My Provider",
      },
    },
  }, null, 2));

  setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  const globalConfig = readJson(path.join(configDir, "opencode.json"));
  assert.equal(globalConfig.plugin.includes("opencode-auto-fallback@0.4.2"), false);
  assert.equal(globalConfig.plugin.includes("opencode-websearch-cited@1.2.0"), false);
  assert.equal(globalConfig.provider.openai.options.websearch_cited, undefined);
  assert.equal(globalConfig.provider.openai.options.organization, "org-user");
  assert.equal(globalConfig.provider["my-provider"].name, "My Provider");
});

test("setupUx can reset the global OpenCode config instead of merging it", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: ["user-plugin@1.0.0"],
    provider: {
      "my-provider": {
        name: "My Provider",
      },
    },
    instructions: ["/old/global/context.md"],
    custom_field: true,
  }, null, 2));

  setupUx({
    homeDir,
    configDir,
    projectRoot,
    resetGlobal: true,
    installOpenCode: false,
    installPlugins: false,
  });

  const globalConfig = readJson(path.join(configDir, "opencode.json"));
  assert.deepEqual(globalConfig.plugin, expectedGlobalPlugins(configDir));
  assert.equal(globalConfig.provider, undefined);
  assert.equal(globalConfig.instructions, undefined);
  assert.equal(globalConfig.custom_field, undefined);
  assert.equal(globalConfig.default_agent, "YOLO");
  assert.equal(globalConfig.permission.websearch, "allow");
});

test("setupUx preserves global TUI settings while adding the OGB sidebar plugin", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(configDir, "tui.json"), JSON.stringify({
    $schema: "https://opencode.ai/tui.json",
    mouse: true,
    scroll_speed: 1,
    plugin: [],
  }, null, 2) + "\n");

  setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  const tuiConfig = readJson(path.join(configDir, "tui.json"));
  assert.equal(tuiConfig.mouse, true);
  assert.equal(tuiConfig.scroll_speed, 1);
  assert.deepEqual(tuiConfig.plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
  assert.equal(fs.existsSync(path.join(configDir, "tui-plugins", "ogb-sidebar.js")), true);
});

test("setupUx recovers stale global startup sync status", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const generatedDir = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "ogb-plugin-status.json"), JSON.stringify({
    version: 1,
    state: "running",
    reason: "plugin.init",
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
    command: "ogb",
    args: ["--project", homeDir, "sync"],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(generatedDir, "ogb-startup-sync.lock"), JSON.stringify({
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
  }) + "\n");

  setupUx({
    homeDir,
    configDir,
    projectRoot,
    resetGlobal: true,
    installOpenCode: false,
    installPlugins: false,
  });

  const status = readJson(path.join(generatedDir, "ogb-plugin-status.json"));
  assert.equal(status.state, "pass");
  assert.equal(status.reason, "setup-ux.recovered-stale");
  assert.equal(fs.existsSync(path.join(generatedDir, "ogb-startup-sync.lock")), false);
});

test("setupUx keeps websearch-cited disabled even after OpenAI and Google auth exist", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  const authPath = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify({
    openai: {
      type: "oauth",
      access: "openai-access",
      refresh: "openai-refresh",
      expires: Date.now() + 60_000,
    },
    google: {
      type: "oauth",
      access: "google-access",
      refresh: "google-refresh",
      expires: Date.now() + 60_000,
    },
  }), "utf8");
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [
      ...expectedGlobalPlugins(configDir),
      "opencode-websearch-cited@1.2.0",
    ],
    provider: {
      openai: {
        options: {
          websearch_cited: { model: "gpt-5.5" },
        },
      },
    },
  }), "utf8");

  const report = setupUx({
    homeDir,
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });

  const globalConfig = readJson(path.join(configDir, "opencode.json"));
  assert.deepEqual(globalConfig.plugin, expectedGlobalPlugins(configDir));
  assert.equal(globalConfig.provider, undefined);
  assert.equal(report.warnings.some((warning) => warning.includes("opencode-websearch-cited foi desativado")), true);
});

test("setupUx dry-run previews OpenCode install or update by default", () => {
  const root = tempRoot();
  const report = setupUx({
    homeDir: path.join(root, "home"),
    configDir: path.join(root, "config", "opencode"),
    projectRoot: path.join(root, "project"),
    dryRun: true,
    installPlugins: false,
  });

  const installCommand = report.commands.find((command) =>
    command.command.join(" ").includes("opencode-ai@latest")
    || command.command.join(" ").includes("opencode.ai/install")
  );
  assert.equal(installCommand?.status, "preview");
});

test("setupUx skips the OpenCode installer when opencode is already available", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const opencodePath = path.join(homeDir, ".opencode", "bin", "opencode");
  fs.mkdirSync(path.dirname(opencodePath), { recursive: true });
  fs.writeFileSync(opencodePath, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(opencodePath, 0o755);

  const report = setupUx({
    homeDir,
    configDir: path.join(root, "config", "opencode"),
    projectRoot: path.join(root, "project"),
    installPlugins: false,
    installTuiDependencies: false,
  });

  const openCodeCommand = report.commands.find((command) => command.role === "opencode");
  assert.equal(openCodeCommand?.status, "ok");
  assert.equal(openCodeCommand?.message, "OpenCode already available.");
  assert.equal(report.commands.some((command) =>
    command.command.join(" ").includes("opencode-ai@latest")
    || command.command.join(" ").includes("opencode.ai/install")
  ), false);
});

test("setupUx overwrites existing project profile with backup by default", () => {
  const root = tempRoot();
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  const profilePath = path.join(projectRoot, ".opencode", "ogb.config.jsonc");
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, "{ \"custom\": true }\n", "utf8");

  const report = setupUx({
    homeDir: path.join(root, "home"),
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });
  const write = report.writes.find((item) => item.path === profilePath);
  assert.equal(write?.status, "updated");
  assert.ok(write?.backup);
  assert.match(fs.readFileSync(write.backup, "utf8"), /custom/);
  assert.match(fs.readFileSync(profilePath, "utf8"), /med-chat-triager/);
});
