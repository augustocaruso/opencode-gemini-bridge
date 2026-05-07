import assert from "node:assert/strict";
import test from "node:test";
import { buildInstallerPlan } from "./installer-planner.js";
import { applyRitualProgressEvent, cleanInkFrame, createLiveRitualModel, failLiveRitualModel, finishLiveRitualModel, ritualViewModel, shouldUseRitualUi } from "./ritual-ui.js";
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

test("live progress model starts full-width with every todo queued", () => {
  const model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
    { stepId: "sync", label: "sync bridge assets" },
    { stepId: "doctor", label: "run doctor" },
  ], { now: 1000, width: 132 });

  assert.equal(model.title, "OGB check");
  assert.equal(model.subtitle, projectRoot);
  assert.equal(model.statusLabel, "RUN");
  assert.equal(model.width, 132);
  assert.equal(model.currentStepId, "setup");
  assert.equal(model.final, false);
  assert.deepEqual(model.steps.map((step) => step.label), ["setup OpenCode plugin", "sync bridge assets", "run doctor"]);
  assert.deepEqual(model.steps.map((step) => step.status), ["queued", "queued", "queued"]);
});

test("live progress events update the active todo without creating a second report model", () => {
  let model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin", detail: "wire plugin" },
    { stepId: "sync", label: "sync bridge assets", detail: "project resources" },
  ], { now: 1000, width: 100 });

  model = applyRitualProgressEvent(model, {
    stepId: "setup",
    label: "setup OpenCode plugin",
    detail: "wire plugin",
    status: "running",
    message: "Checking plugin file.",
  });
  model = applyRitualProgressEvent(model, {
    stepId: "setup",
    label: "setup OpenCode plugin",
    status: "pass",
    message: "Startup sync wiring is present.",
  });
  model = applyRitualProgressEvent(model, {
    stepId: "sync",
    label: "sync bridge assets",
    status: "running",
  });

  assert.equal(model.currentStepId, "sync");
  assert.deepEqual(model.steps.map((step) => [step.stepId, step.status]), [
    ["setup", "pass"],
    ["sync", "running"],
  ]);
  assert.match(model.steps[0].message ?? "", /Startup sync/);
});

test("finishing the live progress model turns the same todo list into the final report", () => {
  let model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
    { stepId: "sync", label: "sync bridge assets" },
    { stepId: "doctor", label: "run doctor" },
    { stepId: "validate", label: "validate config" },
    { stepId: "security", label: "security guardrails" },
    { stepId: "dashboard", label: "dashboard summary" },
  ], { now: 1000, width: 100 });
  for (const step of model.steps) {
    model = applyRitualProgressEvent(model, { ...step, status: "pass" });
  }

  const finished = finishLiveRitualModel(model, passReport(), { now: 3000 });

  assert.equal(finished.final, true);
  assert.equal(finished.statusLabel, "PASS");
  assert.equal(finished.finishedAt, 3000);
  assert.deepEqual(finished.steps.map((step) => step.status), ["pass", "pass", "pass", "pass", "pass", "pass"]);
  assert.deepEqual(finished.metrics.map((metric) => [metric.label, metric.value]), [
    ["automated", "6"],
    ["skills", "17"],
    ["commands", "17"],
    ["agents", "7"],
    ["blockers", "0"],
  ]);
  assert.ok(finished.next.some((item) => /Bridge is clean/.test(item)));
});

test("live progress model turns thrown errors into a visible failed todo", () => {
  const started = applyRitualProgressEvent(createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
  ], { now: 1000, width: 100 }), {
    stepId: "setup",
    label: "setup OpenCode plugin",
    status: "running",
  });

  const failed = failLiveRitualModel(started, new Error("boom"), { now: 2000 });

  assert.equal(failed.final, true);
  assert.equal(failed.statusLabel, "FAIL");
  assert.equal(failed.steps[0].status, "fail");
  assert.match(failed.callouts[0], /boom/);
  assert.match(failed.next[0], /plain/);
});

test("unexpected command errors get PATH-specific next actions", () => {
  const started = applyRitualProgressEvent(createLiveRitualModel("update", projectRoot, [
    { stepId: "install", label: "apply installer" },
  ], { now: 1000, width: 100 }), {
    stepId: "install",
    label: "apply installer",
    status: "running",
  });

  const failed = failLiveRitualModel(started, new Error("ENOENT: opencode.cmd not found"), { now: 2000 });

  assert.match(failed.next[0], /PATH/);
  assert.match(failed.next[1], /ogb update --plain/);
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

test("install and reset final models keep nested check blockers specific", () => {
  const failingCheck = passReport({
    outcome: "fail",
    blockers: [{
      severity: "fail",
      source: "validation",
      message: "Validation falhou: Global OpenCode config: opencode.json is missing.",
      action: "Rode `ogb validate --plain` para ver os checks detalhados.",
    }],
  });
  const install: InstallReport = {
    version: "0.0.61",
    projectRoot,
    homeDir,
    homeMode: false,
    outcome: "fail",
    plan: buildInstallerPlan({ intent: "install", projectRoot, homeDir }),
    warnings: ["fallback warning"],
    check: failingCheck,
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
    check: failingCheck,
  };

  const installModel = ritualViewModel("install", install);
  const resetModel = ritualViewModel("reset", reset);

  assert.match(installModel.callouts[0], /Global OpenCode config/);
  assert.match(installModel.next[0], /ogb validate --plain/);
  assert.match(resetModel.callouts[0], /Global OpenCode config/);
  assert.match(resetModel.next[0], /ogb validate --plain/);
});

test("update final model surfaces bootstrap tails and useful retry actions", () => {
  const model = ritualViewModel("update", {
    status: "error",
    command: ["bash", "-lc", "bootstrap"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: "Bootstrap exited with code 1.",
    stderrTail: "npm is not recognized as a command",
    stdoutTail: "Downloading OGB",
  });

  assert.equal(model.statusLabel, "FAIL");
  assert.match(model.callouts.join("\n"), /npm is not recognized/);
  assert.match(model.next[0], /ogb update --plain/);
});
