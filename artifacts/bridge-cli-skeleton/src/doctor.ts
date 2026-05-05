import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS } from "./built-ins.js";
import { buildInventory } from "./inventory.js";
import { AUTO_FALLBACK_PLUGIN, resolveFallbackConfigPath } from "./external-integrations.js";
import { readOgbConfig } from "./ogb-config.js";
import { configReferencesExpandedGemini, projectConfigPath } from "./project-config.js";
import { resolveProjectPaths } from "./paths.js";
import { resolveRulesyncCommand } from "./rulesync.js";
import { recoverStaleStartupStatus } from "./startup-status.js";
import { readSyncState } from "./sync-state.js";
import { OGB_VERSION, type Inventory, type ResourceStatus, type StatusCounts } from "./types.js";

export interface DoctorOptions {
  projectRoot?: string;
  homeDir?: string;
  json?: boolean;
  strict?: boolean;
  silent?: boolean;
}

export interface DoctorReport {
  version: string;
  projectRoot: string;
  expandedContext: string | null;
  opencodeConfig: {
    path: string;
    exists: boolean;
    referencesExpandedGemini: boolean;
  };
  rulesync: {
    available: boolean;
    version?: string;
    lastStatus?: string;
    lastPromoted: number;
    lastConflicts: number;
  };
  generated: {
    expandedGeminiVersion?: string;
    expandedGeminiHasMarker: boolean;
    generatedConfigVersion?: string;
    generatedConfigHasMarker: boolean;
    syncStateVersion?: string;
  };
  builtIns: {
    missingAgents: string[];
    missingCommands: string[];
  };
  startupSync: {
    projectPlugin: boolean;
    projectConfig: boolean;
    globalPlugin: boolean;
    globalConfig: boolean;
    lastState?: string;
    lastStartedAt?: string;
    lastFinishedAt?: string;
    lastPid?: number;
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
    configPath: string;
    configExists: boolean;
    configEnabled?: boolean;
    agentFallbacks: number;
    defaultFallbacks: number;
    cooldownMs?: number;
    maxRetries?: number;
    logging?: boolean;
  };
  modelResolution: {
    checked: boolean;
    command?: string;
    availableModels: number;
    referencedModels: number;
    unresolved: string[];
    message: string;
  };
  mcpCommandCheck: Array<{
    name: string;
    command?: string;
    ok: boolean;
    message?: string;
  }>;
  counts: {
    geminiFiles: number;
    imports: StatusCounts;
    mcps: StatusCounts;
    skills: StatusCounts;
    agents: StatusCounts;
    commands: StatusCounts;
    hooks: StatusCounts;
    extensions: StatusCounts;
  };
  warnings: string[];
  errors: string[];
}

function statusCounts<T extends { status: ResourceStatus }>(items: T[]): StatusCounts {
  return items.reduce<StatusCounts>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { ok: 0, warning: 0, error: 0, needs_review: 0 });
}

function collectWarnings(inv: Inventory): string[] {
  const warnings: string[] = [];

  for (const item of inv.imports) if (item.status !== "ok") warnings.push(`Import warning: ${item.raw} in ${item.source} - ${item.message}`);
  for (const skill of inv.skills) if (skill.status !== "ok") warnings.push(`Skill warning: ${skill.name} - ${skill.message}`);
  for (const mcp of inv.mcps) if (mcp.status !== "ok") warnings.push(`MCP warning: ${mcp.name} - ${mcp.message}`);
  for (const agent of inv.agents) if (agent.status === "needs_review") warnings.push(`Agent needs review: ${agent.name}`);
  for (const command of inv.commands) if (command.status === "needs_review") warnings.push(`Command needs review: ${command.name}`);
  for (const hook of inv.hooks) warnings.push(`Hook needs review: ${hook.name} - ${hook.message}`);
  for (const extension of inv.extensions) warnings.push(`Extension needs review: ${extension.name} - ${extension.message}`);

  return warnings;
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
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

function configHasPlugin(filePath: string, pattern: RegExp): boolean {
  const config = readJsonc(filePath);
  const plugins = Array.isArray(config?.plugin) ? config.plugin : [];
  return plugins.some((plugin: unknown) => typeof plugin === "string" && pattern.test(plugin));
}

function resolveCommand(command: string): string | undefined {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.error || result.status !== 0) return undefined;
  return String(result.stdout || "").split(/\r?\n/).find(Boolean)?.trim();
}

