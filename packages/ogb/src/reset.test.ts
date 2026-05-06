import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GLOBAL_AGENTS_MD } from "./global-agents.js";
import { runReset } from "./reset.js";
import { globalStartupPluginSpec } from "./setup-ux.js";
import { TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-reset-"));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("runReset refuses to run outside the home project", async () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  await assert.rejects(
    runReset({
      homeDir,
      projectRoot,
      yes: true,
      installOpenCode: false,
      installPlugins: false,
      installTuiDependencies: false,
    }),
    /so pode ser rodado no home/,
  );
});

test("runReset cancellation leaves home project artifacts and global config unchanged", async () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  fs.mkdirSync(homeDir, { recursive: true });
  writeFile(path.join(homeDir, "opencode.jsonc"), JSON.stringify({
    instructions: [".opencode/generated/GEMINI.expanded.md"],
  }, null, 2));
  writeFile(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    plugin: ["user-plugin@1.0.0"],
    custom: true,
  }, null, 2));

  const report = await runReset({
    homeDir,
    projectRoot: homeDir,
    confirm: async () => false,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });

  assert.equal(report.outcome, "cancelled");
  assert.equal(fs.existsSync(path.join(homeDir, "opencode.jsonc")), true);
  assert.equal(readJson(path.join(homeDir, ".config", "opencode", "opencode.json")).custom, true);
});

test("runReset cleans home project artifacts and recreates global config", async () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  fs.mkdirSync(homeDir, { recursive: true });
  writeFile(path.join(homeDir, ".gemini", "GEMINI.md"), "# Global Gemini\n\nUse global rules.\n");
  writeFile(path.join(homeDir, "opencode.jsonc"), JSON.stringify({
    instructions: [".opencode/generated/GEMINI.expanded.md"],
  }, null, 2));
  writeFile(path.join(homeDir, ".opencode", "commands", "sync.md"), "old project command\n");
  writeFile(path.join(homeDir, ".opencode", "generated", "ogb-startup-sync.lock"), JSON.stringify({
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
  }) + "\n");
  writeFile(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    plugin: ["user-plugin@1.0.0"],
    provider: {
      mine: { name: "Mine" },
    },
    instructions: ["/old/context.md"],
    custom: true,
  }, null, 2));
  writeFile(path.join(homeDir, ".config", "opencode", "AGENTS.md"), "User AGENTS\n");
  writeFile(path.join(homeDir, ".config", "opencode", "commands", "dev-server.md"), "old dev server command\n");
  writeFile(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-plugin-status.json"), JSON.stringify({
    state: "fail",
    exitCode: null,
  }) + "\n");
  writeFile(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-update-status.json"), JSON.stringify({
    status: "error",
  }) + "\n");
  writeFile(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-validation.json"), JSON.stringify({
    outcome: "fail",
  }) + "\n");
  writeFile(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-security.json"), JSON.stringify({
    outcome: "fail",
  }) + "\n");

  const report = await runReset({
    homeDir,
    projectRoot: homeDir,
    confirm: async () => true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });

  assert.equal(report.outcome, "pass");
  assert.equal(fs.existsSync(path.join(homeDir, "opencode.jsonc")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "commands", "sync.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated", "ogb-startup-sync.lock")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode")), false);
  assert.ok(report.cleanup.backupDir);
  assert.equal(fs.existsSync(path.join(report.cleanup.backupDir!, "opencode.jsonc")), true);

  const globalConfig = readJson(path.join(homeDir, ".config", "opencode", "opencode.json"));
  assert.equal(globalConfig.custom, undefined);
  assert.equal(globalConfig.provider, undefined);
  assert.equal(globalConfig.default_agent, "YOLO");
  assert.ok(globalConfig.plugin.includes(globalStartupPluginSpec(path.join(homeDir, ".config", "opencode", "plugins", "ogb-startup-sync.js"))));
  assert.equal(globalConfig.permission.websearch, "allow");
  assert.ok(globalConfig.instructions.includes(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md")));
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md")), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "plugins", "ogb-startup-sync.js")), true);
  assert.equal(fs.readFileSync(path.join(homeDir, ".config", "opencode", "AGENTS.md"), "utf8"), GLOBAL_AGENTS_MD);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "commands", "dev-server.md")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "tui-plugins", "ogb-sidebar.js")), true);
  assert.deepEqual(readJson(path.join(homeDir, ".config", "opencode", "tui.json")).plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-startup-sync.json")), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-plugin-status.json")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-update-status.json")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-validation.json")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "ogb-security.json")), false);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "plugins", "ogb-startup-sync.js")), false);
  assert.match(fs.readFileSync(path.join(homeDir, ".config", "zsh", ".zshrc"), "utf8"), /OPENCODE_ENABLE_EXA=1/);
  assert.equal(report.doctor?.warnings.some((warning) => warning.includes("Last OpenCode startup sync failed")), false);
});
