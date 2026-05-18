import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, type Instance, useAnimation, useStdout } from "ink";
import type { InstallReport } from "./install.js";
import type { PassReport } from "./pass.js";
import type { ResetReport } from "./reset.js";
import { RITUAL_PROGRESS_SCHEMA_VERSION, type RitualFinishedJsonEvent, type RitualProgressDefinition, type RitualProgressEvent, type RitualProgressJsonEvent, type RitualProgressSink, type RitualProgressStatus } from "./ritual-progress.js";
import type { SelfUpdateReport } from "./self-update.js";
import { spawnCommand } from "./process.js";

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

export interface LiveRitualStep extends RitualProgressDefinition {
  status: RitualProgressStatus;
  message?: string;
}

export interface LiveRitualModel {
  kind: RitualKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: RitualTone;
  startedAt: number;
  finishedAt?: number;
  currentStepId?: string;
  steps: LiveRitualStep[];
  metrics: RitualMetric[];
  callouts: string[];
  next: string[];
  files: string[];
  final: boolean;
}

export interface RitualUiOptions {
  json?: boolean;
  plain?: boolean;
  progressJson?: boolean;
  stdoutIsTTY?: boolean;
  stdoutColumns?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunWithRitualUiOptions<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport> {
  kind: RitualKind;
  subtitle: string;
  steps: RitualProgressDefinition[];
  run: (sink: RitualProgressSink) => TReport | Promise<TReport>;
}

export interface RunWithRitualProcessUiOptions {
  kind: RitualKind;
  subtitle: string;
  steps: RitualProgressDefinition[];
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RitualProcessUiResult {
  exitCode: number;
  signal?: NodeJS.Signals | null;
}

interface RenderRitualOptions {
  animate: boolean;
}

export function titleForKind(kind: RitualKind): string {
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
  return "RUN";
}

function colorFromTone(tone: RitualTone): string {
  if (tone === "pass") return "green";
  if (tone === "warn") return "yellow";
  if (tone === "fail") return "red";
  if (tone === "preview") return "cyan";
  return "blue";
}

function toneFromProgress(status: RitualProgressStatus): RitualTone {
  if (status === "pass") return "pass";
  if (status === "warn") return "warn";
  if (status === "fail") return "fail";
  if (status === "skipped") return "preview";
  return "neutral";
}

function countChangedWrites(report: InstallReport | ResetReport): number | undefined {
  const writes = report.setup?.writes;
  if (!writes) return undefined;
  return writes.filter((write) => write.status !== "unchanged").length;
}

const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MAX_DISPLAY_LINE_LENGTH = 280;
const MIN_RITUAL_UI_COLUMNS = 80;
const RITUAL_UI_SPINNER_INTERVAL_MS = 1000;
const RITUAL_UI_MAX_FPS = 10;
const DEFAULT_RITUAL_UI_ROWS = 40;
const COMPACT_RITUAL_ROWS = 34;
const COMPACT_RITUAL_STEPS = 6;
const TIGHT_RITUAL_STEPS = 4;

function isTransferProgressLine(line: string): boolean {
  if (/^% Total\s+% Received\s+% Xferd/.test(line)) return true;
  if (/^Dload\s+Upload\s+Total\s+Spent\s+Left\s+Speed$/.test(line)) return true;
  if (/--:--:--/.test(line) && /^\d{1,3}\s+/.test(line)) return true;
  return false;
}

function truncateDisplayLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function compactDisplayLine(item: string | undefined, maxChars = MAX_DISPLAY_LINE_LENGTH): string | undefined {
  const text = item
    ?.replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "\n")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isTransferProgressLine(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return truncateDisplayLine(text, maxChars);
}

function uniqueLines(items: Array<string | undefined>, limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = compactDisplayLine(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function checkCallouts(report: PassReport | undefined, fallback: string[] = []): string[] {
  return uniqueLines([
    ...(report?.blockers.map((item) => `${item.source}: ${item.message}`) ?? []),
    ...fallback,
  ]);
}

function checkNext(report: PassReport | undefined, fallback: string[]): string[] {
  return uniqueLines([
    ...(report?.blockers.map((item) => item.action) ?? []),
    ...fallback,
  ], 4);
}

function unexpectedErrorNext(kind: RitualKind, message: string): string[] {
  const command = `ogb ${kind} --plain`;
  const generic = [
    `Run \`${command}\` to see the classic logs without the rich UI.`,
    "Then run `ogb dashboard --plain` to inspect the last persisted bridge status.",
  ];
  if (/ENOENT|not found|command not found|no such file|n.o . reconhecido/i.test(message)) {
    return [
      "Check whether Node, npm, OpenCode and OGB resolve on PATH in this shell.",
      `Run \`${command}\` after fixing PATH so the full native command output stays visible.`,
      "On Windows, open PowerShell 7 again after changing PATH or reinstalling shims.",
    ];
  }
  if (/EACCES|EPERM|permission|access denied|permiss/i.test(message)) {
    return [
      "Check file ownership/permissions for the path mentioned in the error.",
      `Run \`${command}\` again after granting write access or closing processes that may be locking the file.`,
    ];
  }
  if (/JSON|parse|Unexpected token/i.test(message)) {
    return [
      "Open the config file mentioned in the error and fix invalid JSON/JSONC syntax.",
      `Run \`${command}\` again; the same TODO item should move past FAIL once the file parses.`,
    ];
  }
  return generic;
}

function installModel(report: InstallReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const steps: RitualStep[] = [];
  if (report.cleanup) steps.push({ label: "home cleanup", status: report.cleanup.warnings.length > 0 ? "warn" : "pass", detail: `${report.cleanup.actions.length} action(s)` });
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
    callouts: checkCallouts(report.check, report.warnings),
    next: tone === "fail"
      ? checkNext(report.check, ["Run `ogb dashboard --plain` for the persisted bridge state.", "Run `ogb check --plain` for the classic report."])
      : report.outcome === "preview"
        ? ["Run ogb install without --dry-run to apply this plan."]
        : ["OpenCode profile is ready.", "Run ogb check any time you want the full ritual."],
    files: report.check ? [report.check.files.pass, report.check.files.dashboard] : [],
  };
}

function checkModel(report: PassReport): RitualViewModel {
  const tone = toneFromOutcome(report.outcome);
  const syncNotes = report.sync?.notes ?? [];
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
    callouts: [
      ...report.blockers.slice(0, 5).map((item) => `${item.source}: ${item.message}`),
      ...syncNotes.slice(0, Math.max(0, 5 - report.blockers.length)),
    ],
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
    { label: "home cleanup", status: report.cleanup.warnings.length > 0 ? "warn" : "pass", detail: `${report.cleanup.actions.length} action(s)` },
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
    callouts: checkCallouts(report.check, report.warnings),
    next: report.outcome === "preview"
      ? ["Run ogb reset --yes without --dry-run to apply this plan."]
      : report.outcome === "cancelled"
        ? ["Nothing was changed."]
        : report.check?.outcome === "fail"
          ? checkNext(report.check, ["Run `ogb check --plain` for the classic report."])
          : ["Global OpenCode profile was rebuilt.", "Run ogb check if you want another verification pass."],
    files: [report.globalConfigPath, ...(report.check ? [report.check.files.pass, report.check.files.dashboard] : [])],
  };
}

function updateModel(report: SelfUpdateReport): RitualViewModel {
  const postUpdateTone = toneFromOutcome(report.postUpdate?.status);
  const tone = report.status === "applied" && postUpdateTone === "warn"
    ? "warn"
    : toneFromOutcome(report.status);
  const releaseFlagIndex = report.plan.delegation.args.indexOf("--release");
  const release = releaseFlagIndex >= 0 ? report.plan.delegation.args[releaseFlagIndex + 1] : undefined;
  const bootstrapDetail = report.status === "preview"
    ? "Release pack download and installer would run."
    : report.status === "applied"
      ? "Release pack installed."
      : "Release pack install did not complete.";
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
      { label: "download + bootstrap", status: tone, detail: bootstrapDetail },
      ...(report.postUpdate ? [{ label: "post-update check", status: postUpdateTone, detail: report.postUpdate.message }] : []),
    ],
    callouts: report.status === "error" ? uniqueLines([report.message, report.stderrTail, report.stdoutTail, report.postUpdate?.stderrTail, report.postUpdate?.stdoutTail]) : [],
    next: report.status === "preview"
      ? ["Run ogb update without --dry-run to apply this release."]
      : report.status === "applied"
        ? ["Restart OpenCode so the new plugin/sidebar code is loaded.", "Then run ogb check if you want a fresh human-readable pass."]
        : report.postUpdate?.status === "fail" || report.postUpdate?.status === "error"
          ? ["Run `ogb check --plain --force` to inspect the post-update failure directly.", "Run `ogb dashboard --plain` for the last persisted bridge state."]
          : ["Run `ogb update --plain` so the bootstrap log is printed without the rich UI.", "Check Node/npm/PowerShell PATH and network access, then retry the same release."],
    files: [],
  };
}

