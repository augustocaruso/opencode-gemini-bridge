import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify as modifyJsonc, parse as parseJsonc, type ParseError } from "jsonc-parser";
import { createBackupSession, type BackupRecord, type BackupSession } from "./backup-policy.js";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS, REMOVED_BUILT_IN_AGENT_NAMES, REMOVED_BUILT_IN_COMMAND_NAMES, type BuiltInTextFile } from "./built-ins.js";
import {
  parseGeminiCommandToml,
  projectGeminiExtensionCommands,
  type GeminiExtensionCommandProjection,
  type GeminiExtensionInstallMetadata,
  type GeminiExtensionMapEntry,
  type GeminiExtensionProjectionMap,
} from "./extension-projection.js";
import { externalOpenCodePlugins, externalTuiPlugins, projectExternalIntegrations } from "./external-integrations.js";
import { buildInventory } from "./inventory.js";
import { syncMcpEnvStore } from "./mcp-env-store.js";
import { projectOpenCodeMcpFromGeminiServers } from "./mcp-projection.js";
import {
  defaultOpenCodeAgent,
  readOgbConfig,
  resolveAgentFallback,
  runtimeOptionsForProvider,
  type ModelFallbackEntry,
  type ModelRuntimeOptions,
  type ResolvedAgentFallback,
} from "./ogb-config.js";
import { createModelRoutingContext, writeModelRoutingReport, type ModelRoutingDecision } from "./model-routing.js";
import { defaultGeminiInput, resolveProjectPaths } from "./paths.js";
import { ensureProjectConfig } from "./project-config.js";
import { projectRulesyncProjection, type RulesyncMode, type RulesyncProjectionResult } from "./rulesync.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState } from "./sync-state.js";
import { ensureTuiSidebar } from "./tui-sidebar.js";
import { OGB_VERSION, type GeminiMcpServer } from "./types.js";
import { sha256File, sha256Text } from "./file-hash.js";
import { flattenGeminiMd } from "./flatten.js";
import { globalOpenCodeConfigDir } from "./opencode-paths.js";

export interface SyncOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  silent?: boolean;
  rulesyncMode?: RulesyncMode;
  rulesyncFeatures?: string[];
}

export interface SyncReport {
  version: string;
  projectRoot: string;
  generatedConfigPath: string;
  projectedAgents: string[];
  projectedExtensionAgents: string[];
  projectedModelFallbackConfig?: string;
  projectedModelRoutingConfig?: string;
  removedAgents: string[];
  projectedCommands: string[];
  projectedExtensionCommands: string[];
  removedExtensionCommands: string[];
  projectedSkills: string[];
  removedSkills: string[];
  projectedAntigravitySkills: string[];
  removedAntigravitySkills: string[];
  projectedAntigravityAgents: string[];
  removedAntigravityAgents: string[];
  projectedAntigravityWorkflows: string[];
  removedAntigravityWorkflows: string[];
  projectedAntigravityMcps: string[];
  removedAntigravityMcps: string[];
  projectedTuiFiles: string[];
  projectedExternalPlugins: string[];
  projectedExternalIntegrationFiles: string[];
  rulesync: RulesyncProjectionResult;
  backups: BackupRecord[];
  warnings: string[];
}

function generatedOpenCodeConfig(projectRoot: string, homeDir?: string) {
  const projectedMcp = openCodeMcpFromInventory(projectRoot, homeDir);

  return {
    config: {
      $schema: "https://opencode.ai/config.json",
      _generated: {
        tool: "ogb",
        version: OGB_VERSION,
        warning: "DO NOT EDIT. Regenerate with ogb sync.",
      },
      instructions: [".opencode/generated/GEMINI.expanded.md"],
      mcp: projectedMcp.mcp,
    },
    warnings: projectedMcp.warnings,
  };
}

function openCodeMcpFromInventory(projectRoot: string, homeDir?: string): {
  mcp: Record<string, unknown>;
  warnings: string[];
} {
  const inv = buildInventory({ projectRoot, homeDir });
  return projectOpenCodeMcpFromGeminiServers(inv.mcps);
}

function expandedContentBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.startsWith("<!-- OGB BEGIN:") || line.startsWith("<!-- OGB: Missing import:"));
  return (markerIndex >= 0 ? lines.slice(markerIndex) : lines).join("\n").trim();
}

function pathIsInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function extensionDirForPath(filePath: string, projectRoot: string, homeDir: string): string | undefined {
  for (const extensionsRoot of [
    path.join(projectRoot, ".gemini", "extensions"),
    path.join(homeDir, ".gemini", "extensions"),
  ]) {
    if (!pathIsInside(extensionsRoot, filePath)) continue;
    const [extensionName] = path.relative(extensionsRoot, filePath).split(path.sep);
    if (extensionName) return path.join(extensionsRoot, extensionName);
  }
  return undefined;
}

function resolveExtensionPlaceholders(text: string, extensionDir: string): string {
  return text
    .replaceAll("${extensionPath}", extensionDir)
    .replaceAll("${/}", path.sep);
}

function expandedGeminiContextContent(options: { projectRoot: string; homeDir: string; inputs: string[] }): string {
  const sections = options.inputs.map((input) => {
    const section = flattenGeminiMd({
      input,
      write: false,
      homeDir: options.homeDir,
    });
    const extensionDir = extensionDirForPath(input, options.projectRoot, options.homeDir);
    return extensionDir
      ? { ...section, content: resolveExtensionPlaceholders(section.content, extensionDir) }
      : section;
  });
  const header = [
    "# GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT.",
    "",
    `Generator: ogb ${OGB_VERSION}`,
    "Sources:",
    ...options.inputs.map((input) => `- ${input}`),
    "",
  ].join("\n");
  return `${header}${sections.map((section) => expandedContentBody(section.content)).join("\n\n")}\n`;
}

function writeExpandedGeminiContext(options: { projectRoot: string; homeDir: string; output: string; inputs?: string[]; dryRun?: boolean }): string {
  const inventory = options.inputs ? undefined : buildInventory({ projectRoot: options.projectRoot, homeDir: options.homeDir });
  const inputs = options.inputs
    ?? ((inventory?.geminiFiles.length ?? 0) > 0
      ? inventory!.geminiFiles
      : [defaultGeminiInput(options.projectRoot, options.homeDir)]);
  const content = expandedGeminiContextContent({
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    inputs,
  });

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, content, "utf8");
  }
  return content;
}

