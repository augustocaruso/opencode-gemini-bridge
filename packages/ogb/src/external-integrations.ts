import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OGB_VERSION } from "./types.js";
import type { GeminiExtensionProjectionMap } from "./extension-projection.js";
import { fallbackModelId, type ModelFallbackEntry, type OgbConfig } from "./ogb-config.js";
import { globalOpenCodeConfigDir } from "./opencode-paths.js";

export const OPENCODE_QUOTA_PLUGIN = "@slkiser/opencode-quota";
export const AUTO_FALLBACK_PLUGIN = "opencode-auto-fallback";
export const OGB_UI_CONFIG_PATH = ".opencode/generated/ogb-ui.json";
export const QUOTA_CONFIG_PATH = "opencode-quota/quota-toast.json";

export interface ExternalIntegrationWrite {
  path: string;
  relPath: string;
  status: "created" | "updated" | "unchanged" | "preview" | "skipped";
  message: string;
}

export interface ExternalIntegrationReport {
  openCodePlugins: string[];
  tuiPlugins: string[];
  writes: ExternalIntegrationWrite[];
  warnings: string[];
}

function enabled(value: { enabled?: boolean } | undefined): boolean {
  return value?.enabled === true;
}

export function externalOpenCodePlugins(config: OgbConfig): string[] {
  const plugins: string[] = [];
  const fallback = config.externalPlugins?.autoFallback;
  const quota = config.externalPlugins?.quotaUi;
  if (enabled(fallback) && fallback?.installProjectPlugin !== false) plugins.push(fallback?.plugin || AUTO_FALLBACK_PLUGIN);
  if (enabled(quota) && quota?.server !== false) plugins.push(quota?.plugin || OPENCODE_QUOTA_PLUGIN);
  return [...new Set(plugins)];
}

export function externalTuiPlugins(config: OgbConfig): string[] {
  const quota = config.externalPlugins?.quotaUi;
  if (!enabled(quota) || quota?.tui === false) return [];
  return [quota?.plugin || OPENCODE_QUOTA_PLUGIN];
}

export function usesExternalQuotaUi(config: OgbConfig): boolean {
  const quota = config.externalPlugins?.quotaUi;
  return enabled(quota) && quota?.suppressOgbLimits !== false;
}

export function resolveFallbackConfigPath(config: OgbConfig, homeDir: string): string {
  const raw = config.externalPlugins?.autoFallback?.configPath;
  if (raw) return path.resolve(raw.replace(/^~(?=$|\/|\\)/, homeDir));
  return path.join(globalOpenCodeConfigDir({ homeDir }), "plugins", "fallback.json");
}

