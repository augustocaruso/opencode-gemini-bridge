import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { flattenGeminiMd } from "./flatten.js";
import { defaultGeminiInput, resolveProjectPaths } from "./paths.js";
import {
  OGB_VERSION,
  type AgentInfo,
  type CommandInfo,
  type ExtensionInfo,
  type GeminiImport,
  type GeminiMcpServer,
  type HookInfo,
  type Inventory,
  type ResourceScope,
  type ResourceSource,
  type ResourceStatus,
  type SkillInfo,
} from "./types.js";

export interface InventoryOptions {
  projectRoot?: string;
  homeDir?: string;
}

export interface WriteInventoryOptions extends InventoryOptions {
  output?: string;
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function listDirs(root: string): string[] {
  if (!exists(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function listFilesWithExtensions(root: string, extensions: string[], recursive = false): string[] {
  if (!exists(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    if (recursive && entry.isDirectory()) out.push(...listFilesWithExtensions(fullPath, extensions, true));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) out.push(fullPath);
  }
  return out.sort();
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(item);
  }
  return out;
}

function toPosix(input: string): string {
  return input.split(path.sep).join("/");
}

function uniqueRootEntries<T extends [unknown, string]>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const resolved = path.resolve(entry[1]);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(entry);
  }
  return out;
}

function uniqueResourceRoots<T extends [ResourceSource, ResourceScope, string]>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const resolved = path.resolve(entry[2]);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(entry);
  }
  return out;
}

function expandGeminiExtensionValue(value: string, extensionDir: string): string {
  return value
    .replaceAll("${extensionPath}", extensionDir)
    .replaceAll("${/}", path.sep);
}

function safeStringArray(value: unknown, mapValue: (input: string) => string = (input) => input): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => mapValue(String(item)));
}

function envKeys(rawEnv: unknown): string[] | undefined {
  if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) return undefined;
  return Object.keys(rawEnv).sort();
}

