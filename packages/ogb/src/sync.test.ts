import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256Text } from "./file-hash.js";
import { mcpEnvStorePath, readMcpEnvValues } from "./mcp-env-store.js";
import { syncToOpenCode } from "./sync.js";
import { TUI_CONFIG_PATH, TUI_SIDEBAR_PLUGIN_PATH, TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";
import { OGB_VERSION } from "./types.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-sync-"));
}

function expectedGlobalExpandedInstruction(homeDir: string): string {
  return path.resolve(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md")).replace(/\\/g, "/");
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
  assert.equal(projectConfig.default_agent, "YOLO");
  assert.ok(report.projectedTuiFiles.includes(TUI_SIDEBAR_PLUGIN_PATH));
  assert.ok(report.projectedTuiFiles.includes(TUI_CONFIG_PATH));
  assert.equal(report.warnings.includes("Rulesync disabled"), false);
  assert.deepEqual(tuiConfig.plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
});

test("syncToOpenCode treats home as global OpenCode sync", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(homeDir, ".gemini", "agents"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".gemini", "commands", "notes"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".gemini", "skills", "study-notes"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extra.md"), "Imported global rules\n");
  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "Global rules\n@extra.md\n");
  fs.writeFileSync(path.join(homeDir, ".gemini", "agents", "helper.md"), "---\ndescription: Global helper\nmodel: \"openai/gpt-5.2\"\nmax_turns: 4\n---\nHelp globally.\n");
  fs.writeFileSync(path.join(homeDir, ".gemini", "commands", "review.md"), "---\ndescription: Review global notes\n---\nReview: {{args}}\n");
  fs.writeFileSync(path.join(homeDir, ".gemini", "commands", "notes", "plan.toml"), "description = \"Plan notes\"\nprompt = \"Plan: {{args}}\"\n");
  fs.writeFileSync(path.join(homeDir, ".gemini", "skills", "study-notes", "SKILL.md"), "---\nname: study-notes\ndescription: Study notes.\n---\n# Study\n");
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "commands", "notes"), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "skills", "review-notes"), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "study-pack" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "researcher.md"), "---\ndescription: Extension researcher\ntemperature: 0.2\n---\nResearch with extension context.\n");
  fs.writeFileSync(path.join(extensionDir, "commands", "notes", "review.toml"), `description = "Review extension notes"\nprompt = """\nUse ${"${extensionPath}"}${"${/}"}docs${"${/}"}guide.md with {{args}}\n"""\n`);
  fs.writeFileSync(path.join(extensionDir, "skills", "review-notes", "SKILL.md"), `---\nname: review-notes\ndescription: Review notes.\n---\nUse ${"${extensionPath}"}${"${/}"}docs${"${/}"}guide.md\n`);
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), "{}\n");
  fs.writeFileSync(path.join(extensionDir, "bin", "run.sh"), "#!/usr/bin/env bash\n");
  fs.mkdirSync(path.join(homeDir, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "AGENTS.md"), "Manual OpenCode global rules\n", "utf8");

  const report = syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const globalRoot = path.join(homeDir, ".config", "opencode");
  const expandedGemini = fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md"), "utf8");
  const globalConfig = JSON.parse(fs.readFileSync(path.join(globalRoot, "opencode.json"), "utf8"));
  const helperAgent = fs.readFileSync(path.join(globalRoot, "agents", "helper.md"), "utf8");
  const extensionAgent = fs.readFileSync(path.join(globalRoot, "agents", "researcher.md"), "utf8");
  const reviewCommand = fs.readFileSync(path.join(globalRoot, "commands", "review.md"), "utf8");
  const planCommand = fs.readFileSync(path.join(globalRoot, "commands", "notes", "plan.md"), "utf8");
  const extensionCommand = fs.readFileSync(path.join(globalRoot, "commands", "notes", "review.md"), "utf8");
  const extensionSkill = fs.readFileSync(path.join(globalRoot, "skills", "review-notes", "SKILL.md"), "utf8");
  const state = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-sync-state.json"), "utf8"));
  const extensionMap = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-extension-map.json"), "utf8"));
  const routing = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-model-routing.json"), "utf8"));

  assert.equal(report.rulesync.status, "skipped");
  assert.equal(report.warnings.length, 0);
  assert.ok(report.projectedAgents.includes(".config/opencode/agents/helper.md"));
  assert.ok(report.projectedExtensionAgents.includes(".config/opencode/agents/researcher.md"));
  assert.ok(report.projectedCommands.includes(".config/opencode/commands/review.md"));
  assert.ok(report.projectedCommands.includes(".config/opencode/commands/notes/plan.md"));
  assert.ok(report.projectedExtensionCommands.includes(".config/opencode/commands/notes/review.md"));
  assert.ok(report.projectedSkills.includes(".config/opencode/skills/study-notes"));
  assert.ok(report.projectedSkills.includes(".config/opencode/skills/review-notes"));
  assert.equal(fs.readFileSync(path.join(globalRoot, "AGENTS.md"), "utf8"), "Manual OpenCode global rules\n");
  assert.match(expandedGemini, /Imported global rules/);
  assert.ok(globalConfig.instructions.includes(expectedGlobalExpandedInstruction(homeDir)));
  assert.match(reviewCommand, /Review: \$ARGUMENTS/);
  assert.match(planCommand, /Plan: \$ARGUMENTS/);
  assert.match(extensionCommand, new RegExp(path.join(extensionDir, "docs", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(extensionSkill, new RegExp(path.join(extensionDir, "docs", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(state.managedFiles.some((file: { path: string }) => file.path === ".config/opencode/opencode.json"));
  assert.equal(state.managedFiles.some((file: { path: string }) => file.path === ".config/opencode/AGENTS.md"), false);
  assert.ok(state.managedFiles.some((file: { path: string }) => file.path === ".config/opencode-gemini-bridge/generated/GEMINI.expanded.md"));
  assert.ok(state.managedFiles.some((file: { path: string }) => file.path === ".config/opencode-gemini-bridge/generated/ogb-extension-map.json"));
  assert.equal(extensionMap._generated.version, OGB_VERSION);
  assert.equal(extensionMap.extensions[0].scope, "global");
  assert.equal(extensionMap.extensions[0].commands[0].target, ".config/opencode/commands/notes/review.md");
  assert.equal(extensionMap.extensions[0].agents[0].target, ".config/opencode/agents/researcher.md");
  assert.equal("modelFallback" in extensionMap.extensions[0].agents[0], false);
  assert.equal(extensionMap.modelFallbacks.length, 0);
  assert.equal(routing.decisions.length, 0);
  assert.equal(extensionMap.extensions[0].hooks[0].projected, true);
  assert.equal(extensionMap.extensions[0].hooks[0].target, "opencode-plugin:tool.execute.before,tool.execute.after");
  assert.equal(extensionMap.extensions[0].scripts.some((script: { source: string }) => script.source === "bin/run.sh"), true);
  assert.match(helperAgent, /mode: subagent/);
  assert.match(helperAgent, /read: allow/);
  assert.match(helperAgent, /edit: allow/);
  assert.match(helperAgent, /external_directory: allow/);
  assert.match(helperAgent, /bash: ask/);
  assert.match(helperAgent, /model: "openai\/gpt-5.2"/);
  assert.match(helperAgent, /maxSteps: 4/);
  assert.match(extensionAgent, /Extension researcher/);
  assert.match(extensionAgent, /read: allow/);
  assert.match(extensionAgent, /edit: allow/);
  assert.match(extensionAgent, /external_directory: allow/);
  assert.match(extensionAgent, /bash: allow/);
  assert.match(extensionAgent, /temperature: 0.2/);
  assert.equal(fs.existsSync(path.join(homeDir, "opencode.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "agents", "YOLO.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated", "opencode.generated.json")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "commands")), false);
});

test("syncToOpenCode normalizes bare Gemini model ids when projecting extension agents", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "gemini-vault-repair.md"), "---\ndescription: Repair vault.\nmodel: gemini-3-flash-preview\n---\n# Repair\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projectAgent = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "gemini-vault-repair.md"), "utf8");
  assert.match(projectAgent, /model: "google\/gemini-3-flash-preview"/);
  assert.doesNotMatch(projectAgent, /model: "gemini-3-flash-preview"/);

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const globalAgent = fs.readFileSync(path.join(homeDir, ".config", "opencode", "agents", "gemini-vault-repair.md"), "utf8");
  assert.match(globalAgent, /model: "google\/gemini-3-flash-preview"/);
  assert.doesNotMatch(globalAgent, /model: "gemini-3-flash-preview"/);
});

test("syncToOpenCode removes stale global extension agents when the Gemini source disappears", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  const agentsDir = path.join(extensionDir, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench" }));
  const sourceAgent = path.join(agentsDir, "med-catalog-curator.md");
  fs.writeFileSync(sourceAgent, "---\ndescription: Catalog.\n---\n# Catalog\n");

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const targetAgent = path.join(homeDir, ".config", "opencode", "agents", "med-catalog-curator.md");
  assert.equal(fs.existsSync(targetAgent), true);

  fs.rmSync(sourceAgent, { force: true });
  const report = syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });

  assert.equal(fs.existsSync(targetAgent), false);
  assert.ok(report.removedAgents.includes(".config/opencode/agents/med-catalog-curator.md"));
});

test("syncToOpenCode replaces stale absolute global instruction paths", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const configDir = path.join(homeDir, ".config", "opencode");
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "Global rules\n");
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    instructions: [
      "C:\\Users\\leona\\.config\\opencode-gemini-bridge\\generated\\GEMINI.expanded.md",
      "./manual.md",
    ],
  }, null, 2));

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });

  const globalConfig = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
  assert.deepEqual(globalConfig.instructions, [
    "./manual.md",
    expectedGlobalExpandedInstruction(homeDir),
  ]);
});

