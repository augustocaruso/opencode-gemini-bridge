import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OGB_VERSION } from "./types.js";

export const TELEMETRY_RUN_RECORD_SCHEMA = "opencode-gemini-bridge.workflow-run-record.v1";
export const TELEMETRY_ENVELOPE_SCHEMA = "opencode-gemini-bridge.workflow-telemetry-envelope.v1";
export const TELEMETRY_STATUS_SCHEMA = "opencode-gemini-bridge.telemetry-status.v1";
export const TELEMETRY_SENT_SCHEMA = "opencode-gemini-bridge.workflow-telemetry-sent.v1";
export const TELEMETRY_DEFAULTS_SCHEMA = "opencode-gemini-bridge.telemetry-defaults.v1";
export const TELEMETRY_PAYLOAD_LEVELS = ["diagnostic_redacted", "full_logs"] as const;
export type TelemetryPayloadLevel = typeof TELEMETRY_PAYLOAD_LEVELS[number];

const DEFAULT_PAYLOAD_LEVEL: TelemetryPayloadLevel = "diagnostic_redacted";
const DEFAULT_MAX_ENVELOPE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_SNIPPET_CHARS = 420;
const MAX_PATHS = 24;
const SECRET_KEYS = new Set(["token", "auth_token", "api_key", "apikey", "secret", "password", "authorization", "bearer", "cookie"]);
const LONG_TEXT_KEYS = new Set(["content", "markdown", "html", "raw_chat", "note_text", "prompt", "instructions"]);
const PATH_KEY_HINTS = ["path", "file", "dir", "manifest", "receipt", "output", "target"];

type FetchResponseLike = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<FetchResponseLike>;

export interface TelemetryPaths {
  root: string;
  configPath: string;
  runsDir: string;
  outboxDir: string;
  sentPath: string;
}

export interface TelemetryConfig {
  enabled: boolean;
  endpointUrl: string;
  authToken: string;
  payloadLevel: TelemetryPayloadLevel;
  consentAt: string;
  installId: string;
  maxEnvelopeBytes: number;
  source: "user" | "distribution_default" | "user_disabled";
  autoEnabledAt: string;
  optOutAt: string;
  defaultsPath: string;
}

export interface TelemetryStatus {
  schema: typeof TELEMETRY_STATUS_SCHEMA;
  enabled: boolean;
  ready: boolean;
  disabledByEnv: boolean;
  endpointUrl: string;
  payloadLevel: TelemetryPayloadLevel;
  consentAt: string;
  autoEnabledAt: string;
  optOutAt: string;
  source: TelemetryConfig["source"];
  installId: string;
  outboxCount: number;
  runCount: number;
  sentRunCount: number;
  configPath: string;
  defaultsPath: string;
}

export interface WorkflowRecordInput {
  workflow: string;
  phase?: string;
  status?: string;
  outcome?: string;
  exitCode?: number;
  durationMs?: number;
  command?: string;
  source?: "cli" | "plugin" | "agent" | "test";
  payload?: unknown;
  rawPayload?: unknown;
  projectRoot?: string;
  homeDir?: string;
  snippets?: string[];
  extra?: Record<string, unknown>;
}

export interface WorkflowRunRecord {
  schema: typeof TELEMETRY_RUN_RECORD_SCHEMA;
  runId: string;
  recordedAt: string;
  workflow: string;
  source: string;
  command: string;
  status: string;
  outcome: string;
  phase: string;
  exitCode: number;
  durationMs: number;
  project?: {
    label: string;
    pathHash: string;
  };
  payloadSummary: Record<string, unknown>;
  diagnosticContext: Record<string, unknown>;
  environmentContext: Record<string, unknown>;
  diagnosticSnippets: string[];
  extra: Record<string, unknown>;
}

export interface TelemetryEnvelope {
  schema: typeof TELEMETRY_ENVELOPE_SCHEMA;
  envelopeId: string;
  generatedAt: string;
  installId: string;
  payloadLevel: TelemetryPayloadLevel;
  client: Record<string, unknown>;
  records: Record<string, unknown>[];
  limits: {
    maxEnvelopeBytes: number;
  };
  truncated: boolean;
  queuedAt?: string;
  attempts?: number;
  lastAttemptAt?: string;
}

export interface TelemetryOptions {
  homeDir?: string;
  configPath?: string;
  root?: string;
  fetchImpl?: FetchLike;
}

export interface TelemetrySendOptions extends TelemetryOptions {
  since?: string;
  limit?: number;
  includePass?: boolean;
  includeAutomation?: boolean;
}

export interface TelemetrySendResult {
  ok: boolean;
  sent: number;
  failed: number;
  queued: number;
  reason?: string;
  errors: string[];
  status?: TelemetryStatus;
}

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function coercePayloadLevel(value: unknown): TelemetryPayloadLevel {
  return value === "full_logs" ? "full_logs" : DEFAULT_PAYLOAD_LEVEL;
}

function coerceMaxBytes(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_MAX_ENVELOPE_BYTES);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ENVELOPE_BYTES;
  return Math.max(16 * 1024, Math.min(2 * 1024 * 1024, Math.trunc(parsed)));
}

function telemetryRootFrom(options: TelemetryOptions = {}): string {
  if (options.root) return path.resolve(options.root);
  if (options.configPath) return path.dirname(path.resolve(options.configPath));
  const homeDir = options.homeDir ?? os.homedir();
  return path.join(homeDir, ".config", "opencode-gemini-bridge", "telemetry");
}

