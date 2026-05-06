import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDashboard } from "./dashboard.js";
import { resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-dashboard-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("runDashboard combines generated reports into JSON and Markdown", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {
      geminiFiles: 1,
      imports: { ok: 1, warning: 0, error: 0, needs_review: 0 },
      mcps: { ok: 2, warning: 0, error: 0, needs_review: 0 },
      skills: { ok: 3, warning: 0, error: 0, needs_review: 0 },
      agents: { ok: 1, warning: 0, error: 0, needs_review: 0 },
      commands: { ok: 4, warning: 0, error: 0, needs_review: 0 },
      extensions: { ok: 0, warning: 0, error: 0, needs_review: 1 },
    },
    generated: {
      expandedGeminiVersion: OGB_VERSION,
      generatedConfigVersion: OGB_VERSION,
      syncStateVersion: OGB_VERSION,
    },
    rulesync: {
      available: true,
      version: "8.15.0",
      lastStatus: "applied",
      lastPromoted: 0,
      lastConflicts: 0,
    },
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
      globalPlugin: false,
      globalConfig: false,
    },
    extensionCompatibility: {
      mapExists: true,
      extensions: 1,
      projectedCommands: 2,
      availableAgents: 1,
      modelFallbacks: 1,
      modelRoutingReport: true,
      modelRoutingEnabled: true,
      modelRoutingDecisions: 1,
      modelRoutingRouted: 0,
      modelRoutingSkipped: 0,
      ohMyOpenAgentConfig: false,
      ohMyOpenAgentPlugin: false,
      hooks: 1,
      scripts: 5,
    },
    runtimeFallback: {
      configured: true,
      pluginActive: true,
      configExists: true,
      agentFallbacks: 1,
      defaultFallbacks: 0,
      cooldownMs: 60000,
      maxRetries: 2,
    },
    modelResolution: {
      checked: true,
      availableModels: 10,
      referencedModels: 3,
      unresolved: [],
      message: "All referenced routed/fallback models were found in opencode models.",
    },
  });
  writeJson(paths.validationPath, { version: OGB_VERSION, projectRoot, generatedAt: "2026-05-06T12:02:00.000Z", outcome: "pass", checks: [] });
  writeJson(paths.securityPath, { version: OGB_VERSION, projectRoot, generatedAt: "2026-05-06T12:02:00.000Z", outcome: "pass", findings: [] });
  writeJson(paths.limitsPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-04T12:00:00.000Z",
    status: "ok",
    providers: [
      { displayName: "OpenAI", fetchedAt: "2026-05-04T12:00:00.000Z", lines: [] },
      { displayName: "Anthropic", fetchedAt: "2026-05-04T12:00:00.000Z", lines: [] },
    ],
    sources: {
      openusage: { status: "ok", providerCount: 2 },
      anthropicClaude: { status: "ok", providerCount: 1 },
      geminiCodeAssist: { status: "skipped" },
    },
    warnings: [],
  });
  writeJson(paths.pluginStatusPath, {
    version: 1,
    state: "pass",
    reason: "plugin.init",
    finishedAt: "2026-05-04T12:00:00.000Z",
    durationMs: 1234,
    exitCode: 0,
  });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "current",
    currentVersion: OGB_VERSION,
    latestVersion: OGB_VERSION,
    latestTag: `v${OGB_VERSION}`,
    checkedAt: "2026-05-04T12:00:00.000Z",
    restartRequired: false,
    message: `OGB is current at ${OGB_VERSION}.`,
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });
  const markdown = fs.readFileSync(paths.dashboardMarkdownPath, "utf8");

  assert.equal(report.outcome, "pass");
  assert.equal(report.resources.mcps.ok, 2);
  assert.equal(report.startupSync.lastState, "pass");
  assert.equal(report.update.status, "current");
  assert.equal(report.limits.providers, 2);
  assert.equal(fs.existsSync(paths.dashboardPath), true);
  assert.equal(fs.existsSync(paths.telemetryStatusPath), true);
  assert.match(markdown, /OpenCode Gemini Bridge Dashboard/);
  assert.match(markdown, /Startup sync: PASS/);
  assert.match(markdown, /Telemetry:/);
  assert.match(markdown, /Usage limits: OK - 2 provider/);
  assert.match(markdown, /OGB update: CURRENT/);
  assert.match(markdown, /Model routing: 1 configured agent\(s\), OGB active, 1 decision/);
  assert.match(markdown, /Runtime fallback: plugin active, config present, 1 agent chain/);
  assert.match(markdown, /Model resolution: All referenced routed\/fallback models/);
  assert.match(markdown, /2 MCPs/);
});

