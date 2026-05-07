import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { cleanupHomeProjectArtifacts, type HomeCleanupReport } from "./home-cleanup.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { buildInstallerPlan, type InstallerPlan } from "./installer-planner.js";
import { runNativeCommand } from "./native-runner.js";
import { runPass, type PassReport } from "./pass.js";
import { createPlatformAdapter } from "./platform-adapter.js";
import { resolveProjectPaths } from "./paths.js";
import { emitRitualProgress, progressStatusFromFindings, progressStatusFromOutcome, type RitualProgressSink } from "./ritual-progress.js";
import { setupUx, type SetupUxReport } from "./setup-ux.js";
import { syncToOpenCode, type SyncReport } from "./sync.js";
import { OGB_VERSION } from "./types.js";
import type { RulesyncMode } from "./rulesync.js";

export interface ResetOptions {
  projectRoot?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  yes?: boolean;
  installOpenCode?: boolean;
  installPlugins?: boolean;
  installTuiDependencies?: boolean;
  rulesyncMode?: RulesyncMode;
  confirm?: (plan: ResetPlan) => boolean | Promise<boolean>;
  onProgress?: RitualProgressSink;
}

export interface ResetPlan {
  homeDir: string;
  globalConfigPath: string;
  cleanupPreview: HomeCleanupReport;
}

export interface ResetEnvReport {
  path?: string;
  status: "configured" | "unchanged" | "preview" | "warning";
  message: string;
}

export interface ResetReport {
  version: string;
  homeDir: string;
  outcome: "pass" | "cancelled" | "preview";
  plan: InstallerPlan;
  globalConfigPath: string;
  exaEnv: ResetEnvReport;
  cleanup: HomeCleanupReport;
  setup?: SetupUxReport;
  sync?: SyncReport;
  doctor?: DoctorReport;
  check?: PassReport;
  warnings: string[];
}

export class ResetNotHomeError extends Error {
  constructor(projectRoot: string, homeDir: string) {
    super(`ogb reset so pode ser rodado no home. Project: ${projectRoot}. Home: ${homeDir}. Rode: cd "${homeDir}" && ogb reset`);
  }
}

export class ResetConfirmationError extends Error {}

function appendLineIfMissing(filePath: string, line: string, pattern: RegExp, dryRun?: boolean): ResetEnvReport {
  if (fs.existsSync(filePath) && pattern.test(fs.readFileSync(filePath, "utf8"))) {
    process.env.OPENCODE_ENABLE_EXA = "1";
    return { path: filePath, status: "unchanged", message: `OPENCODE_ENABLE_EXA=1 already configured in ${filePath}.` };
  }
  if (dryRun) return { path: filePath, status: "preview", message: `Would add OPENCODE_ENABLE_EXA=1 to ${filePath}.` };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `\n# Enable OpenCode native websearch backed by Exa.\n${line}\n`, "utf8");
  process.env.OPENCODE_ENABLE_EXA = "1";
  return { path: filePath, status: "configured", message: `Added OPENCODE_ENABLE_EXA=1 to ${filePath}.` };
}

