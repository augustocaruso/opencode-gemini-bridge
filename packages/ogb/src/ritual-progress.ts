export type RitualProgressStatus = "queued" | "running" | "pass" | "warn" | "fail" | "skipped";
export type RitualKind = "install" | "check" | "reset" | "update";
export type RitualProgressEventType = "ritual.started" | "ritual.step" | "ritual.finished" | "ritual.error";

export const RITUAL_PROGRESS_SCHEMA_VERSION = "ogb.progress.v1";

export interface RitualProgressEvent {
  stepId: string;
  label: string;
  detail?: string;
  status: RitualProgressStatus;
  message?: string;
}

export type RitualProgressSink = (event: RitualProgressEvent) => void;

export interface RitualProgressDefinition {
  stepId: string;
  label: string;
  detail?: string;
  optional?: boolean;
}

export interface RitualProgressMetric {
  label: string;
  value: string;
  tone?: "pass" | "warn" | "fail" | "preview" | "neutral";
}

export interface RitualProgressSummary {
  title?: string;
  statusLabel?: string;
  metrics?: RitualProgressMetric[];
  callouts?: string[];
  next?: string[];
}

export interface RitualProgressBaseJsonEvent {
  schemaVersion: typeof RITUAL_PROGRESS_SCHEMA_VERSION;
  ritualId: string;
  kind: RitualKind;
  timestamp: string;
  type: RitualProgressEventType;
}

export interface RitualStartedJsonEvent extends RitualProgressBaseJsonEvent {
  type: "ritual.started";
  steps: RitualProgressDefinition[];
}

export interface RitualStepJsonEvent extends RitualProgressBaseJsonEvent, RitualProgressEvent {
  type: "ritual.step";
}

export interface RitualFinishedJsonEvent extends RitualProgressBaseJsonEvent {
  type: "ritual.finished";
  outcome: string;
  exitCode: number;
  summary?: RitualProgressSummary;
  files?: string[];
}

export interface RitualErrorJsonEvent extends RitualProgressBaseJsonEvent {
  type: "ritual.error";
  exitCode: number;
  error: string;
  stepId?: string;
  summary?: RitualProgressSummary;
}

export type RitualProgressJsonEvent =
  | RitualStartedJsonEvent
  | RitualStepJsonEvent
  | RitualFinishedJsonEvent
  | RitualErrorJsonEvent;

export interface CheckProgressOptions {
  setup?: boolean;
  sync?: boolean;
  extensionUpdate?: boolean;
  patches?: boolean;
  acceptHooks?: boolean;
  validation?: boolean;
  security?: boolean;
  dashboard?: boolean;
  windows?: boolean;
}

export interface InstallProgressOptions {
  dryRun?: boolean;
  ux?: boolean;
  resetGlobal?: boolean;
  installOpencode?: boolean;
  plugins?: boolean;
  projectProfile?: boolean;
  cleanupHome?: boolean;
  check?: boolean;
  windows?: boolean;
}

export interface ResetProgressOptions {
  yes?: boolean;
  dryRun?: boolean;
  installOpencode?: boolean;
  plugins?: boolean;
}

export interface UpdateProgressOptions {
  release?: string;
  setup?: boolean;
  installOpencode?: boolean;
  dryRun?: boolean;
  windows?: boolean;
}

