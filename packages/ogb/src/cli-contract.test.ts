import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { RITUAL_PROGRESS_SCHEMA_VERSION } from "./ritual-progress.js";
import { LEGACY_PASS_WARNING, LEGACY_SELF_UPDATE_WARNING, LEGACY_UPGRADE_WARNING, program } from "./cli.js";

function command(name: string) {
  const found = program.commands.find((candidate) => candidate.name() === name);
  assert.ok(found, `expected ogb ${name} to be registered`);
  return found;
}

test("CLI exposes the first cargo-like installer API verbs", () => {
  assert.match(command("help").description(), /interactive command guide/);
  assert.match(command("install").description(), /Install or reinstall/);
  assert.match(command("check").description(), /full bridge check/);
  assert.match(command("update").description(), /post-update check/);
  assert.match(command("reset").description(), /Reset the global OGB\/OpenCode profile/);
  assert.match(command("maintainer").description(), /local maintainer protection/);
});

test("legacy installer API verbs stay available with explicit warnings", () => {
  assert.equal(command("pass").description(), "Deprecated alias for check");
  assert.equal(command("self-update").description(), "Deprecated alias for update");
  assert.equal(command("upgrade-ogb").description(), "Deprecated alias for update");
  assert.equal(LEGACY_PASS_WARNING, "warning: ogb pass is deprecated; use ogb check.");
  assert.equal(LEGACY_SELF_UPDATE_WARNING, "warning: ogb self-update is deprecated; use ogb update.");
  assert.equal(LEGACY_UPGRADE_WARNING, "warning: ogb upgrade-ogb is deprecated; use ogb update.");
});

test("user-facing installer verbs keep a stable plain output escape hatch", () => {
  for (const name of ["install", "check", "pass", "update", "self-update", "upgrade-ogb", "reset"]) {
    assert.ok(command(name).options.some((option) => option.long === "--plain"), `expected ogb ${name} to support --plain`);
  }
});

test("user-facing ritual verbs expose versioned progress NDJSON", () => {
  for (const name of ["install", "check", "pass", "update", "self-update", "upgrade-ogb", "reset"]) {
    assert.ok(command(name).options.some((option) => option.long === "--progress-json"), `expected ogb ${name} to support --progress-json`);
  }
});

function runCli(args: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-progress-contract-"));
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const cli = path.join(process.cwd(), "src", "cli.ts");
  return spawnSync(process.execPath, [tsx, cli, "--project", root, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      NO_COLOR: "1",
      OGB_PLAIN: "1",
    },
  });
}

function parseNdjson(stdout: string): any[] {
  return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test("check --progress-json emits only versioned NDJSON on stdout", () => {
  const result = runCli(["check", "--dry-run", "--no-setup", "--no-sync", "--no-validation", "--no-security", "--no-dashboard", "--progress-json"]);

  assert.equal(result.status, 0, result.stderr);
  const events = parseNdjson(result.stdout);
  assert.equal(events[0].type, "ritual.started");
  assert.equal(events.at(-1).type, "ritual.finished");
  assert.ok(events.every((event) => event.schemaVersion === RITUAL_PROGRESS_SCHEMA_VERSION));
  assert.deepEqual(events.filter((event) => event.type === "ritual.step" && event.status === "running").map((event) => event.stepId), ["doctor"]);
  assert.equal(events.at(-1).exitCode, 0);
});

test("check --accept-hooks --progress-json uses canonical hook-review step id", () => {
  const result = runCli(["check", "--dry-run", "--no-setup", "--no-sync", "--no-validation", "--no-security", "--no-dashboard", "--accept-hooks", "--progress-json"]);

  assert.equal(result.status, 0, result.stderr);
  const events = parseNdjson(result.stdout);
  const stepIds = events.filter((event) => event.type === "ritual.step").map((event) => event.stepId);
  assert.ok(stepIds.includes("hook-review"));
  assert.equal(stepIds.includes("hooks"), false);
});

test("--progress-json rejects plain and final-json output modes", () => {
  for (const args of [["check", "--progress-json", "--plain"], ["check", "--progress-json", "--json"]]) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--progress-json cannot be combined/);
  }
});

test("dry-run install reset and update expose progress lifecycle events", () => {
  const cases: Array<{ args: string[]; steps: string[] }> = [
    { args: ["install", "--dry-run", "--no-install-opencode", "--no-plugins", "--progress-json"], steps: ["cleanup", "profile", "opencode", "plugins", "project-profile", "check"] },
    { args: ["reset", "--dry-run", "--yes", "--no-install-opencode", "--no-plugins", "--progress-json"], steps: ["confirm", "env", "cleanup", "setup", "opencode", "plugins", "sync", "doctor", "check"] },
    { args: ["update", "--dry-run", "--no-setup", "--progress-json"], steps: ["resolve", "download", "install", "post-check"] },
  ];

  for (const item of cases) {
    const result = runCli(item.args);
    assert.equal(result.status, 0, `${item.args.join(" ")}\n${result.stderr}`);
    const events = parseNdjson(result.stdout);
    assert.equal(events[0].type, "ritual.started");
    assert.equal(events.at(-1).type, "ritual.finished");
    assert.deepEqual(events[0].steps.map((step: any) => step.stepId), item.steps);
    assert.ok(events.every((event) => event.schemaVersion === RITUAL_PROGRESS_SCHEMA_VERSION));
  }
});