test("syncToOpenCode treats an accidentally quoted home project path as global sync", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(homeDir, ".gemini", "extensions", "study-pack"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extensions", "study-pack", "GEMINI.md"), "Extension rules\n");

  const report = syncToOpenCode({ projectRoot: `"${homeDir}"`, homeDir, rulesyncMode: "off", silent: true });
  const globalConfigPath = path.join(homeDir, ".config", "opencode", "opencode.json");

  assert.equal(report.projectRoot, path.resolve(homeDir));
  assert.equal(report.generatedConfigPath, path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md"));
  assert.match(report.rulesync.skippedReason ?? "", /home/);
  assert.equal(fs.existsSync(globalConfigPath), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated")), false);
});

test("syncToOpenCode builds global context from Gemini extensions and imports global MCPs", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "gemini-md-export");
  fs.mkdirSync(path.join(extensionDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "GEMINI.md"), `Extension rules live at ${"${extensionPath}"}${"${/}"}docs\n`);
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
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      "anki-mcp": {
        command: "uvx",
        args: ["anki-mcp"],
      },
    },
  }));
  fs.mkdirSync(path.join(homeDir, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "AGENTS.md"), "Manual OpenCode global rules\n", "utf8");

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });

  const globalRoot = path.join(homeDir, ".config", "opencode");
  const expandedGemini = fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md"), "utf8");
  const globalConfig = JSON.parse(fs.readFileSync(path.join(globalRoot, "opencode.json"), "utf8"));

  assert.match(expandedGemini, /Sources:/);
  assert.match(expandedGemini, /Extension rules live at/);
  assert.match(expandedGemini, new RegExp(path.join(extensionDir, "docs").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(expandedGemini, /Missing import: .*\.gemini\/GEMINI\.md/);
  assert.ok(globalConfig.instructions.includes(expectedGlobalExpandedInstruction(homeDir)));
  assert.deepEqual(globalConfig.mcp["anki-mcp"].command, ["uvx", "anki-mcp"]);
  assert.deepEqual(globalConfig.mcp["gemini-md-export"].command, ["node", path.join(extensionDir, "src", "mcp-server.js")]);
  assert.deepEqual(globalConfig.mcp["gemini-md-export"].environment, {
    GEMINI_MCP_CHROME_LAUNCH_IF_CLOSED: "false",
    SECRET_TOKEN: "{env:SECRET_TOKEN}",
  });
  assert.deepEqual(readMcpEnvValues({ homeDir }), {
    SECRET_TOKEN: "do-not-copy",
  });
  assert.equal(JSON.stringify(globalConfig).includes("do-not-copy"), false);
  assert.equal(fs.readFileSync(path.join(globalRoot, "AGENTS.md"), "utf8"), "Manual OpenCode global rules\n");
});

