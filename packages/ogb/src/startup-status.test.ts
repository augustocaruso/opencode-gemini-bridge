import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recoverStaleStartupStatus } from "./startup-status.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-startup-status-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("recoverStaleStartupStatus recovers running status when recorded pid is dead", () => {
  const root = tempRoot();
  const statusPath = path.join(root, "generated", "ogb-plugin-status.json");
  const lockPath = path.join(root, "generated", "ogb-startup-sync.lock");
  writeJson(statusPath, {
    version: 1,
    state: "running",
    reason: "plugin.init",
    pid: 99999999,
    startedAt: "2026-05-06T12:00:00.000Z",
    command: "ogb",
    args: ["sync"],
  });
  writeJson(lockPath, { pid: 99999999, startedAt: "2026-05-06T12:00:00.000Z" });

  const recovery = recoverStaleStartupStatus({
    statusPath,
    lockPath,
    cwd: root,
    reason: "test.recovered-stale",
  });

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.lockRemoved, true);
  assert.equal(status.state, "pass");
  assert.equal(status.reason, "test.recovered-stale");
  assert.equal(fs.existsSync(lockPath), false);
});

test("recoverStaleStartupStatus preserves running status when recorded pid is alive", () => {
  const root = tempRoot();
  const statusPath = path.join(root, "generated", "ogb-plugin-status.json");
  const lockPath = path.join(root, "generated", "ogb-startup-sync.lock");
  writeJson(statusPath, {
    version: 1,
    state: "running",
    reason: "plugin.init",
    pid: process.pid,
    startedAt: "2026-05-06T12:00:00.000Z",
    command: "ogb",
    args: ["sync"],
  });
  writeJson(lockPath, { pid: process.pid, startedAt: "2026-05-06T12:00:00.000Z" });

  const recovery = recoverStaleStartupStatus({
    statusPath,
    lockPath,
    cwd: root,
    reason: "test.recovered-stale",
  });

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(recovery.recovered, false);
  assert.equal(recovery.state, "running");
  assert.equal(status.state, "running");
  assert.equal(fs.existsSync(lockPath), true);
});

test("recoverStaleStartupStatus removes stale lock even when status already finished", () => {
  const root = tempRoot();
  const statusPath = path.join(root, "generated", "ogb-plugin-status.json");
  const lockPath = path.join(root, "generated", "ogb-startup-sync.lock");
  writeJson(statusPath, {
    version: 1,
    state: "pass",
    reason: "plugin.init",
  });
  writeJson(lockPath, { pid: 99999999, startedAt: "2026-05-06T12:00:00.000Z" });

  const recovery = recoverStaleStartupStatus({
    statusPath,
    lockPath,
    cwd: root,
    reason: "test.recovered-stale",
  });

  assert.equal(recovery.recovered, false);
  assert.equal(recovery.lockRemoved, true);
  assert.equal(fs.existsSync(lockPath), false);
});
