import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.js";
import { formatPassReport, runPass, type PassReport } from "./pass.js";

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

test("formatPassReport prints a compact human report", () => {
  const projectRoot = "/tmp/project";
  const report: PassReport = {
    version: "0.0.40",
    projectRoot,
    outcome: "warn",
    automated: ["setup-opencode", "sync", "doctor", "validate", "dashboard"],
    steps: [
      { name: "setup-opencode", status: "pass" },
      { name: "sync", status: "pass" },
      { name: "doctor", status: "warn", detail: "1 warning(s)" },
      { name: "validate", status: "warn", detail: "warn" },
      { name: "dashboard", status: "warn", detail: "warn" },
    ],
    acceptedHooks: [],
    blockers: [
      {
        source: "doctor",
        severity: "warn",
        message: "opencode-auto-fallback is enabled in OGB config, but the OpenCode plugin is not active; disable externalPlugins.autoFallback or install a compatible plugin version.",
        action: "Desative `externalPlugins.autoFallback` em `.opencode/ogb.config.jsonc`.",
      },
    ],
    sync: {
      generatedConfigPath: "/tmp/project/.opencode/generated/opencode.generated.json",
      builtInAgents: 1,
      extensionAgents: 6,
      builtInCommands: 11,
      extensionCommands: 14,
      skills: 11,
      tuiFiles: 0,
      externalIntegrationFiles: 1,
      rulesyncStatus: "applied",
      rulesyncPromoted: 0,
    },
    doctor: { warnings: 1, errors: 0 },
    validation: { outcome: "warn" },
    dashboard: { outcome: "warn" },
    files: {
      pass: "/tmp/project/.opencode/generated/ogb-pass.json",
      doctor: "/tmp/project/.opencode/generated/ogb-doctor.json",
      dashboard: "/tmp/project/.opencode/generated/ogb-dashboard.md",
    },
  };

  const text = formatPassReport(report);

  assert.match(text, /^OGB pass  WARN/m);
  assert.match(text, /Checks\n  OK    setup-opencode/);
  assert.match(text, /Needs Attention/);
  assert.match(text, /Auto fallback esta ligado, mas o plugin externo nao carregou\./);
  assert.match(text, /report:    \.opencode\/generated\/ogb-pass\.json/);
  assert.doesNotMatch(text, /Automacao|Pendencias|Relatorio/);
});
