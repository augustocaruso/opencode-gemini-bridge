import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.js";
import { buildInstallerPlan } from "./installer-planner.js";
import { formatPassReport, runPass, type PassReport } from "./pass.js";
import type { OgbPatch } from "./patches.js";
import type { RitualProgressEvent } from "./ritual-progress.js";
import { STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";
import { globalStartupPluginSpec } from "./setup-ux.js";
import { syncToOpenCode } from "./sync.js";
import { TUI_SIDEBAR_PLUGIN_SOURCE, TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-pass-"));
}

function writeFakeGemini(root: string, content: string): string {
  const filePath = path.join(root, "fake-gemini.js");
  fs.writeFileSync(filePath, `#!/usr/bin/env node\n${content}`, "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function writeHookSettings(projectRoot: string): void {
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{ command: "echo ok" }],
    },
  }, null, 2), "utf8");
}

test("runPass can accept reviewed Gemini hooks and produce a clean doctor", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  writeHookSettings(projectRoot);

  const report = runPass({
    projectRoot,
    homeDir: projectRoot,
    acceptHooks: true,
    skipExtensionUpdate: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });
  const doctor = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(report.outcome, "pass");
  assert.equal(report.plan.intent, "check");
  assert.equal(report.acceptedHooks.length, 1);
  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), false);
  process.exitCode = oldExitCode;
});

test("runPass accepts BeforeTool and BeforeAgent hooks independently", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeAgent: [{ command: "echo before-agent" }],
      BeforeTool: [{ command: "echo before-tool" }],
    },
  }, null, 2), "utf8");

  const report = runPass({
    projectRoot,
    homeDir: projectRoot,
    acceptHooks: true,
    skipExtensionUpdate: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });
  const doctor = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(report.outcome, "pass");
  assert.equal(report.acceptedHooks.length, 2);
  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), false);
  process.exitCode = oldExitCode;
});

test("runPass emits real progress events in ritual order", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  const events: RitualProgressEvent[] = [];

  runPass({
    projectRoot,
    homeDir: projectRoot,
    dryRun: true,
    silent: true,
    setExitCode: false,
    onProgress: (event) => events.push(event),
  });

  const runningOrder = events.filter((event) => event.status === "running").map((event) => event.stepId);
  assert.deepEqual(runningOrder, [
    "setup",
    "extension-update",
    "sync",
    "doctor",
    "validate",
    "security",
    "dashboard",
  ]);
  assert.equal(events.at(-1)?.stepId, "dashboard");
  assert.notEqual(events.at(-1)?.status, "running");
  process.exitCode = oldExitCode;
});

test("runPass removes progress steps disabled by check flags", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  const events: RitualProgressEvent[] = [];

  runPass({
    projectRoot,
    homeDir: projectRoot,
    skipSetup: true,
    skipSync: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
    silent: true,
    setExitCode: false,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual([...new Set(events.map((event) => event.stepId))], ["doctor"]);
  process.exitCode = oldExitCode;
});

test("runPass repairs stale global TUI sidebar without install force", () => {
  const homeDir = tempRoot();
  const oldExitCode = process.exitCode;
  const configDir = path.join(homeDir, ".config", "opencode");
  const pluginPath = path.join(configDir, "tui-plugins", "ogb-sidebar.js");
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(path.join(configDir, "tui.json"), JSON.stringify({
    plugin: [TUI_SIDEBAR_PLUGIN_SPEC],
  }, null, 2), "utf8");
  fs.writeFileSync(pluginPath, "old sidebar plugin\n", "utf8");

  const report = runPass({
    projectRoot: homeDir,
    homeDir,
    skipSetup: true,
    skipSync: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
    silent: true,
    setExitCode: false,
  });
  const doctor = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(fs.readFileSync(pluginPath, "utf8"), TUI_SIDEBAR_PLUGIN_SOURCE);
  assert.equal(report.automated.includes("repair-global-tui-sidebar"), true);
  assert.equal(report.blockers.some((item) =>
    item.message.includes("repaired automatically")
    && item.action.includes("Reinicie o OpenCode")
  ), true);
  assert.equal(doctor.warnings.some((warning) => warning.includes("TUI sidebar plugin is stale")), false);
  process.exitCode = oldExitCode;
});

test("runPass repairs stale global startup plugin without install force", () => {
  const homeDir = tempRoot();
  const oldExitCode = process.exitCode;
  const configDir = path.join(homeDir, ".config", "opencode");
  const pluginPath = path.join(configDir, "plugins", "ogb-startup-sync.js");
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [globalStartupPluginSpec(pluginPath)],
  }, null, 2), "utf8");
  fs.writeFileSync(pluginPath, "old startup plugin\n", "utf8");

  const report = runPass({
    projectRoot: homeDir,
    homeDir,
    skipSetup: true,
    skipSync: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
    silent: true,
    setExitCode: false,
  });
  const doctor = runDoctor({ projectRoot: homeDir, homeDir, silent: true });

  assert.equal(fs.readFileSync(pluginPath, "utf8"), STARTUP_SYNC_PLUGIN_SOURCE);
  assert.match(fs.readFileSync(pluginPath, "utf8"), /DEFAULT_LIMITS_REFRESH_MS/);
  assert.equal(report.automated.includes("repair-global-startup-plugin"), true);
  assert.equal(report.blockers.some((item) =>
    item.message.includes("startup plugin was repaired automatically")
    && item.action.includes("Reinicie o OpenCode")
  ), true);
  assert.equal(doctor.warnings.some((warning) => warning.includes("startup plugin is stale")), false);
  process.exitCode = oldExitCode;
});