export function telemetryPaths(options: TelemetryOptions = {}): TelemetryPaths {
  const root = telemetryRootFrom(options);
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : process.env.OGB_TELEMETRY_CONFIG
      ? path.resolve(process.env.OGB_TELEMETRY_CONFIG)
      : path.join(root, "config.json");
  const finalRoot = options.root ? root : path.dirname(configPath);
  return {
    root: finalRoot,
    configPath,
    runsDir: path.join(finalRoot, "runs"),
    outboxDir: path.join(finalRoot, "outbox"),
    sentPath: path.join(finalRoot, "telemetry-sent.json"),
  };
}

function emptyConfig(): TelemetryConfig {
  return {
    enabled: false,
    endpointUrl: "",
    authToken: "",
    payloadLevel: DEFAULT_PAYLOAD_LEVEL,
    consentAt: "",
    installId: "",
    maxEnvelopeBytes: DEFAULT_MAX_ENVELOPE_BYTES,
    source: "user",
    autoEnabledAt: "",
    optOutAt: "",
    defaultsPath: "",
  };
}

function configFromRaw(raw: any): TelemetryConfig {
  const source = raw?.source === "distribution_default" || raw?.source === "user_disabled" ? raw.source : "user";
  return {
    enabled: raw?.enabled === true,
    endpointUrl: String(raw?.endpointUrl ?? raw?.endpoint_url ?? ""),
    authToken: String(raw?.authToken ?? raw?.auth_token ?? ""),
    payloadLevel: coercePayloadLevel(raw?.payloadLevel ?? raw?.payload_level),
    consentAt: String(raw?.consentAt ?? raw?.consent_at ?? ""),
    installId: String(raw?.installId ?? raw?.install_id ?? ""),
    maxEnvelopeBytes: coerceMaxBytes(raw?.maxEnvelopeBytes ?? raw?.max_envelope_bytes),
    source,
    autoEnabledAt: String(raw?.autoEnabledAt ?? raw?.auto_enabled_at ?? ""),
    optOutAt: String(raw?.optOutAt ?? raw?.opt_out_at ?? ""),
    defaultsPath: String(raw?.defaultsPath ?? raw?.defaults_path ?? ""),
  };
}

function configToJson(config: TelemetryConfig): Record<string, unknown> {
  return {
    schema: "opencode-gemini-bridge.telemetry-config.v1",
    enabled: config.enabled,
    endpointUrl: config.endpointUrl,
    authToken: config.authToken,
    payloadLevel: config.payloadLevel,
    consentAt: config.consentAt,
    installId: config.installId,
    maxEnvelopeBytes: config.maxEnvelopeBytes,
    source: config.source,
    autoEnabledAt: config.autoEnabledAt,
    optOutAt: config.optOutAt,
    defaultsPath: config.defaultsPath,
  };
}

function writeConfig(config: TelemetryConfig, options: TelemetryOptions = {}): void {
  atomicWriteJson(telemetryPaths(options).configPath, configToJson(config));
}

function moduleDefaultCandidates(): string[] {
  const candidates: string[] = [];
  const push = (candidate: string | undefined) => {
    if (candidate) candidates.push(path.resolve(candidate));
  };

  push(process.env.OGB_TELEMETRY_DEFAULTS);
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(modulePath);
  const roots = [
    moduleDir,
    path.dirname(moduleDir),
    process.cwd(),
  ];
  for (const root of roots) push(path.join(root, "telemetry.defaults.json"));

  return [...new Set(candidates)];
}

function readDistributionDefaults(): Record<string, unknown> | undefined {
  if (process.env.OGB_TELEMETRY_DEFAULTS_DISABLED === "1") return undefined;
  const allowedKeys = new Set([
    "schema",
    "enabled",
    "endpoint_url",
    "endpointUrl",
    "auth_token",
    "authToken",
    "payload_level",
    "payloadLevel",
    "max_envelope_bytes",
    "maxEnvelopeBytes",
  ]);
  for (const candidate of moduleDefaultCandidates()) {
    const raw = readJson(candidate);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const source = raw.telemetry && typeof raw.telemetry === "object" && !Array.isArray(raw.telemetry)
      ? raw.telemetry
      : raw;
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    if (Object.keys(source).some((key) => !allowedKeys.has(key))) continue;
    const endpointUrl = String((source as any).endpointUrl ?? (source as any).endpoint_url ?? "");
    const authToken = String((source as any).authToken ?? (source as any).auth_token ?? "");
    if ((source as any).enabled !== true || !endpointUrl || !authToken) continue;
    return {
      enabled: true,
      endpointUrl,
      authToken,
      payloadLevel: coercePayloadLevel((source as any).payloadLevel ?? (source as any).payload_level),
      maxEnvelopeBytes: coerceMaxBytes((source as any).maxEnvelopeBytes ?? (source as any).max_envelope_bytes),
      defaultsPath: candidate,
    };
  }
  return undefined;
}

function shouldApplyDefaults(current: TelemetryConfig, rawExists: boolean, defaults: Record<string, unknown> | undefined): boolean {
  if (!defaults) return false;
  if (current.enabled && current.endpointUrl && current.authToken) return false;
  if (rawExists && (current.optOutAt || current.consentAt || current.endpointUrl || current.authToken || current.source === "user_disabled")) return false;
  return true;
}

