import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runBidirectionalSync } from "./bidirectional-sync.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-bidir-"));
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-home-"));
}

test("runBidirectionalSync creates missing AGENTS.md from project GEMINI.md", () => {
  const projectRoot = tempProject();
  const homeDir = tempHome();
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "Project rules\n", "utf8");

  const report = runBidirectionalSync({ projectRoot, homeDir, json: true });

  assert.equal(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"), "Project rules\n");
  assert.ok(report.changes.some((change) => change.status === "created" && change.target.endsWith("AGENTS.md")));
});

test("runBidirectionalSync refuses differing targets without force", () => {
  const projectRoot = tempProject();
  const homeDir = tempHome();
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "Project rules\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "Manual OpenCode rules\n", "utf8");
  const newer = new Date(Date.now() + 1000);
  fs.utimesSync(path.join(projectRoot, "GEMINI.md"), newer, newer);

  const report = runBidirectionalSync({ projectRoot, homeDir, json: true });

  assert.equal(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"), "Manual OpenCode rules\n");
  assert.ok(report.changes.some((change) => change.status === "conflict"));
  assert.equal(process.exitCode, undefined);
  process.exitCode = previousExitCode;
});

test("runBidirectionalSync force updates with backup", () => {
  const projectRoot = tempProject();
  const homeDir = tempHome();
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "Project rules\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "Manual OpenCode rules\n", "utf8");
  const newer = new Date(Date.now() + 1000);
  fs.utimesSync(path.join(projectRoot, "GEMINI.md"), newer, newer);

  const report = runBidirectionalSync({ projectRoot, homeDir, force: true, json: true });

  assert.equal(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"), "Project rules\n");
  const updated = report.changes.find((change) => change.status === "updated");
  assert.ok(updated?.backup);
  assert.equal(fs.existsSync(updated.backup), true);
  assert.ok(updated.backup.startsWith(path.join(homeDir, ".config", "opencode-gemini-bridge", "backups", "bidirectional-sync")));
  assert.equal(report.backups.length, 1);
  assert.equal(fs.readFileSync(report.backups[0].backup, "utf8"), "Manual OpenCode rules\n");
});

test("runBidirectionalSync syncs global rules only inside the provided homeDir", () => {
  const projectRoot = tempProject();
  const homeDir = tempHome();
  const openCodeRules = path.join(homeDir, ".config", "opencode", "AGENTS.md");
  fs.mkdirSync(path.dirname(openCodeRules), { recursive: true });
  fs.writeFileSync(openCodeRules, "Global OpenCode rules\n", "utf8");

  const report = runBidirectionalSync({ projectRoot, homeDir, json: true });

  assert.equal(fs.readFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "utf8"), "Global OpenCode rules\n");
  assert.equal(fs.readFileSync(path.join(homeDir, ".codex", "AGENTS.md"), "utf8"), "Global OpenCode rules\n");
  assert.ok(report.changes.every((change) => change.target.startsWith(homeDir)));
});