function ensureExaEnv(options: { homeDir: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; dryRun?: boolean }): ResetEnvReport {
  const adapter = createPlatformAdapter({ homeDir: options.homeDir, platform: options.platform, env: options.env });
  if (adapter.platform === "win32") {
    process.env.OPENCODE_ENABLE_EXA = "1";
    if (options.dryRun) {
      return { status: "preview", message: "Would set OPENCODE_ENABLE_EXA=1 for the Windows user environment." };
    }

    for (const plan of adapter.persistEnvCandidates("OPENCODE_ENABLE_EXA", "1")) {
      if (!plan.command) continue;
      const result = runNativeCommand({
        command: plan.command[0],
        args: plan.command.slice(1),
        stdio: "pipe",
      });
      if (result.ok) {
        return { status: "configured", message: "Set OPENCODE_ENABLE_EXA=1 for the Windows user environment." };
      }
    }
    return {
      status: "warning",
      message: "Could not persist OPENCODE_ENABLE_EXA=1 with PowerShell; it is set only for this process.",
    };
  }

  const envPlan = adapter.persistEnv("OPENCODE_ENABLE_EXA", "1");
  return appendLineIfMissing(
    envPlan.path ?? adapter.join(adapter.homeDir, ".config", "zsh", ".zshrc"),
    "export OPENCODE_ENABLE_EXA=1",
    /^[ \t]*(export[ \t]+)?OPENCODE_ENABLE_EXA=1([ \t]*(#.*)?)?$/m,
    options.dryRun,
  );
}

function clearStartupSyncStatus(homeDir: string): void {
  const paths = resolveProjectPaths(homeDir, homeDir);
  fs.rmSync(paths.pluginStatusPath, { force: true });
  fs.rmSync(path.join(paths.generatedDir, "ogb-startup-sync.lock"), { force: true });
  fs.rmSync(paths.updateStatusPath, { force: true });
  fs.rmSync(paths.validationPath, { force: true });
  fs.rmSync(paths.securityPath, { force: true });
}

async function promptResetConfirmation(plan: ResetPlan): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ResetConfirmationError("ogb reset precisa de confirmacao interativa. Rode em um terminal ou use --yes se voce ja revisou o plano.");
  }

  console.log("OGB reset");
  console.log(`Home: ${plan.homeDir}`);
  console.log(`Global OpenCode config: ${plan.globalConfigPath}`);
  console.log("");
  console.log("Isto vai:");
  console.log("- limpar artefatos antigos de projeto criados por engano no home, com backup;");
  console.log("- sobrescrever o perfil global do OpenCode com o perfil OGB;");
  console.log("- reaplicar comandos, agente YOLO, DCP, fallback e websearch Exa;");
  console.log("- rodar sync global do Gemini para o OpenCode.");
  if (plan.cleanupPreview.actions.length > 0) {
    console.log("");
    console.log("Artefatos de home que seriam limpos:");
    for (const action of plan.cleanupPreview.actions.slice(0, 20)) console.log(`- ${action.relPath}`);
    if (plan.cleanupPreview.actions.length > 20) console.log(`- ...mais ${plan.cleanupPreview.actions.length - 20}`);
  }
  console.log("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Digite "RESET" para continuar: ');
    return answer.trim() === "RESET";
  } finally {
    rl.close();
  }
}

