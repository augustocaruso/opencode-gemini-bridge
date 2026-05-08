import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  PATCH_LIFECYCLE_SCHEMA,
  PATCH_STATE_SCHEMA,
  OGB_PATCHES,
  defineNativeScriptPatch,
  formatPatchLifecycleReport,
  inspectPatches,
  runPatchesForPhase,
  runBeforeGeminiExtensionUpdatePatches,
  type OgbPatch,
  type PatchContext,
} from "./patches.js";
import { stateRecordPath } from "./state-store.js";
import type { RitualProgressEvent } from "./ritual-progress.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-patches-"));
}

function hasGit(): boolean {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
}

function gitOutput(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function patch(overrides: Partial<OgbPatch> & Pick<OgbPatch, "id" | "phase" | "run">): OgbPatch {
  return {
    title: overrides.id,
    description: `Test patch ${overrides.id}`,
    category: "compatibility",
    reason: "Exercise the patch runner contract in tests.",
    introducedIn: "0.0.0-test",
    applies: () => true,
    ...overrides,
  };
}

test("runPatchesForPhase applies run-once patches and persists patch state", () => {
  const homeDir = tempRoot();
  const target = path.join(homeDir, "patched.txt");
  let calls = 0;
  const registry = [
    patch({
      id: "write-once",
      phase: "pre-sync",
      runOnce: true,
      run(context) {
        calls += 1;
        fs.writeFileSync(target, context.dryRun ? "preview" : "applied", "utf8");
        return { status: "applied", message: "wrote file", writes: [target] };
      },
    }),
  ];

  const first = runPatchesForPhase({ phase: "pre-sync", projectRoot: homeDir, homeDir, registry });
  const second = runPatchesForPhase({ phase: "pre-sync", projectRoot: homeDir, homeDir, registry });
  const statePath = stateRecordPath("patches", { projectRoot: homeDir, homeDir });
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

  assert.equal(first.outcome, "pass");
  assert.equal(first.results[0]?.status, "applied");
  assert.equal(second.results[0]?.status, "skipped");
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(target, "utf8"), "applied");
  assert.equal(state.schema, PATCH_STATE_SCHEMA);
  assert.equal(state.applied["write-once"].status, "applied");
});

test("dry-run patches preview writes without persisting state", () => {
  const homeDir = tempRoot();
  const target = path.join(homeDir, "dry-run.txt");
  const registry = [
    patch({
      id: "preview-write",
      phase: "pre-sync",
      run(context) {
        if (!context.dryRun) fs.writeFileSync(target, "write", "utf8");
        return { status: context.dryRun ? "preview" : "applied", message: "previewed", writes: [target] };
      },
    }),
  ];

  const report = runPatchesForPhase({ phase: "pre-sync", projectRoot: homeDir, homeDir, dryRun: true, registry });
  const statePath = stateRecordPath("patches", { projectRoot: homeDir, homeDir });

  assert.equal(report.outcome, "pass");
  assert.equal(report.results[0]?.status, "preview");
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(statePath), false);
});

test("patch context exposes backup sessions before destructive writes", () => {
  const homeDir = tempRoot();
  const target = path.join(homeDir, "config.txt");
  fs.writeFileSync(target, "old", "utf8");
  const registry = [
    patch({
      id: "backup-and-rewrite",
      phase: "post-sync",
      destructive: true,
      needsBackup: true,
      run(context) {
        context.backupSession.backupExisting(target);
        fs.writeFileSync(target, "new", "utf8");
        return {
          status: "applied",
          message: "rewrote config",
          writes: [target],
          backups: [...context.backupSession.backups],
        };
      },
    }),
  ];

  const report = runPatchesForPhase({ phase: "post-sync", projectRoot: homeDir, homeDir, registry });
  const backup = report.results[0]?.backups?.[0]?.backup;

  assert.equal(fs.readFileSync(target, "utf8"), "new");
  assert.ok(backup);
  assert.equal(fs.readFileSync(backup, "utf8"), "old");
});

