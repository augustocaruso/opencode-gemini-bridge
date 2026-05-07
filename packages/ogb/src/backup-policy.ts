import fs from "node:fs";
import path from "node:path";

type PathApi = Pick<typeof path, "basename" | "dirname" | "extname" | "isAbsolute" | "join" | "relative" | "resolve" | "sep">;

export interface BackupRoot {
  root: string;
  prefix?: string;
}

export interface BackupRecord {
  operation: string;
  source: string;
  backup: string;
  relPath: string;
  dryRun: boolean;
}

export interface BackupRetentionPolicy {
  maxSessionsPerOperation: number;
  maxAgeDays: number;
}

export interface BackupRetentionReport {
  deleted: string[];
  warnings: string[];
}

export interface BackupSession {
  operation: string;
  backupDir: string;
  backups: BackupRecord[];
  retention: BackupRetentionReport;
  backupExisting(filePath: string): string | undefined;
  plannedPath(filePath: string): string;
}

export interface BackupSessionOptions {
  bridgeConfigDir: string;
  operation: string;
  roots?: BackupRoot[];
  dryRun?: boolean;
  pathApi?: PathApi;
  timestamp?: string;
  now?: Date;
}

export const DEFAULT_BACKUP_RETENTION_POLICY: BackupRetentionPolicy = {
  maxSessionsPerOperation: 5,
  maxAgeDays: 30,
};

export function bridgeConfigDirForHome(homeDir: string, pathApi: PathApi = path): string {
  return pathApi.join(pathApi.resolve(homeDir), ".config", "opencode-gemini-bridge");
}

export function safeBackupTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isInside(root: string, filePath: string, pathApi: PathApi): string | undefined {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(filePath));
  if (relative.startsWith("..") || pathApi.isAbsolute(relative)) return undefined;
  return relative || pathApi.basename(pathApi.resolve(root)) || "root";
}

function sanitizeAbsolutePath(filePath: string, pathApi: PathApi): string {
  const sanitized = filePath
    .replace(/^[A-Za-z]:[\\/]/, "")
    .replace(/^[/\\]+/, "")
    .replace(/:/g, "_")
    .split(/[\\/]+/)
    .filter(Boolean);
  return sanitized.length > 0 ? pathApi.join(...sanitized) : "external";
}

function relPathForBackup(filePath: string, roots: BackupRoot[], pathApi: PathApi): string {
  for (const root of roots) {
    const relative = isInside(root.root, filePath, pathApi);
    if (relative === undefined) continue;
    const normalized = relative.split(/[\\/]+/).filter(Boolean);
    return root.prefix ? pathApi.join(root.prefix, ...normalized) : pathApi.join(...normalized);
  }
  return pathApi.join("external", sanitizeAbsolutePath(filePath, pathApi));
}

function uniqueBackupPath(basePath: string, pathApi: PathApi): string {
  if (!fs.existsSync(basePath)) return basePath;
  const dir = pathApi.dirname(basePath);
  const ext = pathApi.extname(basePath);
  const name = pathApi.basename(basePath, ext);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = pathApi.join(dir, `${name}.${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return pathApi.join(dir, `${name}.${Date.now()}${ext}`);
}

function parseBackupTimestamp(timestamp: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(timestamp);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const time = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  );
  if (!Number.isFinite(time)) return undefined;
  if (safeBackupTimestamp(new Date(time)) !== timestamp) return undefined;
  return time;
}

function pruneBackupSessions(options: {
  operationRoot: string;
  currentBackupDir: string;
  pathApi: PathApi;
  now: Date;
  policy: BackupRetentionPolicy;
  report: BackupRetentionReport;
}): void {
  if (!fs.existsSync(options.operationRoot)) return;
  const currentBackupDir = options.pathApi.resolve(options.currentBackupDir);
  const maxAgeMs = options.policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const nowMs = options.now.getTime();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(options.operationRoot, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.report.warnings.push(`Nao foi possivel listar backups antigos em ${options.operationRoot}: ${message}`);
    return;
  }
  const sessions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const createdAt = parseBackupTimestamp(entry.name);
      if (createdAt === undefined) return undefined;
      return {
        name: entry.name,
        path: options.pathApi.join(options.operationRoot, entry.name),
        createdAt,
      };
    })
    .filter((entry): entry is { name: string; path: string; createdAt: number } => entry !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));

  const expired = new Set(
    sessions
      .filter((session) => nowMs - session.createdAt > maxAgeMs)
      .map((session) => session.path),
  );
  const overflow = new Set(sessions.slice(options.policy.maxSessionsPerOperation).map((session) => session.path));
  const toDelete = sessions.filter((session) => expired.has(session.path) || overflow.has(session.path));

  for (const session of toDelete) {
    if (options.pathApi.resolve(session.path) === currentBackupDir) continue;
    try {
      fs.rmSync(session.path, { recursive: true, force: true });
      options.report.deleted.push(session.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.report.warnings.push(`Nao foi possivel remover backup antigo ${session.path}: ${message}`);
    }
  }
}

export function createBackupSession(options: BackupSessionOptions): BackupSession {
  const pathApi = options.pathApi ?? path;
  const operation = options.operation;
  const now = options.now ?? new Date();
  const backupDir = pathApi.join(
    options.bridgeConfigDir,
    "backups",
    operation,
    options.timestamp ?? safeBackupTimestamp(now),
  );
  const operationRoot = pathApi.dirname(backupDir);
  const roots = [
    { root: options.bridgeConfigDir, prefix: "bridge" },
    ...(options.roots ?? []),
  ];
  const backups: BackupRecord[] = [];
  const retention: BackupRetentionReport = { deleted: [], warnings: [] };
  let retentionApplied = false;

  function plannedPath(filePath: string): string {
    return uniqueBackupPath(pathApi.join(backupDir, relPathForBackup(filePath, roots, pathApi)), pathApi);
  }

  function backupExisting(filePath: string): string | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    const backup = plannedPath(filePath);
    const record: BackupRecord = {
      operation,
      source: filePath,
      backup,
      relPath: relPathForBackup(filePath, roots, pathApi),
      dryRun: Boolean(options.dryRun),
    };
    if (!options.dryRun) {
      fs.mkdirSync(pathApi.dirname(backup), { recursive: true });
      fs.cpSync(filePath, backup, { recursive: true });
      backups.push(record);
      if (!retentionApplied) {
        retentionApplied = true;
        pruneBackupSessions({
          operationRoot,
          currentBackupDir: backupDir,
          pathApi,
          now,
          policy: DEFAULT_BACKUP_RETENTION_POLICY,
          report: retention,
        });
      }
    } else {
      backups.push(record);
    }
    return backup;
  }

  return {
    operation,
    backupDir,
    backups,
    retention,
    backupExisting,
    plannedPath,
  };
}
