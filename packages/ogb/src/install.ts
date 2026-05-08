import { cleanupHomeProjectArtifacts, type HomeCleanupReport } from "./home-cleanup.js";
import { buildInstallerPlan, type InstallerPlan } from "./installer-planner.js";
import { runPass, type PassReport } from "./pass.js";
import { resolveProjectPaths } from "./paths.js";
import { emitRitualProgress, progressStatusFromOutcome, type RitualProgressSink } from "./ritual-progress.js";
import { setupUx, type SetupUxReport } from "./setup-ux.js";
import { OGB_VERSION } from "./types.js";
import type { RulesyncMode } from "./rulesync.js";
import { writeStateRecord } from "./state-store.js";

export interface InstallOptions {
  projectRoot?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  force?: boolean;
  ux?: boolean;
  resetGlobal?: boolean;
  installOpenCode?: boolean;
  installPlugins?: boolean;
  installTuiDependencies?: boolean;
  writeProjectProfile?: boolean;
  cleanupHome?: boolean;
  check?: boolean;
  acceptHooks?: boolean;
  windows?: boolean;
  rulesyncMode?: RulesyncMode;
  onProgress?: RitualProgressSink;
}

export interface InstallReport {
  version: string;
  projectRoot: string;
  homeDir: string;
  homeMode: boolean;
  outcome: "pass" | "warn" | "fail" | "preview";
  plan: InstallerPlan;
  cleanup?: HomeCleanupReport;
  setup?: SetupUxReport;
  check?: PassReport;
  warnings: string[];
}

function installOutcome(options: InstallOptions, warnings: string[], check?: PassReport): InstallReport["outcome"] {
  if (options.dryRun) return "preview";
  if (check?.outcome) return check.outcome;
  return warnings.length > 0 ? "warn" : "pass";
}

type SetupCommand = SetupUxReport["commands"][number];
type SetupWrite = SetupUxReport["writes"][number];
type ProgressStatus = "pass" | "warn" | "skipped";

function writeNeedsAttention(write: SetupWrite | undefined): boolean {
  return write?.status === "conflict" || write?.status === "protected";
}

function commandNeedsAttention(command: SetupCommand): boolean {
  return command.status === "fail" || command.status === "skipped";
}

function statusFromWrites(writes: SetupWrite[]): ProgressStatus {
  return writes.some(writeNeedsAttention) ? "warn" : "pass";
}

function statusFromCommands(commands: SetupCommand[]): ProgressStatus {
  return commands.some(commandNeedsAttention) ? "warn" : "pass";
}

function setupProfileStatus(report: SetupUxReport): ProgressStatus {
  const profileWrites = report.writes.filter((write) => write.path !== report.ogbConfigPath);
  return statusFromWrites(profileWrites);
}

function setupProjectProfileStatus(report: SetupUxReport): ProgressStatus {
  if (!report.ogbConfigPath) return "pass";
  return writeNeedsAttention(report.writes.find((write) => write.path === report.ogbConfigPath)) ? "warn" : "pass";
}

function openCodeProgressMessage(command: SetupCommand | undefined): string {
  if (!command) return "OpenCode availability was checked.";
  if (command.status === "fail") return "OpenCode install/check failed; see Notes.";
  if (command.status === "preview") return "Would check OpenCode availability.";
  if (command.status === "skipped") return command.message;
  if (command.message === "OpenCode already available.") return command.message;
  return "OpenCode is available.";
}

