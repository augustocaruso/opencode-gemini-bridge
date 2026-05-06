import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";

function cmdQuote(value: string): string {
  const escaped = value
    .replace(/"/g, '""')
    .replace(/\^/g, "^^")
    .replace(/%/g, "^%");
  return `"${escaped}"`;
}

export function normalizeCommandInput(value: string): string {
  let normalized = String(value).trim();
  let changed = true;
  while (changed && normalized.length >= 2) {
    changed = false;
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
      changed = true;
    }
  }
  return normalized;
}

function cmdToken(value: string, command = false): string {
  if (command && /^[A-Za-z0-9_.-]+$/.test(value)) return value;
  if (!command && /^[A-Za-z0-9_./:@+=-]+$/.test(value)) return value;
  return cmdQuote(value);
}

export function commandForPlatform(command: string, args: readonly string[] = [], platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  const normalizedCommand = normalizeCommandInput(command);
  if (platform !== "win32") return { command: normalizedCommand, args: [...args] };

  const ext = normalizedCommand.split(/[\\/]/).pop()?.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (ext === ".exe") return { command: normalizedCommand, args: [...args] };

  const comspec = process.env.ComSpec || "cmd.exe";
  const commandLine = ["call", cmdToken(normalizedCommand, true), ...args.map((arg) => cmdToken(arg))].join(" ");
  return {
    command: comspec,
    args: ["/d", "/v:off", "/c", commandLine],
  };
}

function withoutShell<T extends SpawnOptions | SpawnSyncOptions>(options: T): T {
  const normalized = { ...options };
  delete normalized.shell;
  return normalized;
}

export function spawnCommand(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
  const normalized = commandForPlatform(command, args);
  return spawn(normalized.command, normalized.args, withoutShell(options));
}

export function spawnCommandSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
export function spawnCommandSync(command: string, args?: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<Buffer>;
export function spawnCommandSync(command: string, args: readonly string[] = [], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  const normalized = commandForPlatform(command, args);
  return spawnSync(normalized.command, normalized.args, withoutShell(options));
}