test("runDashboard keeps a clean bridge passing when only OpenCode restart is pending", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
    },
  });
  writeJson(paths.validationPath, { version: OGB_VERSION, projectRoot, generatedAt: "2026-05-06T12:02:00.000Z", outcome: "pass", checks: [] });
  writeJson(paths.securityPath, { version: OGB_VERSION, projectRoot, generatedAt: "2026-05-06T12:02:00.000Z", outcome: "pass", findings: [] });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "updated",
    currentVersion: "0.0.38",
    latestVersion: "0.0.39",
    latestTag: "v0.0.39",
    checkedAt: "2026-05-06T12:00:00.000Z",
    finishedAt: "2026-05-06T12:01:00.000Z",
    restartRequired: true,
    message: "OGB updated to v0.0.39. Restart OpenCode to load the new plugin and commands.",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });
  const markdown = fs.readFileSync(paths.dashboardMarkdownPath, "utf8");

  assert.equal(report.outcome, "pass");
  assert.equal(report.update.status, "updated");
  assert.equal(report.update.restartRequired, true);
  assert.match(markdown, /OGB update: UPDATED v0\.0\.39 - restart OpenCode/);
  assert.ok(report.nextSteps.some((step) => step.includes("Reinicie o OpenCode")));
  assert.equal(report.warnings.some((warning) => warning.includes("reinicie o OpenCode")), false);
});

test("runDashboard treats validation/security reports without generatedAt as stale after self-update", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
      lastState: "pass",
    },
  });
  writeJson(paths.validationPath, {
    version: OGB_VERSION,
    projectRoot,
    outcome: "fail",
    checks: [
      { name: "OpenCode resolved config", status: "fail", message: "old failure" },
    ],
  });
  writeJson(paths.securityPath, {
    version: OGB_VERSION,
    projectRoot,
    outcome: "fail",
    findings: [
      { name: "YOLO guardrails", status: "fail", message: "old failure" },
    ],
  });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "updated",
    currentVersion: "0.0.55",
    latestVersion: OGB_VERSION,
    latestTag: `v${OGB_VERSION}`,
    checkedAt: "2026-05-06T20:10:00.000Z",
    finishedAt: "2026-05-06T20:11:00.000Z",
    restartRequired: true,
    message: "OGB self-update completed. Restart OpenCode and run ogb validate.",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });

  assert.equal(report.outcome, "warn");
  assert.equal(report.reports.validation.status, "warn");
  assert.equal(report.reports.security.status, "warn");
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((warning) => warning.includes("validation foi gerado antes do ultimo self-update")));
  assert.ok(report.warnings.some((warning) => warning.includes("security foi gerado antes do ultimo self-update")));
});