test("patch failures distinguish optional warnings from required errors", () => {
  const homeDir = tempRoot();
  const registry = [
    patch({
      id: "optional-failure",
      phase: "pre-doctor",
      required: false,
      run() {
        throw new Error("optional broke");
      },
    }),
    patch({
      id: "required-failure",
      phase: "pre-doctor",
      required: true,
      run() {
        throw new Error("required broke");
      },
    }),
  ];

  const report = runPatchesForPhase({ phase: "pre-doctor", projectRoot: homeDir, homeDir, registry });

  assert.equal(report.outcome, "fail");
  assert.equal(report.warnings.length, 1);
  assert.equal(report.errors.length, 1);
  assert.match(report.warnings[0], /optional-failure/);
  assert.match(report.errors[0], /required-failure/);
});

test("native script patches run through the shared native command runner", () => {
  const homeDir = tempRoot();
  const registry = [
    defineNativeScriptPatch({
      id: "native-node",
      title: "Run node",
      description: "Uses the native runner contract",
      category: "compatibility",
      reason: "Exercise native command execution through the patch API.",
      introducedIn: "0.0.0-test",
      phase: "pre-sync",
      applies: () => true,
      command: () => ({
        command: process.execPath,
        args: ["-e", "console.log('native ok')"],
      }),
      successMessage: "native script completed",
    }),
  ];

  const report = runPatchesForPhase({ phase: "pre-sync", projectRoot: homeDir, homeDir, registry });

  assert.equal(report.outcome, "pass");
  assert.equal(report.results[0]?.status, "applied");
  assert.match(report.results[0]?.stdoutTail ?? "", /native ok/);
});

test("inspectPatches reports lifecycle metadata, state and retirement warnings", () => {
  const homeDir = tempRoot();
  const registry = [
    patch({
      id: "old-cleanup",
      title: "Old cleanup",
      description: "A cleanup patch whose retention window ended.",
      category: "cleanup",
      reason: "Clean legacy files in a fixture.",
      introducedIn: "0.0.1",
      retireAfter: "0.0.2",
      removalCondition: "Remove after the fixture proves retirement warnings.",
      phase: "pre-sync",
      runOnce: true,
      run() {
        return { status: "applied", message: "cleaned" };
      },
    }),
    patch({
      id: "ongoing-guardrail",
      title: "Ongoing guardrail",
      description: "A permanent safety guardrail.",
      category: "guardrail",
      reason: "Protect a risky transition in a fixture.",
      introducedIn: "0.0.1",
      phase: "post-sync",
      run() {
        return { status: "skipped", message: "not needed" };
      },
    }),
  ];

  runPatchesForPhase({ phase: "pre-sync", projectRoot: homeDir, homeDir, registry });
  const report = inspectPatches({ projectRoot: homeDir, homeDir, registry, now: new Date("2026-05-08T00:00:00.000Z") });
  const formatted = formatPatchLifecycleReport(report);

  assert.equal(report.schema, PATCH_LIFECYCLE_SCHEMA);
  assert.equal(report.outcome, "warn");
  assert.equal(report.registered, 2);
  assert.equal(report.retirementDue, 1);
  assert.equal(report.patches.find((item) => item.id === "old-cleanup")?.lastAppliedAt !== undefined, true);
  assert.match(report.warnings.join("\n"), /old-cleanup: Patch is due for retirement since 0\.0\.2/);
  assert.match(formatted, /OGB patches/);
  assert.match(formatted, /\[RETIRE\] old-cleanup/);
  assert.match(formatted, /Rule: patches repair legacy state/);
});

test("built-in patches declare lifecycle policy metadata", () => {
  const homeDir = tempRoot();
  const report = inspectPatches({ projectRoot: homeDir, homeDir, registry: OGB_PATCHES, now: new Date("2026-05-08T00:00:00.000Z") });

  assert.equal(report.outcome, "pass");
  assert.equal(report.warnings.length, 0);
  assert.equal(report.patches.every((item) => item.category && item.reason && item.introducedIn), true);
  assert.equal(report.patches.some((item) => item.category === "cleanup" && item.retireAfter), true);
});