function listConfiguredPlugins(projectRoot: string, homeDir: string): string[] {
  const files = [
    path.join(projectRoot, "opencode.jsonc"),
    path.join(homeDir, ".config", "opencode", "opencode.json"),
    path.join(homeDir, ".config", "opencode", "opencode.jsonc"),
  ];
  const plugins: string[] = [];
  for (const filePath of files) {
    const config = readJsonc(filePath);
    if (!Array.isArray(config?.plugin)) continue;
    for (const plugin of config.plugin) if (typeof plugin === "string") plugins.push(plugin);
  }
  return [...new Set(plugins)];
}

function readRuntimeFallback(projectRoot: string, homeDir: string) {
  const ogbConfig = readOgbConfig(projectRoot, homeDir);
  const fallbackConfigPath = resolveFallbackConfigPath(ogbConfig, homeDir);
  const fallbackConfig = readJsonc(fallbackConfigPath);
  const plugins = listConfiguredPlugins(projectRoot, homeDir);
  const configured = ogbConfig.externalPlugins?.autoFallback?.enabled === true;
  const pluginName = ogbConfig.externalPlugins?.autoFallback?.plugin || AUTO_FALLBACK_PLUGIN;
  const agentFallbacks = fallbackConfig?.agentFallbacks && typeof fallbackConfig.agentFallbacks === "object" && !Array.isArray(fallbackConfig.agentFallbacks)
    ? Object.keys(fallbackConfig.agentFallbacks).length
    : 0;
  const defaultFallbacks = Array.isArray(fallbackConfig?.defaultFallback) ? fallbackConfig.defaultFallback.length : 0;
  return {
    configured,
    pluginActive: plugins.includes(pluginName),
    configPath: fallbackConfigPath,
    configExists: fs.existsSync(fallbackConfigPath),
    configEnabled: typeof fallbackConfig?.enabled === "boolean" ? fallbackConfig.enabled : undefined,
    agentFallbacks,
    defaultFallbacks,
    cooldownMs: typeof fallbackConfig?.cooldownMs === "number" ? fallbackConfig.cooldownMs : undefined,
    maxRetries: typeof fallbackConfig?.maxRetries === "number" ? fallbackConfig.maxRetries : undefined,
    logging: typeof fallbackConfig?.logging === "boolean" ? fallbackConfig.logging : undefined,
  };
}