export async function runReset(options: ResetOptions = {}): Promise<ResetReport> {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  if (!paths.homeMode) throw new ResetNotHomeError(paths.projectRoot, paths.homeDir);
  const adapter = createPlatformAdapter({ homeDir: paths.homeDir, platform: options.platform, env: options.env });
  const installerPlan = buildInstallerPlan({
    intent: "reset",
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    platform: options.platform,
    env: options.env,
    dryRun: options.dryRun,
    force: true,
    rulesyncMode: options.rulesyncMode,
    windows: (options.platform ?? process.platform) === "win32",
  });

  const globalConfigPath = adapter.join(adapter.globalConfigDir, "opencode.json");
  const cleanupPreview = cleanupHomeProjectArtifacts({ homeDir: paths.homeDir, dryRun: true });
  const plan: ResetPlan = {
    homeDir: paths.homeDir,
    globalConfigPath,
    cleanupPreview,
  };

  const warnings: string[] = [];
  if (!options.dryRun && !options.yes) {
    emitRitualProgress(options.onProgress, {
      stepId: "confirm",
      label: "Confirm the home reset.",
      detail: "Requires explicit confirmation before changing global files.",
      status: "running",
      message: "Waiting for RESET confirmation.",
    });
    const confirmed = options.confirm ? await options.confirm(plan) : await promptResetConfirmation(plan);
    if (!confirmed) {
      emitRitualProgress(options.onProgress, {
        stepId: "confirm",
        label: "Confirm the home reset.",
        detail: "Requires explicit confirmation before changing global files.",
        status: "skipped",
        message: "Reset cancelled before changes.",
      });
      return {
        version: OGB_VERSION,
        homeDir: paths.homeDir,
        outcome: "cancelled",
        plan: installerPlan,
        globalConfigPath,
        exaEnv: { status: "preview", message: "Reset cancelled before changing environment." },
        cleanup: cleanupPreview,
        warnings,
      };
    }
    emitRitualProgress(options.onProgress, {
      stepId: "confirm",
      label: "Confirm the home reset.",
      detail: "Requires explicit confirmation before changing global files.",
      status: "pass",
      message: "RESET confirmed.",
    });
  } else {
    emitRitualProgress(options.onProgress, {
      stepId: "confirm",
      label: "Confirm the home reset.",
      detail: "Requires explicit confirmation before changing global files.",
      status: options.dryRun ? "skipped" : "pass",
      message: options.dryRun ? "Dry-run preview; no destructive confirmation needed." : "--yes accepted.",
    });
  }

  emitRitualProgress(options.onProgress, {
    stepId: "env",
    label: "Configure OpenCode websearch support.",
    detail: "Persists OPENCODE_ENABLE_EXA=1 when the platform allows it.",
    status: "running",
  });
  const exaEnv = ensureExaEnv({ homeDir: paths.homeDir, platform: options.platform, env: options.env, dryRun: options.dryRun });
  emitRitualProgress(options.onProgress, {
    stepId: "env",
    label: "Configure OpenCode websearch support.",
    detail: "Persists OPENCODE_ENABLE_EXA=1 when the platform allows it.",
    status: exaEnv.status === "warning" ? "warn" : exaEnv.status === "preview" ? "skipped" : "pass",
    message: exaEnv.message,
  });
  if (exaEnv.status === "warning") warnings.push(exaEnv.message);

  if (options.dryRun) {
    emitRitualProgress(options.onProgress, {
      stepId: "cleanup",
      label: "Clean old home-project artifacts.",
      detail: "Backs up accidental project files before removing them.",
      status: "running",
    });
    emitRitualProgress(options.onProgress, {
      stepId: "cleanup",
      label: "Clean old home-project artifacts.",
      detail: "Backs up accidental project files before removing them.",
      status: cleanupPreview.warnings.length > 0 ? "warn" : "skipped",
      message: `Would clean ${cleanupPreview.actions.length} action(s).`,
    });
    emitRitualProgress(options.onProgress, {
      stepId: "setup",
      label: "Overwrite the global OpenCode profile.",
      detail: "Rebuilds global config, commands, agents, and sidebar files.",
      status: "running",
    });
    const setupPreview = setupUx({
      homeDir: paths.homeDir,
      projectRoot: paths.homeDir,
      platform: options.platform,
      env: options.env,
      dryRun: true,
      force: true,
      resetGlobal: true,
      installOpenCode: options.installOpenCode,
      installPlugins: options.installPlugins,
      installTuiDependencies: options.installTuiDependencies,
    });
    emitRitualProgress(options.onProgress, {
      stepId: "setup",
      label: "Overwrite the global OpenCode profile.",
      detail: "Rebuilds global config, commands, agents, and sidebar files.",
      status: setupPreview.warnings.length > 0 ? "warn" : "skipped",
      message: `Would touch ${setupPreview.writes.filter((write) => write.status !== "unchanged").length} write(s).`,
    });
    emitRitualProgress(options.onProgress, {
      stepId: "opencode",
      label: "Verify OpenCode is available.",
      detail: "Installs or updates OpenCode when needed.",
      status: options.installOpenCode === false ? "skipped" : setupPreview.warnings.length > 0 ? "warn" : "skipped",
      message: options.installOpenCode === false ? "Skipped by --no-install-opencode." : "Would check OpenCode availability.",
    });
    emitRitualProgress(options.onProgress, {
      stepId: "plugins",
      label: "Install global OpenCode plugins.",
      detail: "Covers auth, fallback, sidebar, and startup sync integrations.",
      status: options.installPlugins === false ? "skipped" : setupPreview.warnings.length > 0 ? "warn" : "skipped",
      message: options.installPlugins === false ? "Skipped by --no-plugins." : "Would check global plugins.",
    });
    emitRitualProgress(options.onProgress, {
      stepId: "sync",
      label: "Sync Gemini globals into OpenCode.",
      detail: "Projects context, MCPs, agents, commands, and skills into global scope.",
      status: "running",
    });
    const syncPreview = syncToOpenCode({
      projectRoot: paths.homeDir,
      homeDir: paths.homeDir,
      dryRun: true,
      force: true,
      silent: true,
      rulesyncMode: options.rulesyncMode ?? "auto",
    });
    emitRitualProgress(options.onProgress, {
      stepId: "sync",
      label: "Sync Gemini globals into OpenCode.",
      detail: "Projects context, MCPs, agents, commands, and skills into global scope.",
      status: syncPreview.warnings.length > 0 ? "warn" : "skipped",
      message: `Would project ${syncPreview.projectedSkills.length} skill(s), ${syncPreview.projectedCommands.length} command(s).`,
    });
    for (const stepId of ["doctor", "check"] as const) {
      emitRitualProgress(options.onProgress, {
        stepId,
        label: stepId === "doctor" ? "Run doctor." : "Run the full bridge check.",
        detail: stepId === "doctor" ? "Performs compatibility checks after reset." : "Verifies setup, sync, validation, security, and dashboard.",
        status: "skipped",
        message: "Skipped in dry-run preview.",
      });
    }
    return {
      version: OGB_VERSION,
      homeDir: paths.homeDir,
      outcome: "preview",
      plan: installerPlan,
      globalConfigPath,
      exaEnv,
      cleanup: cleanupPreview,
      setup: setupPreview,
      sync: syncPreview,
      warnings: [...warnings, ...setupPreview.warnings, ...syncPreview.warnings],
    };
  }

  emitRitualProgress(options.onProgress, {
    stepId: "cleanup",
    label: "Clean old home-project artifacts.",
    detail: "Backs up accidental project files before removing them.",
    status: "running",
  });
  const cleanup = cleanupHomeProjectArtifacts({ homeDir: paths.homeDir });
  emitRitualProgress(options.onProgress, {
    stepId: "cleanup",
    label: "Clean old home-project artifacts.",
    detail: "Backs up accidental project files before removing them.",
    status: cleanup.warnings.length > 0 ? "warn" : "pass",
    message: `${cleanup.actions.length} action(s)${cleanup.backupDir ? ", backup created" : ""}.`,
  });
  emitRitualProgress(options.onProgress, {
    stepId: "setup",
    label: "Overwrite the global OpenCode profile.",
    detail: "Rebuilds global config, commands, agents, and sidebar files.",
    status: "running",
  });
  const setup = setupUx({
    homeDir: paths.homeDir,
    projectRoot: paths.homeDir,
    platform: options.platform,
    env: options.env,
    force: true,
    resetGlobal: true,
    installOpenCode: options.installOpenCode,
    installPlugins: options.installPlugins,
    installTuiDependencies: options.installTuiDependencies,
  });
  emitRitualProgress(options.onProgress, {
    stepId: "setup",
    label: "Overwrite the global OpenCode profile.",
    detail: "Rebuilds global config, commands, agents, and sidebar files.",
    status: setup.warnings.length > 0 ? "warn" : "pass",
    message: `${setup.writes.filter((write) => write.status !== "unchanged").length} write(s) checked.`,
  });
  const openCodeCommand = setup.commands.find((command) => command.command.some((part) => /opencode-ai|opencode(?:\.cmd)?$/i.test(part)));
  emitRitualProgress(options.onProgress, {
    stepId: "opencode",
    label: "Verify OpenCode is available.",
    detail: "Installs or updates OpenCode when needed.",
    status: options.installOpenCode === false ? "skipped" : openCodeCommand?.status === "fail" ? "warn" : setup.warnings.length > 0 ? "warn" : "pass",
    message: options.installOpenCode === false ? "Skipped by --no-install-opencode." : openCodeCommand?.message ?? "OpenCode availability was checked.",
  });
  emitRitualProgress(options.onProgress, {
    stepId: "plugins",
    label: "Install global OpenCode plugins.",
    detail: "Covers auth, fallback, sidebar, and startup sync integrations.",
    status: options.installPlugins === false ? "skipped" : setup.warnings.length > 0 ? "warn" : "pass",
    message: options.installPlugins === false ? "Skipped by --no-plugins." : `${setup.commands.filter((command) => command.status !== "skipped").length} setup command(s) checked.`,
  });
  emitRitualProgress(options.onProgress, {
    stepId: "sync",
    label: "Sync Gemini globals into OpenCode.",
    detail: "Projects context, MCPs, agents, commands, and skills into global scope.",
    status: "running",
  });
  const sync = syncToOpenCode({
    projectRoot: paths.homeDir,
    homeDir: paths.homeDir,
    force: true,
    silent: true,
    rulesyncMode: options.rulesyncMode ?? "auto",
  });
  emitRitualProgress(options.onProgress, {
    stepId: "sync",
    label: "Sync Gemini globals into OpenCode.",
    detail: "Projects context, MCPs, agents, commands, and skills into global scope.",
    status: sync.warnings.length > 0 ? "warn" : "pass",
    message: `${sync.projectedSkills.length} skill(s), ${sync.projectedCommands.length} command(s), ${sync.projectedAgents.length + sync.projectedExtensionAgents.length} agent(s).`,
  });
  clearStartupSyncStatus(paths.homeDir);
  emitRitualProgress(options.onProgress, {
    stepId: "doctor",
    label: "Run doctor.",
    detail: "Performs compatibility checks after reset.",
    status: "running",
  });
  const doctor = runDoctor({ projectRoot: paths.homeDir, homeDir: paths.homeDir, silent: true });
  emitRitualProgress(options.onProgress, {
    stepId: "doctor",
    label: "Run doctor.",
    detail: "Performs compatibility checks after reset.",
    status: progressStatusFromFindings(doctor.errors.length, doctor.warnings.length),
    message: doctor.errors.length > 0 ? `${doctor.errors.length} error(s)` : doctor.warnings.length > 0 ? `${doctor.warnings.length} warning(s)` : "Doctor is clean.",
  });
  emitRitualProgress(options.onProgress, {
    stepId: "check",
    label: "Run the full bridge check.",
    detail: "Verifies setup, sync, validation, security, and dashboard.",
    status: "running",
  });
  const check = runPass({
    projectRoot: paths.homeDir,
    homeDir: paths.homeDir,
    force: true,
    skipSetup: true,
    skipSync: true,
    windows: (options.platform ?? process.platform) === "win32",
    silent: true,
    setExitCode: false,
  });
  emitRitualProgress(options.onProgress, {
    stepId: "check",
    label: "Run the full bridge check.",
    detail: "Verifies setup, sync, validation, security, and dashboard.",
    status: progressStatusFromOutcome(check.outcome),
    message: check.outcome === "pass" ? "Full check is clean." : `Full check outcome: ${check.outcome}.`,
  });
  warnings.push(
    ...cleanup.warnings,
    ...setup.warnings,
    ...sync.warnings,
    ...doctor.warnings,
    ...check.blockers.filter((blocker) => blocker.severity === "warn").map((blocker) => `${blocker.source}: ${blocker.message}`),
  );

  return {
    version: OGB_VERSION,
    homeDir: paths.homeDir,
    outcome: "pass",
    plan: installerPlan,
    globalConfigPath,
    exaEnv,
    cleanup,
    setup,
    sync,
    doctor,
    check,
    warnings,
  };
}