export function ritualViewModel(kind: RitualKind, report: InstallReport | PassReport | ResetReport | SelfUpdateReport): RitualViewModel {
  if (kind === "install") return installModel(report as InstallReport);
  if (kind === "reset") return resetModel(report as ResetReport);
  if (kind === "update") return updateModel(report as SelfUpdateReport);
  return checkModel(report as PassReport);
}

export function createLiveRitualModel(
  kind: RitualKind,
  subtitle: string,
  steps: RitualProgressDefinition[],
  options: { now?: number } = {},
): LiveRitualModel {
  return {
    kind,
    title: titleForKind(kind),
    subtitle,
    statusLabel: "RUN",
    tone: "neutral",
    startedAt: options.now ?? Date.now(),
    currentStepId: steps[0]?.stepId,
    steps: (steps.length > 0 ? steps : [{ stepId: "prepare", label: "Prepare ritual.", detail: "Loading the workflow." }]).map((step) => ({
      ...step,
      status: "queued",
    })),
    metrics: [],
    callouts: [],
    next: [],
    files: [],
    final: false,
  };
}

export function applyRitualProgressEvent(model: LiveRitualModel, event: RitualProgressEvent): LiveRitualModel {
  const existingIndex = model.steps.findIndex((step) => step.stepId === event.stepId);
  const existing = existingIndex >= 0 ? model.steps[existingIndex] : undefined;
  const nextStep: LiveRitualStep = {
    stepId: event.stepId,
    label: event.label,
    detail: compactDisplayLine(event.detail, 180) ?? existing?.detail,
    optional: existing?.optional,
    status: event.status,
    message: compactDisplayLine(event.message),
  };
  const steps = existingIndex >= 0
    ? model.steps.map((step, index) => index === existingIndex ? { ...step, ...nextStep } : step)
    : [...model.steps, nextStep];
  return {
    ...model,
    steps,
    currentStepId: event.status === "running" ? event.stepId : model.currentStepId,
  };
}

