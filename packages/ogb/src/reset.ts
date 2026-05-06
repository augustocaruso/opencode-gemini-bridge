import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { cleanupHomeProjectArtifacts, type HomeCleanupReport } from "./home-cleanup.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { globalOpenCodeConfigDir } from "./opencode-paths.js";
import { resolveProjectPaths } from "./paths.js";
import { spawnCommandSync } from "./process.js";
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
  globalConfigPath: string;
  exaEnv: ResetEnvReport;
  cleanup: HomeCleanupReport;
  setup?: SetupUxReport;
  sync?: SyncReport;
  doctor?: DoctorReport;
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

function ensureExaEnv(options: { homeDir: string; platform?: NodeJS.Platform; dryRun?: boolean }): ResetEnvReport {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    process.env.OPENCODE_ENABLE_EXA = "1";
    if (options.dryRun) {
      return { status: "preview", message: "Would set OPENCODE_ENABLE_EXA=1 for the Windows user environment." };
    }

    const script = "[Environment]::SetEnvironmentVariable('OPENCODE_ENABLE_EXA','1','User')";
    const shells = ["powershell.exe", "pwsh", "powershell"];
    for (const shell of shells) {
      const result = spawnCommandSync(shell, ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        stdio: "pipe",
      });
      if (!result.error && result.status === 0) {
        return { status: "configured", message: "Set OPENCODE_ENABLE_EXA=1 for the Windows user environment." };
      }
    }
    return {
      status: "warning",
      message: "Could not persist OPENCODE_ENABLE_EXA=1 with PowerShell; it is set only for this process.",
    };
  }

  return appendLineIfMissing(
    path.join(options.homeDir, ".config", "zsh", ".zshrc"),
    "export OPENCODE_ENABLE_EXA=1",
    /^[ \t]*(export[ \t]+)?OPENCODE_ENABLE_EXA=1([ \t]*(#.*)?)?$/m,
    options.dryRun,
  );
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

  const globalConfigPath = path.join(globalOpenCodeConfigDir({ homeDir: paths.homeDir, platform: options.platform, env: options.env }), "opencode.json");
  const cleanupPreview = cleanupHomeProjectArtifacts({ homeDir: paths.homeDir, dryRun: true });
  const plan: ResetPlan = {
    homeDir: paths.homeDir,
    globalConfigPath,
    cleanupPreview,
  };

  const warnings: string[] = [];
  if (!options.dryRun && !options.yes) {
    const confirmed = options.confirm ? await options.confirm(plan) : await promptResetConfirmation(plan);
    if (!confirmed) {
      return {
        version: OGB_VERSION,
        homeDir: paths.homeDir,
        outcome: "cancelled",
        globalConfigPath,
        exaEnv: { status: "preview", message: "Reset cancelled before changing environment." },
        cleanup: cleanupPreview,
        warnings,
      };
    }
  }

  const exaEnv = ensureExaEnv({ homeDir: paths.homeDir, platform: options.platform, dryRun: options.dryRun });
  if (exaEnv.status === "warning") warnings.push(exaEnv.message);

  if (options.dryRun) {
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
    const syncPreview = syncToOpenCode({
      projectRoot: paths.homeDir,
      homeDir: paths.homeDir,
      dryRun: true,
      force: true,
      silent: true,
      rulesyncMode: options.rulesyncMode ?? "auto",
    });
    return {
      version: OGB_VERSION,
      homeDir: paths.homeDir,
      outcome: "preview",
      globalConfigPath,
      exaEnv,
      cleanup: cleanupPreview,
      setup: setupPreview,
      sync: syncPreview,
      warnings: [...warnings, ...setupPreview.warnings, ...syncPreview.warnings],
    };
  }

  const cleanup = cleanupHomeProjectArtifacts({ homeDir: paths.homeDir });
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
  const sync = syncToOpenCode({
    projectRoot: paths.homeDir,
    homeDir: paths.homeDir,
    force: true,
    silent: true,
    rulesyncMode: options.rulesyncMode ?? "auto",
  });
  const doctor = runDoctor({ projectRoot: paths.homeDir, homeDir: paths.homeDir, silent: true });
  warnings.push(...cleanup.warnings, ...setup.warnings, ...sync.warnings, ...doctor.warnings);

  return {
    version: OGB_VERSION,
    homeDir: paths.homeDir,
    outcome: "pass",
    globalConfigPath,
    exaEnv,
    cleanup,
    setup,
    sync,
    doctor,
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
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
