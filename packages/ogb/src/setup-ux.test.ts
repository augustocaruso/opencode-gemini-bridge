import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";
import { GLOBAL_AGENTS_MD } from "./global-agents.js";
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
  assert.equal(report.writes.some((write) => write.path.endsWith("agents/YOLO.md") && write.status === "created"), true);
  assert.equal(report.writes.some((write) => write.path.endsWith(".opencode/ogb.config.jsonc") && write.status === "created"), true);

  const globalConfig = readJson(path.join(configDir, "opencode.json"));
  assert.deepEqual(globalConfig.plugin, expectedGlobalPlugins(configDir));
  assert.equal(globalConfig.plugin.includes("opencode-auto-fallback@0.4.2"), false);
  assert.equal(globalConfig.plugin.includes("opencode-websearch-cited@1.2.0"), false);
  assert.equal(globalConfig.share, "manual");
  assert.equal(globalConfig.default_agent, "YOLO");
  assert.equal(globalConfig.agent.build.disable, true);
  assert.equal(globalConfig.agent.agent.permission.question, "allow");
  assert.equal(globalConfig.agent.compaction.model, "openai/gpt-5.4-mini");
  assert.equal(globalConfig.permission.websearch, "allow");
  assert.equal(globalConfig.permission.bash["npm run dev*"], "allow");
  assert.equal(globalConfig.permission.bash["git push*"], "deny");

  const yolo = fs.readFileSync(path.join(configDir, "agents", "YOLO.md"), "utf8");
  assert.match(yolo, /description: Execucao direta com minima friccao/);
  assert.match(yolo, /edit: allow/);
  assert.match(yolo, /task: allow/);
  assert.match(yolo, /external_directory: allow/);
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
  assert.match(fs.readFileSync(path.join(configDir, "commands", "upgrade-ogb.md"), "utf8"), /ogb self-update --project/);
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
  assert.deepEqual(startupConfig.baseArgs, ["--project", homeDir]);
  assert.deepEqual(startupConfig.syncArgs, ["startup-sync"]);
  assert.equal(startupConfig.autoUpdate, false);
  assert.deepEqual(startupConfig.updateArgs, ["check-update", "--no-write"]);
  assert.equal(startupConfig.failureBackoffMs, 10 * 60_000);
});

test("setupUx writes an absolute Windows ogb shim path for startup sync", () => {
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
  assert.equal(startupConfig.command, ogbShim);
  assert.deepEqual(startupConfig.baseArgs, ["--project", homeDir]);
  assert.deepEqual(startupConfig.syncArgs, ["startup-sync"]);
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
  assert.equal(report.writes.some((write) => write.path.endsWith("commands/dev-server.md") && write.status === "removed"), true);
  assert.equal(fs.readFileSync(path.join(configDir, "AGENTS.md"), "utf8"), GLOBAL_AGENTS_MD);
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

test("setupUx treats the home directory as global-only and skips project profile", () => {
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

  assert.equal(report.ogbConfigPath, undefined);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "ogb.config.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "plugins", "ogb-startup-sync.js")), false);
  assert.equal(fs.existsSync(path.join(configDir, "opencode.json")), true);
  assert.equal(fs.existsSync(path.join(configDir, "plugins", "ogb-startup-sync.js")), true);
  assert.equal(report.warnings.some((warning) => warning.includes("Diretorio home detectado")), false);
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

test("setupUx preserves existing project profile unless forced", () => {
  const root = tempRoot();
  const configDir = path.join(root, "config", "opencode");
  const projectRoot = path.join(root, "project");
  const profilePath = path.join(projectRoot, ".opencode", "ogb.config.jsonc");
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, "{ \"custom\": true }\n", "utf8");

  const conflict = setupUx({
    homeDir: path.join(root, "home"),
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
  });
  assert.equal(conflict.writes.some((write) => write.path === profilePath && write.status === "conflict"), true);
  assert.match(fs.readFileSync(profilePath, "utf8"), /custom/);

  const forced = setupUx({
    homeDir: path.join(root, "home"),
    configDir,
    projectRoot,
    installOpenCode: false,
    installPlugins: false,
    force: true,
  });
  assert.equal(forced.writes.some((write) => write.path === profilePath && write.status === "updated"), true);
  assert.match(fs.readFileSync(profilePath, "utf8"), /med-chat-triager/);
});