test("runDashboard treats validation/security reports generated before self-update as stale", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
      lastState: "pass",
    },
  });
  writeJson(paths.validationPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-06T20:00:00.000Z",
    outcome: "fail",
    checks: [
      { name: "OpenCode resolved config", status: "fail", message: "old failure" },
    ],
  });
  writeJson(paths.securityPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-06T20:00:00.000Z",
    outcome: "fail",
    findings: [
      { name: "YOLO guardrails", status: "fail", message: "old failure" },
    ],
  });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "updated",
    currentVersion: "0.0.55",
    latestVersion: OGB_VERSION,
    latestTag: `v${OGB_VERSION}`,
    checkedAt: "2026-05-06T20:10:00.000Z",
    finishedAt: "2026-05-06T20:11:00.000Z",
    restartRequired: true,
    message: "OGB self-update completed. Restart OpenCode and run ogb validate.",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });

  assert.equal(report.outcome, "warn");
  assert.equal(report.reports.validation.status, "warn");
  assert.equal(report.reports.security.status, "warn");
  assert.deepEqual(report.errors, []);
});

test("runDashboard keeps fresh validation failures as failures after self-update", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
      lastState: "pass",
    },
  });
  writeJson(paths.validationPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-06T20:12:00.000Z",
    outcome: "fail",
    checks: [
      { name: "OpenCode resolved config", status: "fail", message: "debug config returned invalid JSON" },
    ],
  });
  writeJson(paths.securityPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-06T20:12:00.000Z",
    outcome: "pass",
    findings: [],
  });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "updated",
    currentVersion: "0.0.55",
    latestVersion: OGB_VERSION,
    latestTag: `v${OGB_VERSION}`,
    checkedAt: "2026-05-06T20:10:00.000Z",
    finishedAt: "2026-05-06T20:11:00.000Z",
    restartRequired: true,
    message: "OGB self-update completed. Restart OpenCode and run ogb validate.",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });

  assert.equal(report.outcome, "fail");
  assert.equal(report.reports.validation.status, "fail");
  assert.ok(report.errors.some((error) => error.includes("debug config returned invalid JSON")));
});

test("runDashboard softens known Windows quoted-command failures while OpenCode restart is pending", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
      lastState: "pass",
    },
  });
  writeJson(paths.validationPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-06T20:12:00.000Z",
    outcome: "fail",
    checks: [
      { name: "OpenCode resolved config", status: "fail", message: `'\\"C:\\Users\\leona\\AppData\\Roaming\\npm\\opencode.cmd\\"' nao e reconhecido como um comando interno` },
    ],
  });
  writeJson(paths.securityPath, {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: "2026-05-06T20:12:00.000Z",
    outcome: "pass",
    findings: [],
  });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "updated",
    currentVersion: "0.0.55",
    latestVersion: OGB_VERSION,
    latestTag: `v${OGB_VERSION}`,
    checkedAt: "2026-05-06T20:10:00.000Z",
    finishedAt: "2026-05-06T20:11:00.000Z",
    restartRequired: true,
    message: "OGB self-update completed. Restart OpenCode and run ogb validate.",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });

  assert.equal(report.outcome, "warn");
  assert.equal(report.reports.validation.status, "warn");
  assert.deepEqual(report.errors, []);
});

test("runDashboard surfaces startup sync failure details", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
      lastState: "fail",
    },
  });
  writeJson(paths.validationPath, { version: OGB_VERSION, projectRoot, outcome: "pass", checks: [] });
  writeJson(paths.securityPath, { version: OGB_VERSION, projectRoot, outcome: "pass", findings: [] });
  writeJson(paths.pluginStatusPath, {
    version: 1,
    state: "fail",
    reason: "session.created",
    finishedAt: "2026-05-06T18:47:02.300Z",
    durationMs: 1000,
    exitCode: 1,
    signal: null,
    command: "ogb",
    args: ["--project", projectRoot, "startup-sync"],
    failureCount: 3,
    nextRetryAfter: "2026-05-06T18:57:02.300Z",
    stderrTail: "node nao foi encontrado no PATH\nsegunda linha",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });
  const markdown = fs.readFileSync(paths.dashboardMarkdownPath, "utf8");

  assert.equal(report.outcome, "fail");
  assert.equal(report.startupSync.failureCount, 3);
  assert.equal(report.startupSync.nextRetryAfter, "2026-05-06T18:57:02.300Z");
  assert.ok(report.errors.some((error) => error.includes("exit code 1") && error.includes("node nao foi encontrado")));
  assert.match(markdown, /Startup sync falhou com exit code 1: node nao foi encontrado no PATH/);
  assert.match(markdown, /retry after 2026-05-06T18:57:02\.300Z/);
});

