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
  writeJson(paths.validationPath, { version: OGB_VERSION, projectRoot, outcome: "pass", checks: [] });
  writeJson(paths.securityPath, { version: OGB_VERSION, projectRoot, outcome: "pass", findings: [] });
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

test("runDashboard warns when auto-update requires an OpenCode restart", () => {
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
  writeJson(paths.validationPath, { version: OGB_VERSION, projectRoot, outcome: "pass", checks: [] });
  writeJson(paths.securityPath, { version: OGB_VERSION, projectRoot, outcome: "pass", findings: [] });
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

  assert.equal(report.outcome, "warn");
  assert.equal(report.update.status, "updated");
  assert.equal(report.update.restartRequired, true);
  assert.match(markdown, /OGB update: UPDATED v0\.0\.39 - restart OpenCode/);
  assert.ok(report.nextSteps.some((step) => step.includes("Reinicie o OpenCode")));
});
