import fs from "node:fs";
import path from "node:path";
import { createBackupSession, type BackupRetentionReport, type BackupRoot } from "./backup-policy.js";

export type ProfileWriteStatus = "created" | "updated" | "unchanged" | "preview" | "protected" | "removed" | "conflict";
export type ProfileWriteReason =
  | "created"
  | "unchanged"
  | "preview"
  | "profile_overwrite"
  | "profile_remove"
  | "maintainer_protected"
  | "conflict";

export interface ProfileWrite {
  path: string;
  status: ProfileWriteStatus;
  backup?: string;
  reason?: ProfileWriteReason;
}

export type ProfileBackupRoot = BackupRoot;

export interface ProfileWriter {
  maintainer: boolean;
  backupDir: string;
  retention: BackupRetentionReport;
  writeText(options: {
    filePath: string;
    text: string;
    force?: boolean;
    conflictIfChanged?: boolean;
  }): ProfileWrite;
  removeFileIfExists(filePath: string): ProfileWrite | undefined;
}

export interface ProfileWriterOptions {
  bridgeConfigDir: string;
  profileRoot: string;
  dryRun?: boolean;
  maintainer?: boolean;
  pathApi?: typeof path;
  backupRoots?: ProfileBackupRoot[];
}

export function createProfileWriter(options: ProfileWriterOptions): ProfileWriter {
  const pathApi = options.pathApi ?? path;
  const backupSession = createBackupSession({
    bridgeConfigDir: options.bridgeConfigDir,
    operation: "profile-overwrite",
    roots: [
      { root: options.profileRoot },
      ...(options.backupRoots ?? []),
    ],
    dryRun: options.dryRun,
    pathApi,
  });

  function writeText(write: {
    filePath: string;
    text: string;
    force?: boolean;
    conflictIfChanged?: boolean;
  }): ProfileWrite {
    const exists = fs.existsSync(write.filePath);
    const current = exists ? fs.readFileSync(write.filePath, "utf8") : "";

    if (current === write.text) {
      return { path: write.filePath, status: "unchanged", reason: "unchanged" };
    }

    if (options.dryRun) {
      return { path: write.filePath, status: "preview", reason: "preview" };
    }

    if (options.maintainer && exists) {
      return { path: write.filePath, status: "protected", reason: "maintainer_protected" };
    }

    if (exists && write.conflictIfChanged && write.force !== true) {
      return { path: write.filePath, status: "conflict", reason: "conflict" };
    }

    const backup = exists ? backupSession.backupExisting(write.filePath) : undefined;
    fs.mkdirSync(pathApi.dirname(write.filePath), { recursive: true });
    fs.writeFileSync(write.filePath, write.text, "utf8");
    return {
      path: write.filePath,
      status: exists ? "updated" : "created",
      backup,
      reason: exists ? "profile_overwrite" : "created",
    };
  }

  function removeFileIfExists(filePath: string): ProfileWrite | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    if (options.dryRun) return { path: filePath, status: "preview", reason: "preview" };
    if (options.maintainer) return { path: filePath, status: "protected", reason: "maintainer_protected" };

    const backup = backupSession.backupExisting(filePath);
    fs.rmSync(filePath, { force: true });
    return {
      path: filePath,
      status: "removed",
      backup,
      reason: "profile_remove",
    };
  }

  return {
    maintainer: Boolean(options.maintainer),
    backupDir: backupSession.backupDir,
    retention: backupSession.retention,
    writeText,
    removeFileIfExists,
  };
}
