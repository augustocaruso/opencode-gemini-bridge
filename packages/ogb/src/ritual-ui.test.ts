import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import React from "react";
import { Box, Text, render as renderInk } from "ink";
import { buildInstallerPlan } from "./installer-planner.js";
import { updateProgressSteps } from "./ritual-progress.js";
import { applyRitualProgressEvent, cleanInkFrame, createLiveRitualModel, failLiveRitualModel, finishLiveRitualModel, finishLiveRitualModelFromProgressEvent, RitualPanel, ritualViewModel, shouldAnimateRitualUi, shouldUseRitualUi } from "./ritual-ui.js";
import type { InstallReport } from "./install.js";
import type { PassReport } from "./pass.js";
import type { ResetReport } from "./reset.js";
import type { SelfUpdateReport } from "./self-update.js";

const projectRoot = "/tmp/ogb-project";
const homeDir = "/tmp/ogb-home";
const CSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const noisyBootstrapTail = [
  "% Total    % Received % Xferd  Average Speed   Time    Time     Time  Current",
  "                                 Dload  Upload   Total   Spent    Left  Speed",
  "\r  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0",
  "\r100  817k  100  817k    0     0   484k      0  0:00:01  0:00:01 --:--:-- 1261k",
  "npm warn deprecated koa-router@14.0.0: Please use @koa/router instead, starting from v9!",
  "sync: Antigravity skill conflict: .gemini/antigravity/skills/process-medical-chats was edited manually; use --force to overwrite",
].join("\n");

class CaptureTty extends Writable {
  readonly isTTY = true;
  columns = 100;
  rows = 40;
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
    callback();
  }

  clear(): void {
    this.chunks = [];
  }

  text(): string {
    return this.chunks.join("");
  }
}

function ansiWriteStats(text: string): { bytes: number; clearTerminal: number; eraseLine: number; cursorUp: number } {
  const csi = text.match(CSI_PATTERN) ?? [];
  return {
    bytes: Buffer.byteLength(text),
    clearTerminal: (text.match(/\x1B\[2J|\x1Bc/g) ?? []).length,
    eraseLine: csi.filter((item) => item === "\x1B[2K").length,
    cursorUp: csi.filter((item) => /^\x1B\[\d*A$/.test(item)).length,
  };
}

function SpinnerBenchmarkPanel(props: { frame: number }): React.ReactElement {
  const frames = ["◐", "◓", "◑", "◒"];
  return React.createElement(
    Box,
    { borderStyle: "round", flexDirection: "column", width: 80, paddingX: 1 },
    React.createElement(Text, null, "RUN OGB update                                               running"),
    ...Array.from({ length: 18 }, (_, index) => React.createElement(
      Text,
      { key: index },
      `${index === 9 ? frames[props.frame % frames.length] : "RUN"} row ${String(index).padStart(2, "0")} ${"x".repeat(45)}`,
    )),
  );
}

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
      notes: [],
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
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, progressJson: true, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CI: "true" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CODEX_CI: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { CODEX_SHELL: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { TERM: "dumb" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, stdoutColumns: 79, env: {} }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, stdoutColumns: 80, env: {} }), true);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { OGB_PLAIN: "1" } }), false);
  assert.equal(shouldUseRitualUi({ stdoutIsTTY: true, env: { OGB_UI: "0" } }), false);
});

test("ritual UI animation is on by default but can be disabled", () => {
  assert.equal(shouldAnimateRitualUi({}), true);
  assert.equal(shouldAnimateRitualUi({ OGB_UI_ANIMATE: "1" }), true);
  assert.equal(shouldAnimateRitualUi({ OGB_UI_ANIMATE: "0" }), false);
});

