import assert from "node:assert/strict";
import test from "node:test";
import { buildInstallerPlan } from "./installer-planner.js";
import { cleanInkFrame, ritualViewModel, shouldUseRitualUi } from "./ritual-ui.js";
import type { InstallReport } from "./install.js";
import type { PassReport } from "./pass.js";
import type { ResetReport } from "./reset.js";
import type { SelfUpdateReport } from "./self-update.js";

const projectRoot = "/tmp/ogb-project";
const homeDir = "/tmp/ogb-home";

function passReport(overrides: Partial<PassReport> = {}): PassReport {
  return {
    version: "0.0.61",
    projectRoot,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "check", projectRoot, homeDir }),
    automated: ["setup-opencode", "sync", "doctor", "validate", "security-check", "dashboard"],
    steps: [
      { name: "setup-opencode", status: "pass" },
      { name: "sync", status: "pass" },
      { name: "doctor", status: "pass" },
      { name: "validate", status: "pass" },
      { name: "security-check", status: "pass" },
      { name: "dashboard", status: "pass" },
    ],
    acceptedHooks: [],
    blockers: [],
    sync: {
      generatedConfigPath: `${projectRoot}/.opencode/generated/opencode.generated.json`,
      builtInAgents: 1,
      extensionAgents: 6,
      builtInCommands: 2,
      extensionCommands: 15,
      skills: 17,
      tuiFiles: 2,
      externalIntegrationFiles: 3,
      rulesyncStatus: "applied",
      rulesyncPromoted: 0,
    },
    doctor: { warnings: 0, errors: 0 },
    validation: { outcome: "pass" },
    security: { outcome: "pass" },
    dashboard: { outcome: "pass" },
    files: {
      pass: `${projectRoot}/.opencode/generated/ogb-pass.json`,
      doctor: `${projectRoot}/.opencode/generated/ogb-doctor.json`,
      dashboard: `${projectRoot}/.opencode/generated/ogb-dashboard.md`,
    },
    ...overrides,
  };
}

test("rich ritual UI is opt-in to an interactive human terminal", () => {
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: {} }), true);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: false, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, json: true, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, plain: true, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CI: "true" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { OGB_PLAIN: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { OGB_UI: "0" } }), false);
});

test("Ink frame cleanup keeps the final rendered frame for transcript captures", () => {
  const raw = "\u001B[?25lfirst frame\n\u001B[2J\u001B[3J\u001B[Hsecond frame\n\u001B[?25h";
  assert.equal(cleanInkFrame(raw), "second frame");
});

test("check ritual view model highlights projected bridge assets", () => {
  const model = ritualViewModel("check", passReport());

  assert.equal(model.title, "OGB check");
  assert.equal(model.statusLabel, "PASS");
  assert.deepEqual(model.metrics.map((metric) => [metric.label, metric.value]), [
    ["automated", "6"],
    ["skills", "17"],
    ["commands", "17"],
    ["agents", "7"],
    ["blockers", "0"],
  ]);
  assert.ok(model.next.some((item) => /Bridge is clean/.test(item)));
});

test("check ritual view model keeps blocker actions visible", () => {
  const model = ritualViewModel("check", passReport({
    outcome: "warn",
    blockers: [{
      severity: "warn",
      source: "doctor",
      message: "MCP command warning: browsermcp - Command not found on PATH: npx",
      action: "Install npx or remove the MCP.",
    }],
  }));

  assert.equal(model.statusLabel, "WARN");
  assert.match(model.callouts[0], /browsermcp/);
  assert.equal(model.next[0], "Install npx or remove the MCP.");
});

test("install, reset and update models expose user-facing next steps", () => {
  const install: InstallReport = {
    version: "0.0.61",
    projectRoot,
    homeDir,
    homeMode: false,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "install", projectRoot, homeDir }),
    warnings: [],
    check: passReport(),
  };
  const reset: ResetReport = {
    version: "0.0.61",
    homeDir,
    outcome: "pass",
    plan: buildInstallerPlan({ intent: "reset", projectRoot: homeDir, homeDir }),
    globalConfigPath: `${homeDir}/.config/opencode/opencode.json`,
    exaEnv: { status: "configured", message: "OPENCODE_ENABLE_EXA=1 configured." },
    cleanup: { homeDir, dryRun: false, actions: [], warnings: [] },
    warnings: [],
    check: passReport(),
  };
  const update: SelfUpdateReport = {
    status: "applied",
    command: ["ogb", "update"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: "OGB bootstrap completed. Full bridge check was refreshed.",
    postUpdate: {
      status: "pass",
      command: ["ogb", "check"],
      message: "Post-update check completed cleanly.",
      exitCode: 0,
    },
  };

  assert.ok(ritualViewModel("install", install).next.some((item) => /ready/.test(item)));
  assert.ok(ritualViewModel("reset", reset).next.some((item) => /rebuilt/.test(item)));
  assert.ok(ritualViewModel("update", update).next.some((item) => /Restart OpenCode/.test(item)));
});
