import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { globalStartupPluginSpec, setupUx } from "./setup-ux.js";
import { syncToOpenCode } from "./sync.js";
import { runValidation } from "./validation.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-validation-home-"));
}

test("runValidation repairs a stale file blocking the global OpenCode config dir before debug config", () => {
  const homeDir = tempHome();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-validation-project-"));
  const configDir = path.join(homeDir, ".config", "opencode");
  fs.mkdirSync(path.dirname(configDir), { recursive: true });
  fs.writeFileSync(configDir, "stale projected file\n", "utf8");

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const report = runValidation({ projectRoot, homeDir, silent: true });
    const repairCheck = report.checks.find((check) => check.name === "Global OpenCode config directory");
    const details = repairCheck?.details as { backup?: string } | undefined;

    assert.equal(repairCheck?.status, "pass");
    assert.match(repairCheck?.message ?? "", /Repaired stale file/);
    assert.equal(fs.statSync(configDir).isDirectory(), true);
    assert.ok(details?.backup);
    assert.equal(fs.readFileSync(details.backup, "utf8"), "stale projected file\n");
  } finally {
    process.env.PATH = originalPath;
  }
});

test("runValidation repairs the exact OpenCode mkdir EEXIST path and retries debug config", () => {
  const homeDir = tempHome();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-validation-project-"));
  const binDir = path.join(homeDir, "bin");
  const fakeOpencode = path.join(binDir, "fake-opencode.cjs");
  const configDir = path.join(homeDir, ".config", "opencode");
  const statePath = path.join(homeDir, "fake-opencode-state");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeOpencode, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const statePath = process.env.OGB_FAKE_OPENCODE_STATE;
const blockedDir = process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR;
if (args[0] === "--version") {
  console.log("opencode fake");
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "config") {
  if (!fs.existsSync(statePath)) {
    fs.mkdirSync(path.dirname(blockedDir), { recursive: true });
    fs.writeFileSync(blockedDir, "late stale file\\n", "utf8");
    fs.writeFileSync(statePath, "failed-once", "utf8");
    console.error("EEXIST: file already exists, mkdir '" + blockedDir + "'");
    process.exit(2);
  }
  console.log(JSON.stringify({ agent: {}, command: {} }));
  process.exit(0);
}
console.error("unexpected opencode args: " + args.join(" "));
process.exit(1);
`, "utf8");
  fs.writeFileSync(path.join(binDir, "opencode"), `#!/usr/bin/env sh\nexec node "${fakeOpencode.replace(/"/g, "\\\"")}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, "opencode.cmd"), `@echo off\r\nnode "${fakeOpencode}" %*\r\n`, "utf8");

  const originalPath = process.env.PATH;
  const originalState = process.env.OGB_FAKE_OPENCODE_STATE;
  const originalBlocked = process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  process.env.OGB_FAKE_OPENCODE_STATE = statePath;
  process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR = configDir;
  try {
    const report = runValidation({ projectRoot, homeDir, silent: true });
    const repairCheck = report.checks.find((check) => check.name === "OpenCode config directory from debug error");
    const details = repairCheck?.details as { backup?: string } | undefined;
    const debugFailure = report.checks.find((check) => check.name === "OpenCode resolved config" && check.status === "fail");

    assert.equal(repairCheck?.status, "pass");
    assert.equal(fs.statSync(configDir).isDirectory(), true);
    assert.ok(details?.backup);
    assert.equal(fs.readFileSync(details.backup, "utf8"), "late stale file\n");
    assert.equal(debugFailure, undefined);
  } finally {
    process.env.PATH = originalPath;
    if (originalState === undefined) delete process.env.OGB_FAKE_OPENCODE_STATE;
    else process.env.OGB_FAKE_OPENCODE_STATE = originalState;
    if (originalBlocked === undefined) delete process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR;
    else process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR = originalBlocked;
  }
});

