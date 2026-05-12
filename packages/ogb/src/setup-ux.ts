import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { resolveCommand } from "./command-resolution.js";
import { readLocalRole } from "./local-role.js";
import { normalizeRuntimeOptions, type OgbConfig } from "./ogb-config.js";
import { runNativeCommand } from "./native-runner.js";
import { createPlatformAdapter, type PlatformAdapter } from "./platform-adapter.js";
import { isHomeProject } from "./paths.js";
import { createProfileWriter, type ProfileWriteReason, type ProfileWriteStatus, type ProfileWriter } from "./profile-writer.js";
import { checkPluginSyntax, STARTUP_SYNC_PLUGIN_SOURCE, startupConfigSource } from "./setup-opencode.js";
import { recoverStaleStartupStatus } from "./startup-status.js";
import { ensureGlobalTuiSidebar, TUI_SIDEBAR_PLUGIN_SOURCE } from "./tui-sidebar.js";
import { OGB_VERSION } from "./types.js";
import { UX_PROFILE_PRESET } from "./ux-profile.generated.js";

export const OGB_UX_SAFE_PLUGINS = [...UX_PROFILE_PRESET.safePlugins];
export const OGB_UX_DISABLED_PLUGINS = [...UX_PROFILE_PRESET.disabledPlugins];
export const OGB_UX_PLUGINS = OGB_UX_SAFE_PLUGINS;
export const OGB_TUI_RUNTIME_DEPENDENCIES = { ...UX_PROFILE_PRESET.tuiRuntimeDependencies };
export const REMOVED_GLOBAL_UX_COMMANDS = [...UX_PROFILE_PRESET.removedGlobalCommands];
const UX_PROFILE_COMMANDS: Record<string, string> = UX_PROFILE_PRESET.files.commands;

export function globalStartupPluginSpec(pluginPath: string): string {
  return pathToFileURL(pluginPath).href;
}

export const RESEARCH_COMMAND = UX_PROFILE_COMMANDS.research ?? "";

export function globalBuiltInCommandContent(name: string): string {
  return UX_PROFILE_COMMANDS[name] ?? "";
}

export const DCP_CONFIG = UX_PROFILE_PRESET.dcpConfig;
export const OGB_UX_PROJECT_CONFIG: OgbConfig = UX_PROFILE_PRESET.projectConfig;
const OGB_UX_WATCHER_IGNORE = UX_PROFILE_PRESET.globalConfig.watcherIgnore;

function ogbStartupPluginSource(): string {
  return UX_PROFILE_PRESET.files.startupPlugin || STARTUP_SYNC_PLUGIN_SOURCE;
}

function ogbTuiSidebarPluginSource(): string {
  return UX_PROFILE_PRESET.files.tuiSidebarPlugin || TUI_SIDEBAR_PLUGIN_SOURCE;
}

export interface SetupUxOptions {
  homeDir?: string;
  configDir?: string;
  projectRoot?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  force?: boolean;
  resetGlobal?: boolean;
  installPlugins?: boolean;
  installTuiDependencies?: boolean;
  installOpenCode?: boolean;
  writeProjectProfile?: boolean;
}

export interface SetupUxWrite {
  path: string;
  status: ProfileWriteStatus;
  backup?: string;
  reason?: ProfileWriteReason;
}

export interface SetupUxCommand {
  command: string[];
  status: "skipped" | "ok" | "fail" | "preview";
  message: string;
  role?: "opencode" | "tui-runtime" | "plugin" | "verify" | "auth";
}

export interface SetupUxReport {
  version: string;
  homeDir: string;
  projectRoot?: string;
  configPath: string;
  dcpConfigPath: string;
  commandsDir: string;
  agentsDir: string;
  fallbackConfigPath: string;
  ogbConfigPath?: string;
  writes: SetupUxWrite[];
  commands: SetupUxCommand[];
  notices: string[];
  warnings: string[];
}

export interface GlobalStartupPluginRepair {
  plugin: SetupUxWrite;
  config: SetupUxWrite;
  pluginCheck: ReturnType<typeof checkPluginSyntax>;
  warnings: string[];
}

