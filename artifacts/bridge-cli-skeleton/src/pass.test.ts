import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.js";
import { runPass } from "./pass.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-pass-"));
}

function writeHookSettings(projectRoot: string): void {
  fs.mkdirSync(path.join(projectRoot, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{ command: "echo ok" }],
    },
  }, null, 2), "utf8");
}

test("runPass can accept reviewed Gemini hooks and produce a clean doctor", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  writeHookSettings(projectRoot);

  const report = runPass({
    projectRoot,
    homeDir: projectRoot,
    acceptHooks: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });
  const doctor = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(report.outcome, "pass");
  assert.equal(report.acceptedHooks.length, 1);
  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), false);
  process.exitCode = oldExitCode;
});

test("trusted Gemini hooks require review again after settings change", () => {
  const projectRoot = tempRoot();
  const oldExitCode = process.exitCode;
  writeHookSettings(projectRoot);
  runPass({
    projectRoot,
    homeDir: projectRoot,
    acceptHooks: true,
    skipValidation: true,
    skipSecurity: true,
    skipDashboard: true,
  });

  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    hooks: {
      BeforeTool: [{ command: "echo changed" }],
    },
  }, null, 2), "utf8");

  const doctor = runDoctor({ projectRoot, homeDir: projectRoot, silent: true });

  assert.equal(doctor.warnings.some((warning) => warning.startsWith("Hook needs review:")), true);
  process.exitCode = oldExitCode;
});
