import os from "node:os";
import path from "node:path";

export interface OpenCodePathOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

function resolvedHomeDir(homeDir: string | undefined): string {
  return path.resolve(homeDir ?? os.homedir());
}

export function globalOpenCodeConfigDir(options: OpenCodePathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const homeDir = resolvedHomeDir(options.homeDir);
  const env = options.env ?? process.env;

  if (platform !== "win32" && env.XDG_CONFIG_HOME && homeDir === path.resolve(os.homedir())) {
    return path.join(env.XDG_CONFIG_HOME, "opencode");
  }

  return path.join(homeDir, ".config", "opencode");
}

export function globalOpenCodeConfigFiles(options: OpenCodePathOptions = {}): string[] {
  const root = globalOpenCodeConfigDir(options);
  return [
    path.join(root, "opencode.json"),
    path.join(root, "opencode.jsonc"),
  ];
}

export function legacyWindowsAppDataOpenCodeConfigDir(options: OpenCodePathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return undefined;

  const homeDir = resolvedHomeDir(options.homeDir);
  const env = options.env ?? process.env;
  const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
  return path.join(appData, "opencode");
}
