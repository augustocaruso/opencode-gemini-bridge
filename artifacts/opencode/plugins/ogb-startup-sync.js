import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ARGS = ["sync"];
const DASHBOARD_ARGS = ["dashboard", "--write-only"];
const UPDATE_ARGS = ["auto-update"];
const DEFAULT_LOCK_TTL_MS = 10 * 60_000;
const STATUS_FILE = path.join(".opencode", "generated", "ogb-plugin-status.json");
const UPDATE_STATUS_FILE = path.join(".opencode", "generated", "ogb-update-status.json");
const DASHBOARD_FILE = path.join(".opencode", "generated", "ogb-dashboard.md");
const BRIDGE_COMMANDS = new Set([
  "bridge",
  "doctor",
  "sync",
  "resources",
  "validate",
  "security-check",
  "telemetry",
  "agent-sync",
  "status",
  "update-extensions",
  "upgrade-ogb",
]);

function splitArgs(raw, fallback = DEFAULT_ARGS) {
  if (!raw || !raw.trim()) return fallback;
  return raw.trim().split(/\s+/);
}

function readConfig(cwd) {
  const configPath = path.join(cwd, ".opencode", "generated", "ogb-startup-sync.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function hasStartupConfig(cwd) {
  return Boolean(cwd) && cwd !== "/" && fs.existsSync(path.join(cwd, ".opencode", "generated", "ogb-startup-sync.json"));
}

function resolveCwd({ directory, worktree }) {
  const candidates = [worktree, directory, process.cwd()].filter(Boolean).map(String);
  for (const candidate of candidates) {
    if (hasStartupConfig(candidate)) return candidate;
  }
  return undefined;
}

function commandPlan(cwd) {
  const config = readConfig(cwd);
  if (process.env.OGB_BIN) {
    return {
      command: process.env.OGB_BIN,
      args: splitArgs(process.env.OGB_STARTUP_SYNC_ARGS),
      lockTtlMs: Number(config.lockTtlMs ?? DEFAULT_LOCK_TTL_MS),
    };
  }

  const command = config.command || "ogb";
  const baseArgs = Array.isArray(config.baseArgs) ? config.baseArgs.map(String) : [];
  const syncArgs = process.env.OGB_STARTUP_SYNC_ARGS
    ? splitArgs(process.env.OGB_STARTUP_SYNC_ARGS)
    : Array.isArray(config.syncArgs)
      ? config.syncArgs.map(String)
      : DEFAULT_ARGS;

  return {
    command,
    args: [...baseArgs, ...syncArgs],
    lockTtlMs: Number(config.lockTtlMs ?? DEFAULT_LOCK_TTL_MS),
    enabled: config.enabled !== false,
  };
}

function autoUpdatePlan(cwd, syncPlan) {
  const config = readConfig(cwd);
  const enabled = process.env.OGB_AUTO_UPDATE !== "0" && config.autoUpdate !== false;
  const verbs = new Set(["sync", "import", "doctor", "dashboard", "auto-update", "check-update"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  const baseArgs = verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
  const updateArgs = process.env.OGB_AUTO_UPDATE_ARGS
    ? splitArgs(process.env.OGB_AUTO_UPDATE_ARGS, UPDATE_ARGS)
    : Array.isArray(config.updateArgs)
      ? config.updateArgs.map(String)
      : UPDATE_ARGS;
  return {
    command: syncPlan.command,
    args: [...baseArgs, ...updateArgs],
    enabled,
  };
}

function tail(text) {
  return String(text || "").slice(-4000);
}

function statusPath(cwd) {
  return path.join(cwd, STATUS_FILE);
}

function updateStatusPath(cwd) {
  return path.join(cwd, UPDATE_STATUS_FILE);
}

function writeStatus(cwd, status) {
  try {
    const filePath = statusPath(cwd);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, ...status }, null, 2) + "\n", "utf8");
  } catch {
    // Best effort; OpenCode logs still get the failure details.
  }
}

function readUpdateStatus(cwd) {
  try {
    return JSON.parse(fs.readFileSync(updateStatusPath(cwd), "utf8"));
  } catch {
    return {};
  }
}

function writeUpdateStatus(cwd, status) {
  try {
    const filePath = updateStatusPath(cwd);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, ...status }, null, 2) + "\n", "utf8");
  } catch {
    // Best effort; the main plugin status still captures the failure.
  }
}

async function log(client, body) {
  try {
    await client.app.log({ body });
  } catch {
    // Best effort.
  }
}

async function showToast(client, cwd, input) {
  try {
    if (!client.tui || !client.tui.showToast) return;
    await client.tui.showToast({
      query: { directory: cwd },
      body: {
        title: input.title,
        message: input.message,
        variant: input.variant || "info",
        duration: input.duration ?? 3500,
      },
    });
  } catch {
    // The server can start before a TUI is ready. Logging remains the source of truth.
  }
}