test("syncToOpenCode applies global OGB model fallbacks to home extension agents", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "med-chat-triager.md"), "---\ndescription: Triage chats.\n---\n# Med Chat Triager\n");
  fs.mkdirSync(path.join(homeDir, ".config", "opencode-gemini-bridge"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "ogb.config.jsonc"), JSON.stringify({
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

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });

  const globalRoot = path.join(homeDir, ".config", "opencode");
  const agent = fs.readFileSync(path.join(globalRoot, "agents", "med-chat-triager.md"), "utf8");
  const extensionMap = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-extension-map.json"), "utf8"));
  const routing = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-model-routing.json"), "utf8"));

  assert.match(agent, /model: "google\/gemini-3-flash-preview"/);
  assert.match(agent, /reasoningEffort: "high"/);
  assert.match(agent, /fallback_models:/);
  assert.match(agent, /model: "openai\/gpt-5\.4-mini"/);
  assert.equal(extensionMap.modelFallbacks.length, 1);
  assert.equal(extensionMap.modelFallbacks[0].agent, "med-chat-triager");
  assert.equal(extensionMap.modelFallbacks[0].fallback_models.length, 2);
  assert.equal(extensionMap.extensions[0].agents[0].modelFallback.source, "agent");
  assert.equal(routing.decisions[0].agent, "med-chat-triager");
  assert.equal(routing.decisions[0].chain.length, 3);
});

test("syncToOpenCode projects default OpenCode agent from OGB config", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    openCode: {
      defaultAgent: "YOLO",
    },
  }, null, 2) + "\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));

  assert.equal(projectConfig.default_agent, "YOLO");
});

test("syncToOpenCode projects built-in YOLO agent", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const yoloPath = path.join(projectRoot, ".opencode", "agents", "YOLO.md");
  const yolo = fs.readFileSync(yoloPath, "utf8");

  assert.ok(report.projectedAgents.includes(".opencode/agents/YOLO.md"));
  assert.ok(report.projectedAgents.includes(".opencode/agents/YOLO-worker.md"));
  assert.equal(report.projectedAgents.length, 2);
  assert.match(yolo, /description: Execucao direta com minima friccao em workspace confiavel\./);
  assert.doesNotMatch(yolo, /description: YOLO:/);
  assert.match(yolo, /mode: primary/);
  assert.match(yolo, /color: "#ffb4b4"/);
  assert.match(yolo, /edit: allow/);
  assert.match(yolo, /bash: allow/);
  assert.match(yolo, /task: allow/);
  assert.match(yolo, /external_directory: allow/);
  assert.match(yolo, /YOLO-worker/);
  const worker = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "YOLO-worker.md"), "utf8");
  assert.match(worker, /mode: subagent/);
  assert.match(worker, /bash: allow/);
  assert.match(worker, /external_directory: allow/);
});