function writeJsonFile(options: {
  path: string;
  relPath: string;
  value: unknown;
  dryRun?: boolean;
}): ExternalIntegrationWrite {
  const text = `${JSON.stringify(options.value, null, 2)}\n`;
  const exists = fs.existsSync(options.path);
  const current = exists ? fs.readFileSync(options.path, "utf8") : undefined;

  if (options.dryRun) {
    return {
      path: options.path,
      relPath: options.relPath,
      status: exists && current === text ? "unchanged" : "preview",
      message: exists ? `Would update ${options.relPath}` : `Would create ${options.relPath}`,
    };
  }

  if (exists && current === text) {
    return {
      path: options.path,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already up to date`,
    };
  }

  fs.mkdirSync(path.dirname(options.path), { recursive: true });
  fs.writeFileSync(options.path, text, "utf8");
  return {
    path: options.path,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function quotaConfig(config: OgbConfig): Record<string, unknown> {
  const quota = config.externalPlugins?.quotaUi ?? {};
  return {
    enabled: quota.enabled === true,
    enableToast: quota.enableToast === true,
    formatStyle: quota.formatStyle || "singleWindow",
    percentDisplayMode: quota.percentDisplayMode || "used",
    enabledProviders: quota.enabledProviders || "auto",
    onlyCurrentModel: quota.onlyCurrentModel === true,
    showSessionTokens: quota.showSessionTokens !== false,
    ...(typeof quota.minIntervalMs === "number" ? { minIntervalMs: quota.minIntervalMs } : {}),
    ...(typeof quota.requestTimeoutMs === "number" ? { requestTimeoutMs: quota.requestTimeoutMs } : {}),
  };
}

function normalizeAutoFallbackEntry(entry: ModelFallbackEntry): unknown {
  if (typeof entry === "string") return entry;
  const out: Record<string, unknown> = { model: entry.model };
  if (entry.reasoningEffort) out.reasoningEffort = entry.reasoningEffort;
  if (entry.variant) out.variant = entry.variant;
  if (entry.temperature !== undefined) out.temperature = entry.temperature;
  if (entry.maxTokens !== undefined) out.maxTokens = entry.maxTokens;
  if (entry.thinking !== undefined) out.thinking = entry.thinking;
  if (entry.top_p !== undefined) out.topP = entry.top_p;
  return out;
}

export function autoFallbackConfigFromProjection(config: OgbConfig, map: GeminiExtensionProjectionMap): Record<string, unknown> {
  const fallback = config.externalPlugins?.autoFallback ?? {};
  const agentFallbacks: Record<string, unknown[]> = {};

  for (const item of map.modelFallbacks) {
    if (item.fallback_models.length === 0) continue;
    agentFallbacks[item.agent] = item.fallback_models.map(normalizeAutoFallbackEntry);
  }

  return {
    $schema: "https://raw.githubusercontent.com/HyeokjaeLee/opencode-auto-fallback/main/docs/fallback.schema.json",
    _generated: {
      tool: "ogb",
      version: OGB_VERSION,
      warning: "Generated from .opencode/ogb.config.jsonc modelFallbacks.",
    },
    enabled: fallback.enabled === true,
    defaultFallback: (fallback.defaultFallback ?? []).map(normalizeAutoFallbackEntry),
    agentFallbacks,
    cooldownMs: fallback.cooldownMs ?? 60_000,
    maxRetries: fallback.maxRetries ?? 2,
    logging: fallback.logging === true,
    ...(fallback.largeContextFallback ? { largeContextFallback: fallback.largeContextFallback } : {}),
  };
}

export function describeAutoFallbackChains(map: GeminiExtensionProjectionMap): string[] {
  return map.modelFallbacks
    .filter((item) => item.fallback_models.length > 0)
    .map((item) => `${item.agent}: ${item.fallback_models.map(fallbackModelId).join(" -> ")}`);
}

export function projectExternalIntegrations(options: {
  projectRoot: string;
  homeDir?: string;
  config: OgbConfig;
  extensionMap: GeminiExtensionProjectionMap;
  dryRun?: boolean;
}): ExternalIntegrationReport {
  const homeDir = options.homeDir || os.homedir();
  const writes: ExternalIntegrationWrite[] = [];
  const warnings: string[] = [];

  writes.push(writeJsonFile({
    path: path.join(options.projectRoot, ...OGB_UI_CONFIG_PATH.split("/")),
    relPath: OGB_UI_CONFIG_PATH,
    dryRun: options.dryRun,
    value: {
      version: 1,
      generatedBy: `ogb ${OGB_VERSION}`,
      quotaPanel: usesExternalQuotaUi(options.config) ? "external" : "ogb",
      externalQuotaPlugin: enabled(options.config.externalPlugins?.quotaUi)
        ? options.config.externalPlugins?.quotaUi?.plugin || OPENCODE_QUOTA_PLUGIN
        : undefined,
    },
  }));

  if (enabled(options.config.externalPlugins?.quotaUi)) {
    writes.push(writeJsonFile({
      path: path.join(options.projectRoot, ...QUOTA_CONFIG_PATH.split("/")),
      relPath: QUOTA_CONFIG_PATH,
      dryRun: options.dryRun,
      value: quotaConfig(options.config),
    }));
  }

  const autoFallback = options.config.externalPlugins?.autoFallback;
  if (enabled(autoFallback) && autoFallback?.generateConfig !== false) {
    const fallbackPath = resolveFallbackConfigPath(options.config, homeDir);
    writes.push(writeJsonFile({
      path: fallbackPath,
      relPath: path.relative(homeDir, fallbackPath).split(path.sep).join("/"),
      dryRun: options.dryRun,
      value: autoFallbackConfigFromProjection(options.config, options.extensionMap),
    }));
    if (options.extensionMap.modelFallbacks.length === 0) {
      warnings.push("autoFallback enabled but no modelFallbacks were projected from Gemini extension agents");
    }
  }

  return {
    openCodePlugins: externalOpenCodePlugins(options.config),
    tuiPlugins: externalTuiPlugins(options.config),
    writes,
    warnings,
  };
}
