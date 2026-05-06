import fs from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";
import { resolveProjectPaths } from "./paths.js";

export type ModelFallbackEntry = string | ModelFallbackObject;

export interface ModelRuntimeOptions {
  variant?: string;
  effort?: string;
  reasoningEffort?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  textVerbosity?: string;
  thinking?: Record<string, unknown>;
}

export interface ModelReferenceObject extends ModelRuntimeOptions {
  id?: string;
  model?: string;
}

export type ModelReference = string | ModelReferenceObject;

export interface ModelFallbackObject extends ModelRuntimeOptions {
  model: string;
  reason?: string;
}

export interface ModelFallbackPolicy extends ModelRuntimeOptions {
  model?: ModelReference;
  fallback_models?: ModelFallbackEntry[];
}

export interface OgbConfig {
  openCode?: {
    defaultAgent?: string;
  };
  externalPlugins?: {
    quotaUi?: {
      enabled?: boolean;
      plugin?: string;
      server?: boolean;
      tui?: boolean;
      suppressOgbLimits?: boolean;
      enableToast?: boolean;
      formatStyle?: "singleWindow" | "allWindows";
      percentDisplayMode?: "used" | "remaining";
      enabledProviders?: string[] | "auto";
      onlyCurrentModel?: boolean;
      showSessionTokens?: boolean;
      minIntervalMs?: number;
      requestTimeoutMs?: number;
    };
    autoFallback?: {
      enabled?: boolean;
      plugin?: string;
      installProjectPlugin?: boolean;
      generateConfig?: boolean;
      configPath?: string;
      cooldownMs?: number;
      maxRetries?: number;
      logging?: boolean;
      defaultFallback?: ModelFallbackEntry[];
      largeContextFallback?: {
        agents: string[];
        model: string;
        minContextRatio?: number;
      };
    };
  };
  modelFallbacks?: {
    routing?: {
      enabled?: boolean;
      thresholdPercent?: number;
    };
    allExtensionAgents?: ModelFallbackPolicy | ModelFallbackEntry[];
    extensions?: Record<string, ModelFallbackPolicy | ModelFallbackEntry[]>;
    agents?: Record<string, ModelFallbackPolicy | ModelFallbackEntry[]>;
  };
}

