import fs from "node:fs";
import path from "node:path";
import { runDoctor } from "./doctor.js";
import { resolveProjectPaths } from "./paths.js";
import { readStateRecord, writeStateRecord, type StateStoreOptions } from "./state-store.js";
import { telemetryStatus, type TelemetryStatus } from "./telemetry.js";
import { OGB_VERSION, type StatusCounts } from "./types.js";

export interface DashboardOptions {
  projectRoot?: string;
  homeDir?: string;
  json?: boolean;
  refresh?: boolean;
  silent?: boolean;
  writeOnly?: boolean;
  strict?: boolean;
}

export interface DashboardReport {
  version: string;
  projectRoot: string;
  generatedAt: string;
  outcome: "pass" | "warn" | "fail";
  reports: {
    doctor: ReportSummary;
    validation: ReportSummary;
    security: ReportSummary;
  };
  resources: {
    geminiFiles: number;
    imports: StatusCounts;
    mcps: StatusCounts;
    skills: StatusCounts;
    agents: StatusCounts;
    commands: StatusCounts;
    extensions: StatusCounts;
  };
  generated: {
    contextVersion?: string;
    configVersion?: string;
    syncStateVersion?: string;
  };
  rulesync: {
    available: boolean;
    version?: string;
    lastStatus?: string;
    lastPromoted: number;
    lastConflicts: number;
  };
  startupSync: {
    installed: boolean;
    projectPlugin: boolean;
    projectConfig: boolean;
    globalPlugin: boolean;
    globalConfig: boolean;
    lastState: string;
    lastReason?: string;
    lastStartedAt?: string;
    lastFinishedAt?: string;
    lastDurationMs?: number;
    lastExitCode?: number | null;
    lastSignal?: string | null;
    lastError?: string;
    stdoutTail?: string;
    stderrTail?: string;
    failureCount?: number;
    nextRetryAfter?: string;
  };
  update: {
    exists: boolean;
    status: "current" | "available" | "updated" | "error" | "unknown" | "missing";
    currentVersion?: string;
    latestVersion?: string;
    latestTag?: string;
    releaseUrl?: string;
    checkedAt?: string;
    finishedAt?: string;
    restartRequired: boolean;
    message: string;
  };
  limits: {
    exists: boolean;
    status: "ok" | "partial" | "unavailable" | "error" | "missing";
    providers: number;
    openusage: string;
    openaiChatGPT: string;
    anthropicClaude: string;
    geminiCodeAssist: string;
    generatedAt?: string;
  };
  telemetry: {
    schema: TelemetryStatus["schema"];
    enabled: boolean;
    ready: boolean;
    disabledByEnv: boolean;
    endpointUrl: string;
    payloadLevel: string;
    source: string;
    outboxCount: number;
    runCount: number;
    sentRunCount: number;
    configPath: string;
    defaultsPath: string;
  };
  extensionCompatibility: {
    mapExists: boolean;
    extensions: number;
    projectedCommands: number;
    availableAgents: number;
    modelFallbacks: number;
    modelRoutingReport: boolean;
    modelRoutingEnabled: boolean;
    modelRoutingDecisions: number;
    modelRoutingRouted: number;
    modelRoutingSkipped: number;
    ohMyOpenAgentConfig: boolean;
    ohMyOpenAgentPlugin: boolean;
    hooks: number;
    scripts: number;
  };
  runtimeFallback: {
    configured: boolean;
    pluginActive: boolean;
    configExists: boolean;
    agentFallbacks: number;
    defaultFallbacks: number;
    cooldownMs?: number;
    maxRetries?: number;
  };
  modelResolution: {
    checked: boolean;
    availableModels: number;
    referencedModels: number;
    unresolved: string[];
    message: string;
  };
  warnings: string[];
  errors: string[];
  nextSteps: string[];
  files: {
    dashboardJson: string;
    dashboardMarkdown: string;
    limits: string;
    doctor: string;
    validation: string;
    security: string;
    pluginStatus: string;
    updateStatus: string;
    telemetryStatus: string;
  };
}

export interface ReportSummary {
  exists: boolean;
  status: "pass" | "warn" | "fail" | "missing";
  message: string;
}

interface ReportSummaryContext {
  homeMode?: boolean;
  updateStatus?: Record<string, any>;
}