test("runPass turns patch warnings into check blockers without stopping doctor", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  const events: RitualProgressEvent[] = [];
  const patchRegistry: readonly OgbPatch[] = [{
    id: "warn-after-check",
    title: "Warn after check",
    description: "Test warning patch",
    category: "compatibility",
    reason: "Exercise check blocker rendering for patch warnings.",
    introducedIn: "0.0.0-test",
    phase: "post-check",
    applies: () => true,
    run: () => ({
      status: "warning",
      message: "needs manual review",
      nextAction: "Review the test patch warning.",
    }),
  }];

  const report = runPass({
    projectRoot,
    homeDir: projectRoot,
    skipSetup: true,
    skipSync: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
    patchRegistry,
    silent: true,
    setExitCode: false,
    onProgress: (event) => events.push(event),
  });

  assert.equal(report.outcome, "warn");
  assert.equal(report.automated.includes("patches:post-check"), true);
  assert.equal(report.blockers.some((item) => item.source === "patch" && item.severity === "warn"), true);
  assert.equal(report.steps.some((step) => step.name === "patches:post-check" && step.status === "warn"), true);
  assert.equal(events.some((event) => event.stepId === "patches-post-check" && event.status === "warn"), true);
  process.exitCode = oldExitCode;
});

test("runPass carries the first validation failure into blocker copy and next action", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  const events: RitualProgressEvent[] = [];

  const report = runPass({
    projectRoot,
    homeDir: projectRoot,
    skipSync: true,
    skipSecurity: true,
    skipDashboard: true,
    silent: true,
    setExitCode: false,
    onProgress: (event) => events.push(event),
  });

  const validationBlocker = report.blockers.find((item) => item.source === "validation");
  const validationEvent = events.find((event) => event.stepId === "validate" && event.status === "fail");
  assert.equal(report.outcome, "fail");
  assert.ok(validationBlocker);
  assert.match(validationBlocker.message, /Validation falhou: .+:/);
  assert.match(validationBlocker.action, /ogb validate --plain/);
  assert.match(validationEvent?.message ?? "", /:/);
  process.exitCode = oldExitCode;
});

test("trusted Gemini hooks require review again after settings change", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeAgent: [{ command: "echo ok" }],
    },
  }, null, 2), "utf8");
  runPass({
    projectRoot,
    homeDir: projectRoot,
    acceptHooks: true,
    skipExtensionUpdate: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });

  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeAgent: [{ command: "echo changed" }],
    },
  }, null, 2), "utf8");

  const doctor = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), true);
  process.exitCode = oldExitCode;
});

test("trusted Gemini hooks survive unrelated settings changes", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  writeHookSettings(projectRoot);
  runPass({
    projectRoot,
    homeDir: projectRoot,
    acceptHooks: true,
    skipExtensionUpdate: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });

  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{ command: "echo ok" }],
    },
    mcpServers: {
      demo: { command: "node", args: ["server.js"] },
    },
  }, null, 2), "utf8");

  const doctor = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), false);
  process.exitCode = oldExitCode;
});

test("trusted Gemini hooks survive project directory moves", () => {
  const homeDir = tempRoot();
  const projectRoot = path.join(homeDir, "project-before");
  const movedRoot = path.join(homeDir, "project-after");
  const oldExitCode = process.exitCode;
  fs.mkdirSync(projectRoot, { recursive: true });
  writeHookSettings(projectRoot);
  runPass({
    projectRoot,
    homeDir,
    acceptHooks: true,
    skipExtensionUpdate: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });

  fs.renameSync(projectRoot, movedRoot);
  const doctor = runDoctor({ projectRoot: movedRoot, homeDir, silent: true });

  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), false);
  process.exitCode = oldExitCode;
});

