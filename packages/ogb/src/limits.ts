import fs from "node:fs";
import path from "node:path";
import { resolveProjectPaths } from "./paths.js";
import { refreshQuota, type QuotaReport } from "./quota.js";
import { OGB_VERSION } from "./types.js";

const OPENUSAGE_API = "http://127.0.0.1:6736/v1/usage";
const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20";
const DEFAULT_CACHE_TTL_MS = 60_000;

export interface UsageLine {
  label: string;
  type: string;
  used: number;
  limit: number;
  format?: {
    kind?: string;
    suffix?: string;
  };
  resetsAt?: string | null;
  periodDurationMs?: number | null;
}

export interface ProviderUsage {
  providerId?: string;
  displayName: string;
  plan?: string;
  fetchedAt: string;
  lines?: UsageLine[];
  stale?: boolean;
  staleReason?: string;
}

export interface LimitsSourceStatus {
  status: "ok" | "unavailable" | "error" | "skipped";
  message?: string;
  providerCount?: number;
  authRepair?: QuotaReport["authRepair"];
}

export interface LimitsReport {
  version: string;
  projectRoot: string;
  generatedAt: string;
  status: "ok" | "partial" | "unavailable" | "error";
  providers: ProviderUsage[];
  sources: {
    openusage: LimitsSourceStatus;
    openaiChatGPT?: LimitsSourceStatus;
    anthropicClaude?: LimitsSourceStatus;
    geminiCodeAssist: LimitsSourceStatus;
  };
  warnings: string[];
  files: {
    limits: string;
  };
}

export interface LimitsOptions {
  projectRoot?: string;
  homeDir?: string;
  force?: boolean;
  write?: boolean;
  ttlMs?: number;
  openUsageUrl?: string;
  includeGeminiFallback?: boolean;
  includeOpenAIFallback?: boolean;
  includeAnthropicFallback?: boolean;
}

function readJson(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cachedReport(filePath: string, ttlMs: number): LimitsReport | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.statSync(filePath);
  if (Date.now() - stat.mtimeMs > ttlMs) return undefined;
  const parsed = readJson(filePath);
  if (!parsed || typeof parsed !== "object") return undefined;
  if (!Array.isArray(parsed.providers)) return undefined;
  return parsed as LimitsReport;
}

function existingReport(filePath: string): LimitsReport | undefined {
  const parsed = readJson(filePath);
  if (!parsed || typeof parsed !== "object") return undefined;
  if (!Array.isArray(parsed.providers)) return undefined;
  return parsed as LimitsReport;
}

async function fetchOpenUsage(url: string): Promise<ProviderUsage[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenUsage HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("OpenUsage returned non-array JSON");
  return data.filter((item): item is ProviderUsage => {
    return item && typeof item === "object" && typeof item.displayName === "string";
  });
}

function hasGeminiProvider(providers: ProviderUsage[]): boolean {
  return providers.some((provider) => /gemini|google/i.test(`${provider.providerId ?? ""} ${provider.displayName}`));
}

function hasOpenAIProvider(providers: ProviderUsage[]): boolean {
  return providers.some((provider) => /openai|chatgpt|codex/i.test(`${provider.providerId ?? ""} ${provider.displayName}`));
}

function hasAnthropicProvider(providers: ProviderUsage[]): boolean {
  return providers.some((provider) => /anthropic|claude/i.test(`${provider.providerId ?? ""} ${provider.displayName}`));
}

function providerKind(provider: ProviderUsage): "openai" | "anthropic" | "gemini" | undefined {
  const name = `${provider.providerId ?? ""} ${provider.displayName}`.toLowerCase();
  if (/openai|chatgpt|codex/.test(name)) return "openai";
  if (/anthropic|claude/.test(name)) return "anthropic";
  if (/gemini|google/.test(name)) return "gemini";
  return undefined;
}

function hasProviderKind(providers: ProviderUsage[], kind: "openai" | "anthropic" | "gemini"): boolean {
  return providers.some((provider) => providerKind(provider) === kind);
}

function staleProviderFrom(previous: LimitsReport | undefined, kind: "openai" | "anthropic" | "gemini", reason: string | undefined): ProviderUsage | undefined {
  const provider = previous?.providers.find((item) => providerKind(item) === kind);
  if (!provider) return undefined;
  return {
    ...provider,
    stale: true,
    staleReason: reason,
  };
}