test("medical notes pre-update snapshot ignores installer metadata drift", { skip: !hasGit() }, () => {
  const homeDir = tempRoot();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionPath, "docs"), { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench", version: "0.3.10" }), "utf8");
  fs.writeFileSync(path.join(extensionPath, "GEMINI.md"), "baseline\n", "utf8");
  git(extensionPath, ["init"]);
  git(extensionPath, ["config", "user.email", "test@example.com"]);
  git(extensionPath, ["config", "user.name", "Test"]);
  git(extensionPath, ["add", "gemini-extension.json", "GEMINI.md"]);
  git(extensionPath, ["commit", "-m", "baseline"]);
  fs.writeFileSync(path.join(extensionPath, ".gemini-extension-install.json"), "{}\n", "utf8");

  const report = runBeforeGeminiExtensionUpdatePatches({
    projectRoot: homeDir,
    homeDir,
    registry: OGB_PATCHES,
    extension: {
      name: "medical-notes-workbench",
      extensionPath,
      manifestPath: path.join(extensionPath, "gemini-extension.json"),
      currentVersion: "0.3.10",
    },
  });

  assert.equal(report.outcome, "skipped");
  assert.equal(report.results[0]?.status, "skipped");
  assert.match(report.results[0]?.message ?? "", /no allowlisted local drift/i);
  assert.equal(fs.existsSync(path.join(homeDir, ".gemini", "medical-notes-workbench", "feedback", "pre-update-snapshots")), false);
});

test("medical notes pre-update snapshot captures allowlisted diffs and scripts", { skip: !hasGit() }, () => {
  const homeDir = tempRoot();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionPath, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench", version: "0.3.10" }), "utf8");
  fs.writeFileSync(path.join(extensionPath, "scripts", "baseline.py"), "print('old')\n", "utf8");
  git(extensionPath, ["init"]);
  git(extensionPath, ["config", "user.email", "test@example.com"]);
  git(extensionPath, ["config", "user.name", "Test"]);
  git(extensionPath, ["add", "gemini-extension.json", "scripts/baseline.py"]);
  git(extensionPath, ["commit", "-m", "baseline"]);
  fs.writeFileSync(path.join(extensionPath, "scripts", "baseline.py"), "print('patched before update')\n", "utf8");
  fs.writeFileSync(path.join(extensionPath, "scripts", "agent_hotfix.py"), "print('agent hotfix')\n", "utf8");
  fs.writeFileSync(path.join(extensionPath, ".gemini-extension-install.json"), "{}\n", "utf8");
  const head = gitOutput(extensionPath, ["rev-parse", "HEAD"]).trim();

  const report = runBeforeGeminiExtensionUpdatePatches({
    projectRoot: homeDir,
    homeDir,
    registry: OGB_PATCHES,
    now: new Date("2026-05-08T12:00:00.000Z"),
    extension: {
      name: "medical-notes-workbench",
      extensionPath,
      manifestPath: path.join(extensionPath, "gemini-extension.json"),
      currentVersion: "0.3.10",
      currentRef: "gemini-cli-extension",
    },
  });
  const snapshotRoot = path.join(homeDir, ".gemini", "medical-notes-workbench", "feedback", "pre-update-snapshots");
  const snapshotDir = fs.readdirSync(snapshotRoot).map((entry) => path.join(snapshotRoot, entry))[0]!;
  const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotDir, "snapshot.json"), "utf8"));
  const trackedDiff = fs.readFileSync(path.join(snapshotDir, "tracked.diff"), "utf8");
  const untrackedDiff = fs.readFileSync(path.join(snapshotDir, "untracked.diff"), "utf8");

  assert.equal(report.outcome, "pass");
  assert.equal(report.results[0]?.status, "applied");
  assert.match(trackedDiff, /patched before update/);
  assert.match(untrackedDiff, /agent hotfix/);
  assert.equal(snapshot.current_version, "0.3.10");
  assert.equal(snapshot.git_head, head);
  assert.equal(snapshot.changed_path_count, 1);
  assert.equal(snapshot.untracked_path_count, 1);
  assert.equal(snapshot.ignored_path_count, 1);
  assert.equal(snapshot.snapshot_useful, true);
  assert.deepEqual(snapshot.changed_paths, ["scripts/baseline.py"]);
  assert.deepEqual(snapshot.untracked_paths, ["scripts/agent_hotfix.py"]);
  assert.deepEqual(snapshot.ignored_paths, [".gemini-extension-install.json"]);
  assert.equal(snapshot.generated_scripts.length, 2);
  assert.match(snapshot.generated_scripts[0].content, /patched before update|agent hotfix/);
});