function readJsonc(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function pluginPackageName(plugin: string): string {
  const trimmed = plugin.trim();
  if (trimmed.startsWith("@")) {
    const match = trimmed.match(/^(@[^/]+\/[^@]+)/);
    return match?.[1] ?? trimmed;
  }
  return trimmed.split("@")[0] ?? trimmed;
}

const DISABLED_PLUGIN_PACKAGES = new Set(OGB_UX_DISABLED_PLUGINS.map(pluginPackageName));

function isDisabledUxPlugin(plugin: string): boolean {
  return DISABLED_PLUGIN_PACKAGES.has(pluginPackageName(plugin));
}

function isLocalPluginSpec(plugin: string): boolean {
  return plugin.trim().startsWith("file:");
}

function cleanManagedProviderOptions(value: unknown): Record<string, unknown> | undefined {
  const provider = asRecord(value);
  const cleanedProvider: Record<string, unknown> = { ...provider };
  const openai = asRecord(cleanedProvider.openai);

  if (Object.keys(openai).length > 0) {
    const cleanedOpenai: Record<string, unknown> = { ...openai };
    const options = asRecord(cleanedOpenai.options);
    const cleanedOptions: Record<string, unknown> = { ...options };
    delete cleanedOptions.websearch_cited;

    if (Object.keys(cleanedOptions).length > 0) {
      cleanedOpenai.options = cleanedOptions;
    } else {
      delete cleanedOpenai.options;
    }

    if (Object.keys(cleanedOpenai).length > 0) {
      cleanedProvider.openai = cleanedOpenai;
    } else {
      delete cleanedProvider.openai;
    }
  }

  return Object.keys(cleanedProvider).length > 0 ? cleanedProvider : undefined;
}

function cleanDisabledUxConfig(current: Record<string, unknown>): { config: Record<string, unknown>; changed: boolean } {
  const cleaned: Record<string, unknown> = { ...current };
  let changed = false;

  if (Array.isArray(cleaned.plugin)) {
    const plugins = cleaned.plugin.filter((plugin) => !(typeof plugin === "string" && isDisabledUxPlugin(plugin)));
    if (plugins.length !== cleaned.plugin.length) changed = true;
    cleaned.plugin = plugins;
  }

  if (Object.prototype.hasOwnProperty.call(cleaned, "provider")) {
    const cleanedProvider = cleanManagedProviderOptions(cleaned.provider);
    if (JSON.stringify(cleanedProvider ?? {}) !== JSON.stringify(asRecord(cleaned.provider))) changed = true;
    if (cleanedProvider) cleaned.provider = cleanedProvider;
    else delete cleaned.provider;
  }

  return { config: cleaned, changed };
}

function mergeGlobalConfig(current: Record<string, unknown>, defaultAgent = "agent", plugins = OGB_UX_SAFE_PLUGINS): Record<string, unknown> {
  const { provider: currentProvider, ...currentWithoutProvider } = current;
  const cleanedProvider = cleanManagedProviderOptions(currentProvider);
  const preset = UX_PROFILE_PRESET.globalConfig;
  const agent = asRecord(current.agent);
  const buildAgent = asRecord(agent.build);
  const primaryAgent = asRecord(agent.agent);
  const compactionAgent = asRecord(agent.compaction);

  return {
    ...currentWithoutProvider,
    $schema: preset.schemaUrl,
    plugin: unique(plugins),
    share: preset.share,
    autoupdate: preset.autoupdate,
    small_model: preset.smallModel,
    default_agent: defaultAgent,
    agent: {
      ...agent,
      build: {
        ...buildAgent,
        ...preset.agent.build,
      },
      agent: {
        ...primaryAgent,
        ...preset.agent.agent,
        permission: {
          ...asRecord(primaryAgent.permission),
          ...asRecord(preset.agent.agent.permission),
        },
      },
      compaction: {
        ...compactionAgent,
        ...preset.agent.compaction,
      },
    },
    watcher: {
      ...asRecord(current.watcher),
      ignore: OGB_UX_WATCHER_IGNORE,
    },
    tool_output: preset.toolOutput,
    ...(cleanedProvider ? { provider: cleanedProvider } : {}),
    compaction: preset.compaction,
    permission: preset.permission,
  };
}

function hasStaleWebsearchCitedConfig(current: Record<string, unknown>): boolean {
  const plugins = Array.isArray(current.plugin) ? current.plugin : [];
  if (plugins.some((plugin) => typeof plugin === "string" && pluginPackageName(plugin) === "opencode-websearch-cited")) return true;
  const provider = asRecord(current.provider);
  const openai = asRecord(provider.openai);
  const options = asRecord(openai.options);
  return Object.prototype.hasOwnProperty.call(options, "websearch_cited");
}

function hasDisabledUxPluginConfig(current: Record<string, unknown>): boolean {
  const plugins = Array.isArray(current.plugin) ? current.plugin : [];
  return plugins.some((plugin) => typeof plugin === "string" && isDisabledUxPlugin(plugin));
}

function normalizeFallbackEntryForPlugin(entry: unknown): unknown | undefined {
  if (typeof entry === "string") return entry.trim() ? entry.trim() : undefined;
  const record = asRecord(entry);
  if (typeof record.model !== "string" || !record.model.trim()) return undefined;
  const runtime = normalizeRuntimeOptions(record);
  const out: Record<string, unknown> = { model: record.model.trim() };
  if (runtime.reasoningEffort) out.reasoningEffort = runtime.reasoningEffort;
  if (runtime.variant) out.variant = runtime.variant;
  if (runtime.temperature !== undefined) out.temperature = runtime.temperature;
  if (runtime.maxTokens !== undefined) out.maxTokens = runtime.maxTokens;
  if (runtime.thinking !== undefined) out.thinking = runtime.thinking;
  if (runtime.top_p !== undefined) out.topP = runtime.top_p;
  return out;
}

function fallbackConfigFromProfile(config: OgbConfig): Record<string, unknown> {
  const fallback = config.externalPlugins?.autoFallback ?? {};
  const agentFallbacks: Record<string, unknown[]> = {};

  for (const [agent, policy] of Object.entries(config.modelFallbacks?.agents ?? {})) {
    const fallbackModels = Array.isArray(policy)
      ? policy
      : Array.isArray(policy.fallback_models)
        ? policy.fallback_models
        : [];
    const normalized = fallbackModels
      .map(normalizeFallbackEntryForPlugin)
      .filter((item): item is unknown => item !== undefined);
    if (normalized.length > 0) agentFallbacks[agent] = normalized;
  }

  return {
    $schema: "https://raw.githubusercontent.com/HyeokjaeLee/opencode-auto-fallback/main/docs/fallback.schema.json",
    _generated: {
      tool: "ogb",
      version: OGB_VERSION,
      warning: "Generated from the OGB UX profile. Project sync may refine it from local Gemini extension agents.",
    },
    enabled: fallback.enabled === true,
    defaultFallback: (fallback.defaultFallback ?? [])
      .map(normalizeFallbackEntryForPlugin)
      .filter((item): item is unknown => item !== undefined),
    agentFallbacks,
    cooldownMs: fallback.cooldownMs ?? 60_000,
    maxRetries: fallback.maxRetries ?? 2,
    logging: fallback.logging === true,
  };
}

function projectConfigText(): string {
  return `${JSON.stringify(OGB_UX_PROJECT_CONFIG, null, 2)}\n`;
}

function dependencyPackageJsonPath(root: string, dependency: string, pathApi: typeof path = path): string {
  return pathApi.join(root, "node_modules", ...dependency.split("/"), "package.json");
}

export function missingGlobalTuiRuntimeDependencies(root: string, pathApi: typeof path = path): string[] {
  return Object.entries(OGB_TUI_RUNTIME_DEPENDENCIES)
    .filter(([dependency, version]) => {
      const packagePath = dependencyPackageJsonPath(root, dependency, pathApi);
      const installed = readJsonc(packagePath);
      return installed.version !== version;
    })
    .map(([dependency, version]) => `${dependency}@${version}`);
}

function globalTuiRuntimeInstallCommand(): string[] {
  return [
    "npm",
    "install",
    "--save-exact",
    ...Object.entries(OGB_TUI_RUNTIME_DEPENDENCIES).map(([dependency, version]) => `${dependency}@${version}`),
  ];
}

function globalTuiPackageText(current: Record<string, unknown>): string {
  const next: Record<string, unknown> = { ...current };
  const dependencies: Record<string, unknown> = { ...asRecord(next.dependencies) };

  next.type = "module";
  for (const [dependency, version] of Object.entries(OGB_TUI_RUNTIME_DEPENDENCIES)) {
    dependencies[dependency] = version;
  }
  next.dependencies = dependencies;

  return `${JSON.stringify(next, null, 2)}\n`;
}

function ensureGlobalTuiRuntime(options: {
  configDir: string;
  pathApi?: typeof path;
  dryRun?: boolean;
  install?: boolean;
  profileWriter: ProfileWriter;
  protectInstall?: boolean;
}): { packageJson: SetupUxWrite; commands: SetupUxCommand[] } {
  const pathApi = options.pathApi ?? path;
  const packagePath = pathApi.join(options.configDir, "package.json");
  const packageJson = options.profileWriter.writeText({
    filePath: packagePath,
    text: globalTuiPackageText(readJsonc(packagePath)),
  });
  const missing = missingGlobalTuiRuntimeDependencies(options.configDir, pathApi);
  let commands: SetupUxCommand[] = [];
  if (missing.length > 0 && options.install !== false) {
    const installCommand = globalTuiRuntimeInstallCommand();
    commands = options.protectInstall && !options.dryRun
      ? [{ command: installCommand, status: "skipped", message: "Skipped by local maintainer mode", role: "tui-runtime" }]
      : [runCommand(installCommand, options.dryRun, options.configDir, "tui-runtime")];
  }

  return { packageJson, commands };
}

function runCommand(command: string[], dryRun?: boolean, cwd?: string, role?: SetupUxCommand["role"]): SetupUxCommand {
  if (dryRun) return { command, status: "preview", message: `Would run ${command.join(" ")}`, role };
  const result = runNativeCommand({
    command: command[0],
    args: command.slice(1),
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      NO_COLOR: process.env.NO_COLOR ?? "1",
      OGB_STARTUP_SYNC: "0",
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error || result.status !== 0) {
    return {
      command,
      status: "fail",
      message: result.error ?? (output || "command failed"),
      role,
    };
  }
  return { command, status: "ok", message: output || "ok", role };
}

export function missingPluginsFromDebugInfo(output: string, expected: string[]): string[] {
  const loaded = new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim()),
  );
  return expected.filter((plugin) => !loaded.has(plugin));
}

