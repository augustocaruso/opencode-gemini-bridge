import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { bridgeConfigDirForHome, createBackupSession, type BackupRecord } from "./backup-policy.js";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS } from "./built-ins.js";
import { OGB_VERSION } from "./types.js";

export interface HomeCleanupOptions {
  homeDir?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface HomeCleanupAction {
  path: string;
  relPath: string;
  status: "removed" | "preview" | "skipped";
  backup?: string;
  reason: string;
}

export interface HomeCleanupReport {
  version: string;
  homeDir: string;
  backupDir?: string;
  backups: BackupRecord[];
  actions: HomeCleanupAction[];
  warnings: string[];
}

interface Candidate {
  relPath: string;
  reason: string;
}

const GENERATED_FILES = [
  ".opencode/generated/GEMINI.expanded.md",
  ".opencode/generated/opencode.generated.json",
  ".opencode/generated/ogb-agent-sync-adoption.json",
  ".opencode/generated/ogb-bidirectional-sync.json",
  ".opencode/generated/ogb-dashboard.json",
  ".opencode/generated/ogb-dashboard.md",
  ".opencode/generated/ogb-doctor.json",
  ".opencode/generated/ogb-extension-map.json",
  ".opencode/generated/ogb-inventory.json",
  ".opencode/generated/ogb-limits.json",
  ".opencode/generated/ogb-model-routing.json",
  ".opencode/generated/ogb-pass.json",
  ".opencode/generated/ogb-plugin-status.json",
  ".opencode/generated/ogb-quota.json",
  ".opencode/generated/ogb-security.json",
  ".opencode/generated/ogb-startup-sync.json",
  ".opencode/generated/ogb-startup-sync.lock",
  ".opencode/generated/ogb-sync-state.json",
  ".opencode/generated/ogb-telemetry-status.json",
  ".opencode/generated/ogb-ui.json",
  ".opencode/generated/ogb-update-status.json",
  ".opencode/generated/ogb-validation.json",
];

const PROJECT_FILES = [
  ".opencode/ogb.config.jsonc",
  ".opencode/ogb-trust.jsonc",
  ".opencode/oh-my-openagent.jsonc",
  ".opencode/plugins/ogb-startup-sync.js",
  ".opencode/tui-plugins/ogb-sidebar.js",
];

const PROJECT_DIRS = [
  ".opencode/agents",
  ".opencode/commands",
  ".opencode/generated",
  ".opencode/plugins",
  ".opencode/skills",
  ".opencode/tui-plugins",
];

function normalizeRelPath(relPath: string): string {
  return relPath.split(/[\\/]+/).filter(Boolean).join("/");
}

function safeRelPath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  return normalized === "opencode.jsonc" || normalized.startsWith(".opencode/");
}

function addCandidate(map: Map<string, Candidate>, relPath: string, reason: string): void {
  const normalized = normalizeRelPath(relPath);
  if (!safeRelPath(normalized)) return;
  if (!map.has(normalized)) map.set(normalized, { relPath: normalized, reason });
}

function readJsonc(filePath: string): any {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function homeProjectConfigLooksManaged(filePath: string): boolean {
  const parsed = readJsonc(filePath);
  if (!parsed || typeof parsed !== "object") return false;
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  if (instructions.includes(".opencode/generated/GEMINI.expanded.md")) return true;
  const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
  return plugins.some((plugin: unknown) => typeof plugin === "string" && plugin.includes("ogb-startup-sync"));
}

function tuiConfigLooksManaged(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    return fs.readFileSync(filePath, "utf8").includes("ogb-sidebar");
  } catch {
    return false;
  }
}

function managedPathsFromOldState(homeDir: string, warnings: string[]): string[] {
  const statePath = path.join(homeDir, ".opencode", "generated", "ogb-sync-state.json");
  const parsed = readJsonc(statePath);
  const files = Array.isArray(parsed?.managedFiles) ? parsed.managedFiles : [];
  const out: string[] = [];
  for (const file of files) {
    if (typeof file?.path !== "string") continue;
    if (file.source !== "ogb") continue;
    const relPath = normalizeRelPath(file.path);
    if (safeRelPath(relPath)) out.push(relPath);
    else warnings.push(`Ignorando path inseguro no estado antigo: ${file.path}`);
  }
  return out;
}