test("syncToOpenCode preserves user-tuned YOLO task and external directory permissions", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const yoloPath = path.join(projectRoot, ".opencode", "agents", "YOLO.md");
  const customYolo = fs.readFileSync(yoloPath, "utf8")
    .replace("  task: allow", "  task: ask")
    .replace("  external_directory: allow", "  external_directory: ask");
  fs.writeFileSync(yoloPath, customYolo, "utf8");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const yolo = fs.readFileSync(yoloPath, "utf8");

  assert.equal(report.warnings.some((warning) => warning.includes(".opencode/agents/YOLO.md")), false);
  assert.match(yolo, /task: ask/);
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

test("syncToOpenCode force overwrites built-in files with central backup", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const yoloPath = path.join(projectRoot, ".opencode", "agents", "YOLO.md");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  fs.writeFileSync(yoloPath, "manual yolo\n", "utf8");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", force: true });
  const yoloBackup = report.backups.find((backup) => fs.existsSync(backup.backup) && fs.readFileSync(backup.backup, "utf8") === "manual yolo\n");

  assert.ok(yoloBackup);
  assert.ok(yoloBackup.backup.startsWith(path.join(homeDir, ".config", "opencode-gemini-bridge", "backups", "sync")));
  assert.equal(fs.readFileSync(yoloBackup.backup, "utf8"), "manual yolo\n");
  assert.notEqual(fs.readFileSync(yoloPath, "utf8"), "manual yolo\n");
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
  assert.match(bridgeCommand, /ogb check/);
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
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const skillDir = path.join(extensionDir, "skills", "review-notes");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: review-notes\ndescription: Review notes.\n---\n# Review\nRead ${"${extensionPath}"}${"${/}"}references${"${/}"}guide.md\n`);
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "references", "guide.md"), `# Guide\nBundle: ${"${extensionPath}"}\n`);

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const projected = path.join(projectRoot, ".opencode", "skills", "review-notes");
  const projectedSkill = fs.readFileSync(path.join(projected, "SKILL.md"), "utf8");
  const projectedGuide = fs.readFileSync(path.join(projected, "references", "guide.md"), "utf8");

  assert.ok(report.projectedSkills.includes(".opencode/skills/review-notes"));
  assert.equal(fs.existsSync(path.join(projected, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(projected, "references", "guide.md")), true);
  assert.match(projectedSkill, new RegExp(path.join(extensionDir, "references", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(projectedSkill, /\$\{extensionPath\}/);
  assert.match(projectedGuide, new RegExp(extensionDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("syncToOpenCode repairs a legacy global skills file blocking home-mode projection", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const skillDir = path.join(extensionDir, "skills", "review-notes");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");

  const globalSkillsRoot = path.join(homeDir, ".config", "opencode", "skills");
  fs.mkdirSync(path.dirname(globalSkillsRoot), { recursive: true });
  fs.writeFileSync(globalSkillsRoot, "legacy file blocking the managed skills directory\n", "utf8");

  const report = syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true, force: true });
  const projectedSkill = path.join(homeDir, ".config", "opencode", "skills", "review-notes", "SKILL.md");

  assert.ok(report.projectedSkills.includes(".config/opencode/skills/review-notes"));
  assert.equal(fs.readFileSync(projectedSkill, "utf8"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");
  assert.equal(report.warnings.some((warning) => warning.includes("Global extension skill projection failed")), false);
  assert.ok(report.backups.some((backup) => backup.source === globalSkillsRoot));
});

test("syncToOpenCode removes stale managed project extension skills", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const skillDir = path.join(extensionDir, "skills", "review-notes");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projected = path.join(projectRoot, ".opencode", "skills", "review-notes");
  assert.equal(fs.existsSync(path.join(projected, "SKILL.md")), true);

  fs.rmSync(skillDir, { recursive: true, force: true });
  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.ok(report.removedSkills.includes(".opencode/skills/review-notes"));
  assert.equal(fs.existsSync(projected), false);
  assert.equal(state.managedFiles.some((file: { path: string }) => file.path === ".opencode/skills/review-notes/SKILL.md"), false);
});

test("syncToOpenCode refreshes managed global extension skills instead of duplicating them in the project", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  const skillDir = path.join(extensionDir, "skills", "obsidian-ops");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench" }));
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: obsidian-ops\n---\n# New global skill\n", "utf8");

  const oldGlobalSkill = "---\nname: obsidian-ops\n---\n# Old global skill\n";
  const globalSkillPath = path.join(homeDir, ".config", "opencode", "skills", "obsidian-ops", "SKILL.md");
  fs.mkdirSync(path.dirname(globalSkillPath), { recursive: true });
  fs.writeFileSync(globalSkillPath, oldGlobalSkill, "utf8");
  const globalStatePath = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-sync-state.json");
  fs.mkdirSync(path.dirname(globalStatePath), { recursive: true });
  fs.writeFileSync(globalStatePath, JSON.stringify({
    version: OGB_VERSION,
    managedFiles: [{
      path: ".config/opencode/skills/obsidian-ops/SKILL.md",
      sha256: sha256Text(oldGlobalSkill),
      source: "ogb",
      kind: "skill",
      projection: "opencode",
      origin: skillDir,
    }],
  }, null, 2));

  const oldProjectSkill = "---\nname: obsidian-ops\n---\n# Old project skill\n";
  const projectSkillPath = path.join(projectRoot, ".opencode", "skills", "obsidian-ops", "SKILL.md");
  fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
  fs.writeFileSync(projectSkillPath, oldProjectSkill, "utf8");
  const projectStatePath = path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json");
  fs.mkdirSync(path.dirname(projectStatePath), { recursive: true });
  fs.writeFileSync(projectStatePath, JSON.stringify({
    version: OGB_VERSION,
    managedFiles: [{
      path: ".opencode/skills/obsidian-ops/SKILL.md",
      sha256: sha256Text(oldProjectSkill),
      source: "ogb",
      kind: "skill",
      projection: "opencode",
      origin: skillDir,
    }],
  }, null, 2));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });

  assert.equal(fs.readFileSync(globalSkillPath, "utf8"), "---\nname: obsidian-ops\n---\n# New global skill\n");
  assert.equal(fs.existsSync(projectSkillPath), false);
  assert.ok(report.removedSkills.includes(".opencode/skills/obsidian-ops"));
});

test("syncToOpenCode preserves stale project extension skills edited by hand", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const skillDir = path.join(extensionDir, "skills", "review-notes");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projected = path.join(projectRoot, ".opencode", "skills", "review-notes");
  fs.writeFileSync(path.join(projected, "SKILL.md"), "manual local edit\n", "utf8");
  fs.rmSync(skillDir, { recursive: true, force: true });

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });

  assert.equal(fs.readFileSync(path.join(projected, "SKILL.md"), "utf8"), "manual local edit\n");
  assert.ok(report.warnings.some((warning) => warning.includes("Skill conflict: .opencode/skills/review-notes was edited manually; leaving stale skill in place")));
});

