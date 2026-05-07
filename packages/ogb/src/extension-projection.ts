import fs from "node:fs";
import path from "node:path";
import { createBackupSession, type BackupRecord, type BackupSession } from "./backup-policy.js";
import { BUILT_IN_COMMANDS } from "./built-ins.js";
import { sha256File, sha256Text } from "./file-hash.js";
import {
  readOgbConfig,
  resolveAgentFallback,
  runtimeOptionsForProvider,
  type ModelFallbackEntry,
  type ModelRuntimeOptions,
  type ResolvedAgentFallback,
} from "./ogb-config.js";
import {
  createModelRoutingContext,
  writeModelRoutingReport,
  type ModelRoutingDecision,
} from "./model-routing.js";
import { resolveProjectPaths } from "./paths.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState } from "./sync-state.js";
import { OGB_VERSION } from "./types.js";

export interface ExtensionProjectionOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface GeminiExtensionInstallMetadata {
  source?: string;
  type?: string;
  ref?: string;
  autoUpdate?: boolean;
}

export interface GeminiExtensionCommandProjection {
  name: string;
  source: string;
  target?: string;
  description?: string;
  status: "projected" | "conflict" | "parse_warning";
  message?: string;
}

export interface GeminiExtensionMapEntry {
  name: string;
  scope: "project" | "global";
  path: string;
  manifestPath: string;
  manifestHash?: string;
  install?: GeminiExtensionInstallMetadata;
  commands: GeminiExtensionCommandProjection[];
  skills: Array<{ name: string; source: string }>;
  agents: Array<{ name: string; source: string; target?: string; projected: boolean; reason?: string; status?: "projected" | "conflict"; modelFallback?: ResolvedAgentFallback }>;
  hooks: Array<{ source: string; projected: false; reason: string }>;
  scripts: Array<{ source: string; projected: false; reason: string }>;
  docs: Array<{ source: string }>;
  warnings: string[];
}

export interface GeminiExtensionProjectionMap {
  _generated: {
    tool: "ogb";
    version: string;
    warning: string;
  };
  projectRoot: string;
  generatedAt: string;
  extensions: GeminiExtensionMapEntry[];
  projectedCommands: string[];
  projectedAgents: string[];
  modelFallbacks: Array<{
    agent: string;
    extension: string;
    model?: string;
    variant?: string;
    reasoningEffort?: string;
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    textVerbosity?: string;
    thinking?: Record<string, unknown>;
    fallback_models: ModelFallbackEntry[];
    source: ResolvedAgentFallback["source"];
  }>;
  removedCommands: string[];
  removedAgents: string[];
  warnings: string[];
}

export interface ProjectExtensionCommandsResult {
  projectedCommands: string[];
  projectedAgents: string[];
  projectedModelFallbackConfig?: string;
  projectedModelRoutingConfig?: string;
  removedCommands: string[];
  removedAgents: string[];
  map: GeminiExtensionProjectionMap;
  backups: BackupRecord[];
  warnings: string[];
}

interface ExtensionRoot {
  name: string;
  scope: "project" | "global";
  dir: string;
}

interface ParsedGeminiCommand {
  description?: string;
  prompt: string;
  warnings: string[];
}

const EXTENSION_COMMAND_MARKER = "SOURCE_KIND: gemini-extension-command";
const EXTENSION_AGENT_MARKER = "SOURCE_KIND: gemini-extension-agent";

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function toPosix(input: string): string {
  return input.split(path.sep).join("/");
}

function relativeTo(root: string, filePath: string): string {
  return toPosix(path.relative(root, filePath));
}

