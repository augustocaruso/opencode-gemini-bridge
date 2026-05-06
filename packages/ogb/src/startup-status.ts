import fs from "node:fs";
import path from "node:path";

export interface StartupStatusRecovery {
  recovered: boolean;
  previousState?: string;
  state?: string;
  lockRemoved?: boolean;
  message?: string;
}

export interface StartupStatusRecoveryOptions {
  statusPath: string;
  lockPath: string;
  cwd: string;
  reason: string;
  dryRun?: boolean;
}

function readJson(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export function processExists(pid: unknown): boolean {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EPERM");
  }
}

function removeStaleLock(lockPath: string, dryRun = false): boolean {
  const lock = readJson(lockPath);
  if (!fs.existsSync(lockPath)) return false;
  if (processExists(lock?.pid)) return false;
  if (!dryRun) fs.rmSync(lockPath, { force: true });
  return true;
}

export function recoverStaleStartupStatus(options: StartupStatusRecoveryOptions): StartupStatusRecovery {
  const { statusPath, lockPath, cwd, reason, dryRun = false } = options;
  const status = readJson(statusPath);
  const lock = readJson(lockPath);
  if (status?.state !== "running") {
    const lockRemoved = removeStaleLock(lockPath, dryRun);
    return {
      recovered: false,
      state: typeof status?.state === "string" ? status.state : undefined,
      lockRemoved,
      message: lockRemoved ? "Removed stale startup sync lock; the recorded process is no longer running." : undefined,
    };
  }

  const activePid = status.pid ?? lock?.pid;
  if (processExists(activePid)) {
    return { recovered: false, previousState: "running", state: "running" };
  }
  const hadLock = fs.existsSync(lockPath);

  if (!dryRun) {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, `${JSON.stringify({
      version: 1,
      state: "pass",
      reason,
      cwd,
      startedAt: typeof status.startedAt === "string" ? status.startedAt : new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: typeof status.durationMs === "number" ? status.durationMs : undefined,
      exitCode: 0,
      command: status.command,
      args: Array.isArray(status.args) ? status.args : undefined,
      stdoutTail: "Recovered stale startup sync status; the recorded process is no longer running.",
    }, null, 2)}\n`, "utf8");
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // Best effort.
    }
  }

  return {
    recovered: true,
    previousState: "running",
    state: "pass",
    lockRemoved: hadLock,
    message: "Recovered stale startup sync status; the recorded process is no longer running.",
  };
}
