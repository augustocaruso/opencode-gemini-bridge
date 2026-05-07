import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bridgeConfigDirForHome, createBackupSession, safeBackupTimestamp } from "./backup-policy.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-backup-"));
}

function backupSessionDir(bridgeConfigDir: string, operation: string, date: Date): string {
  return path.join(bridgeConfigDir, "backups", operation, safeBackupTimestamp(date));
}

function writeBackupSession(bridgeConfigDir: string, operation: string, date: Date): string {
  const dir = backupSessionDir(bridgeConfigDir, operation, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "marker.txt"), safeBackupTimestamp(date), "utf8");
  return dir;
}

test("createBackupSession backs up files under named roots", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, ".config", "opencode-gemini-bridge");
  const projectRoot = path.join(root, "project");
  const target = path.join(projectRoot, ".opencode", "agents", "YOLO.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "manual\n", "utf8");

  const session = createBackupSession({
    bridgeConfigDir,
    operation: "test-op",
    roots: [{ root: projectRoot, prefix: "project" }],
    timestamp: "2026-05-07T00-00-00-000Z",
  });
  const backup = session.backupExisting(target);

  assert.equal(backup, path.join(bridgeConfigDir, "backups", "test-op", "2026-05-07T00-00-00-000Z", "project", ".opencode", "agents", "YOLO.md"));
  assert.equal(fs.readFileSync(backup!, "utf8"), "manual\n");
  assert.deepEqual(session.backups.map((item) => item.backup), [backup]);
});

test("createBackupSession sanitizes files outside known roots", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const target = path.join(root, "elsewhere", "notes:file.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "notes\n", "utf8");

  const session = createBackupSession({ bridgeConfigDir, operation: "external", timestamp: "stamp" });
  const backup = session.backupExisting(target);

  assert.ok(backup?.includes(path.join("external", root.replace(/^[/\\]+/, "").split(/[\\/]+/).join(path.sep), "elsewhere", "notes_file.md")));
  assert.equal(fs.readFileSync(backup!, "utf8"), "notes\n");
});

test("createBackupSession generates unique backup paths on collision", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "first\n", "utf8");
  const session = createBackupSession({
    bridgeConfigDir,
    operation: "collision",
    roots: [{ root, prefix: "root" }],
    timestamp: "stamp",
  });

  const first = session.backupExisting(target);
  fs.writeFileSync(target, "second\n", "utf8");
  const second = session.backupExisting(target);

  assert.notEqual(first, second);
  assert.equal(fs.readFileSync(first!, "utf8"), "first\n");
  assert.equal(fs.readFileSync(second!, "utf8"), "second\n");
});

test("createBackupSession backs up directories recursively", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const dir = path.join(root, "profile");
  fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
  fs.writeFileSync(path.join(dir, "nested", "file.md"), "nested\n", "utf8");

  const session = createBackupSession({
    bridgeConfigDir,
    operation: "directory",
    roots: [{ root, prefix: "root" }],
    timestamp: "stamp",
  });
  const backup = session.backupExisting(dir);

  assert.equal(fs.readFileSync(path.join(backup!, "nested", "file.md"), "utf8"), "nested\n");
});

test("createBackupSession dry-run plans backups without writing", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");

  const session = createBackupSession({
    bridgeConfigDir,
    operation: "preview",
    roots: [{ root, prefix: "root" }],
    dryRun: true,
    timestamp: "stamp",
  });
  const backup = session.backupExisting(target);

  assert.equal(fs.existsSync(backup!), false);
  assert.equal(session.backups[0]?.dryRun, true);
});

test("createBackupSession retention keeps only five newest sessions per operation", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-count";
  const now = new Date("2026-05-07T00:00:00.000Z");
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");

  for (let day = 1; day <= 6; day += 1) {
    writeBackupSession(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, day)));
  }

  const session = createBackupSession({
    bridgeConfigDir,
    operation,
    roots: [{ root, prefix: "root" }],
    now,
  });
  session.backupExisting(target);

  const operationRoot = path.join(bridgeConfigDir, "backups", operation);
  const remaining = fs.readdirSync(operationRoot).sort();
  assert.equal(remaining.length, 5);
  assert.ok(remaining.includes(safeBackupTimestamp(now)));
  assert.ok(remaining.includes(safeBackupTimestamp(new Date(Date.UTC(2026, 4, 6)))));
  assert.ok(remaining.includes(safeBackupTimestamp(new Date(Date.UTC(2026, 4, 5)))));
  assert.equal(remaining.includes(safeBackupTimestamp(new Date(Date.UTC(2026, 4, 2)))), false);
  assert.equal(remaining.includes(safeBackupTimestamp(new Date(Date.UTC(2026, 4, 1)))), false);
});

test("createBackupSession retention removes sessions older than thirty days", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-age";
  const now = new Date("2026-05-07T00:00:00.000Z");
  const old = writeBackupSession(bridgeConfigDir, operation, new Date("2026-04-06T00:00:00.000Z"));
  const exactlyThirtyDays = writeBackupSession(bridgeConfigDir, operation, new Date("2026-04-07T00:00:00.000Z"));
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");

  const session = createBackupSession({
    bridgeConfigDir,
    operation,
    roots: [{ root, prefix: "root" }],
    now,
  });
  session.backupExisting(target);

  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(exactlyThirtyDays), true);
});

