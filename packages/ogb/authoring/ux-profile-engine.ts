import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { createPlatformAdapter, type PlatformAdapter } from "../src/platform-adapter.js";
import { isSecretLikeRelPath, secretPatternLabels } from "../src/security.js";
import { STARTUP_SYNC_PLUGIN_SOURCE } from "../src/setup-opencode.js";
import { readSyncState, type ManagedFileState } from "../src/sync-state.js";
import { TUI_SIDEBAR_PLUGIN_SOURCE } from "../src/tui-sidebar.js";
import { OGB_VERSION } from "../src/types.js";
import { UX_PROFILE_SCHEMA, type UxProfilePreset } from "../src/ux-profile.js";
import { UX_PROFILE_PRESET } from "../src/ux-profile.generated.js";

export type UxProfileAuthoringScope = "opencode" | "bridge";
export type UxProfileCandidateKind = "file" | "config-field" | "package-deps";
export type UxProfileCandidateStatus = "new" | "changed" | "unchanged" | "blocked";

export interface UxProfileAuthoringCandidate {
  id: string;
  category: string;
  kind: UxProfileCandidateKind;
  scope: UxProfileAuthoringScope;
  relPath: string;
  target: string;
  summary: string;
  selectable: boolean;
  selectedByDefault: boolean;
  status: UxProfileCandidateStatus;
  value?: unknown;
  preview?: string;
  warnings: string[];
}

export interface UxProfileExcludedItem {
  scope: UxProfileAuthoringScope;
  relPath: string;
  reason: string;
  detail?: string;
}

export interface UxProfileInventory {
  schema: "opencode-gemini-bridge.ux-profile-authoring.inventory.v1";
  version: string;
  homeRelPath: "~";
  globalConfigRelPath: string;
  bridgeConfigRelPath: string;
  candidates: UxProfileAuthoringCandidate[];
  excluded: UxProfileExcludedItem[];
  warnings: string[];
  blocked: boolean;
}

export interface UxProfileEngineOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  bridgeConfigDir?: string;
  outputPath?: string;
  artifactsDir?: string;
}

export interface UxProfileWriteOptions extends UxProfileEngineOptions {
  selectedIds?: string[];
  write?: boolean;
  dryRun?: boolean;
}

export interface UxProfileWriteResult {
  schema: "opencode-gemini-bridge.ux-profile-authoring.write-result.v1";
  status: "preview" | "written" | "blocked";
  selectedIds: string[];
  outputRelPath: string;
  artifactsRelPath: string;
  warnings: string[];
  blocked: boolean;
  manifest?: UxProfileSnapshotManifest;
}

export interface UxProfileSnapshotManifest {
  schema: "opencode-gemini-bridge.ux-profile-authoring.manifest.v1";
  version: string;
  presetSchema: typeof UX_PROFILE_SCHEMA;
  selected: Array<{
    id: string;
    category: string;
    kind: UxProfileCandidateKind;
    source: string;
    target: string;
    status: UxProfileCandidateStatus;
    warnings: string[];
  }>;
  excluded: UxProfileExcludedItem[];
  warnings: string[];
}

interface ResolvedPaths {
  adapter: PlatformAdapter;
  packageRoot: string;
  repoRoot: string;
  globalConfigDir: string;
  bridgeConfigDir: string;
  outputPath: string;
  artifactsDir: string;
  managedFiles: Map<string, ManagedFileState["source"]>;
}

interface ParsedFile {
  exists: boolean;
  text?: string;
  value?: unknown;
  error?: string;
}

const INVENTORY_SCHEMA = "opencode-gemini-bridge.ux-profile-authoring.inventory.v1" as const;
const WRITE_RESULT_SCHEMA = "opencode-gemini-bridge.ux-profile-authoring.write-result.v1" as const;
const MANIFEST_SCHEMA = "opencode-gemini-bridge.ux-profile-authoring.manifest.v1" as const;
const MAX_PREVIEW_CHARS = 3000;

const OPENCODE_FIELD_CANDIDATES: Array<{
  id: string;
  path: Array<string | number>;
  presetPath: Array<string | number>;
  summary: string;
}> = [
  { id: "opencode:$schema", path: ["$schema"], presetPath: ["globalConfig", "schemaUrl"], summary: "OpenCode schema URL" },
  { id: "opencode:plugin", path: ["plugin"], presetPath: ["safePlugins"], summary: "Plugins globais instalaveis do UX profile" },
  { id: "opencode:share", path: ["share"], presetPath: ["globalConfig", "share"], summary: "Politica de compartilhamento" },
  { id: "opencode:autoupdate", path: ["autoupdate"], presetPath: ["globalConfig", "autoupdate"], summary: "Politica de autoupdate do OpenCode" },
  { id: "opencode:small_model", path: ["small_model"], presetPath: ["globalConfig", "smallModel"], summary: "Modelo pequeno default" },
  { id: "opencode:default_agent", path: ["default_agent"], presetPath: ["globalConfig", "defaultAgent"], summary: "Agente default global" },
  { id: "opencode:agent.build", path: ["agent", "build"], presetPath: ["globalConfig", "agent", "build"], summary: "Configuracao do agente build" },
  { id: "opencode:agent.agent", path: ["agent", "agent"], presetPath: ["globalConfig", "agent", "agent"], summary: "Configuracao do agente primario" },
  { id: "opencode:agent.compaction", path: ["agent", "compaction"], presetPath: ["globalConfig", "agent", "compaction"], summary: "Modelo de compactacao do agente" },
  { id: "opencode:watcher.ignore", path: ["watcher", "ignore"], presetPath: ["globalConfig", "watcherIgnore"], summary: "Padroes ignorados pelo watcher" },
  { id: "opencode:tool_output", path: ["tool_output"], presetPath: ["globalConfig", "toolOutput"], summary: "Limites de saida de ferramentas" },
  { id: "opencode:compaction", path: ["compaction"], presetPath: ["globalConfig", "compaction"], summary: "Politica global de compactacao" },
  { id: "opencode:permission", path: ["permission"], presetPath: ["globalConfig", "permission"], summary: "Permissoes globais" },
];