function preserveStaleProvider(options: {
  providers: ProviderUsage[];
  previous?: LimitsReport;
  kind: "openai" | "anthropic" | "gemini";
  source: LimitsSourceStatus;
  warnings: string[];
}): ProviderUsage[] {
  if (options.source.status !== "error") return options.providers;
  if (hasProviderKind(options.providers, options.kind)) return options.providers;
  const stale = staleProviderFrom(options.previous, options.kind, options.source.message);
  if (!stale) return options.providers;
  const label = options.kind === "openai" ? "OpenAI" : options.kind === "anthropic" ? "Claude" : "Gemini";
  options.warnings.push(`${label} limits refresh failed; keeping last successful usage value.`);
  return [...options.providers, stale];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function providerPrimaryLine(provider: ProviderUsage): UsageLine | undefined {
  const lines = provider.lines ?? [];
  return lines.find((item) => item.label === "Session" && item.type === "progress")
    ?? lines.find((item) => item.label === "Weekly" && item.type === "progress")
    ?? lines.find((item) => item.label === "Quota" && item.type === "progress")
    ?? lines.find((item) => item.type === "progress")
    ?? lines[0];
}

function durationLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 0) return "now";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours}h ${rest}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function resetText(line: UsageLine | undefined): string | undefined {
  if (!line) return undefined;
  if (line.resetsAt) {
    const resetAt = new Date(line.resetsAt).getTime();
    if (!Number.isNaN(resetAt)) return durationLabel(resetAt - Date.now());
  }
  if (Number(line.periodDurationMs) > 0) return `~${durationLabel(Number(line.periodDurationMs))}`;
  return undefined;
}

function lineMetric(line: UsageLine | undefined): string {
  if (!line) return "no usage rows";
  if (line.format?.kind === "count") return `${Math.round(Number(line.used || 0))}/${Math.round(Number(line.limit || 0))}`;
  const limit = Number(line.limit || 0);
  if (limit <= 0) return "0%";
  const percent = Math.max(0, Math.min(100, Math.round((Number(line.used || 0) / limit) * 100)));
  return `${percent}%`;
}

function authPath(homeDir: string): string {
  return path.join(homeDir, ".local", "share", "opencode", "auth.json");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseJwt(token: string): any | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return undefined;
  }
}

function openAIAccountId(token: string, entry: any): string | undefined {
  const jwt = parseJwt(token);
  const fromJwt = jwt?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  return typeof fromJwt === "string" && fromJwt.trim() ? fromJwt : typeof entry?.accountId === "string" ? entry.accountId : undefined;
}

function resolveOpenAIOAuth(homeDir: string): { accessToken?: string; accountId?: string; expires?: number; message?: string } {
  const auth = readJson(authPath(homeDir));
  const keys = ["openai", "codex", "chatgpt", "opencode"];
  for (const key of keys) {
    const entry = auth?.[key];
    if (!entry || entry.type !== "oauth") continue;
    const accessToken = typeof entry.access === "string" ? entry.access.trim() : "";
    if (!accessToken) continue;
    const expires = typeof entry.expires === "number" ? entry.expires : undefined;
    if (expires && expires < Date.now()) return { expires, message: "OpenAI OAuth token expired. Reauthenticate OpenCode." };
    return {
      accessToken,
      accountId: openAIAccountId(accessToken, entry),
      expires,
    };
  }
  return { message: "OpenAI OAuth do OpenCode nao encontrado." };
}

function extractExportedString(text: string | undefined, name: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1];
}

function anthropicOAuthClientId(homeDir: string): string | undefined {
  if (process.env.OGB_ANTHROPIC_CLIENT_ID) return process.env.OGB_ANTHROPIC_CLIENT_ID;
  const candidates = anthropicAuthPackageDirs(homeDir).flatMap((dir) => [
    path.join(dir, "node_modules", "@ex-machina", "opencode-anthropic-auth", "dist", "constants.js"),
    path.join(dir, "node_modules", "@ex-machina", "opencode-anthropic-auth", "src", "constants.ts"),
  ]);
  for (const filePath of candidates) {
    const clientId = extractExportedString(readText(filePath), "CLIENT_ID");
    if (clientId) return clientId;
  }
  return undefined;
}