test("createBackupSession retention combines age and count pruning", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-combined";
  const now = new Date("2026-05-07T00:00:00.000Z");
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");
  const veryOld = writeBackupSession(bridgeConfigDir, operation, new Date("2026-01-01T00:00:00.000Z"));

  for (let day = 1; day <= 6; day += 1) {
    writeBackupSession(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, day)));
  }

  const session = createBackupSession({
    bridgeConfigDir,
    operation,
    roots: [{ root, prefix: "root" }],
    now,
  });
  session.backupExisting(target);

  assert.equal(fs.existsSync(veryOld), false);
  assert.equal(fs.existsSync(backupSessionDir(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, 2)))), false);
  assert.equal(fs.existsSync(backupSessionDir(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, 1)))), false);
  assert.equal(session.retention.deleted.length, 3);
});

test("createBackupSession retention does not prune during dry-run", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-dry-run";
  const now = new Date("2026-05-07T00:00:00.000Z");
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");

  for (let day = 1; day <= 6; day += 1) {
    writeBackupSession(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, day)));
  }

  const session = createBackupSession({
    bridgeConfigDir,
    operation,
    roots: [{ root, prefix: "root" }],
    dryRun: true,
    now,
  });
  const planned = session.backupExisting(target);

  assert.equal(fs.existsSync(planned!), false);
  assert.equal(session.retention.deleted.length, 0);
  for (let day = 1; day <= 6; day += 1) {
    assert.equal(fs.existsSync(backupSessionDir(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, day)))), true);
  }
});

test("createBackupSession retention ignores invalid timestamp directories", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-invalid";
  const operationRoot = path.join(bridgeConfigDir, "backups", operation);
  const invalid = path.join(operationRoot, "manual-backup");
  const invalidDate = path.join(operationRoot, "2026-99-99T99-99-99-999Z");
  const now = new Date("2026-05-07T00:00:00.000Z");
  const target = path.join(root, "file.txt");
  fs.mkdirSync(invalid, { recursive: true });
  fs.mkdirSync(invalidDate, { recursive: true });
  fs.writeFileSync(target, "content\n", "utf8");

  for (let day = 1; day <= 6; day += 1) {
    writeBackupSession(bridgeConfigDir, operation, new Date(Date.UTC(2026, 4, day)));
  }

  const session = createBackupSession({
    bridgeConfigDir,
    operation,
    roots: [{ root, prefix: "root" }],
    now,
  });
  session.backupExisting(target);

  assert.equal(fs.existsSync(invalid), true);
  assert.equal(fs.existsSync(invalidDate), true);
});

test("createBackupSession retention warns and keeps backup when pruning fails", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-warning";
  const now = new Date("2026-05-07T00:00:00.000Z");
  const old = writeBackupSession(bridgeConfigDir, operation, new Date("2026-04-01T00:00:00.000Z"));
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");
  const originalRmSync = fs.rmSync;

  try {
    (fs as any).rmSync = (filePath: any, options: any) => {
      if (path.resolve(String(filePath)) === path.resolve(old)) throw new Error("locked");
      return originalRmSync(filePath, options);
    };
    const session = createBackupSession({
      bridgeConfigDir,
      operation,
      roots: [{ root, prefix: "root" }],
      now,
    });
    const backup = session.backupExisting(target);

    assert.equal(fs.existsSync(backup!), true);
    assert.equal(fs.existsSync(old), true);
    assert.equal(session.retention.deleted.length, 0);
    assert.match(session.retention.warnings[0] ?? "", /locked/);
  } finally {
    (fs as any).rmSync = originalRmSync;
  }
});

test("createBackupSession does not run retention when backup copy fails", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "bridge");
  const operation = "retain-copy-failure";
  const now = new Date("2026-05-07T00:00:00.000Z");
  const old = writeBackupSession(bridgeConfigDir, operation, new Date("2026-04-01T00:00:00.000Z"));
  const target = path.join(root, "file.txt");
  fs.writeFileSync(target, "content\n", "utf8");
  const originalCpSync = fs.cpSync;
  const originalRmSync = fs.rmSync;
  let rmCalls = 0;

  try {
    (fs as any).cpSync = () => {
      throw new Error("copy failed");
    };
    (fs as any).rmSync = (filePath: any, options: any) => {
      rmCalls += 1;
      return originalRmSync(filePath, options);
    };
    const session = createBackupSession({
      bridgeConfigDir,
      operation,
      roots: [{ root, prefix: "root" }],
      now,
    });

    assert.throws(() => session.backupExisting(target), /copy failed/);
    assert.equal(rmCalls, 0);
    assert.equal(fs.existsSync(old), true);
    assert.equal(session.backups.length, 0);
    assert.equal(session.retention.deleted.length, 0);
  } finally {
    (fs as any).cpSync = originalCpSync;
    (fs as any).rmSync = originalRmSync;
  }
});

test("createBackupSession fails before callers overwrite when backup cannot be created", () => {
  const root = tempRoot();
  const bridgeConfigDir = path.join(root, "not-a-dir");
  const target = path.join(root, "file.txt");
  fs.writeFileSync(bridgeConfigDir, "blocked\n", "utf8");
  fs.writeFileSync(target, "keep\n", "utf8");

  const session = createBackupSession({
    bridgeConfigDir,
    operation: "failure",
    roots: [{ root, prefix: "root" }],
    timestamp: "stamp",
  });

  assert.throws(() => session.backupExisting(target));
  assert.equal(fs.readFileSync(target, "utf8"), "keep\n");
});

test("bridgeConfigDirForHome resolves the shared backup root", () => {
  const root = tempRoot();
  assert.equal(bridgeConfigDirForHome(root), path.join(root, ".config", "opencode-gemini-bridge"));
});