function emptyCounts(): StatusCounts {
  return { ok: 0, warning: 0, error: 0, needs_review: 0 };
}

function readJson(filePath: string): Record<string, any> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function asCounts(value: unknown): StatusCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyCounts();
  const input = value as Partial<StatusCounts>;
  return {
    ok: Number(input.ok ?? 0),
    warning: Number(input.warning ?? 0),
    error: Number(input.error ?? 0),
    needs_review: Number(input.needs_review ?? 0),
  };
}

function total(counts: StatusCounts): number {
  return counts.ok + counts.warning + counts.error + counts.needs_review;
}

function firstFailedReportDetail(kind: "validation" | "security", report: Record<string, any>): string | undefined {
  const items = kind === "validation"
    ? (Array.isArray(report.checks) ? report.checks : [])
    : (Array.isArray(report.findings) ? report.findings : []);
  const failed = items.find((item: any) => item?.status === "fail");
  if (!failed) return undefined;
  const name = typeof failed.name === "string" ? failed.name.trim() : "";
  const message = compactLine(failed.message, 180);
  if (name && message) return `${name}: ${message}`;
  return name || message;
}

function reportItems(kind: "validation" | "security", report: Record<string, any>): any[] {
  return kind === "validation"
    ? (Array.isArray(report.checks) ? report.checks : [])
    : (Array.isArray(report.findings) ? report.findings : []);
}

function staleReportCommand(kind: "validation" | "security"): string {
  return kind === "validation" ? "validate" : "security-check";
}

function updateRequiresRestart(updateStatus: Record<string, any> | undefined): boolean {
  return updateStatus?.status === "updated" && updateStatus.restartRequired === true;
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function updateFinishedMs(updateStatus: Record<string, any> | undefined): number | undefined {
  return timestampMs(updateStatus?.finishedAt) ?? timestampMs(updateStatus?.checkedAt);
}

function reportGeneratedMs(report: Record<string, any>): number | undefined {
  return timestampMs(report.generatedAt);
}

function normalizeVersionTag(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^v/i, "");
}

function updateTargetsCurrentVersion(updateStatus: Record<string, any> | undefined): boolean {
  const candidates = [
    normalizeVersionTag(updateStatus?.latestVersion),
    normalizeVersionTag(updateStatus?.latestTag),
  ].filter(Boolean);
  if (candidates.length === 0) return true;
  return candidates.includes(OGB_VERSION);
}

function reportIsFreshForUpdate(report: Record<string, any> | undefined, updateMs: number | undefined): boolean {
  if (!report || report.version !== OGB_VERSION) return false;
  if (report.outcome !== "pass") return false;
  const generatedMs = reportGeneratedMs(report);
  if (!generatedMs) return false;
  return updateMs === undefined || generatedMs >= updateMs;
}

function consumeCompletedRestart(
  updateStatus: Record<string, any> | undefined,
  validation: Record<string, any> | undefined,
  security: Record<string, any> | undefined,
  stateOptions: StateStoreOptions,
): Record<string, any> | undefined {
  if (!updateRequiresRestart(updateStatus)) return updateStatus;
  if (!updateTargetsCurrentVersion(updateStatus)) return updateStatus;
  const updateMs = updateFinishedMs(updateStatus);
  if (!reportIsFreshForUpdate(validation, updateMs) || !reportIsFreshForUpdate(security, updateMs)) return updateStatus;

  const consumed = {
    ...updateStatus,
    status: "current",
    currentVersion: OGB_VERSION,
    restartRequired: false,
    restartAcknowledgedAt: new Date().toISOString(),
    message: `OGB ${OGB_VERSION} esta carregado e o check pos-update foi regenerado.`,
  };
  try {
    writeStateRecord("update", consumed, stateOptions);
  } catch {
    // Dashboard rendering should not fail just because the update status could not be rewritten.
  }
  return consumed;
}

function hasKnownWindowsQuotedCommandFailure(kind: "validation" | "security", report: Record<string, any>): boolean {
  return reportItems(kind, report).some((item: any) => {
    const text = [item?.name, item?.message, item?.details].map((value) =>
      typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)
    ).join("\n");
    return /\\?"[A-Za-z]:\\[^\r\n"]+\.cmd\\?"/i.test(text) && /(not recognized|reconhecid|n.o . reconhecid)/i.test(text);
  });
}