test("syncToOpenCode preserves stale project extension skills when a copied reference was edited by hand", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const skillDir = path.join(extensionDir, "skills", "review-notes");
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");
  fs.writeFileSync(path.join(skillDir, "references", "guide.md"), "# Original guide\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projected = path.join(projectRoot, ".opencode", "skills", "review-notes");
  const guidePath = path.join(projected, "references", "guide.md");
  fs.writeFileSync(guidePath, "# Manual guide edit\n", "utf8");
  fs.rmSync(skillDir, { recursive: true, force: true });

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });

  assert.equal(fs.readFileSync(guidePath, "utf8"), "# Manual guide edit\n");
  assert.ok(report.warnings.some((warning) => warning.includes("Skill conflict: .opencode/skills/review-notes was edited manually; leaving stale skill in place")));
});

test("syncToOpenCode projects Gemini skills to global Antigravity skills", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const globalSkillDir = path.join(homeDir, ".gemini", "skills", "study-notes");
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const extensionSkillDir = path.join(extensionDir, "skills", "review-notes");
  fs.mkdirSync(globalSkillDir, { recursive: true });
  fs.mkdirSync(extensionSkillDir, { recursive: true });
  fs.writeFileSync(path.join(globalSkillDir, "SKILL.md"), "---\nname: study-notes\ndescription: Study notes.\n---\n# Study\n");
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), `---\nname: review-notes\ndescription: Review notes.\n---\n# Review\nUse ${"${extensionPath}"}${"${/}"}references${"${/}"}guide.md\n`);
  fs.mkdirSync(path.join(extensionSkillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(extensionSkillDir, "references", "guide.md"), `Bundle: ${"${extensionPath}"}\n`);

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const antigravityRoot = path.join(homeDir, ".gemini", "antigravity", "skills");
  const globalProjected = path.join(antigravityRoot, "study-notes", "SKILL.md");
  const extensionProjected = path.join(antigravityRoot, "review-notes", "SKILL.md");
  const extensionGuide = path.join(antigravityRoot, "review-notes", "references", "guide.md");
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.ok(report.projectedAntigravitySkills.includes(".gemini/antigravity/skills/study-notes"));
  assert.ok(report.projectedAntigravitySkills.includes(".gemini/antigravity/skills/review-notes"));
  assert.equal(fs.existsSync(globalProjected), true);
  assert.match(fs.readFileSync(extensionProjected, "utf8"), new RegExp(path.join(extensionDir, "references", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(fs.readFileSync(extensionGuide, "utf8"), new RegExp(extensionDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/skills/review-notes/SKILL.md"
    && file.kind === "skill"
    && file.projection === "antigravity"
  ));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/skills/review-notes/references/guide.md"
    && file.kind === "skill"
    && file.projection === "antigravity"
  ));
});

test("syncToOpenCode skips Antigravity skills blocked by Windows untrusted mounts", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const sourceSkillDir = path.join(homeDir, ".gemini", "skills", "defuddle");
  const projectedSkillDir = path.join(homeDir, ".gemini", "antigravity", "skills", "defuddle");
  const originalReaddirSync = fs.readdirSync;
  fs.mkdirSync(sourceSkillDir, { recursive: true });
  fs.mkdirSync(projectedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(sourceSkillDir, "SKILL.md"), "---\nname: defuddle\ndescription: Defuddle.\n---\n# Defuddle\n");
  fs.writeFileSync(path.join(projectedSkillDir, "SKILL.md"), "---\nname: defuddle\ndescription: Existing.\n---\n# Existing\n");
  try {
    (fs.readdirSync as typeof fs.readdirSync) = ((target: fs.PathLike, options?: unknown) => {
      if (path.resolve(String(target)) === path.resolve(projectedSkillDir)) {
        throw new Error("Unknown error: The path cannot be traversed because it contains an untrusted mount point.");
      }
      return originalReaddirSync(target, options as never);
    }) as typeof fs.readdirSync;

    const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });

    assert.equal(
      report.warnings.some((warning) => warning.includes("Antigravity skill projection failed: defuddle")),
      false,
    );
    assert.ok(report.notes.some((note) =>
      note.includes("Antigravity skill skipped: defuddle")
      && note.includes("untrusted mount point")
    ));
    assert.equal(fs.readFileSync(path.join(projectedSkillDir, "SKILL.md"), "utf8"), "---\nname: defuddle\ndescription: Existing.\n---\n# Existing\n");
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
});

