import fs from "node:fs";
import path from "node:path";

export interface StartupStatusRecovery {
  recovered: boolean;
  previousState?: string;
  state?: string;
  message?: string;
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

export function recoverStaleStartupStatus(projectRoot: string, reason: string, dryRun = false): StartupStatusRecovery {
  const statusPath = path.join(projectRoot, ".opencode", "generated", "ogb-plugin-status.json");
  const lockPath = path.join(projectRoot, ".opencode", "generated", "ogb-startup-sync.lock");
  const status = readJson(statusPath);
  if (status?.state !== "running") {
    return { recovered: false, state: typeof status?.state === "string" ? status.state : undefined };
  }

  const lock = readJson(lockPath);
  const activePid = status.pid ?? lock?.pid;
  if (processExists(activePid)) {
    return { recovered: false, previousState: "running", state: "running" };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, `${JSON.stringify({
      version: 1,
      state: "pass",
      reason,
      cwd: projectRoot,
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
    message: "Recovered stale startup sync status; the recorded process is no longer running.",
  };
}
