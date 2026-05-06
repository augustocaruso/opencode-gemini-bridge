import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { externalOpenCodePlugins, externalTuiPlugins } from "./external-integrations.js";
import { sha256Text } from "./file-hash.js";
import { defaultOpenCodeAgent, readOgbConfig } from "./ogb-config.js";
import { resolveProjectPaths, toPosixRelative } from "./paths.js";
import { ensureProjectConfig, type ProjectConfigResult } from "./project-config.js";
import { spawnCommandSync } from "./process.js";
import { recoverStaleStartupStatus } from "./startup-status.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState } from "./sync-state.js";
import { ensureTuiSidebar } from "./tui-sidebar.js";
import { OGB_VERSION } from "./types.js";

export const STARTUP_SYNC_PLUGIN_PATH = ".opencode/plugins/ogb-startup-sync.js";
export const STARTUP_SYNC_CONFIG_PATH = ".opencode/generated/ogb-startup-sync.json";

export const STARTUP_SYNC_PLUGIN_SOURCE = String.raw`import { spawn } from "node:child_process";
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

function bestEffort(promise, timeoutMs = 1000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function log(client, body) {
  try {
    await bestEffort(client.app.log({ body }));
  } catch {
    // Best effort.
  }
}

async function showToast(client, cwd, input) {
  try {
    if (!client.tui || !client.tui.showToast) return;
    await bestEffort(client.tui.showToast({
      query: { directory: cwd },
      body: {
        title: input.title,
        message: input.message,
        variant: input.variant || "info",
        duration: input.duration ?? 3500,
      },
    }));
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
    pid: process.pid,
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
`;

export interface SetupCommandPlan {
  command: string;
  baseArgs: string[];
  syncArgs: string[];
}

export interface SetupOpenCodeOptions {
  projectRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
  skipDoctor?: boolean;
  skipCommandCheck?: boolean;
  command?: string;
  baseArgs?: string[];
  syncArgs?: string[];
}

export interface ManagedWriteResult {
  path: string;
  relPath: string;
  status: "created" | "updated" | "unchanged" | "preview" | "conflict";
  message: string;
}

export interface SetupOpenCodeReport {
  version: string;
  projectRoot: string;
  opencodeConfig: ProjectConfigResult;
  plugin: ManagedWriteResult;
  startupConfig: ManagedWriteResult;
  sidebarPlugin: ManagedWriteResult;
  tuiConfig: ManagedWriteResult;
  commandPlan: SetupCommandPlan;
  commandCheck: {
    skipped: boolean;
    ok: boolean;
    message: string;
  };
  pluginCheck: {
    ok: boolean;
    message: string;
  };
  sidebarPluginCheck: {
    ok: boolean;
    message: string;
  };
  doctor?: DoctorReport;
  warnings: string[];
}

function currentCliBaseArgs(): string[] {
  const argvScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (argvScript && fs.existsSync(argvScript)) return [argvScript];

  const modulePath = fileURLToPath(import.meta.url);
  const cliPath = path.join(path.dirname(modulePath), "cli.js");
  if (fs.existsSync(cliPath)) return [cliPath];

  return [];
}

function defaultCommandPlan(options: SetupOpenCodeOptions): SetupCommandPlan {
  if (options.command) {
    return {
      command: options.command,
      baseArgs: options.baseArgs ?? [],
      syncArgs: options.syncArgs ?? ["sync"],
    };
  }

  const baseArgs = options.baseArgs ?? currentCliBaseArgs();
  if (baseArgs.length > 0) {
    return {
      command: process.execPath,
      baseArgs,
      syncArgs: options.syncArgs ?? ["sync"],
    };
  }

  return {
    command: "ogb",
    baseArgs: [],
    syncArgs: options.syncArgs ?? ["sync"],
  };
}

function startupConfigSource(plan: SetupCommandPlan): string {
  return `${JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: true,
    command: plan.command,
    baseArgs: plan.baseArgs,
    syncArgs: plan.syncArgs,
    updateArgs: ["auto-update"],
    lockTtlMs: 10 * 60_000,
  }, null, 2)}\n`;
}

function writeManagedText(options: {
  projectRoot: string;
  relPath: string;
  content: string;
  dryRun?: boolean;
  force?: boolean;
}): ManagedWriteResult {
  const absPath = path.join(options.projectRoot, ...options.relPath.split("/"));
  const desiredHash = sha256Text(options.content);

  if (options.dryRun) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: fs.existsSync(absPath) ? "unchanged" : "preview",
      message: fs.existsSync(absPath) ? `Would leave existing ${options.relPath}` : `Would create ${options.relPath}`,
    };
  }

  const state = readSyncState(options.projectRoot) ?? emptySyncState(OGB_VERSION);
  const previousHash = managedHashFor(state, options.relPath, "ogb");
  const exists = fs.existsSync(absPath);
  const currentText = exists ? fs.readFileSync(absPath, "utf8") : "";
  const currentHash = exists ? sha256Text(currentText) : undefined;

  if (exists && currentHash === desiredHash) {
    upsertManagedFile(state, { path: options.relPath, sha256: desiredHash, source: "ogb" });
    writeSyncState(state, options.projectRoot);
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already installed`,
    };
  }

  if (exists && !options.force && previousHash !== currentHash) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "conflict",
      message: `${options.relPath} exists and is not managed by ogb; use --force to overwrite`,
    };
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, options.content, "utf8");
  upsertManagedFile(state, { path: options.relPath, sha256: desiredHash, source: "ogb" });
  writeSyncState(state, options.projectRoot);

  return {
    path: absPath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function checkCommand(plan: SetupCommandPlan): SetupOpenCodeReport["commandCheck"] {
  const result = spawnCommandSync(plan.command, [...plan.baseArgs, "--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (result.error) {
    return {
      skipped: false,
      ok: false,
      message: `Could not execute startup command: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return {
      skipped: false,
      ok: false,
      message: `Startup command failed version check${detail ? `: ${detail}` : ""}`,
    };
  }

  return {
    skipped: false,
    ok: true,
    message: (result.stdout || "Startup command version check passed").trim(),
  };
}

