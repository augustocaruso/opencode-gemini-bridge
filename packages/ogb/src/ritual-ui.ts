import { Writable } from "node:stream";
import React from "react";
import { Box, Text, render, type Instance } from "ink";
import type { InstallReport } from "./install.js";
import type { PassReport } from "./pass.js";
import type { ResetReport } from "./reset.js";
import type { SelfUpdateReport } from "./self-update.js";

export type RitualKind = "install" | "check" | "reset" | "update";
export type RitualTone = "pass" | "warn" | "fail" | "preview" | "neutral";

export interface RitualMetric {
  label: string;
  value: string;
  tone?: RitualTone;
}

export interface RitualStep {
  label: string;
  status: RitualTone;
  detail?: string;
}

export type RitualProgressStatus = "running" | "queued" | "waiting";

export interface RitualProgressStep {
  label: string;
  status?: RitualProgressStatus;
  detail?: string;
}

export interface RitualViewModel {
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: RitualTone;
  metrics: RitualMetric[];
  steps: RitualStep[];
  callouts: string[];
  next: string[];
  files: string[];
}

export interface RitualProgressModel {
  title: string;
  subtitle: string;
  steps: RitualProgressStep[];
  note: string;
  active: string;
}

export interface RitualUiOptions {
  json?: boolean;
  plain?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

class MemoryWriteStream extends Writable {
  chunks: Buffer[] = [];
  columns: number;
  rows = 40;
  isTTY = true;

  constructor(columns: number) {
    super();
    this.columns = columns;
  }

  _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  getColorDepth(): number {
    return typeof process.stdout.getColorDepth === "function" ? process.stdout.getColorDepth() : 8;
  }

  hasColors(): boolean {
    return true;
  }

  output(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function titleForKind(kind: RitualKind): string {
  if (kind === "install") return "OGB install";
  if (kind === "update") return "OGB update";
  if (kind === "reset") return "OGB reset";
  return "OGB check";
}

function toneFromOutcome(outcome: string | undefined): RitualTone {
  if (outcome === "pass" || outcome === "applied") return "pass";
  if (outcome === "warn") return "warn";
  if (outcome === "fail" || outcome === "error") return "fail";
  if (outcome === "preview" || outcome === "cancelled") return "preview";
  return "neutral";
}

function labelFromTone(tone: RitualTone): string {
  if (tone === "pass") return "PASS";
  if (tone === "warn") return "WARN";
  if (tone === "fail") return "FAIL";
  if (tone === "preview") return "PREVIEW";
  return "READY";
}

function colorFromTone(tone: RitualTone): string {
  if (tone === "pass") return "green";
  if (tone === "warn") return "yellow";
  if (tone === "fail") return "red";
  if (tone === "preview") return "cyan";
  return "blue";
}

function frameWidth(): number {
  const columns = process.stdout.columns ?? 100;
  return Math.max(20, Math.min(columns, 96));
}

function statusMark(tone: RitualTone): string {
  if (tone === "pass") return "OK";
  if (tone === "warn") return "!!";
  if (tone === "fail") return "XX";
  if (tone === "preview") return "..";
  return "--";
}

function progressMark(status: RitualProgressStatus | undefined): string {
  if (status === "running") return "RUN";
  if (status === "waiting") return "WAIT";
  return "TODO";
}

function progressTone(status: RitualProgressStatus | undefined): RitualTone {
  if (status === "running") return "neutral";
  if (status === "waiting") return "warn";
  return "preview";
}

function countChangedWrites(report: InstallReport | ResetReport): number | undefined {
  const writes = report.setup?.writes;
  if (!writes) return undefined;
  return writes.filter((write) => write.status !== "unchanged").length;
}

function installModel(report: InstallReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const steps: RitualStep[] = [];
  if (report.cleanup) steps.push({ label: "home cleanup", status: "pass", detail: `${report.cleanup.actions.length} action(s)` });
  if (report.setup) steps.push({
    label: "OpenCode profile",
    status: report.setup.warnings.length > 0 ? "warn" : "pass",
    detail: `${countChangedWrites(report) ?? 0} write(s), ${report.setup.commands.filter((item) => item.status !== "skipped").length} command(s)`,
  });
  steps.push(report.check
    ? { label: "full check", status: toneFromOutcome(report.check.outcome), detail: `${report.check.steps.length} step(s)` }
    : { label: "full check", status: "preview", detail: "skipped" });

  return {
    title: titleForKind("install"),
    subtitle: report.homeMode ? "home/global profile" : report.projectRoot,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "mode", value: report.homeMode ? "global" : "project" },
      { label: "version", value: report.version },
      { label: "warnings", value: String(report.warnings.length), tone: report.warnings.length > 0 ? "warn" : "pass" },
    ],
    steps,
    callouts: report.warnings.slice(0, 5),
    next: tone === "fail"
      ? ["Run ogb dashboard for details.", "Run ogb check --plain if you need the classic report."]
      : report.outcome === "preview"
        ? ["Run ogb install without --dry-run to apply this plan."]
        : ["OpenCode profile is ready.", "Run ogb check any time you want the full ritual."],
    files: report.check ? [report.check.files.pass, report.check.files.dashboard] : [],
  };
}

function checkModel(report: PassReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  return {
    title: titleForKind("check"),
    subtitle: report.projectRoot,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "automated", value: String(report.automated.length) },
      { label: "skills", value: String(report.sync?.skills ?? 0) },
      { label: "commands", value: String((report.sync?.builtInCommands ?? 0) + (report.sync?.extensionCommands ?? 0)) },
      { label: "agents", value: String((report.sync?.builtInAgents ?? 0) + (report.sync?.extensionAgents ?? 0)) },
      { label: "blockers", value: String(report.blockers.length), tone: report.blockers.some((item) => item.severity === "fail") ? "fail" : report.blockers.length > 0 ? "warn" : "pass" },
    ],
    steps: report.steps.map((step) => ({
      label: step.name,
      status: toneFromOutcome(step.status),
      detail: step.detail,
    })),
    callouts: report.blockers.slice(0, 5).map((item) => `${item.source}: ${item.message}`),
    next: report.blockers.length > 0
      ? report.blockers.slice(0, 3).map((item) => item.action)
      : ["Bridge is clean.", "OpenCode can start with the current global/project profile."],
    files: [report.files.pass, report.files.dashboard],
  };
}