export const CHECK_PROGRESS_STEPS = {
  setup: {
    stepId: "setup",
    label: "Ensure OpenCode startup sync is installed.",
    detail: "Checks the plugin file, global registration, and command wiring.",
  },
  sync: {
    stepId: "sync",
    label: "Sync Gemini resources into OpenCode.",
    detail: "Projects context, MCPs, agents, commands, and skills into the right scope.",
  },
  extensionUpdate: {
    stepId: "extension-update",
    label: "Update Gemini extensions.",
    detail: "Runs Gemini CLI extension updates before projecting resources into OpenCode.",
  },
  doctor: {
    stepId: "doctor",
    label: "Inspect the bridge inventory with doctor.",
    detail: "Looks for missing generated files, plugin state, extension risk, and stale status.",
  },
  hookReview: {
    stepId: "hook-review",
    label: "Record legacy hook review hashes.",
    detail: "Stores trusted hashes for unsupported hook events when --accept-hooks is used.",
  },
  validate: {
    stepId: "validate",
    label: "Validate the resolved OpenCode configuration.",
    detail: "Checks global/project config, instructions, MCPs, and plugin references.",
  },
  security: {
    stepId: "security",
    label: "Run the security guardrails.",
    detail: "Reviews YOLO permissions, secret patterns, MCP env, and extension trust surface.",
  },
  dashboard: {
    stepId: "dashboard",
    label: "Refresh the dashboard summary.",
    detail: "Writes the final status, warnings, next actions, and report paths.",
  },
  patchPreExtensionUpdate: {
    stepId: "patches-pre-extension-update",
    label: "Apply OGB patches before Gemini extension updates.",
    detail: "Runs authorized, versioned fixes that must happen before Gemini CLI changes.",
    optional: true,
  },
  patchPostExtensionUpdate: {
    stepId: "patches-post-extension-update",
    label: "Apply OGB patches after Gemini extension updates.",
    detail: "Runs authorized, versioned fixes that depend on updated Gemini extensions.",
    optional: true,
  },
  patchPreSync: {
    stepId: "patches-pre-sync",
    label: "Apply OGB patches before sync.",
    detail: "Prepares managed files and state before projecting Gemini resources.",
    optional: true,
  },
  patchPostSync: {
    stepId: "patches-post-sync",
    label: "Apply OGB patches after sync.",
    detail: "Repairs or hardens managed files produced by the sync.",
    optional: true,
  },
  patchPreDoctor: {
    stepId: "patches-pre-doctor",
    label: "Apply OGB patches before doctor.",
    detail: "Normalizes diagnostics state before inventory checks run.",
    optional: true,
  },
  patchPostCheck: {
    stepId: "patches-post-check",
    label: "Apply OGB patches after check.",
    detail: "Records final repair state after validation, security, and dashboard.",
    optional: true,
  },
} as const satisfies Record<string, RitualProgressDefinition>;

export const INSTALL_PROGRESS_STEPS = {
  cleanup: {
    stepId: "cleanup",
    label: "Clean old home-project artifacts.",
    detail: "Backs up accidental home checkout files and removes empty leftovers.",
  },
  profile: {
    stepId: "profile",
    label: "Apply the OpenCode profile.",
    detail: "Merges managed global settings without replacing user-owned fields.",
  },
  opencode: {
    stepId: "opencode",
    label: "Verify OpenCode is available.",
    detail: "Installs or updates OpenCode when the platform flow allows it.",
  },
  plugins: {
    stepId: "plugins",
    label: "Install global OpenCode plugins.",
    detail: "Covers auth, fallback, sidebar, and OGB startup sync integrations.",
  },
  projectProfile: {
    stepId: "project-profile",
    label: "Write the project profile when appropriate.",
    detail: "Skipped automatically when the target is the home/global scope.",
  },
  check: {
    stepId: "check",
    label: "Run the full bridge check.",
    detail: "Covers setup, sync, doctor, validation, security, and dashboard.",
  },
} as const satisfies Record<string, RitualProgressDefinition>;

export const RESET_PROGRESS_STEPS = {
  confirm: {
    stepId: "confirm",
    label: "Confirm the home reset.",
    detail: "Waits for the RESET confirmation prompt.",
  },
  env: {
    stepId: "env",
    label: "Configure OpenCode websearch support.",
    detail: "Persists OPENCODE_ENABLE_EXA=1 when the platform allows it.",
  },
  cleanup: {
    stepId: "cleanup",
    label: "Clean old home-project artifacts.",
    detail: "Backs up accidental project files before removing them.",
  },
  setup: {
    stepId: "setup",
    label: "Overwrite the global OpenCode profile.",
    detail: "Rebuilds global config, commands, agents, and sidebar files.",
  },
  opencode: {
    stepId: "opencode",
    label: "Verify OpenCode is available.",
    detail: "Installs or updates OpenCode when needed.",
  },
  plugins: {
    stepId: "plugins",
    label: "Install global OpenCode plugins.",
    detail: "Covers auth, fallback, sidebar, and startup sync integrations.",
  },
  sync: {
    stepId: "sync",
    label: "Sync Gemini globals into OpenCode.",
    detail: "Projects context, MCPs, agents, commands, and skills into global scope.",
  },
  doctor: {
    stepId: "doctor",
    label: "Run doctor.",
    detail: "Performs compatibility checks after reset.",
  },
  check: {
    stepId: "check",
    label: "Run the full bridge check.",
    detail: "Verifies setup, sync, validation, security, and dashboard.",
  },
} as const satisfies Record<string, RitualProgressDefinition>;