test("patch phases emit progress events with canonical step ids", () => {
  const homeDir = tempRoot();
  const events: RitualProgressEvent[] = [];
  const registry = [
    patch({
      id: "evented",
      phase: "pre-sync",
      run() {
        return { status: "applied", message: "done" };
      },
    }),
  ];

  runPatchesForPhase({
    phase: "pre-sync",
    projectRoot: homeDir,
    homeDir,
    registry,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual(events.map((event) => `${event.stepId}:${event.status}`), [
    "patches-pre-sync:running",
    "patches-pre-sync:pass",
  ]);
});

test("patches receive project, platform and command contract in context", () => {
  const homeDir = tempRoot();
  let seen: Pick<PatchContext, "projectRoot" | "homeDir" | "homeMode" | "platform"> | undefined;
  const registry = [
    patch({
      id: "inspect-context",
      phase: "post-check",
      run(context) {
        seen = {
          projectRoot: context.projectRoot,
          homeDir: context.homeDir,
          homeMode: context.homeMode,
          platform: context.platform,
        };
        return { status: "applied", message: "inspected" };
      },
    }),
  ];

  runPatchesForPhase({ phase: "post-check", projectRoot: homeDir, homeDir, registry });

  assert.deepEqual(seen, {
    projectRoot: homeDir,
    homeDir,
    homeMode: true,
    platform: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
  });
});

test("medical-notes-workbench patch snapshots drift before extension update", { skip: !hasGit() }, () => {
  const homeDir = tempRoot();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionPath, "docs"), { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({
    name: "medical-notes-workbench",
    version: "0.3.10",
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(extensionPath, "docs", "notes.md"), "baseline\n", "utf8");
  git(extensionPath, ["init"]);
  git(extensionPath, ["config", "user.email", "ogb@example.test"]);
  git(extensionPath, ["config", "user.name", "OGB Test"]);
  git(extensionPath, ["add", "."]);
  git(extensionPath, ["commit", "-m", "baseline"]);
  fs.writeFileSync(path.join(extensionPath, "docs", "notes.md"), "baseline\nlocal edit\n", "utf8");
  fs.writeFileSync(path.join(extensionPath, "docs", "untracked.md"), "new local file\n", "utf8");

  const report = runBeforeGeminiExtensionUpdatePatches({
    projectRoot: homeDir,
    homeDir,
    extension: {
      name: "medical-notes-workbench",
      extensionPath,
      manifestPath: path.join(extensionPath, "gemini-extension.json"),
      currentVersion: "0.3.10",
      targetVersion: "0.3.12",
    },
  });
  const snapshotJsonPath = report.results[0]?.writes?.find((item) => item.endsWith("snapshot.json"));
  assert.equal(report.outcome, "pass");
  assert.ok(snapshotJsonPath);
  const snapshot = JSON.parse(fs.readFileSync(snapshotJsonPath, "utf8"));

  assert.equal(snapshot.schema, "medical-notes-workbench.pre-update-extension-snapshot.v1");
  assert.equal(snapshot.extension_path, extensionPath);
  assert.equal(snapshot.current_version, "0.3.10");
  assert.equal(snapshot.target_version, "0.3.12");
  assert.equal(snapshot.changed_path_count, 1);
  assert.equal(snapshot.untracked_path_count, 1);
  assert.match(fs.readFileSync(path.join(path.dirname(snapshotJsonPath), "tracked.diff"), "utf8"), /local edit/);
  assert.match(fs.readFileSync(path.join(path.dirname(snapshotJsonPath), "untracked.diff"), "utf8"), /new local file/);
});
