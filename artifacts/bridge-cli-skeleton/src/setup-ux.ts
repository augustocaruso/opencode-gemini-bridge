import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS } from "./built-ins.js";
import { resolveCommand } from "./command-resolution.js";
import { normalizeRuntimeOptions, type OgbConfig } from "./ogb-config.js";
import { globalOpenCodeConfigDir, legacyWindowsAppDataOpenCodeConfigDir } from "./opencode-paths.js";
import { spawnCommandSync } from "./process.js";
import { OGB_VERSION } from "./types.js";

export const OGB_UX_SAFE_PLUGINS = [
  "opencode-gemini-auth@1.4.12",
  "@ex-machina/opencode-anthropic-auth@1.8.0",
  "opencode-update-notifier@0.1.0",
  "@tarquinen/opencode-dcp@3.1.9",
  "opencode-pty@0.3.4",
];

export const OGB_UX_DISABLED_PLUGINS = [
  "opencode-websearch-cited@1.2.0",
  "opencode-auto-fallback@0.4.2",
];

export const OGB_UX_PLUGINS = OGB_UX_SAFE_PLUGINS;

export const RESEARCH_COMMAND = `---
description: Pesquisa web com citacoes e sintese curta
---

Pesquise na web sobre:

$ARGUMENTS

Use pesquisa web quando precisar de informacao atual, verificacao externa ou
fontes. Responda em portugues.

Contrato da resposta:

- comece com uma resposta direta em 3-6 linhas;
- destaque datas concretas quando o assunto for recente;
- compare fontes se houver divergencia;
- termine com uma secao \`Fontes\` com os links/citacoes retornados pela ferramenta;
- se a busca nao for necessaria, diga isso brevemente e responda sem forcar web.
`;

export const DEV_SERVER_COMMAND = `---
description: Roda dev server ou watcher como background session
---

Rode uma tarefa longa de desenvolvimento como background session.

Pedido do usuario:

$ARGUMENTS

Regras:

- use \`pty_spawn\` quando a ferramenta estiver disponivel;
- nao use \`&\`, \`nohup\`, \`disown\` ou subprocesso escondido via shell;
- se o usuario informou um comando, rode esse comando;
- se o usuario nao informou comando, detecte o package manager pelo lockfile e
  pelo \`package.json\`, depois prefira \`dev\`, \`start\`, \`test --watch\` ou script
  equivalente;
- defina um titulo curto para a session;
- use \`notifyOnExit: true\` quando fizer sentido;
- depois de iniciar, leia as primeiras linhas com \`pty_read\`;
- responda com comando, session id, URL local se aparecer, e como parar;
- se ja existir uma session equivalente rodando, mostre a existente e pergunte
  antes de criar duplicata.
`;

export function globalBuiltInCommandContent(name: string): string {
  return BUILT_IN_COMMANDS.find((command) => command.name === name)?.content ?? "";
}

export const DCP_CONFIG = {
  $schema: "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
  enabled: true,
  debug: false,
  pruneNotification: "minimal",
  pruneNotificationType: "toast",
  commands: {
    enabled: true,
    protectedTools: [],
  },
  manualMode: {
    enabled: false,
    automaticStrategies: true,
  },
  turnProtection: {
    enabled: false,
    turns: 4,
  },
  experimental: {
    allowSubAgents: false,
    customPrompts: false,
  },
  protectedFilePatterns: [],
  compress: {
    mode: "range",
    permission: "allow",
    showCompression: false,
    summaryBuffer: true,
    maxContextLimit: "80%",
    minContextLimit: "45%",
    nudgeFrequency: 5,
    iterationNudgeThreshold: 15,
    nudgeForce: "soft",
    protectedTools: [],
    protectUserMessages: false,
  },
  strategies: {
    deduplication: {
      enabled: true,
      protectedTools: [],
    },
    purgeErrors: {
      enabled: true,
      turns: 4,
      protectedTools: [],
    },
  },
};