test("runDashboard surfaces first validation and security failure details", () => {
  const projectRoot = tempProject();
  const paths = resolveProjectPaths(projectRoot);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot,
    warnings: [],
    errors: [],
    counts: {},
    startupSync: {
      projectPlugin: true,
      projectConfig: true,
    },
  });
  writeJson(paths.validationPath, {
    version: OGB_VERSION,
    projectRoot,
    outcome: "fail",
    checks: [
      { name: "Global OpenCode config", status: "fail", message: "Missing or invalid global OpenCode config." },
    ],
  });
  writeJson(paths.securityPath, {
    version: OGB_VERSION,
    projectRoot,
    outcome: "fail",
    findings: [
      { name: "YOLO guardrails", status: "fail", message: "Missing .config/opencode/agents/YOLO.md." },
    ],
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });
  const markdown = fs.readFileSync(paths.dashboardMarkdownPath, "utf8");

  assert.equal(report.outcome, "fail");
  assert.ok(report.errors.some((error) => error.includes("validation falhou: Global OpenCode config")));
  assert.ok(report.errors.some((error) => error.includes("security falhou: YOLO guardrails")));
  assert.match(markdown, /Validation: FAIL - validation falhou: Global OpenCode config/);
  assert.match(markdown, /Security: FAIL - security falhou: YOLO guardrails/);
});

test("runDashboard does not fail home/global dashboard from stale project-mode reports", () => {
  const homeDir = tempProject();
  const paths = resolveProjectPaths(homeDir, homeDir);

  writeJson(paths.doctorPath, {
    version: OGB_VERSION,
    projectRoot: homeDir,
    warnings: [],
    errors: [],
    counts: {},
    generated: {
      expandedGeminiVersion: OGB_VERSION,
      generatedConfigVersion: "global config",
    },
    startupSync: {
      globalPlugin: true,
      globalConfig: true,
      lastState: "pass",
    },
  });
  writeJson(paths.validationPath, {
    version: "0.0.53",
    projectRoot: homeDir,
    outcome: "fail",
    checks: [
      { name: "Generated config marker", status: "fail", message: "Missing ogb generated config marker." },
    ],
  });
  writeJson(paths.securityPath, {
    version: "0.0.53",
    projectRoot: homeDir,
    outcome: "fail",
    findings: [
      { name: "YOLO guardrails", status: "fail", message: "Missing .opencode/agents/YOLO.md." },
    ],
  });
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "error",
    currentVersion: "0.0.53",
    checkedAt: "2026-05-06T19:50:00.000Z",
    restartRequired: false,
    message: "OGB auto-update failed.",
  });

  const report = runDashboard({ projectRoot: homeDir, homeDir, refresh: false, silent: true });
  const markdown = fs.readFileSync(paths.dashboardMarkdownPath, "utf8");

  assert.equal(report.outcome, "warn");
  assert.equal(report.reports.validation.status, "warn");
  assert.equal(report.reports.security.status, "warn");
  assert.equal(report.update.status, "unknown");
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.some((warning) => warning.includes("Auto-update do OGB falhou")), false);
  assert.match(markdown, /Validation: WARN - validation foi gerado pelo ogb 0\.0\.53/);
  assert.match(markdown, /Security: WARN - security foi gerado pelo ogb 0\.0\.53/);
  assert.match(markdown, /OGB update: UNKNOWN/);
  assert.doesNotMatch(markdown, /Generated config marker: Missing ogb generated config marker/);
  assert.doesNotMatch(markdown, /Missing \.opencode\/agents\/YOLO\.md/);
});