function visibleTodoSteps(steps: LiveRitualStep[]): LiveRitualStep[] {
  return steps.filter((step) => !(step.optional && (step.status === "queued" || step.status === "skipped")));
}

function canonicalStepId(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("setup")) return "setup";
  if (normalized.includes("sync")) return "sync";
  if (normalized.includes("doctor")) return "doctor";
  if (normalized.includes("validate")) return "validate";
  if (normalized.includes("security")) return "security";
  if (normalized.includes("dashboard")) return "dashboard";
  if (normalized.includes("cleanup")) return "cleanup";
  if (normalized.includes("profile") || normalized.includes("ux")) return "profile";
  if (normalized.includes("plugin")) return "plugins";
  if (normalized.includes("check")) return "check";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function finalStepStatus(model: RitualViewModel, step: LiveRitualStep): LiveRitualStep {
  if (step.status !== "queued" && step.status !== "running") return step;
  const match = model.steps.find((candidate) => canonicalStepId(candidate.label) === step.stepId || candidate.label === step.label);
  if (!match) return { ...step, status: step.status === "running" ? "pass" : "skipped" };
  return {
    ...step,
    status: match.status === "pass" ? "pass" : match.status === "warn" ? "warn" : match.status === "fail" ? "fail" : "skipped",
    message: match.detail,
  };
}

