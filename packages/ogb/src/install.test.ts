import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInstall } from "./install.js";
import { readStateRecord } from "./state-store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-install-"));
}

test("runInstall previews setup without running the final check", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  const report = runInstall({
    projectRoot,
    homeDir,
    dryRun: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });

  assert.equal(report.outcome, "preview");
  assert.equal(report.projectRoot, projectRoot);
  assert.equal(report.homeMode, false);
  assert.equal(report.plan.intent, "install");
  assert.deepEqual(report.plan.steps.map((step) => step.id), ["cleanup-home-artifacts", "apply-global-ux-profile", "run-check"]);
  assert.equal(report.check, undefined);
  assert.ok(report.setup.writes.some((write) => write.status === "preview"));
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc")), false);
});

test("runInstall applies the current install flow and finishes with check", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "# Project Gemini\n", "utf8");

  const report = runInstall({
    projectRoot,
    homeDir,
    force: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });

  assert.notEqual(report.outcome, "fail");
  assert.equal(report.plan.delegation.command, "ogb");
  assert.ok(report.check);
  assert.ok(report.check.automated.includes("setup-opencode"));
  assert.ok(report.check.automated.includes("sync"));
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc")), true);
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "commands", "bridge.md")), true);
  const state = readStateRecord("install", { projectRoot, homeDir });
  assert.equal(state.exists, true);
  assert.equal(state.data?.outcome, report.outcome);
});