function collectCandidates(homeDir: string, warnings: string[]): Candidate[] {
  const candidates = new Map<string, Candidate>();
  for (const relPath of managedPathsFromOldState(homeDir, warnings)) {
    addCandidate(candidates, relPath, "estado antigo do OGB na home");
  }
  for (const relPath of GENERATED_FILES) addCandidate(candidates, relPath, "arquivo gerado pelo OGB na home");
  for (const relPath of PROJECT_FILES) addCandidate(candidates, relPath, "arquivo de projeto OGB criado na home");
  for (const relPath of PROJECT_DIRS) addCandidate(candidates, relPath, "diretorio de projeto OpenCode antigo criado na home");
  for (const agent of BUILT_IN_AGENTS) addCandidate(candidates, `.opencode/agents/${agent.name}.md`, "agente OGB projetado na home");
  for (const command of BUILT_IN_COMMANDS) addCandidate(candidates, `.opencode/commands/${command.name}.md`, "comando OGB projetado na home");

  const homeProjectConfig = path.join(homeDir, "opencode.jsonc");
  if (homeProjectConfigLooksManaged(homeProjectConfig)) {
    addCandidate(candidates, "opencode.jsonc", "opencode.jsonc de projeto criado na home");
  }

  const tuiConfig = path.join(homeDir, ".opencode", "tui.jsonc");
  if (tuiConfigLooksManaged(tuiConfig)) {
    addCandidate(candidates, ".opencode/tui.jsonc", "config TUI OGB de projeto criado na home");
  }

  return [...candidates.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function pruneIfEmpty(dir: string): void {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    for (const entry of fs.readdirSync(dir)) {
      const child = path.join(dir, entry);
      if (fs.statSync(child).isDirectory()) pruneIfEmpty(child);
    }

    const entries = fs.readdirSync(dir);
    const realEntries = entries.filter((entry) => entry !== ".DS_Store");
    if (realEntries.length > 0) return;
    if (entries.includes(".DS_Store")) fs.rmSync(path.join(dir, ".DS_Store"), { force: true });
    fs.rmdirSync(dir);
  } catch {
    // Best effort; leftover non-empty or locked directories can safely stay.
  }
}

function pruneEmptyDirs(homeDir: string): void {
  const roots = [
    ".opencode/bin",
    ".opencode/generated",
    ".opencode/agents",
    ".opencode/commands",
    ".opencode/plugins",
    ".opencode/tui-plugins",
    ".opencode/skills",
    ".opencode",
  ];

  for (const relPath of roots) {
    const dir = path.join(homeDir, ...relPath.split("/"));
    pruneIfEmpty(dir);
  }
}

export function cleanupHomeProjectArtifacts(options: HomeCleanupOptions = {}): HomeCleanupReport {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const warnings: string[] = [];
  const actions: HomeCleanupAction[] = [];
  const candidates = collectCandidates(homeDir, warnings);
  const backupSession = createBackupSession({
    bridgeConfigDir: bridgeConfigDirForHome(homeDir),
    operation: "home-cleanup",
    roots: [{ root: homeDir }],
    dryRun: options.dryRun,
  });
  let usedBackup = false;

  for (const candidate of candidates) {
    const filePath = path.join(homeDir, ...candidate.relPath.split("/"));
    if (!fs.existsSync(filePath)) continue;
    if (options.dryRun) {
      const backup = backupSession.backupExisting(filePath);
      actions.push({ path: filePath, relPath: candidate.relPath, status: "preview", backup, reason: candidate.reason });
      continue;
    }

    try {
      const backup = backupSession.backupExisting(filePath);
      fs.rmSync(filePath, { recursive: true, force: true });
      usedBackup = usedBackup || Boolean(backup);
      actions.push({ path: filePath, relPath: candidate.relPath, status: "removed", backup, reason: candidate.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Nao foi possivel limpar ${filePath}: ${message}`);
      actions.push({ path: filePath, relPath: candidate.relPath, status: "skipped", reason: candidate.reason });
    }
  }

  if (!options.dryRun) pruneEmptyDirs(homeDir);

  return {
    version: OGB_VERSION,
    homeDir,
    backupDir: options.dryRun || usedBackup ? backupSession.backupDir : undefined,
    backups: backupSession.backups,
    actions,
    warnings: [...new Set([...warnings, ...backupSession.retention.warnings])],
  };
}

export function printHomeCleanupReport(report: HomeCleanupReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("OpenCode Gemini Bridge home cleanup");
  console.log(`Home: ${report.homeDir}`);
  if (report.actions.length === 0) {
    console.log("No old home project artifacts found.");
  } else {
    for (const action of report.actions) {
      console.log(`${action.status}: ${action.relPath}${action.backup ? ` -> ${action.backup}` : ""}`);
    }
    if (report.backupDir) console.log(`Backup: ${report.backupDir}`);
  }

  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}