const TUI_FIELD_CANDIDATES: Array<{
  id: string;
  path: Array<string | number>;
  summary: string;
}> = [
  { id: "tui:$schema", path: ["$schema"], summary: "Schema do tui.json" },
  { id: "tui:plugin", path: ["plugin"], summary: "Plugins carregados pela TUI global" },
  { id: "tui:theme", path: ["theme"], summary: "Tema da TUI" },
  { id: "tui:mouse", path: ["mouse"], summary: "Preferencia de mouse da TUI" },
  { id: "tui:scroll_speed", path: ["scroll_speed"], summary: "Velocidade de scroll da TUI" },
];

const OPENCODE_KNOWN_TOP_LEVEL = new Set([
  "$schema",
  "plugin",
  "share",
  "autoupdate",
  "small_model",
  "default_agent",
  "agent",
  "watcher",
  "tool_output",
  "compaction",
  "permission",
]);

const OPENCODE_KNOWN_AGENT_KEYS = new Set(["build", "agent", "compaction"]);
const OPENCODE_KNOWN_WATCHER_KEYS = new Set(["ignore"]);
const TUI_KNOWN_TOP_LEVEL = new Set(TUI_FIELD_CANDIDATES.map((field) => String(field.path[0])));

function packageRootFromEngine(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function resolvePaths(options: UxProfileEngineOptions = {}): ResolvedPaths {
  const packageRoot = packageRootFromEngine();
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const adapter = createPlatformAdapter({
    platform: options.platform,
    homeDir: options.homeDir ?? os.homedir(),
    env: options.env,
  });
  return {
    adapter,
    packageRoot,
    repoRoot,
    globalConfigDir: options.configDir ? adapter.resolvePath(options.configDir) : adapter.globalConfigDir,
    bridgeConfigDir: options.bridgeConfigDir ? adapter.resolvePath(options.bridgeConfigDir) : adapter.bridgeConfigDir,
    outputPath: path.resolve(options.outputPath ?? path.join(packageRoot, "src", "ux-profile.generated.ts")),
    artifactsDir: path.resolve(options.artifactsDir ?? path.join(repoRoot, "artifacts", "ux-profile-snapshot")),
    managedFiles: new Map(
      (readSyncState(adapter.homeDir, adapter.homeDir)?.managedFiles ?? [])
        .map((file) => [toPosixPath(file.path), file.source]),
    ),
  };
}

function toPosixPath(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).join("/");
}

function displayRootPath(root: string, homeDir: string, pathApi: typeof path): string {
  const relative = pathApi.relative(homeDir, root);
  if (!relative || relative.startsWith("..") || pathApi.isAbsolute(relative)) return toPosixPath(root);
  return toPosixPath(pathApi.join("~", relative));
}

function sourceLabel(candidate: Pick<UxProfileAuthoringCandidate, "scope" | "relPath">): string {
  return candidate.scope === "bridge"
    ? `.config/opencode-gemini-bridge/${candidate.relPath}`
    : `.config/opencode/${candidate.relPath}`;
}

function managedReportPath(scope: UxProfileAuthoringScope, relPath: string): string {
  const prefix = scope === "bridge" ? ".config/opencode-gemini-bridge" : ".config/opencode";
  return `${prefix}/${toPosixPath(relPath)}`;
}

function managedExclusion(paths: ResolvedPaths, scope: UxProfileAuthoringScope, relPath: string): UxProfileExcludedItem | undefined {
  const source = paths.managedFiles.get(managedReportPath(scope, relPath));
  if (!source) return undefined;
  return {
    scope,
    relPath,
    reason: source === "rulesync" ? "managed_by_rulesync" : "managed_by_ogb_sync",
  };
}

function generatedMarkerReason(text: string): string | undefined {
  if (/SOURCE_KIND:\s*gemini-/i.test(text)) return "projected_from_gemini";
  if (/Generated from OGB|Generated by OGB|Generated by opencode-gemini-bridge/i.test(text)) return "generated_by_ogb";
  return undefined;
}

function ogbRuntimeProfileFileExclusion(id: string, text: string): UxProfileExcludedItem | undefined {
  if (id === "file:plugins/ogb-startup-sync.js") {
    return {
      scope: "opencode",
      relPath: "plugins/ogb-startup-sync.js",
      reason: "provided_by_ogb_runtime",
      detail: text === STARTUP_SYNC_PLUGIN_SOURCE
        ? "startup sync plugin is sourced from the OGB repository"
        : "local startup sync plugin differs; repository source remains authoritative",
    };
  }
  if (id === "file:tui-plugins/ogb-sidebar.js") {
    return {
      scope: "opencode",
      relPath: "tui-plugins/ogb-sidebar.js",
      reason: "provided_by_ogb_runtime",
      detail: text === TUI_SIDEBAR_PLUGIN_SOURCE
        ? "TUI sidebar plugin is sourced from the OGB repository"
        : "local TUI sidebar plugin differs; repository source remains authoritative",
    };
  }
  return undefined;
}