function safeSkillTargetName(name: string, used: Set<string>, extensionName: string): string {
  if (!used.has(name)) return name;
  let candidate = `${extensionName}-${name}`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${extensionName}-${name}-${index}`;
    index += 1;
  }
  return candidate;
}

function listGeminiExtensionSkillDirs(homeDir: string): Array<{ extensionName: string; skillName: string; sourceDir: string }> {
  const extensionsRoot = path.join(homeDir, ".gemini", "extensions");
  if (!fs.existsSync(extensionsRoot)) return [];

  const out: Array<{ extensionName: string; skillName: string; sourceDir: string }> = [];
  for (const extensionName of fs.readdirSync(extensionsRoot).sort()) {
    const skillsRoot = path.join(extensionsRoot, extensionName, "skills");
    if (!fs.existsSync(skillsRoot)) continue;
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const sourceDir = path.join(skillsRoot, entry.name);
      if (!fs.existsSync(path.join(sourceDir, "SKILL.md"))) continue;
      out.push({ extensionName, skillName: entry.name, sourceDir });
    }
  }
  return out;
}

function isTextProjectionFile(filePath: string): boolean {
  if (path.basename(filePath) === "SKILL.md") return true;
  return /\.(md|mdx|txt|json|jsonc|toml|ya?ml|xml|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|sh|bash|zsh|ps1|bat|cmd)$/i.test(filePath);
}

function copyDir(src: string, dst: string, extensionDir: string): void {
  fs.rmSync(dst, { recursive: true, force: true });
  function copyEntry(sourcePath: string, targetPath: string): void {
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      for (const entry of fs.readdirSync(sourcePath).sort()) {
        copyEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
      }
      return;
    }
    if (!stat.isFile()) return;

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (isTextProjectionFile(sourcePath)) {
      const content = resolveExtensionPlaceholders(fs.readFileSync(sourcePath, "utf8"), extensionDir);
      fs.writeFileSync(targetPath, content, "utf8");
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }

  copyEntry(src, dst);
}

function projectedDirMatchesSource(options: { sourceDir: string; targetDir: string; sourceBaseDir: string }): boolean {
  if (!dirExists(options.targetDir)) return false;

  const sourceFiles = listFilesRecursive(options.sourceDir).map((filePath) => relativeTo(options.sourceDir, filePath)).sort();
  const targetFiles = listFilesRecursive(options.targetDir).map((filePath) => relativeTo(options.targetDir, filePath)).sort();
  if (sourceFiles.length !== targetFiles.length) return false;

  for (let index = 0; index < sourceFiles.length; index += 1) {
    if (sourceFiles[index] !== targetFiles[index]) return false;
  }

  for (const relFile of sourceFiles) {
    const sourcePath = path.join(options.sourceDir, ...relFile.split("/"));
    const targetPath = path.join(options.targetDir, ...relFile.split("/"));
    if (!fileExists(targetPath)) return false;

    if (isTextProjectionFile(sourcePath)) {
      const projected = resolveExtensionPlaceholders(fs.readFileSync(sourcePath, "utf8"), options.sourceBaseDir);
      if (fs.readFileSync(targetPath, "utf8") !== projected) return false;
      continue;
    }

    if (sha256File(sourcePath) !== sha256File(targetPath)) return false;
  }

  return true;
}

const GLOBAL_OPENCODE_PREFIX = ".config/opencode";
const GLOBAL_ANTIGRAVITY_PREFIX = ".gemini/antigravity";
const ANTIGRAVITY_MCP_CONFIG_REL_PATH = `${GLOBAL_ANTIGRAVITY_PREFIX}/mcp_config.json`;
const GLOBAL_COMMAND_MARKER = "SOURCE_KIND: gemini-global-command";
const GLOBAL_EXTENSION_COMMAND_MARKER = "SOURCE_KIND: gemini-global-extension-command";
const GLOBAL_AGENT_MARKER = "SOURCE_KIND: gemini-global-agent";
const GLOBAL_EXTENSION_AGENT_MARKER = "SOURCE_KIND: gemini-global-extension-agent";
const ANTIGRAVITY_AGENT_MARKER = "SOURCE_KIND: gemini-antigravity-agent";

interface GlobalExtensionRoot {
  name: string;
  scope: "global";
  dir: string;
}

interface GlobalExtensionCommandMapItem extends GeminiExtensionCommandProjection {
  extensionName: string;
}

interface GlobalExtensionAgentMapItem {
  extensionName: string;
  name: string;
  source: string;
  target?: string;
  projected: boolean;
  reason?: string;
  status?: "projected" | "conflict";
  modelFallback?: ResolvedAgentFallback;
}

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

function globalGeminiContextInputs(homeDir: string): string[] {
  const inputs: string[] = [];
  const rootGemini = path.join(homeDir, ".gemini", "GEMINI.md");
  if (fileExists(rootGemini)) inputs.push(rootGemini);

  const extensionsRoot = path.join(homeDir, ".gemini", "extensions");
  if (dirExists(extensionsRoot)) {
    for (const extensionName of fs.readdirSync(extensionsRoot).sort()) {
      const geminiMd = path.join(extensionsRoot, extensionName, "GEMINI.md");
      if (fileExists(geminiMd)) inputs.push(geminiMd);
    }
  }

  return inputs;
}

function toPosix(input: string): string {
  return input.split(path.sep).join("/");
}

function globalOpenCodeRelPath(relPath: string): string {
  return `${GLOBAL_OPENCODE_PREFIX}/${toPosix(relPath)}`;
}

function globalExpandedInstructionRef(globalRoot: string, expandedPath: string): string {
  const relPath = path.relative(globalRoot, path.resolve(expandedPath));
  if (!relPath || path.isAbsolute(relPath)) return path.resolve(expandedPath);
  return toPosix(relPath);
}

function isManagedGlobalInstructionRef(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized === "../opencode-gemini-bridge/generated/GEMINI.expanded.md"
    || normalized === "~/.config/opencode-gemini-bridge/generated/GEMINI.expanded.md"
    || normalized.endsWith("/.config/opencode-gemini-bridge/generated/GEMINI.expanded.md");
}

function globalAntigravityRelPath(relPath: string): string {
  return `${GLOBAL_ANTIGRAVITY_PREFIX}/${toPosix(relPath)}`;
}

function globalTargetPath(globalRoot: string, relPath: string): string {
  return path.join(globalRoot, ...toPosix(relPath).split("/"));
}

function targetPathFromReportPath(root: string, reportPath: string): string {
  return path.join(root, ...toPosix(reportPath).split("/"));
}

function globalConfigPath(globalRoot: string): string {
  const jsonPath = path.join(globalRoot, "opencode.json");
  const jsoncPath = path.join(globalRoot, "opencode.jsonc");
  if (fs.existsSync(jsonPath)) return jsonPath;
  if (fs.existsSync(jsoncPath)) return jsoncPath;
  return jsonPath;
}

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function relativeTo(root: string, filePath: string): string {
  return toPosix(path.relative(root, filePath));
}

function listFilesRecursive(root: string): string[] {
  if (!dirExists(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(fullPath));
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

function listDirs(root: string): string[] {
  if (!dirExists(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function safeGlobalSegment(input: string): string {
  return input
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "item";
}

function commandRelFromSource(root: string, sourcePath: string): string {
  const relPath = toPosix(path.relative(root, sourcePath));
  const extension = path.extname(relPath);
  const withoutExtension = extension ? relPath.slice(0, -extension.length) : relPath;
  const segments = withoutExtension.split("/").map(safeGlobalSegment).filter(Boolean);
  return `commands/${segments.join("/")}.md`;
}

function agentRelFromSource(root: string, sourcePath: string): string {
  const relPath = toPosix(path.relative(root, sourcePath));
  const extension = path.extname(relPath);
  const withoutExtension = extension ? relPath.slice(0, -extension.length) : relPath;
  const segments = withoutExtension.split("/").map(safeGlobalSegment).filter(Boolean);
  return `agents/${segments.join("/")}.md`;
}

function uniqueGlobalCommandRelPath(preferredRelPath: string, used: Set<string>, prefix?: string): string {
  const normalized = toPosix(preferredRelPath);
  const commandRel = normalized.startsWith("commands/") ? normalized.slice("commands/".length) : normalized;
  const preferred = normalized.startsWith("commands/") ? normalized : `commands/${commandRel}`;
  let candidate = preferred;
  if (used.has(candidate) && prefix) candidate = `commands/${safeGlobalSegment(prefix)}/${commandRel}`;

  const base = candidate;
  let index = 2;
  while (used.has(candidate)) {
    const extension = path.extname(base);
    const withoutExtension = extension ? base.slice(0, -extension.length) : base;
    candidate = `${withoutExtension}-${index}${extension}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function uniqueGlobalAgentRelPath(preferredRelPath: string, used: Set<string>, prefix?: string): string {
  const normalized = toPosix(preferredRelPath);
  const agentRel = normalized.startsWith("agents/") ? normalized.slice("agents/".length) : normalized;
  const preferred = normalized.startsWith("agents/") ? normalized : `agents/${agentRel}`;
  let candidate = preferred;
  if (used.has(candidate) && prefix) candidate = `agents/${safeGlobalSegment(prefix)}/${agentRel}`;

  const base = candidate;
  let index = 2;
  while (used.has(candidate)) {
    const extension = path.extname(base);
    const withoutExtension = extension ? base.slice(0, -extension.length) : base;
    candidate = `${withoutExtension}-${index}${extension}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function parseMarkdownCommand(text: string, fallbackDescription: string): { description: string; prompt: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { description: fallbackDescription, prompt: text.trim() };

  const frontmatter = match[1] ?? "";
  const descriptionMatch = frontmatter.match(/^\s*description\s*:\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n]+)/m);
  const rawDescription = descriptionMatch?.[1]?.trim();
  let description = fallbackDescription;
  if (rawDescription?.startsWith("\"")) {
    try {
      description = JSON.parse(rawDescription) as string;
    } catch {
      description = rawDescription.slice(1, rawDescription.endsWith("\"") ? -1 : undefined);
    }
  } else if (rawDescription?.startsWith("'")) {
    description = rawDescription.slice(1, rawDescription.endsWith("'") ? -1 : undefined);
  } else if (rawDescription) {
    description = rawDescription;
  }

  return { description, prompt: text.slice(match[0].length).trim() };
}

function normalizeGlobalCommandPrompt(prompt: string, extensionDir?: string): string {
  let out = prompt.replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS");
  if (extensionDir) {
    out = resolveExtensionPlaceholders(out, extensionDir);
  }
  return out.trim();
}

function globalCommandMarkdown(options: {
  description: string;
  prompt: string;
  sourcePath: string;
  sourceRelPath: string;
  marker: string;
  extensionName?: string;
  extensionDir?: string;
}): string {
  const sourceLines = options.extensionName
    ? [
        `<!-- Source extension: ${options.extensionName} -->`,
        `<!-- Source command: ${options.sourceRelPath} -->`,
      ]
    : [`<!-- Source command: ${options.sourceRelPath} -->`];

  return [
    "---",
    `description: ${JSON.stringify(options.description)}`,
    "subtask: false",
    "---",
    "",
    "<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->",
    `<!-- ${options.marker} -->`,
    ...sourceLines,
    `<!-- Source file: ${options.sourcePath} -->`,
    "",
    normalizeGlobalCommandPrompt(options.prompt, options.extensionDir),
    "",
  ].join("\n");
}

function parseMarkdownAgent(text: string, fallbackDescription: string): { description: string; body: string; model?: string; temperature?: number; maxSteps?: number } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { description: fallbackDescription, body: text.trim() };

  const frontmatter = match[1] ?? "";
  const parsed = parseMarkdownCommand(text, fallbackDescription);
  const modelRaw = frontmatter.match(/^\s*model\s*:\s*("[^"\n]*(?:\\.[^"\n]*)*"|'[^'\n]*'|[^\n]+)/m)?.[1]?.trim();
  const temperatureRaw = frontmatter.match(/^\s*temperature\s*:\s*([0-9.]+)/m)?.[1];
  const maxTurnsRaw = frontmatter.match(/^\s*max_turns\s*:\s*([0-9]+)/m)?.[1]
    ?? frontmatter.match(/^\s*maxSteps\s*:\s*([0-9]+)/m)?.[1];
  let model: string | undefined;
  if (modelRaw?.startsWith("\"")) {
    try {
      model = JSON.parse(modelRaw) as string;
    } catch {
      model = modelRaw.slice(1, modelRaw.endsWith("\"") ? -1 : undefined);
    }
  } else if (modelRaw?.startsWith("'")) {
    model = modelRaw.slice(1, modelRaw.endsWith("'") ? -1 : undefined);
  } else {
    model = modelRaw;
  }
  const temperature = temperatureRaw === undefined ? undefined : Number(temperatureRaw);
  const maxSteps = maxTurnsRaw === undefined ? undefined : Number(maxTurnsRaw);

  return {
    description: parsed.description,
    body: parsed.prompt,
    model,
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxSteps: Number.isInteger(maxSteps) ? maxSteps : undefined,
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

function runtimeOptionObject(options: ModelRuntimeOptions, output: { includeVariant: boolean }): Record<string, unknown> {
  const providerOptions = runtimeOptionsForProvider(options);
  const out: Record<string, unknown> = {};
  for (const key of PROVIDER_RUNTIME_KEYS) {
    if (key === "variant" && !output.includeVariant) continue;
    const value = providerOptions[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function runtimeOptionYaml(options: ModelRuntimeOptions, indent: string, output: { includeVariant: boolean }): string[] {
  return Object.entries(runtimeOptionObject(options, output))
    .map(([key, value]) => `${indent}${key}: ${typeof value === "number" ? value : JSON.stringify(value)}`);
}

function hasRuntimeOptions(options: ModelRuntimeOptions, output: { includeVariant: boolean }): boolean {
  return Object.keys(runtimeOptionObject(options, output)).length > 0;
}

function fallbackEntryYaml(entry: ModelFallbackEntry): string[] {
  if (typeof entry === "string") return [`  - ${JSON.stringify(entry)}`];
  return [
    "  - model: " + JSON.stringify(entry.model),
    ...runtimeOptionYaml(entry, "    ", { includeVariant: false }),
  ];
}

function fallbackHasRoutingSurface(fallback: ResolvedAgentFallback): boolean {
  return fallback.source !== "none"
    || Boolean(fallback.importedModel)
    || Boolean(fallback.model)
    || fallback.fallbackModels.length > 0
    || hasRuntimeOptions(fallback, { includeVariant: true });
}

function globalAgentMarkdown(options: {
  description: string;
  body: string;
  sourcePath: string;
  sourceRelPath: string;
  marker: string;
  extensionName?: string;
  extensionDir?: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  fallback?: ResolvedAgentFallback;
  routing?: ModelRoutingDecision;
}): string {
  const activeRuntime = options.routing?.selected ?? options.fallback;
  const model = activeRuntime?.model ?? options.fallback?.model ?? options.model;
  const lines: string[] = [
    "---",
    `description: ${JSON.stringify(options.description)}`,
    "mode: subagent",
  ];
  if (model) lines.push(`model: ${JSON.stringify(model)}`);
  if (activeRuntime) lines.push(...runtimeOptionYaml(activeRuntime, "", { includeVariant: false }));
  if (options.fallback?.fallbackModels.length) {
    lines.push("fallback_models:");
    for (const entry of options.fallback.fallbackModels) lines.push(...fallbackEntryYaml(entry));
  }
  if (options.temperature !== undefined && activeRuntime?.temperature === undefined) lines.push(`temperature: ${options.temperature}`);
  if (options.maxSteps !== undefined) lines.push(`maxSteps: ${options.maxSteps}`);
  lines.push(
    "permission:",
    "  read: allow",
    "  edit: allow",
    "  external_directory: allow",
    "  bash: ask",
    "---",
    "",
    "<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->",
    `<!-- ${options.marker} -->`,
  );
  if (options.extensionName) lines.push(`<!-- Source extension: ${options.extensionName} -->`);
  lines.push(
    `<!-- Source agent: ${options.sourceRelPath} -->`,
    `<!-- Source file: ${options.sourcePath} -->`,
    "",
    normalizeGlobalCommandPrompt(options.body, options.extensionDir),
    "",
  );
  return lines.join("\n");
}

function listGlobalExtensionRoots(homeDir: string): GlobalExtensionRoot[] {
  const extensionsRoot = path.join(homeDir, ".gemini", "extensions");
  return listDirs(extensionsRoot)
    .map((dir) => ({ name: path.basename(dir), scope: "global" as const, dir }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

function collectExtensionDocs(extensionDir: string): Array<{ source: string }> {
  const docs: Array<{ source: string }> = [];
  for (const rel of ["README.md", "GEMINI.md", "docs", "knowledge"]) {
    const fullPath = path.join(extensionDir, rel);
    if (fileExists(fullPath)) {
      docs.push({ source: rel });
    } else if (dirExists(fullPath)) {
      for (const filePath of listFilesRecursive(fullPath).filter((item) => /\.(md|txt|json|toml)$/i.test(item))) {
        docs.push({ source: relativeTo(extensionDir, filePath) });
      }
    }
  }
  return docs.sort((a, b) => a.source.localeCompare(b.source));
}

function collectExtensionScripts(extensionDir: string): Array<{ source: string; projected: false; reason: string }> {
  return listFilesRecursive(extensionDir)
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

function globalCommandNameFromRelPath(relPath: string): string {
  const withoutPrefix = relPath.startsWith("commands/") ? relPath.slice("commands/".length) : relPath;
  const extension = path.posix.extname(withoutPrefix);
  return extension ? withoutPrefix.slice(0, -extension.length) : withoutPrefix;
}

function globalAgentNameFromRelPath(relPath: string): string {
  const withoutPrefix = relPath.startsWith("agents/") ? relPath.slice("agents/".length) : relPath;
  const extension = path.posix.extname(withoutPrefix);
  return path.posix.basename(extension ? withoutPrefix.slice(0, -extension.length) : withoutPrefix);
}

function extensionMapEntry(options: {
  extension: GlobalExtensionRoot;
  commandBySource: Map<string, GlobalExtensionCommandMapItem>;
  agentBySource: Map<string, GlobalExtensionAgentMapItem>;
}): GeminiExtensionMapEntry {
  const extension = options.extension;
  const manifestPath = path.join(extension.dir, "gemini-extension.json");
  const warnings: string[] = [];
  if (!fileExists(manifestPath)) warnings.push("Missing gemini-extension.json");

  const commandFiles = listFilesRecursive(path.join(extension.dir, "commands")).filter((filePath) => filePath.endsWith(".toml"));
  const agentFiles = listFilesRecursive(path.join(extension.dir, "agents")).filter((filePath) => filePath.endsWith(".md"));
  const skillDirs = listDirs(path.join(extension.dir, "skills")).filter((dir) => fileExists(path.join(dir, "SKILL.md")));
  const hookFiles = listFilesRecursive(path.join(extension.dir, "hooks")).filter((filePath) => path.basename(filePath) === "hooks.json" || filePath.endsWith(".json"));

  return {
    name: extension.name,
    scope: extension.scope,
    path: extension.dir,
    manifestPath,
    manifestHash: fileExists(manifestPath) ? sha256File(manifestPath) : undefined,
    install: readInstallMetadata(extension.dir),
    commands: commandFiles.map((filePath) => {
      const source = relativeTo(extension.dir, filePath);
      const projected = options.commandBySource.get(`${extension.name}\0${source}`);
      return projected
        ? {
            name: projected.name,
            source,
            target: projected.target,
            description: projected.description,
            status: projected.status,
            message: projected.message,
          }
        : {
            name: path.basename(filePath, ".toml"),
            source,
            status: "parse_warning" as const,
            message: "Not projected yet",
          };
    }).sort((a, b) => a.source.localeCompare(b.source)),
    skills: skillDirs
      .map((dir) => ({ name: path.basename(dir), source: relativeTo(extension.dir, dir) }))
      .sort((a, b) => a.source.localeCompare(b.source)),
    agents: agentFiles.map((filePath) => {
      const source = relativeTo(extension.dir, filePath);
      const projected = options.agentBySource.get(`${extension.name}\0${source}`);
      return projected
        ? {
            name: projected.name,
            source,
            target: projected.target,
            projected: projected.projected,
            reason: projected.reason,
            status: projected.status,
            modelFallback: projected.modelFallback,
          }
        : {
            name: path.basename(filePath, ".md"),
            source,
            projected: false,
            reason: "Not projected yet.",
          };
    }).sort((a, b) => a.source.localeCompare(b.source)),
    hooks: hookFiles.map((filePath) => ({
      source: relativeTo(extension.dir, filePath),
      projected: false as const,
      reason: "Hooks can execute commands and require manual trust review.",
    })).sort((a, b) => a.source.localeCompare(b.source)),
    scripts: collectExtensionScripts(extension.dir),
    docs: collectExtensionDocs(extension.dir),
    warnings,
  };
}

function writeGlobalExtensionMap(options: {
  paths: ReturnType<typeof resolveProjectPaths>;
  state: ReturnType<typeof emptySyncState>;
  commands: GlobalExtensionCommandMapItem[];
  agents: GlobalExtensionAgentMapItem[];
  projectedCommands: string[];
  projectedAgents: string[];
  modelFallbacks: GeminiExtensionProjectionMap["modelFallbacks"];
  warnings: string[];
  dryRun?: boolean;
}): { promoted?: string } {
  const commandBySource = new Map(options.commands.map((item) => [`${item.extensionName}\0${item.source}`, item]));
  const agentBySource = new Map(options.agents.map((item) => [`${item.extensionName}\0${item.source}`, item]));
  const map: GeminiExtensionProjectionMap = {
    _generated: {
      tool: "ogb",
      version: OGB_VERSION,
      warning: "DO NOT EDIT. Regenerate with ogb sync.",
    },
    projectRoot: options.paths.projectRoot,
    generatedAt: new Date().toISOString(),
    extensions: listGlobalExtensionRoots(options.paths.homeDir).map((extension) => extensionMapEntry({
      extension,
      commandBySource,
      agentBySource,
    })),
    projectedCommands: options.projectedCommands,
    projectedAgents: options.projectedAgents,
    modelFallbacks: options.modelFallbacks,
    removedCommands: [],
    removedAgents: [],
    warnings: options.warnings,
  };
  const content = `${JSON.stringify(map, null, 2)}\n`;
  const reportPath = ".config/opencode-gemini-bridge/generated/ogb-extension-map.json";
  if (options.dryRun) return { promoted: reportPath };

  fs.mkdirSync(path.dirname(options.paths.extensionMapPath), { recursive: true });
  fs.writeFileSync(options.paths.extensionMapPath, content, "utf8");
  upsertManagedFile(options.state, {
    path: reportPath,
    sha256: sha256Text(content),
    source: "ogb",
  });
  return { promoted: reportPath };
}

function writeManagedGlobalText(options: {
  state: ReturnType<typeof emptySyncState>;
  globalRoot: string;
  relPath: string;
  content: string;
  label: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; warning?: string } {
  const reportPath = globalOpenCodeRelPath(options.relPath);
  const targetPath = globalTargetPath(options.globalRoot, options.relPath);
  if (options.dryRun) return { promoted: reportPath };

  const desiredHash = sha256Text(options.content);
  if (fileExists(targetPath) && sha256File(targetPath) === desiredHash) {
    upsertManagedFile(options.state, {
      path: reportPath,
      sha256: desiredHash,
      source: "ogb",
    });
    return { promoted: reportPath };
  }

  const previousHash = managedHashFor(options.state, reportPath, "ogb");
  if (fileExists(targetPath) && !options.force) {
    const currentHash = sha256File(targetPath);
    if (previousHash !== currentHash) {
      return { warning: `${options.label} conflict: ${reportPath} exists or was edited manually; use --force to overwrite` };
    }
  }

  if (fileExists(targetPath)) options.backupSession.backupExisting(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, options.content, "utf8");
  upsertManagedFile(options.state, {
    path: reportPath,
    sha256: desiredHash,
    source: "ogb",
  });
  return { promoted: reportPath };
}

function antigravityMcpReportPath(name: string): string {
  return `${ANTIGRAVITY_MCP_CONFIG_REL_PATH}#mcpServers/${name}`;
}

function escapeMcpStateName(name: string): string {
  return name.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapeMcpStateName(name: string): string {
  return name.replaceAll("~1", "/").replaceAll("~0", "~");
}

function antigravityMcpStatePath(name: string): string {
  return `${ANTIGRAVITY_MCP_CONFIG_REL_PATH}#mcpServers/${escapeMcpStateName(name)}`;
}

function antigravityMcpNameFromStatePath(statePath: string): string | undefined {
  const prefix = `${ANTIGRAVITY_MCP_CONFIG_REL_PATH}#mcpServers/`;
  return statePath.startsWith(prefix) ? unescapeMcpStateName(statePath.slice(prefix.length)) : undefined;
}

function antigravityMcpHash(config: unknown): string {
  return sha256Text(stableJson(config));
}

function projectAntigravityMcpServer(server: GeminiMcpServer): { name: string; config: Record<string, unknown>; warnings: string[] } | undefined {
  const warnings = [...(server.environmentWarnings ?? [])];
  if (server.type === "stdio" && server.command) {
    const config: Record<string, unknown> = {
      command: server.command,
    };
    if (server.args && server.args.length > 0) config.args = server.args;
    if (server.environment && Object.keys(server.environment).length > 0) config.env = server.environment;
    if (server.cwd) config.cwd = server.cwd;
    if (typeof server.timeout === "number" && Number.isFinite(server.timeout) && server.timeout > 0) config.timeout = server.timeout;
    return { name: server.name, config, warnings };
  }
  if (server.type === "http" && server.url) {
    const config: Record<string, unknown> = {
      serverUrl: server.url,
    };
    if (typeof server.timeout === "number" && Number.isFinite(server.timeout) && server.timeout > 0) config.timeout = server.timeout;
    return { name: server.name, config, warnings };
  }
  return undefined;
}

function readAntigravityMcpConfig(filePath: string): { config: Record<string, unknown>; warning?: string } {
  if (!fileExists(filePath)) return { config: {} };
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim().length === 0) return { config: {} };
  const parsed = parseJsonc(text);
  if (!isRecord(parsed)) {
    return {
      config: {},
      warning: `Antigravity MCP conflict: ${ANTIGRAVITY_MCP_CONFIG_REL_PATH} is not a valid object; leaving it unchanged`,
    };
  }
  return { config: parsed };
}

function projectGlobalAntigravityMcps(options: {
  homeDir: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted: string[]; removed: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const removed: string[] = [];
  const inventory = buildInventory({ projectRoot: options.homeDir, homeDir: options.homeDir });
  const desired = new Map<string, { config: Record<string, unknown>; source: string }>();
  for (const server of inventory.mcps) {
    const projected = projectAntigravityMcpServer(server);
    if (!projected) continue;
    desired.set(projected.name, { config: projected.config, source: server.source });
    warnings.push(...projected.warnings);
  }
  if (options.dryRun) {
    return {
      promoted: [...desired.keys()].sort().map(antigravityMcpReportPath),
      removed,
      warnings: [...new Set(warnings)],
    };
  }

  const targetPath = targetPathFromReportPath(options.homeDir, ANTIGRAVITY_MCP_CONFIG_REL_PATH);
  const read = readAntigravityMcpConfig(targetPath);
  if (read.warning) return { promoted, removed, warnings: [...new Set([...warnings, read.warning])] };
  const currentConfig = read.config;
  const rawServers = currentConfig.mcpServers;
  if (rawServers !== undefined && !isRecord(rawServers)) {
    warnings.push(`Antigravity MCP conflict: ${ANTIGRAVITY_MCP_CONFIG_REL_PATH}.mcpServers is not an object; leaving it unchanged`);
    return { promoted, removed, warnings: [...new Set(warnings)] };
  }
  const nextServers: Record<string, unknown> = { ...(isRecord(rawServers) ? rawServers : {}) };
  let changed = false;

  for (const [name, item] of [...desired.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const statePath = antigravityMcpStatePath(name);
    const reportPath = antigravityMcpReportPath(name);
    const desiredHash = antigravityMcpHash(item.config);
    const current = nextServers[name];
    const previousHash = managedHashFor(options.state, statePath, "ogb");

    if (current !== undefined) {
      const currentHash = antigravityMcpHash(current);
      if (currentHash === desiredHash) {
        upsertManagedFile(options.state, {
          path: statePath,
          sha256: desiredHash,
          source: "ogb",
          kind: "mcp",
          projection: "antigravity",
          origin: item.source,
        });
        promoted.push(reportPath);
        continue;
      }
      if (!options.force && !previousHash) {
        warnings.push(`Antigravity MCP conflict: ${reportPath} exists and is not managed by ogb; use --force to overwrite`);
        continue;
      }
      if (!options.force && previousHash && currentHash !== previousHash) {
        warnings.push(`Antigravity MCP conflict: ${reportPath} was edited manually; use --force to overwrite`);
        continue;
      }
    }

    nextServers[name] = item.config;
    changed = true;
    upsertManagedFile(options.state, {
      path: statePath,
      sha256: desiredHash,
      source: "ogb",
      kind: "mcp",
      projection: "antigravity",
      origin: item.source,
    });
    promoted.push(reportPath);
  }

  const desiredStatePaths = new Set([...desired.keys()].map(antigravityMcpStatePath));
  for (const file of [...options.state.managedFiles]) {
    const staleName = file.source === "ogb" && file.kind === "mcp" ? antigravityMcpNameFromStatePath(file.path) : undefined;
    if (!staleName || desiredStatePaths.has(file.path)) continue;
    const current = nextServers[staleName];
    if (current === undefined) {
      options.state.managedFiles = options.state.managedFiles.filter((item) => !(item.path === file.path && item.source === "ogb"));
      continue;
    }
    if (!options.force && antigravityMcpHash(current) !== file.sha256) {
      warnings.push(`Antigravity MCP conflict: ${antigravityMcpReportPath(staleName)} was edited manually; leaving stale server in place`);
      continue;
    }
    delete nextServers[staleName];
    changed = true;
    options.state.managedFiles = options.state.managedFiles.filter((item) => !(item.path === file.path && item.source === "ogb"));
    removed.push(antigravityMcpReportPath(staleName));
  }

  if (changed || desired.size > 0) {
    const sortedServers = Object.fromEntries(Object.entries(nextServers).sort((a, b) => a[0].localeCompare(b[0])));
    const nextConfig = {
      ...currentConfig,
      mcpServers: sortedServers,
    };
    const nextText = `${JSON.stringify(nextConfig, null, 2)}\n`;
    const currentText = fileExists(targetPath) ? fs.readFileSync(targetPath, "utf8") : undefined;
    if (currentText !== nextText) {
      if (fileExists(targetPath)) options.backupSession.backupExisting(targetPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, nextText, "utf8");
      changed = true;
    }
    upsertManagedFile(options.state, {
      path: ANTIGRAVITY_MCP_CONFIG_REL_PATH,
      sha256: sha256Text(nextText),
      source: "ogb",
      kind: "mcp",
      projection: "antigravity",
    });
  }

  return { promoted, removed, warnings: [...new Set(warnings)] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureGlobalOpenCodeConfig(options: {
  globalRoot: string;
  expandedPath?: string;
  mcp?: Record<string, unknown>;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; mcpServers: string[]; warning?: string } {
  const configPath = globalConfigPath(options.globalRoot);
  const relPath = globalOpenCodeRelPath(toPosix(path.relative(options.globalRoot, configPath)));
  const expandedInstruction = options.expandedPath ? globalExpandedInstructionRef(options.globalRoot, options.expandedPath) : undefined;
  const mcp = options.mcp ?? {};
  const mcpServers = Object.keys(mcp).sort();

  if (!fs.existsSync(configPath)) {
    const contentObject: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
    };
    if (expandedInstruction) contentObject.instructions = [expandedInstruction];
    if (mcpServers.length > 0) contentObject.mcp = mcp;
    const content = `${JSON.stringify(contentObject, null, 2)}\n`;
    if (options.dryRun) return { promoted: relPath, mcpServers };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, content, "utf8");
    upsertManagedFile(options.state, {
      path: relPath,
      sha256: sha256Text(content),
      source: "ogb",
    });
    return { promoted: relPath, mcpServers };
  }

  const currentText = fs.readFileSync(configPath, "utf8");
  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(currentText, parseErrors, { allowTrailingComma: true }) as unknown;
  if (parseErrors.length > 0 || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { mcpServers: [], warning: `Global OpenCode config conflict: ${relPath} is not a valid object; leaving it unchanged` };
  }

  const rawInstructions = (parsed as Record<string, unknown>).instructions;
  const currentInstructions = Array.isArray(rawInstructions)
    ? rawInstructions.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const retainedInstructions = expandedInstruction
    ? currentInstructions.filter((item) => !isManagedGlobalInstructionRef(item))
    : currentInstructions;
  const nextInstructions = !expandedInstruction || retainedInstructions.includes(expandedInstruction)
    ? retainedInstructions
    : [...retainedInstructions, expandedInstruction];
  const rawMcp = (parsed as Record<string, unknown>).mcp;
  if (mcpServers.length > 0 && rawMcp !== undefined && !isRecord(rawMcp) && !options.force) {
    return { mcpServers: [], warning: `Global OpenCode config conflict: ${relPath} has a non-object mcp field; leaving it unchanged` };
  }
  const currentMcp = isRecord(rawMcp) ? rawMcp : {};
  const nextMcp = mcpServers.length > 0 ? { ...currentMcp, ...mcp } : currentMcp;
  const instructionsChanged = expandedInstruction !== undefined && JSON.stringify(nextInstructions) !== JSON.stringify(currentInstructions);
  const mcpChanged = mcpServers.length > 0 && JSON.stringify(nextMcp) !== JSON.stringify(currentMcp);

  if (!instructionsChanged && !mcpChanged) {
    upsertManagedFile(options.state, {
      path: relPath,
      sha256: sha256Text(currentText),
      source: "ogb",
    });
    return { promoted: relPath, mcpServers };
  }

  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: "\n",
  };
  let nextText = currentText;
  if (instructionsChanged) {
    nextText = applyEdits(nextText, modifyJsonc(nextText, ["instructions"], nextInstructions, { formattingOptions }));
  }
  if (mcpChanged) {
    nextText = applyEdits(nextText, modifyJsonc(nextText, ["mcp"], nextMcp, { formattingOptions }));
  }
  if (options.dryRun) return { promoted: relPath, mcpServers };

  options.backupSession.backupExisting(configPath);
  fs.writeFileSync(configPath, nextText, "utf8");
  upsertManagedFile(options.state, {
    path: relPath,
    sha256: sha256Text(nextText),
    source: "ogb",
  });
  return { promoted: relPath, mcpServers };
}

function removeManagedGlobalAgentsFile(options: {
  globalRoot: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  force?: boolean;
}): { removed?: string; warning?: string } {
  const relPath = globalOpenCodeRelPath("AGENTS.md");
  const targetPath = globalTargetPath(options.globalRoot, "AGENTS.md");
  const previousHash = managedHashFor(options.state, relPath, "ogb");
  if (!previousHash || !fileExists(targetPath)) return {};

  if (!options.force && sha256File(targetPath) !== previousHash) {
    return { warning: `Global AGENTS.md was previously generated by ogb but now differs; leaving ${relPath} untouched` };
  }

  options.backupSession.backupExisting(targetPath);
  fs.rmSync(targetPath, { force: true });
  options.state.managedFiles = options.state.managedFiles.filter((file) => !(file.path === relPath && file.source === "ogb"));
  return { removed: relPath };
}

function projectGlobalGeminiContext(options: {
  homeDir: string;
  globalRoot: string;
  expandedPath: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { expanded?: string; removed?: string; warning?: string } {
  const inputs = globalGeminiContextInputs(options.homeDir);
  if (inputs.length === 0) return {};

  const content = writeExpandedGeminiContext({
    projectRoot: options.homeDir,
    homeDir: options.homeDir,
    output: options.expandedPath,
    inputs,
    dryRun: options.dryRun,
  });
  const expandedReportPath = ".config/opencode-gemini-bridge/generated/GEMINI.expanded.md";
  if (!options.dryRun) {
    upsertManagedFile(options.state, {
      path: expandedReportPath,
      sha256: sha256Text(content),
      source: "ogb",
    });
  }

  const removedAgents = options.dryRun
    ? {}
    : removeManagedGlobalAgentsFile({
        globalRoot: options.globalRoot,
        state: options.state,
        backupSession: options.backupSession,
        force: options.force,
      });
  return {
    expanded: expandedReportPath,
    removed: removedAgents.removed,
    warning: removedAgents.warning,
  };
}

function projectGlobalGeminiCommands(options: {
  homeDir: string;
  globalRoot: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  usedCommandRelPaths?: Set<string>;
  dryRun?: boolean;
  force?: boolean;
}): { promoted: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const usedCommandRelPaths = options.usedCommandRelPaths ?? new Set<string>();
  const commandsRoot = path.join(options.homeDir, ".gemini", "commands");
  const files = listFilesRecursive(commandsRoot)
    .filter((filePath) => /\.(md|toml)$/i.test(filePath))
    .sort();

  for (const sourcePath of files) {
    const relPath = uniqueGlobalCommandRelPath(commandRelFromSource(commandsRoot, sourcePath), usedCommandRelPaths);
    const sourceRelPath = toPosix(path.relative(commandsRoot, sourcePath));
    const fallbackDescription = `Gemini global command: ${sourceRelPath}`;
    const text = fs.readFileSync(sourcePath, "utf8");
    const parsed = sourcePath.endsWith(".toml")
      ? parseGeminiCommandToml(text)
      : { ...parseMarkdownCommand(text, fallbackDescription), warnings: [] };
    const description = parsed.description ?? fallbackDescription;
    for (const warning of parsed.warnings) warnings.push(`Command parse warning: ${sourceRelPath}: ${warning}`);

    const write = writeManagedGlobalText({
      state: options.state,
      globalRoot: options.globalRoot,
      relPath,
      content: globalCommandMarkdown({
        description,
        prompt: parsed.prompt,
        sourcePath,
        sourceRelPath,
        marker: GLOBAL_COMMAND_MARKER,
      }),
      label: "Global command",
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (write.promoted) promoted.push(write.promoted);
    if (write.warning) warnings.push(write.warning);
  }

  return { promoted, warnings };
}

function projectGlobalGeminiExtensionCommands(options: {
  homeDir: string;
  globalRoot: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  usedCommandRelPaths?: Set<string>;
  dryRun?: boolean;
  force?: boolean;
}): { promoted: string[]; warnings: string[]; mapCommands: GlobalExtensionCommandMapItem[] } {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const mapCommands: GlobalExtensionCommandMapItem[] = [];
  const usedCommandRelPaths = options.usedCommandRelPaths ?? new Set<string>();
  const extensionsRoot = path.join(options.homeDir, ".gemini", "extensions");
  if (!dirExists(extensionsRoot)) return { promoted, warnings, mapCommands };

  for (const extensionName of fs.readdirSync(extensionsRoot).sort()) {
    const extensionDir = path.join(extensionsRoot, extensionName);
    const commandsRoot = path.join(extensionDir, "commands");
    if (!dirExists(commandsRoot)) continue;

    const files = listFilesRecursive(commandsRoot)
      .filter((filePath) => filePath.endsWith(".toml"))
      .sort();

    for (const sourcePath of files) {
      const naturalRelPath = commandRelFromSource(commandsRoot, sourcePath);
      const relPath = uniqueGlobalCommandRelPath(naturalRelPath, usedCommandRelPaths, extensionName);
      const sourceRelPath = toPosix(path.relative(extensionDir, sourcePath));
      const parsed = parseGeminiCommandToml(fs.readFileSync(sourcePath, "utf8"));
      const description = parsed.description ?? `Gemini extension command from ${extensionName}`;
      for (const warning of parsed.warnings) warnings.push(`Extension command parse warning: ${extensionName}/${sourceRelPath}: ${warning}`);

      const write = writeManagedGlobalText({
        state: options.state,
        globalRoot: options.globalRoot,
        relPath,
        content: globalCommandMarkdown({
          description,
          prompt: parsed.prompt,
          sourcePath,
          sourceRelPath,
          marker: GLOBAL_EXTENSION_COMMAND_MARKER,
          extensionName,
          extensionDir,
        }),
        label: "Global extension command",
        backupSession: options.backupSession,
        dryRun: options.dryRun,
        force: options.force,
      });
      if (write.promoted) promoted.push(write.promoted);
      if (write.warning) warnings.push(write.warning);
      mapCommands.push({
        extensionName,
        name: globalCommandNameFromRelPath(relPath),
        source: sourceRelPath,
        target: write.promoted ?? globalOpenCodeRelPath(relPath),
        description,
        status: write.warning ? "conflict" : parsed.warnings.length > 0 ? "parse_warning" : "projected",
        message: write.warning ?? (parsed.warnings.length > 0 ? parsed.warnings.join("; ") : undefined),
      });
    }
  }

  return { promoted, warnings, mapCommands };
}

function projectGlobalGeminiAgents(options: {
  homeDir: string;
  globalRoot: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  usedAgentRelPaths?: Set<string>;
  dryRun?: boolean;
  force?: boolean;
}): { promoted: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const usedAgentRelPaths = options.usedAgentRelPaths ?? new Set<string>();
  const agentsRoot = path.join(options.homeDir, ".gemini", "agents");
  const files = listFilesRecursive(agentsRoot)
    .filter((filePath) => filePath.endsWith(".md"))
    .sort();

  for (const sourcePath of files) {
    const relPath = uniqueGlobalAgentRelPath(agentRelFromSource(agentsRoot, sourcePath), usedAgentRelPaths);
    const sourceRelPath = toPosix(path.relative(agentsRoot, sourcePath));
    const parsed = parseMarkdownAgent(fs.readFileSync(sourcePath, "utf8"), `Gemini global agent: ${sourceRelPath}`);
    const write = writeManagedGlobalText({
      state: options.state,
      globalRoot: options.globalRoot,
      relPath,
      content: globalAgentMarkdown({
        description: parsed.description,
        body: parsed.body,
        sourcePath,
        sourceRelPath,
        marker: GLOBAL_AGENT_MARKER,
        model: parsed.model,
        temperature: parsed.temperature,
        maxSteps: parsed.maxSteps,
      }),
      label: "Global agent",
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (write.promoted) promoted.push(write.promoted);
    if (write.warning) warnings.push(write.warning);
  }

  return { promoted, warnings };
}

function projectGlobalGeminiExtensionAgents(options: {
  homeDir: string;
  globalRoot: string;
  state: ReturnType<typeof emptySyncState>;
  config: ReturnType<typeof readOgbConfig>;
  routing: ReturnType<typeof createModelRoutingContext>;
  modelFallbacks: GeminiExtensionProjectionMap["modelFallbacks"];
  backupSession: BackupSession;
  usedAgentRelPaths?: Set<string>;
  dryRun?: boolean;
  force?: boolean;
}): { promoted: string[]; warnings: string[]; mapAgents: GlobalExtensionAgentMapItem[] } {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const mapAgents: GlobalExtensionAgentMapItem[] = [];
  const usedAgentRelPaths = options.usedAgentRelPaths ?? new Set<string>();
  const extensionsRoot = path.join(options.homeDir, ".gemini", "extensions");
  if (!dirExists(extensionsRoot)) return { promoted, warnings, mapAgents };

  for (const extensionName of fs.readdirSync(extensionsRoot).sort()) {
    const extensionDir = path.join(extensionsRoot, extensionName);
    const agentsRoot = path.join(extensionDir, "agents");
    if (!dirExists(agentsRoot)) continue;

    const files = listFilesRecursive(agentsRoot)
      .filter((filePath) => filePath.endsWith(".md"))
      .sort();

    for (const sourcePath of files) {
      const relPath = uniqueGlobalAgentRelPath(agentRelFromSource(agentsRoot, sourcePath), usedAgentRelPaths, extensionName);
      const sourceRelPath = toPosix(path.relative(extensionDir, sourcePath));
      const parsed = parseMarkdownAgent(fs.readFileSync(sourcePath, "utf8"), `Gemini extension agent from ${extensionName}`);
      const agentName = globalAgentNameFromRelPath(relPath);
      const fallback = resolveAgentFallback({
        config: options.config,
        extensionName,
        agentName,
        importedModel: parsed.model,
      });
      const hasRoutingSurface = fallbackHasRoutingSurface(fallback);
      const routingDecision = hasRoutingSurface ? options.routing.decide(fallback) : undefined;
      if (fallback.source !== "none" && (fallback.fallbackModels.length > 0 || fallback.model || hasRuntimeOptions(fallback, { includeVariant: true }))) {
        options.modelFallbacks.push({
          agent: agentName,
          extension: extensionName,
          model: fallback.model,
          ...runtimeOptionObject(fallback, { includeVariant: true }),
          fallback_models: fallback.fallbackModels,
          source: fallback.source,
        });
      }
      const write = writeManagedGlobalText({
        state: options.state,
        globalRoot: options.globalRoot,
        relPath,
        content: globalAgentMarkdown({
          description: parsed.description,
          body: parsed.body,
          sourcePath,
          sourceRelPath,
          marker: GLOBAL_EXTENSION_AGENT_MARKER,
          extensionName,
          extensionDir,
          model: parsed.model,
          temperature: parsed.temperature,
          maxSteps: parsed.maxSteps,
          fallback: hasRoutingSurface ? fallback : undefined,
          routing: routingDecision,
        }),
        label: "Global extension agent",
        backupSession: options.backupSession,
        dryRun: options.dryRun,
        force: options.force,
      });
      if (write.promoted) promoted.push(write.promoted);
      if (write.warning) warnings.push(write.warning);
      mapAgents.push({
        extensionName,
        name: agentName,
        source: sourceRelPath,
        target: write.promoted ?? globalOpenCodeRelPath(relPath),
        projected: !write.warning,
        reason: write.warning,
        status: write.warning ? "conflict" : "projected",
        modelFallback: hasRoutingSurface ? fallback : undefined,
      });
    }
  }

  return { promoted, warnings, mapAgents };
}

function listGeminiGlobalSkillDirs(homeDir: string): Array<{ skillName: string; sourceDir: string }> {
  const skillsRoot = path.join(homeDir, ".gemini", "skills");
  if (!dirExists(skillsRoot)) return [];

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ skillName: entry.name, sourceDir: path.join(skillsRoot, entry.name) }))
    .filter((skill) => fileExists(path.join(skill.sourceDir, "SKILL.md")))
    .sort((a, b) => a.skillName.localeCompare(b.skillName));
}

interface ProjectSkillDirsResult {
  promoted: string[];
  removed: string[];
  warnings: string[];
}

interface ProjectAntigravitySkillsResult extends ProjectSkillDirsResult {
  promotedAgents: string[];
  removedAgents: string[];
}

interface ProjectAntigravityFilesResult {
  promoted: string[];
  removed: string[];
  warnings: string[];
}

function copyManagedSkillDir(options: {
  state: ReturnType<typeof emptySyncState>;
  targetRoot: string;
  reportDir: string;
  sourceDir: string;
  sourceBaseDir: string;
  label: string;
  projection: "opencode" | "antigravity";
  origin: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; warning?: string } {
  const reportSkillPath = `${options.reportDir}/SKILL.md`;
  const targetDir = targetPathFromReportPath(options.targetRoot, options.reportDir);
  const currentSkillFile = path.join(targetDir, "SKILL.md");
  if (options.dryRun) return { promoted: options.reportDir };

  const previousHash = managedHashFor(options.state, reportSkillPath, "ogb");
  if (dirExists(targetDir) && !previousHash && projectedDirMatchesSource({
    sourceDir: options.sourceDir,
    targetDir,
    sourceBaseDir: options.sourceBaseDir,
  })) {
    recordManagedSkillDir({
      state: options.state,
      targetDir,
      reportDir: options.reportDir,
      projection: options.projection,
      origin: options.origin,
    });
    return { promoted: options.reportDir };
  }

  if (dirExists(targetDir) && !options.force && !previousHash) {
    return { warning: `${options.label} conflict: ${options.reportDir} exists and is not managed by ogb; use --force to overwrite` };
  }
  if (fileExists(currentSkillFile) && !options.force && previousHash && sha256File(currentSkillFile) !== previousHash) {
    return { warning: `${options.label} conflict: ${options.reportDir} was edited manually; use --force to overwrite` };
  }

  if (dirExists(targetDir)) options.backupSession.backupExisting(targetDir);
  copyDir(options.sourceDir, targetDir, options.sourceBaseDir);
  recordManagedSkillDir({
    state: options.state,
    targetDir,
    reportDir: options.reportDir,
    projection: options.projection,
    origin: options.origin,
  });
  return { promoted: options.reportDir };
}

function recordManagedSkillDir(options: {
  state: ReturnType<typeof emptySyncState>;
  targetDir: string;
  reportDir: string;
  projection: "opencode" | "antigravity";
  origin: string;
}): void {
  options.state.managedFiles = options.state.managedFiles.filter((file) =>
    !(file.source === "ogb" && (file.path === options.reportDir || file.path.startsWith(`${options.reportDir}/`)))
  );
  for (const filePath of listFilesRecursive(options.targetDir)) {
    const relFile = toPosix(path.relative(options.targetDir, filePath));
    upsertManagedFile(options.state, {
      path: `${options.reportDir}/${relFile}`,
      sha256: sha256File(filePath),
      source: "ogb",
      kind: "skill",
      projection: options.projection,
      origin: options.origin,
    });
  }
}

function removeStaleManagedSkillDirs(options: {
  state: ReturnType<typeof emptySyncState>;
  root: string;
  pathPrefix: string;
  keepSkillFiles: Set<string>;
  backupSession: BackupSession;
  label: string;
  managedKinds?: Array<"skill" | "agent">;
  force?: boolean;
}): { removed: string[]; removedDetails: Array<{ path: string; kind: "skill" | "agent" }>; warnings: string[] } {
  const removed: string[] = [];
  const removedDetails: Array<{ path: string; kind: "skill" | "agent" }> = [];
  const warnings: string[] = [];
  const managedKinds = new Set(options.managedKinds ?? ["skill"]);
  const keepSkillDirs = new Set(
    [...options.keepSkillFiles].map((filePath) => filePath.slice(0, -"/SKILL.md".length)),
  );
  const staleByDir = new Map<string, typeof options.state.managedFiles>();
  for (const file of options.state.managedFiles) {
    if (file.source !== "ogb") continue;
    if (!file.path.startsWith(options.pathPrefix)) continue;
    if (file.kind !== undefined && !managedKinds.has(file.kind as "skill" | "agent")) continue;
    const skillName = file.path.slice(options.pathPrefix.length).split("/")[0];
    if (!skillName) continue;
    const skillRelDir = `${options.pathPrefix}${skillName}`;
    if (keepSkillDirs.has(skillRelDir)) continue;
    const files = staleByDir.get(skillRelDir) ?? [];
    files.push(file);
    staleByDir.set(skillRelDir, files);
  }

  for (const [skillRelDir, managedFiles] of staleByDir) {
    const skillPath = targetPathFromReportPath(options.root, skillRelDir);
    const removedKind = managedFiles.some((file) => file.kind === "agent") ? "agent" : "skill";

    if (!dirExists(skillPath)) {
      options.state.managedFiles = options.state.managedFiles.filter((item) =>
        !(item.source === "ogb" && (item.path === skillRelDir || item.path.startsWith(`${skillRelDir}/`)))
      );
      continue;
    }

    const managedByPath = new Map(managedFiles.map((file) => [file.path, file]));
    const actualPaths = listFilesRecursive(skillPath)
      .map((filePath) => `${skillRelDir}/${toPosix(path.relative(skillPath, filePath))}`);
    const hasUntrackedFile = actualPaths.some((filePath) => !managedByPath.has(filePath));
    const hasEditedFile = managedFiles.some((file) => {
      const targetPath = targetPathFromReportPath(options.root, file.path);
      return fileExists(targetPath) && sha256File(targetPath) !== file.sha256;
    });
    if (!options.force && (hasUntrackedFile || hasEditedFile)) {
      warnings.push(`${options.label} conflict: ${skillRelDir} was edited manually; leaving stale skill in place`);
      continue;
    }

    options.backupSession.backupExisting(skillPath);
    fs.rmSync(skillPath, { recursive: true, force: true });
    options.state.managedFiles = options.state.managedFiles.filter((item) =>
      !(item.source === "ogb" && (item.path === skillRelDir || item.path.startsWith(`${skillRelDir}/`)))
    );
    removed.push(skillRelDir);
    removedDetails.push({ path: skillRelDir, kind: removedKind });
  }

  return { removed, removedDetails, warnings };
}

function copyManagedGlobalSkill(options: {
  state: ReturnType<typeof emptySyncState>;
  homeDir: string;
  sourceDir: string;
  sourceBaseDir: string;
  targetName: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; warning?: string } {
  return copyManagedSkillDir({
    state: options.state,
    targetRoot: options.homeDir,
    reportDir: globalOpenCodeRelPath(`skills/${safeGlobalSegment(options.targetName)}`),
    sourceDir: options.sourceDir,
    sourceBaseDir: options.sourceBaseDir,
    label: "Global skill",
    projection: "opencode",
    origin: options.sourceDir,
    backupSession: options.backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
}

function copyManagedAntigravitySkill(options: {
  state: ReturnType<typeof emptySyncState>;
  homeDir: string;
  sourceDir: string;
  sourceBaseDir: string;
  targetName: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; warning?: string } {
  return copyManagedSkillDir({
    state: options.state,
    targetRoot: options.homeDir,
    reportDir: globalAntigravityRelPath(`skills/${safeGlobalSegment(options.targetName)}`),
    sourceDir: options.sourceDir,
    sourceBaseDir: options.sourceBaseDir,
    label: "Antigravity skill",
    projection: "antigravity",
    origin: options.sourceDir,
    backupSession: options.backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
}

function listGeminiGlobalAgentFiles(homeDir: string): Array<{ agentName: string; sourcePath: string; sourceRelPath: string }> {
  const agentsRoot = path.join(homeDir, ".gemini", "agents");
  return listFilesRecursive(agentsRoot)
    .filter((filePath) => filePath.endsWith(".md"))
    .map((sourcePath) => ({
      agentName: safeGlobalSegment(path.basename(sourcePath, ".md")),
      sourcePath,
      sourceRelPath: toPosix(path.relative(agentsRoot, sourcePath)),
    }))
    .sort((a, b) => a.sourceRelPath.localeCompare(b.sourceRelPath));
}

function listGeminiExtensionAgentFiles(homeDir: string): Array<{
  extensionName: string;
  extensionDir: string;
  agentName: string;
  sourcePath: string;
  sourceRelPath: string;
}> {
  const extensionsRoot = path.join(homeDir, ".gemini", "extensions");
  if (!dirExists(extensionsRoot)) return [];

  const out: Array<{
    extensionName: string;
    extensionDir: string;
    agentName: string;
    sourcePath: string;
    sourceRelPath: string;
  }> = [];
  for (const extensionName of fs.readdirSync(extensionsRoot).sort()) {
    const extensionDir = path.join(extensionsRoot, extensionName);
    const agentsRoot = path.join(extensionDir, "agents");
    for (const sourcePath of listFilesRecursive(agentsRoot).filter((filePath) => filePath.endsWith(".md")).sort()) {
      out.push({
        extensionName,
        extensionDir,
        agentName: safeGlobalSegment(path.basename(sourcePath, ".md")),
        sourcePath,
        sourceRelPath: toPosix(path.relative(extensionDir, sourcePath)),
      });
    }
  }
  return out.sort((a, b) => `${a.extensionName}/${a.sourceRelPath}`.localeCompare(`${b.extensionName}/${b.sourceRelPath}`));
}

function workflowNameFromSource(root: string, sourcePath: string): string {
  const relPath = toPosix(path.relative(root, sourcePath));
  const extension = path.extname(relPath);
  const withoutExtension = extension ? relPath.slice(0, -extension.length) : relPath;
  return withoutExtension.split("/").map(safeGlobalSegment).filter(Boolean).join("-") || "workflow";
}

function listGeminiGlobalWorkflowFiles(homeDir: string): Array<{ workflowName: string; sourcePath: string; sourceRelPath: string }> {
  const roots = [
    path.join(homeDir, ".gemini", "workflows"),
    path.join(homeDir, ".gemini", ".agent", "workflows"),
    path.join(homeDir, ".gemini", ".agents", "workflows"),
  ];
  const out: Array<{ workflowName: string; sourcePath: string; sourceRelPath: string }> = [];
  for (const root of roots) {
    for (const sourcePath of listFilesRecursive(root).filter((filePath) => filePath.endsWith(".md")).sort()) {
      out.push({
        workflowName: workflowNameFromSource(root, sourcePath),
        sourcePath,
        sourceRelPath: toPosix(path.relative(root, sourcePath)),
      });
    }
  }
  return out.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function listGeminiExtensionWorkflowFiles(homeDir: string): Array<{
  extensionName: string;
  extensionDir: string;
  workflowName: string;
  sourcePath: string;
  sourceRelPath: string;
}> {
  const extensionsRoot = path.join(homeDir, ".gemini", "extensions");
  if (!dirExists(extensionsRoot)) return [];

  const out: Array<{
    extensionName: string;
    extensionDir: string;
    workflowName: string;
    sourcePath: string;
    sourceRelPath: string;
  }> = [];
  for (const extensionName of fs.readdirSync(extensionsRoot).sort()) {
    const extensionDir = path.join(extensionsRoot, extensionName);
    for (const relRoot of [".agent/workflows", ".agents/workflows", "_agent/workflows", "_agents/workflows"]) {
      const workflowsRoot = path.join(extensionDir, ...relRoot.split("/"));
      for (const sourcePath of listFilesRecursive(workflowsRoot).filter((filePath) => filePath.endsWith(".md")).sort()) {
        out.push({
          extensionName,
          extensionDir,
          workflowName: workflowNameFromSource(workflowsRoot, sourcePath),
          sourcePath,
          sourceRelPath: toPosix(path.relative(extensionDir, sourcePath)),
        });
      }
    }
  }
  return out.sort((a, b) => `${a.extensionName}/${a.sourceRelPath}`.localeCompare(`${b.extensionName}/${b.sourceRelPath}`));
}

function antigravityAgentPromptMarkdown(options: {
  targetName: string;
  description: string;
  body: string;
  sourcePath: string;
  sourceRelPath: string;
  extensionName?: string;
  extensionDir?: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
}): string {
  const lines = [
    "<!-- GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT. -->",
    `<!-- ${ANTIGRAVITY_AGENT_MARKER} -->`,
  ];
  if (options.extensionName) lines.push(`<!-- Source extension: ${options.extensionName} -->`);
  lines.push(
    `<!-- Source agent: ${options.sourceRelPath} -->`,
    `<!-- Source file: ${options.sourcePath} -->`,
    `<!-- Native Antigravity agent: ${safeGlobalSegment(options.targetName)} -->`,
    `<!-- Description: ${options.description} -->`,
  );
  if (options.model) lines.push(`<!-- Source model: ${options.model} -->`);
  if (options.temperature !== undefined) lines.push(`<!-- Source temperature: ${options.temperature} -->`);
  if (options.maxSteps !== undefined) lines.push(`<!-- Source maxSteps: ${options.maxSteps} -->`);
  lines.push(
    "",
    normalizeGlobalCommandPrompt(options.body, options.extensionDir),
    "",
  );
  return lines.join("\n");
}

function writeManagedAntigravityText(options: {
  state: ReturnType<typeof emptySyncState>;
  homeDir: string;
  reportPath: string;
  content: string;
  kind: "agent" | "workflow";
  label: string;
  origin: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; warning?: string } {
  const targetPath = targetPathFromReportPath(options.homeDir, options.reportPath);
  if (options.dryRun) return { promoted: options.reportPath };

  const desiredHash = sha256Text(options.content);
  if (fileExists(targetPath) && sha256File(targetPath) === desiredHash) {
    upsertManagedFile(options.state, {
      path: options.reportPath,
      sha256: desiredHash,
      source: "ogb",
      kind: options.kind,
      projection: "antigravity",
      origin: options.origin,
    });
    return { promoted: options.reportPath };
  }

  const previousHash = managedHashFor(options.state, options.reportPath, "ogb");
  if (fileExists(targetPath) && !options.force && !previousHash) {
    return { warning: `${options.label} conflict: ${options.reportPath} exists and is not managed by ogb; use --force to overwrite` };
  }
  if (fileExists(targetPath) && !options.force && previousHash && sha256File(targetPath) !== previousHash) {
    return { warning: `${options.label} conflict: ${options.reportPath} was edited manually; use --force to overwrite` };
  }

  if (fileExists(targetPath)) options.backupSession.backupExisting(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, options.content, "utf8");
  upsertManagedFile(options.state, {
    path: options.reportPath,
    sha256: desiredHash,
    source: "ogb",
    kind: options.kind,
    projection: "antigravity",
    origin: options.origin,
  });
  return { promoted: options.reportPath };
}

function removeStaleManagedFiles(options: {
  state: ReturnType<typeof emptySyncState>;
  root: string;
  pathPrefix: string;
  keepPaths: Set<string>;
  backupSession: BackupSession;
  kind: "agent" | "workflow";
  label: string;
  force?: boolean;
}): { removed: string[]; warnings: string[] } {
  const removed: string[] = [];
  const warnings: string[] = [];
  for (const file of [...options.state.managedFiles]) {
    if (file.source !== "ogb") continue;
    if (file.kind !== options.kind) continue;
    if (!file.path.startsWith(options.pathPrefix)) continue;
    if (options.keepPaths.has(file.path)) continue;

    const targetPath = targetPathFromReportPath(options.root, file.path);
    if (!fileExists(targetPath)) {
      options.state.managedFiles = options.state.managedFiles.filter((item) =>
        !(item.path === file.path && item.source === "ogb")
      );
      continue;
    }
    if (!options.force && sha256File(targetPath) !== file.sha256) {
      warnings.push(`${options.label} conflict: ${file.path} was edited manually; leaving stale file in place`);
      continue;
    }

    options.backupSession.backupExisting(targetPath);
    fs.rmSync(targetPath, { force: true });
    options.state.managedFiles = options.state.managedFiles.filter((item) =>
      !(item.path === file.path && item.source === "ogb")
    );
    removed.push(file.path);
  }
  return { removed, warnings };
}

function writeManagedAntigravityAgent(options: {
  state: ReturnType<typeof emptySyncState>;
  homeDir: string;
  targetName: string;
  description: string;
  body: string;
  sourcePath: string;
  sourceRelPath: string;
  extensionName?: string;
  extensionDir?: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): { promoted?: string; warning?: string } {
  const safeName = safeGlobalSegment(options.targetName);
  const agentReportPath = globalAntigravityRelPath(`agents/${safeName}`);
  const promptReportPath = globalAntigravityRelPath(`agent_prompts/${safeName}.md`);
  const promptPath = targetPathFromReportPath(options.homeDir, promptReportPath);
  const prompt = antigravityAgentPromptMarkdown({
    targetName: safeName,
    description: options.description,
    body: options.body,
    sourcePath: options.sourcePath,
    sourceRelPath: options.sourceRelPath,
    extensionName: options.extensionName,
    extensionDir: options.extensionDir,
    model: options.model,
    temperature: options.temperature,
    maxSteps: options.maxSteps,
  });
  const config = `${JSON.stringify({
    name: safeName,
    description: options.description,
    command_spec: {
      command: "/bin/cat",
      args: [promptPath],
    },
  }, null, 2)}\n`;

  const promptWrite = writeManagedAntigravityText({
    state: options.state,
    homeDir: options.homeDir,
    reportPath: promptReportPath,
    content: prompt,
    kind: "agent",
    label: "Antigravity agent prompt",
    origin: options.sourcePath,
    backupSession: options.backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  if (promptWrite.warning) return { warning: promptWrite.warning };

  return writeManagedAntigravityText({
    state: options.state,
    homeDir: options.homeDir,
    reportPath: agentReportPath,
    content: config,
    kind: "agent",
    label: "Antigravity agent",
    origin: options.sourcePath,
    backupSession: options.backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
}

function projectGlobalGeminiSkills(options: {
  homeDir: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): ProjectSkillDirsResult {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const keepSkillFiles = new Set<string>();
  const used = new Set<string>();

  for (const skill of listGeminiGlobalSkillDirs(options.homeDir)) {
    const targetName = safeSkillTargetName(skill.skillName, used, "gemini");
    used.add(targetName);
    keepSkillFiles.add(`${globalOpenCodeRelPath(`skills/${safeGlobalSegment(targetName)}`)}/SKILL.md`);
    const copy = copyManagedGlobalSkill({
      state: options.state,
      homeDir: options.homeDir,
      sourceDir: skill.sourceDir,
      sourceBaseDir: skill.sourceDir,
      targetName,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (copy.promoted) promoted.push(copy.promoted);
    if (copy.warning) warnings.push(copy.warning);
  }

  for (const skill of listGeminiExtensionSkillDirs(options.homeDir)) {
    const targetName = safeSkillTargetName(skill.skillName, used, skill.extensionName);
    used.add(targetName);
    keepSkillFiles.add(`${globalOpenCodeRelPath(`skills/${safeGlobalSegment(targetName)}`)}/SKILL.md`);
    const copy = copyManagedGlobalSkill({
      state: options.state,
      homeDir: options.homeDir,
      sourceDir: skill.sourceDir,
      sourceBaseDir: path.dirname(path.dirname(skill.sourceDir)),
      targetName,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (copy.promoted) promoted.push(copy.promoted);
    if (copy.warning) warnings.push(copy.warning);
  }

  const stale = options.dryRun
    ? { removed: [], removedDetails: [], warnings: [] }
    : removeStaleManagedSkillDirs({
        state: options.state,
        root: options.homeDir,
        pathPrefix: `${GLOBAL_OPENCODE_PREFIX}/skills/`,
        keepSkillFiles,
        backupSession: options.backupSession,
        label: "Global skill",
        force: options.force,
      });
  warnings.push(...stale.warnings);

  return { promoted, removed: stale.removed, warnings };
}

function projectGlobalAntigravitySkills(options: {
  homeDir: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): ProjectAntigravitySkillsResult {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const promotedAgents: string[] = [];
  const keepSkillFiles = new Set<string>();
  const used = new Set<string>();

  for (const skill of listGeminiGlobalSkillDirs(options.homeDir)) {
    const targetName = safeSkillTargetName(skill.skillName, used, "gemini");
    used.add(targetName);
    keepSkillFiles.add(`${globalAntigravityRelPath(`skills/${safeGlobalSegment(targetName)}`)}/SKILL.md`);
    const copy = copyManagedAntigravitySkill({
      state: options.state,
      homeDir: options.homeDir,
      sourceDir: skill.sourceDir,
      sourceBaseDir: skill.sourceDir,
      targetName,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (copy.promoted) promoted.push(copy.promoted);
    if (copy.warning) warnings.push(copy.warning);
  }

  for (const skill of listGeminiExtensionSkillDirs(options.homeDir)) {
    const targetName = safeSkillTargetName(skill.skillName, used, skill.extensionName);
    used.add(targetName);
    keepSkillFiles.add(`${globalAntigravityRelPath(`skills/${safeGlobalSegment(targetName)}`)}/SKILL.md`);
    const copy = copyManagedAntigravitySkill({
      state: options.state,
      homeDir: options.homeDir,
      sourceDir: skill.sourceDir,
      sourceBaseDir: path.dirname(path.dirname(skill.sourceDir)),
      targetName,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (copy.promoted) promoted.push(copy.promoted);
    if (copy.warning) warnings.push(copy.warning);
  }

  const stale = options.dryRun
    ? { removed: [], removedDetails: [], warnings: [] }
    : removeStaleManagedSkillDirs({
        state: options.state,
        root: options.homeDir,
        pathPrefix: `${GLOBAL_ANTIGRAVITY_PREFIX}/skills/`,
        keepSkillFiles,
        backupSession: options.backupSession,
        label: "Antigravity skill",
        managedKinds: ["skill", "agent"],
        force: options.force,
      });
  warnings.push(...stale.warnings);

  const removedAgents = stale.removedDetails
    .filter((item) => item.kind === "agent")
    .map((item) => item.path);
  const removedSkills = stale.removedDetails
    .filter((item) => item.kind !== "agent")
    .map((item) => item.path);
  return { promoted, removed: removedSkills, promotedAgents, removedAgents, warnings };
}

function projectGlobalAntigravityAgents(options: {
  homeDir: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): ProjectAntigravityFilesResult {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const keepPaths = new Set<string>();
  const used = new Set<string>();

  for (const agent of listGeminiGlobalAgentFiles(options.homeDir)) {
    const targetName = safeSkillTargetName(agent.agentName, used, "gemini");
    used.add(targetName);
    const safeName = safeGlobalSegment(targetName);
    keepPaths.add(globalAntigravityRelPath(`agents/${safeName}`));
    keepPaths.add(globalAntigravityRelPath(`agent_prompts/${safeName}.md`));
    const parsed = parseMarkdownAgent(fs.readFileSync(agent.sourcePath, "utf8"), `Gemini global agent: ${agent.sourceRelPath}`);
    const write = writeManagedAntigravityAgent({
      state: options.state,
      homeDir: options.homeDir,
      targetName,
      description: parsed.description,
      body: parsed.body,
      sourcePath: agent.sourcePath,
      sourceRelPath: agent.sourceRelPath,
      model: parsed.model,
      temperature: parsed.temperature,
      maxSteps: parsed.maxSteps,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (write.promoted) promoted.push(write.promoted);
    if (write.warning) warnings.push(write.warning);
  }

  for (const agent of listGeminiExtensionAgentFiles(options.homeDir)) {
    const targetName = safeSkillTargetName(agent.agentName, used, agent.extensionName);
    used.add(targetName);
    const safeName = safeGlobalSegment(targetName);
    keepPaths.add(globalAntigravityRelPath(`agents/${safeName}`));
    keepPaths.add(globalAntigravityRelPath(`agent_prompts/${safeName}.md`));
    const parsed = parseMarkdownAgent(fs.readFileSync(agent.sourcePath, "utf8"), `Gemini extension agent from ${agent.extensionName}`);
    const write = writeManagedAntigravityAgent({
      state: options.state,
      homeDir: options.homeDir,
      targetName,
      description: parsed.description,
      body: parsed.body,
      sourcePath: agent.sourcePath,
      sourceRelPath: agent.sourceRelPath,
      extensionName: agent.extensionName,
      extensionDir: agent.extensionDir,
      model: parsed.model,
      temperature: parsed.temperature,
      maxSteps: parsed.maxSteps,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (write.promoted) promoted.push(write.promoted);
    if (write.warning) warnings.push(write.warning);
  }

  const staleAgents = options.dryRun
    ? { removed: [], warnings: [] }
    : removeStaleManagedFiles({
        state: options.state,
        root: options.homeDir,
        pathPrefix: `${GLOBAL_ANTIGRAVITY_PREFIX}/agents/`,
        keepPaths,
        backupSession: options.backupSession,
        kind: "agent",
        label: "Antigravity agent",
        force: options.force,
      });
  const stalePrompts = options.dryRun
    ? { removed: [], warnings: [] }
    : removeStaleManagedFiles({
        state: options.state,
        root: options.homeDir,
        pathPrefix: `${GLOBAL_ANTIGRAVITY_PREFIX}/agent_prompts/`,
        keepPaths,
        backupSession: options.backupSession,
        kind: "agent",
        label: "Antigravity agent prompt",
        force: options.force,
      });
  warnings.push(...staleAgents.warnings, ...stalePrompts.warnings);

  return { promoted, removed: [...staleAgents.removed, ...stalePrompts.removed], warnings };
}

function projectGlobalAntigravityWorkflows(options: {
  homeDir: string;
  state: ReturnType<typeof emptySyncState>;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): ProjectAntigravityFilesResult {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const keepPaths = new Set<string>();
  const used = new Set<string>();

  for (const workflow of listGeminiGlobalWorkflowFiles(options.homeDir)) {
    const targetName = safeSkillTargetName(workflow.workflowName, used, "gemini");
    used.add(targetName);
    const reportPath = globalAntigravityRelPath(`global_workflows/${safeGlobalSegment(targetName)}.md`);
    keepPaths.add(reportPath);
    const write = writeManagedAntigravityText({
      state: options.state,
      homeDir: options.homeDir,
      reportPath,
      content: `${fs.readFileSync(workflow.sourcePath, "utf8").trimEnd()}\n`,
      kind: "workflow",
      label: "Antigravity workflow",
      origin: workflow.sourcePath,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (write.promoted) promoted.push(write.promoted);
    if (write.warning) warnings.push(write.warning);
  }

  for (const workflow of listGeminiExtensionWorkflowFiles(options.homeDir)) {
    const targetName = safeSkillTargetName(workflow.workflowName, used, workflow.extensionName);
    used.add(targetName);
    const reportPath = globalAntigravityRelPath(`global_workflows/${safeGlobalSegment(targetName)}.md`);
    keepPaths.add(reportPath);
    const write = writeManagedAntigravityText({
      state: options.state,
      homeDir: options.homeDir,
      reportPath,
      content: `${resolveExtensionPlaceholders(fs.readFileSync(workflow.sourcePath, "utf8"), workflow.extensionDir).trimEnd()}\n`,
      kind: "workflow",
      label: "Antigravity workflow",
      origin: workflow.sourcePath,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (write.promoted) promoted.push(write.promoted);
    if (write.warning) warnings.push(write.warning);
  }

  const stale = options.dryRun
    ? { removed: [], warnings: [] }
    : removeStaleManagedFiles({
        state: options.state,
        root: options.homeDir,
        pathPrefix: `${GLOBAL_ANTIGRAVITY_PREFIX}/global_workflows/`,
        keepPaths,
        backupSession: options.backupSession,
        kind: "workflow",
        label: "Antigravity workflow",
        force: options.force,
      });
  warnings.push(...stale.warnings);

  return { promoted, removed: stale.removed, warnings };
}

function normalizeYoloOptionalPermissions(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(task|external_directory)\s*:/.test(line))
    .join("\n")
    .trimEnd();
}

function hasOnlyOptionalYoloPermissionDrift(file: BuiltInTextFile, currentText: string): boolean {
  if (file.name !== "YOLO") return false;
  return normalizeYoloOptionalPermissions(currentText) === normalizeYoloOptionalPermissions(file.content);
}

function projectExtensionSkills(options: { projectRoot: string; homeDir: string; backupSession: BackupSession; dryRun?: boolean; force?: boolean }): ProjectSkillDirsResult {
  const extensionSkills = listGeminiExtensionSkillDirs(options.homeDir);
  const warnings: string[] = [];
  const promoted: string[] = [];
  const keepSkillFiles = new Set<string>();
  const used = new Set<string>();
  const state = readSyncState(options.projectRoot) ?? emptySyncState(OGB_VERSION);

  for (const skill of extensionSkills) {
    const targetName = safeSkillTargetName(skill.skillName, used, skill.extensionName);
    used.add(targetName);
    const relPath = `.opencode/skills/${targetName}`;
    keepSkillFiles.add(`${relPath}/SKILL.md`);

    if (options.dryRun) {
      promoted.push(relPath);
      continue;
    }

    const copy = copyManagedSkillDir({
      state,
      targetRoot: options.projectRoot,
      reportDir: relPath,
      sourceDir: skill.sourceDir,
      sourceBaseDir: path.dirname(path.dirname(skill.sourceDir)),
      label: "Skill",
      projection: "opencode",
      origin: skill.sourceDir,
      backupSession: options.backupSession,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (copy.promoted) promoted.push(copy.promoted);
    if (copy.warning) warnings.push(copy.warning);
  }

  const stale = options.dryRun
    ? { removed: [], removedDetails: [], warnings: [] }
    : removeStaleManagedSkillDirs({
        state,
        root: options.projectRoot,
        pathPrefix: ".opencode/skills/",
        keepSkillFiles,
        backupSession: options.backupSession,
        label: "Skill",
        force: options.force,
      });
  warnings.push(...stale.warnings);

  if (!options.dryRun) writeSyncState(state, options.projectRoot);
  return { promoted, removed: stale.removed, warnings };
}

function projectBuiltInFiles(options: {
  projectRoot: string;
  dryRun?: boolean;
  force?: boolean;
  relDir: ".opencode/agents" | ".opencode/commands";
  files: BuiltInTextFile[];
  label: "Agent" | "Command";
  removedNames?: string[];
  backupSession: BackupSession;
}): { promoted: string[]; removed: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const promoted: string[] = [];
  const removed: string[] = [];
  const state = readSyncState(options.projectRoot) ?? emptySyncState(OGB_VERSION);

  for (const removedName of options.removedNames ?? []) {
    const relPath = `${options.relDir}/${removedName}.md`;
    const targetPath = path.join(options.projectRoot, options.relDir, `${removedName}.md`);
    const previousHash = managedHashFor(state, relPath, "ogb");

    if (options.dryRun || !fs.existsSync(targetPath) || !previousHash) continue;
    if (!options.force && sha256File(targetPath) !== previousHash) {
      warnings.push(`${options.label} conflict: ${relPath} was edited manually; leaving obsolete file in place`);
      continue;
    }

    options.backupSession.backupExisting(targetPath);
    fs.rmSync(targetPath, { force: true });
    state.managedFiles = state.managedFiles.filter((file) => !(file.path === relPath && file.source === "ogb"));
    removed.push(relPath);
  }

  for (const file of options.files) {
    for (const legacyName of file.legacyNames ?? []) {
      const legacyRelPath = `${options.relDir}/${legacyName}.md`;
      const legacyPath = path.join(options.projectRoot, options.relDir, `${legacyName}.md`);
      const previousHash = managedHashFor(state, legacyRelPath, "ogb");

      if (options.dryRun || !fs.existsSync(legacyPath)) continue;
      if (!previousHash && !options.force) continue;

      if (!options.force && previousHash && sha256File(legacyPath) !== previousHash) {
        warnings.push(`${options.label} conflict: ${legacyRelPath} was edited manually; leaving legacy file in place`);
        continue;
      }

      options.backupSession.backupExisting(legacyPath);
      fs.rmSync(legacyPath, { force: true });
      state.managedFiles = state.managedFiles.filter((file) => !(file.path === legacyRelPath && file.source === "ogb"));
    }

    const relPath = `${options.relDir}/${file.name}.md`;
    const targetPath = path.join(options.projectRoot, options.relDir, `${file.name}.md`);

    if (options.dryRun) {
      promoted.push(relPath);
      continue;
    }

    const previousHash = managedHashFor(state, relPath, "ogb");
    const desiredHash = sha256Text(file.content);
    if (fs.existsSync(targetPath) && sha256File(targetPath) === desiredHash) {
      upsertManagedFile(state, {
        path: relPath,
        sha256: desiredHash,
        source: "ogb",
      });
      promoted.push(relPath);
      continue;
    }
    if (fs.existsSync(targetPath) && !options.force) {
      const currentHash = sha256File(targetPath);
      const currentText = fs.readFileSync(targetPath, "utf8");
      if (hasOnlyOptionalYoloPermissionDrift(file, currentText)) {
        upsertManagedFile(state, {
          path: relPath,
          sha256: currentHash,
          source: "ogb",
        });
        promoted.push(relPath);
        continue;
      }
      if (previousHash !== currentHash) {
        warnings.push(`${options.label} conflict: ${relPath} exists or was edited manually; use --force to overwrite`);
        continue;
      }
    }

    if (fs.existsSync(targetPath)) options.backupSession.backupExisting(targetPath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, "utf8");
    upsertManagedFile(state, {
      path: relPath,
      sha256: sha256File(targetPath),
      source: "ogb",
    });
    promoted.push(relPath);
  }

  if (!options.dryRun) writeSyncState(state, options.projectRoot);
  return { promoted, removed, warnings };
}

function syncGlobalOpenCode(paths: ReturnType<typeof resolveProjectPaths>, options: SyncOptions): SyncReport {
  const globalRoot = globalOpenCodeConfigDir({ homeDir: paths.homeDir });
  const backupSession = createBackupSession({
    bridgeConfigDir: paths.bridgeConfigDir,
    operation: "sync",
    roots: [
      { root: globalRoot, prefix: "global-opencode" },
      { root: paths.homeDir, prefix: "home" },
    ],
    dryRun: options.dryRun,
  });
  const ogbConfig = readOgbConfig(paths.projectRoot, paths.homeDir);
  const routing = createModelRoutingContext({
    projectRoot: paths.projectRoot,
    limitsPath: paths.limitsPath,
    enabled: ogbConfig.modelFallbacks?.routing?.enabled,
    thresholdPercent: ogbConfig.modelFallbacks?.routing?.thresholdPercent,
  });
  const state = readSyncState(paths.projectRoot, paths.homeDir) ?? emptySyncState(OGB_VERSION);
  const warnings: string[] = [];
  const mcpEnvStore = syncMcpEnvStore({
    projectRoot: paths.homeDir,
    homeDir: paths.homeDir,
    dryRun: options.dryRun,
  });
  warnings.push(...mcpEnvStore.warnings);
  const usedCommandRelPaths = new Set<string>();
  const usedAgentRelPaths = new Set<string>();
  const modelFallbacks: GeminiExtensionProjectionMap["modelFallbacks"] = [];

  const projectedContext = projectGlobalGeminiContext({
    homeDir: paths.homeDir,
    globalRoot,
    expandedPath: paths.expandedGeminiPath,
    state,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  if (projectedContext.warning) warnings.push(projectedContext.warning);

  const globalMcp = openCodeMcpFromInventory(paths.homeDir, paths.homeDir);
  warnings.push(...globalMcp.warnings);
  const hasGlobalMcp = Object.keys(globalMcp.mcp).length > 0;
  const projectedConfig = projectedContext.expanded || hasGlobalMcp
    ? ensureGlobalOpenCodeConfig({
        state,
        globalRoot,
        expandedPath: projectedContext.expanded ? paths.expandedGeminiPath : undefined,
        mcp: globalMcp.mcp,
        backupSession,
        dryRun: options.dryRun,
        force: options.force,
      })
    : { mcpServers: [] };
  if (projectedConfig.warning) warnings.push(projectedConfig.warning);

  const projectedCommands = projectGlobalGeminiCommands({
    homeDir: paths.homeDir,
    globalRoot,
    state,
    backupSession,
    usedCommandRelPaths,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedCommands.warnings);

  const projectedExtensionCommands = projectGlobalGeminiExtensionCommands({
    homeDir: paths.homeDir,
    globalRoot,
    state,
    backupSession,
    usedCommandRelPaths,
    dryRun: options.dryRun,
    force: options.force,
  });
  const extensionProjectionWarnings = [...projectedExtensionCommands.warnings];
  warnings.push(...projectedExtensionCommands.warnings);

  const projectedAgents = projectGlobalGeminiAgents({
    homeDir: paths.homeDir,
    globalRoot,
    state,
    backupSession,
    usedAgentRelPaths,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAgents.warnings);

  const projectedExtensionAgents = projectGlobalGeminiExtensionAgents({
    homeDir: paths.homeDir,
    globalRoot,
    state,
    config: ogbConfig,
    routing,
    modelFallbacks,
    backupSession,
    usedAgentRelPaths,
    dryRun: options.dryRun,
    force: options.force,
  });
  extensionProjectionWarnings.push(...projectedExtensionAgents.warnings);
  warnings.push(...projectedExtensionAgents.warnings);

  const projectedSkills = projectGlobalGeminiSkills({
    homeDir: paths.homeDir,
    state,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedSkills.warnings);

  const projectedAntigravitySkills = projectGlobalAntigravitySkills({
    homeDir: paths.homeDir,
    state,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravitySkills.warnings);

  const projectedAntigravityAgents = projectGlobalAntigravityAgents({
    homeDir: paths.homeDir,
    state,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravityAgents.warnings);

  const projectedAntigravityWorkflows = projectGlobalAntigravityWorkflows({
    homeDir: paths.homeDir,
    state,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravityWorkflows.warnings);

  const projectedAntigravityMcps = projectGlobalAntigravityMcps({
    homeDir: paths.homeDir,
    state,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravityMcps.warnings);

  const projectedExtensionMap = writeGlobalExtensionMap({
    paths,
    state,
    commands: projectedExtensionCommands.mapCommands,
    agents: projectedExtensionAgents.mapAgents,
    projectedCommands: projectedExtensionCommands.promoted,
    projectedAgents: projectedExtensionAgents.promoted,
    modelFallbacks,
    warnings: extensionProjectionWarnings,
    dryRun: options.dryRun,
  });

  const rulesync: RulesyncProjectionResult = {
    status: options.dryRun ? "preview" : "skipped",
    available: false,
    promoted: [],
    conflicts: [],
    backups: [],
    command: [],
    skippedReason: "Diretorio home detectado; Rulesync de projeto pulado porque o sync esta usando os arquivos globais do OpenCode/Gemini.",
  };

  if (!options.dryRun) {
    writeModelRoutingReport(paths.modelRoutingPath, routing.report);
    upsertManagedFile(state, {
      path: ".config/opencode-gemini-bridge/generated/ogb-model-routing.json",
      sha256: sha256File(paths.modelRoutingPath),
      source: "ogb",
    });
    state.lastRulesync = {
      status: rulesync.status,
      command: rulesync.command,
      promoted: rulesync.promoted,
      conflicts: rulesync.conflicts,
      skippedReason: rulesync.skippedReason,
    };
    writeSyncState(state, paths.projectRoot, paths.homeDir);
  }

  const report: SyncReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    generatedConfigPath: paths.expandedGeminiPath,
    projectedAgents: projectedAgents.promoted,
    projectedExtensionAgents: projectedExtensionAgents.promoted,
    removedAgents: [],
    projectedCommands: [...projectedCommands.promoted, ...projectedExtensionCommands.promoted],
    projectedExtensionCommands: projectedExtensionCommands.promoted,
    removedExtensionCommands: [],
    projectedSkills: projectedSkills.promoted,
    removedSkills: projectedSkills.removed,
    projectedAntigravitySkills: projectedAntigravitySkills.promoted,
    removedAntigravitySkills: projectedAntigravitySkills.removed,
    projectedAntigravityAgents: projectedAntigravityAgents.promoted,
    removedAntigravityAgents: [...projectedAntigravitySkills.removedAgents, ...projectedAntigravityAgents.removed],
    projectedAntigravityWorkflows: projectedAntigravityWorkflows.promoted,
    removedAntigravityWorkflows: projectedAntigravityWorkflows.removed,
    projectedAntigravityMcps: projectedAntigravityMcps.promoted,
    removedAntigravityMcps: projectedAntigravityMcps.removed,
    projectedTuiFiles: [],
    projectedExternalPlugins: [],
    projectedExternalIntegrationFiles: [],
    rulesync,
    backups: backupSession.backups,
    warnings: [...new Set([...warnings, ...backupSession.retention.warnings])],
  };

  if (!options.silent) {
    const action = options.dryRun ? "Would sync" : "Synced";
    if (projectedContext.expanded) console.log(`${options.dryRun ? "Would generate" : "Generated"} global expanded Gemini context at ${projectedContext.expanded}`);
    if (projectedConfig.promoted) console.log(`${action} global OpenCode config in ${projectedConfig.promoted}`);
    if (projectedConfig.mcpServers.length > 0) console.log(`${action} ${projectedConfig.mcpServers.length} global Gemini MCP server(s)`);
    if (projectedContext.removed) console.log(`Removed stale generated global rules file ${projectedContext.removed}`);
    if (projectedCommands.promoted.length > 0) console.log(`${action} ${projectedCommands.promoted.length} global Gemini command(s)`);
    if (projectedExtensionCommands.promoted.length > 0) console.log(`${action} ${projectedExtensionCommands.promoted.length} global Gemini extension command(s)`);
    if (projectedAgents.promoted.length > 0) console.log(`${action} ${projectedAgents.promoted.length} global Gemini agent(s)`);
    if (projectedExtensionAgents.promoted.length > 0) console.log(`${action} ${projectedExtensionAgents.promoted.length} global Gemini extension agent(s)`);
    if (modelFallbacks.length > 0) console.log(`${action} ${modelFallbacks.length} global Gemini extension model fallback(s)`);
    if (projectedSkills.promoted.length > 0) console.log(`${action} ${projectedSkills.promoted.length} global Gemini skill(s)`);
    if (projectedSkills.removed.length > 0) console.log(`Removed ${projectedSkills.removed.length} stale global Gemini skill(s)`);
    if (projectedAntigravitySkills.promoted.length > 0) console.log(`${action} ${projectedAntigravitySkills.promoted.length} global Antigravity skill(s)`);
    if (projectedAntigravitySkills.removed.length > 0) console.log(`Removed ${projectedAntigravitySkills.removed.length} stale global Antigravity skill(s)`);
    if (projectedAntigravityAgents.promoted.length > 0) console.log(`${action} ${projectedAntigravityAgents.promoted.length} global Antigravity custom agent(s)`);
    if (report.removedAntigravityAgents.length > 0) console.log(`Removed ${report.removedAntigravityAgents.length} stale global Antigravity custom agent file(s)`);
    if (projectedAntigravityWorkflows.promoted.length > 0) console.log(`${action} ${projectedAntigravityWorkflows.promoted.length} global Antigravity workflow(s)`);
    if (projectedAntigravityWorkflows.removed.length > 0) console.log(`Removed ${projectedAntigravityWorkflows.removed.length} stale global Antigravity workflow(s)`);
    if (projectedAntigravityMcps.promoted.length > 0) console.log(`${action} ${projectedAntigravityMcps.promoted.length} global Antigravity MCP server(s)`);
    if (projectedAntigravityMcps.removed.length > 0) console.log(`Removed ${projectedAntigravityMcps.removed.length} stale global Antigravity MCP server(s)`);
    if (projectedExtensionMap.promoted) console.log(`${options.dryRun ? "Would generate" : "Generated"} global Gemini extension map at ${projectedExtensionMap.promoted}`);
    if (!projectedConfig.promoted && report.projectedCommands.length === 0 && report.projectedAgents.length === 0 && report.projectedExtensionAgents.length === 0 && report.projectedSkills.length === 0 && report.projectedAntigravitySkills.length === 0 && report.projectedAntigravityAgents.length === 0 && report.projectedAntigravityWorkflows.length === 0 && report.projectedAntigravityMcps.length === 0) {
      console.log("No global Gemini rules, MCPs, commands, agents, or skills found to sync.");
    }
  }

  return report;
}

export function syncToOpenCode(options: SyncOptions = {}): SyncReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  if (paths.homeMode) {
    return syncGlobalOpenCode(paths, options);
  }
  const backupSession = createBackupSession({
    bridgeConfigDir: paths.bridgeConfigDir,
    operation: "sync",
    roots: [
      { root: paths.projectRoot, prefix: "project" },
      { root: paths.homeDir, prefix: "home" },
    ],
    dryRun: options.dryRun,
  });
  const ogbConfig = readOgbConfig(paths.projectRoot, paths.homeDir);
  const openCodePlugins = externalOpenCodePlugins(ogbConfig);
  const tuiPlugins = externalTuiPlugins(ogbConfig);
  writeExpandedGeminiContext({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    output: paths.expandedGeminiPath,
    dryRun: options.dryRun,
  });

  const mcpEnvStore = syncMcpEnvStore({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    dryRun: options.dryRun,
  });
  const generatedResult = generatedOpenCodeConfig(paths.projectRoot, paths.homeDir);
  const generated = generatedResult.config;
  const mcp = generated.mcp as Record<string, unknown>;
  const warnings: string[] = [...mcpEnvStore.warnings, ...generatedResult.warnings];
  let projectConfigBackups: BackupRecord[] = [];
  let projectConfigRetentionWarnings: string[] = [];

  if (options.dryRun) {
    if (!options.silent) console.log(JSON.stringify(generated, null, 2));
  } else {
    fs.mkdirSync(path.dirname(paths.generatedOpenCodeConfigPath), { recursive: true });
    fs.writeFileSync(paths.generatedOpenCodeConfigPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");

    const state = readSyncState(paths.projectRoot) ?? emptySyncState(OGB_VERSION);
    upsertManagedFile(state, {
      path: ".opencode/generated/opencode.generated.json",
      sha256: sha256File(paths.generatedOpenCodeConfigPath),
      source: "ogb",
    });
    writeSyncState(state, paths.projectRoot);

    const configResult = ensureProjectConfig({
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      force: options.force,
      mcp,
      plugins: openCodePlugins,
      defaultAgent: defaultOpenCodeAgent(ogbConfig),
    });
    projectConfigBackups = configResult.backups ?? [];
    projectConfigRetentionWarnings = configResult.retention?.warnings ?? [];
    if (configResult.status === "conflict") warnings.push(configResult.message ?? "opencode.jsonc conflict");
  }

  const projectedSkills = projectExtensionSkills({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedSkills.warnings);

  const antigravityState = readSyncState(paths.projectRoot) ?? emptySyncState(OGB_VERSION);
  const projectedAntigravitySkills = projectGlobalAntigravitySkills({
    homeDir: paths.homeDir,
    state: antigravityState,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravitySkills.warnings);
  const projectedAntigravityAgents = projectGlobalAntigravityAgents({
    homeDir: paths.homeDir,
    state: antigravityState,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravityAgents.warnings);
  const projectedAntigravityWorkflows = projectGlobalAntigravityWorkflows({
    homeDir: paths.homeDir,
    state: antigravityState,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravityWorkflows.warnings);
  const projectedAntigravityMcps = projectGlobalAntigravityMcps({
    homeDir: paths.homeDir,
    state: antigravityState,
    backupSession,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedAntigravityMcps.warnings);
  if (!options.dryRun) writeSyncState(antigravityState, paths.projectRoot);

  const projectedTui = ensureTuiSidebar({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    dryRun: options.dryRun,
    force: options.force,
    extraPlugins: tuiPlugins,
    backupSession,
  });
  warnings.push(...projectedTui.warnings);

  const rulesync = projectRulesyncProjection({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    mode: options.rulesyncMode ?? "auto",
    dryRun: options.dryRun,
    force: options.force,
    features: options.rulesyncFeatures,
  });

  if (rulesync.status === "skipped" && rulesync.skippedReason) warnings.push(rulesync.skippedReason);
  if (rulesync.status === "partial") warnings.push(rulesync.stderr || "Rulesync partially completed");
  if (rulesync.status === "error") {
    if (rulesync.conflicts.length > 0) warnings.push(`Rulesync conflicts: ${rulesync.conflicts.join(", ")}`);
    else warnings.push(rulesync.stderr || rulesync.skippedReason || "Rulesync failed");
  }

  const projectedAgents = projectBuiltInFiles({
    projectRoot: paths.projectRoot,
    dryRun: options.dryRun,
    force: options.force,
    relDir: ".opencode/agents",
    files: BUILT_IN_AGENTS,
    label: "Agent",
    removedNames: REMOVED_BUILT_IN_AGENT_NAMES,
    backupSession,
  });
  warnings.push(...projectedAgents.warnings);

  const projectedCommands = projectBuiltInFiles({
    projectRoot: paths.projectRoot,
    dryRun: options.dryRun,
    force: options.force,
    relDir: ".opencode/commands",
    files: BUILT_IN_COMMANDS,
    label: "Command",
    removedNames: REMOVED_BUILT_IN_COMMAND_NAMES,
    backupSession,
  });
  warnings.push(...projectedCommands.warnings);

  const projectedExtensionCommands = projectGeminiExtensionCommands({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    dryRun: options.dryRun,
    force: options.force,
  });
  warnings.push(...projectedExtensionCommands.warnings);

  const projectedExternalIntegrations = projectExternalIntegrations({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    config: ogbConfig,
    extensionMap: projectedExtensionCommands.map,
    dryRun: options.dryRun,
    backupSession,
  });
  warnings.push(...projectedExternalIntegrations.warnings);

  const report: SyncReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    generatedConfigPath: paths.generatedOpenCodeConfigPath,
    projectedAgents: projectedAgents.promoted,
    projectedExtensionAgents: projectedExtensionCommands.projectedAgents,
    projectedModelFallbackConfig: projectedExtensionCommands.projectedModelFallbackConfig,
    projectedModelRoutingConfig: projectedExtensionCommands.projectedModelRoutingConfig,
    removedAgents: projectedAgents.removed,
    projectedCommands: [...projectedCommands.promoted, ...projectedExtensionCommands.projectedCommands],
    projectedExtensionCommands: projectedExtensionCommands.projectedCommands,
    removedExtensionCommands: projectedExtensionCommands.removedCommands,
    projectedSkills: projectedSkills.promoted,
    removedSkills: projectedSkills.removed,
    projectedAntigravitySkills: projectedAntigravitySkills.promoted,
    removedAntigravitySkills: projectedAntigravitySkills.removed,
    projectedAntigravityAgents: projectedAntigravityAgents.promoted,
    removedAntigravityAgents: [...projectedAntigravitySkills.removedAgents, ...projectedAntigravityAgents.removed],
    projectedAntigravityWorkflows: projectedAntigravityWorkflows.promoted,
    removedAntigravityWorkflows: projectedAntigravityWorkflows.removed,
    projectedAntigravityMcps: projectedAntigravityMcps.promoted,
    removedAntigravityMcps: projectedAntigravityMcps.removed,
    projectedTuiFiles: [projectedTui.plugin, projectedTui.config]
      .filter((item) => item.status === "created" || item.status === "updated" || item.status === "preview")
      .map((item) => item.relPath),
    projectedExternalPlugins: [...new Set([...projectedExternalIntegrations.openCodePlugins, ...projectedExternalIntegrations.tuiPlugins])],
    projectedExternalIntegrationFiles: projectedExternalIntegrations.writes
      .filter((item) => item.status === "created" || item.status === "updated" || item.status === "preview")
      .map((item) => item.relPath),
    rulesync,
    backups: [
      ...projectConfigBackups,
      ...backupSession.backups,
      ...projectedExtensionCommands.backups,
      ...rulesync.backups,
    ],
    warnings: [...new Set([
      ...warnings,
      ...projectConfigRetentionWarnings,
      ...backupSession.retention.warnings,
      ...(rulesync.retention?.warnings ?? []),
    ])],
  };

  if (!options.dryRun) {
    const state = readSyncState(paths.projectRoot) ?? emptySyncState(OGB_VERSION);
    state.lastRulesync = {
      status: rulesync.status,
      command: rulesync.command,
      promoted: rulesync.promoted,
      conflicts: rulesync.conflicts,
      skippedReason: rulesync.skippedReason,
    };
    writeSyncState(state, paths.projectRoot);
  }

  if (!options.silent) {
    console.log(`${options.dryRun ? "Would generate" : "Generated"} ${paths.generatedOpenCodeConfigPath}`);
    if (projectedAgents.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedAgents.promoted.length} built-in agent(s)`);
    if (projectedExtensionCommands.projectedAgents.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedExtensionCommands.projectedAgents.length} Gemini extension subagent(s)`);
    if (projectedExtensionCommands.projectedModelRoutingConfig) console.log(`${options.dryRun ? "Would project" : "Projected"} OGB model routing report`);
    if (projectedExtensionCommands.projectedModelFallbackConfig) console.log(`${options.dryRun ? "Would project" : "Projected"} compatibility model fallback config`);
    if (projectedExtensionCommands.removedAgents.length > 0) console.log(`Removed ${projectedExtensionCommands.removedAgents.length} stale Gemini extension subagent(s)`);
    if (projectedAgents.removed.length > 0) console.log(`Removed ${projectedAgents.removed.length} obsolete built-in agent(s)`);
    if (projectedCommands.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedCommands.promoted.length} built-in command(s)`);
    if (projectedExtensionCommands.projectedCommands.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedExtensionCommands.projectedCommands.length} Gemini extension command(s)`);
    if (projectedExtensionCommands.removedCommands.length > 0) console.log(`Removed ${projectedExtensionCommands.removedCommands.length} stale Gemini extension command(s)`);
    if (projectedSkills.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedSkills.promoted.length} Gemini extension skill(s)`);
    if (projectedSkills.removed.length > 0) console.log(`Removed ${projectedSkills.removed.length} stale Gemini extension skill(s)`);
    if (projectedAntigravitySkills.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedAntigravitySkills.promoted.length} global Antigravity skill(s)`);
    if (projectedAntigravitySkills.removed.length > 0) console.log(`Removed ${projectedAntigravitySkills.removed.length} stale global Antigravity skill(s)`);
    if (projectedAntigravityAgents.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedAntigravityAgents.promoted.length} global Antigravity custom agent(s)`);
    if (report.removedAntigravityAgents.length > 0) console.log(`Removed ${report.removedAntigravityAgents.length} stale global Antigravity custom agent file(s)`);
    if (projectedAntigravityWorkflows.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedAntigravityWorkflows.promoted.length} global Antigravity workflow(s)`);
    if (projectedAntigravityWorkflows.removed.length > 0) console.log(`Removed ${projectedAntigravityWorkflows.removed.length} stale global Antigravity workflow(s)`);
    if (projectedAntigravityMcps.promoted.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${projectedAntigravityMcps.promoted.length} global Antigravity MCP server(s)`);
    if (projectedAntigravityMcps.removed.length > 0) console.log(`Removed ${projectedAntigravityMcps.removed.length} stale global Antigravity MCP server(s)`);
    if (report.projectedTuiFiles.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${report.projectedTuiFiles.length} TUI sidebar file(s)`);
    if (report.projectedExternalPlugins.length > 0) console.log(`${options.dryRun ? "Would enable" : "Enabled"} external plugin(s): ${report.projectedExternalPlugins.join(", ")}`);
    if (report.projectedExternalIntegrationFiles.length > 0) console.log(`${options.dryRun ? "Would project" : "Projected"} ${report.projectedExternalIntegrationFiles.length} external integration file(s)`);
    if (rulesync.status === "applied") console.log(`Rulesync promoted ${rulesync.promoted.length} file(s)`);
    if (rulesync.status === "partial") console.log(`Rulesync partially completed; promoted ${rulesync.promoted.length} file(s)`);
    if (rulesync.status === "preview") console.log("Rulesync dry-run completed");
    if (rulesync.status === "skipped") console.log(`Rulesync skipped: ${rulesync.skippedReason}`);
    if (rulesync.status === "error" && rulesync.conflicts.length > 0) console.log(`Rulesync conflicts: ${rulesync.conflicts.join(", ")}`);
    else if (rulesync.status === "error") console.log(`Rulesync failed: ${rulesync.stderr || rulesync.skippedReason || "unknown error"}`);
  }

  if (options.rulesyncMode === "require" && rulesync.status === "error") process.exitCode = 2;
  if (options.rulesyncMode === "require" && rulesync.status === "partial") process.exitCode = 1;

  return report;
}
