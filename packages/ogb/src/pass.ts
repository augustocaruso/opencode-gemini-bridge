import fs from "node:fs";
import path from "node:path";
import { runDashboard, type DashboardReport } from "./dashboard.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { sha256File } from "./file-hash.js";
import { buildInstallerPlan, type InstallerPlan } from "./installer-planner.js";
import { buildInventory } from "./inventory.js";
import { resolveProjectPaths } from "./paths.js";
import { runSecurityCheck, type SecurityReport } from "./security.js";
import { setupOpenCode, type SetupOpenCodeReport } from "./setup-opencode.js";
import { syncToOpenCode, type SyncReport } from "./sync.js";
import { hookTrustKey, readTrustFile, writeTrustFile } from "./trust.js";
import { OGB_VERSION } from "./types.js";
import { runValidation, type ValidationReport } from "./validation.js";
import type { RulesyncMode } from "./rulesync.js";
import { emitRitualProgress, progressStatusFromFindings, progressStatusFromOutcome, type RitualProgressSink } from "./ritual-progress.js";
import { writeStateRecord } from "./state-store.js";

export interface PassOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  acceptHooks?: boolean;
  windows?: boolean;
  skipSetup?: boolean;
  skipSync?: boolean;
  skipValidation?: boolean;
  skipSecurity?: boolean;
  skipDashboard?: boolean;
  silent?: boolean;
  setExitCode?: boolean;
  rulesyncMode?: RulesyncMode;
  onProgress?: RitualProgressSink;
}

export interface PassBlocker {
  severity: "warn" | "fail";
  source: "doctor" | "validation" | "security" | "setup" | "sync" | "dashboard";
  message: string;
  action: string;
}

export interface PassStep {
  name: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
}

export interface PassSyncSummary {
  generatedConfigPath: string;
  builtInAgents: number;
  extensionAgents: number;
  builtInCommands: number;
  extensionCommands: number;
  skills: number;
  tuiFiles: number;
  externalIntegrationFiles: number;
  rulesyncStatus: SyncReport["rulesync"]["status"];
  rulesyncPromoted: number;
}

export interface PassReport {
  version: string;
  projectRoot: string;
  outcome: "pass" | "warn" | "fail";
  plan: InstallerPlan;
  automated: string[];
  steps: PassStep[];
  acceptedHooks: string[];
  blockers: PassBlocker[];
  sync?: PassSyncSummary;
  doctor: {
    warnings: number;
    errors: number;
  };
  validation?: {
    outcome: ValidationReport["outcome"];
  };
  security?: {
    outcome: SecurityReport["outcome"];
  };
  dashboard?: {
    outcome: DashboardReport["outcome"];
  };
  files: {
    pass: string;
    doctor: string;
    dashboard: string;
  };
}

function actionForWarning(warning: string): string {
  if (/^Hook needs review:/.test(warning)) return "Revise o hook e rode `ogb check --accept-hooks` para registrar o hash revisado.";
  if (/Duplicate name/i.test(warning)) return "Rode `ogb check --json` ou abra `.opencode/generated/ogb-inventory.json` para ver os paths duplicados; mantenha uma copia.";
  if (/opencode-auto-fallback config exists but is disabled/i.test(warning)) return "Ative o fallback gerado ou desative `externalPlugins.autoFallback` em `.opencode/ogb.config.jsonc`.";
  if (/opencode-auto-fallback.*plugin is not active/i.test(warning)) return "Instale `opencode plugin opencode-auto-fallback@0.4.3 --global --force`, rode `ogb sync` e reinicie o OpenCode.";
  if (/opencode-auto-fallback/i.test(warning)) return "Revise `externalPlugins.autoFallback` em `.opencode/ogb.config.jsonc` e o plugin global do OpenCode.";
  if (/Run ogb sync/i.test(warning)) return "O `ogb check` ja tentou `ogb sync`; se persistir, revise conflitos em arquivos gerenciados e rode com `--force` se for seguro.";
  if (/Model resolution warning/i.test(warning)) return "Revise os modelos em `.opencode/ogb.config.jsonc` e compare com `opencode models`.";
  if (/MCP command warning/i.test(warning)) return "Instale o comando do MCP ou remova/desabilite esse MCP na configuracao de origem.";
  return "Leia o aviso do doctor; se for recurso gerenciado pelo OGB, rode `ogb check --force` depois de revisar.";
}