function readText(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return undefined;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function readJsoncFile(filePath: string): ParsedFile {
  if (!fs.existsSync(filePath)) return { exists: false };
  const text = readText(filePath);
  if (text === undefined) return { exists: true, error: "file is not readable text or is larger than 1 MiB" };
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const value = parseJsonc(text, errors);
  if (errors.length > 0) return { exists: true, text, error: "invalid JSONC syntax" };
  return { exists: true, text, value };
}

function readJsonFile(filePath: string): ParsedFile {
  if (!fs.existsSync(filePath)) return { exists: false };
  const text = readText(filePath);
  if (text === undefined) return { exists: true, error: "file is not readable text or is larger than 1 MiB" };
  try {
    return { exists: true, text, value: JSON.parse(text) };
  } catch {
    return { exists: true, text, error: "invalid JSON syntax" };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function valueAt(root: unknown, keyPath: Array<string | number>): unknown {
  let current = root;
  for (const key of keyPath) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[String(key)];
  }
  return current;
}

function setValueAt(root: Record<string, unknown>, keyPath: Array<string | number>, value: unknown): void {
  let current = root;
  for (const key of keyPath.slice(0, -1)) {
    const name = String(key);
    const next = current[name];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[name] = {};
    current = current[name] as Record<string, unknown>;
  }
  current[String(keyPath[keyPath.length - 1])] = value;
}

function deleteValueAt(root: Record<string, unknown>, keyPath: Array<string | number>): void {
  let current: unknown = root;
  for (const key of keyPath.slice(0, -1)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return;
    current = (current as Record<string, unknown>)[String(key)];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  delete (current as Record<string, unknown>)[String(keyPath[keyPath.length - 1])];
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortedValue(item)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortedValue(value));
}

function clonePreset(preset: UxProfilePreset = UX_PROFILE_PRESET): UxProfilePreset {
  return JSON.parse(JSON.stringify(preset)) as UxProfilePreset;
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function previewText(text: string): string {
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n...` : text;
}

function secretWarnings(relPath: string, text: string): string[] {
  const warnings: string[] = [];
  if (isSecretLikeRelPath(relPath)) warnings.push("secret-like path");
  for (const label of secretPatternLabels(text)) warnings.push(`high-confidence secret: ${label}`);
  return warnings;
}

function candidateStatus(value: unknown, presetValue: unknown): UxProfileCandidateStatus {
  return presetValue === undefined ? "new" : sameValue(value, presetValue) ? "unchanged" : "changed";
}

function addValueCandidate(options: {
  candidates: UxProfileAuthoringCandidate[];
  id: string;
  category: string;
  kind: UxProfileCandidateKind;
  scope: UxProfileAuthoringScope;
  relPath: string;
  target: string;
  summary: string;
  value: unknown;
  presetValue: unknown;
  warnings?: string[];
}): void {
  const serialized = JSON.stringify(options.value, null, 2);
  const warnings = [...(options.warnings ?? []), ...secretWarnings(options.relPath, serialized)];
  const blocked = warnings.some((warning) => warning.startsWith("high-confidence secret:"));
  const status = blocked ? "blocked" : candidateStatus(options.value, options.presetValue);
  options.candidates.push({
    id: options.id,
    category: options.category,
    kind: options.kind,
    scope: options.scope,
    relPath: options.relPath,
    target: options.target,
    summary: options.summary,
    selectable: !blocked,
    selectedByDefault: !blocked && status === "unchanged",
    status,
    value: blocked ? undefined : options.value,
    preview: blocked ? undefined : previewText(serialized),
    warnings,
  });
}

function addTextCandidate(options: {
  candidates: UxProfileAuthoringCandidate[];
  id: string;
  category: string;
  scope: UxProfileAuthoringScope;
  relPath: string;
  target: string;
  summary: string;
  text: string;
  presetText: string | undefined;
}): void {
  const warnings = secretWarnings(options.relPath, options.text);
  const blocked = warnings.some((warning) => warning.startsWith("high-confidence secret:"));
  const status = blocked
    ? "blocked"
    : options.presetText === undefined
      ? "new"
      : options.text === options.presetText
        ? "unchanged"
        : "changed";
  options.candidates.push({
    id: options.id,
    category: options.category,
    kind: "file",
    scope: options.scope,
    relPath: options.relPath,
    target: options.target,
    summary: options.summary,
    selectable: !blocked,
    selectedByDefault: !blocked && status === "unchanged",
    status,
    preview: blocked ? undefined : previewText(options.text),
    warnings,
  });
}

function presetTextForId(id: string, preset: UxProfilePreset): string | undefined {
  if (id === "file:AGENTS.md") return preset.files.globalAgentsMd;
  if (id === "file:plugins/ogb-startup-sync.js") return preset.files.startupPlugin;
  if (id === "file:tui-plugins/ogb-sidebar.js") return preset.files.tuiSidebarPlugin;
  if (id.startsWith("command:")) return preset.files.commands[id.slice("command:".length)];
  if (id.startsWith("agent:")) return preset.files.agents[id.slice("agent:".length)];
  if (id.startsWith("skill:")) {
    const [, skillName, ...relParts] = id.split(":");
    return preset.files.skills?.[skillName]?.[relParts.join(":") || "SKILL.md"];
  }
  return undefined;
}

function addWholeJsonCandidate(options: {
  candidates: UxProfileAuthoringCandidate[];
  excluded: UxProfileExcludedItem[];
  id: string;
  category: string;
  scope: UxProfileAuthoringScope;
  relPath: string;
  target: string;
  summary: string;
  filePath: string;
  presetValue: unknown;
  jsonKind: "json" | "jsonc";
}): void {
  const parsed = options.jsonKind === "json" ? readJsonFile(options.filePath) : readJsoncFile(options.filePath);
  if (!parsed.exists) return;
  if (parsed.error || parsed.value === undefined) {
    options.excluded.push({
      scope: options.scope,
      relPath: options.relPath,
      reason: "invalid_config",
      detail: parsed.error ?? "could not parse config",
    });
    return;
  }
  addValueCandidate({
    candidates: options.candidates,
    id: options.id,
    category: options.category,
    kind: "file",
    scope: options.scope,
    relPath: options.relPath,
    target: options.target,
    summary: options.summary,
    value: parsed.value,
    presetValue: options.presetValue,
  });
}

function pluginValues(value: unknown): { plugins: string[]; warnings: string[] } {
  if (!Array.isArray(value)) return { plugins: [], warnings: ["plugin field is not an array"] };
  const warnings: string[] = [];
  const plugins = value
    .map((item) => Array.isArray(item) ? item[0] : item)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item.startsWith("file:")) return true;
      warnings.push(`local plugin spec excluded from preset: ${item}`);
      return false;
    });
  return { plugins: [...new Set(plugins)], warnings };
}

function addOpenCodeConfigCandidates(paths: ResolvedPaths, candidates: UxProfileAuthoringCandidate[], excluded: UxProfileExcludedItem[]): void {
  const configPath = paths.adapter.join(paths.globalConfigDir, "opencode.json");
  const fallbackConfigPath = paths.adapter.join(paths.globalConfigDir, "opencode.jsonc");
  const parsed = readJsoncFile(fs.existsSync(configPath) ? configPath : fallbackConfigPath);
  if (!parsed.exists) return;
  if (parsed.error || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    excluded.push({
      scope: "opencode",
      relPath: fs.existsSync(configPath) ? "opencode.json" : "opencode.jsonc",
      reason: "invalid_config",
      detail: parsed.error ?? "OpenCode config root is not an object",
    });
    return;
  }

  const config = parsed.value as Record<string, unknown>;
  for (const key of Object.keys(config).sort()) {
    if (!OPENCODE_KNOWN_TOP_LEVEL.has(key)) {
      excluded.push({ scope: "opencode", relPath: `opencode.json#${key}`, reason: "unknown_or_sensitive_config_field" });
    }
  }
  for (const key of Object.keys(asRecord(config.agent)).sort()) {
    if (!OPENCODE_KNOWN_AGENT_KEYS.has(key)) {
      excluded.push({ scope: "opencode", relPath: `opencode.json#agent.${key}`, reason: "unknown_config_field" });
    }
  }
  for (const key of Object.keys(asRecord(config.watcher)).sort()) {
    if (!OPENCODE_KNOWN_WATCHER_KEYS.has(key)) {
      excluded.push({ scope: "opencode", relPath: `opencode.json#watcher.${key}`, reason: "unknown_config_field" });
    }
  }

  for (const field of OPENCODE_FIELD_CANDIDATES) {
    const rawValue = valueAt(config, field.path);
    if (rawValue === undefined) continue;
    const { plugins, warnings } = field.id === "opencode:plugin"
      ? pluginValues(rawValue)
      : { plugins: undefined, warnings: [] };
    const value = field.id === "opencode:plugin" ? plugins : rawValue;
    addValueCandidate({
      candidates,
      id: field.id,
      category: "opencode.json",
      kind: "config-field",
      scope: "opencode",
      relPath: `opencode.json#${field.path.join(".")}`,
      target: field.id,
      summary: field.summary,
      value,
      presetValue: valueAt(UX_PROFILE_PRESET, field.presetPath),
      warnings,
    });
  }
}

function tuiConfigPath(paths: ResolvedPaths): string | undefined {
  const jsonPath = paths.adapter.join(paths.globalConfigDir, "tui.json");
  if (fs.existsSync(jsonPath)) return jsonPath;
  const jsoncPath = paths.adapter.join(paths.globalConfigDir, "tui.jsonc");
  return fs.existsSync(jsoncPath) ? jsoncPath : undefined;
}

function addTuiConfigCandidates(paths: ResolvedPaths, candidates: UxProfileAuthoringCandidate[], excluded: UxProfileExcludedItem[]): void {
  const filePath = tuiConfigPath(paths);
  if (!filePath) return;
  const parsed = readJsoncFile(filePath);
  const relPath = paths.adapter.pathApi.basename(filePath);
  if (parsed.error || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    excluded.push({
      scope: "opencode",
      relPath,
      reason: "invalid_config",
      detail: parsed.error ?? "TUI config root is not an object",
    });
    return;
  }
  const config = parsed.value as Record<string, unknown>;
  for (const key of Object.keys(config).sort()) {
    if (!TUI_KNOWN_TOP_LEVEL.has(key)) {
      excluded.push({ scope: "opencode", relPath: `${relPath}#${key}`, reason: "unknown_config_field" });
    }
  }
  for (const field of TUI_FIELD_CANDIDATES) {
    const value = valueAt(config, field.path);
    if (value === undefined) continue;
    addValueCandidate({
      candidates,
      id: field.id,
      category: "tui.json",
      kind: "config-field",
      scope: "opencode",
      relPath: `${relPath}#${field.path.join(".")}`,
      target: field.id,
      summary: field.summary,
      value,
      presetValue: valueAt(UX_PROFILE_PRESET.tuiConfig ?? {}, field.path),
    });
  }
}

function maybeAddTextFile(paths: ResolvedPaths, candidates: UxProfileAuthoringCandidate[], excluded: UxProfileExcludedItem[], options: {
  id: string;
  category: string;
  scope: UxProfileAuthoringScope;
  relPath: string;
  target: string;
  summary: string;
}): void {
  const root = options.scope === "bridge" ? paths.bridgeConfigDir : paths.globalConfigDir;
  const filePath = paths.adapter.join(root, ...options.relPath.split("/"));
  const text = readText(filePath);
  if (text === undefined) return;
  const managed = managedExclusion(paths, options.scope, options.relPath);
  if (managed) {
    excluded.push(managed);
    return;
  }
  const runtimeExclusion = ogbRuntimeProfileFileExclusion(options.id, text);
  if (runtimeExclusion) {
    excluded.push(runtimeExclusion);
    return;
  }
  const markerReason = generatedMarkerReason(text);
  if (markerReason) {
    excluded.push({ scope: options.scope, relPath: options.relPath, reason: markerReason });
    return;
  }
  addTextCandidate({
    candidates,
    ...options,
    text,
    presetText: presetTextForId(options.id, UX_PROFILE_PRESET),
  });
}

function listMarkdownFiles(dir: string, pathApi: typeof path): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => pathApi.basename(entry.name, ".md"))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function listSkillNames(dir: string, pathApi: typeof path): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(pathApi.join(dir, entry.name, "SKILL.md")))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function addPackageDependencyCandidate(paths: ResolvedPaths, candidates: UxProfileAuthoringCandidate[]): void {
  const packagePath = paths.adapter.join(paths.globalConfigDir, "package.json");
  const parsed = readJsonFile(packagePath);
  if (!parsed.exists || parsed.error || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return;
  const dependencies = asRecord((parsed.value as Record<string, unknown>).dependencies);
  const selected: Record<string, string> = {};
  for (const dependency of Object.keys(UX_PROFILE_PRESET.tuiRuntimeDependencies)) {
    if (typeof dependencies[dependency] === "string") selected[dependency] = dependencies[dependency] as string;
  }
  if (Object.keys(selected).length === 0) return;
  addValueCandidate({
    candidates,
    id: "package:tui-runtime",
    category: "TUI runtime",
    kind: "package-deps",
    scope: "opencode",
    relPath: "package.json#dependencies",
    target: "tuiRuntimeDependencies",
    summary: "Dependencias globais usadas pelo plugin TUI",
    value: selected,
    presetValue: UX_PROFILE_PRESET.tuiRuntimeDependencies,
  });
}

function addFileCandidates(paths: ResolvedPaths, candidates: UxProfileAuthoringCandidate[], excluded: UxProfileExcludedItem[]): void {
  maybeAddTextFile(paths, candidates, excluded, {
    id: "file:AGENTS.md",
    category: "AGENTS.md",
    scope: "opencode",
    relPath: "AGENTS.md",
    target: "files.globalAgentsMd",
    summary: "Instrucoes globais do OpenCode",
  });
  maybeAddTextFile(paths, candidates, excluded, {
    id: "file:plugins/ogb-startup-sync.js",
    category: "startup plugin",
    scope: "opencode",
    relPath: "plugins/ogb-startup-sync.js",
    target: "files.startupPlugin",
    summary: "Plugin global de startup sync",
  });
  maybeAddTextFile(paths, candidates, excluded, {
    id: "file:tui-plugins/ogb-sidebar.js",
    category: "TUI plugin",
    scope: "opencode",
    relPath: "tui-plugins/ogb-sidebar.js",
    target: "files.tuiSidebarPlugin",
    summary: "Plugin global da sidebar TUI",
  });

  for (const command of listMarkdownFiles(paths.adapter.join(paths.globalConfigDir, "commands"), paths.adapter.pathApi)) {
    maybeAddTextFile(paths, candidates, excluded, {
      id: `command:${command}`,
      category: "commands",
      scope: "opencode",
      relPath: `commands/${command}.md`,
      target: `files.commands.${command}`,
      summary: `Comando global /${command}`,
    });
  }

  for (const agent of listMarkdownFiles(paths.adapter.join(paths.globalConfigDir, "agents"), paths.adapter.pathApi)) {
    maybeAddTextFile(paths, candidates, excluded, {
      id: `agent:${agent}`,
      category: "agents",
      scope: "opencode",
      relPath: `agents/${agent}.md`,
      target: `files.agents.${agent}`,
      summary: `Agente global ${agent}`,
    });
  }

  for (const skill of listSkillNames(paths.adapter.join(paths.globalConfigDir, "skills"), paths.adapter.pathApi)) {
    maybeAddTextFile(paths, candidates, excluded, {
      id: `skill:${skill}:SKILL.md`,
      category: "skills",
      scope: "opencode",
      relPath: `skills/${skill}/SKILL.md`,
      target: `files.skills.${skill}.SKILL.md`,
      summary: `Skill global ${skill}`,
    });
  }

  addWholeJsonCandidate({
    candidates,
    excluded,
    id: "file:dcp.jsonc",
    category: "dcp.jsonc",
    scope: "opencode",
    relPath: "dcp.jsonc",
    target: "dcpConfig",
    summary: "Configuracao global do opencode-dcp",
    filePath: paths.adapter.join(paths.globalConfigDir, "dcp.jsonc"),
    presetValue: UX_PROFILE_PRESET.dcpConfig,
    jsonKind: "jsonc",
  });
  addWholeJsonCandidate({
    candidates,
    excluded,
    id: "file:plugins/fallback.json",
    category: "fallback plugin",
    scope: "opencode",
    relPath: "plugins/fallback.json",
    target: "fallbackConfig",
    summary: "Configuracao global do opencode-auto-fallback",
    filePath: paths.adapter.join(paths.globalConfigDir, "plugins", "fallback.json"),
    presetValue: UX_PROFILE_PRESET.fallbackConfig,
    jsonKind: "json",
  });
  addWholeJsonCandidate({
    candidates,
    excluded,
    id: "file:ogb.config.jsonc",
    category: "ogb.config.jsonc",
    scope: "bridge",
    relPath: "ogb.config.jsonc",
    target: "projectConfig",
    summary: "Config OGB autoral distribuida como profile",
    filePath: paths.adapter.join(paths.bridgeConfigDir, "ogb.config.jsonc"),
    presetValue: UX_PROFILE_PRESET.projectConfig,
    jsonKind: "jsonc",
  });
}

function isAllowedRelPath(scope: UxProfileAuthoringScope, relPath: string): boolean {
  const rel = toPosixPath(relPath);
  if (scope === "bridge") return rel === "ogb.config.jsonc";
  return rel === "opencode.json"
    || rel === "opencode.jsonc"
    || rel === "AGENTS.md"
    || rel === "dcp.jsonc"
    || rel === "tui.json"
    || rel === "tui.jsonc"
    || rel === "package.json"
    || /^commands\/[^/]+\.md$/.test(rel)
    || /^agents\/[^/]+\.md$/.test(rel)
    || /^skills\/[^/]+\/SKILL\.md$/.test(rel)
    || rel === "plugins/fallback.json"
    || rel === "plugins/ogb-startup-sync.js"
    || rel === "tui-plugins/ogb-sidebar.js";
}

function prohibitedReason(relPath: string): string | undefined {
  const rel = toPosixPath(relPath).toLowerCase();
  const parts = rel.split("/");
  const base = parts[parts.length - 1] ?? rel;
  if (parts.includes("generated")) return "generated_artifact";
  if (parts.includes("backups") || parts.includes("backup")) return "backup";
  if (parts.includes("logs") || parts.includes("log")) return "log";
  if (parts.includes("node_modules")) return "runtime_dependency_tree";
  if (base === "local-role.json") return "local_maintainer_flag";
  if (/(^|[-_.])(auth|token|tokens|credential|credentials|secret|secrets)([-_.]|$)/.test(base)) return "secret_like_file";
  if (/(telemetry|quota|limits?)/.test(rel)) return "telemetry_or_quota";
  if (isSecretLikeRelPath(rel)) return "secret_like_file";
  return undefined;
}

function scanExclusions(paths: ResolvedPaths, scope: UxProfileAuthoringScope, root: string, excluded: UxProfileExcludedItem[]): void {
  function walk(dir: string, depth: number): void {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = paths.adapter.join(dir, entry.name);
      const relPath = toPosixPath(paths.adapter.pathApi.relative(root, filePath));
      const reason = prohibitedReason(relPath);
      if (entry.isDirectory()) {
        if (reason) {
          excluded.push({ scope, relPath, reason });
          continue;
        }
        walk(filePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (reason) {
        excluded.push({ scope, relPath, reason });
      } else if (!isAllowedRelPath(scope, relPath)) {
        excluded.push({ scope, relPath, reason: "outside_snapshot_allowlist" });
      }
    }
  }
  walk(root, 0);
}

export function createUxProfileInventory(options: UxProfileEngineOptions = {}): UxProfileInventory {
  const paths = resolvePaths(options);
  const candidates: UxProfileAuthoringCandidate[] = [];
  const excluded: UxProfileExcludedItem[] = [];

  addOpenCodeConfigCandidates(paths, candidates, excluded);
  addTuiConfigCandidates(paths, candidates, excluded);
  addPackageDependencyCandidate(paths, candidates);
  addFileCandidates(paths, candidates, excluded);
  scanExclusions(paths, "opencode", paths.globalConfigDir, excluded);
  scanExclusions(paths, "bridge", paths.bridgeConfigDir, excluded);

  const dedupedExcluded = Array.from(
    new Map(excluded.map((item) => [`${item.scope}:${item.relPath}:${item.reason}:${item.detail ?? ""}`, item])).values(),
  ).sort((left, right) => `${left.scope}:${left.relPath}`.localeCompare(`${right.scope}:${right.relPath}`));
  const sortedCandidates = candidates.sort((left, right) => left.id.localeCompare(right.id));
  const blocked = sortedCandidates.some((candidate) => candidate.status === "blocked");
  const warnings = [
    ...sortedCandidates.flatMap((candidate) => candidate.warnings.map((warning) => `${candidate.id}: ${warning}`)),
    ...dedupedExcluded
      .filter((item) => ["secret_like_file", "telemetry_or_quota", "local_maintainer_flag"].includes(item.reason))
      .map((item) => `${sourceLabel(item)} excluded: ${item.reason}`),
  ].sort();

  return {
    schema: INVENTORY_SCHEMA,
    version: OGB_VERSION,
    homeRelPath: "~",
    globalConfigRelPath: displayRootPath(paths.globalConfigDir, paths.adapter.homeDir, paths.adapter.pathApi),
    bridgeConfigRelPath: displayRootPath(paths.bridgeConfigDir, paths.adapter.homeDir, paths.adapter.pathApi),
    candidates: sortedCandidates,
    excluded: dedupedExcluded,
    warnings,
    blocked,
  };
}

function candidatePath(paths: ResolvedPaths, candidate: UxProfileAuthoringCandidate): string | undefined {
  if (candidate.kind !== "file") return undefined;
  const root = candidate.scope === "bridge" ? paths.bridgeConfigDir : paths.globalConfigDir;
  return paths.adapter.join(root, ...candidate.relPath.split("/"));
}

function readCandidateText(paths: ResolvedPaths, candidate: UxProfileAuthoringCandidate): string | undefined {
  const filePath = candidatePath(paths, candidate);
  return filePath ? readText(filePath) : undefined;
}

function parsedCandidateValue(paths: ResolvedPaths, candidate: UxProfileAuthoringCandidate): unknown {
  const filePath = candidatePath(paths, candidate);
  if (!filePath) return undefined;
  if (candidate.id === "file:dcp.jsonc" || candidate.id === "file:ogb.config.jsonc") return readJsoncFile(filePath).value;
  if (candidate.id === "file:plugins/fallback.json") return readJsonFile(filePath).value;
  return undefined;
}

function selectedCandidates(inventory: UxProfileInventory, selectedIds: string[] | undefined): UxProfileAuthoringCandidate[] {
  const ids = new Set(selectedIds ?? []);
  return inventory.candidates.filter((candidate) => ids.has(candidate.id));
}

function applyCandidateToPreset(paths: ResolvedPaths, preset: UxProfilePreset, candidate: UxProfileAuthoringCandidate): void {
  if (candidate.id === "opencode:plugin") {
    preset.safePlugins = Array.isArray(candidate.value) ? candidate.value.map(String) : preset.safePlugins;
    return;
  }
  const opencodeField = OPENCODE_FIELD_CANDIDATES.find((field) => field.id === candidate.id);
  if (opencodeField) {
    setValueAt(preset as unknown as Record<string, unknown>, opencodeField.presetPath, candidate.value);
    return;
  }
  const tuiField = TUI_FIELD_CANDIDATES.find((field) => field.id === candidate.id);
  if (tuiField) {
    if (!preset.tuiConfig) preset.tuiConfig = {};
    setValueAt(preset.tuiConfig, tuiField.path, candidate.value);
    return;
  }
  if (candidate.id === "package:tui-runtime") {
    preset.tuiRuntimeDependencies = asRecord(candidate.value) as Record<string, string>;
    return;
  }
  if (candidate.id === "file:dcp.jsonc") {
    preset.dcpConfig = asRecord(parsedCandidateValue(paths, candidate));
    return;
  }
  if (candidate.id === "file:plugins/fallback.json") {
    preset.fallbackConfig = asRecord(parsedCandidateValue(paths, candidate));
    return;
  }
  if (candidate.id === "file:ogb.config.jsonc") {
    preset.projectConfig = asRecord(parsedCandidateValue(paths, candidate));
    return;
  }

  const text = readCandidateText(paths, candidate);
  if (text === undefined) return;
  if (candidate.id === "file:AGENTS.md") {
    preset.files.globalAgentsMd = text;
  } else if (candidate.id === "file:plugins/ogb-startup-sync.js") {
    preset.files.startupPlugin = text;
  } else if (candidate.id === "file:tui-plugins/ogb-sidebar.js") {
    preset.files.tuiSidebarPlugin = text;
  } else if (candidate.id.startsWith("command:")) {
    preset.files.commands[candidate.id.slice("command:".length)] = text;
  } else if (candidate.id.startsWith("agent:")) {
    preset.files.agents[candidate.id.slice("agent:".length)] = text;
  } else if (candidate.id.startsWith("skill:")) {
    const [, skillName, ...relParts] = candidate.id.split(":");
    if (!preset.files.skills) preset.files.skills = {};
    if (!preset.files.skills[skillName]) preset.files.skills[skillName] = {};
    preset.files.skills[skillName][relParts.join(":") || "SKILL.md"] = text;
  }
}

function prunePresetToSelection(preset: UxProfilePreset, selectedIds: string[] | undefined): void {
  if (selectedIds === undefined) return;
  const selected = new Set(selectedIds);

  if (preset.tuiConfig) {
    for (const field of TUI_FIELD_CANDIDATES) {
      if (!selected.has(field.id)) deleteValueAt(preset.tuiConfig, field.path);
    }
    if (Object.keys(preset.tuiConfig).length === 0) delete preset.tuiConfig;
  }

  for (const command of Object.keys(preset.files.commands)) {
    if (!selected.has(`command:${command}`)) delete preset.files.commands[command];
  }
  for (const agent of Object.keys(preset.files.agents)) {
    if (!selected.has(`agent:${agent}`)) delete preset.files.agents[agent];
  }
  for (const [skill, files] of Object.entries(preset.files.skills ?? {})) {
    for (const relPath of Object.keys(files)) {
      if (!selected.has(`skill:${skill}:${relPath}`)) delete files[relPath];
    }
    if (Object.keys(files).length === 0) delete preset.files.skills?.[skill];
  }
  if (preset.files.skills && Object.keys(preset.files.skills).length === 0) delete preset.files.skills;
}

function orderedPreset(preset: UxProfilePreset): UxProfilePreset {
  return {
    schema: preset.schema,
    name: preset.name,
    ...(preset.description ? { description: preset.description } : {}),
    safePlugins: preset.safePlugins,
    disabledPlugins: preset.disabledPlugins,
    removedGlobalCommands: preset.removedGlobalCommands,
    tuiRuntimeDependencies: preset.tuiRuntimeDependencies,
    globalConfig: preset.globalConfig,
    dcpConfig: preset.dcpConfig,
    ...(preset.fallbackConfig ? { fallbackConfig: preset.fallbackConfig } : {}),
    ...(preset.tuiConfig ? { tuiConfig: preset.tuiConfig } : {}),
    projectConfig: preset.projectConfig,
    files: preset.files,
  };
}

export function buildPresetFromSelection(options: UxProfileWriteOptions = {}): { preset: UxProfilePreset; inventory: UxProfileInventory; selected: UxProfileAuthoringCandidate[]; warnings: string[]; blocked: boolean } {
  const paths = resolvePaths(options);
  const inventory = createUxProfileInventory(options);
  const selected = selectedCandidates(inventory, options.selectedIds);
  const unknownIds = (options.selectedIds ?? []).filter((id) => !inventory.candidates.some((candidate) => candidate.id === id));
  const blockedCandidates = selected.filter((candidate) => candidate.status === "blocked" || !candidate.selectable);
  const warnings = [
    ...inventory.warnings,
    ...unknownIds.map((id) => `unknown selected candidate: ${id}`),
    ...blockedCandidates.map((candidate) => `blocked selected candidate: ${candidate.id}`),
  ];
  const blocked = inventory.blocked || blockedCandidates.length > 0 || unknownIds.length > 0;
  const preset = clonePreset();
  if (!blocked) {
    prunePresetToSelection(preset, options.selectedIds);
    for (const candidate of selected) applyCandidateToPreset(paths, preset, candidate);
  }
  return { preset: orderedPreset(preset), inventory, selected, warnings, blocked };
}

function generatedPresetSource(preset: UxProfilePreset): string {
  const placeholder = "__OGB_UX_PROFILE_SCHEMA__";
  const json = JSON.stringify({ ...orderedPreset(preset), schema: placeholder }, null, 2)
    .replace(`"${placeholder}"`, "UX_PROFILE_SCHEMA");
  return `import { UX_PROFILE_SCHEMA, type UxProfilePreset } from "./ux-profile.js";

export const UX_PROFILE_PRESET = ${json} satisfies UxProfilePreset;

export default UX_PROFILE_PRESET;
`;
}

function repoRelative(paths: ResolvedPaths, target: string): string {
  return toPosixPath(path.relative(paths.repoRoot, target));
}

function buildManifest(paths: ResolvedPaths, inventory: UxProfileInventory, selected: UxProfileAuthoringCandidate[], warnings: string[]): UxProfileSnapshotManifest {
  return {
    schema: MANIFEST_SCHEMA,
    version: OGB_VERSION,
    presetSchema: UX_PROFILE_SCHEMA,
    selected: selected.map((candidate) => ({
      id: candidate.id,
      category: candidate.category,
      kind: candidate.kind,
      source: sourceLabel(candidate),
      target: candidate.target,
      status: candidate.status,
      warnings: candidate.warnings,
    })),
    excluded: inventory.excluded,
    warnings,
  };
}

function buildDiffMarkdown(manifest: UxProfileSnapshotManifest): string {
  const lines = [
    "# UX Profile Snapshot",
    "",
    "## Selected",
    "",
    ...(
      manifest.selected.length > 0
        ? manifest.selected.map((item) => `- ${item.id} -> ${item.target} (${item.status})`)
        : ["- No candidates selected."]
    ),
    "",
    "## Warnings",
    "",
    ...(
      manifest.warnings.length > 0
        ? manifest.warnings.map((warning) => `- ${warning}`)
        : ["- None."]
    ),
    "",
    "## Excluded",
    "",
    ...(
      manifest.excluded.length > 0
        ? manifest.excluded.map((item) => `- ${sourceLabel(item)}: ${item.reason}${item.detail ? ` (${item.detail})` : ""}`)
        : ["- None."]
    ),
    "",
  ];
  return `${lines.join("\n")}`;
}

function writeArtifacts(paths: ResolvedPaths, manifest: UxProfileSnapshotManifest): void {
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(paths.artifactsDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(paths.artifactsDir, "diff.md"), buildDiffMarkdown(manifest), "utf8");
  fs.writeFileSync(
    path.join(paths.artifactsDir, "exclusions-and-warnings.json"),
    `${JSON.stringify({ warnings: manifest.warnings, excluded: manifest.excluded }, null, 2)}\n`,
    "utf8",
  );
}

export function writeUxProfilePreset(options: UxProfileWriteOptions = {}): UxProfileWriteResult {
  const paths = resolvePaths(options);
  const { preset, inventory, selected, warnings, blocked } = buildPresetFromSelection(options);
  const manifest = buildManifest(paths, inventory, selected, warnings);
  const outputRelPath = repoRelative(paths, paths.outputPath);
  const artifactsRelPath = repoRelative(paths, paths.artifactsDir);

  if (blocked) {
    return {
      schema: WRITE_RESULT_SCHEMA,
      status: "blocked",
      selectedIds: selected.map((candidate) => candidate.id),
      outputRelPath,
      artifactsRelPath,
      warnings,
      blocked: true,
      manifest,
    };
  }

  if (!options.write || options.dryRun) {
    return {
      schema: WRITE_RESULT_SCHEMA,
      status: "preview",
      selectedIds: selected.map((candidate) => candidate.id),
      outputRelPath,
      artifactsRelPath,
      warnings,
      blocked: false,
      manifest,
    };
  }

  fs.mkdirSync(path.dirname(paths.outputPath), { recursive: true });
  fs.writeFileSync(paths.outputPath, generatedPresetSource(preset), "utf8");
  writeArtifacts(paths, manifest);

  return {
    schema: WRITE_RESULT_SCHEMA,
    status: "written",
    selectedIds: selected.map((candidate) => candidate.id),
    outputRelPath,
    artifactsRelPath,
    warnings,
    blocked: false,
    manifest,
  };
}

function formatInventoryText(inventory: UxProfileInventory): string {
  const lines = [
    "OGB UX profile inventory",
    `OpenCode: ${inventory.globalConfigRelPath}`,
    `Bridge: ${inventory.bridgeConfigRelPath}`,
    "",
    "Candidates:",
    ...inventory.candidates.map((candidate) => `${candidate.id} [${candidate.status}] ${candidate.summary}`),
  ];
  if (inventory.excluded.length > 0) {
    lines.push("", "Excluded:", ...inventory.excluded.map((item) => `- ${sourceLabel(item)}: ${item.reason}`));
  }
  if (inventory.warnings.length > 0) {
    lines.push("", "Warnings:", ...inventory.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join("\n")}\n`;
}

function formatWriteResultText(result: UxProfileWriteResult): string {
  const verb = result.status === "written" ? "Wrote" : result.status === "blocked" ? "Blocked" : "Preview";
  const lines = [
    `${verb} UX profile snapshot`,
    `Output: ${result.outputRelPath}`,
    `Artifacts: ${result.artifactsRelPath}`,
    `Selected: ${result.selectedIds.length ? result.selectedIds.join(", ") : "none"}`,
  ];
  if (result.warnings.length > 0) lines.push("Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  return `${lines.join("\n")}\n`;
}

interface ParsedCli {
  command: "inventory" | "diff" | "apply" | "write-preset";
  json: boolean;
  options: UxProfileWriteOptions;
}

export function parseEngineCliArgs(argv: string[]): ParsedCli {
  const commands = new Set(["inventory", "diff", "apply", "write-preset"]);
  const first = argv[0] && commands.has(argv[0]) ? argv.shift() as ParsedCli["command"] : "inventory";
  const options: UxProfileWriteOptions = {};
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--home") {
      options.homeDir = argv[++index];
    } else if (arg === "--platform") {
      options.platform = argv[++index] as NodeJS.Platform;
    } else if (arg === "--config-dir") {
      options.configDir = argv[++index];
    } else if (arg === "--bridge-config-dir") {
      options.bridgeConfigDir = argv[++index];
    } else if (arg === "--output") {
      options.outputPath = argv[++index];
    } else if (arg === "--artifacts") {
      options.artifactsDir = argv[++index];
    } else if (arg === "--select") {
      const selected = argv[++index] ?? "";
      options.selectedIds = [
        ...(options.selectedIds ?? []),
        ...selected.split(",").map((item) => item.trim()).filter(Boolean),
      ];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { command: first, json, options };
}

export function runEngineCli(argv = process.argv.slice(2)): number {
  try {
    const parsed = parseEngineCliArgs([...argv]);
    if (parsed.command === "inventory") {
      const inventory = createUxProfileInventory(parsed.options);
      process.stdout.write(parsed.json ? `${JSON.stringify(inventory, null, 2)}\n` : formatInventoryText(inventory));
      return inventory.blocked ? 2 : 0;
    }
    if (parsed.command === "diff") {
      const result = writeUxProfilePreset({ ...parsed.options, dryRun: true, write: false });
      process.stdout.write(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : formatWriteResultText(result));
      return result.status === "blocked" ? 2 : 0;
    }

    const result = writeUxProfilePreset(parsed.options);
    process.stdout.write(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : formatWriteResultText(result));
    return result.status === "blocked" ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  process.exitCode = runEngineCli();
}