export function finishLiveRitualModel(
  model: LiveRitualModel,
  report: InstallReport | PassReport | ResetReport | SelfUpdateReport,
  options: { now?: number } = {},
): LiveRitualModel {
  const view = ritualViewModel(model.kind, report);
  return {
    ...model,
    title: view.title,
    subtitle: view.subtitle,
    statusLabel: view.statusLabel,
    tone: view.tone,
    finishedAt: options.now ?? Date.now(),
    currentStepId: undefined,
    steps: model.steps.map((step) => finalStepStatus(view, step)),
    metrics: view.metrics,
    callouts: view.callouts,
    next: view.next,
    files: view.files,
    final: true,
  };
}

export function finishLiveRitualModelFromProgressEvent(
  model: LiveRitualModel,
  event: RitualFinishedJsonEvent,
  options: { now?: number } = {},
): LiveRitualModel {
  const tone = toneFromOutcome(event.outcome);
  return {
    ...model,
    statusLabel: event.summary?.statusLabel ?? labelFromTone(tone),
    tone,
    finishedAt: options.now ?? Date.now(),
    currentStepId: undefined,
    steps: model.steps.map((step) => step.status === "queued" || step.status === "running"
      ? { ...step, status: step.status === "running" ? progressStatusFromTone(tone) : "skipped" }
      : step),
    metrics: event.summary?.metrics ?? [],
    callouts: event.summary?.callouts ?? [],
    next: event.summary?.next ?? [],
    files: event.files ?? [],
    final: true,
  };
}

export function failLiveRitualModel(model: LiveRitualModel, error: unknown, options: { now?: number } = {}): LiveRitualModel {
  const message = error instanceof Error ? error.message : String(error);
  const steps = model.steps.map((step) => step.stepId === model.currentStepId || step.status === "running"
    ? { ...step, status: "fail" as const, message }
    : step);
  return {
    ...model,
    statusLabel: "FAIL",
    tone: "fail",
    finishedAt: options.now ?? Date.now(),
    steps,
    callouts: [message],
    next: unexpectedErrorNext(model.kind, message),
    final: true,
  };
}

function progressStatusFromTone(tone: RitualTone): RitualProgressStatus {
  if (tone === "pass") return "pass";
  if (tone === "warn") return "warn";
  if (tone === "fail") return "fail";
  if (tone === "preview") return "skipped";
  return "pass";
}

export function shouldUseRitualUi(options: RitualUiOptions = {}): boolean {
  if (options.json || options.plain || options.progressJson) return false;
  const env = options.env ?? process.env;
  const term = (env.TERM ?? "").toLowerCase();
  const columns = options.stdoutColumns ?? process.stdout.columns;
  if (
    env.CI
    || env.CODEX_CI
    || env.CODEX_SHELL
    || term === "dumb"
    || env.OGB_PLAIN === "1"
    || env.OGB_UI === "0"
  ) return false;
  if (typeof columns === "number" && columns > 0 && columns < MIN_RITUAL_UI_COLUMNS) return false;
  return options.stdoutIsTTY ?? process.stdout.isTTY ?? false;
}

export function shouldAnimateRitualUi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OGB_UI_ANIMATE !== "0";
}