function collectReferencedModels(modelRouting: any): Array<{ model: string; providerId?: string }> {
  const out: Array<{ model: string; providerId?: string }> = [];
  for (const decision of Array.isArray(modelRouting?.decisions) ? modelRouting.decisions : []) {
    for (const item of Array.isArray(decision?.chain) ? decision.chain : []) {
      if (typeof item?.model === "string" && item.model.trim()) {
        out.push({ model: item.model.trim(), providerId: typeof item.providerId === "string" ? item.providerId : undefined });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.providerId || ""}/${item.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelCandidates(model: string, providerId?: string): string[] {
  const trimmed = model.trim();
  const candidates = [trimmed];
  if (providerId && !trimmed.includes("/")) candidates.push(`${providerId}/${trimmed}`);
  if (providerId === "google" && trimmed.startsWith("gemini-")) candidates.push(`google/${trimmed}`);
  return [...new Set(candidates)];
}

function resolveOpenCodeModels(projectRoot: string, modelRouting: any): DoctorReport["modelResolution"] {
  const referenced = collectReferencedModels(modelRouting);
  if (referenced.length === 0) {
    return {
      checked: false,
      availableModels: 0,
      referencedModels: 0,
      unresolved: [],
      message: "No routed/fallback models referenced.",
    };
  }

  const command = resolveCommand("opencode");
  if (!command) {
    return {
      checked: false,
      availableModels: 0,
      referencedModels: referenced.length,
      unresolved: [],
      message: "opencode is not on PATH; model resolution skipped.",
    };
  }

  const result = spawnSync(command, ["models"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? "1", OGB_STARTUP_SYNC: "0" },
  });
  if (result.error || result.status !== 0) {
    return {
      checked: false,
      command,
      availableModels: 0,
      referencedModels: referenced.length,
      unresolved: [],
      message: result.error?.message ?? "opencode models failed; model resolution skipped.",
    };
  }

  const available = new Set(String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(line)));
  const unresolved = referenced
    .filter((item) => !modelCandidates(item.model, item.providerId).some((candidate) => available.has(candidate)))
    .map((item) => item.model)
    .sort();
  return {
    checked: true,
    command,
    availableModels: available.size,
    referencedModels: referenced.length,
    unresolved,
    message: unresolved.length
      ? `${unresolved.length} referenced model(s) were not found in opencode models.`
      : "All referenced routed/fallback models were found in opencode models.",
  };
}

function generatedMarkdownVersion(text: string | undefined): string | undefined {
  return text?.match(/^Generator:\s+ogb\s+(.+)$/m)?.[1]?.trim();
}

function commandExists(command: string): boolean {
  if (path.isAbsolute(command) || command.includes(path.sep)) return fs.existsSync(command);
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function missingBuiltIns(projectRoot: string, relDir: ".opencode/agents" | ".opencode/commands", names: string[]): string[] {
  return names.filter((name) => !fs.existsSync(path.join(projectRoot, relDir, `${name}.md`)));
}

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const inv = buildInventory({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  fs.mkdirSync(path.dirname(paths.inventoryPath), { recursive: true });
  fs.writeFileSync(paths.inventoryPath, `${JSON.stringify(inv, null, 2)}\n`, "utf8");

  const expandedExists = fs.existsSync(paths.expandedGeminiPath);
  const expandedText = readText(paths.expandedGeminiPath);
  const opencodeConfig = projectConfigPath(paths.projectRoot);
  const rulesyncCommand = resolveRulesyncCommand(paths.projectRoot);
  const state = readSyncState(paths.projectRoot);
  let warnings = collectWarnings(inv);
  const errors: string[] = [];
  const generatedConfig = readJsonc(paths.generatedOpenCodeConfigPath);
  const extensionMap = readJsonc(paths.extensionMapPath);
  const modelRouting = readJsonc(paths.modelRoutingPath);
  recoverStaleStartupStatus(paths.projectRoot, "doctor.recovered-stale");
  const pluginStatus = readJsonc(paths.pluginStatusPath);
  const startupLock = readJsonc(path.join(paths.generatedDir, "ogb-startup-sync.lock"));
  const startupPid = Number(pluginStatus?.pid ?? startupLock?.pid);
  const rawStartupState = typeof pluginStatus?.state === "string" ? pluginStatus.state : undefined;
  const startupState = rawStartupState === "running" && !Number.isInteger(startupPid) ? "stale" : rawStartupState;
  const expandedGeminiVersion = generatedMarkdownVersion(expandedText);
  const expandedGeminiHasMarker = expandedText?.startsWith("# GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT.") ?? false;
  const generatedConfigVersion = typeof generatedConfig?._generated?.version === "string" ? generatedConfig._generated.version : undefined;
  const generatedConfigHasMarker = generatedConfig?._generated?.tool === "ogb" && typeof generatedConfig?._generated?.warning === "string";
  const missingAgents = missingBuiltIns(paths.projectRoot, ".opencode/agents", BUILT_IN_AGENTS.map((agent) => agent.name));
  const missingCommands = missingBuiltIns(paths.projectRoot, ".opencode/commands", BUILT_IN_COMMANDS.map((command) => command.name));
  const startupSync = {
    projectPlugin: fs.existsSync(path.join(paths.projectRoot, ".opencode", "plugins", "ogb-startup-sync.js")),
    projectConfig: fs.existsSync(path.join(paths.projectRoot, ".opencode", "generated", "ogb-startup-sync.json")),
    globalPlugin: fs.existsSync(path.join(paths.homeDir, ".opencode", "plugins", "ogb-startup-sync.js")),
    globalConfig: fs.existsSync(path.join(paths.homeDir, ".opencode", "generated", "ogb-startup-sync.json")),
    lastState: startupState,
    lastStartedAt: typeof pluginStatus?.startedAt === "string" ? pluginStatus.startedAt : undefined,
    lastFinishedAt: typeof pluginStatus?.finishedAt === "string" ? pluginStatus.finishedAt : undefined,
    lastPid: Number.isInteger(startupPid) ? startupPid : undefined,
  };
  const modelRoutingDecisions = Array.isArray(modelRouting?.decisions) ? modelRouting.decisions : [];
  const extensionCompatibility = {
    mapExists: fs.existsSync(paths.extensionMapPath),
    extensions: Array.isArray(extensionMap?.extensions) ? extensionMap.extensions.length : 0,
    projectedCommands: Array.isArray(extensionMap?.projectedCommands) ? extensionMap.projectedCommands.length : 0,
    availableAgents: Array.isArray(extensionMap?.extensions)
      ? extensionMap.extensions.reduce((sum: number, extension: any) => sum + (Array.isArray(extension.agents) ? extension.agents.length : 0), 0)
      : 0,
    modelFallbacks: Array.isArray(extensionMap?.modelFallbacks) ? extensionMap.modelFallbacks.length : 0,
    modelRoutingReport: fs.existsSync(paths.modelRoutingPath),
    modelRoutingEnabled: modelRouting?.enabled !== false,
    modelRoutingDecisions: modelRoutingDecisions.length,
    modelRoutingRouted: modelRoutingDecisions.filter((decision: any) => Number(decision?.selected?.chainIndex ?? 0) > 0).length,
    modelRoutingSkipped: modelRoutingDecisions.reduce((sum: number, decision: any) => sum + (Array.isArray(decision?.skipped) ? decision.skipped.length : 0), 0),
    ohMyOpenAgentConfig: fs.existsSync(paths.ohMyOpenAgentConfigPath),
    ohMyOpenAgentPlugin: configHasPlugin(path.join(paths.projectRoot, "opencode.jsonc"), /oh-my-(openagent|opencode)/i)
      || configHasPlugin(path.join(paths.homeDir, ".config", "opencode", "opencode.json"), /oh-my-(openagent|opencode)/i)
      || configHasPlugin(path.join(paths.homeDir, ".config", "opencode", "opencode.jsonc"), /oh-my-(openagent|opencode)/i),
    hooks: Array.isArray(extensionMap?.extensions)
      ? extensionMap.extensions.reduce((sum: number, extension: any) => sum + (Array.isArray(extension.hooks) ? extension.hooks.length : 0), 0)
      : 0,
    scripts: Array.isArray(extensionMap?.extensions)
      ? extensionMap.extensions.reduce((sum: number, extension: any) => sum + (Array.isArray(extension.scripts) ? extension.scripts.length : 0), 0)
      : 0,
  };
  const runtimeFallback = readRuntimeFallback(paths.projectRoot, paths.homeDir);
  const modelResolution = resolveOpenCodeModels(paths.projectRoot, modelRouting);
  const mcpCommandCheck = inv.mcps.map((mcp) => {
    if (mcp.type !== "stdio") return { name: mcp.name, command: mcp.command, ok: true };
    if (!mcp.command) return { name: mcp.name, command: mcp.command, ok: false, message: "Missing stdio command" };
    const ok = commandExists(mcp.command);
    return {
      name: mcp.name,
      command: mcp.command,
      ok,
      message: ok ? undefined : `Command not found on PATH: ${mcp.command}`,
    };
  });

  if (!expandedExists) warnings.push("Missing .opencode/generated/GEMINI.expanded.md. Run ogb flatten.");
  else if (!expandedGeminiHasMarker) warnings.push("Expanded GEMINI file is missing generated DO NOT EDIT marker. Run ogb sync.");
  else if (expandedGeminiVersion && expandedGeminiVersion !== OGB_VERSION) warnings.push(`Expanded GEMINI file was generated by ogb ${expandedGeminiVersion}; current ogb is ${OGB_VERSION}. Run ogb sync.`);

  if (!fs.existsSync(paths.generatedOpenCodeConfigPath)) warnings.push("Missing .opencode/generated/opencode.generated.json. Run ogb sync.");
  else if (!generatedConfigHasMarker) warnings.push("Generated OpenCode config is missing ogb DO NOT EDIT metadata. Run ogb sync.");
  else if (generatedConfigVersion && generatedConfigVersion !== OGB_VERSION) warnings.push(`Generated OpenCode config was generated by ogb ${generatedConfigVersion}; current ogb is ${OGB_VERSION}. Run ogb sync.`);
  if (extensionCompatibility.mapExists) {
    warnings = warnings.filter((warning) => !warning.startsWith("Extension needs review:"));
    for (const warning of extensionMap?.warnings ?? []) warnings.push(`Extension projection warning: ${warning}`);
  }
  if (inv.extensions.length > 0 && !extensionCompatibility.mapExists) warnings.push("Missing .opencode/generated/ogb-extension-map.json. Run ogb sync.");
  else if (extensionMap?._generated?.version && extensionMap._generated.version !== OGB_VERSION) warnings.push(`Extension map was generated by ogb ${extensionMap._generated.version}; current ogb is ${OGB_VERSION}. Run ogb sync.`);

  if (state?.version && state.version !== OGB_VERSION) warnings.push(`Sync state was written by ogb ${state.version}; current ogb is ${OGB_VERSION}. Run ogb sync.`);
  if (missingAgents.length) warnings.push(`Missing built-in OpenCode agents: ${missingAgents.join(", ")}. Run ogb sync.`);
  if (missingCommands.length) warnings.push(`Missing built-in OpenCode commands: ${missingCommands.join(", ")}. Run ogb sync.`);
  for (const check of mcpCommandCheck) if (!check.ok && check.message) warnings.push(`MCP command warning: ${check.name} - ${check.message}`);

  if (!fs.existsSync(opencodeConfig)) warnings.push("Missing opencode.jsonc. Run ogb import or ogb init.");
  else if (!configReferencesExpandedGemini(paths.projectRoot)) warnings.push("opencode.jsonc does not reference .opencode/generated/GEMINI.expanded.md.");
  if (!rulesyncCommand) warnings.push("Rulesync is unavailable; ogb sync will use bridge-native projection only.");
  if (state?.lastRulesync?.conflicts?.length) warnings.push(`Rulesync has unresolved conflicts: ${state.lastRulesync.conflicts.join(", ")}`);
  else if (state?.lastRulesync?.status === "error") warnings.push("Last Rulesync run failed. Run ogb sync --rulesync require --dry-run for details.");
  if (startupSync.lastState === "fail") warnings.push("Last OpenCode startup sync failed. Run ogb dashboard for details.");
  if (startupSync.lastState === "stale") warnings.push("OpenCode startup sync ficou preso em running, mas o processo nao existe mais. Reinicie o OpenCode para carregar o plugin novo.");
  if (extensionCompatibility.modelFallbacks > 0 && !extensionCompatibility.modelRoutingReport) {
    warnings.push("Model fallbacks are configured, but OGB model routing report is missing. Run ogb sync.");
  } else if (modelRouting?.version && modelRouting.version !== OGB_VERSION) {
    warnings.push(`Model routing report was generated by ogb ${modelRouting.version}; current ogb is ${OGB_VERSION}. Run ogb sync.`);
  }
  if (runtimeFallback.configured && !runtimeFallback.pluginActive) warnings.push("opencode-auto-fallback is enabled in OGB config, but the OpenCode plugin is not active. Run ogb sync.");
  if (runtimeFallback.configured && !runtimeFallback.configExists) warnings.push(`opencode-auto-fallback config is missing: ${runtimeFallback.configPath}. Run ogb sync.`);
  if (runtimeFallback.configured && runtimeFallback.configEnabled === false) warnings.push("opencode-auto-fallback config exists but is disabled.");
  for (const model of modelResolution.unresolved) warnings.push(`Model resolution warning: ${model} was not found in opencode models.`);

  const report: DoctorReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    expandedContext: expandedExists ? paths.expandedGeminiPath : null,
    opencodeConfig: {
      path: opencodeConfig,
      exists: fs.existsSync(opencodeConfig),
      referencesExpandedGemini: fs.existsSync(opencodeConfig) && configReferencesExpandedGemini(paths.projectRoot),
    },
    rulesync: {
      available: Boolean(rulesyncCommand),
      version: rulesyncCommand?.version,
      lastStatus: state?.lastRulesync?.status,
      lastPromoted: state?.lastRulesync?.promoted.length ?? 0,
      lastConflicts: state?.lastRulesync?.conflicts.length ?? 0,
    },
    generated: {
      expandedGeminiVersion,
      expandedGeminiHasMarker,
      generatedConfigVersion,
      generatedConfigHasMarker,
      syncStateVersion: state?.version,
    },
    builtIns: {
      missingAgents,
      missingCommands,
    },
    startupSync,
    extensionCompatibility,
    runtimeFallback,
    modelResolution,
    mcpCommandCheck,
    counts: {
      geminiFiles: inv.geminiFiles.length,
      imports: statusCounts(inv.imports),
      mcps: statusCounts(inv.mcps),
      skills: statusCounts(inv.skills),
      agents: statusCounts(inv.agents),
      commands: statusCounts(inv.commands),
      hooks: statusCounts(inv.hooks),
      extensions: statusCounts(inv.extensions),
    },
    warnings,
    errors,
  };

  fs.mkdirSync(path.dirname(paths.doctorPath), { recursive: true });
  fs.writeFileSync(paths.doctorPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.silent) {
    // No terminal output; callers use the structured report.
  } else if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("OpenCode Gemini Bridge Doctor");
    console.log(`Project: ${report.projectRoot}`);
    console.log(`GEMINI.md files: ${report.counts.geminiFiles}`);
    console.log(`Imports: ${report.counts.imports.ok} ok, ${report.counts.imports.warning} warning`);
    console.log(`Skills: ${report.counts.skills.ok} ok, ${report.counts.skills.warning} warning`);
    console.log(`MCPs: ${report.counts.mcps.ok} ok, ${report.counts.mcps.needs_review} needs review`);
    console.log(`Agents: ${report.counts.agents.ok} ok, ${report.counts.agents.needs_review} needs review`);
    console.log(`Commands: ${report.counts.commands.ok} ok, ${report.counts.commands.needs_review} needs review`);
    console.log(`Extension commands: ${report.extensionCompatibility.projectedCommands} projected`);
    console.log(`Model routing: ${report.extensionCompatibility.modelRoutingReport ? `${report.extensionCompatibility.modelRoutingDecisions} decision(s), ${report.extensionCompatibility.modelRoutingRouted} routed` : "missing"}`);
    console.log(`Runtime fallback: ${report.runtimeFallback.configured ? `${report.runtimeFallback.pluginActive ? "plugin active" : "plugin missing"}, config ${report.runtimeFallback.configExists ? "present" : "missing"}, ${report.runtimeFallback.agentFallbacks} agent chain(s)` : "disabled"}`);
    console.log(`Model resolution: ${report.modelResolution.message}`);
    console.log(`Generated files: ${report.generated.expandedGeminiVersion ?? "missing context"}, ${report.generated.generatedConfigVersion ?? "missing config"}`);
    console.log(`Startup sync: project ${report.startupSync.projectPlugin && report.startupSync.projectConfig ? "installed" : "missing"}, global ${report.startupSync.globalPlugin && report.startupSync.globalConfig ? "installed" : "missing"}${report.startupSync.lastState ? `, last ${report.startupSync.lastState}` : ""}`);
    console.log(`Rulesync: ${report.rulesync.available ? `available${report.rulesync.version ? ` (${report.rulesync.version})` : ""}` : "unavailable"}`);
    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of warnings) console.log(`- ${warning}`);
    }
  }

  if (options.strict && warnings.length > 0) process.exitCode = 1;
  if (errors.length > 0) process.exitCode = 2;
  return report;
}
