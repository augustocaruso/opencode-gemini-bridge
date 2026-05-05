import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256Text } from "./file-hash.js";
import { syncToOpenCode } from "./sync.js";
import { TUI_CONFIG_PATH, TUI_SIDEBAR_PLUGIN_PATH, TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";
import { OGB_VERSION } from "./types.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-sync-"));
}

test("syncToOpenCode writes bridge-native generated config without Rulesync", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "Rules\n");
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      local: {
        command: "node",
        args: ["server.js"],
      },
    },
  }));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const generatedPath = path.join(projectRoot, ".opencode", "generated", "opencode.generated.json");
  const generated = JSON.parse(fs.readFileSync(generatedPath, "utf8"));
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  const tuiConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ...TUI_CONFIG_PATH.split("/")), "utf8"));

  assert.equal(report.rulesync.status, "skipped");
  assert.deepEqual(generated._generated, {
    tool: "ogb",
    version: OGB_VERSION,
    warning: "DO NOT EDIT. Regenerate with ogb sync.",
  });
  assert.deepEqual(generated.instructions, [".opencode/generated/GEMINI.expanded.md"]);
  assert.deepEqual(generated.mcp.local.command, ["node", "server.js"]);
  assert.deepEqual(projectConfig.mcp.local.command, ["node", "server.js"]);
  assert.ok(report.projectedTuiFiles.includes(TUI_SIDEBAR_PLUGIN_PATH));
  assert.ok(report.projectedTuiFiles.includes(TUI_CONFIG_PATH));
  assert.deepEqual(tuiConfig.plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
});

test("syncToOpenCode projects built-in YOLO agent", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const yoloPath = path.join(projectRoot, ".opencode", "agents", "YOLO.md");
  const yolo = fs.readFileSync(yoloPath, "utf8");

  assert.ok(report.projectedAgents.includes(".opencode/agents/YOLO.md"));
  assert.equal(report.projectedAgents.length, 1);
  assert.match(yolo, /description: Execucao direta com minima friccao em workspace confiavel\./);
  assert.doesNotMatch(yolo, /description: YOLO:/);
  assert.match(yolo, /mode: primary/);
  assert.match(yolo, /color: "#ffb4b4"/);
  assert.match(yolo, /edit: allow/);
  assert.match(yolo, /bash: allow/);
  assert.match(yolo, /external_directory: ask/);
});

test("syncToOpenCode removes previously managed non-YOLO built-in agents", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const agentsDir = path.join(projectRoot, ".opencode", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  const oldAgentPath = path.join(agentsDir, "study.md");
  const oldAgent = "old generated study agent\n";
  fs.writeFileSync(oldAgentPath, oldAgent, "utf8");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), JSON.stringify({
    version: OGB_VERSION,
    managedFiles: [
      {
        path: ".opencode/agents/study.md",
        sha256: sha256Text(oldAgent),
        source: "ogb",
      },
    ],
  }, null, 2) + "\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });

  assert.ok(report.removedAgents.includes(".opencode/agents/study.md"));
  assert.equal(fs.existsSync(oldAgentPath), false);
  assert.equal(fs.existsSync(path.join(agentsDir, "YOLO.md")), true);
});

test("syncToOpenCode does not overwrite manually edited YOLO agent without force", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const yoloPath = path.join(projectRoot, ".opencode", "agents", "YOLO.md");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  fs.writeFileSync(yoloPath, "manual yolo\n", "utf8");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });

  assert.equal(fs.readFileSync(yoloPath, "utf8"), "manual yolo\n");
  assert.ok(report.warnings.some((warning) => warning.includes("Agent conflict: .opencode/agents/YOLO.md")));
});

