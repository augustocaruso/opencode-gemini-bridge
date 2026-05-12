import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

async function waitForFile(filePath: string): Promise<void> {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > 5000) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function hasGit(): boolean {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function pythonCommand(): string | undefined {
  for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) return command;
  }
  return undefined;
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

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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

test("medical notes pre-update snapshot sends trusted debug telemetry when configured", { skip: !hasGit() }, async () => {
  const homeDir = tempRoot();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  const requestLog = path.join(homeDir, "telemetry-requests.json");
  const portFile = path.join(homeDir, "telemetry-port.txt");
  const serverScript = `
const fs = require("node:fs");
const http = require("node:http");
const requestLog = process.argv[1];
const portFile = process.argv[2];
const server = http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    let requests = [];
    try { requests = JSON.parse(fs.readFileSync(requestLog, "utf8")); } catch {}
    requests.push({ path: request.url || "", auth: String(request.headers.authorization || ""), body });
    fs.writeFileSync(requestLog, JSON.stringify(requests), "utf8");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, accepted_records: 1 }));
  });
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port), "utf8");
});
`;
  const server = spawn(process.execPath, ["-e", serverScript, requestLog, portFile], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    await waitForFile(portFile);
    const port = fs.readFileSync(portFile, "utf8").trim();
    const endpoint = `http://127.0.0.1:${port}/v1/telemetry/workflow-runs`;
    fs.mkdirSync(path.join(extensionPath, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(homeDir, ".gemini", "medical-notes-workbench"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".gemini", "medical-notes-workbench", "config.toml"),
      `[telemetry]\nendpoint_url = "${endpoint}"\nauth_token = "test-token"\npayload_level = "trusted_extension_debug"\ninstall_id = "friend-install"\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench", version: "0.3.10" }), "utf8");
    fs.writeFileSync(path.join(extensionPath, "scripts", "baseline.py"), "print('old')\n", "utf8");
    git(extensionPath, ["init"]);
    git(extensionPath, ["config", "user.email", "test@example.com"]);
    git(extensionPath, ["config", "user.name", "Test"]);
    git(extensionPath, ["add", "."]);
    git(extensionPath, ["commit", "-m", "baseline"]);
    fs.writeFileSync(path.join(extensionPath, "scripts", "baseline.py"), "print('patched before update')\n", "utf8");

    const report = runBeforeGeminiExtensionUpdatePatches({
      projectRoot: homeDir,
      homeDir,
      registry: OGB_PATCHES,
      now: new Date("2026-05-08T12:30:00.000Z"),
      extension: {
        name: "medical-notes-workbench",
        extensionPath,
        manifestPath: path.join(extensionPath, "gemini-extension.json"),
        currentVersion: "0.3.10",
      },
    });
    const snapshotJsonPath = report.results[0]?.writes?.find((item) => item.endsWith("snapshot.json"));
    assert.equal(report.outcome, "pass");
    assert.equal(report.results[0]?.status, "applied");
    assert.match(report.results[0]?.message ?? "", /telemetry email send requested/);
    assert.ok(snapshotJsonPath);
    const snapshotDir = path.dirname(snapshotJsonPath);
    const sendResult = JSON.parse(fs.readFileSync(path.join(snapshotDir, "send-result.json"), "utf8"));
    const envelope = JSON.parse(fs.readFileSync(path.join(snapshotDir, "telemetry-envelope.json"), "utf8"));
    const requests = JSON.parse(fs.readFileSync(requestLog, "utf8")) as Array<{ path: string; auth: string; body: string }>;
    const workflowRequest = requests.find((item) => item.path === "/v1/telemetry/workflow-runs");
    const digestRequest = requests.find((item) => item.path === "/v1/telemetry/digest/send");

    assert.equal(sendResult.sent, true);
    assert.ok(workflowRequest);
    assert.equal(workflowRequest?.auth, "Bearer test-token");
    assert.ok(digestRequest);
    assert.equal(envelope.payload_level, "trusted_extension_debug");
    assert.equal(envelope.install_id, "friend-install");
    assert.match(JSON.stringify(envelope.records[0].extension_diffs), /patched before update/);
    assert.match(JSON.stringify(JSON.parse(workflowRequest?.body ?? "{}")), /patched before update/);
  } finally {
    server.kill();
  }
});

test("medical notes pre-update snapshot recovers manifest drift when git status is clean", { skip: !hasGit() }, () => {
  const homeDir = tempRoot();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(extensionPath, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench", version: "0.3.10" }), "utf8");
  const oldGemini = "# Router\nold route\n";
  const newGemini = "# Router\nnew route\n";
  fs.writeFileSync(path.join(extensionPath, "GEMINI.md"), oldGemini, "utf8");
  git(extensionPath, ["init"]);
  git(extensionPath, ["config", "user.email", "test@example.com"]);
  git(extensionPath, ["config", "user.name", "Test"]);
  git(extensionPath, ["add", "gemini-extension.json", "GEMINI.md"]);
  git(extensionPath, ["commit", "-m", "old release"]);
  fs.writeFileSync(path.join(extensionPath, "extension-integrity-manifest.json"), JSON.stringify({
    schema: "medical-notes-workbench.extension-integrity-manifest.v1",
    app_version: "0.3.10",
    files: [{
      path: "GEMINI.md",
      kind: "prompt",
      sha256: sha256Text(oldGemini),
      normalized_sha256: sha256Text(oldGemini),
      size_bytes: Buffer.byteLength(oldGemini, "utf8"),
      line_count: 2,
    }],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(extensionPath, "GEMINI.md"), newGemini, "utf8");
  git(extensionPath, ["add", "GEMINI.md", "extension-integrity-manifest.json"]);
  git(extensionPath, ["commit", "-m", "agent changed release"]);

  const report = runBeforeGeminiExtensionUpdatePatches({
    projectRoot: homeDir,
    homeDir,
    registry: OGB_PATCHES,
    now: new Date("2026-05-08T13:00:00.000Z"),
    extension: {
      name: "medical-notes-workbench",
      extensionPath,
      manifestPath: path.join(extensionPath, "gemini-extension.json"),
      currentVersion: "0.3.10",
    },
  });
  const snapshotJsonPath = report.results[0]?.writes?.find((item) => item.endsWith("snapshot.json"));
  assert.equal(report.outcome, "pass");
  assert.equal(report.results[0]?.status, "applied");
  assert.ok(snapshotJsonPath);
  const snapshotDir = path.dirname(snapshotJsonPath);
  const snapshot = JSON.parse(fs.readFileSync(snapshotJsonPath, "utf8"));
  const trackedDiff = fs.readFileSync(path.join(snapshotDir, "tracked.diff"), "utf8");
  const extensionFullDiff = fs.readFileSync(path.join(snapshotDir, "extension-full.diff"), "utf8");

  assert.equal(snapshot.changed_path_count, 1);
  assert.equal(snapshot.manifest_drift_path_count, 1);
  assert.equal(snapshot.baseline_recovered_count, 1);
  assert.deepEqual(snapshot.changed_paths, ["GEMINI.md"]);
  assert.match(trackedDiff, /old route/);
  assert.match(trackedDiff, /new route/);
  assert.match(extensionFullDiff, /old route/);
  assert.match(extensionFullDiff, /new route/);
});

test("medical notes pre-update snapshot prefers installed capture_extension_diff script", { skip: !hasGit() || !pythonCommand() }, () => {
  const homeDir = tempRoot();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(path.join(extensionPath, "scripts", "mednotes"), { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "medical-notes-workbench", version: "0.3.18" }), "utf8");
  fs.writeFileSync(path.join(extensionPath, "GEMINI.md"), "baseline\n", "utf8");
  fs.writeFileSync(path.join(extensionPath, "scripts", "mednotes", "capture_extension_diff.py"), [
    "import argparse, json",
    "from pathlib import Path",
    "parser = argparse.ArgumentParser()",
	    "parser.add_argument('--extension-path')",
	    "parser.add_argument('--output-dir')",
	    "parser.add_argument('--send', action='store_true')",
	    "parser.add_argument('--no-flush', action='store_true')",
	    "parser.add_argument('--no-existing-snapshots', action='store_true')",
    "args = parser.parse_args()",
    "out = Path(args.output_dir)",
    "out.mkdir(parents=True, exist_ok=True)",
    "patch = 'diff --git a/GEMINI.md b/GEMINI.md\\n--- a/GEMINI.md\\n+++ b/GEMINI.md\\n@@\\n-script old\\n+script captured drift\\n'",
    "(out / 'tracked.diff').write_text(patch, encoding='utf-8')",
    "(out / 'extension-full.diff').write_text(patch, encoding='utf-8')",
    "(out / 'staged.diff').write_text('', encoding='utf-8')",
    "(out / 'untracked.diff').write_text('', encoding='utf-8')",
    "(out / 'snapshot.json').write_text(json.dumps({'schema': 'medical-notes-workbench.pre-update-extension-snapshot.v1', 'snapshot_id': out.name, 'snapshot_path': str(out), 'changed_path_count': 1, 'untracked_path_count': 0, 'capture_script': 'fixture'}, indent=2), encoding='utf-8')",
    "print(json.dumps({'ok': True, 'snapshot_path': str(out)}))",
  ].join("\n"), "utf8");
  git(extensionPath, ["init"]);
  git(extensionPath, ["config", "user.email", "test@example.com"]);
  git(extensionPath, ["config", "user.name", "Test"]);
  git(extensionPath, ["add", "."]);
  git(extensionPath, ["commit", "-m", "baseline"]);
  fs.writeFileSync(path.join(extensionPath, "GEMINI.md"), "local drift\n", "utf8");

  const report = runBeforeGeminiExtensionUpdatePatches({
    projectRoot: homeDir,
    homeDir,
    registry: OGB_PATCHES,
    env: { ...process.env, OGB_PYTHON: pythonCommand() },
    now: new Date("2026-05-08T14:00:00.000Z"),
    extension: {
      name: "medical-notes-workbench",
      extensionPath,
      manifestPath: path.join(extensionPath, "gemini-extension.json"),
      currentVersion: "0.3.18",
    },
  });
  const snapshotJsonPath = report.results[0]?.writes?.find((item) => item.endsWith("snapshot.json"));
  assert.equal(report.outcome, "pass");
  assert.equal(report.results[0]?.status, "applied");
  assert.match(report.results[0]?.message ?? "", /capture_extension_diff\.py/);
  assert.ok(snapshotJsonPath);
  const trackedDiff = fs.readFileSync(path.join(path.dirname(snapshotJsonPath), "tracked.diff"), "utf8");
  assert.match(trackedDiff, /script captured drift/);
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

  assert.deepEqual(events.map((event) => `${event.stepId}:${event.status}`), ["patches-pre-sync:pass"]);
});

test("patch phases stay silent when no patch applies", () => {
  const homeDir = tempRoot();
  const events: RitualProgressEvent[] = [];
  const registry = [
    patch({
      id: "not-applicable",
      phase: "pre-sync",
      applies: () => false,
      run() {
        return { status: "applied", message: "should not run" };
      },
    }),
  ];

  const report = runPatchesForPhase({
    phase: "pre-sync",
    projectRoot: homeDir,
    homeDir,
    registry,
    onProgress: (event) => events.push(event),
  });

  assert.equal(report.outcome, "skipped");
  assert.deepEqual(events, []);
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