export function printResetReport(report: ResetReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const title = report.outcome === "preview"
    ? "OpenCode Gemini Bridge reset preview"
    : report.outcome === "cancelled"
      ? "OpenCode Gemini Bridge reset cancelled"
      : "OpenCode Gemini Bridge reset complete";
  console.log(title);
  console.log(`Home: ${report.homeDir}`);
  console.log(`Global config: ${report.globalConfigPath}`);
  console.log(`${report.exaEnv.status}: ${report.exaEnv.message}`);
  console.log(`Cleanup: ${report.cleanup.actions.length} action(s)${report.cleanup.backupDir ? `, backup ${report.cleanup.backupDir}` : ""}`);
  if (report.setup) {
    const writes = report.setup.writes.filter((write) => write.status !== "unchanged").length;
    console.log(`Global UX: ${writes} changed/previewed write(s)`);
  }
  if (report.sync) {
    console.log(`Global sync: ${report.sync.projectedCommands.length} command(s), ${report.sync.projectedAgents.length + report.sync.projectedExtensionAgents.length} agent(s), ${report.sync.projectedSkills.length} skill(s)`);
  }
  if (report.doctor) {
    console.log(`Doctor: ${report.doctor.errors.length} error(s), ${report.doctor.warnings.length} warning(s)`);
  }
  if (report.check) {
    console.log(`Check: ${report.check.outcome.toUpperCase()}`);
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