test("syncToOpenCode projects built-in OpenCode commands", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const doctorCommand = fs.readFileSync(path.join(projectRoot, ".opencode", "commands", "doctor.md"), "utf8");
  const bridgeCommand = fs.readFileSync(path.join(projectRoot, ".opencode", "commands", "bridge.md"), "utf8");
  const resourcesCommand = fs.readFileSync(path.join(projectRoot, ".opencode", "commands", "resources.md"), "utf8");

  assert.ok(report.projectedCommands.includes(".opencode/commands/bridge.md"));
  assert.ok(report.projectedCommands.includes(".opencode/commands/doctor.md"));
  assert.ok(report.projectedCommands.includes(".opencode/commands/sync.md"));
  assert.ok(report.projectedCommands.includes(".opencode/commands/update-extensions.md"));
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "commands", "study.md")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "commands", "automate.md")), false);
  assert.doesNotMatch(doctorCommand, /^agent:/m);
  assert.match(bridgeCommand, /ogb bridge/);
  assert.match(bridgeCommand, /Nao use glob/);
  assert.match(resourcesCommand, /MCPs ativos/);
});

test("syncToOpenCode removes old lowercase YOLO agent when it was managed by ogb", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const legacyYoloPath = path.join(projectRoot, ".opencode", "agents", "yolo.md");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  fs.renameSync(path.join(projectRoot, ".opencode", "agents", "YOLO.md"), legacyYoloPath);
  const statePath = path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const managed = state.managedFiles.find((file: { path: string; source: string }) => file.path === ".opencode/agents/YOLO.md" && file.source === "ogb");
  managed.path = ".opencode/agents/yolo.md";
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });

  const agentFiles = fs.readdirSync(path.join(projectRoot, ".opencode", "agents"));
  assert.equal(agentFiles.includes("yolo.md"), false);
  assert.equal(agentFiles.includes("YOLO.md"), true);
});

test("syncToOpenCode projects Gemini extension skills into OpenCode skills", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const skillDir = path.join(homeDir, ".gemini", "extensions", "study-pack", "skills", "review-notes");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "references", "guide.md"), "# Guide\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const projected = path.join(projectRoot, ".opencode", "skills", "review-notes");

  assert.ok(report.projectedSkills.includes(".opencode/skills/review-notes"));
  assert.equal(fs.existsSync(path.join(projected, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(projected, "references", "guide.md")), true);
});

