import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";
import { OGB_UX_PLUGINS, setupUx } from "./setup-ux.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-ux-"));
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

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
  assert.deepEqual(globalConfig.plugin, OGB_UX_PLUGINS);
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
  assert.match(yolo, /external_directory: ask/);

  const fallback = readJson(path.join(configDir, "plugins", "fallback.json"));
  assert.equal(fallback.enabled, false);
  assert.equal(fallback.cooldownMs, 60_000);
  assert.equal(fallback.maxRetries, 2);
  assert.equal(fallback.agentFallbacks["med-chat-triager"][0].model, "openai/gpt-5.4-mini");
  assert.equal(fallback.agentFallbacks["med-chat-triager"][0].reasoningEffort, "medium");

  const projectConfig = parseJsonc(fs.readFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), "utf8"));
  assert.equal(projectConfig.openCode.defaultAgent, "YOLO");
  assert.equal(projectConfig.externalPlugins.autoFallback.installProjectPlugin, false);
  assert.equal(projectConfig.modelFallbacks.agents["med-knowledge-architect"].model.variant, "high");
  assert.equal(projectConfig.modelFallbacks.agents["med-chat-triager"].model.variant, "high");

  assert.equal(fs.existsSync(path.join(configDir, "commands", "research.md")), true);
  assert.equal(fs.existsSync(path.join(configDir, "commands", "dev-server.md")), true);
  assert.equal(fs.existsSync(path.join(configDir, "commands", "upgrade-ogb.md")), true);
  assert.match(fs.readFileSync(path.join(configDir, "commands", "upgrade-ogb.md"), "utf8"), /ogb self-update --project/);
  assert.equal(fs.existsSync(path.join(configDir, "dcp.jsonc")), true);
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
      ...OGB_UX_PLUGINS,
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
  assert.deepEqual(globalConfig.plugin, OGB_UX_PLUGINS);
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
