import fs from "node:fs";
import path from "node:path";
import type { LimitsReport, ProviderUsage, UsageLine } from "./limits.js";
import type { ModelFallbackEntry, ModelRuntimeOptions, ResolvedAgentFallback } from "./ogb-config.js";
import { OGB_VERSION } from "./types.js";

export interface RoutedModel extends ModelRuntimeOptions {
  model: string;
  providerId: string;
  chainIndex: number;
}

export interface ModelRoutingSkip {
  model: string;
  providerId: string;
  reason: string;
  usedPercent?: number;
}

export interface ModelRoutingDecision {
  agent: string;
  extension: string;
  source: ResolvedAgentFallback["source"];
  selected?: RoutedModel;
  primary?: RoutedModel;
  chain: RoutedModel[];
  skipped: ModelRoutingSkip[];
  reason: string;
}

export interface ModelRoutingReport {
  version: string;
  projectRoot: string;
  generatedAt: string;
  enabled: boolean;
  thresholdPercent: number;
  decisions: ModelRoutingDecision[];
  warnings: string[];
}

export interface ModelRoutingOptions {
  projectRoot: string;
  limitsPath: string;
  enabled?: boolean;
  thresholdPercent?: number;
}

export const DEFAULT_ROUTING_THRESHOLD_PERCENT = 95;

export function readLimitsReport(filePath: string): LimitsReport | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.providers)) return undefined;
    return parsed as LimitsReport;
  } catch {
    return undefined;
  }
}

function providerFromModel(model: string): string {
  const [prefix, rest] = model.split("/", 2);
  const raw = rest ? prefix : model;
  if (/^(google|gemini)$/i.test(raw) || /^gemini-/i.test(model)) return "google";
  if (/^(anthropic|claude)$/i.test(raw) || /^claude-/i.test(model)) return "anthropic";
  if (/^(openai|codex|chatgpt)$/i.test(raw) || /^(gpt|o[0-9])-/i.test(model)) return "openai";
  if (/^opencode$/i.test(raw)) return "opencode";
  return raw.toLowerCase();
}

function normalizeProvider(value: string | undefined): string | undefined {
  const raw = String(value || "").toLowerCase();
  if (!raw) return undefined;
  if (/gemini|google/.test(raw)) return "google";
  if (/anthropic|claude/.test(raw)) return "anthropic";
  if (/openai|chatgpt|codex/.test(raw)) return "openai";
  if (/opencode/.test(raw)) return "opencode";
  return raw;
}

function lineUsedPercent(line: UsageLine): number | undefined {
  if (line.type !== "progress") return undefined;
  const limit = Number(line.limit || 0);
  const used = Number(line.used || 0);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return undefined;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function providerUsedPercent(provider: ProviderUsage): number | undefined {
  const percents = (provider.lines ?? [])
    .map(lineUsedPercent)
    .filter((value): value is number => value !== undefined);
  if (percents.length === 0) return undefined;
  return Math.max(...percents);
}

function usageByProvider(report: LimitsReport | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const provider of report?.providers ?? []) {
    const key = normalizeProvider(`${provider.providerId ?? ""} ${provider.displayName}`);
    const used = providerUsedPercent(provider);
    if (!key || used === undefined) continue;
    out.set(key, Math.max(out.get(key) ?? 0, used));
  }
  return out;
}

function runtimeFrom(value: ModelRuntimeOptions): ModelRuntimeOptions {
  return {
    ...(value.variant ? { variant: value.variant } : {}),
    ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}),
    ...(value.temperature !== undefined ? { temperature: value.temperature } : {}),
    ...(value.top_p !== undefined ? { top_p: value.top_p } : {}),
    ...(value.maxTokens !== undefined ? { maxTokens: value.maxTokens } : {}),
    ...(value.textVerbosity ? { textVerbosity: value.textVerbosity } : {}),
    ...(value.thinking ? { thinking: value.thinking } : {}),
  };
}

function entryToRouted(entry: ModelFallbackEntry, chainIndex: number): RoutedModel | undefined {
  if (typeof entry === "string") {
    const model = entry.trim();
    return model ? { model, providerId: providerFromModel(model), chainIndex } : undefined;
  }
  if (!entry.model.trim()) return undefined;
  return {
    model: entry.model.trim(),
    providerId: providerFromModel(entry.model),
    chainIndex,
    ...runtimeFrom(entry),
  };
}

function fallbackPrimary(fallback: ResolvedAgentFallback): RoutedModel | undefined {
  if (!fallback.model) return undefined;
  return {
    model: fallback.model,
    providerId: providerFromModel(fallback.model),
    chainIndex: 0,
    ...runtimeFrom(fallback),
  };
}

export function routeAgentFallback(options: {
  fallback: ResolvedAgentFallback;
  usage: Map<string, number>;
  enabled: boolean;
  thresholdPercent: number;
}): ModelRoutingDecision {
  const primary = fallbackPrimary(options.fallback);
  const chain = [
    primary,
    ...options.fallback.fallbackModels.map((entry, index) => entryToRouted(entry, index + 1)),
  ].filter((item): item is RoutedModel => Boolean(item));
  const skipped: ModelRoutingSkip[] = [];

  if (!options.enabled) {
    return {
      agent: options.fallback.agentName,
      extension: options.fallback.extensionName,
      source: options.fallback.source,
      primary,
      chain,
      skipped,
      selected: primary,
      reason: "routing disabled",
    };
  }

  for (const candidate of chain) {
    const usedPercent = options.usage.get(candidate.providerId);
    if (usedPercent !== undefined && usedPercent >= options.thresholdPercent) {
      skipped.push({
        model: candidate.model,
        providerId: candidate.providerId,
        usedPercent,
        reason: `provider usage ${Math.round(usedPercent)}% >= ${options.thresholdPercent}%`,
      });
      continue;
    }
    return {
      agent: options.fallback.agentName,
      extension: options.fallback.extensionName,
      source: options.fallback.source,
      primary,
      chain,
      skipped,
      selected: candidate,
      reason: candidate.chainIndex === 0 ? "primary selected" : "fallback selected by OGB routing",
    };
  }

  return {
    agent: options.fallback.agentName,
    extension: options.fallback.extensionName,
    source: options.fallback.source,
    primary,
    chain,
    skipped,
    selected: primary ?? chain[0],
    reason: "all known providers are over threshold; keeping primary",
  };
}

export function createModelRoutingContext(options: ModelRoutingOptions): {
  report: ModelRoutingReport;
  usage: Map<string, number>;
  decide(fallback: ResolvedAgentFallback): ModelRoutingDecision;
} {
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_ROUTING_THRESHOLD_PERCENT;
  const limits = readLimitsReport(options.limitsPath);
  const warnings: string[] = [];

  const usage = usageByProvider(limits);
  const report: ModelRoutingReport = {
    version: OGB_VERSION,
    projectRoot: options.projectRoot,
    generatedAt: new Date().toISOString(),
    enabled: options.enabled !== false,
    thresholdPercent,
    decisions: [],
    warnings,
  };

  return {
    report,
    usage,
    decide(fallback) {
      const decision = routeAgentFallback({
        fallback,
        usage,
        enabled: report.enabled,
        thresholdPercent,
      });
      report.decisions.push(decision);
      return decision;
    },
  };
}

export function writeModelRoutingReport(filePath: string, report: ModelRoutingReport): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