function dashboardPlanFrom(syncPlan) {
  const verbs = new Set(["sync", "import", "doctor", "dashboard"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  const baseArgs = verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
  return {
    command: syncPlan.command,
    args: [...baseArgs, ...DASHBOARD_ARGS],
  };
}

function telemetryPlanFrom(syncPlan) {
  const verbs = new Set(["sync", "import", "doctor", "dashboard", "auto-update", "check-update", "telemetry"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  const baseArgs = verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
  return {
    command: syncPlan.command,
    args: [...baseArgs, "telemetry", "record"],
  };
}

function runProcess({ cwd, plan, input }) {
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const child = spawn(plan.command, plan.args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    } catch {
      // The child may fail before stdin is ready; the error handler captures it.
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        exitCode: null,
        error: error.message,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: code === 0,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function acquireLock(lockPath, ttlMs) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < ttlMs) return false;
    fs.unlinkSync(lockPath);
  } catch {
    // Missing or unreadable lock: try to create a fresh one.
  }

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Best effort.
  }
}

async function updateDashboard({ cwd, client, syncPlan }) {
  const plan = dashboardPlanFrom(syncPlan);
  const result = await runProcess({ cwd, plan });

  await log(client, {
    service: "ogb-startup-sync",
    level: result.ok ? "info" : "warn",
    message: result.ok ? "ogb dashboard refreshed" : "ogb dashboard refresh failed",
    extra: {
      cwd,
      command: plan.command,
      args: plan.args,
      exitCode: result.exitCode,
      error: result.error,
      stdout: tail(result.stdout),
      stderr: tail(result.stderr),
    },
  });

  return result;
}

async function recordTelemetry({ cwd, client, syncPlan, reason, result, update, dashboard, status }) {
  const plan = telemetryPlanFrom(syncPlan);
  const payload = {
    reason,
    state: status.state,
    durationMs: status.durationMs,
    exitCode: status.exitCode,
    updateStatus: update.status,
    updateRestartRequired: update.restartRequired === true,
    dashboardExitCode: dashboard.exitCode,
    dashboardError: dashboard.error,
    stdoutTail: status.stdoutTail,
    stderrTail: status.stderrTail,
    error: status.error,
  };
  const args = [
    ...plan.args,
    "--workflow", "startup-plugin",
    "--phase", reason,
    "--status", result.ok ? "completed" : "failed",
    "--outcome", result.ok ? "pass" : "fail",
    "--exit-code", String(result.exitCode ?? (result.ok ? 0 : 1)),
    "--duration-ms", String(result.durationMs ?? 0),
    "--source", "plugin",
    "--command", [syncPlan.command, ...syncPlan.args].join(" "),
    "--payload", "-",
  ];
  const telemetry = await runProcess({ cwd, plan: { command: plan.command, args }, input: JSON.stringify(payload) + "\n" });

  await log(client, {
    service: "ogb-startup-sync",
    level: telemetry.ok ? "info" : "warn",
    message: telemetry.ok ? "ogb telemetry recorded" : "ogb telemetry record failed",
    extra: {
      cwd,
      command: plan.command,
      args,
      exitCode: telemetry.exitCode,
      error: telemetry.error,
      stdout: tail(telemetry.stdout),
      stderr: tail(telemetry.stderr),
    },
  });
}

async function runAutoUpdate({ cwd, client, syncPlan, reason }) {
  const plan = autoUpdatePlan(cwd, syncPlan);
  if (!plan.enabled) return { skipped: true, status: "disabled" };

  await log(client, {
    service: "ogb-startup-sync",
    level: "info",
    message: "Checking OGB auto-update (" + reason + ")",
    extra: { cwd, command: plan.command, args: plan.args },
  });

  const result = await runProcess({ cwd, plan });
  const status = readUpdateStatus(cwd);
  const updated = result.ok && status.status === "updated" && status.restartRequired === true;
  const failed = !result.ok || status.status === "error";

  await log(client, {
    service: "ogb-startup-sync",
    level: failed ? "warn" : "info",
    message: updated ? "OGB auto-update applied; restart OpenCode" : failed ? "OGB auto-update failed" : "OGB auto-update check completed",
    extra: {
      cwd,
      command: plan.command,
      args: plan.args,
      exitCode: result.exitCode,
      error: result.error || status.message,
      stdout: tail(result.stdout),
      stderr: tail(result.stderr),
      status,
    },
  });

  if (updated) {
    await showToast(client, cwd, {
      title: "OGB ATUALIZADO",
      message: "Reinicie o OpenCode para carregar plugin e comandos novos.",
      variant: "warning",
      duration: 9000,
    });
  } else if (failed) {
    writeUpdateStatus(cwd, {
      status: "error",
      checkedAt: new Date().toISOString(),
      restartRequired: false,
      message: result.error || status.message || "OGB auto-update failed.",
      command: plan.command,
      args: plan.args,
      exitCode: result.exitCode,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    });
    await showToast(client, cwd, {
      title: "OGB UPDATE FALHOU",
      message: "Use /upgrade-ogb quando quiser tentar manualmente.",
      variant: "error",
      duration: 6500,
    });
  }

  return {
    skipped: false,
    status: status.status || (result.ok ? "current" : "error"),
    restartRequired: updated,
    exitCode: result.exitCode,
    error: result.error,
  };
}

async function runCommand({ cwd, client, reason }) {
  const plan = commandPlan(cwd);
  const startedAt = new Date().toISOString();

  writeStatus(cwd, {
    state: "running",
    reason,
    cwd,
    startedAt,
    command: plan.command,
    args: plan.args,
  });
  await showToast(client, cwd, {
    title: "OGB SYNC",
    message: "Atualizando bridge no startup...",
    variant: "info",
    duration: 2500,
  });

  const update = await runAutoUpdate({ cwd, client, syncPlan: plan, reason });
  const result = await runProcess({ cwd, plan });
  const finishedAt = new Date().toISOString();
  const baseStatus = {
    state: result.ok ? "pass" : "fail",
    reason,
    cwd,
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    command: plan.command,
    args: plan.args,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error,
    updateStatus: update.status,
    updateRestartRequired: update.restartRequired === true,
    dashboardPath: path.join(cwd, DASHBOARD_FILE),
  };
  writeStatus(cwd, baseStatus);

  const dashboard = await updateDashboard({ cwd, client, syncPlan: plan });
  const status = {
    ...baseStatus,
    dashboardExitCode: dashboard.exitCode,
    dashboardError: dashboard.error,
  };
  writeStatus(cwd, status);

  await log(client, {
    service: "ogb-startup-sync",
    level: result.ok ? "info" : "warn",
    message: result.ok ? "ogb sync completed" : "ogb sync failed",
    extra: status,
  });

  await recordTelemetry({ cwd, client, syncPlan: plan, reason, result, update, dashboard, status });

  if (result.ok && update.restartRequired === true) {
    await showToast(client, cwd, {
      title: "REINICIE OPENCODE",
      message: "O OGB foi atualizado e a sessao atual ainda usa partes antigas.",
      variant: "warning",
      duration: 9000,
    });
  } else if (result.ok) {
    await showToast(client, cwd, {
      title: "OGB SYNC OK",
      message: "Bridge atualizado. Use /bridge para ver o painel.",
      variant: "success",
      duration: 4500,
    });
  } else {
    await showToast(client, cwd, {
      title: "OGB SYNC FALHOU",
      message: "Rode /bridge ou ogb dashboard para ver o motivo.",
      variant: "error",
      duration: 6500,
    });
  }

  return result.ok;
}

export const OgbStartupSync = async ({ client, directory, worktree }) => {
  const cwd = resolveCwd({ directory, worktree });
  if (!cwd) {
    await log(client, {
      service: "ogb-startup-sync",
      level: "info",
      message: "Skipping ogb startup sync: no project startup config found",
      extra: { directory, worktree },
    });
    return {};
  }

  const plan = commandPlan(cwd);
  const enabled = process.env.OGB_STARTUP_SYNC !== "0" && plan.enabled !== false;
  const lockPath = path.join(cwd, ".opencode", "generated", "ogb-startup-sync.lock");

  async function runOnce(reason) {
    if (!enabled) return;
    if (!acquireLock(lockPath, plan.lockTtlMs)) return;

    try {
      await log(client, {
        service: "ogb-startup-sync",
        level: "info",
        message: "Running ogb startup sync (" + reason + ")",
        extra: { cwd },
      });
      await runCommand({ cwd, client, reason });
    } finally {
      releaseLock(lockPath);
    }
  }

  queueMicrotask(() => {
    void runOnce("plugin.init");
  });

  return {
    "session.created": async () => {
      if (process.env.OGB_SYNC_ON_SESSION_CREATED === "1") {
        await runOnce("session.created");
      }
    },
    "command.execute.before": async (input) => {
      if (BRIDGE_COMMANDS.has(input.command)) {
        await showToast(client, cwd, {
          title: "OGB " + input.command.toUpperCase(),
          message: "Comando do bridge iniciado.",
          variant: "info",
          duration: 2200,
        });
      }
    },
  };
};