export function readTelemetryConfig(options: TelemetryOptions = {}): TelemetryConfig {
  const paths = telemetryPaths(options);
  const raw = readJson(paths.configPath);
  const rawExists = Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
  let config = rawExists ? configFromRaw(raw) : emptyConfig();
  const defaults = readDistributionDefaults();
  if (shouldApplyDefaults(config, rawExists, defaults)) {
    config = {
      enabled: true,
      endpointUrl: String(defaults?.endpointUrl ?? ""),
      authToken: String(defaults?.authToken ?? ""),
      payloadLevel: coercePayloadLevel(defaults?.payloadLevel),
      consentAt: "",
      installId: config.installId || crypto.randomUUID(),
      maxEnvelopeBytes: coerceMaxBytes(defaults?.maxEnvelopeBytes),
      source: "distribution_default",
      autoEnabledAt: nowIso(),
      optOutAt: "",
      defaultsPath: String(defaults?.defaultsPath ?? ""),
    };
    writeConfig(config, options);
  }
  return config;
}

function ready(config: TelemetryConfig): boolean {
  return Boolean(config.enabled && config.endpointUrl && config.authToken && config.installId && process.env.OGB_TELEMETRY_DISABLED !== "1");
}

function envFlag(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value !== "0" && value.toLowerCase() !== "false");
}

function currentAutomationSignals(): string[] {
  const signals: string[] = [];
  if (envFlag("CODEX_CI") || envFlag("CODEX_SHELL")) signals.push("codex");
  if (envFlag("CI")) signals.push("ci");
  if (process.env.NODE_ENV === "test") signals.push("node_env_test");
  if (/^test(:|$)|(^|:)test(:|$)/.test(process.env.npm_lifecycle_event ?? "")) signals.push("npm_test");
  return [...new Set(signals)];
}

function looksLikeAutomationProject(label: string): boolean {
  const normalized = label.replace(/\\/g, "/");
  return /(^|\/)(tmp|T)\/(tmp[._-]|ogb-)/i.test(normalized)
    || /^tmp\/ogb-/i.test(normalized)
    || /(^|\/)opencode-gemini-bridge(\/packages\/ogb)?$/i.test(normalized);
}

function isAutomationTelemetryRecord(record: WorkflowRunRecord | Record<string, unknown>): boolean {
  const value = record as Record<string, unknown>;
  if (value.source === "test") return true;
  const environment = payloadRecord(value.environmentContext);
  const signals = environment.automationSignals;
  if (Array.isArray(signals) && signals.length > 0) return true;
  const project = payloadRecord(value.project);
  return looksLikeAutomationProject(String(project.label ?? ""));
}

function shouldSuppressAutoSend(record: WorkflowRunRecord): boolean {
  if (envFlag("OGB_TELEMETRY_AUTO_SEND_DISABLED")) return true;
  if (envFlag("OGB_TELEMETRY_AUTO_SEND_FORCE")) return false;
  return isAutomationTelemetryRecord(record);
}