function staleReportMessage(kind: "validation" | "security", report: Record<string, any>, context: ReportSummaryContext): string | undefined {
  const version = typeof report.version === "string" ? report.version : undefined;
  if (version && version !== OGB_VERSION) {
    return `${kind} foi gerado pelo ogb ${version}; rode \`ogb ${staleReportCommand(kind)}\` para atualizar.`;
  }

  if (updateRequiresRestart(context.updateStatus)) {
    const updateMs = updateFinishedMs(context.updateStatus);
    const generatedMs = reportGeneratedMs(report);
    if (!generatedMs || (updateMs !== undefined && generatedMs < updateMs)) {
      return `${kind} foi gerado antes do ultimo self-update; rode \`ogb ${staleReportCommand(kind)}\` para atualizar.`;
    }
    if (hasKnownWindowsQuotedCommandFailure(kind, report)) {
      return `${kind} encontrou um erro conhecido de comando Windows antes do OpenCode reiniciar; rode \`ogb ${staleReportCommand(kind)}\` depois de reiniciar.`;
    }
  }

  if (context.homeMode && kind === "validation") {
    const checks = reportItems(kind, report);
    const hasProjectConfigMarkerFailure = checks.some((check: any) =>
      check?.status === "fail"
      && check?.name === "Generated config marker"
      && typeof check?.message === "string"
      && /generated config marker/i.test(check.message)
    );
    if (hasProjectConfigMarkerFailure) {
      return "validation antigo ainda esta procurando config de projeto dentro da home; rode `ogb validate` para atualizar.";
    }
  }

  if (context.homeMode && kind === "security") {
    const findings = reportItems(kind, report);
    const hasProjectYoloFailure = findings.some((finding: any) =>
      finding?.status === "fail"
      && finding?.name === "YOLO guardrails"
      && typeof finding?.message === "string"
      && finding.message.includes(".opencode/agents/YOLO.md")
    );
    if (hasProjectYoloFailure) {
      return "security antigo ainda esta procurando `.opencode/agents/YOLO.md` na home; rode `ogb security-check` para atualizar.";
    }
  }

  return undefined;
}

function reportSummary(kind: "doctor" | "validation" | "security", report: Record<string, any> | undefined, context: ReportSummaryContext = {}): ReportSummary {
  if (!report) {
    return {
      exists: false,
      status: "missing",
      message: kind === "doctor" ? "Doctor ainda nao foi gerado." : `${kind} ainda nao foi gerado.`,
    };
  }

  if (kind === "doctor") {
    const errors = Array.isArray(report.errors) ? report.errors.length : 0;
    const warnings = Array.isArray(report.warnings) ? report.warnings.length : 0;
    if (errors > 0) return { exists: true, status: "fail", message: `${errors} erro(s) no doctor.` };
    if (warnings > 0) return { exists: true, status: "warn", message: `${warnings} aviso(s) no doctor.` };
    return { exists: true, status: "pass", message: "Doctor limpo." };
  }

  const stale = staleReportMessage(kind, report, context);
  if (stale) return { exists: true, status: "warn", message: stale };

  if (report.outcome === "fail") {
    const detail = kind === "validation" || kind === "security" ? firstFailedReportDetail(kind, report) : undefined;
    return { exists: true, status: "fail", message: detail ? `${kind} falhou: ${detail}` : `${kind} falhou.` };
  }
  if (report.outcome === "warn") return { exists: true, status: "warn", message: `${kind} passou com avisos.` };
  if (report.outcome === "pass") return { exists: true, status: "pass", message: `${kind} limpo.` };
  return { exists: true, status: "warn", message: `${kind} existe, mas nao tem outcome conhecido.` };
}

function pluginStateStatus(state: string): "pass" | "warn" | "fail" | "missing" {
  if (state === "pass" || state === "ok") return "pass";
  if (state === "fail" || state === "error") return "fail";
  if (state === "stale") return "warn";
  if (state === "running") return "pass";
  return "missing";
}

function formatMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "tempo desconhecido";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function statusLabel(status: string): string {
  return status.toUpperCase();
}

function firstLines(items: string[], max = 6): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `...mais ${items.length - max}`];
}