export function cleanInkFrame(raw: string): string {
  const withoutCursor = raw.replace(/\x1B\[\?25[lh]/g, "");
  const frames = withoutCursor
    .split(/\x1B\[(?:2J\x1B\[3J\x1B\[H|H\x1B\[2J|2J\x1B\[H)/g)
    .map((frame) => frame.trimEnd())
    .filter((frame) => frame.trim().length > 0);
  return frames.at(-1) ?? withoutCursor.trimEnd();
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function statusText(status: RitualProgressStatus, spinner: string): string {
  if (status === "running") return spinner;
  if (status === "pass") return "OK";
  if (status === "warn") return "WARN";
  if (status === "fail") return "FAIL";
  if (status === "skipped") return "SKIP";
  return "....";
}

function SectionTitle(props: { children?: React.ReactNode }) {
  return React.createElement(Text, { bold: true, color: "white" }, props.children);
}

function MetricRow(props: { metric: RitualMetric }) {
  const tone = props.metric.tone ?? "neutral";
  return React.createElement(
    Box,
    { flexDirection: "row", marginRight: 3 },
    React.createElement(Text, { color: "gray" }, `${props.metric.label} `),
    React.createElement(Text, { bold: true, color: colorFromTone(tone) }, props.metric.value),
  );
}

function TodoRow(props: { step: LiveRitualStep; spinner: string; compact?: boolean }) {
  const tone = toneFromProgress(props.step.status);
  const active = props.step.status === "running";
  const muted = props.step.status === "queued" || props.step.status === "skipped";
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: props.compact ? 0 : 1 },
    React.createElement(
      Box,
      { flexDirection: "row" },
      React.createElement(Text, { color: colorFromTone(tone), bold: active || props.step.status === "fail" || props.step.status === "warn" }, `${statusText(props.step.status, props.spinner).padEnd(5)} `),
      React.createElement(Text, { bold: active, color: muted ? "gray" : undefined }, props.step.label),
    ),
    !props.compact && props.step.detail
      ? React.createElement(Box, { marginLeft: 6 },
        React.createElement(Text, { color: "gray" }, props.step.detail),
      )
      : null,
    !props.compact && props.step.message
      ? React.createElement(Box, { marginLeft: 6 },
        React.createElement(Text, { color: props.step.status === "fail" ? "red" : props.step.status === "warn" ? "yellow" : "gray" }, props.step.message),
      )
      : null,
  );
}

function BulletList(props: { title: string; items: string[]; tone?: RitualTone; limit?: number }) {
  if (props.items.length === 0) return null;
  const limit = Math.max(0, props.limit ?? 5);
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(SectionTitle, null, props.title),
    ...props.items.slice(0, limit).map((item, index) => React.createElement(Box, { key: `${props.title}-${index}`, marginTop: index === 0 ? 0 : 1 },
      React.createElement(Text, { color: props.tone ? colorFromTone(props.tone) : "gray" }, `- ${item}`),
    )),
  );
}

function useTerminalSize(): { width: number; rows: number } {
  const { stdout } = useStdout();
  const readSize = () => ({
    width: Math.max(20, stdout.columns ?? process.stdout.columns ?? 100),
    rows: Math.max(10, stdout.rows ?? process.stdout.rows ?? DEFAULT_RITUAL_UI_ROWS),
  });
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    const onResize = () => setSize(readSize());
    stdout.on?.("resize", onResize);
    process.stdout.on?.("resize", onResize);
    onResize();
    return () => {
      stdout.off?.("resize", onResize);
      process.stdout.off?.("resize", onResize);
    };
  }, [stdout]);
  return size;
}

function compactStepWindow(steps: LiveRitualStep[], currentStepId: string | undefined, maxSteps: number): LiveRitualStep[] {
  if (steps.length <= maxSteps) return steps;
  const currentIndex = Math.max(0, steps.findIndex((step) => step.stepId === currentStepId));
  const start = Math.min(Math.max(0, currentIndex - 2), Math.max(0, steps.length - maxSteps));
  return steps.slice(start, start + maxSteps);
}

function compactFinalSteps(steps: LiveRitualStep[], maxSteps: number): LiveRitualStep[] {
  if (steps.length <= maxSteps) return steps;
  const problemIds = new Set(
    steps
      .filter((step) => step.status === "fail" || step.status === "warn")
      .map((step) => step.stepId),
  );
  if (problemIds.size > 0) return steps.filter((step) => problemIds.has(step.stepId)).slice(0, maxSteps);
  const skippedIds = new Set(steps.filter((step) => step.status === "skipped").map((step) => step.stepId));
  if (skippedIds.size === 0) return steps.slice(-maxSteps);
  const importantIds = skippedIds;
  return steps.filter((step) => importantIds.has(step.stepId)).slice(0, maxSteps);
}

export function RitualPanel(props: { model: LiveRitualModel; animate: boolean }) {
  const model = props.model;
  const visibleSteps = visibleTodoSteps(model.steps);
  const { width, rows } = useTerminalSize();
  const animation = useAnimation({
    interval: RITUAL_UI_SPINNER_INTERVAL_MS,
    isActive: props.animate && !model.final,
  });
  const spinnerFrames = useMemo(() => ["◐", "◓", "◑", "◒"], []);
  const spinner = props.animate ? spinnerFrames[animation.frame % spinnerFrames.length] : "RUN";
  const current = visibleSteps.find((step) => step.status === "running")
    ?? visibleSteps.find((step) => step.stepId === model.currentStepId)
    ?? visibleSteps.find((step) => step.status === "queued")
    ?? visibleSteps.at(-1);
  const activeNow = props.animate && !model.final ? model.startedAt + animation.time : Date.now();
  const elapsed = formatElapsed((model.finishedAt ?? activeNow) - model.startedAt);
  const headerStatus = model.final ? elapsed : "running";
  const borderColor = model.final ? colorFromTone(model.tone) : "gray";
  const headline = model.final ? model.statusLabel : "RUN";
  const compact = rows <= COMPACT_RITUAL_ROWS || visibleSteps.length > COMPACT_RITUAL_STEPS || (model.final && model.callouts.length > 2);
  const maxSteps = rows <= 28 ? TIGHT_RITUAL_STEPS : COMPACT_RITUAL_STEPS;
  const displayedSteps = compact
    ? model.final
      ? compactFinalSteps(visibleSteps, maxSteps)
      : compactStepWindow(visibleSteps, current?.stepId ?? model.currentStepId, maxSteps)
    : visibleSteps;
  const bulletLimit = compact ? rows <= 28 ? 1 : 2 : 5;
  const todoTitle = compact && displayedSteps.length < visibleSteps.length ? `TODOs ${displayedSteps.length}/${visibleSteps.length}` : "TODOs";

  return React.createElement(
    Box,
    { borderStyle: "round", borderColor, paddingX: 1, paddingY: 0, flexDirection: "column", width },
    React.createElement(
      Box,
      { flexDirection: "row", justifyContent: "space-between" },
      React.createElement(Box, { flexDirection: "row" },
        React.createElement(Text, { color: model.final ? colorFromTone(model.tone) : "cyan", bold: true }, `${headline} `),
        React.createElement(Text, { bold: true }, model.title),
      ),
      React.createElement(Text, { color: "gray" }, headerStatus),
    ),
    React.createElement(Text, { color: "gray" }, model.subtitle),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, { color: "gray" }, model.final
        ? model.tone === "pass"
          ? "Final report: bridge is clean."
          : model.tone === "warn"
            ? "Final report: review the warnings below."
            : model.tone === "fail"
              ? "Final report: blockers need attention."
              : "Final report: preview completed."
        : `Working: ${current?.label ?? "Preparing ritual."}`),
      current?.message && !model.final ? React.createElement(Text, { color: "gray" }, current.message) : null,
    ),
    model.metrics.length > 0
      ? React.createElement(Box, { flexDirection: "row", flexWrap: "wrap", marginTop: 1 },
        ...model.metrics.map((metric) => React.createElement(MetricRow, { key: metric.label, metric })),
      )
      : null,
    React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      React.createElement(SectionTitle, null, todoTitle),
      ...displayedSteps.map((step) => React.createElement(TodoRow, { key: step.stepId, step, spinner, compact })),
    ),
    React.createElement(BulletList, { title: model.tone === "fail" ? "Problems" : "Notes", items: model.callouts, tone: model.tone === "fail" ? "fail" : "warn", limit: bulletLimit }),
    React.createElement(BulletList, { title: "Next", items: model.next, limit: bulletLimit }),
    React.createElement(BulletList, { title: "Reports", items: model.files, limit: compact ? 1 : 5 }),
  );
}