export function enableTelemetry(options: {
  endpointUrl: string;
  authToken: string;
  payloadLevel?: TelemetryPayloadLevel;
} & TelemetryOptions): TelemetryStatus {
  const endpointUrl = options.endpointUrl.trim();
  const authToken = options.authToken.trim();
  if (!/^https?:\/\//.test(endpointUrl)) throw new Error("--endpoint must be an http(s) URL.");
  if (!authToken) throw new Error("--token is required.");
  const current = readTelemetryConfig(options);
  const config: TelemetryConfig = {
    enabled: true,
    endpointUrl,
    authToken,
    payloadLevel: coercePayloadLevel(options.payloadLevel),
    consentAt: nowIso(),
    installId: current.installId || crypto.randomUUID(),
    maxEnvelopeBytes: current.maxEnvelopeBytes,
    source: "user",
    autoEnabledAt: current.autoEnabledAt,
    optOutAt: "",
    defaultsPath: current.defaultsPath,
  };
  writeConfig(config, options);
  return telemetryStatus(options);
}

export function disableTelemetry(options: TelemetryOptions = {}): TelemetryStatus {
  const current = readTelemetryConfig(options);
  const config: TelemetryConfig = {
    ...current,
    enabled: false,
    source: "user_disabled",
    optOutAt: nowIso(),
  };
  writeConfig(config, options);
  return telemetryStatus(options);
}

function loadSent(options: TelemetryOptions = {}): { schema: typeof TELEMETRY_SENT_SCHEMA; sentRunIds: string[]; updatedAt?: string } {
  const data = readJson(telemetryPaths(options).sentPath);
  if (!data || typeof data !== "object" || !Array.isArray(data.sentRunIds)) {
    return { schema: TELEMETRY_SENT_SCHEMA, sentRunIds: [] };
  }
  return {
    schema: TELEMETRY_SENT_SCHEMA,
    sentRunIds: data.sentRunIds.map(String),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
  };
}

function markSent(envelope: TelemetryEnvelope, options: TelemetryOptions = {}): void {
  const sent = loadSent(options);
  const runIds = new Set(sent.sentRunIds);
  for (const record of envelope.records) {
    if (record.runId) runIds.add(String(record.runId));
  }
  atomicWriteJson(telemetryPaths(options).sentPath, {
    schema: TELEMETRY_SENT_SCHEMA,
    sentRunIds: [...runIds].sort(),
    updatedAt: nowIso(),
  });
}

function countFiles(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export function telemetryStatus(options: TelemetryOptions = {}): TelemetryStatus {
  const config = readTelemetryConfig(options);
  const paths = telemetryPaths(options);
  const sent = loadSent(options);
  return {
    schema: TELEMETRY_STATUS_SCHEMA,
    enabled: config.enabled,
    ready: ready(config),
    disabledByEnv: process.env.OGB_TELEMETRY_DISABLED === "1",
    endpointUrl: redactEndpoint(config.endpointUrl),
    payloadLevel: config.payloadLevel,
    consentAt: config.consentAt,
    autoEnabledAt: config.autoEnabledAt,
    optOutAt: config.optOutAt,
    source: config.source,
    installId: config.installId,
    outboxCount: countFiles(paths.outboxDir),
    runCount: countFiles(paths.runsDir),
    sentRunCount: sent.sentRunIds.length,
    configPath: paths.configPath,
    defaultsPath: config.defaultsPath,
  };
}

function normalizeStatus(value: unknown): string {
  const text = String(value || "").toLowerCase();
  if (text === "pass" || text === "ok" || text === "applied" || text === "current") return "completed";
  if (text === "warn" || text === "warning" || text === "preview" || text === "available") return "completed_with_warnings";
  if (text === "fail" || text === "error" || text === "blocked") return "failed";
  if (text === "running") return "running";
  return text || "completed";
}

function outcomeFrom(status: string, payload: unknown): string {
  if (typeof payload === "object" && payload && !Array.isArray(payload)) {
    const raw = (payload as any).outcome ?? (payload as any).status;
    if (raw) return String(raw);
  }
  if (status === "failed") return "fail";
  if (status === "completed_with_warnings") return "warn";
  return "pass";
}

function payloadStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const raw = (payload as any).status ?? (payload as any).outcome ?? (payload as any).state;
  return raw === undefined ? undefined : String(raw);
}

export function redactSnippet(value: unknown, maxChars = MAX_SNIPPET_CHARS): string {
  let text = String(value ?? "");
  text = text.replace(/```[\s\S]*?```/g, "[code omitted]");
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
  text = text.replace(
    /\b(api[_-]?key|token|secret|password|authorization|bearer|cookie)(\s*[:=]\s*)(["']?)[^\s"',}]+/gi,
    "$1$2[redacted]",
  );
  text = text.replace(/(--(?:api-key|auth-token|token|secret|password)\s+)([^\s"']+)/gi, "$1[redacted]");
  text = text.replace(/https?:\/\/[^\s)>"]+/g, (match) => redactEndpoint(match));
  text = text.replace(/\b[A-Za-z0-9_=-]{36,}\b/g, "[redacted-token]");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxChars) return `${text.slice(0, maxChars - 3).trimEnd()}...`;
  return text;
}

function redactEndpoint(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? "?[redacted]" : ""}`;
  } catch {
    return url.replace(/\?[^)\s>"]+/g, "?[redacted]").replace(/#\S+/g, "");
  }
}

function looksLikePathKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PATH_KEY_HINTS.some((hint) => lower.includes(hint));
}

function looksLikePathValue(value: string): boolean {
  if (/^https?:\/\//.test(value)) return false;
  return value.includes("/") || value.includes("\\") || /\.(md|json|toml|html|js|ts|ps1|sh)$/i.test(value);
}

function pathLabel(value: string): string {
  const home = os.homedir();
  const normalized = value.startsWith(home) ? `~${value.slice(home.length)}` : value;
  const lower = normalized.replace(/\\/g, "/").toLowerCase();
  if (lower.endsWith("telemetry.defaults.json") || lower.includes("opencode-gemini-bridge/telemetry/config.json")) {
    return "telemetry-config";
  }
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (parts.length >= 3) return parts.slice(-3).join("/");
  return parts.join("/") || normalized;
}

function collectCounts(value: unknown, counts: Record<string, number>, prefix = ""): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectCounts(item, counts, prefix);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    const leaf = key.toLowerCase();
    if (typeof item === "number" && Number.isFinite(item) && (leaf.endsWith("count") || leaf.endsWith("counts") || leaf === "errors" || leaf === "warnings")) {
      counts[name] = item;
    } else if (item && typeof item === "object") {
      collectCounts(item, counts, name);
    }
  }
}

function appendMessages(value: unknown, target: string[]): void {
  if (typeof value === "string") target.push(redactSnippet(value));
  else if (Array.isArray(value)) for (const item of value.slice(0, 10)) appendMessages(item, target);
  else if (value && typeof value === "object") {
    const maybe = (value as any).message ?? (value as any).error ?? (value as any).reason ?? (value as any).code ?? JSON.stringify(value);
    target.push(redactSnippet(maybe));
  }
}

function collectMessages(value: unknown, warnings: string[], errors: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) collectMessages(item, warnings, errors);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === "warning" || lower === "warnings") appendMessages(item, warnings);
    else if (lower === "error" || lower === "errors" || lower.endsWith("errors")) appendMessages(item, errors);
    else if (item && typeof item === "object") collectMessages(item, warnings, errors);
  }
}

function collectStatusMessages(value: unknown, warnings: string[], errors: string[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectStatusMessages(item, warnings, errors, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const status = String(record.status ?? record.outcome ?? "").toLowerCase();
  const message = typeof record.message === "string" ? record.message : "";
  const name = typeof record.name === "string" ? record.name : "";
  if (message && (status === "warn" || status === "warning" || status === "completed_with_warnings")) {
    warnings.push(redactSnippet(name ? `${name}: ${message}` : message));
  } else if (message && (status === "fail" || status === "failed" || status === "error")) {
    errors.push(redactSnippet(name ? `${name}: ${message}` : message));
  }
  for (const item of Object.values(record)) {
    if (item && typeof item === "object") collectStatusMessages(item, warnings, errors, depth + 1);
  }
}

function collectPaths(value: unknown, paths: string[], key = ""): void {
  if (paths.length >= MAX_PATHS) return;
  if (typeof value === "string" && looksLikePathKey(key) && looksLikePathValue(value)) {
    paths.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectPaths(item, paths, key);
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) collectPaths(childValue, paths, childKey);
}

function summarizePayload(payload: unknown): Record<string, unknown> {
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  const rawPaths: string[] = [];
  collectCounts(payload, counts);
  collectMessages(payload, warnings, errors);
  collectStatusMessages(payload, warnings, errors);
  collectPaths(payload, rawPaths);
  const labels = [...new Set(rawPaths.map(pathLabel))].slice(0, MAX_PATHS);
  const pathHashes: Record<string, string> = {};
  for (const raw of rawPaths.slice(0, MAX_PATHS)) pathHashes[pathLabel(raw)] = sha256(raw).slice(0, 16);
  return {
    status: payloadStatus(payload),
    counts,
    warnings: [...new Set(warnings)].slice(0, 20),
    errors: [...new Set(errors)].slice(0, 20),
    relevantPaths: labels,
    pathHashes,
  };
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function payloadBoolean(value: unknown, key: string, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 5) return false;
  if (Array.isArray(value)) return value.some((item) => payloadBoolean(item, key, depth + 1));
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && entryValue === true) return true;
    if (entryValue && typeof entryValue === "object" && payloadBoolean(entryValue, key, depth + 1)) return true;
  }
  return false;
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

const NON_ACTIONABLE_ROOT_CAUSES = new Set(["no_issue_detected", "dashboard_echo", "rulesync_disabled"]);

function workflowDisplayName(workflow: string): string {
  const names: Record<string, string> = {
    "auto-update": "Auto-update",
    check: "Check",
    dashboard: "Dashboard",
    doctor: "Doctor",
    pass: "Pass (legacy)",
    "security-check": "Security-check",
    "setup-opencode": "Setup OpenCode",
    startup: "Plugin de startup",
    "startup-plugin": "Plugin de startup",
    sync: "Sync",
    validate: "Validacao OGB",
  };
  return names[workflow] || workflow || "Workflow OGB";
}

function workflowRecoveryCommand(workflow: string): string {
  const commands: Record<string, string> = {
    dashboard: "ogb dashboard",
    check: "ogb check",
    doctor: "ogb doctor",
    pass: "ogb check",
    "security-check": "ogb security-check",
    "setup-opencode": "ogb setup-opencode",
    sync: "ogb sync",
    validate: "ogb validate",
  };
  return commands[workflow] || "ogb bridge";
}

function diagnosticContext(workflow: string, payload: unknown, summary: Record<string, unknown>, status: string): Record<string, unknown> {
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  const messagesText = [...warnings, ...errors].join("\n").toLowerCase();
  const record = payloadRecord(payload);
  const payloadOutcome = String(record.outcome ?? record.status ?? record.state ?? "").toLowerCase();
  let code = "no_issue_detected";
  let label = "Nenhum problema detectado";
  let recovery = "";
  if (includesAny(messagesText, ["opencode-auto-fallback is enabled", "plugin is not active", "plugin inactive"])) {
    code = "plugin_inactive";
    label = "Plugin OpenCode configurado mas inativo";
    recovery = "Rode ogb sync e reinicie o OpenCode se o aviso continuar.";
  } else if (includesAny(messagesText, ["agent conflict", "exists or was edited manually", "managed file conflict"])) {
    code = "managed_file_conflict";
    label = "Arquivo gerenciado foi editado manualmente";
    recovery = "Revise o arquivo apontado; use --force apenas se quiser sobrescrever a edicao local.";
  } else if (includesAny(messagesText, ["hook needs review", "needs_review", "trusted hook/script changed", "trusted hook", "hooks/scripts"])) {
    code = "trust_review_required";
    label = "Hooks/scripts precisam de revisao";
    recovery = "Hooks BeforeTool/AfterTool sincronizam automaticamente; revise scripts ou eventos sem equivalente OpenCode e registre hash legado so se quiser silenciar a auditoria.";
  } else if (payloadBoolean(payload, "restartRequired") || payloadOutcome === "updated") {
    code = "restart_required";
    label = "OpenCode precisa reiniciar para carregar mudancas";
    recovery = "Reinicie o OpenCode e rode /bridge novamente.";
  } else if (workflow === "dashboard" && includesAny(messagesText, ["validation passou com avisos", "doctor passou com avisos", "security passou com avisos"])) {
    code = "dashboard_echo";
    label = "Dashboard repetiu aviso de outro workflow";
    recovery = "Abra o workflow de origem no preview local para ver o aviso real.";
  } else if (includesAny(messagesText, ["rulesync disabled"])) {
    code = "rulesync_disabled";
    label = "Rulesync esta desativado";
    recovery = "Nenhuma acao se rulesync foi desativado de proposito; rode ogb sync --rulesync auto para reativar.";
  } else if (messagesText.includes("generated by ogb") && messagesText.includes("current ogb")) {
    code = "stale_generated_files";
    label = "Arquivos gerados estao desatualizados";
    recovery = "Rode ogb sync para regenerar arquivos com a versao atual.";
  } else if (includesAny(messagesText, ["missing built-in opencode commands"])) {
    code = "missing_builtin_commands";
    label = "Comandos built-in do OpenCode estao faltando";
    recovery = "Rode ogb sync para regenerar os comandos do OpenCode.";
  } else if (includesAny(messagesText, ["ogb global binary", "ogb resolves to"]) && messagesText.includes("expected")) {
    code = "global_binary_mismatch";
    label = "Binario global do OGB esta desatualizado";
    recovery = "Atualize o OGB global ou rode o comando pelo pacote local esperado.";
  } else if (workflow === "validate" && (status === "completed_with_warnings" || payloadOutcome === "warn")) {
    code = "validation_warn";
    label = "Validacao OGB terminou com avisos";
    recovery = "Rode ogb validate --json para ver quais checks avisaram.";
  } else if (status === "failed" || errors.length > 0) {
    code = "workflow_failed";
    label = `${workflowDisplayName(workflow)} falhou`;
    recovery = `Rode ${workflowRecoveryCommand(workflow)} --json para ver o diagnostico.`;
  } else if (status === "completed_with_warnings" || warnings.length > 0) {
    code = "workflow_warn";
    label = `${workflowDisplayName(workflow)} terminou com avisos`;
    recovery = `Rode ${workflowRecoveryCommand(workflow)} --json para ver os proximos passos.`;
  }
  return {
    rootCauseCode: code,
    rootCauseLabel: label,
    recoveryCommand: recovery,
    warningCount: warnings.length,
    errorCount: errors.length,
  };
}

function messagesFromSummary(summary: Record<string, unknown>, key: "warnings" | "errors"): string[] {
  const value = summary[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function isActionableTelemetryRecord(record: WorkflowRunRecord | Record<string, unknown>): boolean {
  const value = record as Record<string, unknown>;
  const summary = payloadRecord(value.payloadSummary);
  const diagnostic = payloadRecord(value.diagnosticContext);
  const rootCauseCode = String(diagnostic.rootCauseCode ?? "");
  const errors = messagesFromSummary(summary, "errors");
  if (Number(value.exitCode ?? 0) !== 0) return true;
  if (value.status === "failed" || value.outcome === "fail") return true;
  if (errors.length > 0) return true;
  if (NON_ACTIONABLE_ROOT_CAUSES.has(rootCauseCode)) return false;
  if (value.status === "completed_with_warnings" || value.outcome === "warn") return true;
  if (messagesFromSummary(summary, "warnings").length > 0) return true;
  if (rootCauseCode && rootCauseCode !== "no_issue_detected") return true;
  return false;
}

function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max-depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactObject(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      const lower = key.toLowerCase();
      if (SECRET_KEYS.has(lower)) out[key] = "[redacted]";
      else if (LONG_TEXT_KEYS.has(lower) && typeof item === "string") out[key] = redactSnippet(item, 240);
      else if ((lower === "relevantpaths" || lower === "relevant_paths") && Array.isArray(item)) out[key] = item.map((raw) => pathLabel(String(raw)));
      else out[key] = redactObject(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return redactSnippet(value, 1200);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return value === undefined ? undefined : redactSnippet(value, 300);
}

function clientContext(): Record<string, unknown> {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    app: "opencode-gemini-bridge",
    appVersion: OGB_VERSION,
  };
}

export function recordWorkflowRun(input: WorkflowRecordInput, options: TelemetryOptions = {}): WorkflowRunRecord {
  const payload = input.payload ?? {};
  const summary = summarizePayload(payload);
  const status = normalizeStatus(input.status ?? input.outcome ?? payloadStatus(payload));
  const outcome = input.outcome ?? outcomeFrom(status, payload);
  const automationSignals = input.source === "test"
    ? [...new Set(["source_test", ...currentAutomationSignals()])]
    : currentAutomationSignals();
  const record: WorkflowRunRecord = {
    schema: TELEMETRY_RUN_RECORD_SCHEMA,
    runId: crypto.randomUUID(),
    recordedAt: nowIso(),
    workflow: input.workflow,
    source: input.source ?? "cli",
    command: input.command ?? "",
    status,
    outcome,
    phase: input.phase ?? "",
    exitCode: Number(input.exitCode ?? 0),
    durationMs: Number(input.durationMs ?? 0),
    project: input.projectRoot ? {
      label: pathLabel(input.projectRoot),
      pathHash: sha256(path.resolve(input.projectRoot)).slice(0, 16),
    } : undefined,
    payloadSummary: summary,
    diagnosticContext: diagnosticContext(input.workflow, payload, summary, status),
    environmentContext: {
      appVersion: OGB_VERSION,
      platform: process.platform,
      ...(automationSignals.length > 0 ? { automationSignals } : {}),
    },
    diagnosticSnippets: (input.snippets ?? []).slice(0, 5).map((item) => redactSnippet(item)),
    extra: redactObject(input.extra ?? {}) as Record<string, unknown>,
  };

  const paths = telemetryPaths(options);
  fs.mkdirSync(paths.runsDir, { recursive: true });
  const timestamp = record.recordedAt.replace(/[:.]/g, "");
  atomicWriteJson(path.join(paths.runsDir, `${timestamp}-${record.runId}.json`), record);
  return record;
}

export async function safeRecordWorkflowRun(input: WorkflowRecordInput, options: TelemetryOptions = {}): Promise<WorkflowRunRecord | undefined> {
  try {
    const record = recordWorkflowRun(input, options);
    await safeAutoSendRecord(record, { ...options, rawPayload: input.rawPayload });
    return record;
  } catch {
    return undefined;
  }
}

function parseSince(raw = "30d"): number {
  const now = Date.now();
  const match = raw.match(/^(\d+)([dhm])$/i);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unit === "d" ? 24 * 60 * 60 * 1000 : unit === "h" ? 60 * 60 * 1000 : 60 * 1000;
    return now - value * multiplier;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : now - 30 * 24 * 60 * 60 * 1000;
}

function loadRecords(options: TelemetrySendOptions = {}): WorkflowRunRecord[] {
  const sinceMs = parseSince(options.since);
  const limit = Math.max(1, Number(options.limit ?? 20));
  const paths = telemetryPaths(options);
  let files: string[] = [];
  try {
    files = fs.readdirSync(paths.runsDir).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const records: WorkflowRunRecord[] = [];
  for (const file of files) {
    const record = readJson(path.join(paths.runsDir, file));
    if (!record || typeof record !== "object" || record.schema !== TELEMETRY_RUN_RECORD_SCHEMA) continue;
    const recordedAt = Date.parse(String(record.recordedAt ?? ""));
    if (Number.isFinite(recordedAt) && recordedAt < sinceMs) continue;
    records.push(record as WorkflowRunRecord);
  }
  return records.slice(-limit);
}

function unsentRecords(options: TelemetrySendOptions = {}): WorkflowRunRecord[] {
  const sent = new Set(loadSent(options).sentRunIds);
  return loadRecords(options).filter((record) => !sent.has(record.runId));
}

function telemetryRecord(record: WorkflowRunRecord, config: TelemetryConfig, rawPayload?: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    runId: record.runId,
    recordedAt: record.recordedAt,
    workflow: record.workflow,
    source: record.source,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    status: record.status,
    outcome: record.outcome,
    phase: record.phase,
    project: record.project,
    payloadSummary: redactObject(record.payloadSummary),
    diagnosticContext: redactObject(record.diagnosticContext),
    environmentContext: redactObject(record.environmentContext),
    diagnosticSnippets: record.diagnosticSnippets,
  };
  if (config.payloadLevel === "full_logs") {
    base.command = redactSnippet(record.command, 600);
    base.extra = redactObject(record.extra);
    base.rawPayloadRedacted = rawPayload === undefined ? { unavailable: true, reason: "historical_record_has_no_raw_payload" } : redactObject(rawPayload);
  }
  return base;
}

export function buildTelemetryEnvelope(records: WorkflowRunRecord[], options: TelemetryOptions & { rawPayloads?: Record<string, unknown> } = {}): TelemetryEnvelope {
  const config = readTelemetryConfig(options);
  const envelope: TelemetryEnvelope = {
    schema: TELEMETRY_ENVELOPE_SCHEMA,
    envelopeId: crypto.randomUUID(),
    generatedAt: nowIso(),
    installId: config.installId,
    payloadLevel: config.payloadLevel,
    client: clientContext(),
    records: records.map((record) => telemetryRecord(record, config, options.rawPayloads?.[record.runId])),
    limits: {
      maxEnvelopeBytes: config.maxEnvelopeBytes,
    },
    truncated: false,
  };
  return fitEnvelope(envelope, config.maxEnvelopeBytes);
}

function envelopeSize(envelope: TelemetryEnvelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), "utf8");
}

function fitEnvelope(envelope: TelemetryEnvelope, maxBytes: number): TelemetryEnvelope {
  while (envelope.records.length > 1 && envelopeSize(envelope) > maxBytes) {
    envelope.records.pop();
    envelope.truncated = true;
  }
  if (envelopeSize(envelope) > maxBytes) {
    for (const record of envelope.records) {
      delete (record as any).rawPayloadRedacted;
      (record as any).rawPayloadOmitted = "envelope_size_limit";
    }
    envelope.truncated = true;
  }
  if (envelopeSize(envelope) > maxBytes) {
    for (const record of envelope.records) {
      (record as any).diagnosticSnippets = [];
      (record as any).payloadSummary = { omitted: "envelope_size_limit" };
    }
    envelope.truncated = true;
  }
  return envelope;
}

function enqueueEnvelope(envelope: TelemetryEnvelope, options: TelemetryOptions = {}): string {
  const paths = telemetryPaths(options);
  fs.mkdirSync(paths.outboxDir, { recursive: true });
  const queued: TelemetryEnvelope = { ...envelope, queuedAt: nowIso(), attempts: Number(envelope.attempts ?? 0) };
  const filePath = path.join(paths.outboxDir, `${queued.generatedAt.replace(/[:.]/g, "")}-${queued.envelopeId}.json`);
  atomicWriteJson(filePath, queued);
  return filePath;
}

function bumpAttempt(filePath: string): void {
  try {
    const data = readJson(filePath);
    atomicWriteJson(filePath, {
      ...data,
      attempts: Number(data?.attempts ?? 0) + 1,
      lastAttemptAt: nowIso(),
    });
  } catch {
    // best effort
  }
}

function isSendableTelemetryRecord(record: WorkflowRunRecord | Record<string, unknown>, options: Pick<TelemetrySendOptions, "includePass" | "includeAutomation"> = {}): boolean {
  if (!options.includeAutomation && isAutomationTelemetryRecord(record)) return false;
  if (options.includePass) return true;
  return isActionableTelemetryRecord(record);
}

async function postEnvelope(envelope: TelemetryEnvelope, config: TelemetryConfig, options: TelemetryOptions = {}): Promise<void> {
  const body = JSON.stringify(envelope);
  if (Buffer.byteLength(body, "utf8") > config.maxEnvelopeBytes) throw new Error("telemetry envelope exceeds maxEnvelopeBytes");
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  if (!fetcher) throw new Error("fetch is unavailable in this Node.js runtime.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetcher(config.endpointUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.authToken}`,
        "Content-Type": "application/json",
        "X-OGB-Telemetry-Schema": TELEMETRY_ENVELOPE_SCHEMA,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail.slice(0, 300) || `Telemetry endpoint HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function flushTelemetryOutbox(options: TelemetrySendOptions = {}): Promise<TelemetrySendResult> {
  const config = readTelemetryConfig(options);
  if (!ready(config)) {
    return { ok: false, sent: 0, failed: 0, queued: 0, reason: "telemetry_not_enabled", errors: [], status: telemetryStatus(options) };
  }
  const paths = telemetryPaths(options);
  let files: string[] = [];
  try {
    files = fs.readdirSync(paths.outboxDir).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    files = [];
  }
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const entry of files.slice(0, Math.max(1, Number(options.limit ?? 20)))) {
    const filePath = path.join(paths.outboxDir, entry);
    const envelope = readJson(filePath) as TelemetryEnvelope | undefined;
    if (!envelope || envelope.schema !== TELEMETRY_ENVELOPE_SCHEMA) {
      try { fs.unlinkSync(filePath); } catch {}
      continue;
    }
    const records = Array.isArray(envelope.records) ? envelope.records : [];
    const sendableRecords = records.filter((record) => isSendableTelemetryRecord(record, options));
    if (sendableRecords.length === 0) {
      try { fs.unlinkSync(filePath); } catch {}
      continue;
    }
    const sendableEnvelope = sendableRecords.length === records.length ? envelope : { ...envelope, records: sendableRecords };
    try {
      await postEnvelope(sendableEnvelope, config, options);
      markSent(sendableEnvelope, options);
      fs.unlinkSync(filePath);
      sent += 1;
    } catch (error) {
      failed += 1;
      errors.push(redactSnippet(error instanceof Error ? error.message : String(error)));
      bumpAttempt(filePath);
    }
  }
  return { ok: failed === 0, sent, failed, queued: 0, errors: errors.slice(0, 5) };
}

export function previewTelemetryEnvelope(options: TelemetrySendOptions = {}): TelemetryEnvelope {
  return buildTelemetryEnvelope(unsentRecords(options), options);
}

export async function sendTelemetry(options: TelemetrySendOptions = {}): Promise<TelemetrySendResult> {
  const config = readTelemetryConfig(options);
  if (!ready(config)) {
    return { ok: false, sent: 0, failed: 0, queued: 0, reason: "telemetry_not_enabled", errors: [], status: telemetryStatus(options) };
  }
  const first = await flushTelemetryOutbox(options);
  if (first.failed > 0) return first;
  const records = unsentRecords(options).filter((record) => isSendableTelemetryRecord(record, options));
  let queued = 0;
  if (records.length > 0) {
    enqueueEnvelope(buildTelemetryEnvelope(records, options), options);
    queued = 1;
  }
  const second = await flushTelemetryOutbox(options);
  return {
    ...second,
    sent: first.sent + second.sent,
    queued,
  };
}

async function safeAutoSendRecord(record: WorkflowRunRecord, options: TelemetryOptions & { rawPayload?: unknown } = {}): Promise<void> {
  try {
    const config = readTelemetryConfig(options);
    if (!ready(config)) return;
    if (shouldSuppressAutoSend(record)) return;
    if (!isActionableTelemetryRecord(record)) return;
    const envelope = buildTelemetryEnvelope([record], {
      ...options,
      rawPayloads: options.rawPayload === undefined ? undefined : { [record.runId]: options.rawPayload },
    });
    enqueueEnvelope(envelope, options);
    await flushTelemetryOutbox({ ...options, limit: 3 });
  } catch {
    // Telemetry is always fail-open.
  }
}

export function printTelemetryStatus(status: TelemetryStatus, json = false): void {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`OGB telemetry: ${status.ready ? "ready" : status.enabled ? "enabled but not ready" : "disabled"}`);
  console.log(`Source: ${status.source}`);
  console.log(`Payload: ${status.payloadLevel}`);
  console.log(`Outbox: ${status.outboxCount}`);
  console.log(`Sent runs: ${status.sentRunCount}`);
  if (status.endpointUrl) console.log(`Endpoint: ${status.endpointUrl}`);
}

export function printTelemetrySendResult(result: TelemetrySendResult, json = false): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.reason === "telemetry_not_enabled") {
    console.log("OGB telemetry: disabled or not ready.");
    return;
  }
  console.log(`OGB telemetry send: ${result.ok ? "ok" : "failed"}`);
  console.log(`Sent envelopes: ${result.sent}`);
  console.log(`Queued envelopes: ${result.queued}`);
  if (result.failed > 0) console.log(`Failed envelopes: ${result.failed}`);
  for (const error of result.errors.slice(0, 3)) console.log(`Warning: ${error}`);
}