function compactLine(value: unknown, max = 220): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.trim().split(/\r?\n/).find(Boolean);
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}...` : line;
}

function startupFailureMessage(pluginStatus: Record<string, any> | undefined): string {
  const parts: string[] = [];
  if (pluginStatus?.exitCode !== undefined) parts.push(`exit code ${pluginStatus.exitCode}`);
  if (typeof pluginStatus?.signal === "string" && pluginStatus.signal) parts.push(`signal ${pluginStatus.signal}`);
  const detail = compactLine(pluginStatus?.error)
    ?? compactLine(pluginStatus?.stderrTail)
    ?? compactLine(pluginStatus?.stdoutTail);
  if (detail) parts.push(detail);
  return parts.length > 0 ? `Startup sync falhou com ${parts.join(": ")}.` : "Startup sync falhou.";
}

function staleUpdateErrorVersion(updateStatus: Record<string, any> | undefined): string | undefined {
  if (updateStatus?.status !== "error") return undefined;
  const currentVersion = typeof updateStatus.currentVersion === "string"
    ? updateStatus.currentVersion
    : typeof updateStatus.check?.currentVersion === "string"
      ? updateStatus.check.currentVersion
      : undefined;
  if (!currentVersion || currentVersion === OGB_VERSION) return undefined;
  return currentVersion;
}

function publicTelemetryStatus(status: TelemetryStatus): DashboardReport["telemetry"] {
  return {
    schema: status.schema,
    enabled: status.enabled,
    ready: status.ready,
    disabledByEnv: status.disabledByEnv,
    endpointUrl: status.endpointUrl,
    payloadLevel: status.payloadLevel,
    source: status.source,
    outboxCount: status.outboxCount,
    runCount: status.runCount,
    sentRunCount: status.sentRunCount,
    configPath: status.configPath,
    defaultsPath: status.defaultsPath,
  };
}

function buildNextSteps(report: DashboardReport): string[] {
  const steps: string[] = [];
  const startupStale = report.startupSync.lastState === "stale";

  if (report.update.restartRequired) {
    steps.push("Reinicie o OpenCode para carregar a versao nova do OGB, incluindo plugin, comandos e sidebar.");
  }
  if (!report.startupSync.installed) {
    steps.push("Rode `ogb setup-opencode --force` para instalar o plugin local do OpenCode.");
  } else if (report.startupSync.lastState === "unknown") {
    steps.push("Reinicie o OpenCode para o plugin gravar o primeiro status de startup sync.");
  } else if (startupStale) {
    steps.push("Reinicie o OpenCode para carregar o plugin novo e limpar o status de startup sync.");
  }

  if (report.reports.doctor.status !== "pass" && !startupStale) {
    steps.push("Rode `ogb doctor` e corrija os avisos antes de distribuir.");
  }
  if (report.reports.validation.status !== "pass" && !startupStale) {
    steps.push("Rode `ogb validate` depois de mudar comandos, agentes, MCPs ou instaladores.");
  }
  if (report.reports.security.status !== "pass") {
    steps.push("Rode `ogb security-check` antes de empacotar ou publicar.");
  }
  if (report.extensionCompatibility.scripts > 0) {
    steps.push("Scripts soltos de Gemini Extensions continuam como superficie de revisao; hooks BeforeTool/AfterTool compativeis de settings/extensoes rodam pelo plugin OGB.");
  }
  if (report.runtimeFallback.configured && (!report.runtimeFallback.pluginActive || !report.runtimeFallback.configExists)) {
    steps.push("Rode `ogb sync` para alinhar o plugin/config do runtime fallback externo.");
  }
  if (report.modelResolution.unresolved.length > 0) {
    steps.push("Revise os modelos em `.opencode/ogb.config.jsonc`; ha modelos que nao aparecem em `opencode models`.");
  }
  if (steps.length === 0) steps.push("Nada critico pendente. Use `/bridge` no OpenCode para consultar este painel.");

  return steps;
}

export function formatDashboard(report: DashboardReport): string {
  const startup = report.startupSync.lastState === "unknown"
    ? "sem execucao registrada"
    : `${statusLabel(report.startupSync.lastState)}${report.startupSync.lastFinishedAt ? ` em ${report.startupSync.lastFinishedAt}` : ""}${report.startupSync.lastDurationMs ? ` (${formatMs(report.startupSync.lastDurationMs)})` : ""}${report.startupSync.nextRetryAfter ? `, retry after ${report.startupSync.nextRetryAfter}` : ""}`;
  const modelRouting = report.extensionCompatibility.modelRoutingReport
    ? `OGB ${report.extensionCompatibility.modelRoutingEnabled ? "active" : "disabled"}, ${report.extensionCompatibility.modelRoutingDecisions} decision(s)${report.extensionCompatibility.modelRoutingRouted > 0 ? `, ${report.extensionCompatibility.modelRoutingRouted} routed` : ""}${report.extensionCompatibility.modelRoutingSkipped > 0 ? `, ${report.extensionCompatibility.modelRoutingSkipped} skipped` : ""}`
    : "missing - run `ogb sync`";
  const update = report.update.exists
    ? `${statusLabel(report.update.status)}${report.update.latestTag ? ` ${report.update.latestTag}` : ""}${report.update.restartRequired ? " - restart OpenCode" : ""}`
    : "MISSING - checked on next startup";
  const telemetry = report.telemetry.ready
    ? `READY - ${report.telemetry.payloadLevel}, outbox ${report.telemetry.outboxCount}, sent runs ${report.telemetry.sentRunCount}`
    : report.telemetry.enabled
      ? `ENABLED but not ready - outbox ${report.telemetry.outboxCount}`
      : `DISABLED${report.telemetry.outboxCount > 0 ? ` - outbox ${report.telemetry.outboxCount}` : ""}`;

  const lines = [
    "OpenCode Gemini Bridge Dashboard",
    `Project: ${report.projectRoot}`,
    `Outcome: ${statusLabel(report.outcome)}`,
    "",
    "Resumo:",
    `- Gemini context: ${report.resources.geminiFiles} GEMINI.md, context ${report.generated.contextVersion ?? "missing"}, config ${report.generated.configVersion ?? "missing"}`,
    `- OpenCode: ${total(report.resources.mcps)} MCPs, ${total(report.resources.skills)} skills, ${total(report.resources.agents)} agent(s), ${total(report.resources.commands)} commands`,
    `- Extensions: ${report.extensionCompatibility.extensions} extension(s), ${report.extensionCompatibility.projectedCommands} command(s), ${report.extensionCompatibility.availableAgents} agent(s) mapped`,
    `- Model routing: ${report.extensionCompatibility.modelFallbacks} configured agent(s), ${modelRouting}`,
    `- Runtime fallback: ${report.runtimeFallback.configured ? `${report.runtimeFallback.pluginActive ? "plugin active" : "plugin missing"}, config ${report.runtimeFallback.configExists ? "present" : "missing"}, ${report.runtimeFallback.agentFallbacks} agent chain(s), retries ${report.runtimeFallback.maxRetries ?? "n/a"}, cooldown ${report.runtimeFallback.cooldownMs ?? "n/a"}ms` : "disabled"}`,
    `- Model resolution: ${report.modelResolution.message}`,
    `- Extension hooks/scripts: ${report.extensionCompatibility.hooks} hook file(s) synced by OGB when compatible, ${report.extensionCompatibility.scripts} script(s) review-only`,
    `- Rulesync: ${report.rulesync.available ? `available${report.rulesync.version ? ` ${report.rulesync.version}` : ""}` : "unavailable"}${report.rulesync.lastStatus ? `, last ${report.rulesync.lastStatus}` : ""}`,
    `- Startup sync: ${startup}`,
    `- OGB update: ${update}`,
    `- Telemetry: ${telemetry}`,
    `- Usage limits: ${report.limits.exists ? `${statusLabel(report.limits.status)} - ${report.limits.providers} provider(s), OpenUsage ${report.limits.openusage}, OpenAI ${report.limits.openaiChatGPT}, Claude ${report.limits.anthropicClaude}, Gemini ${report.limits.geminiCodeAssist}` : "MISSING - run `ogb limits` or `/bridge`"}`,
    "",
    "Checks:",
    `- Doctor: ${statusLabel(report.reports.doctor.status)} - ${report.reports.doctor.message}`,
    `- Validation: ${statusLabel(report.reports.validation.status)} - ${report.reports.validation.message}`,
    `- Security: ${statusLabel(report.reports.security.status)} - ${report.reports.security.message}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "Avisos:");
    for (const warning of firstLines(report.warnings)) lines.push(`- ${warning}`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Erros:");
    for (const error of firstLines(report.errors)) lines.push(`- ${error}`);
  }

  lines.push("", "Proximos passos:");
  for (const step of report.nextSteps) lines.push(`- ${step}`);

  return `${lines.join("\n")}\n`;
}

