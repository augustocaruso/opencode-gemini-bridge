import fs from "node:fs";
import path from "node:path";
import { runDashboard, type DashboardReport } from "./dashboard.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { sha256File } from "./file-hash.js";
import { buildInventory } from "./inventory.js";
import { resolveProjectPaths } from "./paths.js";
import { runSecurityCheck, type SecurityReport } from "./security.js";
import { setupOpenCode, type SetupOpenCodeReport } from "./setup-opencode.js";
import { syncToOpenCode, type SyncReport } from "./sync.js";
import { hookTrustKey, readTrustFile, writeTrustFile } from "./trust.js";
import { OGB_VERSION } from "./types.js";
import { runValidation, type ValidationReport } from "./validation.js";

export interface PassOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  acceptHooks?: boolean;
  skipSetup?: boolean;
  skipSync?: boolean;
  skipValidation?: boolean;
  skipSecurity?: boolean;
  skipDashboard?: boolean;
}

export interface PassBlocker {
  severity: "warn" | "fail";
  source: "doctor" | "validation" | "security" | "setup" | "sync" | "dashboard";
  message: string;
  action: string;
}

export interface PassReport {
  version: string;
  projectRoot: string;
  outcome: "pass" | "warn" | "fail";
  automated: string[];
  acceptedHooks: string[];
  blockers: PassBlocker[];
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
  if (/^Hook needs review:/.test(warning)) return "Revise o hook e rode `ogb pass --accept-hooks` para registrar o hash revisado.";
  if (/Duplicate name/i.test(warning)) return "Rode `ogb pass --json` ou abra `.opencode/generated/ogb-inventory.json` para ver os paths duplicados; mantenha uma copia.";
  if (/Run ogb sync/i.test(warning)) return "O `ogb pass` ja tentou `ogb sync`; se persistir, revise conflitos em arquivos gerenciados e rode com `--force` se for seguro.";
  if (/opencode-auto-fallback config exists but is disabled/i.test(warning)) return "Ative o fallback gerado ou desative `externalPlugins.autoFallback` em `.opencode/ogb.config.jsonc`.";
  if (/opencode-auto-fallback/i.test(warning)) return "Rode `ogb pass --force`; se persistir, revise o plugin em `opencode.jsonc` e a config de fallback.";
  if (/Model resolution warning/i.test(warning)) return "Revise os modelos em `.opencode/ogb.config.jsonc` e compare com `opencode models`.";
  if (/MCP command warning/i.test(warning)) return "Instale o comando do MCP ou remova/desabilite esse MCP na configuracao de origem.";
  return "Leia o aviso do doctor; se for recurso gerenciado pelo OGB, rode `ogb pass --force` depois de revisar.";
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

function writeReport(filePath: string, report: PassReport): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function formatPassReport(report: PassReport): string {
  const lines = [
    "OpenCode Gemini Bridge Pass",
    `Project: ${report.projectRoot}`,
    `Outcome: ${report.outcome.toUpperCase()}`,
    "",
    "Automacao:",
    ...report.automated.map((item) => `- ${item}`),
  ];

  if (report.acceptedHooks.length > 0) {
    lines.push("", "Hooks aceitos:");
    for (const hook of report.acceptedHooks) lines.push(`- ${hook}`);
  }

  if (report.blockers.length > 0) {
    lines.push("", "Pendencias:");
    for (const item of report.blockers) {
      lines.push(`- ${item.severity.toUpperCase()} ${item.source}: ${item.message}`);
      lines.push(`  Acao: ${item.action}`);
    }
  } else {
    lines.push("", "Sem pendencias bloqueantes.");
  }

  lines.push("", `Relatorio: ${report.files.pass}`);
  return `${lines.join("\n")}\n`;
}

export function runPass(options: PassOptions = {}): PassReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const automated: string[] = [];
  const blockers: PassBlocker[] = [];
  let setup: SetupOpenCodeReport | undefined;
  let sync: SyncReport | undefined;
  let validation: ValidationReport | undefined;
  let security: SecurityReport | undefined;
  let dashboard: DashboardReport | undefined;

  if (!options.skipSetup) {
    setup = setupOpenCode({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      dryRun: options.dryRun,
      force: options.force,
      skipDoctor: true,
      skipCommandCheck: true,
    });
    automated.push("setup-opencode");
    for (const warning of setup.warnings) blockers.push(blocker("setup", "warn", warning, "Revise conflitos do setup; rode `ogb pass --force` se quiser sobrescrever arquivos gerenciados."));
  }

  if (!options.skipSync) {
    sync = syncToOpenCode({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      dryRun: options.dryRun,
      force: options.force,
    });
    automated.push("sync");
    for (const warning of sync.warnings) blockers.push(blocker("sync", "warn", warning, "Revise conflitos do sync; rode `ogb pass --force` se quiser sobrescrever arquivos gerenciados."));
  }

  let doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
  automated.push("doctor");

  const acceptedHooks = options.acceptHooks ? acceptCurrentHooks(paths.projectRoot, paths.homeDir, options.dryRun) : [];
  if (acceptedHooks.length > 0) {
    doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    automated.push("doctor-after-hook-acceptance");
  }

  if (!options.skipValidation) {
    validation = runValidation({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    automated.push("validate");
  }

  if (!options.skipSecurity) {
    security = runSecurityCheck({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    automated.push("security-check");
  }

  if (!options.skipDashboard) {
    dashboard = runDashboard({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true, refresh: false });
    automated.push("dashboard");
  }

  for (const error of doctor.errors) blockers.push(blocker("doctor", "fail", error, "Corrija o erro indicado pelo doctor e rode `ogb pass` novamente."));
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

  const report: PassReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    outcome,
    automated,
    acceptedHooks,
    blockers,
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

  if (!options.dryRun) writeReport(paths.passPath, report);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatPassReport(report).trimEnd());
  process.exitCode = outcome === "fail" ? 2 : outcome === "warn" ? 1 : 0;
  return report;
}