function resetModel(report: ResetReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const steps: RitualStep[] = [
    { label: "websearch env", status: toneFromOutcome(report.exaEnv.status === "warning" ? "warn" : report.exaEnv.status === "preview" ? "preview" : "pass"), detail: report.exaEnv.message },
    { label: "home cleanup", status: "pass", detail: `${report.cleanup.actions.length} action(s)` },
  ];
  if (report.setup) steps.push({ label: "global UX", status: report.setup.warnings.length > 0 ? "warn" : "pass", detail: `${countChangedWrites(report) ?? 0} write(s)` });
  if (report.sync) steps.push({ label: "global sync", status: report.sync.warnings.length > 0 ? "warn" : "pass", detail: `${report.sync.projectedSkills.length} skill(s), ${report.sync.projectedCommands.length} command(s)` });
  if (report.doctor) steps.push({ label: "doctor", status: report.doctor.errors.length > 0 ? "fail" : report.doctor.warnings.length > 0 ? "warn" : "pass", detail: `${report.doctor.errors.length} error(s), ${report.doctor.warnings.length} warning(s)` });
  if (report.check) steps.push({ label: "full check", status: toneFromOutcome(report.check.outcome), detail: `${report.check.steps.length} step(s)` });

  return {
    title: titleForKind("reset"),
    subtitle: report.homeDir,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "version", value: report.version },
      { label: "cleanup", value: String(report.cleanup.actions.length) },
      { label: "warnings", value: String(report.warnings.length), tone: report.warnings.length > 0 ? "warn" : "pass" },
    ],
    steps,
    callouts: report.warnings.slice(0, 5),
    next: report.outcome === "preview"
      ? ["Run ogb reset --yes without --dry-run to apply this plan."]
      : report.outcome === "cancelled"
        ? ["Nothing was changed."]
        : ["Global OpenCode profile was rebuilt.", "Run ogb check if you want another verification pass."],
    files: [report.globalConfigPath, ...(report.check ? [report.check.files.pass, report.check.files.dashboard] : [])],
  };
}