export const UPDATE_PROGRESS_STEPS = {
  resolve: {
    stepId: "resolve",
    label: "Resolve the requested release.",
    detail: "Uses the latest GitHub release.",
  },
  download: {
    stepId: "download",
    label: "Download the official release pack.",
    detail: "Runs the platform bootstrap script for this machine.",
  },
  install: {
    stepId: "install",
    label: "Apply the installer.",
    detail: "Replaces the OGB CLI and managed profile files.",
  },
  postCheck: {
    stepId: "post-check",
    label: "Run the full post-update check.",
    detail: "Refreshes setup, sync, doctor, validation, security, and dashboard.",
  },
} as const satisfies Record<string, RitualProgressDefinition>;

export function checkProgressSteps(options: CheckProgressOptions = {}): RitualProgressDefinition[] {
  const syncEnabled = options.sync !== false;
  const extensionUpdateEnabled = syncEnabled && options.extensionUpdate !== false;
  const patchesEnabled = options.patches !== false;
  return [
    ...(options.setup === false ? [] : [CHECK_PROGRESS_STEPS.setup]),
    ...(extensionUpdateEnabled
      ? [
        ...(patchesEnabled ? [CHECK_PROGRESS_STEPS.patchPreExtensionUpdate] : []),
        CHECK_PROGRESS_STEPS.extensionUpdate,
        ...(patchesEnabled ? [CHECK_PROGRESS_STEPS.patchPostExtensionUpdate] : []),
      ]
      : []),
    ...(syncEnabled
      ? [
        ...(patchesEnabled ? [CHECK_PROGRESS_STEPS.patchPreSync] : []),
        CHECK_PROGRESS_STEPS.sync,
        ...(patchesEnabled ? [CHECK_PROGRESS_STEPS.patchPostSync] : []),
      ]
      : []),
    ...(patchesEnabled ? [CHECK_PROGRESS_STEPS.patchPreDoctor] : []),
    CHECK_PROGRESS_STEPS.doctor,
    ...(options.acceptHooks ? [CHECK_PROGRESS_STEPS.hookReview] : []),
    ...(options.validation === false ? [] : [{
      ...CHECK_PROGRESS_STEPS.validate,
      detail: options.windows ? "Includes Windows command/path checks." : CHECK_PROGRESS_STEPS.validate.detail,
    }]),
    ...(options.security === false ? [] : [CHECK_PROGRESS_STEPS.security]),
    ...(options.dashboard === false ? [] : [CHECK_PROGRESS_STEPS.dashboard]),
    ...(patchesEnabled ? [CHECK_PROGRESS_STEPS.patchPostCheck] : []),
  ];
}

export function installProgressSteps(options: InstallProgressOptions = {}): RitualProgressDefinition[] {
  return [
    {
      ...INSTALL_PROGRESS_STEPS.cleanup,
      detail: options.cleanupHome === false ? "Skipped by --no-cleanup-home." : INSTALL_PROGRESS_STEPS.cleanup.detail,
    },
    {
      ...INSTALL_PROGRESS_STEPS.profile,
      detail: options.ux === false
        ? "Skipped by --no-ux."
        : options.resetGlobal
          ? "Overwrites global config from OGB defaults."
          : INSTALL_PROGRESS_STEPS.profile.detail,
    },
    {
      ...INSTALL_PROGRESS_STEPS.opencode,
      detail: options.installOpencode === false ? "Skipped by --no-install-opencode." : INSTALL_PROGRESS_STEPS.opencode.detail,
    },
    {
      ...INSTALL_PROGRESS_STEPS.plugins,
      detail: options.plugins === false ? "Skipped by --no-plugins." : INSTALL_PROGRESS_STEPS.plugins.detail,
    },
    {
      ...INSTALL_PROGRESS_STEPS.projectProfile,
      detail: options.projectProfile === false ? "Skipped by --no-project-profile." : INSTALL_PROGRESS_STEPS.projectProfile.detail,
    },
    {
      ...INSTALL_PROGRESS_STEPS.check,
      detail: options.dryRun ? "Skipped in dry-run preview." : options.windows ? "Includes Windows validation." : INSTALL_PROGRESS_STEPS.check.detail,
    },
  ];
}

