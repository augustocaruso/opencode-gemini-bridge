import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { commandForPlatform } from "./process.js";

export interface NativeCommandSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  stdio?: SpawnSyncOptions["stdio"];
}

export interface PreparedNativeCommand {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface NativeCommandResult {
  ok: boolean;
  command: string;
  args: string[];
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: string;
}

type SpawnSyncLike = (command: string, args: string[], options: SpawnSyncOptions) => SpawnSyncReturns<string | Buffer>;

export function prepareNativeCommand(spec: NativeCommandSpec): PreparedNativeCommand {
  return commandForPlatform(spec.command, spec.args ?? [], spec.platform);
}

function outputText(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

export function runNativeCommand(spec: NativeCommandSpec, spawnSyncImpl: SpawnSyncLike = spawnSync): NativeCommandResult {
  const prepared = prepareNativeCommand(spec);
  const result = spawnSyncImpl(prepared.command, prepared.args, {
    cwd: spec.cwd,
    env: spec.env,
    encoding: "utf8",
    stdio: spec.stdio,
    timeout: spec.timeoutMs,
    windowsVerbatimArguments: prepared.windowsVerbatimArguments,
  });
  const status = result.status ?? null;
  return {
    ok: !result.error && status === 0,
    command: prepared.command,
    args: prepared.args,
    status,
    signal: result.signal ?? null,
    stdout: outputText(result.stdout),
    stderr: outputText(result.stderr),
    error: result.error?.message,
  };
}