function anthropicAuthPackageDirs(homeDir: string): string[] {
  const packagesDir = path.join(homeDir, ".cache", "opencode", "packages", "@ex-machina");
  const dirs = new Set<string>([
    path.join(packagesDir, "opencode-anthropic-auth@latest"),
  ]);
  try {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("opencode-anthropic-auth@")) {
        dirs.add(path.join(packagesDir, entry.name));
      }
    }
  } catch {
    // Missing OpenCode package cache is a normal unauthenticated state.
  }
  return [...dirs];
}

async function refreshAnthropicOAuth(homeDir: string, auth: any): Promise<any | undefined> {
  const refresh = typeof auth?.refresh === "string" ? auth.refresh.trim() : "";
  const clientId = anthropicOAuthClientId(homeDir);
  if (!refresh || !clientId) return undefined;

  const response = await fetch("https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "axios/1.13.6",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    }),
  });
  if (!response.ok) return undefined;
  const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!payload.access_token) return undefined;

  const authFile = readJson(authPath(homeDir)) ?? {};
  const updated = {
    ...auth,
    type: "oauth",
    access: payload.access_token,
    refresh: payload.refresh_token ?? refresh,
    expires: Date.now() + Math.max(1, Number(payload.expires_in ?? 3600)) * 1000,
  };
  writeJson(authPath(homeDir), { ...authFile, anthropic: updated });
  return updated;
}

async function resolveAnthropicOAuth(homeDir: string): Promise<{ accessToken?: string; expires?: number; message?: string }> {
  const auth = readJson(authPath(homeDir));
  const keys = ["anthropic", "claude"];
  for (const key of keys) {
    const entry = auth?.[key];
    if (!entry || entry.type !== "oauth") continue;
    let effective = entry;
    const expires = typeof entry.expires === "number" ? entry.expires : undefined;
    if (expires && expires < Date.now()) {
      effective = await refreshAnthropicOAuth(homeDir, entry);
      if (!effective) return { expires, message: "Anthropic OAuth token expired. Reauthenticate OpenCode." };
    }
    const accessToken = typeof effective.access === "string" ? effective.access.trim() : "";
    if (!accessToken) continue;
    return { accessToken, expires: typeof effective.expires === "number" ? effective.expires : expires };
  }
  return { message: "Anthropic OAuth do OpenCode nao encontrado." };
}

function resetIsoFromWindow(window: any): string | undefined {
  const resetAt = Number(window?.reset_at);
  if (Number.isFinite(resetAt) && resetAt > 0) return new Date(Math.round(resetAt * 1000)).toISOString();
  const resetAfter = Number(window?.reset_after_seconds);
  if (Number.isFinite(resetAfter) && resetAfter > 0) return new Date(Date.now() + Math.round(resetAfter * 1000)).toISOString();
  return undefined;
}

function planLabel(planType: string | undefined): string | undefined {
  const raw = String(planType || "").toLowerCase();
  if (raw.includes("pro")) return "Pro";
  if (raw.includes("plus")) return "Plus";
  if (raw.includes("free")) return "Free";
  return planType ? String(planType) : undefined;
}

async function fetchOpenAIChatGPTUsage(homeDir: string): Promise<ProviderUsage | undefined> {
  const auth = resolveOpenAIOAuth(homeDir);
  if (!auth.accessToken) throw new Error(auth.message || "OpenAI OAuth unavailable");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "User-Agent": "OpenCode-Gemini-Bridge/0.0",
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (!response.ok) throw new Error(`OpenAI usage HTTP ${response.status}`);
  const data = await response.json() as any;
  const primary = data?.rate_limit?.primary_window;
  const secondary = data?.rate_limit?.secondary_window;
  const codeReview = data?.code_review_rate_limit?.primary_window;
  if (!primary) throw new Error("OpenAI usage returned no quota window");

  const lines: UsageLine[] = [];
  const addLine = (label: string, window: any) => {
    if (!window) return;
    const used = Number(window.used_percent);
    if (!Number.isFinite(used)) return;
    lines.push({
      label,
      type: "progress",
      used: Math.max(0, Math.min(100, used)),
      limit: 100,
      resetsAt: resetIsoFromWindow(window) ?? null,
      periodDurationMs: Number.isFinite(Number(window.limit_window_seconds)) ? Number(window.limit_window_seconds) * 1000 : null,
    });
  };

  addLine("Session", primary);
  addLine("Weekly", secondary);
  addLine("Reviews", codeReview);

  return {
    providerId: "openai",
    displayName: "OpenAI",
    plan: planLabel(data?.plan_type),
    fetchedAt: new Date().toISOString(),
    lines,
  };
}