test("syncToOpenCode adopts identical unmanaged Antigravity skill projections", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const extensionSkillDir = path.join(extensionDir, "skills", "review-notes");
  const projectedSkillDir = path.join(homeDir, ".gemini", "antigravity", "skills", "review-notes");
  fs.mkdirSync(path.join(extensionSkillDir, "references"), { recursive: true });
  fs.mkdirSync(path.join(projectedSkillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), `---\nname: review-notes\ndescription: Review notes.\n---\n# Review\nUse ${"${extensionPath}"}${"${/}"}references${"${/}"}guide.md\n`);
  fs.writeFileSync(path.join(extensionSkillDir, "references", "guide.md"), `Bundle: ${"${extensionPath}"}\n`);
  fs.writeFileSync(path.join(projectedSkillDir, "SKILL.md"), `---\nname: review-notes\ndescription: Review notes.\n---\n# Review\nUse ${path.join(extensionDir, "references", "guide.md")}\n`);
  fs.writeFileSync(path.join(projectedSkillDir, "references", "guide.md"), `Bundle: ${extensionDir}\n`);

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.equal(
    report.warnings.some((warning) => warning.includes(".gemini/antigravity/skills/review-notes exists and is not managed")),
    false,
  );
  assert.ok(report.projectedAntigravitySkills.includes(".gemini/antigravity/skills/review-notes"));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/skills/review-notes/SKILL.md"
    && file.kind === "skill"
    && file.projection === "antigravity"
  ));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/skills/review-notes/references/guide.md"
    && file.kind === "skill"
    && file.projection === "antigravity"
  ));
});

test("syncToOpenCode refreshes stale Antigravity skill state when target already matches source", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const extensionSkillDir = path.join(extensionDir, "skills", "review-notes");
  const projectedSkillDir = path.join(homeDir, ".gemini", "antigravity", "skills", "review-notes");
  const projectedSkillText = "---\nname: review-notes\ndescription: Updated review notes.\n---\n# Updated Review\n";
  fs.mkdirSync(extensionSkillDir, { recursive: true });
  fs.mkdirSync(projectedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), projectedSkillText);
  fs.writeFileSync(path.join(projectedSkillDir, "SKILL.md"), projectedSkillText);
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), JSON.stringify({
    version: "0.1.25",
    managedFiles: [
      {
        path: ".gemini/antigravity/skills/review-notes/SKILL.md",
        sha256: sha256Text("---\nname: review-notes\ndescription: Old review notes.\n---\n# Old Review\n"),
        source: "ogb",
        kind: "skill",
        projection: "antigravity",
        origin: extensionSkillDir,
      },
    ],
  }, null, 2));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));
  const managed = state.managedFiles.find((file: { path: string; source: string }) =>
    file.path === ".gemini/antigravity/skills/review-notes/SKILL.md"
    && file.source === "ogb"
  );

  assert.equal(
    report.warnings.some((warning) => warning.includes(".gemini/antigravity/skills/review-notes was edited manually")),
    false,
  );
  assert.ok(report.projectedAntigravitySkills.includes(".gemini/antigravity/skills/review-notes"));
  assert.equal(managed.sha256, sha256Text(projectedSkillText));
});

test("syncToOpenCode preserves different unmanaged Antigravity skill projections", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const extensionSkillDir = path.join(extensionDir, "skills", "review-notes");
  const projectedSkillDir = path.join(homeDir, ".gemini", "antigravity", "skills", "review-notes");
  fs.mkdirSync(extensionSkillDir, { recursive: true });
  fs.mkdirSync(projectedSkillDir, { recursive: true });
  fs.writeFileSync(path.join(extensionSkillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Review notes.\n---\n# Review\n");
  fs.writeFileSync(path.join(projectedSkillDir, "SKILL.md"), "---\nname: review-notes\ndescription: Manual edit.\n---\n# Manual\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.ok(report.warnings.some((warning) => warning.includes(".gemini/antigravity/skills/review-notes exists and is not managed")));
  assert.equal(report.projectedAntigravitySkills.includes(".gemini/antigravity/skills/review-notes"), false);
  assert.equal(fs.readFileSync(path.join(projectedSkillDir, "SKILL.md"), "utf8"), "---\nname: review-notes\ndescription: Manual edit.\n---\n# Manual\n");
  assert.equal(state.managedFiles.some((file: { path: string }) => file.path.startsWith(".gemini/antigravity/skills/review-notes/")), false);
});

test("syncToOpenCode projects global Gemini MCPs to Antigravity mcp_config", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      "anki-mcp": {
        command: "uvx",
        args: ["anki-mcp"],
      },
    },
  }));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({
    name: "study-pack",
    mcpServers: {
      "study-pack": {
        command: "node",
        args: ["${extensionPath}${/}src${/}mcp-server.js"],
        env: {
          STUDY_HOME: "${extensionPath}",
        },
      },
    },
  }));
  fs.mkdirSync(path.join(homeDir, ".gemini", "antigravity"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "antigravity", "mcp_config.json"), JSON.stringify({
    mcpServers: {
      manual: {
        command: "node",
        args: ["manual.js"],
      },
    },
  }, null, 2) + "\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const config = JSON.parse(fs.readFileSync(path.join(homeDir, ".gemini", "antigravity", "mcp_config.json"), "utf8"));
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.ok(report.projectedAntigravityMcps.includes(".gemini/antigravity/mcp_config.json#mcpServers/anki-mcp"));
  assert.ok(report.projectedAntigravityMcps.includes(".gemini/antigravity/mcp_config.json#mcpServers/study-pack"));
  assert.deepEqual(config.mcpServers.manual, { command: "node", args: ["manual.js"] });
  assert.deepEqual(config.mcpServers["anki-mcp"], { command: "uvx", args: ["anki-mcp"] });
  assert.deepEqual(config.mcpServers["study-pack"], {
    command: "node",
    args: [path.join(extensionDir, "src", "mcp-server.js")],
    env: {
      STUDY_HOME: extensionDir,
    },
  });
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/mcp_config.json#mcpServers/study-pack"
    && file.kind === "mcp"
    && file.projection === "antigravity"
  ));
});

