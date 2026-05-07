import fs from "node:fs";
import path from "node:path";
import { resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

export type StateReportKind = "install" | "update" | "check" | "startup" | "doctor" | "validation" | "security" | "dashboard";

export interface StateStoreOptions {
  projectRoot?: string;
  homeDir?: string;
  now?: Date;
}

export interface StateRecord<T = Record<string, unknown>> {
  kind: StateReportKind;
  path: string;
  exists: boolean;
  legacy: boolean;
  data?: T;
}

const REPORT_FILES: Record<StateReportKind, keyof ReturnType<typeof resolveProjectPaths> | "installPath"> = {
  install: "installPath",
  update: "updateStatusPath",
  check: "passPath",
  startup: "pluginStatusPath",
  doctor: "doctorPath",
  validation: "validationPath",
  security: "securityPath",
  dashboard: "dashboardPath",
};

export function stateRecordPath(kind: StateReportKind, options: StateStoreOptions = {}): string {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  if (kind === "install") return path.join(paths.generatedDir, "ogb-install.json");
  const key = REPORT_FILES[kind];
  return String(paths[key as keyof typeof paths]);
}

function parseJson(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function hasModernMarker(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data && (
    typeof data.ogbVersion === "string"
    || typeof data.generatedAt === "string"
    || typeof data.checkedAt === "string"
    || typeof data.finishedAt === "string"
    || typeof data.version === "string"
  ));
}

export function readStateRecord<T extends Record<string, unknown> = Record<string, unknown>>(kind: StateReportKind, options: StateStoreOptions = {}): StateRecord<T> {
  const filePath = stateRecordPath(kind, options);
  if (!fs.existsSync(filePath)) {
    return { kind, path: filePath, exists: false, legacy: false };
  }
  const data = parseJson(filePath) as T | undefined;
  return {
    kind,
    path: filePath,
    exists: true,
    legacy: !hasModernMarker(data),
    data,
  };
}

export function writeStateRecord(kind: StateReportKind, data: Record<string, unknown>, options: StateStoreOptions = {}): StateRecord {
  const filePath = stateRecordPath(kind, options);
  const stamped = {
    generatedAt: (options.now ?? new Date()).toISOString(),
    ogbVersion: OGB_VERSION,
    ...data,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  return {
    kind,
    path: filePath,
    exists: true,
    legacy: false,
    data: stamped,
  };
}