export function runDashboard(options: DashboardOptions = {}): DashboardReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const refresh = options.refresh !== false;
  const warnings: string[] = [];
  const errors: string[] = [];

  if (refresh) {
    try {
      runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });
    } catch (error) {
      warnings.push(`Nao consegui atualizar o doctor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const stateOptions = { projectRoot: paths.projectRoot, homeDir: paths.homeDir };
  const doctor = readStateRecord<Record<string, any>>("doctor", stateOptions).data;
  const validation = readStateRecord<Record<string, any>>("validation", stateOptions).data;
  const security = readStateRecord<Record<string, any>>("security", stateOptions).data;
  const limits = readJson(paths.limitsPath);
  const pluginStatus = readStateRecord<Record<string, any>>("startup", stateOptions).data;
  const rawUpdateStatus = readStateRecord<Record<string, any>>("update", stateOptions).data;
  const updateStatus = consumeCompletedRestart(rawUpdateStatus, validation, security, stateOptions);
  const telemetry = publicTelemetryStatus(telemetryStatus({ homeDir: paths.homeDir }));
  const doctorSummary = reportSummary("doctor", doctor);
  const validationSummary = reportSummary("validation", validation, { homeMode: paths.homeMode, updateStatus });
  const securitySummary = reportSummary("security", security, { homeMode: paths.homeMode, updateStatus });
  const pluginState = typeof doctor?.startupSync?.lastState === "string"
    ? doctor.startupSync.lastState
    : typeof pluginStatus?.state === "string"
      ? pluginStatus.state
      : "unknown";
  const pluginStatusLevel = pluginStateStatus(pluginState);
  const staleUpdateVersion = staleUpdateErrorVersion(updateStatus);

  if (Array.isArray(doctor?.warnings)) warnings.push(...doctor.warnings.map(String));
  if (Array.isArray(doctor?.errors)) errors.push(...doctor.errors.map(String));
  if (validationSummary.status === "warn") warnings.push(validationSummary.message);
  if (validationSummary.status === "fail") errors.push(validationSummary.message);
  if (securitySummary.status === "warn") warnings.push(securitySummary.message);
  if (securitySummary.status === "fail") errors.push(securitySummary.message);
  if (pluginStatusLevel === "fail") errors.push(startupFailureMessage(pluginStatus));
  if (pluginStatusLevel === "warn" && pluginState === "stale") {
    const staleWarning = "OpenCode startup sync ficou preso em running, mas o processo nao existe mais. Reinicie o OpenCode para carregar o plugin novo.";
    if (!warnings.includes(staleWarning)) warnings.push(staleWarning);
  }
  if (updateStatus?.status === "error" && !staleUpdateVersion && typeof updateStatus.message === "string") warnings.push(`Auto-update do OGB falhou: ${updateStatus.message}`);

  const counts = doctor?.counts ?? {};
  const startupSync = doctor?.startupSync ?? {};
  const extensionCompatibility = doctor?.extensionCompatibility ?? {};
  const runtimeFallback = doctor?.runtimeFallback ?? {};
  const modelResolution = doctor?.modelResolution ?? {};
  const generated = doctor?.generated ?? {};
  const rulesync = doctor?.rulesync ?? {};

  const reportWithoutSteps: Omit<DashboardReport, "nextSteps"> = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    generatedAt: new Date().toISOString(),
    outcome: "pass",
    reports: {
      doctor: doctorSummary,
      validation: validationSummary,
      security: securitySummary,
    },
    resources: {
      geminiFiles: Number(counts.geminiFiles ?? 0),
      imports: asCounts(counts.imports),
      mcps: asCounts(counts.mcps),
      skills: asCounts(counts.skills),
      agents: asCounts(counts.agents),
      commands: asCounts(counts.commands),
      extensions: asCounts(counts.extensions),
    },
    generated: {
      contextVersion: typeof generated.expandedGeminiVersion === "string" ? generated.expandedGeminiVersion : undefined,
      configVersion: typeof generated.generatedConfigVersion === "string" ? generated.generatedConfigVersion : undefined,
      syncStateVersion: typeof generated.syncStateVersion === "string" ? generated.syncStateVersion : undefined,
    },
    rulesync: {
      available: Boolean(rulesync.available),
      version: typeof rulesync.version === "string" ? rulesync.version : undefined,
      lastStatus: typeof rulesync.lastStatus === "string" ? rulesync.lastStatus : undefined,
      lastPromoted: Number(rulesync.lastPromoted ?? 0),
      lastConflicts: Number(rulesync.lastConflicts ?? 0),
    },
    startupSync: {
      installed: paths.homeMode
        ? Boolean(startupSync.globalPlugin && startupSync.globalConfig)
        : Boolean(startupSync.projectPlugin && startupSync.projectConfig),
      projectPlugin: Boolean(startupSync.projectPlugin),
      projectConfig: Boolean(startupSync.projectConfig),
      globalPlugin: Boolean(startupSync.globalPlugin),
      globalConfig: Boolean(startupSync.globalConfig),
      lastState: pluginState,
      lastReason: typeof pluginStatus?.reason === "string" ? pluginStatus.reason : undefined,
      lastStartedAt: typeof startupSync.lastStartedAt === "string" ? startupSync.lastStartedAt : typeof pluginStatus?.startedAt === "string" ? pluginStatus.startedAt : undefined,
      lastFinishedAt: typeof startupSync.lastFinishedAt === "string" ? startupSync.lastFinishedAt : typeof pluginStatus?.finishedAt === "string" ? pluginStatus.finishedAt : undefined,
      lastDurationMs: typeof pluginStatus?.durationMs === "number" ? pluginStatus.durationMs : undefined,
      lastExitCode: typeof pluginStatus?.exitCode === "number" || pluginStatus?.exitCode === null ? pluginStatus.exitCode : undefined,
      lastSignal: typeof pluginStatus?.signal === "string" || pluginStatus?.signal === null ? pluginStatus.signal : undefined,
      lastError: typeof pluginStatus?.error === "string" ? pluginStatus.error : undefined,
      stdoutTail: typeof pluginStatus?.stdoutTail === "string" ? pluginStatus.stdoutTail : undefined,
      stderrTail: typeof pluginStatus?.stderrTail === "string" ? pluginStatus.stderrTail : undefined,
      failureCount: typeof pluginStatus?.failureCount === "number" ? pluginStatus.failureCount : undefined,
      nextRetryAfter: typeof pluginStatus?.nextRetryAfter === "string" ? pluginStatus.nextRetryAfter : undefined,
    },
    update: {
      exists: Boolean(updateStatus),
      status: staleUpdateVersion
        ? "unknown"
        : updateStatus?.status === "current"
        || updateStatus?.status === "available"
        || updateStatus?.status === "updated"
        || updateStatus?.status === "error"
        || updateStatus?.status === "unknown"
        ? updateStatus.status
        : "missing",
      currentVersion: typeof updateStatus?.currentVersion === "string" ? updateStatus.currentVersion : undefined,
      latestVersion: typeof updateStatus?.latestVersion === "string" ? updateStatus.latestVersion : undefined,
      latestTag: typeof updateStatus?.latestTag === "string" ? updateStatus.latestTag : undefined,
      releaseUrl: typeof updateStatus?.releaseUrl === "string" ? updateStatus.releaseUrl : undefined,
      checkedAt: typeof updateStatus?.checkedAt === "string" ? updateStatus.checkedAt : undefined,
      finishedAt: typeof updateStatus?.finishedAt === "string" ? updateStatus.finishedAt : undefined,
      restartRequired: !staleUpdateVersion && updateStatus?.restartRequired === true,
      message: staleUpdateVersion
        ? `Ignorando erro antigo de update do ogb ${staleUpdateVersion}; versao atual e ${OGB_VERSION}.`
        : typeof updateStatus?.message === "string" ? updateStatus.message : "Update status ainda nao foi gerado.",
    },
    limits: {
      exists: Boolean(limits),
      status: limits?.status === "ok" || limits?.status === "partial" || limits?.status === "unavailable" || limits?.status === "error" ? limits.status : "missing",
      providers: Array.isArray(limits?.providers) ? limits.providers.length : 0,
      openusage: typeof limits?.sources?.openusage?.status === "string" ? limits.sources.openusage.status : "missing",
      openaiChatGPT: typeof limits?.sources?.openaiChatGPT?.status === "string" ? limits.sources.openaiChatGPT.status : "missing",
      anthropicClaude: typeof limits?.sources?.anthropicClaude?.status === "string" ? limits.sources.anthropicClaude.status : "missing",
      geminiCodeAssist: typeof limits?.sources?.geminiCodeAssist?.status === "string" ? limits.sources.geminiCodeAssist.status : "missing",
      generatedAt: typeof limits?.generatedAt === "string" ? limits.generatedAt : undefined,
    },
    telemetry,
    extensionCompatibility: {
      mapExists: Boolean(extensionCompatibility.mapExists),
      extensions: Number(extensionCompatibility.extensions ?? 0),
      projectedCommands: Number(extensionCompatibility.projectedCommands ?? 0),
      availableAgents: Number(extensionCompatibility.availableAgents ?? 0),
      modelFallbacks: Number(extensionCompatibility.modelFallbacks ?? 0),
      modelRoutingReport: Boolean(extensionCompatibility.modelRoutingReport),
      modelRoutingEnabled: extensionCompatibility.modelRoutingEnabled !== false,
      modelRoutingDecisions: Number(extensionCompatibility.modelRoutingDecisions ?? 0),
      modelRoutingRouted: Number(extensionCompatibility.modelRoutingRouted ?? 0),
      modelRoutingSkipped: Number(extensionCompatibility.modelRoutingSkipped ?? 0),
      ohMyOpenAgentConfig: Boolean(extensionCompatibility.ohMyOpenAgentConfig),
      ohMyOpenAgentPlugin: Boolean(extensionCompatibility.ohMyOpenAgentPlugin),
      hooks: Number(extensionCompatibility.hooks ?? 0),
      scripts: Number(extensionCompatibility.scripts ?? 0),
    },
    runtimeFallback: {
      configured: Boolean(runtimeFallback.configured),
      pluginActive: Boolean(runtimeFallback.pluginActive),
      configExists: Boolean(runtimeFallback.configExists),
      agentFallbacks: Number(runtimeFallback.agentFallbacks ?? 0),
      defaultFallbacks: Number(runtimeFallback.defaultFallbacks ?? 0),
      cooldownMs: typeof runtimeFallback.cooldownMs === "number" ? runtimeFallback.cooldownMs : undefined,
      maxRetries: typeof runtimeFallback.maxRetries === "number" ? runtimeFallback.maxRetries : undefined,
    },
    modelResolution: {
      checked: Boolean(modelResolution.checked),
      availableModels: Number(modelResolution.availableModels ?? 0),
      referencedModels: Number(modelResolution.referencedModels ?? 0),
      unresolved: Array.isArray(modelResolution.unresolved) ? modelResolution.unresolved.map(String) : [],
      message: typeof modelResolution.message === "string" ? modelResolution.message : "Model resolution not run.",
    },
    warnings,
    errors,
    files: {
      dashboardJson: paths.dashboardPath,
      dashboardMarkdown: paths.dashboardMarkdownPath,
      limits: paths.limitsPath,
      doctor: paths.doctorPath,
      validation: paths.validationPath,
      security: paths.securityPath,
      pluginStatus: paths.pluginStatusPath,
      updateStatus: paths.updateStatusPath,
      telemetryStatus: paths.telemetryStatusPath,
    },
  };

  const outcome = errors.length > 0
    ? "fail"
    : warnings.length > 0 || [doctorSummary, validationSummary, securitySummary].some((item) => item.status === "warn" || item.status === "missing")
      ? "warn"
      : "pass";

  const report: DashboardReport = {
    ...reportWithoutSteps,
    outcome,
    nextSteps: [],
  };
  report.nextSteps = buildNextSteps(report);

  const markdown = formatDashboard(report);
  fs.mkdirSync(path.dirname(paths.dashboardPath), { recursive: true });
  fs.writeFileSync(paths.telemetryStatusPath, `${JSON.stringify(report.telemetry, null, 2)}\n`, "utf8");
  writeStateRecord("dashboard", report as unknown as Record<string, unknown>, stateOptions);
  fs.writeFileSync(paths.dashboardMarkdownPath, markdown, "utf8");

  if (!options.silent && !options.writeOnly) {
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(markdown.trimEnd());
  }

  if (options.strict && outcome !== "pass") process.exitCode = outcome === "fail" ? 2 : 1;
  return report;
}