test("syncToOpenCode preserves Antigravity MCPs edited by hand", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      "anki-mcp": {
        command: "uvx",
        args: ["anki-mcp"],
      },
    },
  }));

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const configPath = path.join(homeDir, ".gemini", "antigravity", "mcp_config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.mcpServers["anki-mcp"].args = ["manual-anki"];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.rmSync(path.join(homeDir, ".gemini", "settings.json"), { force: true });

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const after = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.deepEqual(after.mcpServers["anki-mcp"], { command: "uvx", args: ["manual-anki"] });
  assert.ok(report.warnings.some((warning) => warning.includes("Antigravity MCP conflict: .gemini/antigravity/mcp_config.json#mcpServers/anki-mcp was edited manually; leaving stale server in place")));
});

test("syncToOpenCode projects Gemini extension subagents to native Antigravity agents", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const agentsDir = path.join(extensionDir, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, "researcher.md"), `---\ndescription: Research notes.\n---\n# Researcher\nUse ${"${extensionPath}"}${"${/}"}docs${"${/}"}guide.md\n`);

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const agentPath = path.join(homeDir, ".gemini", "antigravity", "agents", "researcher");
  const promptPath = path.join(homeDir, ".gemini", "antigravity", "agent_prompts", "researcher.md");
  const agent = JSON.parse(fs.readFileSync(agentPath, "utf8"));
  const prompt = fs.readFileSync(promptPath, "utf8");
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.ok(report.projectedAntigravityAgents.includes(".gemini/antigravity/agents/researcher"));
  assert.equal(fs.existsSync(path.join(homeDir, ".gemini", "antigravity", "skills", "agent-researcher")), false);
  assert.deepEqual(agent, {
    name: "researcher",
    description: "Research notes.",
    command_spec: {
      command: "/bin/cat",
      args: [promptPath],
    },
  });
  assert.match(prompt, /SOURCE_KIND: gemini-antigravity-agent/);
  assert.match(prompt, /# Researcher/);
  assert.match(prompt, new RegExp(path.join(extensionDir, "docs", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/agents/researcher"
    && file.kind === "agent"
    && file.projection === "antigravity"
  ));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/agent_prompts/researcher.md"
    && file.kind === "agent"
    && file.projection === "antigravity"
  ));
});

test("syncToOpenCode migrates old Antigravity agent compatibility skills to native agents", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const agentsDir = path.join(extensionDir, "agents");
  const oldSkillDir = path.join(homeDir, ".gemini", "antigravity", "skills", "agent-researcher");
  const statePath = path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json");
  const oldSkill = "---\nname: agent-researcher\n---\n# old compatibility skill\n";
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(oldSkillDir, { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(path.join(agentsDir, "researcher.md"), "---\ndescription: Research notes.\n---\n# Researcher\n");
  fs.writeFileSync(path.join(oldSkillDir, "SKILL.md"), oldSkill, "utf8");
  fs.writeFileSync(statePath, JSON.stringify({
    version: OGB_VERSION,
    managedFiles: [
      {
        path: ".gemini/antigravity/skills/agent-researcher/SKILL.md",
        sha256: sha256Text(oldSkill),
        source: "ogb",
        kind: "agent",
        projection: "antigravity",
      },
    ],
  }, null, 2) + "\n");

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });

  assert.ok(report.projectedAntigravityAgents.includes(".gemini/antigravity/agents/researcher"));
  assert.ok(report.removedAntigravityAgents.includes(".gemini/antigravity/skills/agent-researcher"));
  assert.equal(fs.existsSync(oldSkillDir), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".gemini", "antigravity", "agents", "researcher")), true);
});