function checkPluginSyntax(pluginPath?: string): SetupOpenCodeReport["pluginCheck"] {
  let target = pluginPath;
  let tempDir: string | undefined;

  if (!target) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-plugin-check-"));
    target = path.join(tempDir, "ogb-startup-sync.js");
    fs.writeFileSync(target, STARTUP_SYNC_PLUGIN_SOURCE, "utf8");
  }

  const result = spawnCommandSync(process.execPath, ["--check", target], {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });

  if (result.error) {
    return {
      ok: false,
      message: `Could not run node --check: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      message: `Plugin syntax check failed${detail ? `: ${detail}` : ""}`,
    };
  }

  return {
    ok: true,
    message: "Plugin syntax check passed",
  };
}

function repairStaleStartupStatus(projectRoot: string, dryRun?: boolean): void {
  recoverStaleStartupStatus(projectRoot, "setup-opencode.recovered-stale", Boolean(dryRun));
}

function currentMcpConfig(projectRoot: string): Record<string, unknown> | undefined {
  const configPath = path.join(projectRoot, "opencode.jsonc");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const parsed = parseJsonc(fs.readFileSync(configPath, "utf8"));
    if (parsed?.mcp && typeof parsed.mcp === "object" && !Array.isArray(parsed.mcp)) {
      return parsed.mcp as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function setupOpenCode(options: SetupOpenCodeOptions = {}): SetupOpenCodeReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const warnings: string[] = [];
  const plan = defaultCommandPlan(options);
  const ogbConfig = readOgbConfig(paths.projectRoot, paths.homeDir);

  const opencodeConfig = ensureProjectConfig({
    projectRoot: paths.projectRoot,
    dryRun: options.dryRun,
    force: options.force,
    mcp: currentMcpConfig(paths.projectRoot),
    plugins: externalOpenCodePlugins(ogbConfig),
    defaultAgent: defaultOpenCodeAgent(ogbConfig),
  });
  if (opencodeConfig.status === "conflict") warnings.push(opencodeConfig.message ?? "opencode.jsonc conflict");

  const plugin = writeManagedText({
    projectRoot: paths.projectRoot,
    relPath: STARTUP_SYNC_PLUGIN_PATH,
    content: STARTUP_SYNC_PLUGIN_SOURCE,
    dryRun: options.dryRun,
    force: options.force,
  });
  if (plugin.status === "conflict") warnings.push(plugin.message);

  const startupConfig = writeManagedText({
    projectRoot: paths.projectRoot,
    relPath: STARTUP_SYNC_CONFIG_PATH,
    content: startupConfigSource(plan),
    dryRun: options.dryRun,
    force: options.force,
  });
  if (startupConfig.status === "conflict") warnings.push(startupConfig.message);

  const sidebar = ensureTuiSidebar({
    projectRoot: paths.projectRoot,
    dryRun: options.dryRun,
    force: options.force,
    extraPlugins: externalTuiPlugins(ogbConfig),
  });
  warnings.push(...sidebar.warnings);

  repairStaleStartupStatus(paths.projectRoot, options.dryRun);

  const commandCheck = options.skipCommandCheck
    ? { skipped: true, ok: true, message: "Startup command check skipped" }
    : checkCommand(plan);
  if (!commandCheck.ok) warnings.push(commandCheck.message);

  const pluginCheck = options.dryRun || plugin.status === "conflict"
    ? checkPluginSyntax()
    : checkPluginSyntax(plugin.path);
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);

  const doctor = !options.skipDoctor && !options.dryRun
    ? runDoctor({ projectRoot: paths.projectRoot, homeDir: options.homeDir })
    : undefined;

  if (doctor?.warnings.length) {
    warnings.push(...doctor.warnings.map((warning) => `Doctor: ${warning}`));
  }

  return {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    opencodeConfig,
    plugin,
    startupConfig,
    sidebarPlugin: sidebar.plugin,
    tuiConfig: sidebar.config,
    commandPlan: plan,
    commandCheck,
    pluginCheck,
    sidebarPluginCheck: sidebar.pluginCheck,
    doctor,
    warnings,
  };
}

export function printSetupReport(report: SetupOpenCodeReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("OpenCode Gemini Bridge setup");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Config: ${report.opencodeConfig.message ?? report.opencodeConfig.status}`);
  console.log(`Plugin: ${report.plugin.message}`);
  console.log(`Startup config: ${report.startupConfig.message}`);
  console.log(`Sidebar plugin: ${report.sidebarPlugin.message}`);
  console.log(`TUI config: ${report.tuiConfig.message}`);
  console.log(`Startup command: ${report.commandPlan.command} ${[...report.commandPlan.baseArgs, ...report.commandPlan.syncArgs].join(" ")}`.trim());
  console.log(`Command check: ${report.commandCheck.message}`);
  console.log(`Plugin check: ${report.pluginCheck.message}`);
  console.log(`Sidebar plugin check: ${report.sidebarPluginCheck.message}`);
  console.log("OpenCode will auto-load the startup plugin and the TUI sidebar plugin on restart.");
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}

export function relativeManagedPath(projectRoot: string, filePath: string): string {
  return toPosixRelative(projectRoot, filePath);
}
