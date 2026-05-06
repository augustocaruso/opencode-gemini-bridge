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
import os from "node:os";
import path from "node:path";

const DEFAULT_ARGS = ["startup-sync"];
const DASHBOARD_ARGS = ["dashboard", "--write-only"];
const UPDATE_ARGS = ["check-update", "--no-write"];
const DEFAULT_LOCK_TTL_MS = 10 * 60_000;
const DEFAULT_FAILURE_BACKOFF_MS = 10 * 60_000;
const PROJECT_GENERATED_DIR = path.join(".opencode", "generated");
const GLOBAL_GENERATED_DIR = path.join(os.homedir(), ".config", "opencode-gemini-bridge", "generated");
const STARTUP_CONFIG_FILE = "ogb-startup-sync.json";
const STATUS_FILE = "ogb-plugin-status.json";
const STARTUP_LOCK_FILE = "ogb-startup-sync.lock";
const UPDATE_STATUS_FILE = "ogb-update-status.json";
const DASHBOARD_FILE = "ogb-dashboard.md";
const STARTUP_DELAY_MS = 2500;
const OGB_DIRECT_COMMANDS = {
  bridge: {
    description: "Painel principal do OpenCode Gemini Bridge",
    template: "Mostra o painel OGB diretamente no chat.",
  },
  doctor: {
    description: "Mostra diagnostico do OpenCode Gemini Bridge",
    template: "Executa ogb doctor e imprime o resultado diretamente no chat.",
  },
  resources: {
    description: "Lista recursos projetados pelo bridge",
    template: "Mostra os recursos OGB diretamente no chat.",
  },
  validate: {
    description: "Valida o bridge de ponta a ponta sem chamar modelo por padrao",
    template: "Executa ogb validate e imprime o resultado diretamente no chat.",
  },
  "security-check": {
    description: "Verifica riscos obvios de seguranca do bridge",
    template: "Executa ogb security-check e imprime o resultado diretamente no chat.",
  },
  telemetry: {
    description: "Mostra e envia telemetria local do OpenCode Gemini Bridge",
    template: "Executa ogb telemetry status por padrao, ou a acao informada.",
  },
  "agent-sync": {
    description: "Planeja adocao segura do agent-rules-sync",
    template: "Executa ogb adopt-agent-sync e imprime o resultado diretamente no chat.",
  },
  status: {
    description: "Resume o estado atual do bridge",
    template: "Mostra o status OGB diretamente no chat.",
  },
  "update-extensions": {
    description: "Atualiza Gemini Extensions e reprojeta OpenCode",
    template: "Roda dry-run por padrao. Use --apply para atualizar de verdade.",
  },
  "upgrade-ogb": {
    description: "Atualiza o OpenCode Gemini Bridge pela release oficial",
    template: "Executa ogb self-update e depois ogb doctor diretamente no chat.",
  },
};
const BRIDGE_COMMANDS = new Set([...Object.keys(OGB_DIRECT_COMMANDS), "sync"]);
const COMMAND_REGISTRATION_SKIP = new Set(["sync"]);

function splitArgs(raw, fallback = DEFAULT_ARGS) {
  if (!raw || !raw.trim()) return fallback;
  return raw.trim().split(/\s+/);
}