test("syncToOpenCode projects Gemini extension TOML commands and maps risky resources", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const commandDir = path.join(extensionDir, "commands", "notes");
  fs.mkdirSync(commandDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "study-pack" }));
  fs.writeFileSync(path.join(extensionDir, ".gemini-extension-install.json"), JSON.stringify({
    source: "https://example.com/study-pack.git",
    type: "git",
    ref: "main",
    autoUpdate: true,
  }));
  fs.writeFileSync(path.join(commandDir, "review.toml"), `description = "Review notes from Gemini extension"\nprompt = """\nReview these notes: {{args}}\nUse ${"${extensionPath}"}${"${/}"}docs${"${/}"}guide.md\n"""\n`);
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "agents", "helper.md"), "# Helper\n");
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), "{}\n");
  fs.mkdirSync(path.join(extensionDir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "bin", "run.sh"), "#!/usr/bin/env bash\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const commandPath = path.join(projectRoot, ".opencode", "commands", "notes", "review.md");
  const command = fs.readFileSync(commandPath, "utf8");
  const agentPath = path.join(projectRoot, ".opencode", "agents", "helper.md");
  const agent = fs.readFileSync(agentPath, "utf8");
  const extensionMap = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), "utf8"));

  assert.ok(report.projectedExtensionCommands.includes(".opencode/commands/notes/review.md"));
  assert.ok(report.projectedExtensionAgents.includes(".opencode/agents/helper.md"));
  assert.match(command, /SOURCE_KIND: gemini-extension-command/);
  assert.match(command, /Review these notes: \$ARGUMENTS/);
  assert.match(command, new RegExp(path.join(extensionDir, "docs", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(agent, /SOURCE_KIND: gemini-extension-agent/);
  assert.match(agent, /mode: subagent/);
  assert.equal(extensionMap.extensions[0].agents[0].projected, true);
  assert.equal(extensionMap.extensions[0].agents[0].target, ".opencode/agents/helper.md");
  assert.equal(extensionMap.extensions[0].hooks[0].projected, false);
  assert.equal(extensionMap.extensions[0].scripts.some((script: { source: string }) => script.source === "bin/run.sh"), true);
});

test("syncToOpenCode projects configurable model fallbacks for extension subagents", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "study-pack" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "helper.md"), "---\nmodel: google/gemini-2.5-pro\ndescription: Helper.\n---\n# Helper\n");
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    modelFallbacks: {
      agents: {
        helper: {
          model: { id: "openai/gpt-5.5", variant: "xhigh" },
          temperature: 0.1,
          fallback_models: [
            { model: "openai/gpt-5.4-mini", variant: "medium", reason: "cheap fallback" },
            { model: "anthropic/claude-haiku-4-5", effort: "low", reason: "cheap fallback" },
          ],
        },
      },
    },
  }, null, 2) + "\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const agent = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "helper.md"), "utf8");
  const extensionMap = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), "utf8"));
  const routing = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-model-routing.json"), "utf8"));

  assert.equal(report.projectedModelFallbackConfig, undefined);
  assert.equal(report.projectedModelRoutingConfig, ".opencode/generated/ogb-model-routing.json");
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "oh-my-openagent.jsonc")), false);
  assert.match(agent, /model: "openai\/gpt-5\.5"/);
  assert.match(agent, /reasoningEffort: "xhigh"/);
  assert.match(agent, /temperature: 0\.1/);
  assert.match(agent, /fallback_models:/);
  assert.equal(routing.enabled, true);
  assert.equal(routing.decisions[0].agent, "helper");
  assert.equal(routing.decisions[0].selected.model, "openai/gpt-5.5");
  assert.equal(routing.decisions[0].selected.reasoningEffort, "xhigh");
  assert.equal(routing.decisions[0].chain.length, 3);
  assert.equal(extensionMap.modelFallbacks.length, 1);
  assert.equal(extensionMap.modelFallbacks[0].variant, "xhigh");
  assert.equal(extensionMap.modelFallbacks[0].reasoningEffort, "xhigh");
  assert.equal(extensionMap.extensions[0].agents[0].modelFallback.importedModel, "google/gemini-2.5-pro");
});

test("syncToOpenCode preserves the Medical Notes three-model fallback chain", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "med-chat-triager.md"), "---\ndescription: Triage chats.\n---\n# Med Chat Triager\n");
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    modelFallbacks: {
      agents: {
        "med-chat-triager": {
          model: { id: "google/gemini-3-flash-preview", variant: "high" },
          fallback_models: [
            { model: "openai/gpt-5.4-mini", variant: "medium" },
            { model: "anthropic/claude-haiku-4-5", effort: "high" },
          ],
        },
      },
    },
  }, null, 2) + "\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const agent = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "med-chat-triager.md"), "utf8");
  const extensionMap = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), "utf8"));
  const routing = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-model-routing.json"), "utf8"));

  assert.match(agent, /model: "google\/gemini-3-flash-preview"/);
  assert.match(agent, /reasoningEffort: "high"/);
  assert.equal(routing.decisions[0].agent, "med-chat-triager");
  assert.equal(routing.decisions[0].chain.length, 3);
  assert.deepEqual(routing.decisions[0].chain.map((item: { model: string }) => item.model), [
    "google/gemini-3-flash-preview",
    "openai/gpt-5.4-mini",
    "anthropic/claude-haiku-4-5",
  ]);
  assert.equal(extensionMap.modelFallbacks[0].extension, "medical-notes-workbench");
  assert.equal(extensionMap.modelFallbacks[0].agent, "med-chat-triager");
  assert.equal(extensionMap.modelFallbacks[0].fallback_models.length, 2);
});

