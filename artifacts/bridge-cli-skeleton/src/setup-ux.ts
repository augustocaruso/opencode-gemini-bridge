import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS } from "./built-ins.js";
import { normalizeRuntimeOptions, type OgbConfig } from "./ogb-config.js";
import { OGB_VERSION } from "./types.js";

export const OGB_UX_PLUGINS = [
  "opencode-gemini-auth@1.4.12",
  "@ex-machina/opencode-anthropic-auth@1.8.0",
  "opencode-update-notifier@0.1.0",
  "opencode-auto-fallback@0.4.2",
  "@tarquinen/opencode-dcp@3.1.9",
  "opencode-pty@0.3.4",
  "opencode-websearch-cited@1.2.0",
];

export const RESEARCH_COMMAND = `---
description: Pesquisa web com citacoes e sintese curta
---

Pesquise na web sobre:

$ARGUMENTS

Use \`websearch_cited\` quando precisar de informacao atual, verificacao externa
ou fontes. Responda em portugues.

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
      enabled: true,
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

function configRoot(homeDir: string): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "opencode");
  }
  if (process.env.XDG_CONFIG_HOME && path.resolve(homeDir) === os.homedir()) {
    return path.join(process.env.XDG_CONFIG_HOME, "opencode");
  }
  return path.join(homeDir, ".config", "opencode");
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

function mergeGlobalConfig(current: Record<string, unknown>, defaultAgent = "agent"): Record<string, unknown> {
  const provider = asRecord(current.provider);
  const openai = asRecord(provider.openai);
  const openaiOptions = asRecord(openai.options);
  const agent = asRecord(current.agent);
  const buildAgent = asRecord(agent.build);
  const primaryAgent = asRecord(agent.agent);
  const compactionAgent = asRecord(agent.compaction);

  return {
    ...current,
    $schema: "https://opencode.ai/config.json",
    plugin: unique(OGB_UX_PLUGINS),
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
    provider: {
      ...provider,
      openai: {
        ...openai,
        options: {
          ...openaiOptions,
          websearch_cited: {
            model: "gpt-5.5",
          },
        },
      },
    },
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

function findCommand(command: string, homeDir = os.homedir()): string | undefined {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (!result.error && result.status === 0) {
    const found = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) return found;
  }

  const npmPrefix = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", shell: process.platform === "win32" });
  const prefix = !npmPrefix.error && npmPrefix.status === 0 ? npmPrefix.stdout.trim() : "";
  const candidates = process.platform === "win32"
    ? [
      ...(prefix ? [
        path.join(prefix, `${command}.cmd`),
        path.join(prefix, command),
        path.join(prefix, "bin", `${command}.cmd`),
        path.join(prefix, "bin", command),
      ] : []),
    ]
    : [
      ...(prefix ? [path.join(prefix, "bin", command), path.join(prefix, command)] : []),
      path.join(homeDir, ".opencode", "bin", command),
      path.join(homeDir, ".local", "bin", command),
    ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function runCommand(command: string[], dryRun?: boolean): SetupUxCommand {
  if (dryRun) return { command, status: "preview", message: `Would run ${command.join(" ")}` };
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) {
    return {
      command,
      status: "fail",
      message: result.error?.message ?? (result.stderr || result.stdout || "command failed").trim(),
    };
  }
  return { command, status: "ok", message: (result.stdout || "ok").trim() };
}

function installOpenCodeCommand(): string[] {
  return process.platform === "win32"
    ? ["npm", "install", "-g", "opencode-ai"]
    : ["sh", "-c", "curl -fsSL https://opencode.ai/install | bash"];
}

export function setupUx(options: SetupUxOptions = {}): SetupUxReport {
  const homeDir = options.homeDir || os.homedir();
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : undefined;
  const root = options.configDir ? path.resolve(options.configDir) : configRoot(homeDir);
  const configPath = path.join(root, "opencode.json");
  const commandsDir = path.join(root, "commands");
  const agentsDir = path.join(root, "agents");
  const dcpConfigPath = path.join(root, "dcp.jsonc");
  const fallbackConfigPath = path.join(root, "plugins", "fallback.json");
  const ogbConfigPath = projectRoot ? path.join(projectRoot, ".opencode", "ogb.config.jsonc") : undefined;
  const writes: SetupUxWrite[] = [];
  const commands: SetupUxCommand[] = [];
  const warnings: string[] = [];

  if (!findCommand("opencode", homeDir)) {
    if (options.installOpenCode === false) {
      warnings.push("OpenCode is not installed. Re-run with --install-opencode or install OpenCode first.");
    } else {
      commands.push(runCommand(installOpenCodeCommand(), options.dryRun));
    }
  }

  const merged = mergeGlobalConfig(readJsonc(configPath), OGB_UX_PROJECT_CONFIG.openCode?.defaultAgent);
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
    for (const plugin of OGB_UX_PLUGINS) {
      const opencodeCommand = options.dryRun === true ? "opencode" : findCommand("opencode", homeDir);
      if (!opencodeCommand) {
        commands.push({ command: ["opencode", "plugin", plugin, "--global", "--force"], status: "skipped", message: "OpenCode is not available" });
      } else {
        commands.push(runCommand([opencodeCommand, "plugin", plugin, "--global", "--force"], options.dryRun));
      }
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
