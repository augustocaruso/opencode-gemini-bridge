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
