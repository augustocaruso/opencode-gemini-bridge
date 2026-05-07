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
        const activeCommands = report.commands.filter((command) => command.status !== "skipped").length;
        const status = report.warnings.length > 0 ? "warn" : "pass";
        emitRitualProgress(options.onProgress, {
          stepId: "profile",
          label: "Apply the OpenCode profile.",
          detail: options.resetGlobal ? "Overwrites global config from OGB defaults." : "Merges managed global settings and writes the project/global profile.",
          status,
          message: `${changedWrites} write(s), ${activeCommands} command(s).`,
        });
        const openCodeCommand = report.commands.find((command) => command.command.some((part) => /opencode-ai|opencode(?:\.cmd)?$/i.test(part)));
        emitRitualProgress(options.onProgress, {
          stepId: "opencode",
          label: "Verify OpenCode is available.",
          detail: "Installs or updates OpenCode when the platform flow allows it.",
          status: options.installOpenCode === false ? "skipped" : openCodeCommand?.status === "fail" ? "warn" : status,
          message: options.installOpenCode === false ? "Skipped by --no-install-opencode." : openCodeCommand?.message ?? "OpenCode availability was checked.",
        });
        emitRitualProgress(options.onProgress, {
          stepId: "plugins",
          label: "Install global OpenCode plugins.",
          detail: "Covers auth, fallback, sidebar, and OGB startup sync integrations.",
          status: options.installPlugins === false ? "skipped" : status,
          message: options.installPlugins === false ? "Skipped by --no-plugins." : `${activeCommands} setup command(s) checked.`,
        });
        emitRitualProgress(options.onProgress, {
          stepId: "project-profile",
          label: "Write the project or global profile.",
          detail: "Home uses global files; projects get the managed OGB profile.",
          status: options.writeProjectProfile === false ? "skipped" : status,
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