test("Ink incremental rendering keeps spinner ticks from repainting the whole ritual panel", async () => {
  const stdout = new CaptureTty();
  const instance = renderInk(React.createElement(SpinnerBenchmarkPanel, { frame: 0 }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
    maxFps: 10,
  } as Parameters<typeof renderInk>[1] & { incrementalRendering: boolean; maxFps: number });

  await new Promise((resolve) => setTimeout(resolve, 20));
  stdout.clear();
  instance.rerender(React.createElement(SpinnerBenchmarkPanel, { frame: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 150));

  const stats = ansiWriteStats(stdout.text());
  instance.unmount();
  instance.cleanup();

  assert.equal(stats.clearTerminal, 0);
  assert.ok(stats.bytes < 600, `expected incremental spinner tick under 600 bytes, got ${JSON.stringify(stats)}`);
  assert.ok(stats.eraseLine < 3, `expected spinner tick to avoid full-panel line erases, got ${JSON.stringify(stats)}`);
});

test("update ritual spinner stays incremental when the terminal is shorter than the full plan", async () => {
  const stdout = new CaptureTty();
  stdout.rows = 24;
  stdout.columns = 100;
  const model = createLiveRitualModel("update", projectRoot, updateProgressSteps(), { now: 1000 });
  const instance = renderInk(React.createElement(RitualPanel, { model, animate: true }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
    maxFps: 10,
  } as Parameters<typeof renderInk>[1] & { incrementalRendering: boolean; maxFps: number });

  await new Promise((resolve) => setTimeout(resolve, 150));
  stdout.clear();
  await new Promise((resolve) => setTimeout(resolve, 1150));

  const stats = ansiWriteStats(stdout.text());
  instance.unmount();
  instance.cleanup();

  assert.equal(stats.clearTerminal, 0, `spinner tick should not clear the terminal: ${JSON.stringify(stats)}`);
  assert.ok(stats.bytes < 800, `expected compact spinner tick under 800 bytes, got ${JSON.stringify(stats)}`);
});

test("update ritual final report avoids Ink fullscreen clears on short terminals", async () => {
  const stdout = new CaptureTty();
  stdout.rows = 24;
  stdout.columns = 100;
  let model = createLiveRitualModel("update", projectRoot, updateProgressSteps(), { now: 1000 });
  for (const step of model.steps) {
    model = applyRitualProgressEvent(model, {
      stepId: step.stepId,
      label: step.label,
      detail: step.detail,
      status: step.stepId === "validate" || step.stepId === "dashboard" ? "fail" : step.stepId === "doctor" ? "warn" : "pass",
      message: step.stepId === "validate" ? "Generated config marker: Generated config version is stale." : step.stepId === "doctor" ? "5 warning(s)" : undefined,
    });
  }

  const instance = renderInk(React.createElement(RitualPanel, { model, animate: true }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
    maxFps: 10,
  } as Parameters<typeof renderInk>[1] & { incrementalRendering: boolean; maxFps: number });

  await new Promise((resolve) => setTimeout(resolve, 150));
  const finalModel = finishLiveRitualModelFromProgressEvent(model, {
    schemaVersion: "ogb.progress.v1",
    ritualId: "test",
    kind: "update",
    timestamp: new Date(0).toISOString(),
    type: "ritual.finished",
    outcome: "fail",
    exitCode: 2,
    summary: {
      statusLabel: "FAIL",
      callouts: [
        "doctor: stale generated file",
        "doctor: stale sync state",
        "validation: generated config marker failed",
        "dashboard: validation failed",
      ],
      next: [
        "Run `ogb check --plain --force` to inspect the post-update failure directly.",
        "Run `ogb dashboard --plain` for the last persisted bridge state.",
      ],
    },
    files: [`${projectRoot}/.opencode/generated/ogb-pass.json`, `${projectRoot}/.opencode/generated/ogb-dashboard.md`],
  }, { now: 5000 });

  stdout.clear();
  instance.rerender(React.createElement(RitualPanel, { model: finalModel, animate: true }));
  await new Promise((resolve) => setTimeout(resolve, 150));

  const stats = ansiWriteStats(stdout.text());
  instance.unmount();
  instance.cleanup();

  assert.equal(stats.clearTerminal, 0, `final report should not clear the terminal: ${JSON.stringify(stats)}`);
});

test("Ink frame cleanup keeps the final rendered frame for transcript captures", () => {
  const raw = "\u001B[?25lfirst frame\n\u001B[2J\u001B[3J\u001B[Hsecond frame\n\u001B[?25h";
  assert.equal(cleanInkFrame(raw), "second frame");
});

test("live progress model starts with every todo queued", () => {
  const model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
    { stepId: "sync", label: "sync bridge assets" },
    { stepId: "doctor", label: "run doctor" },
  ], { now: 1000 });

  assert.equal(model.title, "OGB check");
  assert.equal(model.subtitle, projectRoot);
  assert.equal(model.statusLabel, "RUN");
  assert.equal(model.currentStepId, "setup");
  assert.equal(model.final, false);
  assert.deepEqual(model.steps.map((step) => step.label), ["setup OpenCode plugin", "sync bridge assets", "run doctor"]);
  assert.deepEqual(model.steps.map((step) => step.status), ["queued", "queued", "queued"]);
});