export function runInstall(options: InstallOptions = {}): InstallReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const plan = buildInstallerPlan({
    intent: "install",
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    platform: options.platform,
    env: options.env,
    dryRun: options.dryRun,
    force: options.force,
    rulesyncMode: options.rulesyncMode,
    windows: options.windows,
  });
  const cleanup = options.cleanupHome === false
    ? undefined
    : (() => {
      emitRitualProgress(options.onProgress, {
        stepId: "cleanup",
        label: "Clean old home-project artifacts.",
        detail: "Backs up accidental home checkout files and removes empty leftovers.",
        status: "running",
      });
      try {
        const report = cleanupHomeProjectArtifacts({ homeDir: paths.homeDir, dryRun: options.dryRun });
        emitRitualProgress(options.onProgress, {
          stepId: "cleanup",
          label: "Clean old home-project artifacts.",
          detail: "Backs up accidental home checkout files and removes empty leftovers.",
          status: report.warnings.length > 0 ? "warn" : "pass",
          message: `${report.actions.length} action(s)${report.backupDir ? ", backup created" : ""}.`,
        });
        return report;
      } catch (error) {
        emitRitualProgress(options.onProgress, {
          stepId: "cleanup",
          label: "Clean old home-project artifacts.",
          detail: "Backs up accidental home checkout files and removes empty leftovers.",
          status: "fail",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
  if (options.cleanupHome === false) {
    emitRitualProgress(options.onProgress, {
      stepId: "cleanup",
      label: "Clean old home-project artifacts.",
      detail: "Backs up accidental home checkout files and removes empty leftovers.",
      status: "skipped",
      message: "Skipped by --no-cleanup-home.",
    });
  }

  const setup = options.ux === false
    ? undefined
    : (() => {
      emitRitualProgress(options.onProgress, {
        stepId: "profile",
        label: "Apply the OpenCode profile.",
        detail: options.resetGlobal ? "Overwrites global config from OGB defaults." : "Merges managed global settings and writes the project/global profile.",
        status: "running",
      });
      try {
        const report = setupUx({
          projectRoot: paths.projectRoot,
          homeDir: paths.homeDir,
          platform: options.platform,
          env: options.env,
          dryRun: options.dryRun,
          force: options.force,
          resetGlobal: options.resetGlobal,
          installOpenCode: options.installOpenCode,
          installPlugins: options.installPlugins,
          installTuiDependencies: options.installTuiDependencies,
          writeProjectProfile: options.writeProjectProfile,
        });
        const changedWrites = report.writes.filter((write) => write.status !== "unchanged").length;
        const pluginCommands = report.commands.filter((command) => command.role === "plugin" || command.role === "verify" || command.role === "auth");
        const activePluginCommands = pluginCommands.filter((command) => command.status !== "skipped").length;
        const profileStatus = setupProfileStatus(report);
        const openCodeCommand = report.commands.find((command) => command.role === "opencode");
        const openCodeStatus = openCodeCommand?.status === "fail" || openCodeCommand?.status === "skipped" ? "warn" : "pass";
        const pluginStatus = statusFromCommands(pluginCommands);
        const projectProfileStatus = setupProjectProfileStatus(report);
        emitRitualProgress(options.onProgress, {
          stepId: "profile",
          label: "Apply the OpenCode profile.",
          detail: options.resetGlobal ? "Overwrites global config from OGB defaults." : "Merges managed global settings and writes the project/global profile.",
          status: profileStatus,
          message: [
            `${changedWrites} write(s) checked.`,
            ...report.notices,
          ].join(" "),
        });
        emitRitualProgress(options.onProgress, {
          stepId: "opencode",
          label: "Verify OpenCode is available.",
          detail: "Installs or updates OpenCode when the platform flow allows it.",
          status: options.installOpenCode === false ? "skipped" : openCodeStatus,
          message: options.installOpenCode === false ? "Skipped by --no-install-opencode." : openCodeProgressMessage(openCodeCommand),
        });
        emitRitualProgress(options.onProgress, {
          stepId: "plugins",
          label: "Install global OpenCode plugins.",
          detail: "Covers auth, fallback, sidebar, and OGB startup sync integrations.",
          status: options.installPlugins === false ? "skipped" : pluginStatus,
          message: options.installPlugins === false ? "Skipped by --no-plugins." : `${activePluginCommands} setup command(s) checked.`,
        });
        emitRitualProgress(options.onProgress, {
          stepId: "project-profile",
          label: "Write the project or global profile.",
          detail: "Home uses global files; projects get the managed OGB profile.",
          status: options.writeProjectProfile === false ? "skipped" : projectProfileStatus,
          message: paths.homeMode ? "Home/global profile was used." : "Project profile was checked.",
        });
        return report;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const stepId of ["profile", "opencode", "plugins", "project-profile"]) {
          emitRitualProgress(options.onProgress, {
            stepId,
            label: stepId === "opencode" ? "Verify OpenCode is available." : stepId === "plugins" ? "Install global OpenCode plugins." : stepId === "project-profile" ? "Write the project or global profile." : "Apply the OpenCode profile.",
            detail: stepId === "opencode" ? "Installs or updates OpenCode when the platform flow allows it." : stepId === "plugins" ? "Covers auth, fallback, sidebar, and OGB startup sync integrations." : stepId === "project-profile" ? "Home uses global files; projects get the managed OGB profile." : "Merges managed global settings and writes the project/global profile.",
            status: "fail",
            message,
          });
        }
        throw error;
      }
    })();
  if (options.ux === false) {
    for (const [stepId, label] of [
      ["profile", "Apply the OpenCode profile."],
      ["opencode", "Verify OpenCode is available."],
      ["plugins", "Install global OpenCode plugins."],
      ["project-profile", "Write the project or global profile."],
    ] as const) {
      emitRitualProgress(options.onProgress, {
        stepId,
        label,
        detail: "Skipped because the OpenCode UX setup was disabled.",
        status: "skipped",
        message: "Skipped by --no-ux.",
      });
    }
  }

  const check = options.dryRun || options.check === false
    ? undefined
    : (() => {
      emitRitualProgress(options.onProgress, {
        stepId: "check",
        label: "Run the full bridge check.",
        detail: "Covers setup, sync, doctor, validation, security, and dashboard.",
        status: "running",
      });
      try {
        const report = runPass({
          projectRoot: paths.projectRoot,
          homeDir: paths.homeDir,
          dryRun: options.dryRun,
          force: options.force,
          acceptHooks: options.acceptHooks,
          windows: options.windows,
          silent: true,
          setExitCode: false,
          rulesyncMode: options.rulesyncMode,
        });
        emitRitualProgress(options.onProgress, {
          stepId: "check",
          label: "Run the full bridge check.",
          detail: "Covers setup, sync, doctor, validation, security, and dashboard.",
          status: progressStatusFromOutcome(report.outcome),
          message: report.outcome === "pass" ? "Full check is clean." : `Full check outcome: ${report.outcome}.`,
        });
        return report;
      } catch (error) {
        emitRitualProgress(options.onProgress, {
          stepId: "check",
          label: "Run the full bridge check.",
          detail: "Covers setup, sync, doctor, validation, security, and dashboard.",
          status: "fail",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
  if (options.dryRun || options.check === false) {
    emitRitualProgress(options.onProgress, {
      stepId: "check",
      label: "Run the full bridge check.",
      detail: "Covers setup, sync, doctor, validation, security, and dashboard.",
      status: "skipped",
      message: options.dryRun ? "Skipped in dry-run preview." : "Skipped by --no-check.",
    });
  }
  const warnings = [
    ...(cleanup?.warnings ?? []),
    ...(setup?.warnings ?? []),
    ...(check?.blockers.filter((blocker) => blocker.severity === "warn").map((blocker) => `${blocker.source}: ${blocker.message}`) ?? []),
  ];

  const report: InstallReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    homeMode: paths.homeMode,
    outcome: installOutcome(options, warnings, check),
    plan,
    cleanup,
    setup,
    check,
    warnings,
  };
  if (!options.dryRun) writeStateRecord("install", report as unknown as Record<string, unknown>, { projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  return report;
}

function outcomeLabel(outcome: InstallReport["outcome"]): string {
  if (outcome === "preview") return "PREVIEW";
  return outcome.toUpperCase();
}

export function printInstallReport(report: InstallReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const title = report.outcome === "preview"
    ? "OpenCode Gemini Bridge install preview"
    : "OpenCode Gemini Bridge install complete";
  console.log(title);
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Mode: ${report.homeMode ? "home/global" : "project"}`);
  if (report.cleanup) {
    console.log(`Cleanup: ${report.cleanup.actions.length} action(s)${report.cleanup.backupDir ? `, backup ${report.cleanup.backupDir}` : ""}`);
  }
  if (report.setup) {
    const writes = report.setup.writes.filter((write) => write.status !== "unchanged").length;
    const commands = report.setup.commands.filter((command) => command.status !== "skipped").length;
    console.log(`Global UX: ${writes} changed/previewed write(s), ${commands} command(s)`);
    for (const notice of report.setup.notices) console.log(`Notice: ${notice}`);
  } else {
    console.log("Global UX: skipped");
  }
  if (report.check) {
    console.log(`Check: ${outcomeLabel(report.check.outcome)}`);
    console.log(`Report: ${report.check.files.pass}`);
    console.log(`Dashboard: ${report.check.files.dashboard}`);
  } else {
    console.log("Check: skipped");
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