export function authProbeAvailableMethods(output: string): string[] {
  const match = output.match(/Available:\s*([^\r\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((method) => method.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
}

export function missingAuthProbeExpectations(provider: "openai" | "google", output: string): string[] {
  const methods = authProbeAvailableMethods(output);
  const joined = methods.join(" ");
  if (provider === "openai") {
    return /ChatGPT Pro\/Plus/i.test(joined) ? [] : ["ChatGPT Pro/Plus"];
  }
  return /OAuth with Google/i.test(joined) && /Gemini CLI/i.test(joined)
    ? []
    : ["OAuth with Google (Gemini CLI)"];
}

function runAuthProbe(opencodeCommand: string, provider: "openai" | "google", dryRun?: boolean, cwd?: string): SetupUxCommand {
  const command = [
    opencodeCommand,
    "--print-logs",
    "--log-level",
    "DEBUG",
    "auth",
    "login",
    "--provider",
    provider,
    "--method",
    "__ogb_probe__",
  ];
  if (dryRun) return { command, status: "preview", message: `Would probe ${provider} auth methods`, role: "auth" };

  const result = runNativeCommand({
    command: command[0],
    args: command.slice(1),
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      NO_COLOR: process.env.NO_COLOR ?? "1",
      OGB_STARTUP_SYNC: "0",
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const missing = missingAuthProbeExpectations(provider, output);
  const available = authProbeAvailableMethods(output);
  if (result.error) return { command, status: "fail", message: result.error, role: "auth" };
  if (missing.length > 0) {
    return {
      command,
      status: "fail",
      message: `Missing expected ${provider} auth method(s): ${missing.join(", ")}. Available: ${available.join(", ") || "none detected"}`,
      role: "auth",
    };
  }
  return {
    command,
    status: "ok",
    message: `Verified ${provider} auth methods: ${available.join(", ")}`,
    role: "auth",
  };
}

function currentCliPath(): string | undefined {
  const modulePath = fileURLToPath(import.meta.url);
  const packagedCliPath = path.join(path.dirname(modulePath), "cli.js");
  if (fs.existsSync(packagedCliPath)) return packagedCliPath;

  const argvScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (argvScript && fs.existsSync(argvScript) && /^cli\.[jt]s$/.test(path.basename(argvScript))) {
    return argvScript;
  }
  return undefined;
}

function startupCommandPlan(adapter: PlatformAdapter, options: Pick<SetupUxOptions, "platform" | "env">): { command: string; baseArgs: string[] } {
  const crossPlatformResolution = options.platform !== undefined && options.platform !== process.platform;
  const ogbCommand = resolveCommand("ogb", {
    homeDir: adapter.homeDir,
    platform: adapter.platform,
    env: adapter.env,
    includeLookup: crossPlatformResolution ? false : undefined,
    includeNpmPrefix: crossPlatformResolution ? false : undefined,
  });
  if (ogbCommand) {
    return {
      command: ogbCommand,
      baseArgs: ["--project", adapter.homeDir],
    };
  }

  const cliPath = currentCliPath();
  if (cliPath) {
    const nodeCommand = resolveCommand("node", {
      homeDir: adapter.homeDir,
      platform: adapter.platform,
      env: adapter.env,
      includeLookup: crossPlatformResolution ? false : undefined,
      includeNpmPrefix: crossPlatformResolution ? false : undefined,
    }) ?? process.execPath;
    return {
      command: nodeCommand,
      baseArgs: [cliPath, "--project", adapter.homeDir],
    };
  }

  return {
    command: "ogb",
    baseArgs: ["--project", adapter.homeDir],
  };
}

function startupLauncherArgs(plan: { baseArgs: string[] }): string[] {
  return [...plan.baseArgs, "startup-sync"];
}

function sameStringArray(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function clearStaleStartupFailureAfterLauncherRepair(options: {
  statusPath: string;
  cwd: string;
  startupCommand: { command: string; baseArgs: string[] };
  startupConfigWrite: SetupUxWrite;
  dryRun?: boolean;
}): boolean {
  const status = readJsonc(options.statusPath);
  if (status.state !== "fail" && status.state !== "error") return false;

  const desiredArgs = startupLauncherArgs(options.startupCommand);
  const alreadyCurrent = status.command === options.startupCommand.command
    && sameStringArray(status.args, desiredArgs);
  const launcherChanged = options.startupConfigWrite.status === "created"
    || options.startupConfigWrite.status === "updated"
    || !alreadyCurrent;
  if (!launcherChanged) return false;

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(options.statusPath), { recursive: true });
    fs.writeFileSync(options.statusPath, `${JSON.stringify({
      version: 1,
      state: "pass",
      reason: "setup-ux.replaced-stale-startup-launcher",
      cwd: options.cwd,
      startedAt: typeof status.startedAt === "string" ? status.startedAt : new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: typeof status.durationMs === "number" ? status.durationMs : undefined,
      exitCode: 0,
      command: options.startupCommand.command,
      args: desiredArgs,
      stdoutTail: "Cleared stale startup sync failure after rewriting the startup launcher.",
    }, null, 2)}\n`, "utf8");
  }
  return true;
}

export function ensureGlobalStartupPlugin(options: {
  homeDir?: string;
  configDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  profileWriter?: ProfileWriter;
} = {}): GlobalStartupPluginRepair {
  const adapter = createPlatformAdapter({
    platform: options.platform,
    homeDir: options.homeDir || os.homedir(),
    env: options.env,
  });
  const root = options.configDir
    ? adapter.resolvePath(options.configDir)
    : adapter.globalConfigDir;
  const profileWriter = options.profileWriter ?? createProfileWriter({
    bridgeConfigDir: adapter.bridgeConfigDir,
    profileRoot: root,
    dryRun: options.dryRun,
    pathApi: adapter.pathApi,
  });
  const startupCommand = startupCommandPlan(adapter, options);
  const pluginPath = adapter.join(root, "plugins", "ogb-startup-sync.js");
  const configPath = adapter.join(adapter.generatedDir, "ogb-startup-sync.json");
  const source = ogbStartupPluginSource();
  const plugin = profileWriter.writeText({
    filePath: pluginPath,
    text: source,
  });
  const config = profileWriter.writeText({
    filePath: configPath,
    text: startupConfigSource({
      command: startupCommand.command,
      baseArgs: startupCommand.baseArgs,
      syncArgs: ["startup-sync"],
    }),
  });
  const pluginCheck = options.dryRun || plugin.status === "protected"
    ? checkPluginSyntax(undefined, source)
    : checkPluginSyntax(pluginPath);
  const warnings: string[] = [];
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);
  if (plugin.status === "protected") warnings.push(`${plugin.path} protegido pelo modo mantenedor local; arquivo mantido sem alteracao.`);
  if (config.status === "protected") warnings.push(`${config.path} protegido pelo modo mantenedor local; arquivo mantido sem alteracao.`);
  warnings.push(...profileWriter.retention.warnings);

  return {
    plugin,
    config,
    pluginCheck,
    warnings: [...new Set(warnings)],
  };
}

export function setupUx(options: SetupUxOptions = {}): SetupUxReport {
  const adapter = createPlatformAdapter({
    platform: options.platform,
    homeDir: options.homeDir || os.homedir(),
    env: options.env,
  });
  const homeDir = adapter.homeDir;
  const projectRoot = options.projectRoot ? adapter.resolvePath(options.projectRoot) : undefined;
  const projectIsHome = Boolean(projectRoot && (adapter.isHomeProject(projectRoot) || isHomeProject(projectRoot, homeDir)));
  const commandCwd = projectRoot ?? process.cwd();
  const root = options.configDir
    ? adapter.resolvePath(options.configDir)
    : adapter.globalConfigDir;
  const configPath = adapter.join(root, "opencode.json");
  const legacyRoot = options.configDir
    ? undefined
    : adapter.legacyGlobalConfigDir;
  const legacyConfigPath = legacyRoot ? adapter.join(legacyRoot, "opencode.json") : undefined;
  const commandsDir = adapter.join(root, "commands");
  const agentsDir = adapter.join(root, "agents");
  const dcpConfigPath = adapter.join(root, "dcp.jsonc");
  const fallbackConfigPath = adapter.join(root, "plugins", "fallback.json");
  const globalStartupPluginPath = adapter.join(root, "plugins", "ogb-startup-sync.js");
  const globalStartupConfigPath = adapter.join(adapter.generatedDir, "ogb-startup-sync.json");
  const globalGeneratedDir = adapter.pathApi.dirname(globalStartupConfigPath);
  const ogbConfigPath = projectRoot
    ? projectIsHome
      ? adapter.join(adapter.bridgeConfigDir, "ogb.config.jsonc")
      : adapter.join(projectRoot, ".opencode", "ogb.config.jsonc")
    : undefined;
  const localRole = readLocalRole({ homeDir, platform: adapter.platform, env: adapter.env });
  const profileWriter = createProfileWriter({
    bridgeConfigDir: adapter.bridgeConfigDir,
    profileRoot: root,
    dryRun: options.dryRun,
    maintainer: localRole.enabled,
    pathApi: adapter.pathApi,
    backupRoots: [
      ...(legacyRoot ? [{ root: legacyRoot, prefix: "legacy-opencode" }] : []),
      ...(projectRoot ? [{ root: projectRoot, prefix: "project" }] : []),
    ],
  });
  const runtimeWriter = createProfileWriter({
    bridgeConfigDir: adapter.bridgeConfigDir,
    profileRoot: root,
    dryRun: options.dryRun,
    pathApi: adapter.pathApi,
    backupRoots: [
      ...(legacyRoot ? [{ root: legacyRoot, prefix: "legacy-opencode" }] : []),
      ...(projectRoot ? [{ root: projectRoot, prefix: "project" }] : []),
    ],
  });
  const writes: SetupUxWrite[] = [];
  const commands: SetupUxCommand[] = [];
  const notices: string[] = [];
  const warnings: string[] = [];
  const currentConfig = readJsonc(configPath);
  const legacyConfig = legacyConfigPath && adapter.resolvePath(legacyConfigPath) !== adapter.resolvePath(configPath)
    ? readJsonc(legacyConfigPath)
    : {};
  const hasCurrentConfig = Object.keys(currentConfig).length > 0;
  const hasLegacyConfig = Object.keys(legacyConfig).length > 0;
  const baseConfig = options.resetGlobal ? {} : hasCurrentConfig ? currentConfig : legacyConfig;

  if (hasStaleWebsearchCitedConfig(currentConfig) || hasStaleWebsearchCitedConfig(legacyConfig)) {
    warnings.push("opencode-websearch-cited foi desativado porque sobrescreve o OAuth de OpenAI/Google no OpenCode atual.");
  }
  if (hasDisabledUxPluginConfig(legacyConfig)) {
    warnings.push(`${legacyConfigPath} contem plugin(s) OGB desativados; a config global atual fica em ${configPath}.`);
  }
  if (!hasCurrentConfig && hasLegacyConfig) {
    warnings.push(`${legacyConfigPath} foi migrado para ${configPath}, que e o caminho lido pelo OpenCode atual.`);
  }
  if (legacyConfigPath && hasLegacyConfig) {
    const cleanedLegacy = cleanDisabledUxConfig(legacyConfig);
    if (cleanedLegacy.changed) {
      writes.push(profileWriter.writeText({
        filePath: legacyConfigPath,
        text: `${JSON.stringify(cleanedLegacy.config, null, 2)}\n`,
      }));
    }
  }

  const existingOpenCode = resolveCommand("opencode", { homeDir, platform: adapter.platform, env: adapter.env });
  const startupCommand = startupCommandPlan(adapter, options);
  if (options.installOpenCode === false) {
    if (!existingOpenCode) {
      warnings.push("OpenCode is not installed. Re-run with --install-opencode or install OpenCode first.");
    }
  } else if (options.dryRun) {
    commands.push(runCommand(adapter.installOpenCodeCommand(), true, undefined, "opencode"));
  } else if (existingOpenCode) {
    commands.push({ command: [existingOpenCode], status: "ok", message: "OpenCode already available.", role: "opencode" });
  } else {
    commands.push(runCommand(adapter.installOpenCodeCommand(), false, undefined, "opencode"));
  }

  const desiredPlugins = [
    ...OGB_UX_SAFE_PLUGINS,
    globalStartupPluginSpec(globalStartupPluginPath),
  ];
  const startupPluginSourceText = ogbStartupPluginSource();
  const tuiSidebarPluginSourceText = ogbTuiSidebarPluginSource();
  const installablePlugins = desiredPlugins.filter((plugin) => !isLocalPluginSpec(plugin));
  const merged = mergeGlobalConfig(baseConfig, OGB_UX_PROJECT_CONFIG.openCode?.defaultAgent, desiredPlugins);
  writes.push(profileWriter.writeText({
    filePath: configPath,
    text: `${JSON.stringify(merged, null, 2)}\n`,
  }));
  writes.push(profileWriter.writeText({
    filePath: dcpConfigPath,
    text: `${JSON.stringify(DCP_CONFIG, null, 2)}\n`,
  }));
  writes.push(profileWriter.writeText({
    filePath: fallbackConfigPath,
    text: `${JSON.stringify(UX_PROFILE_PRESET.fallbackConfig ?? fallbackConfigFromProfile(OGB_UX_PROJECT_CONFIG), null, 2)}\n`,
  }));
  writes.push(runtimeWriter.writeText({
    filePath: globalStartupPluginPath,
    text: startupPluginSourceText,
  }));
  const globalTuiRuntime = ensureGlobalTuiRuntime({
    configDir: root,
    pathApi: adapter.pathApi,
    dryRun: options.dryRun,
    install: options.installTuiDependencies,
    profileWriter,
    protectInstall: localRole.enabled,
  });
  writes.push(globalTuiRuntime.packageJson);
  commands.push(...globalTuiRuntime.commands);
  const globalTui = ensureGlobalTuiSidebar({
    configDir: root,
    dryRun: options.dryRun,
    profileWriter,
    pluginSource: tuiSidebarPluginSourceText,
    configDefaults: UX_PROFILE_PRESET.tuiConfig,
  });
  writes.push(globalTui.plugin, globalTui.config);
  if (globalTui.plugin.status === "updated") {
    notices.push("Global TUI sidebar updated; restart OpenCode to load it.");
  } else if (globalTui.plugin.status === "created") {
    notices.push("Global TUI sidebar installed; restart OpenCode to load it.");
  }
  warnings.push(...globalTui.warnings);
  const startupConfigWrite = runtimeWriter.writeText({
    filePath: globalStartupConfigPath,
    text: startupConfigSource({
      command: startupCommand.command,
      baseArgs: startupCommand.baseArgs,
      syncArgs: ["startup-sync"],
    }),
  });
  writes.push(startupConfigWrite);
  for (const [command, content] of Object.entries(UX_PROFILE_PRESET.files.commands)) {
    writes.push(profileWriter.writeText({
      filePath: adapter.join(commandsDir, `${command}.md`),
      text: content,
    }));
  }
  for (const command of REMOVED_GLOBAL_UX_COMMANDS) {
    const removed = profileWriter.removeFileIfExists(adapter.join(commandsDir, `${command}.md`));
    if (removed) writes.push(removed);
  }
  for (const [agent, content] of Object.entries(UX_PROFILE_PRESET.files.agents)) {
    writes.push(profileWriter.writeText({
      filePath: adapter.join(agentsDir, `${agent}.md`),
      text: content,
    }));
  }
  for (const [skill, files] of Object.entries(UX_PROFILE_PRESET.files.skills ?? {})) {
    for (const [relPath, content] of Object.entries(files)) {
      writes.push(profileWriter.writeText({
        filePath: adapter.join(root, "skills", skill, ...relPath.split("/")),
        text: content,
      }));
    }
  }
  writes.push(profileWriter.writeText({
    filePath: adapter.join(root, "AGENTS.md"),
    text: UX_PROFILE_PRESET.files.globalAgentsMd,
  }));

  if (ogbConfigPath && options.writeProjectProfile !== false) {
    writes.push(profileWriter.writeText({
      filePath: ogbConfigPath,
      text: projectConfigText(),
      force: options.force,
    }));
  }

  if (options.installPlugins !== false) {
    const opencodeCommand = options.dryRun === true ? "opencode" : resolveCommand("opencode", { homeDir, platform: adapter.platform, env: adapter.env });
    for (const plugin of installablePlugins) {
      if (localRole.enabled && !options.dryRun) {
        commands.push({ command: ["opencode", "plugin", plugin, "--global", "--force"], status: "skipped", message: "Skipped by local maintainer mode", role: "plugin" });
      } else if (!opencodeCommand) {
        commands.push({ command: ["opencode", "plugin", plugin, "--global", "--force"], status: "skipped", message: "OpenCode is not available", role: "plugin" });
      } else {
        commands.push(runCommand([opencodeCommand, "plugin", plugin, "--global", "--force"], options.dryRun, commandCwd, "plugin"));
      }
    }
    if (opencodeCommand && (!localRole.enabled || options.dryRun)) {
      const verification = runCommand([opencodeCommand, "debug", "info"], options.dryRun, commandCwd, "verify");
      if (verification.status === "ok") {
        const missing = missingPluginsFromDebugInfo(verification.message, desiredPlugins);
        verification.message = missing.length > 0
          ? `Missing plugin(s) in opencode debug info: ${missing.join(", ")}`
          : "Verified expected plugins in opencode debug info";
        if (missing.length > 0) verification.status = "fail";
      }
      commands.push(verification);
      commands.push(runAuthProbe(opencodeCommand, "openai", options.dryRun, commandCwd));
      commands.push(runAuthProbe(opencodeCommand, "google", options.dryRun, commandCwd));
    } else if (localRole.enabled && !options.dryRun) {
      commands.push({ command: ["opencode", "debug", "info"], status: "skipped", message: "Skipped by local maintainer mode", role: "verify" });
    }
  }

  for (const command of commands) {
    if (command.status === "fail") warnings.push(`${command.command.join(" ")}: ${command.message}`);
    if (command.status === "skipped") warnings.push(`${command.command.join(" ")}: ${command.message}`);
  }
  const startupPluginWrite = writes.find((write) => write.path === globalStartupPluginPath);
  const pluginCheck = options.dryRun || startupPluginWrite?.status === "protected"
    ? checkPluginSyntax(undefined, startupPluginSourceText)
    : checkPluginSyntax(globalStartupPluginPath);
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);
  recoverStaleStartupStatus({
    statusPath: adapter.join(globalGeneratedDir, "ogb-plugin-status.json"),
    lockPath: adapter.join(globalGeneratedDir, "ogb-startup-sync.lock"),
    cwd: homeDir,
    reason: "setup-ux.recovered-stale",
    dryRun: Boolean(options.dryRun),
  });
  clearStaleStartupFailureAfterLauncherRepair({
    statusPath: adapter.join(globalGeneratedDir, "ogb-plugin-status.json"),
    cwd: homeDir,
    startupCommand,
    startupConfigWrite,
    dryRun: Boolean(options.dryRun),
  });
  for (const write of writes) {
    if (write.status === "conflict") warnings.push(`${write.path} exists and differs; re-run setup-ux with --force to replace the OGB profile.`);
    if (write.status === "protected") warnings.push(`${write.path} protegido pelo modo mantenedor local; arquivo mantido sem alteracao.`);
  }
  warnings.push(...profileWriter.retention.warnings);
  warnings.push(...runtimeWriter.retention.warnings);

  return {
    version: OGB_VERSION,
    homeDir,
    projectRoot,
    configPath,
    dcpConfigPath,
    commandsDir,
    agentsDir,
    fallbackConfigPath,
    ogbConfigPath,
    writes,
    commands,
    notices: [...new Set(notices)],
    warnings: [...new Set(warnings)],
  };
}

export function printSetupUxReport(report: SetupUxReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("OpenCode Gemini Bridge UX setup");
  console.log(`Home: ${report.homeDir}`);
  if (report.projectRoot) console.log(`Project: ${report.projectRoot}`);
  for (const write of report.writes) console.log(`${write.status}: ${write.path}${write.backup ? ` (backup: ${write.backup})` : ""}`);
  for (const command of report.commands) console.log(`${command.status}: ${command.command.join(" ")}${command.message ? ` - ${command.message.split("\n")[0]}` : ""}`);
  if (report.notices.length > 0) {
    console.log("Notices:");
    for (const notice of report.notices) console.log(`- ${notice}`);
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
