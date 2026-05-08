import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildInstallExtensionArgs,
  buildUpdateExtensionsArgs,
  inspectExtensionSource,
  installGeminiExtension,
  listInstalledGeminiExtensions,
  updateGeminiExtensions,
} from "./extensions.js";
import type { OgbPatch } from "./patches.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-ext-"));
}

function writeExecutable(root: string, content: string): string {
  const filePath = path.join(root, "fake-gemini.js");
  fs.writeFileSync(filePath, `#!/usr/bin/env node\n${content}`, "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

test("buildInstallExtensionArgs defaults remote git sources to auto-update", () => {
  assert.deepEqual(
    buildInstallExtensionArgs({
      source: "https://github.com/acme/study-pack.git",
      ref: "gemini-cli-extension",
      trust: true,
    }),
    [
      "extensions",
      "install",
      "https://github.com/acme/study-pack.git",
      "--ref",
      "gemini-cli-extension",
      "--auto-update",
      "--consent",
    ],
  );
});

test("inspectExtensionSource finds local manifest, hooks, and scripts", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "gemini-extension.json"), JSON.stringify({ name: "local-pack" }));
  fs.mkdirSync(path.join(root, "hooks"));
  fs.writeFileSync(path.join(root, "hooks", "hooks.json"), "{}");
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "setup.sh"), "#!/usr/bin/env bash\n");

  const inspection = inspectExtensionSource(root);

  assert.equal(inspection.local, true);
  assert.equal(inspection.installSource, root);
  assert.deepEqual(inspection.hooks, ["hooks/hooks.json"]);
  assert.deepEqual(inspection.scripts, ["scripts/setup.sh"]);
  assert.ok(inspection.warnings.some((warning) => warning.includes("Hooks found")));
});

test("installGeminiExtension blocks risky local extension without trust", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "gemini-extension.json"), JSON.stringify({ name: "local-pack" }));
  fs.mkdirSync(path.join(root, "hooks"));
  fs.writeFileSync(path.join(root, "hooks", "hooks.json"), "{}");

  const report = installGeminiExtension({ source: root });

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.command.slice(0, 3), ["gemini", "extensions", "install"]);
});

test("buildUpdateExtensionsArgs updates all by default or one named extension", () => {
  assert.deepEqual(buildUpdateExtensionsArgs(), ["extensions", "update", "--all"]);
  assert.deepEqual(buildUpdateExtensionsArgs({ name: "study-pack" }), ["extensions", "update", "study-pack"]);
});

test("listInstalledGeminiExtensions reports extension path and current version", () => {
  const homeDir = tempDir();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "medical-notes-workbench");
  fs.mkdirSync(extensionPath, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({
    name: "medical-notes-workbench",
    version: "0.3.10",
    ref: "main",
  }), "utf8");

  const extensions = listInstalledGeminiExtensions({ projectRoot: homeDir, homeDir });

  assert.equal(extensions.length, 1);
  assert.equal(extensions[0]?.name, "medical-notes-workbench");
  assert.equal(extensions[0]?.extensionPath, extensionPath);
  assert.equal(extensions[0]?.currentVersion, "0.3.10");
  assert.equal(extensions[0]?.currentRef, "main");
});

test("updateGeminiExtensions auto-consent captures output and feeds yes input", () => {
  const root = tempDir();
  const fakeGemini = writeExecutable(root, `
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8");
console.log(process.argv.slice(2).join(" "));
console.error("stderr ok");
if (!input.includes("y")) process.exit(7);
`);

  const report = updateGeminiExtensions({ geminiBin: fakeGemini, autoConsent: true });

  assert.equal(report.status, "applied");
  assert.deepEqual(report.command, [fakeGemini, "extensions", "update", "--all"]);
  assert.match(report.stdoutTail ?? "", /extensions update --all/);
  assert.match(report.stderrTail ?? "", /stderr ok/);
});

test("updateGeminiExtensions skips Gemini when scoped inventory has no extensions", () => {
  const homeDir = tempDir();
  const marker = path.join(homeDir, "gemini-ran.txt");
  const fakeGemini = writeExecutable(homeDir, `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(marker)}, "ran");
process.exit(9);
`);

  const report = updateGeminiExtensions({
    geminiBin: fakeGemini,
    autoConsent: true,
    projectRoot: homeDir,
    homeDir,
  });

  assert.equal(report.status, "applied");
  assert.deepEqual(report.beforeExtensions, []);
  assert.deepEqual(report.afterExtensions, []);
  assert.equal(fs.existsSync(marker), false);
});

