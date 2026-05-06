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
    .replace(/"/g, '\\"')
    .replace(/\^/g, "^^")
    .replace(/%/g, "^%");
  return `"${escaped}"`;
}

export function commandForPlatform(command: string, args: readonly string[] = [], platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform !== "win32") return { command, args: [...args] };

  const comspec = process.env.ComSpec || "cmd.exe";
  return {
    command: comspec,
    args: ["/d", "/v:off", "/s", "/c", [command, ...args].map(cmdQuote).join(" ")],
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
