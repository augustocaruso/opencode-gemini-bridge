import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.js";
import { syncToOpenCode } from "./sync.js";
import { TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-doctor-"));
}

test("runDoctor prints one warning line for duplicate skill names", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  for (const root of [path.join(projectRoot, ".opencode", "skills", "gemini-importer"), path.join(projectRoot, ".opencode", "skill", "gemini-importer")]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: gemini-importer\n---\n", "utf8");
  }

  const report = runDoctor({ projectRoot, homeDir, silent: true });
  const duplicateWarnings = report.warnings.filter((warning) => warning.startsWith("Skill warning: gemini-importer - Duplicate name"));

  assert.equal(report.counts.skills.warning, 2);
  assert.equal(duplicateWarnings.length, 1);
  assert.match(duplicateWarnings[0], /\.opencode\/skills\/gemini-importer/);
  assert.match(duplicateWarnings[0], /\.opencode\/skill\/gemini-importer/);
});

test("runDoctor matches OpenCode plugins by package name across versions", () => {
  const projectRoot = tempRoot();
  const homeDir = tempRoot();
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), JSON.stringify({
    externalPlugins: {
      autoFallback: {
        enabled: true,
        plugin: "opencode-auto-fallback@0.4.2",
      },
    },
  }, null, 2), "utf8");
  fs.mkdirSync(path.join(homeDir, ".config", "opencode", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    plugin: ["opencode-auto-fallback@0.4.3"],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "plugins", "fallback.json"), JSON.stringify({
    enabled: true,
    agentFallbacks: {
      helper: ["openai/gpt-5.4-mini"],
    },
  }), "utf8");

  const report = runDoctor({ projectRoot, homeDir, silent: true });

  assert.equal(report.runtimeFallback.pluginActive, true);
  assert.equal(report.warnings.some((warning) => /opencode-auto-fallback.*plugin is not active/i.test(warning)), false);
});

test("runDoctor checks global OpenCode instructions when project root is home", () => {
  const homeDir = tempRoot();
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "Global rules\n", "utf8");

  const before = runDoctor({ projectRoot: homeDir, homeDir, silent: true });
  assert.ok(before.warnings.some((warning) => warning.includes("Missing global expanded Gemini context")));

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  const after = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(after.opencodeConfig.path, path.join(homeDir, ".config", "opencode", "opencode.json"));
  assert.equal(after.opencodeConfig.referencesExpandedGemini, true);
  assert.equal(after.warnings.some((warning) => warning.includes("Global OpenCode config does not reference")), false);
  assert.equal(after.warnings.some((warning) => warning.includes("Missing global expanded Gemini context")), false);
});

test("runDoctor recovers stale global startup sync status when project root is home", () => {
  const homeDir = tempRoot();
  const generatedDir = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "ogb-plugin-status.json"), JSON.stringify({
    version: 1,
    state: "running",
    reason: "plugin.init",
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
    command: "ogb",
    args: ["--project", homeDir, "sync"],
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(generatedDir, "ogb-startup-sync.lock"), JSON.stringify({
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
  }) + "\n", "utf8");

  runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  const status = JSON.parse(fs.readFileSync(path.join(generatedDir, "ogb-plugin-status.json"), "utf8"));
  assert.equal(status.state, "pass");
  assert.equal(status.reason, "doctor.recovered-stale");
  assert.equal(fs.existsSync(path.join(generatedDir, "ogb-startup-sync.lock")), false);
});

test("runDoctor warns when global TUI plugin runtime dependencies are missing", () => {
  const homeDir = tempRoot();
  const configDir = path.join(homeDir, ".config", "opencode");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "tui.json"), JSON.stringify({
    plugin: [TUI_SIDEBAR_PLUGIN_SPEC],
  }, null, 2), "utf8");

  const report = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(report.warnings.some((warning) =>
    warning.includes("Global OGB TUI runtime dependencies are missing")
    && warning.includes("@opentui/solid@0.2.2")
    && warning.includes("solid-js@1.9.12")
  ), true);
});