export function defaultOpenCodeAgent(config: OgbConfig | undefined, fallback = "YOLO"): string {
  const raw = config?.openCode?.defaultAgent;
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

export interface ResolvedAgentFallback {
  agentName: string;
  extensionName: string;
  importedModel?: string;
  model?: string;
  variant?: string;
  reasoningEffort?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  textVerbosity?: string;
  thinking?: Record<string, unknown>;
  fallbackModels: ModelFallbackEntry[];
  source: "agent" | "extension" | "allExtensionAgents" | "none";
}

export function readOgbConfig(projectRoot?: string, homeDir?: string): OgbConfig {
  const paths = resolveProjectPaths(projectRoot, homeDir);
  if (!fs.existsSync(paths.ogbConfigPath)) return {};
  try {
    return parseJsonc(fs.readFileSync(paths.ogbConfigPath, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function normalizePolicy(value: ModelFallbackPolicy | ModelFallbackEntry[] | undefined): ModelFallbackPolicy | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return { fallback_models: value };
  if (typeof value === "object") return value;
  return undefined;
}

function isRuntimeObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeModelReference(value: ModelReference | undefined): { model?: string; options: ModelRuntimeOptions } {
  if (typeof value === "string") return { model: value.trim() || undefined, options: {} };
  if (!isRuntimeObject(value)) return { options: {} };
  const model = typeof value.model === "string" && value.model.trim()
    ? value.model.trim()
    : typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : undefined;
  return { model, options: normalizeRuntimeOptions(value) };
}

function reasoningEffortFrom(value: Record<string, unknown>): string | undefined {
  if (typeof value.reasoningEffort === "string" && value.reasoningEffort.trim()) return value.reasoningEffort.trim();
  if (typeof value.effort === "string" && value.effort.trim()) return value.effort.trim();
  const variant = typeof value.variant === "string" ? value.variant.trim() : "";
  if (/^(none|minimal|low|medium|high|xhigh)$/i.test(variant)) return variant;
  return undefined;
}

export function normalizeRuntimeOptions(value: unknown): ModelRuntimeOptions {
  if (!isRuntimeObject(value)) return {};
  return {
    ...(typeof value.variant === "string" && value.variant.trim() ? { variant: value.variant.trim() } : {}),
    ...(typeof value.effort === "string" && value.effort.trim() ? { effort: value.effort.trim() } : {}),
    ...(reasoningEffortFrom(value) ? { reasoningEffort: reasoningEffortFrom(value) } : {}),
    ...(typeof value.temperature === "number" && Number.isFinite(value.temperature) ? { temperature: value.temperature } : {}),
    ...(typeof value.top_p === "number" && Number.isFinite(value.top_p) ? { top_p: value.top_p } : {}),
    ...(typeof value.maxTokens === "number" && Number.isFinite(value.maxTokens) ? { maxTokens: value.maxTokens } : {}),
    ...(typeof value.textVerbosity === "string" && value.textVerbosity.trim() ? { textVerbosity: value.textVerbosity.trim() } : {}),
    ...(isRuntimeObject(value.thinking) ? { thinking: value.thinking } : {}),
  };
}

export function runtimeOptionsForProvider(value: ModelRuntimeOptions): Omit<ModelRuntimeOptions, "effort"> {
  const { effort: _effort, ...rest } = value;
  return rest;
}

export function normalizeFallbackEntry(entry: ModelFallbackEntry): ModelFallbackEntry | undefined {
  if (typeof entry === "string") return entry.trim() ? entry.trim() : undefined;
  if (!isRuntimeObject(entry) || typeof entry.model !== "string" || !entry.model.trim()) return undefined;
  return {
    model: entry.model.trim(),
    ...(typeof entry.reason === "string" && entry.reason.trim() ? { reason: entry.reason.trim() } : {}),
    ...normalizeRuntimeOptions(entry),
  };
}

export function resolveAgentFallback(options: {
  config: OgbConfig;
  extensionName: string;
  agentName: string;
  importedModel?: string;
}): ResolvedAgentFallback {
  const fallbacks = options.config.modelFallbacks;
  const agentPolicy = normalizePolicy(fallbacks?.agents?.[options.agentName]);
  const extensionPolicy = normalizePolicy(fallbacks?.extensions?.[options.extensionName]);
  const allPolicy = normalizePolicy(fallbacks?.allExtensionAgents);
  const source = agentPolicy
    ? "agent"
    : extensionPolicy
      ? "extension"
      : allPolicy
        ? "allExtensionAgents"
        : "none";
  const policy = agentPolicy ?? extensionPolicy ?? allPolicy;
  const modelRef = normalizeModelReference(policy?.model);
  const runtimeOptions = {
    ...normalizeRuntimeOptions(policy),
    ...modelRef.options,
  };
  const fallbackModels = (policy?.fallback_models ?? [])
    .map(normalizeFallbackEntry)
    .filter((item): item is ModelFallbackEntry => Boolean(item));

  return {
    agentName: options.agentName,
    extensionName: options.extensionName,
    importedModel: options.importedModel,
    model: modelRef.model ?? options.importedModel,
    ...runtimeOptions,
    fallbackModels,
    source,
  };
}

export function fallbackModelId(entry: ModelFallbackEntry): string {
  return typeof entry === "string" ? entry : entry.model;
}

export function hasAnyModelFallback(config: OgbConfig): boolean {
  const fallbacks = config.modelFallbacks;
  if (!fallbacks) return false;
  if (normalizePolicy(fallbacks.allExtensionAgents)?.fallback_models?.length) return true;
  if (Object.values(fallbacks.extensions ?? {}).some((value) => Boolean(normalizePolicy(value)?.fallback_models?.length))) return true;
  if (Object.values(fallbacks.agents ?? {}).some((value) => Boolean(normalizePolicy(value)?.fallback_models?.length))) return true;
  return false;
}