function listDirs(root: string): string[] {
  if (!dirExists(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function listFiles(root: string): string[] {
  if (!dirExists(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(fullPath));
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

function uniqueExtensionRoots(projectRoot: string, homeDir: string): ExtensionRoot[] {
  const seen = new Set<string>();
  const roots: ExtensionRoot[] = [];
  const candidates: Array<["project" | "global", string]> = [
    ["project", path.join(projectRoot, ".gemini", "extensions")],
    ["global", path.join(homeDir, ".gemini", "extensions")],
  ];

  for (const [scope, root] of candidates) {
    for (const dir of listDirs(root)) {
      const resolved = path.resolve(dir);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      roots.push({ name: path.basename(dir), scope, dir });
    }
  }

  return roots.sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`));
}

function parseQuotedValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, trimmed.endsWith("\"") ? -1 : undefined);
    }
  }
  if (trimmed.startsWith("'")) return trimmed.slice(1, trimmed.endsWith("'") ? -1 : undefined);
  return trimmed;
}

export function parseGeminiCommandToml(text: string): ParsedGeminiCommand {
  const warnings: string[] = [];
  const descriptionMatch = text.match(/^\s*description\s*=\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n#]+)/m);
  const blockMatch = text.match(/^\s*prompt\s*=\s*("""|''')\r?\n?([\s\S]*?)\r?\n?\1/m);
  const linePromptMatch = text.match(/^\s*prompt\s*=\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n#]+)/m);
  const description = parseQuotedValue(descriptionMatch?.[1]);
  let prompt = blockMatch?.[2] ?? parseQuotedValue(linePromptMatch?.[1]) ?? "";

  if (!description) warnings.push("Missing description");
  if (!prompt.trim()) {
    warnings.push("Missing prompt; copied raw TOML as fallback");
    prompt = text.trim();
  }

  return { description, prompt, warnings };
}

function normalizeCommandPrompt(prompt: string, extensionDir: string): string {
  return prompt
    .replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS")
    .replaceAll("${extensionPath}", extensionDir)
    .replaceAll("${/}", path.sep)
    .trim();
}

function safeSegment(input: string): string {
  return input
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "command";
}

function extensionCommandName(extensionName: string, commandRelPath: string, used: Set<string>): string {
  const withoutExt = commandRelPath.slice(0, -path.extname(commandRelPath).length);
  const segments = withoutExt.split("/").map(safeSegment);
  const preferred = segments.join("/");
  const base = used.has(preferred) ? [safeSegment(extensionName), ...segments].join("/") : preferred;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const parts = base.split("/");
    const last = parts.pop() ?? "command";
    parts.push(`${last}-${index}`);
    candidate = parts.join("/");
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function commandMarkdown(options: {
  extensionName: string;
  sourceRelPath: string;
  sourcePath: string;
  extensionDir: string;
  description?: string;
  prompt: string;
}): string {
  const description = options.description ?? `Gemini extension command from ${options.extensionName}`;
  return `---\ndescription: ${JSON.stringify(description)}\nsubtask: false\n---\n\n<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->\n<!-- ${EXTENSION_COMMAND_MARKER} -->\n<!-- Source extension: ${options.extensionName} -->\n<!-- Source command: ${options.sourceRelPath} -->\n<!-- Source file: ${options.sourcePath} -->\n\n${normalizeCommandPrompt(options.prompt, options.extensionDir)}\n`;
}

function parseGeminiAgentMarkdown(text: string): { description?: string; temperature?: number; maxSteps?: number; model?: string; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = match?.[1] ?? "";
  const body = match ? text.slice(match[0].length).trim() : text.trim();
  const description = parseQuotedValue(frontmatter.match(/^\s*description\s*:\s*([^\n]+)/m)?.[1]);
  const temperatureRaw = frontmatter.match(/^\s*temperature\s*:\s*([0-9.]+)/m)?.[1];
  const maxTurnsRaw = frontmatter.match(/^\s*max_turns\s*:\s*([0-9]+)/m)?.[1];
  const model = parseQuotedValue(frontmatter.match(/^\s*model\s*:\s*([^\n]+)/m)?.[1]);
  const temperature = temperatureRaw === undefined ? undefined : Number(temperatureRaw);
  const maxSteps = maxTurnsRaw === undefined ? undefined : Number(maxTurnsRaw);
  return {
    description,
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxSteps: Number.isInteger(maxSteps) ? maxSteps : undefined,
    model,
    body,
  };
}

const PROVIDER_RUNTIME_KEYS = [
  "variant",
  "reasoningEffort",
  "temperature",
  "top_p",
  "maxTokens",
  "textVerbosity",
  "thinking",
] as const;

function runtimeOptionObject(options: ModelRuntimeOptions, optionsForOutput: { includeVariant: boolean }): Record<string, unknown> {
  const providerOptions = runtimeOptionsForProvider(options);
  const out: Record<string, unknown> = {};
  for (const key of PROVIDER_RUNTIME_KEYS) {
    if (key === "variant" && !optionsForOutput.includeVariant) continue;
    const value = providerOptions[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function runtimeOptionYaml(options: ModelRuntimeOptions, indent: string, optionsForOutput: { includeVariant: boolean }): string[] {
  return Object.entries(runtimeOptionObject(options, optionsForOutput))
    .map(([key, value]) => `${indent}${key}: ${typeof value === "number" ? value : JSON.stringify(value)}`);
}

function hasRuntimeOptions(options: ModelRuntimeOptions, optionsForOutput: { includeVariant: boolean }): boolean {
  return Object.keys(runtimeOptionObject(options, optionsForOutput)).length > 0;
}

function fallbackEntryYaml(entry: ModelFallbackEntry): string[] {
  if (typeof entry === "string") return [`  - ${JSON.stringify(entry)}`];
  return [
    "  - model: " + JSON.stringify(entry.model),
    ...runtimeOptionYaml(entry, "    ", { includeVariant: false }),
  ];
}

function agentMarkdown(options: {
  extensionName: string;
  sourceRelPath: string;
  sourcePath: string;
  extensionDir: string;
  sourceText: string;
  fallback?: ResolvedAgentFallback;
  routing?: ModelRoutingDecision;
}): string {
  const parsed = parseGeminiAgentMarkdown(options.sourceText);
  const lines: string[] = [
    "---",
    `description: ${JSON.stringify(parsed.description ?? `Gemini extension subagent from ${options.extensionName}`)}`,
    "mode: subagent",
  ];
  const activeRuntime = options.routing?.selected ?? options.fallback;
  const model = activeRuntime?.model ?? options.fallback?.model ?? parsed.model;
  if (model) lines.push(`model: ${JSON.stringify(model)}`);
  if (activeRuntime) {
    lines.push(...runtimeOptionYaml(activeRuntime, "", { includeVariant: false }));
  }
  if (options.fallback?.fallbackModels.length) {
    lines.push("fallback_models:");
    for (const entry of options.fallback.fallbackModels) lines.push(...fallbackEntryYaml(entry));
  }
  if (options.fallback?.temperature === undefined && parsed.temperature !== undefined) lines.push(`temperature: ${parsed.temperature}`);
  if (parsed.maxSteps !== undefined) lines.push(`maxSteps: ${parsed.maxSteps}`);
  lines.push(
    "permission:",
    "  edit: ask",
    "  bash: ask",
    "  external_directory: ask",
    "---",
    "",
    "<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->",
    `<!-- ${EXTENSION_AGENT_MARKER} -->`,
    `<!-- Source extension: ${options.extensionName} -->`,
    `<!-- Source agent: ${options.sourceRelPath} -->`,
    `<!-- Source file: ${options.sourcePath} -->`,
    "",
    normalizeCommandPrompt(parsed.body, options.extensionDir),
    "",
  );
  return lines.join("\n");
}

function readInstallMetadata(extensionDir: string): GeminiExtensionInstallMetadata | undefined {
  const parsed = readJson(path.join(extensionDir, ".gemini-extension-install.json"));
  if (!parsed || typeof parsed !== "object") return undefined;
  return {
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    type: typeof parsed.type === "string" ? parsed.type : undefined,
    ref: typeof parsed.ref === "string" ? parsed.ref : undefined,
    autoUpdate: typeof parsed.autoUpdate === "boolean" ? parsed.autoUpdate : undefined,
  };
}

function collectDocs(extensionDir: string): Array<{ source: string }> {
  const docs: Array<{ source: string }> = [];
  const roots = ["README.md", "GEMINI.md", "docs", "knowledge"];
  for (const rel of roots) {
    const fullPath = path.join(extensionDir, rel);
    if (fileExists(fullPath)) docs.push({ source: rel });
    else if (dirExists(fullPath)) {
      for (const filePath of listFiles(fullPath).filter((item) => /\.(md|txt|json|toml)$/i.test(item))) {
        docs.push({ source: relativeTo(extensionDir, filePath) });
      }
    }
  }
  return docs.sort((a, b) => a.source.localeCompare(b.source));
}

function collectScripts(extensionDir: string): Array<{ source: string; projected: false; reason: string }> {
  return listFiles(extensionDir)
    .map((filePath) => relativeTo(extensionDir, filePath))
    .filter((relPath) => /(^|\/)(bin|scripts)\//.test(relPath) || /\.(sh|bash|zsh|ps1|bat|cmd|mjs|js|py)$/i.test(relPath))
    .filter((relPath) => !relPath.startsWith("skills/"))
    .map((source) => ({
      source,
      projected: false as const,
      reason: "Scripts can execute code; ogb maps them for review but does not copy them into OpenCode.",
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

function extensionMapEntry(extension: ExtensionRoot): GeminiExtensionMapEntry {
  const manifestPath = path.join(extension.dir, "gemini-extension.json");
  const warnings: string[] = [];
  if (!fileExists(manifestPath)) warnings.push("Missing gemini-extension.json");

  const commandFiles = listFiles(path.join(extension.dir, "commands")).filter((filePath) => filePath.endsWith(".toml"));
  const skillDirs = listDirs(path.join(extension.dir, "skills")).filter((dir) => fileExists(path.join(dir, "SKILL.md")));
  const agentFiles = listFiles(path.join(extension.dir, "agents")).filter((filePath) => filePath.endsWith(".md"));
  const hookFiles = listFiles(path.join(extension.dir, "hooks")).filter((filePath) => path.basename(filePath) === "hooks.json" || filePath.endsWith(".json"));

  return {
    name: extension.name,
    scope: extension.scope,
    path: extension.dir,
    manifestPath,
    manifestHash: fileExists(manifestPath) ? sha256File(manifestPath) : undefined,
    install: readInstallMetadata(extension.dir),
    commands: commandFiles.map((filePath) => ({
      name: path.basename(filePath, ".toml"),
      source: relativeTo(extension.dir, filePath),
      status: "parse_warning",
      message: "Not projected yet",
    })),
    skills: skillDirs.map((dir) => ({ name: path.basename(dir), source: relativeTo(extension.dir, dir) })),
    agents: agentFiles.map((filePath) => ({
      name: path.basename(filePath, ".md"),
      source: relativeTo(extension.dir, filePath),
      projected: false,
      reason: "Not projected yet.",
    })),
    hooks: hookFiles.map((filePath) => ({
      source: relativeTo(extension.dir, filePath),
      projected: false as const,
      reason: "Hooks can execute commands and require manual trust review.",
    })),
    scripts: collectScripts(extension.dir),
    docs: collectDocs(extension.dir),
    warnings,
  };
}

function removeStaleExtensionCommands(options: {
  projectRoot: string;
  state: ReturnType<typeof emptySyncState>;
  keep: Set<string>;
  backupSession: BackupSession;
  force?: boolean;
}): { removed: string[]; warnings: string[] } {
  const removed: string[] = [];
  const warnings: string[] = [];

  for (const file of [...options.state.managedFiles]) {
    if (file.source !== "ogb" || !file.path.startsWith(".opencode/commands/") || options.keep.has(file.path)) continue;
    const targetPath = path.join(options.projectRoot, file.path);
    if (!fileExists(targetPath)) {
      options.state.managedFiles = options.state.managedFiles.filter((item) => !(item.path === file.path && item.source === file.source));
      continue;
    }

    const text = fs.readFileSync(targetPath, "utf8");
    if (!text.includes(EXTENSION_COMMAND_MARKER)) continue;
    if (!options.force && sha256File(targetPath) !== file.sha256) {
      warnings.push(`Extension command conflict: ${file.path} was edited manually; leaving stale file in place`);
      continue;
    }

    options.backupSession.backupExisting(targetPath);
    fs.rmSync(targetPath, { force: true });
    options.state.managedFiles = options.state.managedFiles.filter((item) => !(item.path === file.path && item.source === file.source));
    removed.push(file.path);
  }

  return { removed, warnings };
}

function removeStaleExtensionAgents(options: {
  projectRoot: string;
  state: ReturnType<typeof emptySyncState>;
  keep: Set<string>;
  backupSession: BackupSession;
  force?: boolean;
}): { removed: string[]; warnings: string[] } {
  const removed: string[] = [];
  const warnings: string[] = [];

  for (const file of [...options.state.managedFiles]) {
    if (file.source !== "ogb" || !file.path.startsWith(".opencode/agents/") || options.keep.has(file.path)) continue;
    const targetPath = path.join(options.projectRoot, file.path);
    if (!fileExists(targetPath)) {
      options.state.managedFiles = options.state.managedFiles.filter((item) => !(item.path === file.path && item.source === file.source));
      continue;
    }

    const text = fs.readFileSync(targetPath, "utf8");
    if (!text.includes(EXTENSION_AGENT_MARKER)) continue;
    if (!options.force && sha256File(targetPath) !== file.sha256) {
      warnings.push(`Extension agent conflict: ${file.path} was edited manually; leaving stale file in place`);
      continue;
    }

    options.backupSession.backupExisting(targetPath);
    fs.rmSync(targetPath, { force: true });
    options.state.managedFiles = options.state.managedFiles.filter((item) => !(item.path === file.path && item.source === file.source));
    removed.push(file.path);
  }

  return { removed, warnings };
}

function writeOrRemoveOhMyOpenAgentConfig(options: {
  projectRoot: string;
  targetPath: string;
  state: ReturnType<typeof emptySyncState>;
  content?: string;
  backupSession: BackupSession;
  force?: boolean;
  dryRun?: boolean;
}): { projected?: string; warning?: string } {
  const relPath = ".opencode/oh-my-openagent.jsonc";
  if (options.dryRun) return { projected: options.content ? relPath : undefined };

  const exists = fileExists(options.targetPath);
  const previousHash = managedHashFor(options.state, relPath, "ogb");

  if (!options.content) {
    if (!exists) return {};
    if (previousHash && (!options.force && sha256File(options.targetPath) !== previousHash)) {
      return { warning: `${relPath} was edited manually; leaving stale Oh My OpenAgent config in place` };
    }
    if (previousHash || options.force) {
      options.backupSession.backupExisting(options.targetPath);
      fs.rmSync(options.targetPath, { force: true });
      options.state.managedFiles = options.state.managedFiles.filter((file) => !(file.path === relPath && file.source === "ogb"));
    }
    return {};
  }

  if (exists && !options.force) {
    const currentHash = sha256File(options.targetPath);
    if (previousHash !== currentHash) {
      return { warning: `${relPath} exists or was edited manually; use --force to overwrite` };
    }
  }

  if (exists) options.backupSession.backupExisting(options.targetPath);
  fs.mkdirSync(path.dirname(options.targetPath), { recursive: true });
  fs.writeFileSync(options.targetPath, options.content, "utf8");
  upsertManagedFile(options.state, {
    path: relPath,
    sha256: sha256File(options.targetPath),
    source: "ogb",
  });
  return { projected: relPath };
}

export function projectGeminiExtensionCommands(options: ExtensionProjectionOptions = {}): ProjectExtensionCommandsResult {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const backupSession = createBackupSession({
    bridgeConfigDir: paths.bridgeConfigDir,
    operation: "extension-projection",
    roots: [
      { root: paths.projectRoot, prefix: "project" },
      { root: paths.homeDir, prefix: "home" },
    ],
    dryRun: options.dryRun,
  });
  const roots = uniqueExtensionRoots(paths.projectRoot, paths.homeDir);
  const ogbConfig = readOgbConfig(paths.projectRoot, paths.homeDir);
  const routing = createModelRoutingContext({
    projectRoot: paths.projectRoot,
    limitsPath: paths.limitsPath,
    enabled: ogbConfig.modelFallbacks?.routing?.enabled,
    thresholdPercent: ogbConfig.modelFallbacks?.routing?.thresholdPercent,
  });
  const usedCommandNames = new Set<string>(BUILT_IN_COMMANDS.map((command) => command.name));
  const projectedCommands: string[] = [];
  const projectedAgents: string[] = [];
  const modelFallbacks: GeminiExtensionProjectionMap["modelFallbacks"] = [];
  const warnings: string[] = [];
  const state = readSyncState(paths.projectRoot) ?? emptySyncState(OGB_VERSION);
  const keep = new Set<string>();
  const keepAgents = new Set<string>();

  const extensions = roots.map((extension) => {
    const entry = extensionMapEntry(extension);
    const commandsRoot = path.join(extension.dir, "commands");
    const commandFiles = listFiles(commandsRoot).filter((filePath) => filePath.endsWith(".toml"));
    entry.commands = [];

    for (const filePath of commandFiles) {
      const sourceRelPath = relativeTo(extension.dir, filePath);
      const commandRelPath = relativeTo(commandsRoot, filePath);
      const parsed = parseGeminiCommandToml(fs.readFileSync(filePath, "utf8"));
      const commandName = extensionCommandName(extension.name, commandRelPath, usedCommandNames);
      const relPath = `.opencode/commands/${commandName}.md`;
      const targetPath = path.join(paths.projectRoot, relPath);
      keep.add(relPath);

      const projection: GeminiExtensionCommandProjection = {
        name: commandName,
        source: sourceRelPath,
        target: relPath,
        description: parsed.description,
        status: parsed.warnings.length > 0 ? "parse_warning" : "projected",
        message: parsed.warnings.length > 0 ? parsed.warnings.join("; ") : undefined,
      };
      entry.commands.push(projection);
      if (parsed.warnings.length > 0) warnings.push(`Extension command parse warning: ${extension.name}/${sourceRelPath} - ${parsed.warnings.join("; ")}`);

      if (options.dryRun) {
        projectedCommands.push(relPath);
        continue;
      }

      const content = commandMarkdown({
        extensionName: extension.name,
        sourceRelPath,
        sourcePath: filePath,
        extensionDir: extension.dir,
        description: parsed.description,
        prompt: parsed.prompt,
      });
      const previousHash = managedHashFor(state, relPath, "ogb");
      const contentHash = sha256Text(content);
      if (fileExists(targetPath) && sha256File(targetPath) === contentHash) {
        upsertManagedFile(state, {
          path: relPath,
          sha256: contentHash,
          source: "ogb",
        });
        projectedCommands.push(relPath);
        continue;
      }
      if (fileExists(targetPath) && !options.force) {
        const currentHash = sha256File(targetPath);
        if (previousHash !== currentHash) {
          projection.status = "conflict";
          projection.message = `${relPath} exists or was edited manually; use --force to overwrite`;
          warnings.push(`Extension command conflict: ${projection.message}`);
          continue;
        }
      }

      if (fileExists(targetPath)) backupSession.backupExisting(targetPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");
      upsertManagedFile(state, {
        path: relPath,
        sha256: contentHash,
        source: "ogb",
      });
      projectedCommands.push(relPath);
    }

    for (const agentFile of listFiles(path.join(extension.dir, "agents")).filter((filePath) => filePath.endsWith(".md"))) {
      const sourceRelPath = relativeTo(extension.dir, agentFile);
      const agentName = safeSegment(path.basename(agentFile, ".md"));
      const sourceText = fs.readFileSync(agentFile, "utf8");
      const parsedAgent = parseGeminiAgentMarkdown(sourceText);
      const fallback = resolveAgentFallback({
        config: ogbConfig,
        extensionName: extension.name,
        agentName,
        importedModel: parsedAgent.model,
      });
      const routingDecision = routing.decide(fallback);
      const relPath = `.opencode/agents/${agentName}.md`;
      const targetPath = path.join(paths.projectRoot, relPath);
      keepAgents.add(relPath);
      const mapAgent = entry.agents.find((item) => item.source === sourceRelPath);
      if (mapAgent) {
        mapAgent.name = agentName;
        mapAgent.target = relPath;
        mapAgent.projected = true;
        mapAgent.reason = undefined;
        mapAgent.status = "projected";
        if (fallback.source !== "none" || fallback.importedModel) mapAgent.modelFallback = fallback;
      }
      if (fallback.source !== "none" && (fallback.fallbackModels.length > 0 || fallback.model || hasRuntimeOptions(fallback, { includeVariant: true }))) {
        modelFallbacks.push({
          agent: agentName,
          extension: extension.name,
          model: fallback.model,
          ...runtimeOptionObject(fallback, { includeVariant: true }),
          fallback_models: fallback.fallbackModels,
          source: fallback.source,
        });
      }

      if (options.dryRun) {
        projectedAgents.push(relPath);
        continue;
      }

      const content = agentMarkdown({
        extensionName: extension.name,
        sourceRelPath,
        sourcePath: agentFile,
        extensionDir: extension.dir,
        sourceText,
        fallback,
        routing: routingDecision,
      });
      const previousHash = managedHashFor(state, relPath, "ogb");
      const contentHash = sha256Text(content);
      if (fileExists(targetPath) && sha256File(targetPath) === contentHash) {
        upsertManagedFile(state, {
          path: relPath,
          sha256: contentHash,
          source: "ogb",
        });
        projectedAgents.push(relPath);
        continue;
      }
      if (fileExists(targetPath) && !options.force) {
        const currentHash = sha256File(targetPath);
        if (previousHash !== currentHash) {
          if (mapAgent) {
            mapAgent.projected = false;
            mapAgent.reason = `${relPath} exists or was edited manually; use --force to overwrite`;
            mapAgent.status = "conflict";
          }
          warnings.push(`Extension agent conflict: ${relPath} exists or was edited manually; use --force to overwrite`);
          continue;
        }
      }

      if (fileExists(targetPath)) backupSession.backupExisting(targetPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");
      upsertManagedFile(state, {
        path: relPath,
        sha256: contentHash,
        source: "ogb",
      });
      projectedAgents.push(relPath);
    }

    entry.commands.sort((a, b) => a.source.localeCompare(b.source));
    entry.agents.sort((a, b) => a.source.localeCompare(b.source));
    return entry;
  });

  const stale = options.dryRun
    ? { removed: [], warnings: [] }
    : removeStaleExtensionCommands({ projectRoot: paths.projectRoot, state, keep, backupSession, force: options.force });
  warnings.push(...stale.warnings);
  const staleAgents = options.dryRun
    ? { removed: [], warnings: [] }
    : removeStaleExtensionAgents({ projectRoot: paths.projectRoot, state, keep: keepAgents, backupSession, force: options.force });
  warnings.push(...staleAgents.warnings);

  const ohMyConfig = writeOrRemoveOhMyOpenAgentConfig({
    projectRoot: paths.projectRoot,
    targetPath: paths.ohMyOpenAgentConfigPath,
    state,
    content: undefined,
    backupSession,
    force: options.force,
    dryRun: options.dryRun,
  });
  if (ohMyConfig.warning) warnings.push(ohMyConfig.warning);
  if (routing.report.warnings.length > 0) warnings.push(...routing.report.warnings.map((warning) => `Model routing: ${warning}`));
  warnings.push(...backupSession.retention.warnings);
  const reportWarnings = [...new Set(warnings)];

  const map: GeminiExtensionProjectionMap = {
    _generated: {
      tool: "ogb",
      version: OGB_VERSION,
      warning: "DO NOT EDIT. Regenerate with ogb sync.",
    },
    projectRoot: paths.projectRoot,
    generatedAt: new Date().toISOString(),
    extensions,
    projectedCommands,
    projectedAgents,
    modelFallbacks,
    removedCommands: stale.removed,
    removedAgents: staleAgents.removed,
    warnings: reportWarnings,
  };

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(paths.extensionMapPath), { recursive: true });
    fs.writeFileSync(paths.extensionMapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
    upsertManagedFile(state, {
      path: ".opencode/generated/ogb-extension-map.json",
      sha256: sha256File(paths.extensionMapPath),
      source: "ogb",
    });
    writeModelRoutingReport(paths.modelRoutingPath, routing.report);
    upsertManagedFile(state, {
      path: ".opencode/generated/ogb-model-routing.json",
      sha256: sha256File(paths.modelRoutingPath),
      source: "ogb",
    });
    writeSyncState(state, paths.projectRoot);
  }

  return {
    projectedCommands,
    projectedAgents,
    removedCommands: stale.removed,
    removedAgents: staleAgents.removed,
    projectedModelFallbackConfig: ohMyConfig.projected,
    projectedModelRoutingConfig: options.dryRun ? ".opencode/generated/ogb-model-routing.json" : ".opencode/generated/ogb-model-routing.json",
    map,
    backups: backupSession.backups,
    warnings: reportWarnings,
  };
}