test("runValidation skips OpenCode debug config when the Windows mkdir EEXIST target already exists", () => {
  const homeDir = tempHome();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-validation-project-"));
  const binDir = path.join(homeDir, "bin");
  const fakeOpencode = path.join(binDir, "fake-opencode.cjs");
  const configDir = path.join(homeDir, ".config", "opencode");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeOpencode, `
const args = process.argv.slice(2);
const blockedDir = process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR;
const displayDir = process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR || blockedDir;
if (args[0] === "--version") {
  console.log("opencode fake");
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "config") {
  console.error("EEXIST: file already exists, mkdir '" + displayDir + "'");
  console.error('path: "' + displayDir.replace(/\\\\/g, "\\\\\\\\") + '", syscall: "mkdir", errno: -17, code: "EEXIST"');
  process.exit(2);
}
console.error("unexpected opencode args: " + args.join(" "));
process.exit(1);
`, "utf8");
  fs.writeFileSync(path.join(binDir, "opencode"), `#!/usr/bin/env sh\nexec node "${fakeOpencode.replace(/"/g, "\\\"")}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, "opencode.cmd"), `@echo off\r\nnode "${fakeOpencode}" %*\r\n`, "utf8");

  const originalPath = process.env.PATH;
  const originalBlocked = process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR;
  const originalDisplay = process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR = configDir;
  process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR = configDir;
  try {
    const report = runValidation({ projectRoot, homeDir, silent: true });
    const skipCheck = report.checks.find((check) => check.name === "OpenCode resolved config" && check.status === "skip");
    const debugFailure = report.checks.find((check) => check.name === "OpenCode resolved config" && check.status === "fail");

    assert.match(skipCheck?.message ?? "", /Windows Bun mkdir EEXIST/);
    assert.equal(debugFailure, undefined);
  } finally {
    process.env.PATH = originalPath;
    if (originalBlocked === undefined) delete process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR;
    else process.env.OGB_FAKE_BLOCKED_OPENCODE_DIR = originalBlocked;
    if (originalDisplay === undefined) delete process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR;
    else process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR = originalDisplay;
  }
});

test("runValidation skips the OpenCode debug probe immediately for the Windows mkdir EEXIST bug in home mode", () => {
  const homeDir = tempHome();
  const binDir = path.join(homeDir, "bin");
  const fakeOpencode = path.join(binDir, "fake-opencode.cjs");
  const configDir = path.join(homeDir, ".config", "opencode");
  const guardInvokedPath = path.join(homeDir, "guard-invoked");
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "GEMINI.md"), "Global extension rules\n", "utf8");

  setupUx({
    homeDir,
    projectRoot: homeDir,
    resetGlobal: true,
    force: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });
  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true, force: true });

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeOpencode, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const displayDir = process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR || "C:\\\\Users\\\\leo\\\\.config\\\\opencode";
const guardInvokedPath = process.env.OGB_FAKE_GUARD_INVOKED;
if (args[0] === "--version") {
  console.log("opencode fake");
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "config") {
  if (process.env.XDG_CONFIG_HOME || process.env.OPENCODE_CONFIG_DIR) {
    fs.writeFileSync(guardInvokedPath, "guard invoked\\n", "utf8");
    console.error("spawnSync C:\\\\WINDOWS\\\\system32\\\\cmd.exe ETIMEDOUT");
    process.exit(1);
  }
  console.error("EEXIST: file already exists, mkdir '" + displayDir + "'");
  console.error('path: "' + displayDir.replace(/\\\\/g, "\\\\\\\\") + '", syscall: "mkdir", errno: -17, code: "EEXIST"');
  console.error("Bun v1.3.13 (Windows x64 baseline)");
  process.exit(2);
}
console.error("unexpected opencode args: " + args.join(" "));
process.exit(1);
`, "utf8");
  fs.writeFileSync(path.join(binDir, "opencode"), `#!/usr/bin/env sh\nexec node "${fakeOpencode.replace(/"/g, "\\\"")}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, "opencode.cmd"), `@echo off\r\nnode "${fakeOpencode}" %*\r\n`, "utf8");

  const originalPath = process.env.PATH;
  const originalDisplay = process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR;
  const originalGuardInvoked = process.env.OGB_FAKE_GUARD_INVOKED;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR = configDir;
  process.env.OGB_FAKE_GUARD_INVOKED = guardInvokedPath;
  try {
    const report = runValidation({ projectRoot: homeDir, homeDir, silent: true });
    const fallbackCheck = report.checks.find((check) => check.name === "OpenCode resolved config");
    const debugFailure = report.checks.find((check) => check.name === "OpenCode resolved config" && check.status === "fail");

    assert.equal(fallbackCheck?.status, "skip");
    assert.match(fallbackCheck?.message ?? "", /Windows Bun mkdir EEXIST/);
    assert.equal(debugFailure, undefined);
    assert.equal(fs.existsSync(guardInvokedPath), false);
  } finally {
    process.env.PATH = originalPath;
    if (originalDisplay === undefined) delete process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR;
    else process.env.OGB_FAKE_DISPLAY_OPENCODE_DIR = originalDisplay;
    if (originalGuardInvoked === undefined) delete process.env.OGB_FAKE_GUARD_INVOKED;
    else process.env.OGB_FAKE_GUARD_INVOKED = originalGuardInvoked;
  }
});

test("runValidation validates home/global OpenCode files without project artifacts", () => {
  const homeDir = tempHome();
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "GEMINI.md"), "Global extension rules\n", "utf8");

  setupUx({
    homeDir,
    projectRoot: homeDir,
    resetGlobal: true,
    force: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });
  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true, force: true });

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const report = runValidation({ projectRoot: homeDir, homeDir, silent: true });
    const failed = report.checks.filter((check) => check.status === "fail");

    assert.equal(report.outcome, "warn");
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(failed, []);
    assert.equal(report.checks.find((check) => check.name === "Global expanded Gemini context")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Global OpenCode config")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Global OGB startup plugin")?.status, "pass");
    const releaseCheck = report.checks.find((check) => check.name === "Release bootstrap static check");
    assert.equal(releaseCheck?.status, "pass");
    assert.match(releaseCheck?.message ?? "", /Linux/);
    assert.match(releaseCheck?.message ?? "", /fish/);
    assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated", "opencode.generated.json")), false);
    assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "agents", "YOLO.md")), false);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("runValidation fails the legacy relative global startup plugin spec", () => {
  const homeDir = tempHome();
  const configDir = path.join(homeDir, ".config", "opencode");
  const extensionDir = path.join(homeDir, ".gemini", "extensions", "study-pack");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "GEMINI.md"), "Global extension rules\n", "utf8");

  setupUx({
    homeDir,
    projectRoot: homeDir,
    resetGlobal: true,
    force: true,
    installOpenCode: false,
    installPlugins: false,
    installTuiDependencies: false,
  });
  syncToOpenCode({ projectRoot: homeDir, homeDir, rulesyncMode: "off", silent: true, force: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    plugin: [
      globalStartupPluginSpec(path.join(configDir, "plugins", "ogb-startup-sync.js")),
      "file:plugins/ogb-startup-sync.js",
    ],
    instructions: [
      path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md"),
    ],
  }, null, 2), "utf8");

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const report = runValidation({ projectRoot: homeDir, homeDir, silent: true });
    const startupCheck = report.checks.find((check) => check.name === "Global OGB startup plugin");

    assert.equal(startupCheck?.status, "fail");
    assert.match(startupCheck?.message ?? "", /file:plugins\/ogb-startup-sync\.js/);
  } finally {
    process.env.PATH = originalPath;
  }
});