function renderModel(instance: Instance | undefined, model: LiveRitualModel, options: RenderRitualOptions): Instance {
  const node = React.createElement(RitualPanel, { model, animate: options.animate });
  if (instance) {
    instance.rerender(node);
    return instance;
  }
  return render(node, {
    exitOnCtrlC: false,
    incrementalRendering: true,
    maxFps: RITUAL_UI_MAX_FPS,
    patchConsole: false,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithRitualUi<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport>(
  options: RunWithRitualUiOptions<TReport>,
): Promise<TReport> {
  let model = createLiveRitualModel(options.kind, options.subtitle, options.steps);
  let instance: Instance | undefined;
  const renderOptions = { animate: shouldAnimateRitualUi() };
  instance = renderModel(instance, model, renderOptions);
  await delay(25);

  const sink: RitualProgressSink = (event) => {
    model = applyRitualProgressEvent(model, event);
    instance = renderModel(instance, model, renderOptions);
  };

  try {
    const report = await options.run(sink);
    model = finishLiveRitualModel(model, report);
    instance = renderModel(instance, model, renderOptions);
    await delay(40);
    return report;
  } catch (error) {
    model = failLiveRitualModel(model, error);
    instance = renderModel(instance, model, renderOptions);
    await delay(40);
    throw error;
  } finally {
    instance?.unmount();
    instance?.cleanup();
  }
}

function parseProgressLine(line: string): RitualProgressJsonEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Partial<RitualProgressJsonEvent>;
    if (parsed.schemaVersion !== RITUAL_PROGRESS_SCHEMA_VERSION || typeof parsed.type !== "string") return undefined;
    return parsed as RitualProgressJsonEvent;
  } catch {
    return undefined;
  }
}

function tailText(text: string, maxLines = 6): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .join("\n");
}