function safePortableEnvironment(rawEnv: unknown, mapValue: (input: string) => string = (input) => input): Record<string, string> | undefined {
  if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) return undefined;
  const sensitiveKey = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|PRIVATE)/i;
  const out: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(rawEnv)) {
    if (sensitiveKey.test(key) || typeof rawValue !== "string") continue;
    out[key] = mapValue(rawValue);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function mcpServerFromConfig(
  name: string,
  source: string,
  cfg: any,
  options: {
    mapValue?: (input: string) => string;
    includePortableEnvironment?: boolean;
  } = {},
): GeminiMcpServer {
  const mapValue = options.mapValue ?? ((input: string) => input);
  let type: GeminiMcpServer["type"] = "unknown";
  if (cfg.command) type = "stdio";
  else if (cfg.httpUrl || cfg.url) type = "http";
  else if (cfg.sseUrl) type = "sse";

  return {
    name,
    source,
    type,
    command: typeof cfg.command === "string" ? mapValue(cfg.command) : undefined,
    args: safeStringArray(cfg.args, mapValue),
    url: typeof (cfg.httpUrl || cfg.url || cfg.sseUrl) === "string" ? mapValue(cfg.httpUrl || cfg.url || cfg.sseUrl) : undefined,
    cwd: typeof cfg.cwd === "string" ? mapValue(cfg.cwd) : undefined,
    environment: options.includePortableEnvironment ? safePortableEnvironment(cfg.env, mapValue) : undefined,
    envKeys: envKeys(cfg.env),
    status: type === "sse" || type === "unknown" ? "needs_review" : "ok",
    message: type === "sse"
      ? "SSE compatibility needs review"
      : type === "unknown"
        ? "Unknown MCP shape"
        : undefined,
  };
}

function geminiRoot(projectRoot: string, homeDir: string, scope: ResourceScope, kind: "agents" | "commands" | "skills"): string {
  return path.join(scope === "project" ? projectRoot : homeDir, ".gemini", kind);
}

function scopedRoots<T extends [ResourceSource, ResourceScope, string] | [ResourceScope, string]>(homeMode: boolean, roots: T[]): T[] {
  return homeMode ? roots.filter((root) => root[root.length - 2] !== "project") : roots;
}

function markDuplicateNames<T extends { name: string; path: string; source?: ResourceSource; status: ResourceStatus; message?: string }>(items: T[]): T[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = `${item.source ?? "unknown"}:${item.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return items.map((item) => {
    const key = `${item.source ?? "unknown"}:${item.name}`;
    if ((counts.get(key) ?? 0) <= 1) return item;
    return {
      ...item,
      status: item.status === "error" ? item.status : "warning",
      message: item.message ? `${item.message}; duplicate name` : "Duplicate name",
    };
  });
}

function collectSkills(projectRoot: string, homeDir: string, homeMode: boolean): SkillInfo[] {
  const roots = uniqueResourceRoots(scopedRoots(homeMode, [
    ["gemini", "project", geminiRoot(projectRoot, homeDir, "project", "skills")],
    ["opencode", "project", path.join(projectRoot, ".opencode", "skills")],
    ["opencode", "project", path.join(projectRoot, ".opencode", "skill")],
    ["opencode", "project", path.join(projectRoot, ".agents", "skills")],
    ["gemini", "global", geminiRoot(projectRoot, homeDir, "global", "skills")],
    ["opencode", "global", path.join(homeDir, ".config", "opencode", "skills")],
    ["opencode", "global", path.join(homeDir, ".config", "opencode", "skill")],
    ["opencode", "global", path.join(homeDir, ".agents", "skills")],
  ]));

  return markDuplicateNames(roots.flatMap(([source, scope, root]) => listDirs(root).map((skillDir) => {
    const skillFile = path.join(skillDir, "SKILL.md");
    return {
      name: path.basename(skillDir),
      path: skillDir,
      source,
      scope,
      status: exists(skillFile) ? "ok" : "warning",
      message: exists(skillFile) ? undefined : "Missing SKILL.md",
    } satisfies SkillInfo;
  })));
}

function collectAgents(projectRoot: string, homeDir: string, homeMode: boolean): AgentInfo[] {
  const roots = uniqueResourceRoots(scopedRoots(homeMode, [
    ["gemini", "project", geminiRoot(projectRoot, homeDir, "project", "agents")],
    ["opencode", "project", path.join(projectRoot, ".opencode", "agents")],
    ["opencode", "project", path.join(projectRoot, ".opencode", "agent")],
    ["gemini", "global", geminiRoot(projectRoot, homeDir, "global", "agents")],
    ["opencode", "global", path.join(homeDir, ".config", "opencode", "agents")],
    ["opencode", "global", path.join(homeDir, ".config", "opencode", "agent")],
  ]));

  return markDuplicateNames(roots.flatMap(([source, scope, root]) => listFilesWithExtensions(root, [".md"]).map((filePath) => ({
    name: path.basename(filePath, ".md"),
    path: filePath,
    source,
    scope,
    status: source === "gemini" ? "needs_review" : "ok",
    message: source === "gemini" ? "Gemini agent conversion should be reviewed" : undefined,
  } satisfies AgentInfo))));
}

function collectCommands(projectRoot: string, homeDir: string, homeMode: boolean): CommandInfo[] {
  const roots = uniqueResourceRoots(scopedRoots(homeMode, [
    ["gemini", "project", geminiRoot(projectRoot, homeDir, "project", "commands")],
    ["opencode", "project", path.join(projectRoot, ".opencode", "commands")],
    ["opencode", "project", path.join(projectRoot, ".opencode", "command")],
    ["gemini", "global", geminiRoot(projectRoot, homeDir, "global", "commands")],
    ["opencode", "global", path.join(homeDir, ".config", "opencode", "commands")],
    ["opencode", "global", path.join(homeDir, ".config", "opencode", "command")],
  ]));

  return markDuplicateNames(roots.flatMap(([source, scope, root]) => listFilesWithExtensions(root, [".md", ".toml"], true).map((filePath) => ({
    name: toPosix(path.relative(root, filePath)).slice(0, -path.extname(filePath).length),
    path: filePath,
    source,
    scope,
    status: source === "gemini" ? "needs_review" : "ok",
    message: source === "gemini" ? "Gemini command conversion should be reviewed" : undefined,
  } satisfies CommandInfo))));
}

function collectMcps(projectRoot: string, homeDir: string): GeminiMcpServer[] {
  const settingsPaths = uniquePaths([
    path.join(projectRoot, ".gemini", "settings.json"),
    path.join(homeDir, ".gemini", "settings.json"),
  ]);
  const extensionRoots = uniquePaths([
    path.join(projectRoot, ".gemini", "extensions"),
    path.join(homeDir, ".gemini", "extensions"),
  ]);

  const out: GeminiMcpServer[] = [];
  for (const settingsPath of settingsPaths) {
    if (!exists(settingsPath)) continue;
    const parsed = readJsonc(settingsPath);
    const servers = parsed?.mcpServers ?? {};
    for (const [name, rawCfg] of Object.entries<any>(servers)) {
      out.push(mcpServerFromConfig(name, settingsPath, rawCfg ?? {}));
    }
  }

  for (const extensionRoot of extensionRoots) {
    for (const extensionDir of listDirs(extensionRoot)) {
      const manifestPath = path.join(extensionDir, "gemini-extension.json");
      if (!exists(manifestPath)) continue;
      const parsed = readJsonc(manifestPath);
      const servers = parsed?.mcpServers ?? {};
      for (const [name, rawCfg] of Object.entries<any>(servers)) {
        out.push(mcpServerFromConfig(name, manifestPath, rawCfg ?? {}, {
          mapValue: (input) => expandGeminiExtensionValue(input, extensionDir),
          includePortableEnvironment: true,
        }));
      }
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function collectHooks(projectRoot: string, homeDir: string, homeMode: boolean): HookInfo[] {
  const settings = uniqueRootEntries(scopedRoots(homeMode, [
    ["project", path.join(projectRoot, ".gemini", "settings.json")],
    ["global", path.join(homeDir, ".gemini", "settings.json")],
  ]));
  const hooks: HookInfo[] = [];

  for (const [scope, settingsPath] of settings) {
    if (!exists(settingsPath)) continue;
    const parsed = readJsonc(settingsPath);
    const hookRoot = parsed?.hooks;
    if (!hookRoot || typeof hookRoot !== "object") continue;
    for (const name of Object.keys(hookRoot).sort()) {
      hooks.push({
        name,
        source: settingsPath,
        scope,
        status: "needs_review",
        message: "Hooks can execute commands and require manual trust review",
      });
    }
  }

  return hooks;
}

function collectExtensions(projectRoot: string, homeDir: string, homeMode: boolean): ExtensionInfo[] {
  const roots = uniqueRootEntries(scopedRoots(homeMode, [
    ["project", path.join(projectRoot, ".gemini", "extensions")],
    ["global", path.join(homeDir, ".gemini", "extensions")],
  ]));

  return roots.flatMap(([scope, root]) => listDirs(root).map((extensionDir) => ({
    name: path.basename(extensionDir),
    path: extensionDir,
    scope,
    status: exists(path.join(extensionDir, "gemini-extension.json")) ? "needs_review" : "warning",
    message: exists(path.join(extensionDir, "gemini-extension.json"))
      ? "Gemini extension compatibility should be reviewed"
      : "Missing gemini-extension.json",
  } satisfies ExtensionInfo)));
}

function collectExtensionGeminiFiles(projectRoot: string, homeDir: string, homeMode: boolean): string[] {
  const roots = uniqueRootEntries(scopedRoots(homeMode, [
    ["project", path.join(projectRoot, ".gemini", "extensions")],
    ["global", path.join(homeDir, ".gemini", "extensions")],
  ]));

  return roots.flatMap(([, root]) => listDirs(root)
    .map((extensionDir) => path.join(extensionDir, "GEMINI.md"))
    .filter(exists));
}

function collectImports(geminiFiles: string[], homeDir: string): GeminiImport[] {
  const imports: GeminiImport[] = [];
  const seen = new Set<string>();

  for (const filePath of geminiFiles) {
    const result = flattenGeminiMd({ input: filePath, write: false, homeDir });
    for (const item of result.imports) {
      const key = `${item.source}\0${item.target}\0${item.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imports.push(item);
    }
  }

  return imports;
}