function updateModel(report: SelfUpdateReport): RitualViewModel {
  const tone = toneFromOutcome(report.status);
  const postUpdateTone = toneFromOutcome(report.postUpdate?.status);
  const releaseFlagIndex = report.plan.delegation.args.indexOf("--release");
  const release = releaseFlagIndex >= 0 ? report.plan.delegation.args[releaseFlagIndex + 1] : undefined;
  return {
    title: titleForKind("update"),
    subtitle: report.message,
    statusLabel: labelFromTone(tone),
    tone,
    metrics: [
      { label: "release", value: release ?? "latest" },
      { label: "post-check", value: report.postUpdate?.status ?? "skipped", tone: report.postUpdate ? postUpdateTone : "neutral" },
      { label: "mode", value: report.status === "preview" ? "dry-run" : "apply" },
    ],
    steps: [
      { label: "download + bootstrap", status: tone, detail: report.command.join(" ") },
      ...(report.postUpdate ? [{ label: "post-update check", status: postUpdateTone, detail: report.postUpdate.message }] : []),
    ],
    callouts: report.status === "error" ? [report.message, report.postUpdate?.stderrTail, report.postUpdate?.stdoutTail].filter((item): item is string => Boolean(item)).slice(0, 3) : [],
    next: report.status === "preview"
      ? ["Run ogb update without --dry-run to apply this release."]
      : report.status === "applied"
        ? ["Restart OpenCode so the new plugin/sidebar code is loaded.", "Then run ogb check if you want a fresh human-readable pass."]
        : ["Run ogb dashboard for the last known bridge state.", "Use ogb update --plain for the classic command log."],
    files: [],
  };
}

export function ritualViewModel(kind: RitualKind, report: InstallReport | PassReport | ResetReport | SelfUpdateReport): RitualViewModel {
  if (kind === "install") return installModel(report as InstallReport);
  if (kind === "reset") return resetModel(report as ResetReport);
  if (kind === "update") return updateModel(report as SelfUpdateReport);
  return checkModel(report as PassReport);
}

export function ritualProgressModel(kind: RitualKind, subtitle: string, steps: RitualProgressStep[]): RitualProgressModel {
  const active = steps.find((step) => step.status === "running")?.label ?? steps[0]?.label ?? "prepare ritual";
  return {
    title: `${titleForKind(kind)} in progress`,
    subtitle,
    steps: steps.length > 0 ? steps : [{ label: "prepare ritual", status: "running" }],
    note: "The final report will appear when this ritual finishes.",
    active,
  };
}

export function shouldUseRitualUi(options: RitualUiOptions = {}): boolean {
  if (options.json || options.plain) return false;
  const env = options.env ?? process.env;
  if (env.CI || env.OGB_PLAIN === "1" || env.OGB_UI === "0") return false;
  return options.stdoutIsTTY ?? process.stdout.isTTY ?? false;
}