export async function runWithRitualProcessUi(options: RunWithRitualProcessUiOptions): Promise<RitualProcessUiResult> {
  let model = createLiveRitualModel(options.kind, options.subtitle, options.steps);
  let instance: Instance | undefined;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalReceived = false;
  const renderOptions = { animate: shouldAnimateRitualUi() };
  instance = renderModel(instance, model, renderOptions);
  await delay(25);

  const child = spawnCommand(options.command, options.args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseProgressLine(line);
      if (!event) {
        stderrBuffer += `${line}\n`;
        continue;
      }
      if (event.type === "ritual.started") {
        model = { ...model, steps: event.steps.map((step) => ({ ...step, status: "queued" })) };
      } else if (event.type === "ritual.step") {
        model = applyRitualProgressEvent(model, event);
      } else if (event.type === "ritual.finished") {
        finalReceived = true;
        model = finishLiveRitualModelFromProgressEvent(model, event);
      } else if (event.type === "ritual.error") {
        finalReceived = true;
        model = failLiveRitualModel(model, new Error(event.error));
        model = { ...model, next: event.summary?.next ?? model.next };
      }
      instance = renderModel(instance, model, renderOptions);
    }
  });

  child.stderr?.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  const result = await new Promise<RitualProcessUiResult>((resolve) => {
    child.on("error", (error) => {
      model = failLiveRitualModel(model, error);
      instance = renderModel(instance, model, renderOptions);
      resolve({ exitCode: 2 });
    });
    child.on("exit", (code, signal) => {
      if (stdoutBuffer.trim()) {
        const event = parseProgressLine(stdoutBuffer);
        if (event?.type === "ritual.finished") {
          finalReceived = true;
          model = finishLiveRitualModelFromProgressEvent(model, event);
        } else if (event?.type === "ritual.error") {
          finalReceived = true;
          model = failLiveRitualModel(model, new Error(event.error));
        }
      }
      const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
      if (!finalReceived) {
        const tail = tailText(stderrBuffer) || `Ritual process exited with code ${exitCode}.`;
        model = failLiveRitualModel(model, new Error(tail));
      }
      instance = renderModel(instance, model, renderOptions);
      resolve({ exitCode, signal });
    });
  });

  await delay(40);
  instance?.unmount();
  instance?.cleanup();
  return result;
}