test("runPass treats Gemini extension update failure as warning and still syncs", () => {
  const projectRoot = tempRoot();
  const extensionPath = path.join(projectRoot, ".gemini", "extensions", "failing-extension");
  const oldExitCode = process.exitCode;
  const oldGeminiBin = process.env.GEMINI_BIN;
  const events: RitualProgressEvent[] = [];
  fs.mkdirSync(extensionPath, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({
    name: "failing-extension",
    version: "1.0.0",
  }), "utf8");
  process.env.GEMINI_BIN = writeFakeGemini(projectRoot, `
console.error("extension update failed");
process.exit(9);
`);

  try {
    const report = runPass({
      projectRoot,
      homeDir: projectRoot,
      skipSetup: true,
      skipValidation: true,
      skipSecurity: true,
      skipDashboard: true,
      silent: true,
      setExitCode: false,
      onProgress: (event) => events.push(event),
    });

    assert.equal(report.outcome, "warn");
    assert.deepEqual(report.automated.slice(0, 3), ["update-extensions", "sync", "doctor"]);
    assert.equal(report.steps[0]?.name, "update-extensions");
    assert.equal(report.steps[0]?.status, "warn");
    assert.equal(report.steps[1]?.name, "sync");
    assert.equal(report.blockers.some((item) => item.source === "extension-update" && item.severity === "warn"), true);
    assert.equal(events.some((event) => event.stepId === "extension-update" && event.status === "warn"), true);
    assert.equal(events.some((event) => event.stepId === "sync" && event.status === "running"), true);
  } finally {
    if (oldGeminiBin === undefined) delete process.env.GEMINI_BIN;
    else process.env.GEMINI_BIN = oldGeminiBin;
    process.exitCode = oldExitCode;
  }
});

test("runPass repairs global OpenCode projections before project sync", () => {
  const homeDir = tempRoot();
  const projectRoot = tempRoot();
  const extensionAgents = path.join(homeDir, ".gemini", "extensions", "medical-pack", "agents");
  const oldExitCode = process.exitCode;
  fs.mkdirSync(extensionAgents, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "Project rules\n", "utf8");
  fs.writeFileSync(path.join(extensionAgents, "keeper.md"), "---\ndescription: Keeper\nmodel: gemini-3-flash-preview\n---\nKeep.\n", "utf8");
  fs.writeFileSync(path.join(extensionAgents, "stale.md"), "---\ndescription: Stale\nmodel: gemini-3-flash-preview\n---\nStale.\n", "utf8");

  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true });
  fs.rmSync(path.join(extensionAgents, "stale.md"));
  const keeperTarget = path.join(homeDir, ".config", "opencode", "agents", "keeper.md");
  fs.writeFileSync(
    keeperTarget,
    fs.readFileSync(keeperTarget, "utf8").replace("google/gemini-3-flash-preview", "gemini-3-flash-preview"),
    "utf8",
  );

  const report = runPass({
    projectRoot,
    homeDir,
    force: true,
    skipSetup: true,
    skipExtensionUpdate: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
    silent: true,
    setExitCode: false,
    rulesyncMode: "off",
  });

  assert.equal(report.automated.includes("global-sync"), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "agents", "stale.md")), false);
  assert.match(fs.readFileSync(keeperTarget, "utf8"), /model: "google\/gemini-3-flash-preview"/);
  process.exitCode = oldExitCode;
});

test("formatPassReport prints a compact human report", () => {
  const projectRoot = "/tmp/project";
  const report: PassReport = {
    version: "0.0.40",
    projectRoot,
    outcome: "warn",
    plan: buildInstallerPlan({ intent: "check", projectRoot, homeDir: "/tmp" }),
    automated: ["setup-opencode", "sync", "doctor", "validate", "dashboard"],
    steps: [
      { name: "setup-opencode", status: "pass" },
      { name: "sync", status: "pass" },
      { name: "doctor", status: "warn", detail: "1 warning(s)" },
      { name: "validate", status: "warn", detail: "warn" },
      { name: "dashboard", status: "warn", detail: "warn" },
    ],
    acceptedHooks: [],
    blockers: [
      {
        source: "doctor",
        severity: "warn",
        message: "opencode-auto-fallback is enabled in OGB config, but the OpenCode plugin is not active; disable externalPlugins.autoFallback or install a compatible plugin version.",
        action: "Desative `externalPlugins.autoFallback` em `.opencode/ogb.config.jsonc`.",
      },
    ],
    sync: {
      generatedConfigPath: "/tmp/project/.opencode/generated/opencode.generated.json",
      builtInAgents: 1,
      extensionAgents: 6,
      builtInCommands: 11,
      extensionCommands: 14,
      skills: 11,
      tuiFiles: 0,
      externalIntegrationFiles: 1,
      rulesyncStatus: "applied",
      rulesyncPromoted: 0,
    },
    doctor: { warnings: 1, errors: 0 },
    validation: { outcome: "warn" },
    dashboard: { outcome: "warn" },
    files: {
      pass: "/tmp/project/.opencode/generated/ogb-pass.json",
      doctor: "/tmp/project/.opencode/generated/ogb-doctor.json",
      dashboard: "/tmp/project/.opencode/generated/ogb-dashboard.md",
    },
  };

  const text = formatPassReport(report);

  assert.match(text, /^OGB check WARN/m);
  assert.match(text, /Checks\n  OK    setup-opencode/);
  assert.match(text, /Needs Attention/);
  assert.match(text, /Auto fallback esta ligado, mas o plugin externo nao carregou\./);
  assert.match(text, /report:    \.opencode\/generated\/ogb-pass\.json/);
  assert.doesNotMatch(text, /Automacao|Pendencias|Relatorio/);
});
