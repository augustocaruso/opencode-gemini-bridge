import fs from "node:fs";
import os from "node:os";
import { createPlatformAdapter } from "./platform-adapter.js";
import { OGB_VERSION } from "./types.js";

export const LOCAL_ROLE_SCHEMA = "opencode-gemini-bridge.local-role.v1";

export type LocalRole = "maintainer" | "user";

export interface LocalRoleOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface LocalRoleStatus {
  schema: typeof LOCAL_ROLE_SCHEMA;
  role: LocalRole;
  enabled: boolean;
  path: string;
  enabledAt?: string;
  createdByVersion?: string;
}

export interface LocalRoleFlag {
  schema: typeof LOCAL_ROLE_SCHEMA;
  role: "maintainer";
  enabledAt: string;
  createdByVersion: string;
}

function adapterFor(options: LocalRoleOptions = {}) {
  return createPlatformAdapter({
    homeDir: options.homeDir ?? os.homedir(),
    platform: options.platform,
    env: options.env,
  });
}

export function localRolePath(options: LocalRoleOptions = {}): string {
  const adapter = adapterFor(options);
  return adapter.join(adapter.bridgeConfigDir, "local-role.json");
}

function userStatus(path: string): LocalRoleStatus {
  return {
    schema: LOCAL_ROLE_SCHEMA,
    role: "user",
    enabled: false,
    path,
  };
}

export function readLocalRole(options: LocalRoleOptions = {}): LocalRoleStatus {
  const path = localRolePath(options);
  if (!fs.existsSync(path)) return userStatus(path);

  try {
    const raw = JSON.parse(fs.readFileSync(path, "utf8")) as Partial<LocalRoleFlag>;
    if (raw.schema === LOCAL_ROLE_SCHEMA && raw.role === "maintainer") {
      return {
        schema: LOCAL_ROLE_SCHEMA,
        role: "maintainer",
        enabled: true,
        path,
        enabledAt: typeof raw.enabledAt === "string" ? raw.enabledAt : undefined,
        createdByVersion: typeof raw.createdByVersion === "string" ? raw.createdByVersion : undefined,
      };
    }
  } catch {
    return userStatus(path);
  }

  return userStatus(path);
}

export function enableMaintainerRole(options: LocalRoleOptions = {}): LocalRoleStatus {
  const path = localRolePath(options);
  const flag: LocalRoleFlag = {
    schema: LOCAL_ROLE_SCHEMA,
    role: "maintainer",
    enabledAt: new Date().toISOString(),
    createdByVersion: OGB_VERSION,
  };
  fs.mkdirSync(adapterFor(options).pathApi.dirname(path), { recursive: true });
  fs.writeFileSync(path, `${JSON.stringify(flag, null, 2)}\n`, "utf8");
  return {
    ...flag,
    enabled: true,
    path,
  };
}

export function disableMaintainerRole(options: LocalRoleOptions = {}): LocalRoleStatus {
  const path = localRolePath(options);
  fs.rmSync(path, { force: true });
  return userStatus(path);
}