function anthropicWindowUsedPercent(window: Record<string, unknown>): number | undefined {
  const candidates = [
    window.utilization,
    window.used_percentage,
    window.usedPercentage,
    window.used_percent,
    window.usedPercent,
    window.percent_used,
    window.percentUsed,
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate.trim()) : Number.NaN;
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  }
  return undefined;
}

function anthropicWindowResetIso(window: Record<string, unknown>): string | undefined {
  const raw = window.resets_at ?? window.resetsAt ?? window.reset_at ?? window.resetAt;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function anthropicUsageLine(label: string, window: unknown): UsageLine | undefined {
  const record = asRecord(window);
  if (!record) return undefined;
  const used = anthropicWindowUsedPercent(record);
  if (used === undefined) return undefined;
  return {
    label,
    type: "progress",
    used,
    limit: 100,
    resetsAt: anthropicWindowResetIso(record) ?? null,
  };
}

async function fetchAnthropicClaudeUsage(homeDir: string): Promise<ProviderUsage | undefined> {
  const auth = await resolveAnthropicOAuth(homeDir);
  if (!auth.accessToken) throw new Error(auth.message || "Anthropic OAuth unavailable");

  const response = await fetch(ANTHROPIC_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "anthropic-beta": ANTHROPIC_BETA_HEADER,
      "User-Agent": "OpenCode-Gemini-Bridge/0.0",
    },
  });
  if (!response.ok) throw new Error(`Anthropic usage HTTP ${response.status}`);

  const data = await response.json() as Record<string, unknown>;
  const lines = [
    anthropicUsageLine("Session", data.five_hour ?? data.fiveHour),
    anthropicUsageLine("Weekly", data.seven_day ?? data.sevenDay),
    anthropicUsageLine("Opus", data.seven_day_opus ?? data.sevenDayOpus),
    anthropicUsageLine("Sonnet", data.seven_day_sonnet ?? data.sevenDaySonnet),
  ].filter((line): line is UsageLine => Boolean(line));

  if (lines.length === 0) throw new Error("Anthropic usage returned no quota window");

  return {
    providerId: "anthropic",
    displayName: "Claude",
    fetchedAt: new Date().toISOString(),
    lines,
  };
}

function quotaReportToProvider(report: QuotaReport): ProviderUsage | undefined {
  if (report.status !== "ok" || report.summary.usedPercent === undefined) return undefined;
  return {
    providerId: "gemini",
    displayName: "Gemini",
    plan: "Code Assist",
    fetchedAt: report.generatedAt,
    lines: [
      {
        label: "Quota",
        type: "progress",
        used: report.summary.usedPercent,
        limit: 100,
        resetsAt: report.summary.resetTime ?? null,
      },
    ],
  };
}

function statusFrom(openusage: LimitsSourceStatus, openai: LimitsSourceStatus, anthropic: LimitsSourceStatus, gemini: LimitsSourceStatus, providers: ProviderUsage[]): LimitsReport["status"] {
  if (providers.some((provider) => provider.stale)) return "partial";
  if (providers.length > 0 && (openusage.status === "ok" || openai.status === "ok" || anthropic.status === "ok" || gemini.status === "ok")) {
    return openusage.status === "error" || openai.status === "error" || anthropic.status === "error" || gemini.status === "error" ? "partial" : "ok";
  }
  if (openusage.status === "error" || openai.status === "error" || anthropic.status === "error" || gemini.status === "error") return "error";
  return "unavailable";
}

