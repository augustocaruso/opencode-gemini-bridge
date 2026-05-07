import fs from "node:fs";
import path from "node:path";
import { createBackupSession, type BackupRecord, type BackupSession } from "./backup-policy.js";
import { sha256Text } from "./file-hash.js";
import { resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

export interface BidirectionalSyncOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

export interface BidirectionalSyncChange {
  group: "project-rules" | "global-rules";
  source: string;
  target: string;
  status: "created" | "updated" | "unchanged" | "conflict" | "preview" | "skipped";
  backup?: string;
  message: string;
}

export interface BidirectionalSyncReport {
  version: string;
  projectRoot: string;
  mode: "rules-only";
  dryRun: boolean;
  force: boolean;
  backups: BackupRecord[];
  changes: BidirectionalSyncChange[];
  warnings: string[];
}

function fileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function syncGroup(options: {
  group: BidirectionalSyncChange["group"];
  files: string[];
  projectRoot: string;
  backupSession: BackupSession;
  dryRun?: boolean;
  force?: boolean;
}): BidirectionalSyncChange[] {
  const existing = options.files.filter((file) => fs.existsSync(file));
  if (existing.length === 0) return [];
  const source = existing.sort((a, b) => fileMtime(b) - fileMtime(a))[0];
  const sourceText = readText(source);
  if (sourceText === undefined) return [];
  const sourceHash = sha256Text(sourceText);
  const changes: BidirectionalSyncChange[] = [];

  for (const target of options.files) {
    if (target === source) continue;
    const current = readText(target);
    if (current !== undefined && sha256Text(current) === sourceHash) {
      changes.push({
        group: options.group,
        source,
        target,
        status: "unchanged",
        message: "Already matches newest source.",
      });
      continue;
    }

    if (options.dryRun) {
      changes.push({
        group: options.group,
        source,
        target,
        status: "preview",
        message: current === undefined ? "Would create from newest source." : "Would update from newest source.",
      });
      continue;
    }

    if (current !== undefined && !options.force) {
      changes.push({
        group: options.group,
        source,
        target,
        status: "conflict",
        message: "Target differs. Re-run with --force after reviewing; OGB will create a backup before updating.",
      });
      continue;
    }

    let backup: string | undefined;
    if (current !== undefined) backup = options.backupSession.backupExisting(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, sourceText, "utf8");
    changes.push({
      group: options.group,
      source,
      target,
      status: current === undefined ? "created" : "updated",
      backup,
      message: current === undefined ? "Created from newest source." : "Updated from newest source with backup.",
    });
  }

  return changes;
}

export function runBidirectionalSync(options: BidirectionalSyncOptions = {}): BidirectionalSyncReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const backupSession = createBackupSession({
    bridgeConfigDir: paths.bridgeConfigDir,
    operation: "bidirectional-sync",
    roots: [
      { root: paths.projectRoot, prefix: "project" },
      { root: paths.homeDir, prefix: "home" },
    ],
    dryRun: options.dryRun,
  });
  const changes = [
    ...syncGroup({
      group: "project-rules",
      projectRoot: paths.projectRoot,
      backupSession,
      dryRun: options.dryRun,
      force: options.force,
      files: [
        path.join(paths.projectRoot, "GEMINI.md"),
        path.join(paths.projectRoot, "AGENTS.md"),
      ],
    }),
    ...syncGroup({
      group: "global-rules",
      projectRoot: paths.projectRoot,
      backupSession,
      dryRun: options.dryRun,
      force: options.force,
      files: [
        path.join(paths.homeDir, ".gemini", "GEMINI.md"),
        path.join(paths.homeDir, ".config", "opencode", "AGENTS.md"),
        path.join(paths.homeDir, ".codex", "AGENTS.md"),
      ],
    }),
  ];
  const warnings = changes
    .filter((change) => change.status === "conflict")
    .map((change) => `Conflict: ${change.target} differs from ${change.source}`);
  const report: BidirectionalSyncReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    mode: "rules-only",
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    backups: backupSession.backups,
    changes,
    warnings: [...new Set([...warnings, ...backupSession.retention.warnings])],
  };

  fs.mkdirSync(path.dirname(paths.bidirectionalSyncPath), { recursive: true });
  fs.writeFileSync(paths.bidirectionalSyncPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("OpenCode Gemini Bridge Bidirectional Sync");
    console.log(`Project: ${report.projectRoot}`);
    console.log(`Mode: ${report.mode}`);
    for (const change of changes) {
      console.log(`- ${change.status.toUpperCase()} ${change.group}: ${change.target}`);
      console.log(`  source: ${change.source}`);
      if (change.backup) console.log(`  backup: ${change.backup}`);
      console.log(`  ${change.message}`);
    }
    if (changes.length === 0) console.log("- No user-owned rule files found to sync.");
    for (const warning of warnings) console.log(`Warning: ${warning}`);
  }

  return report;
}