function splitCommandArgs(raw) {
  const args = [];
  let current = "";
  let quote = "";
  let escaping = false;
  for (const char of String(raw || "")) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function projectStartupConfigPath(cwd) {
  return path.join(cwd, PROJECT_GENERATED_DIR, STARTUP_CONFIG_FILE);
}

function globalStartupConfigPath() {
  return path.join(GLOBAL_GENERATED_DIR, STARTUP_CONFIG_FILE);
}

function isHomeCwd(cwd) {
  try {
    return path.resolve(String(cwd || "")) === path.resolve(os.homedir());
  } catch {
    return false;
  }
}

function startupConfigPath(cwd) {
  if (!cwd || cwd === "/") return undefined;
  const globalConfig = globalStartupConfigPath();
  if (isHomeCwd(cwd) && fs.existsSync(globalConfig)) return globalConfig;
  if (isHomeCwd(cwd)) return undefined;
  const projectConfig = projectStartupConfigPath(cwd);
  if (fs.existsSync(projectConfig)) return projectConfig;
  return undefined;
}

function generatedDir(cwd) {
  const configPath = startupConfigPath(cwd);
  if (configPath && path.resolve(configPath) === path.resolve(globalStartupConfigPath())) return GLOBAL_GENERATED_DIR;
  return path.join(cwd, PROJECT_GENERATED_DIR);
}

function readConfig(cwd) {
  const configPath = startupConfigPath(cwd);
  if (!configPath) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function readStatus(cwd) {
  try {
    return JSON.parse(fs.readFileSync(statusPath(cwd), "utf8"));
  } catch {
    return {};
  }
}

function hasStartupConfig(cwd) {
  return Boolean(startupConfigPath(cwd));
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

function safeUpdateArgs(args) {
  const raw = Array.isArray(args) && args.length > 0 ? args.map(String) : UPDATE_ARGS;
  if (raw.some((arg) => ["auto-update", "self-update", "upgrade-ogb"].includes(arg))) return UPDATE_ARGS;
  if (!raw.includes("check-update")) return UPDATE_ARGS;
  return raw.includes("--no-write") ? raw : [...raw, "--no-write"];
}

function autoUpdatePlan(cwd, syncPlan) {
  const config = readConfig(cwd);
  const enabled = process.env.OGB_AUTO_UPDATE !== "0" && (process.env.OGB_AUTO_UPDATE === "1" || config.autoUpdate === true);
  const verbs = new Set(["sync", "startup-sync", "import", "doctor", "dashboard", "auto-update", "check-update"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  const baseArgs = verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
  const updateArgs = process.env.OGB_AUTO_UPDATE_ARGS
    ? safeUpdateArgs(splitArgs(process.env.OGB_AUTO_UPDATE_ARGS, UPDATE_ARGS))
    : Array.isArray(config.updateArgs)
      ? safeUpdateArgs(config.updateArgs)
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
  return path.join(generatedDir(cwd), STATUS_FILE);
}

function startupLockPath(cwd) {
  return path.join(generatedDir(cwd), STARTUP_LOCK_FILE);
}

function updateStatusPath(cwd) {
  return path.join(generatedDir(cwd), UPDATE_STATUS_FILE);
}

function dashboardPath(cwd) {
  return path.join(generatedDir(cwd), DASHBOARD_FILE);
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
  const verbs = new Set(["sync", "startup-sync", "import", "doctor", "dashboard"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  const baseArgs = verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
  return {
    command: syncPlan.command,
    args: [...baseArgs, ...DASHBOARD_ARGS],
  };
}

function telemetryPlanFrom(syncPlan) {
  const verbs = new Set(["sync", "startup-sync", "import", "doctor", "dashboard", "auto-update", "check-update", "telemetry"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  const baseArgs = verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
  return {
    command: syncPlan.command,
    args: [...baseArgs, "telemetry", "record"],
  };
}

function cmdQuote(value) {
  const escaped = String(value)
    .replace(/"/g, '""')
    .replace(/\^/g, "^^")
    .replace(/%/g, "^%");
  return '"' + escaped + '"';
}

function normalizeCommandInput(value) {
  let normalized = String(value).trim();
  let changed = true;
  while (changed && normalized.length >= 2) {
    changed = false;
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (normalized.length >= 4) {
      const escapedFirst = normalized.slice(0, 2);
      const escapedLast = normalized.slice(-2);
      if ((escapedFirst === '\\"' && escapedLast === '\\"') || (escapedFirst === "\\'" && escapedLast === "\\'")) {
        normalized = normalized.slice(2, -2).trim();
        changed = true;
      }
    }
  }
  return normalized;
}

function cmdToken(value, command = false) {
  const text = String(value);
  if (command && /^[A-Za-z0-9_.-]+$/.test(text)) return text;
  if (!command && /^[A-Za-z0-9_./:@+=-]+$/.test(text)) return text;
  return cmdQuote(text);
}

function commandForPlatform(command, args) {
  const normalizedCommand = normalizeCommandInput(command);
  if (process.platform !== "win32") return { command: normalizedCommand, args };

  const ext = path.basename(normalizedCommand).toLowerCase().match(/\.[^.]+$/)?.[0];
  if (ext === ".exe") return { command: normalizedCommand, args };

  const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
  const innerCommandLine = [cmdToken(normalizedCommand, true), ...args.map((arg) => cmdToken(arg))].join(" ");
  const commandLine = '"' + innerCommandLine + '"';
  return {
    command: comspec,
    args: ["/d", "/s", "/c", commandLine],
    windowsVerbatimArguments: true,
  };
}

function baseArgsFrom(syncPlan) {
  const verbs = new Set(["sync", "startup-sync", "import", "doctor", "dashboard", "pass", "auto-update", "check-update", "telemetry", "validate", "security-check", "adopt-agent-sync", "update-extensions", "self-update"]);
  const verbIndex = syncPlan.args.findIndex((arg) => verbs.has(String(arg)));
  return verbIndex >= 0 ? syncPlan.args.slice(0, verbIndex) : [];
}

function withoutProjectArgs(args) {
  const clean = [];
  for (let index = 0; index < args.length; index += 1) {
    if (String(args[index]) === "--project") {
      index += 1;
      continue;
    }
    clean.push(args[index]);
  }
  return clean;
}

function withoutApplyFlags(args) {
  return args.filter((arg) => !["--apply", "--run", "--yes"].includes(String(arg)));
}

function hasApplyFlag(args) {
  return args.some((arg) => ["--apply", "--run", "--yes"].includes(String(arg)));
}

function hasDryRunFlag(args) {
  return args.some((arg) => String(arg) === "--dry-run");
}

function isLocalOgbSyncCommand(cwd) {
  try {
    const syncPath = path.join(cwd, ".opencode", "commands", "sync.md");
    return fs.existsSync(syncPath) && fs.readFileSync(syncPath, "utf8").includes("Sincroniza recursos Gemini para OpenCode");
  } catch {
    return false;
  }
}

function directCommandPlans(cwd, syncPlan, commandName, rawArgs) {
  const userArgs = splitCommandArgs(rawArgs);
  const baseArgs = withoutProjectArgs(baseArgsFrom(syncPlan));
  const projectArgs = ["--project", cwd];
  const plan = (args) => ({ command: syncPlan.command, args: [...baseArgs, ...projectArgs, ...args] });

  if (commandName === "bridge") return [plan(["pass", ...userArgs])];
  if (commandName === "doctor") return [plan(["doctor", ...userArgs])];
  if (commandName === "resources") return [plan(["dashboard", "--no-refresh", ...userArgs])];
  if (commandName === "validate") return [plan(["validate", ...userArgs])];
  if (commandName === "security-check") return [plan(["security-check", ...userArgs])];
  if (commandName === "agent-sync") return [plan(["adopt-agent-sync", ...userArgs])];
  if (commandName === "status") return [plan(["dashboard", "--no-refresh", ...userArgs])];
  if (commandName === "telemetry") return [plan(["telemetry", ...(userArgs.length > 0 ? userArgs : ["status"])])];
  if (commandName === "sync") {
    const args = withoutApplyFlags(userArgs);
    return [plan(["sync", ...(hasApplyFlag(userArgs) || hasDryRunFlag(args) ? args : ["--dry-run", ...args])])];
  }
  if (commandName === "update-extensions") {
    const args = withoutApplyFlags(userArgs);
    return [plan(["update-extensions", ...(hasApplyFlag(userArgs) || hasDryRunFlag(args) ? args : ["--dry-run", ...args])])];
  }
  if (commandName === "upgrade-ogb") return [plan(["self-update", ...userArgs])];
  return [];
}

function quoteArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function commandLine(plan) {
  return [plan.command, ...plan.args].map(quoteArg).join(" ");
}

function chatTail(text, maxChars = 12000) {
  const value = String(text || "").trimEnd();
  if (value.length <= maxChars) return value;
  return "[saida truncada; mostrando o final]\n" + value.slice(-maxChars);
}

function formatDirectCommandMessage(commandName, results) {
  const lines = [
    "OpenCode Gemini Bridge /" + commandName,
    "",
  ];
  for (const result of results) {
    lines.push("Comando:");
    lines.push("~~~sh");
    lines.push(commandLine(result.plan));
    lines.push("~~~");
    lines.push("");

    const output = chatTail([result.stdout, result.stderr].filter(Boolean).join("\n"));
    if (output) {
      lines.push("Saida:");
      lines.push("~~~text");
      lines.push(output);
      lines.push("~~~");
      lines.push("");
    }

    const status = result.ok ? "PASS" : "FAIL";
    const exitCode = result.exitCode === null || result.exitCode === undefined ? "sem exit code" : "exit " + result.exitCode;
    lines.push("Status: " + status + " (" + exitCode + ")");
    if (result.error) lines.push("Erro: " + result.error);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function sendDirectChatMessage(client, sessionID, text) {
  try {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        parts: [
          {
            type: "text",
            text,
            ignored: true,
          },
        ],
      },
    });
  } catch (error) {
    await log(client, {
      service: "ogb-startup-sync",
      level: "warn",
      message: "Failed to send direct command output",
      extra: { error: String(error?.message || error) },
    });
  }
}

async function handleDirectBridgeCommand({ cwd, client, input }) {
  const commandName = String(input?.command || "");
  if (!BRIDGE_COMMANDS.has(commandName)) return false;
  if (commandName === "sync" && !isLocalOgbSyncCommand(cwd)) return false;
  if (!input?.sessionID) return false;

  await showToast(client, cwd, {
    title: "OGB " + commandName.toUpperCase(),
    message: commandName === "sync" && !hasApplyFlag(splitCommandArgs(input.arguments || ""))
      ? "Rodando preview do bridge."
      : "Rodando comando do bridge.",
    variant: "info",
    duration: 2200,
  });

  const syncPlan = commandPlan(cwd);
  const plans = directCommandPlans(cwd, syncPlan, commandName, input.arguments || "");
  const results = [];
  for (const plan of plans) {
    const result = await runProcess({ cwd, plan });
    results.push({ ...result, plan });
  }

  await sendDirectChatMessage(client, input.sessionID, formatDirectCommandMessage(commandName, results));
  await log(client, {
    service: "ogb-startup-sync",
    level: results.every((result) => result.ok) ? "info" : "warn",
    message: "ogb direct command executed",
    extra: {
      cwd,
      command: commandName,
      plans: plans.map((plan) => ({ command: plan.command, args: plan.args })),
      results: results.map((result) => ({
        exitCode: result.exitCode,
        error: result.error,
        stdout: tail(result.stdout),
        stderr: tail(result.stderr),
      })),
    },
  });
  return true;
}

function runProcess({ cwd, plan, input }) {
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const normalized = commandForPlatform(plan.command, plan.args);
    const child = spawn(normalized.command, normalized.args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: normalized.windowsVerbatimArguments === true,
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
        signal: null,
        error: error.message,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: code === 0,
        exitCode: code,
        signal,
        error: code === null && signal ? "Process terminated by signal " + signal : undefined,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return {};
  }
}

function processExists(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function acquireLock(lockPath, ttlMs) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    const stat = fs.statSync(lockPath);
    const lock = readLock(lockPath);
    if (processExists(lock.pid)) {
      return { acquired: false, reason: "active", pid: Number(lock.pid), startedAt: lock.startedAt };
    }
    if (Date.now() - stat.mtimeMs < ttlMs) {
      fs.unlinkSync(lockPath);
    } else {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      return { acquired: false, reason: "unreadable", error: String(error.message || error) };
    }
    // Missing lock: try to create a fresh one.
  }

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    fs.closeSync(fd);
    return { acquired: true };
  } catch (error) {
    return { acquired: false, reason: "raced", error: String(error?.message || error) };
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
  }

  return {
    skipped: false,
    status: status.status || (result.ok ? "current" : "error"),
    restartRequired: updated,
    exitCode: result.exitCode,
    error: result.error,
  };
}

function nextFailureCount(cwd) {
  const previous = readStatus(cwd);
  if (previous?.state !== "fail") return 1;
  const count = Number(previous.failureCount ?? 1);
  return Number.isFinite(count) && count > 0 ? count + 1 : 2;
}

function shortFailure(result) {
  const detail = result.error || tail(result.stderr).trim() || tail(result.stdout).trim();
  return detail ? String(detail).split(/\r?\n/).find(Boolean)?.slice(0, 220) : undefined;
}

async function runCommand({ cwd, client, reason, notifications, failureBackoffMs }) {
  const plan = commandPlan(cwd);
  const startedAt = new Date().toISOString();
  const failureCountIfNeeded = nextFailureCount(cwd);

  writeStatus(cwd, {
    state: "running",
    reason,
    cwd,
    pid: process.pid,
    hostPid: process.pid,
    lockPath: startupLockPath(cwd),
    startedAt,
    command: plan.command,
    args: plan.args,
  });

  const update = await runAutoUpdate({ cwd, client, syncPlan: plan, reason });
  const result = await runProcess({ cwd, plan });
  const finishedAt = new Date().toISOString();
  const failureCount = result.ok ? 0 : failureCountIfNeeded;
  const nextRetryAfter = result.ok ? undefined : new Date(Date.now() + failureBackoffMs).toISOString();
  const baseStatus = {
    state: result.ok ? "pass" : "fail",
    reason,
    cwd,
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    command: plan.command,
    args: plan.args,
    hostPid: process.pid,
    lockPath: startupLockPath(cwd),
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error,
    failureCount,
    nextRetryAfter,
    updateStatus: update.status,
    updateRestartRequired: update.restartRequired === true,
    dashboardPath: dashboardPath(cwd),
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

  if (result.ok && update.restartRequired === true && notifications.success()) {
    await showToast(client, cwd, {
      title: "REINICIE OPENCODE",
      message: "O OGB foi atualizado e a sessao atual ainda usa partes antigas.",
      variant: "warning",
      duration: 9000,
    });
  } else if (result.ok && notifications.success()) {
    await showToast(client, cwd, {
      title: "OGB SYNC OK",
      message: "Bridge atualizado. Use /bridge para ver o painel.",
      variant: "success",
      duration: 4500,
    });
  } else if (!result.ok && notifications.failure()) {
    await showToast(client, cwd, {
      title: "OGB SYNC FALHOU",
      message: shortFailure(result) || "Rode /bridge ou ogb dashboard para ver o motivo.",
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
  const lockPath = startupLockPath(cwd);
  const startupEvents = new Set(["session.created"]);
  const config = readConfig(cwd);
  const configuredBackoff = Number(config.failureBackoffMs ?? DEFAULT_FAILURE_BACKOFF_MS);
  const failureBackoffMs = Number.isFinite(configuredBackoff) && configuredBackoff >= 0 ? configuredBackoff : DEFAULT_FAILURE_BACKOFF_MS;
  let startupTimer;
  let startupStarted = false;
  let successToastShown = false;
  let failureToastShown = false;

  function backoffStatus() {
    const status = readStatus(cwd);
    if (status?.state !== "fail" || typeof status.nextRetryAfter !== "string") return { blocked: false };
    const retryAt = Date.parse(status.nextRetryAfter);
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return { blocked: false };
    return {
      blocked: true,
      nextRetryAfter: status.nextRetryAfter,
      failureCount: Number(status.failureCount ?? 1),
    };
  }

  const notifications = {
    success() {
      if (successToastShown) return false;
      successToastShown = true;
      return true;
    },
    failure() {
      if (failureToastShown) return false;
      failureToastShown = true;
      return true;
    },
  };

  async function runOnce(reason) {
    if (!enabled) return;
    if (startupStarted) {
      await log(client, {
        service: "ogb-startup-sync",
        level: "info",
        message: "Skipping ogb startup sync: already attempted in this OpenCode process",
        extra: { cwd, reason },
      });
      return;
    }
    const backoff = backoffStatus();
    if (backoff.blocked) {
      await log(client, {
        service: "ogb-startup-sync",
        level: "warn",
        message: "Skipping ogb startup sync: failure backoff is active",
        extra: { cwd, reason, nextRetryAfter: backoff.nextRetryAfter, failureCount: backoff.failureCount },
      });
      return;
    }
    startupStarted = true;
    const lock = acquireLock(lockPath, plan.lockTtlMs);
    if (!lock.acquired) {
      await log(client, {
        service: "ogb-startup-sync",
        level: "info",
        message: lock.reason === "active" ? "Skipping ogb startup sync: active lock" : "Skipping ogb startup sync: lock unavailable",
        extra: { cwd, lockPath, lock },
      });
      return;
    }

    try {
      await log(client, {
        service: "ogb-startup-sync",
        level: "info",
        message: "Running ogb startup sync (" + reason + ")",
        extra: { cwd, command: plan.command, args: plan.args },
      });
      await runCommand({ cwd, client, reason, notifications, failureBackoffMs });
    } finally {
      releaseLock(lockPath);
    }
  }

  function scheduleStartup(reason, delayMs = 0) {
    if (startupTimer) {
      if (delayMs > 0) return;
      clearTimeout(startupTimer);
    }
    startupTimer = setTimeout(() => {
      startupTimer = undefined;
      void runOnce(reason);
    }, delayMs);
    if (typeof startupTimer.unref === "function") startupTimer.unref();
  }

  const startupDelay = Number(process.env.OGB_STARTUP_DELAY_MS ?? STARTUP_DELAY_MS);
  scheduleStartup("plugin.init", Number.isFinite(startupDelay) && startupDelay >= 0 ? startupDelay : STARTUP_DELAY_MS);

  return {
    config: async (opencodeConfig) => {
      opencodeConfig.command ??= {};
      for (const [name, definition] of Object.entries(OGB_DIRECT_COMMANDS)) {
        if (COMMAND_REGISTRATION_SKIP.has(name)) continue;
        opencodeConfig.command[name] = {
          template: definition.template,
          description: definition.description,
        };
      }
    },
    event: async ({ event }) => {
      const type = String(event?.type || "");
      if (startupEvents.has(type)) scheduleStartup(type, 0);
    },
    "session.created": async () => {
      if (process.env.OGB_SYNC_ON_SESSION_CREATED === "1") {
        await runOnce("session.created");
      }
    },
    "command.execute.before": async (input) => {
      if (await handleDirectBridgeCommand({ cwd, client, input })) {
        throw new Error("__OGB_COMMAND_HANDLED__");
      }
    },
  };
};

export default OgbStartupSync;
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
  homeMode: boolean;
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

export function defaultCommandPlan(options: SetupOpenCodeOptions): SetupCommandPlan {
  if (options.command) {
    return {
      command: options.command,
      baseArgs: options.baseArgs ?? [],
      syncArgs: options.syncArgs ?? ["startup-sync"],
    };
  }

  const baseArgs = options.baseArgs ?? currentCliBaseArgs();
  if (baseArgs.length > 0) {
    return {
      command: process.execPath,
      baseArgs,
      syncArgs: options.syncArgs ?? ["startup-sync"],
    };
  }

  return {
    command: "ogb",
    baseArgs: [],
    syncArgs: options.syncArgs ?? ["startup-sync"],
  };
}

export function startupConfigSource(plan: SetupCommandPlan): string {
  return `${JSON.stringify({
    version: 1,
    enabled: true,
    autoUpdate: false,
    command: plan.command,
    baseArgs: plan.baseArgs,
    syncArgs: plan.syncArgs,
    updateArgs: ["check-update", "--no-write"],
    lockTtlMs: 10 * 60_000,
    failureBackoffMs: 10 * 60_000,
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

export function checkPluginSyntax(pluginPath?: string): SetupOpenCodeReport["pluginCheck"] {
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
  const generatedDir = path.join(projectRoot, ".opencode", "generated");
  recoverStaleStartupStatus({
    statusPath: path.join(generatedDir, "ogb-plugin-status.json"),
    lockPath: path.join(generatedDir, "ogb-startup-sync.lock"),
    cwd: projectRoot,
    reason: "setup-opencode.recovered-stale",
    dryRun: Boolean(dryRun),
  });
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
  if (paths.homeMode) {
    const message = "Diretorio home detectado; setup-opencode de projeto pulado para usar os recursos globais do OpenCode/Gemini.";
    const skippedConfig: ProjectConfigResult = {
      path: path.join(paths.projectRoot, "opencode.jsonc"),
      status: "unchanged",
      message,
    };
    const skippedWrite = (relPath: string): ManagedWriteResult => ({
      path: path.join(paths.projectRoot, ...relPath.split("/")),
      relPath,
      status: "unchanged",
      message,
    });
    return {
      version: OGB_VERSION,
      projectRoot: paths.projectRoot,
      homeMode: true,
      opencodeConfig: skippedConfig,
      plugin: skippedWrite(STARTUP_SYNC_PLUGIN_PATH),
      startupConfig: skippedWrite(STARTUP_SYNC_CONFIG_PATH),
      sidebarPlugin: skippedWrite(".opencode/tui-plugins/ogb-sidebar.js"),
      tuiConfig: skippedWrite(".opencode/tui.jsonc"),
      commandPlan: plan,
      commandCheck: {
        skipped: true,
        ok: true,
        message,
      },
      pluginCheck: {
        ok: true,
        message,
      },
      sidebarPluginCheck: {
        ok: true,
        message,
      },
      warnings,
    };
  }
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
    homeMode: false,
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
  if (report.homeMode) {
    console.log("Project setup was skipped because this is the home directory; OpenCode will use the global profile.");
  } else {
    console.log("OpenCode will auto-load the startup plugin and the TUI sidebar plugin on restart.");
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
}

export function relativeManagedPath(projectRoot: string, filePath: string): string {
  return toPosixRelative(projectRoot, filePath);
}
