import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSecurityCheck } from "./security.js";
import { buildTrustReviewReport, runTrustExtension } from "./trust.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-security-"));
}

function writeCleanBridgeFiles(projectRoot: string): void {
  fs.mkdirSync(path.join(projectRoot, ".opencode", "agents"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "agents", "YOLO.md"), `---
mode: primary
permission:
  question: allow
  todowrite: allow
  edit: allow
  bash: allow
  task: allow
  external_directory: allow
---
`);
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), JSON.stringify({
    extensions: [
      {
        hooks: [{ source: "hooks/hooks.json", projected: false }],
        scripts: [{ source: "bin/run.sh", projected: false }],
      },
    ],
  }));
  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), JSON.stringify({ mcp: {} }));
}

test("runSecurityCheck passes a clean generated bridge surface", () => {
  const projectRoot = tempProject();
  writeCleanBridgeFiles(projectRoot);

  const report = runSecurityCheck({ projectRoot, json: true });

  assert.equal(report.outcome, "pass");
});

test("runSecurityCheck allows user-tuned YOLO task and external directory permissions", () => {
  const projectRoot = tempProject();
  writeCleanBridgeFiles(projectRoot);
  fs.writeFileSync(path.join(projectRoot, ".opencode", "agents", "YOLO.md"), `---
mode: primary
permission:
  question: allow
  todowrite: allow
  edit: allow
  bash: allow
  task: allow
  external_directory: allow
---
`);

  const report = runSecurityCheck({ projectRoot, json: true });

  assert.equal(report.outcome, "pass");
});

test("runSecurityCheck fails on high-confidence secret patterns", () => {
  const projectRoot = tempProject();
  writeCleanBridgeFiles(projectRoot);
  const fakeKey = "sk-" + "abcdefghijklmnopqrstuvwxyz1234567890";
  fs.writeFileSync(path.join(projectRoot, "leak.md"), `OPENAI_API_KEY=${fakeKey}\n`);

  const report = runSecurityCheck({ projectRoot, json: true });

  assert.equal(report.outcome, "fail");
  assert.ok(report.findings.some((finding) => finding.name === "Secret patterns" && finding.status === "fail"));
});

test("runSecurityCheck skips unreadable directories", { skip: process.platform === "win32" }, () => {
  const projectRoot = tempProject();
  writeCleanBridgeFiles(projectRoot);
  const locked = path.join(projectRoot, "locked");
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0);

  try {
    const report = runSecurityCheck({ projectRoot, json: true });
    assert.equal(report.outcome, "pass");
  } finally {
    fs.chmodSync(locked, 0o700);
  }
});

test("runSecurityCheck scans only bridge files when project root is home", () => {
  const projectRoot = tempProject();
  writeCleanBridgeFiles(projectRoot);
  fs.mkdirSync(path.join(projectRoot, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".ssh", "id_rsa"), "not part of the bridge scan\n");

  const report = runSecurityCheck({ projectRoot, homeDir: projectRoot, json: true });

  assert.equal(report.outcome, "pass");
  assert.equal(report.findings.find((finding) => finding.name === "Secret-like files")?.status, "pass");
});

test("runSecurityCheck fails when trusted extension hook hash changes", () => {
  const projectRoot = tempProject();
  fs.mkdirSync(path.join(projectRoot, ".opencode", "agents"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "agents", "YOLO.md"), `---
mode: primary
permission:
  question: allow
  todowrite: allow
  edit: allow
  bash: allow
  task: allow
  external_directory: allow
---
`);
  const extensionDir = path.join(projectRoot, ".gemini", "extensions", "trusted-ext");
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), "{}\n");
  fs.mkdirSync(path.join(projectRoot, ".opencode", "generated"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), JSON.stringify({
    extensions: [
      {
        name: "trusted-ext",
        path: extensionDir,
        hooks: [{ source: "hooks/hooks.json", projected: false }],
        scripts: [],
      },
    ],
  }));
  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), JSON.stringify({ mcp: {} }));

  runTrustExtension({ projectRoot, extension: "trusted-ext", allHooks: true, json: true });
  assert.equal(runSecurityCheck({ projectRoot, json: true }).outcome, "pass");

  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), "{\"changed\":true}\n");
  const report = runSecurityCheck({ projectRoot, json: true });

  assert.equal(report.outcome, "fail");
  assert.ok(report.findings.some((finding) => finding.name === "Trusted extension hooks/scripts" && finding.status === "fail"));
});

test("buildTrustReviewReport lists hook commands and trust hash status", () => {
  const projectRoot = tempProject();
  writeCleanBridgeFiles(projectRoot);
  const extensionDir = path.join(projectRoot, ".gemini", "extensions", "review-ext");
  fs.mkdirSync(path.join(extensionDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "hooks", "hooks.json"), JSON.stringify({
    hooks: [
      { command: "node scripts/check.js" },
      { run: ["npm", "test"] },
    ],
  }));
  fs.mkdirSync(path.join(extensionDir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "scripts", "check.js"), "console.log('ok')\n");
  fs.writeFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"), JSON.stringify({
    extensions: [
      {
        name: "review-ext",
        path: extensionDir,
        hooks: [{ source: "hooks/hooks.json", projected: false, reason: "review" }],
        scripts: [{ source: "scripts/check.js", projected: false, reason: "review" }],
      },
    ],
  }));

  runTrustExtension({ projectRoot, extension: "review-ext", hook: ["hooks/hooks.json"], json: true });
  const report = buildTrustReviewReport({ projectRoot, extension: "review-ext" });
  const hook = report.items.find((item) => item.kind === "hook");
  const script = report.items.find((item) => item.kind === "script");

  assert.equal(hook?.trusted, true);
  assert.equal(hook?.hashMatches, true);
  assert.deepEqual(hook?.commands, ["node scripts/check.js", "npm test"]);
  assert.equal(script?.trusted, false);
  assert.deepEqual(script?.commands, ["check.js"]);
});
