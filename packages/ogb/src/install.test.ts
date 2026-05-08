import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInstall } from "./install.js";
import { enableMaintainerRole } from "./local-role.js";
import type { RitualProgressEvent } from "./ritual-progress.js";
import { globalStartupPluginSpec, OGB_UX_SAFE_PLUGINS } from "./setup-ux.js";
import { readStateRecord } from "./state-store.js";
import { TUI_SIDEBAR_PLUGIN_SOURCE } from "./tui-sidebar.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-install-"));
}

test("runInstall previews setup without running the final check", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  const report = runInstall({
    projectRoot,
    homeDir,
    dryRun: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });

  assert.equal(report.outcome, "preview");
  assert.equal(report.projectRoot, projectRoot);
  assert.equal(report.homeMode, false);
  assert.equal(report.plan.intent, "install");
  assert.deepEqual(report.plan.steps.map((step) => step.id), ["cleanup-home-artifacts", "apply-global-ux-profile", "run-check"]);
  assert.equal(report.check, undefined);
  assert.ok(report.setup.writes.some((write) => write.status === "preview"));
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc")), false);
});

test("runInstall emits top-level ritual progress", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const events: RitualProgressEvent[] = [];
  fs.mkdirSync(projectRoot, { recursive: true });

  runInstall({
    projectRoot,
    homeDir,
    dryRun: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual([...new Set(events.map((event) => event.stepId))], [
    "cleanup",
    "profile",
    "opencode",
    "plugins",
    "project-profile",
    "check",
  ]);
  assert.equal(events.find((event) => event.stepId === "check")?.status, "skipped");
});

test("runInstall repairs stale global TUI sidebar and reports restart notice", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const pluginPath = path.join(homeDir, ".config", "opencode", "tui-plugins", "ogb-sidebar.js");
  const events: RitualProgressEvent[] = [];
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(pluginPath, "old sidebar plugin\n", "utf8");

  const report = runInstall({
    projectRoot,
    homeDir,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
    check: false,
    onProgress: (event) => events.push(event),
  });

  assert.equal(fs.readFileSync(pluginPath, "utf8"), TUI_SIDEBAR_PLUGIN_SOURCE);
  assert.equal(report.setup?.notices.includes("Global TUI sidebar updated; restart OpenCode to load it."), true);
  assert.equal(events.some((event) =>
    event.stepId === "profile"
    && event.message?.includes("Global TUI sidebar updated; restart OpenCode to load it.")
  ), true);
});

test("runInstall keeps progress messages compact when OpenCode plugin commands are noisy", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const opencodePath = path.join(homeDir, ".opencode", "bin", "opencode");
  const startupPluginPath = path.join(homeDir, ".config", "opencode", "plugins", "ogb-startup-sync.js");
  const expectedPlugins = [
    ...OGB_UX_SAFE_PLUGINS,
    globalStartupPluginSpec(startupPluginPath),
  ];
  const events: RitualProgressEvent[] = [];
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(path.dirname(opencodePath), { recursive: true });
  fs.writeFileSync(opencodePath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"plugin\" ]; then",
    "  echo 'Plugin package ready'",
    "  echo 'Detected server target'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"debug\" ]; then",
    ...expectedPlugins.map((plugin) => `  echo '- ${plugin.replace(/'/g, "'\\''")}'`),
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"--print-logs\" ]; then",
    "  echo 'Available: ChatGPT Pro/Plus, OAuth with Google (Gemini CLI)'",
    "  exit 0",
    "fi",
    "exit 0",
    "",
  ].join("\n"), "utf8");
  fs.chmodSync(opencodePath, 0o755);

  const report = runInstall({
    projectRoot,
    homeDir,
    env: { ...process.env, PATH: `${path.dirname(opencodePath)}${path.delimiter}${process.env.PATH ?? ""}` },
    installTuiDependencies: false,
    check: false,
    onProgress: (event) => events.push(event),
  });

  const opencodeEvent = events.find((event) => event.stepId === "opencode" && event.status !== "running");
  const profileEvent = events.find((event) => event.stepId === "profile" && event.status !== "running");
  const pluginsEvent = events.find((event) => event.stepId === "plugins" && event.status !== "running");
  assert.equal(report.setup?.warnings.length, 0);
  assert.equal(profileEvent?.status, "pass");
  assert.equal(opencodeEvent?.status, "pass");
  assert.equal(opencodeEvent?.message, "OpenCode already available.");
  assert.equal(opencodeEvent?.message?.includes("Plugin package ready"), false);
  assert.equal(pluginsEvent?.message?.includes("Plugin package ready"), false);
});

test("runInstall applies the current install flow and finishes with check", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "# Project Gemini\n", "utf8");

  const report = runInstall({
    projectRoot,
    homeDir,
    force: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });

  assert.notEqual(report.outcome, "fail");
  assert.equal(report.plan.delegation.command, "ogb");
  assert.ok(report.check);
  assert.ok(report.check.automated.includes("setup-opencode"));
  assert.ok(report.check.automated.includes("sync"));
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc")), true);
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "commands", "bridge.md")), true);
  const state = readStateRecord("install", { projectRoot, homeDir });
  assert.equal(state.exists, true);
  assert.equal(state.data?.outcome, report.outcome);
});

test("runInstall respects maintainer protection even with force", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const globalAgentsPath = path.join(homeDir, ".config", "opencode", "AGENTS.md");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(path.dirname(globalAgentsPath), { recursive: true });
  fs.writeFileSync(globalAgentsPath, "Maintainer AGENTS\n", "utf8");
  enableMaintainerRole({ homeDir });

  const report = runInstall({
    projectRoot,
    homeDir,
    force: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
    check: false,
  });

  assert.equal(fs.readFileSync(globalAgentsPath, "utf8"), "Maintainer AGENTS\n");
  assert.equal(report.setup?.writes.some((write) => write.path === globalAgentsPath && write.status === "protected"), true);
  assert.equal(report.setup?.writes.some((write) => Boolean(write.backup)), false);
  assert.equal(report.warnings.some((warning) => warning.includes("modo mantenedor local")), true);
});
