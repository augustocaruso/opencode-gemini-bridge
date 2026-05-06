import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { sha256File } from "./file-hash.js";
import { resolveProjectPaths, toPosixRelative } from "./paths.js";
import { spawnCommandSync } from "./process.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState, type SyncState } from "./sync-state.js";
import { OGB_VERSION } from "./types.js";

export type RulesyncMode = "auto" | "off" | "require";

export interface RulesyncCommand {
  command: string;
  argsPrefix: string[];
  version?: string;
  source: "dependency" | "path";
}

export interface RulesyncProjectionOptions {
  projectRoot?: string;
  homeDir?: string;
  mode?: RulesyncMode;
  dryRun?: boolean;
  force?: boolean;
  features?: string[];
}

export interface RulesyncProjectionResult {
  status: "applied" | "partial" | "preview" | "skipped" | "error";
  available: boolean;
  command?: string[];
  stdout?: string;
  stderr?: string;
  promoted: string[];
  conflicts: string[];
  skippedReason?: string;
}

const DEFAULT_RULESYNC_FEATURES = ["mcp", "commands", "subagents", "skills", "permissions"];
const requireFromHere = createRequire(import.meta.url);

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

export function resolveRulesyncCommand(cwd = process.cwd()): RulesyncCommand | undefined {
  try {
    const packageEntry = requireFromHere.resolve("rulesync");
    const packageRoot = path.dirname(path.dirname(packageEntry));
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string; bin?: Record<string, string> | string };
    const binRel = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.rulesync;
    if (binRel) {
      return {
        command: process.execPath,
        argsPrefix: [path.resolve(path.dirname(packageJsonPath), binRel)],
        version: packageJson.version,
        source: "dependency",
      };
    }
  } catch {
    // Fall through to PATH lookup.
  }

  const check = spawnCommandSync("rulesync", ["--version"], { cwd, encoding: "utf8" });
  if (check.error || check.status !== 0) return undefined;
  return {
    command: "rulesync",
    argsPrefix: [],
    version: (check.stdout || check.stderr).trim() || undefined,
    source: "path",
  };
}

function copyIfExists(source: string, destination: string): boolean {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
  return true;
}

function copyGeminiSource(sourceRoot: string, stageRoot: string): void {
  copyIfExists(path.join(sourceRoot, "GEMINI.md"), path.join(stageRoot, "GEMINI.md"));
  copyIfExists(path.join(sourceRoot, ".gemini", "settings.json"), path.join(stageRoot, ".gemini", "settings.json"));
  copyIfExists(path.join(sourceRoot, ".gemini", "agents"), path.join(stageRoot, ".gemini", "agents"));
  copyIfExists(path.join(sourceRoot, ".gemini", "commands"), path.join(stageRoot, ".gemini", "commands"));
  copyIfExists(path.join(sourceRoot, ".gemini", "skills"), path.join(stageRoot, ".gemini", "skills"));
}