test("syncToOpenCode projects Gemini extension workflows to global Antigravity workflows", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  const workflowsDir = path.join(extensionDir, ".agent", "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, "verify-skills.md"), `# Verify skills\nUse ${"${extensionPath}"}${"${/}"}docs${"${/}"}guide.md\n`);

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projected = path.join(homeDir, ".gemini", "antigravity", "global_workflows", "verify-skills.md");
  const workflow = fs.readFileSync(projected, "utf8");
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-sync-state.json"), "utf8"));

  assert.ok(report.projectedAntigravityWorkflows.includes(".gemini/antigravity/global_workflows/verify-skills.md"));
  assert.match(workflow, /# Verify skills/);
  assert.match(workflow, new RegExp(path.join(extensionDir, "docs", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(state.managedFiles.some((file: { path: string; kind?: string; projection?: string }) =>
    file.path === ".gemini/antigravity/global_workflows/verify-skills.md"
    && file.kind === "workflow"
    && file.projection === "antigravity"
  ));
});

test("syncToOpenCode resolves extension placeholders in expanded Gemini context", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "GEMINI.md"), `Use ${"${extensionPath}"}${"${/}"}docs${"${/}"}guide.md\n`);

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });
  const expanded = fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "GEMINI.expanded.md"), "utf8");

  assert.match(expanded, new RegExp(path.join(extensionDir, "docs", "guide.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(expanded, /\$\{extensionPath\}/);
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
  assert.match(agent, /read: allow/);
  assert.match(agent, /edit: allow/);
  assert.match(agent, /external_directory: allow/);
  assert.match(agent, /bash: allow/);
  assert.equal(extensionMap.extensions[0].agents[0].projected, true);
  assert.equal(extensionMap.extensions[0].agents[0].target, ".opencode/agents/helper.md");
  assert.equal(extensionMap.extensions[0].hooks[0].projected, true);
  assert.equal(extensionMap.extensions[0].hooks[0].target, "opencode-plugin:tool.execute.before,tool.execute.after");
  assert.equal(extensionMap.extensions[0].scripts.some((script: { source: string }) => script.source === "bin/run.sh"), true);
});

test("syncToOpenCode keeps extension subagent bash conservative when YOLO is not the default agent", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    openCode: {
      defaultAgent: "agent",
    },
  }, null, 2));
  fs.mkdirSync(path.join(extensionDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({ name: "study-pack" }));
  fs.writeFileSync(path.join(extensionDir, "agents", "helper.md"), "# Helper\n");

  syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off" });

  const agent = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "helper.md"), "utf8");
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  assert.equal(projectConfig.default_agent, "agent");
  assert.match(agent, /mode: subagent/);
  assert.match(agent, /bash: ask/);
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
    SECRET_TOKEN: "{env:SECRET_TOKEN}",
  });
  assert.equal(JSON.stringify(projectConfig).includes("do-not-copy"), false);
  assert.deepEqual(readMcpEnvValues({ homeDir }), {
    SECRET_TOKEN: "do-not-copy",
  });
});

test("syncToOpenCode projects local Notion MCP env references without parsing JSON env strings", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      notion: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
          OPENAPI_MCP_HEADERS: "$OPENAPI_MCP_HEADERS",
        },
      },
    },
  }));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));

  assert.deepEqual(projectConfig.mcp.notion, {
    type: "local",
    command: ["npx", "-y", "@notionhq/notion-mcp-server"],
    enabled: true,
    environment: {
      OPENAPI_MCP_HEADERS: "{env:OPENAPI_MCP_HEADERS}",
    },
  });
  assert.deepEqual(report.warnings.filter((warning) => warning.includes("OPENAPI_MCP_HEADERS")), []);
});

test("syncToOpenCode stores sensitive local MCP env literals and projects env references", () => {
  const projectRoot = tempProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  const fakeNotionToken = "ntn_" + "a".repeat(32);
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      notion: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
          OPENAPI_MCP_HEADERS: `{"Authorization":"Bearer ${fakeNotionToken}","Notion-Version":"2022-06-28"}`,
        },
      },
    },
  }));

  const report = syncToOpenCode({ projectRoot, homeDir, rulesyncMode: "off", silent: true });
  const projectConfigText = fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8");
  const projectConfig = JSON.parse(projectConfigText);

  assert.equal(projectConfigText.includes(fakeNotionToken), false);
  assert.equal(JSON.stringify(report).includes(fakeNotionToken), false);
  assert.deepEqual(projectConfig.mcp.notion.environment, {
    OPENAPI_MCP_HEADERS: "{env:OPENAPI_MCP_HEADERS}",
  });
  assert.deepEqual(report.warnings.filter((warning) => warning.includes("OPENAPI_MCP_HEADERS")), []);
  assert.deepEqual(readMcpEnvValues({ homeDir }), {
    OPENAPI_MCP_HEADERS: `{"Authorization":"Bearer ${fakeNotionToken}","Notion-Version":"2022-06-28"}`,
  });
  const storeStat = fs.statSync(mcpEnvStorePath({ homeDir }));
  if (process.platform !== "win32") assert.equal(storeStat.mode & 0o777, 0o600);
});

test("syncToOpenCode repairs global OpenCode MCP entries written with Gemini shape", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      notion: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
          OPENAPI_MCP_HEADERS: "$OPENAPI_MCP_HEADERS",
        },
      },
    },
  }));
  fs.mkdirSync(path.join(homeDir, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    mcp: {
      notion: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
          OPENAPI_MCP_HEADERS: "$OPENAPI_MCP_HEADERS",
        },
        enabled: true,
      },
    },
  }, null, 2));

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const globalConfig = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode", "opencode.json"), "utf8"));

  assert.deepEqual(globalConfig.mcp.notion, {
    type: "local",
    command: ["npx", "-y", "@notionhq/notion-mcp-server"],
    enabled: true,
    environment: {
      OPENAPI_MCP_HEADERS: "{env:OPENAPI_MCP_HEADERS}",
    },
  });
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
