import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDashboard } from "./dashboard.js";
import { resolveProjectPaths } from "./paths.js";
import { readStateRecord, writeStateRecord } from "./state-store.js";
import { OGB_VERSION } from "./types.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-state-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("state store contract writes and reads stamped reports by kind", () => {
  const projectRoot = tempRoot();
  const written = writeStateRecord("install", { outcome: "pass" }, { projectRoot });
  const read = readStateRecord("install", { projectRoot });

  assert.equal(written.exists, true);
  assert.equal(written.legacy, false);
  assert.equal(read.exists, true);
  assert.equal(read.legacy, false);
  assert.equal(read.data?.outcome, "pass");
  assert.equal(typeof read.data?.generatedAt, "string");
  assert.equal(read.data?.ogbVersion, OGB_VERSION);
});

test("state store contract consumes legacy update status without throwing", () => {
  const projectRoot = tempRoot();
  const paths = resolveProjectPaths(projectRoot);
  writeJson(paths.updateStatusPath, {
    status: "updated",
    restartRequired: true,
    message: "old status without version or timestamps",
  });

  const record = readStateRecord("update", { projectRoot });

  assert.equal(record.exists, true);
  assert.equal(record.legacy, true);
  assert.equal(record.data?.status, "updated");
  assert.equal(record.data?.restartRequired, true);
});

test("state store treats schema-only numeric version reports as legacy", () => {
  const projectRoot = tempRoot();
  const paths = resolveProjectPaths(projectRoot);
  writeJson(paths.updateStatusPath, {
    version: 1,
    status: "error",
    message: "old schema marker without timestamp",
  });

  const record = readStateRecord("update", { projectRoot });

  assert.equal(record.exists, true);
  assert.equal(record.legacy, true);
});

test("state store legacy status remains compatible with dashboard", () => {
  const projectRoot = tempRoot();
  const paths = resolveProjectPaths(projectRoot);
  writeJson(paths.doctorPath, { version: OGB_VERSION, projectRoot, errors: [], warnings: [], inventory: {} });
  writeJson(paths.validationPath, { version: OGB_VERSION, projectRoot, generatedAt: "2026-05-06T12:02:00.000Z", outcome: "pass", checks: [] });
  writeJson(paths.securityPath, { version: OGB_VERSION, projectRoot, generatedAt: "2026-05-06T12:02:00.000Z", outcome: "pass", findings: [] });
  writeJson(paths.pluginStatusPath, { state: "pass", finishedAt: "2026-05-06T12:02:00.000Z" });
  writeJson(paths.updateStatusPath, {
    status: "updated",
    restartRequired: false,
    message: "legacy update status",
  });

  const report = runDashboard({ projectRoot, refresh: false, silent: true });

  assert.notEqual(report.outcome, "fail");
  assert.equal(report.update.status, "updated");
});