function normalizeStageGeminiAgents(stageRoot: string): void {
  const agentsDir = path.join(stageRoot, ".gemini", "agents");
  if (!dirExists(agentsDir)) return;

  for (const filePath of listFiles(agentsDir)) {
    if (!filePath.endsWith(".md")) continue;
    const name = path.basename(filePath, ".md");
    const content = fs.readFileSync(filePath, "utf8");

    if (!content.startsWith("---")) {
      fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: Imported Gemini agent ${name}\n---\n\n${content}`, "utf8");
      continue;
    }

    const close = content.indexOf("\n---", 3);
    if (close < 0) continue;
    const frontmatter = content.slice(3, close);
    if (/^name\s*:/m.test(frontmatter)) continue;

    const rest = content.slice(close);
    fs.writeFileSync(filePath, `---\nname: ${name}\n${frontmatter.trim()}\n${rest}`, "utf8");
  }
}

function listFiles(root: string): string[] {
  if (!dirExists(root)) return [];
  const out: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }

  return out.sort();
}

function isCopiedGeminiSource(relPath: string): boolean {
  return relPath === "GEMINI.md" || relPath.startsWith(".gemini/");
}

function isPromotableRulesyncOutput(relPath: string): boolean {
  if (isCopiedGeminiSource(relPath)) return false;
  if (relPath.startsWith(".rulesync/")) return false;
  if (relPath === "rulesync.jsonc" || relPath === "rulesync.local.jsonc") return false;
  return relPath.startsWith(".opencode/")
    || relPath.startsWith(".agents/")
    || relPath === "AGENTS.md";
}

function canonicalRulesyncOutputPath(relPath: string): string {
  if (relPath.startsWith(".opencode/agent/")) return `.opencode/agents/${relPath.slice(".opencode/agent/".length)}`;
  if (relPath.startsWith(".opencode/skill/")) return `.opencode/skills/${relPath.slice(".opencode/skill/".length)}`;
  return relPath;
}

function prepareStage(projectRoot: string, homeDir: string): string {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-rulesync-stage-"));
  fs.mkdirSync(stageRoot, { recursive: true });

  copyGeminiSource(homeDir, stageRoot);
  copyGeminiSource(projectRoot, stageRoot);
  normalizeStageGeminiAgents(stageRoot);

  return stageRoot;
}

function promoteFromStage(projectRoot: string, stageRoot: string, files: string[], state: SyncState, force: boolean): { promoted: string[]; conflicts: string[] } {
  const promoted: string[] = [];
  const conflicts: string[] = [];

  for (const sourcePath of files) {
    const stageRelPath = toPosixRelative(stageRoot, sourcePath);
    if (!isPromotableRulesyncOutput(stageRelPath)) continue;
    const relPath = canonicalRulesyncOutputPath(stageRelPath);

    const destinationPath = path.join(projectRoot, relPath);
    const oldManagedHash = managedHashFor(state, relPath, "rulesync");
    const destinationExists = fileExists(destinationPath);

    if (destinationExists && !force) {
      const currentHash = sha256File(destinationPath);
      if (oldManagedHash !== currentHash) {
        conflicts.push(relPath);
        continue;
      }
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    upsertManagedFile(state, {
      path: relPath,
      sha256: sha256File(destinationPath),
      source: "rulesync",
    });
    promoted.push(relPath);
  }

  return { promoted, conflicts };
}

function runRulesync(command: RulesyncCommand, args: string[], cwd: string) {
  return spawnCommandSync(command.command, [...command.argsPrefix, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      // Keep staging deterministic and avoid npm progress noise when rulesync is run via package managers.
      NO_COLOR: process.env.NO_COLOR ?? "1",
    },
  });
}

export function projectHasGeminiSource(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "GEMINI.md")) || fs.existsSync(path.join(projectRoot, ".gemini"));
}

export function projectRulesyncProjection(options: RulesyncProjectionOptions = {}): RulesyncProjectionResult {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const mode = options.mode ?? "auto";
  const force = options.force ?? false;
  const features = options.features?.length ? options.features : DEFAULT_RULESYNC_FEATURES;
  const promoted: string[] = [];
  const conflicts: string[] = [];

  if (mode === "off") {
    return {
      status: "skipped",
      available: false,
      promoted,
      conflicts,
      skippedReason: "Rulesync disabled",
    };
  }

  const command = resolveRulesyncCommand(projectRoot);
  if (!command) {
    const skippedReason = "Rulesync is not installed. Install with npm install or npm install -g rulesync.";
    if (mode === "require") {
      return { status: "error", available: false, promoted, conflicts, skippedReason };
    }
    return { status: "skipped", available: false, promoted, conflicts, skippedReason };
  }

  if (!projectHasGeminiSource(projectRoot) && !projectHasGeminiSource(homeDir)) {
    return {
      status: "skipped",
      available: true,
      command: [command.command, ...command.argsPrefix],
      promoted,
      conflicts,
      skippedReason: "No project or global Gemini source found",
    };
  }

  const stageRoot = prepareStage(projectRoot, homeDir);
  const commandLineBase = [command.command, ...command.argsPrefix, "convert", "--from", "geminicli", "--to", "opencode"];
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const failedFeatures: string[] = [];

  for (const feature of features) {
    const args = [
      "convert",
      "--from",
      "geminicli",
      "--to",
      "opencode",
      "--features",
      feature,
    ];
    if (options.dryRun) args.push("--dry-run");

    const result = runRulesync(command, args, stageRoot);
    const stdout = result.stdout?.toString() ?? "";
    const stderr = result.stderr?.toString() ?? "";
    if (stdout.trim()) stdoutParts.push(`[${feature}]\n${stdout.trim()}`);
    if (stderr.trim()) stderrParts.push(`[${feature}]\n${stderr.trim()}`);
    if (result.error || result.status !== 0) {
      failedFeatures.push(feature);
      if (result.error?.message) stderrParts.push(`[${feature}]\n${result.error.message}`);
    }
  }

  const commandLine = [...commandLineBase, "--features", features.join(","), ...(options.dryRun ? ["--dry-run"] : [])];
  const stdout = stdoutParts.join("\n\n");
  const stderr = stderrParts.join("\n\n");

  if (failedFeatures.length === features.length) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    return {
      status: "error",
      available: true,
      command: commandLine,
      stdout,
      stderr: stderr || `Rulesync failed for all features: ${failedFeatures.join(", ")}`,
      promoted,
      conflicts,
    };
  }

  if (options.dryRun) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    return {
      status: "preview",
      available: true,
      command: commandLine,
      stdout,
      stderr,
      promoted,
      conflicts,
    };
  }

  const previousState = readSyncState(projectRoot);
  const state = previousState ?? emptySyncState(OGB_VERSION);
  const generatedFiles = listFiles(stageRoot).filter((filePath) => isPromotableRulesyncOutput(toPosixRelative(stageRoot, filePath)));
  const promotion = promoteFromStage(projectRoot, stageRoot, generatedFiles, state, force);
  fs.rmSync(stageRoot, { recursive: true, force: true });

  state.lastRulesync = {
    status: promotion.conflicts.length > 0 ? "conflicts" : failedFeatures.length > 0 ? "partial" : "applied",
    command: commandLine,
    promoted: promotion.promoted,
    conflicts: promotion.conflicts,
  };
  writeSyncState(state, projectRoot);

  return {
    status: promotion.conflicts.length > 0 ? "error" : failedFeatures.length > 0 ? "partial" : "applied",
    available: true,
    command: commandLine,
    stdout,
    stderr,
    promoted: promotion.promoted,
    conflicts: promotion.conflicts,
  };
}

export function rulesyncInstallHint(): string {
  return `Install Rulesync with npm install in ${path.basename(process.cwd())}, npm install -g rulesync, or brew install rulesync.`;
}

export function rulesyncStagePath(projectRoot = process.cwd()): string {
  return path.join(resolveProjectPaths(projectRoot).generatedDir, "rulesync-stage");
}

export function rulesyncDefaultFeatures(): string[] {
  return [...DEFAULT_RULESYNC_FEATURES];
}

export function rulesyncCacheDir(): string {
  return path.join(os.tmpdir(), "ogb-rulesync");
}