export function resetProgressSteps(options: ResetProgressOptions = {}): RitualProgressDefinition[] {
  return [
    {
      ...RESET_PROGRESS_STEPS.confirm,
      detail: options.yes ? "--yes accepted." : options.dryRun ? "Preview mode; no files are changed." : RESET_PROGRESS_STEPS.confirm.detail,
    },
    RESET_PROGRESS_STEPS.env,
    RESET_PROGRESS_STEPS.cleanup,
    RESET_PROGRESS_STEPS.setup,
    {
      ...RESET_PROGRESS_STEPS.opencode,
      detail: options.installOpencode === false ? "Skipped by --no-install-opencode." : RESET_PROGRESS_STEPS.opencode.detail,
    },
    {
      ...RESET_PROGRESS_STEPS.plugins,
      detail: options.plugins === false ? "Skipped by --no-plugins." : RESET_PROGRESS_STEPS.plugins.detail,
    },
    RESET_PROGRESS_STEPS.sync,
    RESET_PROGRESS_STEPS.doctor,
    RESET_PROGRESS_STEPS.check,
  ];
}

export function updateProgressSteps(options: UpdateProgressOptions = {}): RitualProgressDefinition[] {
  const includePostCheckSteps = options.setup !== false && !options.dryRun;
  return [
    {
      ...UPDATE_PROGRESS_STEPS.resolve,
      detail: options.release && options.release !== "latest" ? options.release : UPDATE_PROGRESS_STEPS.resolve.detail,
    },
    UPDATE_PROGRESS_STEPS.download,
    {
      ...UPDATE_PROGRESS_STEPS.install,
      detail: options.dryRun ? "Preview only; no files are changed." : UPDATE_PROGRESS_STEPS.install.detail,
    },
    {
      ...UPDATE_PROGRESS_STEPS.postCheck,
      detail: options.setup === false
        ? "Skipped by --no-setup."
        : options.installOpencode === false
          ? "Verifies the bridge without installing OpenCode."
          : UPDATE_PROGRESS_STEPS.postCheck.detail,
    },
    ...(includePostCheckSteps ? checkProgressSteps({ windows: options.windows }) : []),
  ];
}

export function knownStepIds(kind: RitualKind, options: CheckProgressOptions | InstallProgressOptions | ResetProgressOptions | UpdateProgressOptions = {}): string[] {
  if (kind === "check") return checkProgressSteps(options as CheckProgressOptions).map((step) => step.stepId);
  if (kind === "install") return installProgressSteps(options as InstallProgressOptions).map((step) => step.stepId);
  if (kind === "reset") return resetProgressSteps(options as ResetProgressOptions).map((step) => step.stepId);
  return updateProgressSteps(options as UpdateProgressOptions).map((step) => step.stepId);
}

export function createRitualId(kind: RitualKind, now: Date = new Date()): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${kind}-${now.toISOString().replace(/[^0-9A-Za-z]+/g, "")}-${random}`;
}

export function writeRitualProgressJsonEvent(event: RitualProgressJsonEvent, write: (line: string) => void = (line) => process.stdout.write(line)): void {
  write(`${JSON.stringify(event)}\n`);
}

export function emitRitualProgress(sink: RitualProgressSink | undefined, event: RitualProgressEvent): void {
  sink?.(event);
}

export function progressStatusFromOutcome(outcome: string | undefined): RitualProgressStatus {
  if (outcome === "pass" || outcome === "applied") return "pass";
  if (outcome === "warn") return "warn";
  if (outcome === "fail" || outcome === "error") return "fail";
  if (outcome === "preview" || outcome === "skipped" || outcome === "cancelled") return "skipped";
  return "pass";
}

export function progressStatusFromFindings(errors: number, warnings: number): RitualProgressStatus {
  if (errors > 0) return "fail";
  if (warnings > 0) return "warn";
  return "pass";
}