export const OGB_UX_PROJECT_CONFIG: OgbConfig = {
  openCode: {
    defaultAgent: "YOLO",
  },
  externalPlugins: {
    quotaUi: {
      enabled: false,
      suppressOgbLimits: true,
      enableToast: false,
      formatStyle: "allWindows",
      enabledProviders: ["openai", "anthropic", "google-gemini-cli"],
      onlyCurrentModel: false,
      percentDisplayMode: "used",
    },
    autoFallback: {
      enabled: false,
      plugin: "opencode-auto-fallback@0.4.2",
      installProjectPlugin: false,
      cooldownMs: 60_000,
      maxRetries: 2,
      logging: false,
    },
  },
  modelFallbacks: {
    agents: {
      "med-knowledge-architect": {
        model: { id: "google/gemini-3.1-pro-preview", variant: "high" },
        fallback_models: [
          { model: "anthropic/claude-sonnet-4-6", effort: "high" },
          { model: "openai/gpt-5.5", variant: "high" },
        ],
      },
      "med-flashcard-maker": {
        model: { id: "google/gemini-3.1-pro-preview", variant: "high" },
        fallback_models: [
          { model: "anthropic/claude-sonnet-4-6", effort: "high" },
          { model: "openai/gpt-5.5", variant: "high" },
        ],
      },
      "med-catalog-curator": {
        model: { id: "google/gemini-3.1-pro-preview", variant: "medium" },
        fallback_models: [
          { model: "openai/gpt-5.4", variant: "medium" },
          { model: "anthropic/claude-sonnet-4-6", effort: "medium" },
        ],
      },
      "med-chat-triager": {
        model: { id: "google/gemini-3-flash-preview", variant: "high" },
        fallback_models: [
          { model: "openai/gpt-5.4-mini", variant: "medium" },
          { model: "anthropic/claude-haiku-4-5", effort: "high" },
        ],
      },
      "med-publish-guard": {
        model: { id: "google/gemini-3-flash-preview", variant: "high" },
        fallback_models: [
          { model: "openai/gpt-5.4-mini", variant: "medium" },
          { model: "anthropic/claude-haiku-4-5", effort: "high" },
        ],
      },
    },
  },
};

const OGB_UX_WATCHER_IGNORE = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  ".venv/**",
  "__pycache__/**",
  ".opencode/generated/**",
];

export interface SetupUxOptions {
  homeDir?: string;
  configDir?: string;
  projectRoot?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  force?: boolean;
  installPlugins?: boolean;
  installOpenCode?: boolean;
  writeProjectProfile?: boolean;
}

export interface SetupUxWrite {
  path: string;
  status: "created" | "updated" | "unchanged" | "preview" | "conflict";
}

export interface SetupUxCommand {
  command: string[];
  status: "skipped" | "ok" | "fail" | "preview";
  message: string;
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
  const agent = asRecord(current.agent);
  const buildAgent = asRecord(agent.build);
  const primaryAgent = asRecord(agent.agent);
  const compactionAgent = asRecord(agent.compaction);