test("updateGeminiExtensions runs per-extension pre-update patches before invoking Gemini", () => {
  const homeDir = tempDir();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "demo-ext");
  const marker = path.join(homeDir, "patch-ran-before-update.txt");
  const fakeGemini = writeExecutable(homeDir, `
const fs = require("node:fs");
if (!fs.existsSync(${JSON.stringify(marker)})) process.exit(13);
console.log("updated after patch");
`);
  fs.mkdirSync(extensionPath, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "demo-ext", version: "1.0.0" }), "utf8");
  const patchRegistry: readonly OgbPatch[] = [{
    id: "demo-pre-update",
    title: "Demo pre-update",
    description: "Records that the extension patch ran first.",
    category: "guardrail",
    reason: "Exercise extension pre-update patch ordering.",
    introducedIn: "0.0.0-test",
    phase: "before-gemini-extension-update",
    required: true,
    applies: (context) => context.extension?.name === "demo-ext",
    run: (context) => {
      fs.writeFileSync(marker, `${context.extension?.extensionPath}\n${context.extension?.currentVersion}`, "utf8");
      return { status: "applied", message: "marker written", writes: [marker] };
    },
  }];

  const report = updateGeminiExtensions({
    geminiBin: fakeGemini,
    autoConsent: true,
    projectRoot: homeDir,
    homeDir,
    patchRegistry,
  });

  assert.equal(report.status, "applied");
  assert.match(fs.readFileSync(marker, "utf8"), /demo-ext/);
  assert.equal(report.beforeExtensions?.[0]?.currentVersion, "1.0.0");
  assert.equal(report.patches?.[0]?.results[0]?.extension?.extensionPath, extensionPath);
});

test("updateGeminiExtensions blocks update when required pre-update patch fails", () => {
  const homeDir = tempDir();
  const extensionPath = path.join(homeDir, ".gemini", "extensions", "demo-ext");
  const marker = path.join(homeDir, "gemini-ran.txt");
  const fakeGemini = writeExecutable(homeDir, `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(marker)}, "ran");
`);
  fs.mkdirSync(extensionPath, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, "gemini-extension.json"), JSON.stringify({ name: "demo-ext", version: "1.0.0" }), "utf8");
  const patchRegistry: readonly OgbPatch[] = [{
    id: "demo-pre-update-failure",
    title: "Demo pre-update failure",
    description: "Blocks the update.",
    category: "guardrail",
    reason: "Exercise required extension patch blocking.",
    introducedIn: "0.0.0-test",
    phase: "before-gemini-extension-update",
    required: true,
    applies: (context) => context.extension?.name === "demo-ext",
    run: () => ({ status: "failed", message: "snapshot failed" }),
  }];

  const report = updateGeminiExtensions({
    geminiBin: fakeGemini,
    autoConsent: true,
    projectRoot: homeDir,
    homeDir,
    patchRegistry,
  });

  assert.equal(report.status, "blocked");
  assert.match(report.error ?? "", /snapshot failed/);
  assert.equal(fs.existsSync(marker), false);
});

test("updateGeminiExtensions reports captured failure details", () => {
  const root = tempDir();
  const fakeGemini = writeExecutable(root, `
console.log("stdout details");
console.error("stderr details");
process.exit(9);
`);

  const report = updateGeminiExtensions({ geminiBin: fakeGemini, autoConsent: true });

  assert.equal(report.status, "error");
  assert.equal(report.exitCode, 9);
  assert.match(report.stdoutTail ?? "", /stdout details/);
  assert.match(report.stderrTail ?? "", /stderr details/);
});

test("updateGeminiExtensions times out unexpected prompts", () => {
  const root = tempDir();
  const fakeGemini = writeExecutable(root, `
setTimeout(() => {}, 10_000);
`);

  const report = updateGeminiExtensions({ geminiBin: fakeGemini, autoConsent: true, timeoutMs: 20 });

  assert.equal(report.status, "error");
  assert.equal(report.timedOut, true);
});