export function buildInventory(options: InventoryOptions = {}): Inventory {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const geminiFiles = [
    path.join(paths.homeDir, ".gemini", "GEMINI.md"),
    ...(paths.homeMode ? [] : [path.join(paths.projectRoot, "GEMINI.md")]),
    ...collectExtensionGeminiFiles(paths.projectRoot, paths.homeDir, paths.homeMode),
  ].filter(exists);

  if (!paths.homeMode && geminiFiles.length === 0 && exists(defaultGeminiInput(paths.projectRoot, paths.homeDir))) {
    geminiFiles.push(defaultGeminiInput(paths.projectRoot, paths.homeDir));
  }

  return {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    geminiFiles,
    imports: collectImports(geminiFiles, paths.homeDir),
    mcps: collectMcps(paths.projectRoot, paths.homeDir),
    skills: collectSkills(paths.projectRoot, paths.homeDir, paths.homeMode),
    agents: collectAgents(paths.projectRoot, paths.homeDir, paths.homeMode),
    commands: collectCommands(paths.projectRoot, paths.homeDir, paths.homeMode),
    hooks: collectHooks(paths.projectRoot, paths.homeDir, paths.homeMode),
    extensions: collectExtensions(paths.projectRoot, paths.homeDir, paths.homeMode),
  };
}

export function writeInventory(options: WriteInventoryOptions = {}): Inventory {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const output = options.output ?? paths.inventoryPath;
  const inv = buildInventory(options);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(inv, null, 2)}\n`, "utf8");
  return inv;
}