export function cleanInkFrame(raw: string): string {
  const withoutCursor = raw.replace(/\x1B\[\?25[lh]/g, "");
  const frames = withoutCursor
    .split(/\x1B\[(?:2J\x1B\[3J\x1B\[H|H\x1B\[2J|2J\x1B\[H)/g)
    .map((frame) => frame.trimEnd())
    .filter((frame) => frame.trim().length > 0);
  return frames.at(-1) ?? withoutCursor.trimEnd();
}

function SectionTitle(props: { children?: React.ReactNode }) {
  return React.createElement(Text, { bold: true, color: "white" }, props.children);
}

function MetricRow(props: { metric: RitualMetric }) {
  const tone = props.metric.tone ?? "neutral";
  return React.createElement(
    Box,
    { flexDirection: "row", marginRight: 2 },
    React.createElement(Text, { color: "gray" }, `${props.metric.label} `),
    React.createElement(Text, { bold: true, color: colorFromTone(tone) }, props.metric.value),
  );
}

function StepRow(props: { step: RitualStep }) {
  return React.createElement(
    Box,
    { flexDirection: "row" },
    React.createElement(Text, { color: colorFromTone(props.step.status), bold: true }, statusMark(props.step.status).padEnd(4)),
    React.createElement(Text, { bold: true }, props.step.label),
    props.step.detail ? React.createElement(Text, { color: "gray" }, `  ${props.step.detail}`) : null,
  );
}

function ProgressStepRow(props: { step: RitualProgressStep }) {
  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 0 },
    React.createElement(
      Box,
      { flexDirection: "row" },
      React.createElement(Text, { color: "gray" }, `${progressMark(props.step.status).padEnd(6)} `),
      React.createElement(Text, { bold: true }, props.step.label),
    ),
    props.step.detail ? React.createElement(Box, { marginLeft: 7 },
      React.createElement(Text, { color: "gray" }, props.step.detail),
    ) : null,
  );
}

function RitualApp(props: { model: RitualViewModel }) {
  const model = props.model;
  const borderColor = colorFromTone(model.tone);
  const children: React.ReactNode[] = [
    React.createElement(
      Box,
      { key: "hero", borderStyle: "round", borderColor: "gray", paddingX: 1, paddingY: 0, flexDirection: "column", width: frameWidth() },
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(Text, { color: borderColor, bold: true }, `[${model.statusLabel}] `),
        React.createElement(Text, { bold: true }, model.title),
      ),
      React.createElement(Text, { color: "gray" }, model.subtitle),
      React.createElement(
        Box,
        { flexDirection: "row", flexWrap: "wrap" },
        ...model.metrics.map((metric) => React.createElement(MetricRow, { key: metric.label, metric })),
      ),
    ),
  ];

  if (model.steps.length > 0) {
    children.push(
      React.createElement(Text, { key: "space-steps" }, ""),
      React.createElement(Box, { key: "steps-wrap", flexDirection: "column", marginLeft: 1 },
        React.createElement(SectionTitle, null, "Ritual"),
        ...model.steps.slice(0, 12).map((step) => React.createElement(StepRow, { key: step.label, step })),
      ),
    );
  }

  if (model.callouts.length > 0) {
    children.push(
      React.createElement(Text, { key: "space-callouts" }, ""),
      React.createElement(Box, { key: "callouts-wrap", flexDirection: "column", marginLeft: 1 },
        React.createElement(SectionTitle, null, model.tone === "fail" ? "Needs Attention" : "Notes"),
        ...model.callouts.map((callout, index) => React.createElement(Text, { key: `callout-${index}`, color: model.tone === "fail" ? "red" : "yellow" }, `- ${callout}`)),
      ),
    );
  }

  if (model.next.length > 0) {
    children.push(
      React.createElement(Text, { key: "space-next" }, ""),
      React.createElement(Box, { key: "next-wrap", flexDirection: "column", marginLeft: 1 },
        React.createElement(SectionTitle, null, "Next"),
        ...model.next.slice(0, 4).map((item, index) => React.createElement(Text, { key: `next-${index}`, color: "gray" }, `- ${item}`)),
      ),
    );
  }

  if (model.files.length > 0) {
    children.push(
      React.createElement(Text, { key: "space-files" }, ""),
      React.createElement(Box, { key: "files-wrap", flexDirection: "column", marginLeft: 1 },
        React.createElement(SectionTitle, null, "Files"),
        ...model.files.slice(0, 3).map((file, index) => React.createElement(Text, { key: `file-${index}`, color: "gray" }, `- ${file}`)),
      ),
    );
  }

  return React.createElement(Box, { flexDirection: "column" }, ...children);
}

function ProgressApp(props: { model: RitualProgressModel }) {
  const model = props.model;
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      { key: "hero", borderStyle: "round", borderColor: "gray", paddingX: 1, paddingY: 0, flexDirection: "column", width: frameWidth() },
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(Text, { color: "cyan", bold: true }, "◐ "),
        React.createElement(Text, { bold: true }, model.title),
      ),
      React.createElement(Text, { color: "gray" }, model.subtitle),
      React.createElement(Text, { color: "gray" }, `Working: ${model.active}`),
      React.createElement(Text, { color: "gray" }, model.note),
    ),
    React.createElement(Text, null, ""),
    React.createElement(Box, { flexDirection: "column", marginLeft: 1 },
      React.createElement(SectionTitle, null, "Todo"),
      ...model.steps.slice(0, 12).map((step, index) => React.createElement(ProgressStepRow, {
        key: `${step.label}-${index}`,
        step: { ...step, status: step.status ?? "queued" },
      })),
    ),
  );
}

async function renderFrame(node: React.ReactNode): Promise<void> {
  const output = new MemoryWriteStream(process.stdout.columns ?? 100);
  const processChunks: Buffer[] = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const captureProcessWrite = (chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    processChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8"));
    const done = typeof encoding === "function" ? encoding : callback;
    done?.();
    return true;
  };

  let instance: Instance | undefined;
  process.stdout.write = captureProcessWrite as typeof process.stdout.write;
  process.stderr.write = captureProcessWrite as typeof process.stderr.write;
  try {
    instance = render(node, {
      stdout: output as unknown as NodeJS.WriteStream,
      stderr: output as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    instance.unmount();
    instance.cleanup();
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }

  const raw = `${Buffer.concat(processChunks).toString("utf8")}${output.output()}`;
  const frame = cleanInkFrame(raw);
  if (frame.trim().length > 0) process.stdout.write(`${frame}\n`);
}

export async function renderRitualProgress(kind: RitualKind, subtitle: string, steps: RitualProgressStep[]): Promise<void> {
  await renderFrame(React.createElement(ProgressApp, { model: ritualProgressModel(kind, subtitle, steps) }));
}

export async function renderRitualReport(kind: RitualKind, report: InstallReport | PassReport | ResetReport | SelfUpdateReport): Promise<void> {
  await renderFrame(React.createElement(RitualApp, { model: ritualViewModel(kind, report) }));
}