function blocker(source: PassBlocker["source"], severity: PassBlocker["severity"], message: string, action: string): PassBlocker {
  return { source, severity, message, action };
}

function acceptCurrentHooks(projectRoot: string, homeDir: string, dryRun?: boolean): string[] {
  const paths = resolveProjectPaths(projectRoot, homeDir);
  const inv = buildInventory({ projectRoot, homeDir });
  const trust = readTrustFile(projectRoot, homeDir);
  trust.hooks ??= {};
  const accepted: string[] = [];

  for (const hook of inv.hooks) {
    if (!fs.existsSync(hook.source)) continue;
    trust.hooks[hookTrustKey(hook)] = {
      sha256: sha256File(hook.source),
      trustedAt: new Date().toISOString(),
    };
    accepted.push(`${hook.name} (${hook.source})`);
  }

  if (!dryRun && accepted.length > 0) writeTrustFile(paths.trustPath, trust);
  return accepted.sort();
}

function statusText(status: PassStep["status"] | PassReport["outcome"] | PassBlocker["severity"]): string {
  if (status === "pass") return "OK";
  if (status === "fail") return "FAIL";
  return "WARN";
}

function stepStatusDetail(step: PassStep): string {
  return step.detail ? `  ${step.detail}` : "";
}

function relativeReportPath(projectRoot: string, filePath: string): string {
  const rel = path.relative(projectRoot, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath;
  return rel;
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function syncSummaryLine(sync: PassSyncSummary): string {
  const parts = [
    plural(sync.builtInAgents, "agent"),
    plural(sync.extensionAgents, "subagent"),
    plural(sync.builtInCommands, "comando"),
    plural(sync.extensionCommands, "comando de extensao", "comandos de extensao"),
    plural(sync.skills, "skill"),
  ].filter((item) => !item.startsWith("0 "));
  return parts.length > 0 ? parts.join(", ") : "sem arquivos projetados";
}

const CHECK_PROGRESS = {
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
  doctor: {
    stepId: "doctor",
    label: "Inspect the bridge inventory with doctor.",
    detail: "Looks for missing generated files, plugin state, extension risk, and stale status.",
  },
  hooks: {
    stepId: "hook-review",
    label: "Record reviewed Gemini hooks.",
    detail: "Stores trusted hook hashes when --accept-hooks is used.",
  },
  validation: {
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
} as const;

type CheckProgressKey = keyof typeof CHECK_PROGRESS;

function emitCheckProgress(
  sink: RitualProgressSink | undefined,
  key: CheckProgressKey,
  status: Parameters<typeof emitRitualProgress>[1]["status"],
  message?: string,
): void {
  const step = CHECK_PROGRESS[key];
  emitRitualProgress(sink, { ...step, status, message });
}

function friendlyBlockerMessage(item: PassBlocker): string {
  if (/opencode-auto-fallback.*plugin is not active/i.test(item.message)) {
    return "Auto fallback esta ligado, mas o plugin externo nao carregou.";
  }
  if (item.source === "validation" && item.severity === "warn") return "Validation encontrou avisos.";
  if (item.source === "security" && item.severity === "warn") return "Security-check encontrou avisos.";
  if (item.source === "dashboard" && item.severity === "warn") return "Dashboard herdou avisos dos checks anteriores.";
  return item.message;
}

export function formatPassReport(report: PassReport): string {
  const lines = [
    `OGB check ${statusText(report.outcome)}`,
    `Project   ${report.projectRoot}`,
    "",
    "Checks",
    ...report.steps.map((step) => `  ${statusText(step.status).padEnd(5)} ${step.name}${stepStatusDetail(step)}`),
  ];

  if (report.sync) {
    lines.push(
      "",
      "Sync",
      `  ${syncSummaryLine(report.sync)}`,
      `  rulesync: ${report.sync.rulesyncStatus}${report.sync.rulesyncPromoted > 0 ? `, ${report.sync.rulesyncPromoted} promoted` : ""}`,
    );
  }

  if (report.acceptedHooks.length > 0) {
    lines.push("", "Trusted Hooks");
    for (const hook of report.acceptedHooks) lines.push(`- ${hook}`);
  }

  if (report.blockers.length > 0) {
    lines.push("", "Needs Attention");
    for (const item of report.blockers) {
      lines.push(`  ${statusText(item.severity).padEnd(5)} ${item.source}: ${friendlyBlockerMessage(item)}`);
      lines.push(`        fix: ${item.action}`);
    }
  } else {
    lines.push("", "No pending fixes.");
  }

  lines.push(
    "",
    "Files",
    `  report:    ${relativeReportPath(report.projectRoot, report.files.pass)}`,
    `  dashboard: ${relativeReportPath(report.projectRoot, report.files.dashboard)}`,
  );
  return `${lines.join("\n")}\n`;
}

function statusFromFindings(fail: boolean, warn: boolean): PassStep["status"] {
  if (fail) return "fail";
  if (warn) return "warn";
  return "pass";
}

function buildSyncSummary(sync: SyncReport | undefined): PassSyncSummary | undefined {
  if (!sync) return undefined;
  return {
    generatedConfigPath: sync.generatedConfigPath,
    builtInAgents: sync.projectedAgents.length,
    extensionAgents: sync.projectedExtensionAgents.length,
    builtInCommands: Math.max(0, sync.projectedCommands.length - sync.projectedExtensionCommands.length),
    extensionCommands: sync.projectedExtensionCommands.length,
    skills: sync.projectedSkills.length,
    tuiFiles: sync.projectedTuiFiles.length,
    externalIntegrationFiles: sync.projectedExternalIntegrationFiles.length,
    rulesyncStatus: sync.rulesync.status,
    rulesyncPromoted: sync.rulesync.promoted.length,
  };
}

export function runPass(options: PassOptions = {}): PassReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const plan = buildInstallerPlan({
    intent: "check",
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    dryRun: options.dryRun,
    force: options.force,
    windows: options.windows,
    rulesyncMode: options.rulesyncMode,
  });
  const automated: string[] = [];
  const blockers: PassBlocker[] = [];
  let setup: SetupOpenCodeReport | undefined;
  let sync: SyncReport | undefined;
  let validation: ValidationReport | undefined;
  let security: SecurityReport | undefined;
  let dashboard: DashboardReport | undefined;

  if (!options.skipSetup) {
    emitCheckProgress(options.onProgress, "setup", "running");
    try {
      setup = setupOpenCode({
        projectRoot: paths.projectRoot,
        homeDir: paths.homeDir,
        dryRun: options.dryRun,
        force: options.force,
        skipDoctor: true,
        skipCommandCheck: true,
      });
    } catch (error) {
      emitCheckProgress(options.onProgress, "setup", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(
      options.onProgress,
      "setup",
      setup.warnings.length > 0 ? "warn" : "pass",
      setup.warnings.length > 0 ? `${setup.warnings.length} warning(s)` : "Startup sync wiring is present.",
    );
    automated.push("setup-opencode");
    for (const warning of setup.warnings) blockers.push(blocker("setup", "warn", warning, "Revise conflitos do setup; rode `ogb check --force` se quiser sobrescrever arquivos gerenciados."));
  }

  if (!options.skipSync) {
    emitCheckProgress(options.onProgress, "sync", "running");
    try {
      sync = syncToOpenCode({
        projectRoot: paths.projectRoot,
        homeDir: paths.homeDir,
        dryRun: options.dryRun,
        force: options.force,
        silent: true,
        rulesyncMode: options.rulesyncMode,
      });
    } catch (error) {
      emitCheckProgress(options.onProgress, "sync", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(
      options.onProgress,
      "sync",
      sync.warnings.length > 0 ? "warn" : "pass",
      sync.warnings.length > 0
        ? `${sync.warnings.length} warning(s)`
        : `${sync.projectedSkills.length} skill(s), ${sync.projectedCommands.length} command(s), ${sync.projectedAgents.length + sync.projectedExtensionAgents.length} agent(s) projected.`,
    );
    automated.push("sync");
    for (const warning of sync.warnings) blockers.push(blocker("sync", "warn", warning, "Revise conflitos do sync; rode `ogb check --force` se quiser sobrescrever arquivos gerenciados."));
  }

  emitCheckProgress(options.onProgress, "doctor", "running");
  let doctor: DoctorReport;
  try {
    doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
  } catch (error) {
    emitCheckProgress(options.onProgress, "doctor", "fail", error instanceof Error ? error.message : String(error));
    throw error;
  }
  emitCheckProgress(
    options.onProgress,
    "doctor",
    progressStatusFromFindings(doctor.errors.length, doctor.warnings.length),
    doctor.errors.length > 0
      ? `${doctor.errors.length} error(s)`
      : doctor.warnings.length > 0
        ? `${doctor.warnings.length} warning(s)`
        : "Doctor is clean.",
  );
  automated.push("doctor");

  let acceptedHooks: string[] = [];
  if (options.acceptHooks) {
    emitCheckProgress(options.onProgress, "hooks", "running");
    try {
      acceptedHooks = acceptCurrentHooks(paths.projectRoot, paths.homeDir, options.dryRun);
    } catch (error) {
      emitCheckProgress(options.onProgress, "hooks", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(options.onProgress, "hooks", "pass", `${acceptedHooks.length} hook(s) accepted.`);
  }
  if (acceptedHooks.length > 0) {
    emitCheckProgress(options.onProgress, "doctor", "running", "Rechecking after hook trust update.");
    doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    emitCheckProgress(
      options.onProgress,
      "doctor",
      progressStatusFromFindings(doctor.errors.length, doctor.warnings.length),
      doctor.errors.length > 0
        ? `${doctor.errors.length} error(s)`
        : doctor.warnings.length > 0
          ? `${doctor.warnings.length} warning(s)`
          : "Doctor is clean after hook review.",
    );
    automated.push("doctor-after-hook-acceptance");
  }

  if (!options.skipValidation) {
    emitCheckProgress(options.onProgress, "validation", "running");
    try {
      validation = runValidation({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true, windows: options.windows });
    } catch (error) {
      emitCheckProgress(options.onProgress, "validation", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(options.onProgress, "validation", progressStatusFromOutcome(validation.outcome), validation.outcome === "pass" ? "Validation is clean." : `Validation outcome: ${validation.outcome}.`);
    automated.push("validate");
  }

  if (!options.skipSecurity) {
    emitCheckProgress(options.onProgress, "security", "running");
    try {
      security = runSecurityCheck({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    } catch (error) {
      emitCheckProgress(options.onProgress, "security", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(options.onProgress, "security", progressStatusFromOutcome(security.outcome), security.outcome === "pass" ? "Security guardrails are clean." : `Security outcome: ${security.outcome}.`);
    automated.push("security-check");
  }

  if (!options.skipDashboard) {
    emitCheckProgress(options.onProgress, "dashboard", "running");
    try {
      dashboard = runDashboard({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true, refresh: false });
    } catch (error) {
      emitCheckProgress(options.onProgress, "dashboard", "fail", error instanceof Error ? error.message : String(error));
      throw error;
    }
    emitCheckProgress(options.onProgress, "dashboard", progressStatusFromOutcome(dashboard.outcome), dashboard.outcome === "pass" ? "Dashboard refreshed." : `Dashboard outcome: ${dashboard.outcome}.`);
    automated.push("dashboard");
  }

  for (const error of doctor.errors) blockers.push(blocker("doctor", "fail", error, "Corrija o erro indicado pelo doctor e rode `ogb check` novamente."));
  for (const warning of doctor.warnings) blockers.push(blocker("doctor", "warn", warning, actionForWarning(warning)));
  if (validation?.outcome === "fail") blockers.push(blocker("validation", "fail", "Validation falhou.", "Rode `ogb validate` para ver os checks detalhados."));
  if (validation?.outcome === "warn") blockers.push(blocker("validation", "warn", "Validation passou com avisos.", "Rode `ogb validate` para ver os checks detalhados."));
  if (security?.outcome === "fail") blockers.push(blocker("security", "fail", "Security-check falhou.", "Rode `ogb security-check` e revise os achados."));
  if (security?.outcome === "warn") blockers.push(blocker("security", "warn", "Security-check passou com avisos.", "Rode `ogb security-check` e revise os achados."));
  if (dashboard?.outcome === "fail") blockers.push(blocker("dashboard", "fail", "Dashboard final falhou.", "Abra `.opencode/generated/ogb-dashboard.md` para os detalhes."));
  if (dashboard?.outcome === "warn") blockers.push(blocker("dashboard", "warn", "Dashboard final passou com avisos.", "Abra `.opencode/generated/ogb-dashboard.md` para os detalhes."));

  const outcome = blockers.some((item) => item.severity === "fail")
    ? "fail"
    : blockers.length > 0
      ? "warn"
      : "pass";

  const steps: PassStep[] = [];
  if (setup) {
    steps.push({
      name: "setup-opencode",
      status: setup.warnings.length > 0 ? "warn" : "pass",
      detail: setup.warnings.length > 0 ? `${setup.warnings.length} warning(s)` : undefined,
    });
  }
  if (sync) {
    steps.push({
      name: "sync",
      status: sync.warnings.length > 0 ? "warn" : "pass",
      detail: sync.warnings.length > 0 ? `${sync.warnings.length} warning(s)` : undefined,
    });
  }
  if (acceptedHooks.length > 0) {
    steps.push({ name: "hook review", status: "pass", detail: `${acceptedHooks.length} accepted` });
  }
  steps.push({
    name: "doctor",
    status: statusFromFindings(doctor.errors.length > 0, doctor.warnings.length > 0),
    detail: doctor.errors.length > 0
      ? `${doctor.errors.length} error(s)`
      : doctor.warnings.length > 0
        ? `${doctor.warnings.length} warning(s)`
        : undefined,
  });
  if (validation) steps.push({ name: "validate", status: validation.outcome, detail: validation.outcome === "pass" ? undefined : validation.outcome });
  if (security) steps.push({ name: "security-check", status: security.outcome, detail: security.outcome === "pass" ? undefined : security.outcome });
  if (dashboard) steps.push({ name: "dashboard", status: dashboard.outcome, detail: dashboard.outcome === "pass" ? undefined : dashboard.outcome });

  const report: PassReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    outcome,
    plan,
    automated,
    steps,
    acceptedHooks,
    blockers,
    sync: buildSyncSummary(sync),
    doctor: {
      warnings: doctor.warnings.length,
      errors: doctor.errors.length,
    },
    validation: validation ? { outcome: validation.outcome } : undefined,
    security: security ? { outcome: security.outcome } : undefined,
    dashboard: dashboard ? { outcome: dashboard.outcome } : undefined,
    files: {
      pass: paths.passPath,
      doctor: paths.doctorPath,
      dashboard: paths.dashboardMarkdownPath,
    },
  };

  if (!options.dryRun) writeStateRecord("check", report as unknown as Record<string, unknown>, { projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  if (!options.silent) {
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatPassReport(report).trimEnd());
  }
  if (options.setExitCode !== false) process.exitCode = outcome === "fail" ? 2 : outcome === "warn" ? 1 : 0;
  return report;
}