test("live progress events update the active todo without creating a second report model", () => {
  let model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin", detail: "wire plugin" },
    { stepId: "sync", label: "sync bridge assets", detail: "project resources" },
  ], { now: 1000 });

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

test("live progress model compacts noisy bootstrap output before rendering", () => {
  const model = applyRitualProgressEvent(createLiveRitualModel("update", projectRoot, [
    { stepId: "install", label: "Apply the installer." },
  ], { now: 1000 }), {
    stepId: "install",
    label: "Apply the installer.",
    status: "fail",
    message: noisyBootstrapTail,
  });

  const message = model.steps[0].message ?? "";
  assert.match(message, /koa-router/);
  assert.doesNotMatch(message, /% Total|--:--:--|\r/);
  assert.ok(message.length <= 280);
});

test("finishing the live progress model turns the same todo list into the final report", () => {
  let model = createLiveRitualModel("check", projectRoot, [
    { stepId: "setup", label: "setup OpenCode plugin" },
    { stepId: "sync", label: "sync bridge assets" },
    { stepId: "doctor", label: "run doctor" },
    { stepId: "validate", label: "validate config" },
    { stepId: "security", label: "security guardrails" },
    { stepId: "dashboard", label: "dashboard summary" },
  ], { now: 1000 });
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
  ], { now: 1000 }), {
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
  ], { now: 1000 }), {
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

test("check ritual view model surfaces non-blocking sync notes", () => {
  const model = ritualViewModel("check", passReport({
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
      notes: ["Antigravity skill skipped: defuddle (untrusted mount point)."],
    },
  }));

  assert.equal(model.statusLabel, "PASS");
  assert.equal(model.metrics.find((metric) => metric.label === "blockers")?.value, "0");
  assert.match(model.callouts.join("\n"), /Antigravity skill skipped: defuddle/);
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

test("update final model shows warning when the post-update check warns", () => {
  const model = ritualViewModel("update", {
    status: "applied",
    command: ["ogb", "update"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: "OGB bootstrap completed. Full bridge check ran with warnings; see ogb check/dashboard for details.",
    postUpdate: {
      status: "warn",
      command: ["ogb", "check"],
      message: "Post-update check completed with warnings.",
      exitCode: 1,
    },
  });

  assert.equal(model.statusLabel, "WARN");
  assert.equal(model.tone, "warn");
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

test("update final model compacts noisy bootstrap tails for the rich UI", () => {
  const model = ritualViewModel("update", {
    status: "error",
    command: ["bash", "-lc", "bootstrap"],
    plan: buildInstallerPlan({ intent: "update", projectRoot, homeDir, release: "v0.0.61" }),
    message: "Bootstrap exited with code 1.",
    stdoutTail: noisyBootstrapTail,
  });

  const text = model.callouts.join("\n");
  assert.match(text, /koa-router/);
  assert.doesNotMatch(text, /% Total|--:--:--|\r/);
  assert.ok(model.callouts.every((item) => item.length <= 280));
});