export async function refreshLimits(options: LimitsOptions = {}): Promise<LimitsReport> {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const write = options.write !== false;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const previous = existingReport(paths.limitsPath);

  if (!options.force) {
    const cached = cachedReport(paths.limitsPath, ttlMs);
    if (cached) return cached;
  }

  const warnings: string[] = [];
  let providers: ProviderUsage[] = [];
  let openusage: LimitsSourceStatus = { status: "skipped" };
  let openaiChatGPT: LimitsSourceStatus = { status: "skipped" };
  let anthropicClaude: LimitsSourceStatus = { status: "skipped" };
  let geminiCodeAssist: LimitsSourceStatus = { status: "skipped" };

  try {
    providers = await fetchOpenUsage(options.openUsageUrl ?? process.env.OGB_OPENUSAGE_URL ?? OPENUSAGE_API);
    openusage = { status: "ok", providerCount: providers.length };
  } catch (error) {
    openusage = {
      status: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (options.includeOpenAIFallback !== false && !hasOpenAIProvider(providers)) {
    try {
      const openaiProvider = await fetchOpenAIChatGPTUsage(paths.homeDir);
      if (openaiProvider) {
        providers = [...providers, openaiProvider];
        openaiChatGPT = { status: "ok", providerCount: 1 };
      }
    } catch (error) {
      openaiChatGPT = {
        status: error instanceof Error && /nao encontrado|unavailable/i.test(error.message) ? "unavailable" : "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (options.includeAnthropicFallback !== false && !hasAnthropicProvider(providers)) {
    try {
      const anthropicProvider = await fetchAnthropicClaudeUsage(paths.homeDir);
      if (anthropicProvider) {
        providers = [...providers, anthropicProvider];
        anthropicClaude = { status: "ok", providerCount: 1 };
      }
    } catch (error) {
      anthropicClaude = {
        status: error instanceof Error && /nao encontrado|unavailable/i.test(error.message) ? "unavailable" : "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (options.includeGeminiFallback !== false && !hasGeminiProvider(providers)) {
    const quota = await refreshQuota({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      force: options.force,
      write: false,
      repairAuth: write,
      ttlMs,
    });
    const geminiProvider = quotaReportToProvider(quota);
    if (geminiProvider) {
      providers = [...providers, geminiProvider];
      geminiCodeAssist = { status: "ok", providerCount: 1, authRepair: quota.authRepair };
    } else {
      geminiCodeAssist = {
        status: quota.status === "error" ? "error" : "unavailable",
        message: quota.message,
        authRepair: quota.authRepair,
      };
    }
  }

  providers = preserveStaleProvider({
    providers,
    previous,
    kind: "openai",
    source: openaiChatGPT,
    warnings,
  });
  providers = preserveStaleProvider({
    providers,
    previous,
    kind: "anthropic",
    source: anthropicClaude,
    warnings,
  });
  providers = preserveStaleProvider({
    providers,
    previous,
    kind: "gemini",
    source: geminiCodeAssist,
    warnings,
  });

  if (openusage.status !== "ok" && openaiChatGPT.status === "ok") warnings.push("OpenUsage offline; OpenAI limits are using native ChatGPT OAuth fallback.");
  if (openusage.status !== "ok" && anthropicClaude.status === "ok") warnings.push("OpenUsage offline; Claude limits are using native Anthropic OAuth fallback.");
  if (geminiCodeAssist.status !== "ok" && !hasGeminiProvider(providers)) warnings.push("Gemini Code Assist quota unavailable; /gquota remains the manual fallback.");

  const report: LimitsReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    generatedAt: new Date().toISOString(),
    status: statusFrom(openusage, openaiChatGPT, anthropicClaude, geminiCodeAssist, providers),
    providers,
    sources: {
      openusage,
      openaiChatGPT,
      anthropicClaude,
      geminiCodeAssist,
    },
    warnings,
    files: {
      limits: paths.limitsPath,
    },
  };

  if (write) writeJson(paths.limitsPath, report);
  return report;
}

export function formatLimits(report: LimitsReport): string {
  const lines = [
    "OpenCode Gemini Bridge Limits",
    `Status: ${report.status.toUpperCase()}`,
    `Providers: ${report.providers.length}`,
    `OpenUsage: ${report.sources.openusage.status}`,
    `OpenAI ChatGPT: ${report.sources.openaiChatGPT?.status ?? "missing"}`,
    `Anthropic Claude: ${report.sources.anthropicClaude?.status ?? "missing"}`,
    `Gemini Code Assist: ${report.sources.geminiCodeAssist.status}`,
  ];
  for (const provider of report.providers) {
    const meta = provider.plan ? ` (${provider.plan})` : "";
    const primary = providerPrimaryLine(provider);
    const reset = resetText(primary);
    lines.push(`- ${provider.displayName}${meta}: ${lineMetric(primary)}${reset ? `, reset ${reset}` : ""}`);
  }
  if (report.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}