test("syncToOpenCode routes extension subagent to fallback when primary provider is over threshold", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "study-pack" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "helper.md"), "---\ndescription: Helper.\n---\n# Helper\n");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-limits.json"), JSON.stringify({
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-04T12:00:00.000Z",
    status: "ok",
    providers: [
      {
        providerId: "openai",
        displayName: "OpenAI",
        fetchedAt: "2026-05-04T12:00:00.000Z",
        lines: [{ label: "Session", type: "progress", used: 99, limit: 100 }],
      },
      {
        providerId: "anthropic",
        displayName: "Claude",
        fetchedAt: "2026-05-04T12:00:00.000Z",
        lines: [{ label: "Session", type: "progress", used: 20, limit: 100 }],
      },
    ],
    sources: {
      openusage: { status: "ok", providerCount: 2 },
      geminiCodeAssist: { status: "skipped" },
    },
    warnings: [],
    files: { limits: path.join(projectRoot, ".opencode", "generated", "ogb-limits.json") },
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    modelFallbacks: {
      routing: { thresholdPercent: 95 },
      agents: {
        helper: {
          model: { id: "openai/gpt-5.5", variant: "high" },
          fallback_models: [
            { model: "anthropic/claude-haiku-4-5", effort: "high" },
            { model: "google/gemini-3-flash-preview", effort: "high" },
          ],
        },
      },
    },
  }, null, 2) + "\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const agent = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "helper.md"), "utf8");
  const routing = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-model-routing.json"), "utf8"));

  assert.match(agent, /model: "anthropic\/claude-haiku-4-5"/);
  assert.match(agent, /reasoningEffort: "high"/);
  assert.equal(routing.decisions[0].selected.model, "anthropic/claude-haiku-4-5");
  assert.equal(routing.decisions[0].selected.chainIndex, 1);
  assert.equal(routing.decisions[0].skipped[0].providerId, "openai");
});

test("syncToOpenCode projects Gemini extension MCPs into project config", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "gemini-md-export");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({
    name: "gemini-md-export",
    mcpServers: {
      "gemini-md-export": {
        command: "node",
        args: ["${extensionPath}${/}src${/}mcp-server.js"],
        env: {
          GEMINI_MCP_CHROME_LAUNCH_IF_CLOSED: "false",
          SECRET_TOKEN: "do-not-copy",
        },
      },
    },
  }));

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  const projectedMcp = projectConfig.mcp["gemini-md-export"];

  assert.deepEqual(projectedMcp.command, ["node", path.join(extensionDir, "src", "mcp-server.js")]);
  assert.deepEqual(projectedMcp.environment, {
    GEMINI_MCP_CHROME_LAUNCH_IF_CLOSED: "false",
  });
  assert.equal(JSON.stringify(projectConfig).includes("do-not-copy"), false);
});

test("syncToOpenCode can wire external quota UI and runtime fallback plugins", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "study-pack" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "helper.md"), "---\ndescription: Helper.\n---\n# Helper\n");
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    externalPlugins: {
      quotaUi: {
        enabled: true,
        suppressOgbLimits: true,
        enableToast: false,
      },
      autoFallback: {
        enabled: true,
        cooldownMs: 45_000,
        maxRetries: 1,
      },
    },
    modelFallbacks: {
      agents: {
        helper: {
          fallback_models: ["openai/gpt-5.4-mini"],
        },
      },
    },
  }, null, 2) + "\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  const tuiConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ...TUI_CONFIG_PATH.split("/")), "utf8"));
  const ui = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-ui.json"), "utf8"));
  const fallback = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode", "plugins", "fallback.json"), "utf8"));

  assert.deepEqual(projectConfig.plugin, ["opencode-auto-fallback", "@slkiser/opencode-quota"]);
  assert.deepEqual(tuiConfig.plugin, ["@slkiser/opencode-quota", TUI_SIDEBAR_PLUGIN_SPEC]);
  assert.equal(ui.quotaPanel, "external");
  assert.equal(fallback.enabled, true);
  assert.equal(fallback.cooldownMs, 45_000);
  assert.equal(fallback.maxRetries, 1);
  assert.deepEqual(fallback.agentFallbacks, { helper: ["openai/gpt-5.4-mini"] });
  assert.ok(report.projectedExternalPlugins.includes("opencode-auto-fallback"));
  assert.ok(report.projectedExternalPlugins.includes("@slkiser/opencode-quota"));
  assert.ok(report.projectedExternalIntegrationFiles.includes(".opencode/generated/ogb-ui.json"));
});
