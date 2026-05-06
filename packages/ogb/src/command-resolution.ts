import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeCommandInput, spawnCommandSync } from "./process.js";

export interface CommandResolutionOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  includeLookup?: boolean;
  includeNpmPrefix?: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeCommandInput).filter(Boolean))];
}

function pathExists(filePath: string): boolean {
  try {
    const stat = fs.statSync(normalizeCommandInput(filePath));
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isPathLike(command: string, platform: NodeJS.Platform): boolean {
  command = normalizeCommandInput(command);
  return path.isAbsolute(command)
    || (platform === "win32" && path.win32.isAbsolute(command))
    || command.includes("/")
    || command.includes("\\");
}

function windowsCommandVariants(command: string): string[] {
  command = normalizeCommandInput(command);
  if (path.extname(command)) return [command];
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, `${command}.ps1`, command];
}

function commandVariants(command: string, platform: NodeJS.Platform): string[] {
  command = normalizeCommandInput(command);
  return platform === "win32" ? windowsCommandVariants(command) : [command];
}

function lookupCandidates(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const lookup = platform === "win32" ? "where" : "which";
  const result = spawnCommandSync(lookup, [command], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error || result.status !== 0) return [];
  const lines = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.flatMap((line) => commandVariants(line, platform));
}

function npmPrefixCandidates(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const result = spawnCommandSync("npm", ["prefix", "-g"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const prefix = !result.error && result.status === 0 ? normalizeCommandInput(String(result.stdout || "")) : "";
  if (!prefix) return [];
  const roots = platform === "win32" ? [prefix, path.join(prefix, "bin")] : [path.join(prefix, "bin"), prefix];
  return roots.flatMap((root) => commandVariants(path.join(root, command), platform));
}

function homeCandidates(command: string, options: Required<Pick<CommandResolutionOptions, "homeDir" | "platform" | "env">>): string[] {
  if (options.platform === "win32") {
    const appData = options.env.APPDATA || path.join(options.homeDir, "AppData", "Roaming");
    return [
      path.join(appData, "npm", command),
      path.join(options.homeDir, "AppData", "Roaming", "npm", command),
      path.join(options.homeDir, ".opencode", "bin", command),
      path.join(options.homeDir, ".local", "bin", command),
    ].flatMap((candidate) => commandVariants(candidate, options.platform));
  }

  return [
    path.join(options.homeDir, ".opencode", "bin", command),
    path.join(options.homeDir, ".local", "bin", command),
  ].flatMap((candidate) => commandVariants(candidate, options.platform));
}

export function resolveCommand(command: string, options: CommandResolutionOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  command = normalizeCommandInput(command);

  if (isPathLike(command, platform)) {
    return commandVariants(command, platform).map(normalizeCommandInput).find(pathExists);
  }

  const candidates = [
    ...(options.includeLookup === false ? [] : lookupCandidates(command, platform, env)),
    ...(options.includeNpmPrefix === false ? [] : npmPrefixCandidates(command, platform, env)),
    ...homeCandidates(command, { homeDir, platform, env }),
  ];
  return unique(candidates).find(pathExists);
}

export function commandExists(command: string, options: CommandResolutionOptions = {}): boolean {
  return Boolean(resolveCommand(command, options));
}