  return {
    ...currentWithoutProvider,
    $schema: "https://opencode.ai/config.json",
    plugin: unique(plugins),
    share: "manual",
    autoupdate: "notify",
    small_model: "openai/gpt-5.4-mini",
    default_agent: defaultAgent,
    agent: {
      ...agent,
      build: {
        ...buildAgent,
        disable: true,
      },
      agent: {
        ...primaryAgent,
        mode: "primary",
        description: "Agente principal para conversar, editar e executar ferramentas conforme permissoes.",
        permission: {
          ...asRecord(primaryAgent.permission),
          question: "allow",
          plan_enter: "allow",
        },
      },
      compaction: {
        ...compactionAgent,
        model: "openai/gpt-5.4-mini",
      },
    },
    watcher: {
      ...asRecord(current.watcher),
      ignore: OGB_UX_WATCHER_IGNORE,
    },
    tool_output: {
      max_lines: 800,
      max_bytes: 30_000,
    },
    ...(cleanedProvider ? { provider: cleanedProvider } : {}),
    compaction: {
      auto: true,
      prune: true,
      tail_turns: 4,
      preserve_recent_tokens: 12_000,
      reserved: 10_000,
    },
    permission: {
      websearch: "allow",
      bash: {
        "*": "ask",
        "git status*": "allow",
        "git diff*": "allow",
        "git log*": "allow",
        "npm run dev*": "allow",
        "npm run build*": "allow",
        "npm test*": "allow",
        "npm run test*": "allow",
        "pnpm dev*": "allow",
        "pnpm run dev*": "allow",
        "pnpm test*": "allow",
        "pnpm run test*": "allow",
        "pnpm build*": "allow",
        "pnpm run build*": "allow",
        "yarn dev*": "allow",
        "yarn run dev*": "allow",
        "yarn test*": "allow",
        "yarn run test*": "allow",
        "yarn build*": "allow",
        "yarn run build*": "allow",
        "bun dev*": "allow",
        "bun run dev*": "allow",
        "bun test*": "allow",
        "bun run test*": "allow",
        "bun run build*": "allow",
        "uv run *": "allow",
        "pytest*": "allow",
        "python -m pytest*": "allow",
        "cargo watch*": "allow",
        "cargo test*": "allow",
        "make test*": "allow",
        "git push*": "deny",
        "git reset*": "deny",
        "rm *": "deny",
        "sudo *": "deny",
        "terraform *": "deny",
        "kubectl delete*": "deny",
      },
    },
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

function yoloAgentContent(): string {
  return BUILT_IN_AGENTS.find((agent) => agent.name === "YOLO")?.content ?? "";
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

function writeText(options: {
  filePath: string;
  text: string;
  dryRun?: boolean;
  force?: boolean;
  conflictIfChanged?: boolean;
}): SetupUxWrite {
  const exists = fs.existsSync(options.filePath);
  const current = exists ? fs.readFileSync(options.filePath, "utf8") : "";
  if (current === options.text) return { path: options.filePath, status: "unchanged" };
  if (exists && options.conflictIfChanged && options.force !== true) return { path: options.filePath, status: "conflict" };
  if (options.dryRun) return { path: options.filePath, status: "preview" };
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
  fs.writeFileSync(options.filePath, options.text, "utf8");
  return { path: options.filePath, status: exists ? "updated" : "created" };
}

function runCommand(command: string[], dryRun?: boolean, cwd?: string): SetupUxCommand {
  if (dryRun) return { command, status: "preview", message: `Would run ${command.join(" ")}` };
  const result = spawnCommandSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
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
      message: result.error?.message ?? (output || "command failed"),
    };
  }
  return { command, status: "ok", message: output || "ok" };
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
  if (dryRun) return { command, status: "preview", message: `Would probe ${provider} auth methods` };

  const result = spawnCommandSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
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
  if (result.error) return { command, status: "fail", message: result.error.message };
  if (missing.length > 0) {
    return {
      command,
      status: "fail",
      message: `Missing expected ${provider} auth method(s): ${missing.join(", ")}. Available: ${available.join(", ") || "none detected"}`,
    };
  }
  return {
    command,
    status: "ok",
    message: `Verified ${provider} auth methods: ${available.join(", ")}`,
  };
}

function installOpenCodeCommand(): string[] {
  return process.platform === "win32"
    ? ["npm", "install", "-g", "opencode-ai@latest"]
    : ["sh", "-c", "curl -fsSL https://opencode.ai/install | bash"];
}

export function setupUx(options: SetupUxOptions = {}): SetupUxReport {
  const homeDir = options.homeDir || os.homedir();
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : undefined;
  const commandCwd = projectRoot ?? process.cwd();
  const root = options.configDir
    ? path.resolve(options.configDir)
    : globalOpenCodeConfigDir({ homeDir, platform: options.platform, env: options.env });
  const configPath = path.join(root, "opencode.json");
  const legacyRoot = options.configDir
    ? undefined
    : legacyWindowsAppDataOpenCodeConfigDir({ homeDir, platform: options.platform, env: options.env });
  const legacyConfigPath = legacyRoot ? path.join(legacyRoot, "opencode.json") : undefined;
  const commandsDir = path.join(root, "commands");
  const agentsDir = path.join(root, "agents");
  const dcpConfigPath = path.join(root, "dcp.jsonc");
  const fallbackConfigPath = path.join(root, "plugins", "fallback.json");
  const ogbConfigPath = projectRoot ? path.join(projectRoot, ".opencode", "ogb.config.jsonc") : undefined;
  const writes: SetupUxWrite[] = [];
  const commands: SetupUxCommand[] = [];
  const warnings: string[] = [];
  const desiredPlugins = OGB_UX_SAFE_PLUGINS;
  const currentConfig = readJsonc(configPath);
  const legacyConfig = legacyConfigPath && path.resolve(legacyConfigPath) !== path.resolve(configPath)
    ? readJsonc(legacyConfigPath)
    : {};
  const hasCurrentConfig = Object.keys(currentConfig).length > 0;
  const hasLegacyConfig = Object.keys(legacyConfig).length > 0;
  const baseConfig = hasCurrentConfig ? currentConfig : legacyConfig;

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
      writes.push(writeText({
        filePath: legacyConfigPath,
        text: `${JSON.stringify(cleanedLegacy.config, null, 2)}\n`,
        dryRun: options.dryRun,
      }));
    }
  }

  const existingOpenCode = resolveCommand("opencode", { homeDir });
  if (options.installOpenCode === false) {
    if (!existingOpenCode) {
      warnings.push("OpenCode is not installed. Re-run with --install-opencode or install OpenCode first.");
    }
  } else {
    commands.push(runCommand(installOpenCodeCommand(), options.dryRun));
  }

  const merged = mergeGlobalConfig(baseConfig, OGB_UX_PROJECT_CONFIG.openCode?.defaultAgent, desiredPlugins);
  writes.push(writeText({
    filePath: configPath,
    text: `${JSON.stringify(merged, null, 2)}\n`,
    dryRun: options.dryRun,
  }));
  writes.push(writeText({
    filePath: dcpConfigPath,
    text: `${JSON.stringify(DCP_CONFIG, null, 2)}\n`,
    dryRun: options.dryRun,
  }));
  writes.push(writeText({
    filePath: fallbackConfigPath,
    text: `${JSON.stringify(fallbackConfigFromProfile(OGB_UX_PROJECT_CONFIG), null, 2)}\n`,
    dryRun: options.dryRun,
  }));
  writes.push(writeText({
    filePath: path.join(commandsDir, "research.md"),
    text: RESEARCH_COMMAND,
    dryRun: options.dryRun,
  }));
  writes.push(writeText({
    filePath: path.join(commandsDir, "dev-server.md"),
    text: DEV_SERVER_COMMAND,
    dryRun: options.dryRun,
  }));
  writes.push(writeText({
    filePath: path.join(commandsDir, "upgrade-ogb.md"),
    text: globalBuiltInCommandContent("upgrade-ogb"),
    dryRun: options.dryRun,
  }));
  writes.push(writeText({
    filePath: path.join(agentsDir, "YOLO.md"),
    text: yoloAgentContent(),
    dryRun: options.dryRun,
  }));

  if (ogbConfigPath && options.writeProjectProfile !== false) {
    writes.push(writeText({
      filePath: ogbConfigPath,
      text: projectConfigText(),
      dryRun: options.dryRun,
      force: options.force,
      conflictIfChanged: true,
    }));
  }

  if (options.installPlugins !== false) {
    const opencodeCommand = options.dryRun === true ? "opencode" : resolveCommand("opencode", { homeDir });
    for (const plugin of desiredPlugins) {
      if (!opencodeCommand) {
        commands.push({ command: ["opencode", "plugin", plugin, "--global", "--force"], status: "skipped", message: "OpenCode is not available" });
      } else {
        commands.push(runCommand([opencodeCommand, "plugin", plugin, "--global", "--force"], options.dryRun, commandCwd));
      }
    }
    if (opencodeCommand) {
      const verification = runCommand([opencodeCommand, "debug", "info"], options.dryRun, commandCwd);
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
    }
  }

  for (const command of commands) {
    if (command.status === "fail") warnings.push(`${command.command.join(" ")}: ${command.message}`);
    if (command.status === "skipped") warnings.push(`${command.command.join(" ")}: ${command.message}`);
  }
  for (const write of writes) {
    if (write.status === "conflict") warnings.push(`${write.path} exists and differs; re-run setup-ux with --force to replace the OGB profile.`);
  }

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
    warnings,
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
  for (const write of report.writes) console.log(`${write.status}: ${write.path}`);
  for (const command of report.commands) console.log(`${command.status}: ${command.command.join(" ")}${command.message ? ` - ${command.message.split("\n")[0]}` : ""}`);
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
