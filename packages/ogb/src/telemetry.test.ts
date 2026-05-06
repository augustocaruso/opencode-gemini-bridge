import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildTelemetryEnvelope,
  disableTelemetry,
  enableTelemetry,
  isActionableTelemetryRecord,
  previewTelemetryEnvelope,
  recordWorkflowRun,
  redactSnippet,
  sendTelemetry,
  telemetryPaths,
  telemetryStatus,
} from "./telemetry.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-telemetry-"));
}

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    const result = fn();
    if (result && typeof (result as any).finally === "function") return (result as Promise<unknown>).finally(restore) as T;
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("telemetry is disabled by default", () => {
  withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, () => {
    const homeDir = tempHome();
    const status = telemetryStatus({ homeDir });

    assert.equal(status.enabled, false);
    assert.equal(status.ready, false);
    assert.equal(status.payloadLevel, "diagnostic_redacted");
    assert.equal(status.outboxCount, 0);
  });
});

test("valid distribution defaults auto-enable telemetry", () => {
  withEnv({ OGB_TELEMETRY_CONFIG: undefined }, () => {
    const homeDir = tempHome();
    const defaultsPath = path.join(tempHome(), "telemetry.defaults.json");
    writeJson(defaultsPath, {
      enabled: true,
      endpoint_url: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      auth_token: "private-default-token",
      payload_level: "diagnostic_redacted",
      max_envelope_bytes: 262144,
    });

    withEnv({ OGB_TELEMETRY_DEFAULTS: defaultsPath }, () => {
      const status = telemetryStatus({ homeDir });

      assert.equal(status.enabled, true);
      assert.equal(status.ready, true);
      assert.equal(status.source, "distribution_default");
      assert.equal(status.defaultsPath, defaultsPath);
      assert.doesNotMatch(JSON.stringify(status), /private-default-token/);
    });
  });
});

test("disable blocks future distribution defaults for the same install", () => {
  withEnv({ OGB_TELEMETRY_CONFIG: undefined }, () => {
    const homeDir = tempHome();
    const defaultsPath = path.join(tempHome(), "telemetry.defaults.json");
    writeJson(defaultsPath, {
      enabled: true,
      endpoint_url: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      auth_token: "private-default-token",
    });

    withEnv({ OGB_TELEMETRY_DEFAULTS: defaultsPath }, () => {
      assert.equal(telemetryStatus({ homeDir }).ready, true);
      disableTelemetry({ homeDir });
      const status = telemetryStatus({ homeDir });

      assert.equal(status.enabled, false);
      assert.equal(status.ready, false);
      assert.equal(status.source, "user_disabled");
      assert.ok(status.optOutAt);
    });
  });
});

test("status and preview never expose auth token", () => {
  withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, () => {
    const homeDir = tempHome();
    enableTelemetry({
      homeDir,
      endpointUrl: "https://telemetry.example.test/v1/telemetry/workflow-runs?token=query-secret",
      authToken: "super-secret-token",
    });
    recordWorkflowRun({
      workflow: "doctor",
      status: "completed",
      projectRoot: path.join(homeDir, "project"),
      payload: {
        warnings: ["user@example.com used --token super-secret-token"],
      },
    }, { homeDir });

    const statusText = JSON.stringify(telemetryStatus({ homeDir }));
    const previewText = JSON.stringify(previewTelemetryEnvelope({ homeDir, since: "7d" }));

    assert.doesNotMatch(statusText, /super-secret-token/);
    assert.doesNotMatch(previewText, /super-secret-token/);
    assert.doesNotMatch(previewText, /user@example\.com/);
    assert.match(statusText, /\?\[redacted\]/);
  });
});

test("redactor removes emails, token flags, auth fields, query secrets, and long opaque strings", () => {
  const redacted = redactSnippet([
    "alice@example.com",
    "authorization: Bearer abc123",
    "--token very-secret",
    "https://example.test/path?token=query-secret&ok=1",
    "x".repeat(80),
  ].join(" "));

  assert.doesNotMatch(redacted, /alice@example\.com/);
  assert.doesNotMatch(redacted, /very-secret/);
  assert.doesNotMatch(redacted, /query-secret/);
  assert.doesNotMatch(redacted, new RegExp("x{40}"));
  assert.match(redacted, /\[email\]/);
  assert.match(redacted, /\[redacted-token\]/);
});

test("envelope respects max byte limit by truncating without breaking schema", () => {
  withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, () => {
    const homeDir = tempHome();
    enableTelemetry({
      homeDir,
      endpointUrl: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      authToken: "secret",
      payloadLevel: "full_logs",
    });
    const paths = telemetryPaths({ homeDir });
    const rawConfig = JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
    rawConfig.maxEnvelopeBytes = 16 * 1024;
    writeJson(paths.configPath, rawConfig);

    const records = Array.from({ length: 120 }, (_value, index) => recordWorkflowRun({
      workflow: "pass",
      status: "completed_with_warnings",
      payload: { warnings: [`large payload ${index}`], content: "a".repeat(120_000) },
      rawPayload: { content: "b".repeat(120_000) },
      snippets: [`diagnostic ${index} ${"c".repeat(2000)}`],
    }, { homeDir }));
    const envelope = buildTelemetryEnvelope(records, {
      homeDir,
      rawPayloads: Object.fromEntries(records.map((record) => [record.runId, { content: "b".repeat(120_000) }])),
    });

    assert.equal(envelope.schema, "opencode-gemini-bridge.workflow-telemetry-envelope.v1");
    assert.equal(envelope.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope), "utf8") <= 16 * 1024);
  });
});

test("diagnostic classification avoids false positives and names actionable causes", () => {
  withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, () => {
    const homeDir = tempHome();
    const currentUpdate = recordWorkflowRun({
      workflow: "auto-update",
      status: "completed",
      payload: { status: "current", message: "No restart required today." },
    }, { homeDir });
    const dashboardPass = recordWorkflowRun({
      workflow: "dashboard",
      status: "completed",
      payload: { status: "pass", nextAction: "Reinicie only appears in old prose, not structured restartRequired." },
    }, { homeDir });
    const pluginInactive = recordWorkflowRun({
      workflow: "dashboard",
      status: "completed_with_warnings",
      payload: { warnings: ["opencode-auto-fallback is enabled in OGB config, but the OpenCode plugin is not active. Run ogb sync."] },
    }, { homeDir });
    const doctorPass = recordWorkflowRun({
      workflow: "doctor",
      status: "completed",
      payload: { warnings: [], relevantPaths: ["~/opencode.jsonc", "opencode/plugins/fallback.json"] },
    }, { homeDir });
    const hookReview = recordWorkflowRun({
      workflow: "doctor",
      status: "completed",
      payload: { warnings: ["Hook needs review: BeforeTool in extension settings"] },
    }, { homeDir });
    const restart = recordWorkflowRun({
      workflow: "auto-update",
      status: "completed",
      payload: { status: "updated", restartRequired: true },
    }, { homeDir });
    const rulesyncDisabled = recordWorkflowRun({
      workflow: "sync",
      status: "completed_with_warnings",
      payload: { warnings: ["Rulesync disabled"] },
    }, { homeDir });
    const dashboardEcho = recordWorkflowRun({
      workflow: "dashboard",
      status: "completed_with_warnings",
      payload: { warnings: ["validation passou com avisos."] },
    }, { homeDir });
    const staleGenerated = recordWorkflowRun({
      workflow: "setup-opencode",
      status: "completed_with_warnings",
      payload: { warnings: ["Expanded GEMINI file was generated by ogb 0.0.34; current ogb is 0.0.49. Run ogb sync."] },
    }, { homeDir });
    const missingCommands = recordWorkflowRun({
      workflow: "setup-opencode",
      status: "completed_with_warnings",
      payload: { warnings: ["Missing built-in OpenCode commands: bridge, sync, telemetry"] },
    }, { homeDir });
    const globalMismatch = recordWorkflowRun({
      workflow: "validate",
      status: "completed_with_warnings",
      payload: {
        outcome: "warn",
        checks: [
          {
            name: "ogb global binary",
            status: "warn",
            message: "ogb resolves to /opt/homebrew/bin/ogb, but reports 0.0.42; expected 0.0.49.",
          },
        ],
      },
    }, { homeDir });

    assert.equal(currentUpdate.diagnosticContext.rootCauseCode, "no_issue_detected");
    assert.equal(dashboardPass.diagnosticContext.rootCauseCode, "no_issue_detected");
    assert.equal(pluginInactive.diagnosticContext.rootCauseCode, "plugin_inactive");
    assert.equal(doctorPass.diagnosticContext.rootCauseCode, "no_issue_detected");
    assert.equal(hookReview.diagnosticContext.rootCauseCode, "trust_review_required");
    assert.equal(restart.diagnosticContext.rootCauseCode, "restart_required");
    assert.equal(rulesyncDisabled.diagnosticContext.rootCauseCode, "rulesync_disabled");
    assert.equal(dashboardEcho.diagnosticContext.rootCauseCode, "dashboard_echo");
    assert.equal(staleGenerated.diagnosticContext.rootCauseCode, "stale_generated_files");
    assert.equal(missingCommands.diagnosticContext.rootCauseCode, "missing_builtin_commands");
    assert.equal(globalMismatch.diagnosticContext.rootCauseCode, "global_binary_mismatch");
    assert.deepEqual(globalMismatch.payloadSummary.warnings, [
      "ogb global binary: ogb resolves to /opt/homebrew/bin/ogb, but reports 0.0.42; expected 0.0.49.",
    ]);
    assert.equal(isActionableTelemetryRecord(currentUpdate), false);
    assert.equal(isActionableTelemetryRecord(rulesyncDisabled), false);
    assert.equal(isActionableTelemetryRecord(dashboardEcho), false);
    assert.equal(isActionableTelemetryRecord(pluginInactive), true);
  });
});

test("outbox preserves envelopes when endpoint fails", async () => {
  await withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, async () => {
    const homeDir = tempHome();
    enableTelemetry({
      homeDir,
      endpointUrl: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      authToken: "secret",
    });
    recordWorkflowRun({ workflow: "sync", status: "completed_with_warnings", payload: { warnings: ["Agent conflict: .opencode/agents/YOLO.md exists or was edited manually; use --force to overwrite"] } }, { homeDir });

    const result = await sendTelemetry({
      homeDir,
      since: "7d",
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => "server down" }),
    });

    assert.equal(result.ok, false);
    assert.equal(telemetryStatus({ homeDir }).outboxCount, 1);
  });
});

test("send uses Bearer token and marks runs as sent", async () => {
  await withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, async () => {
    const homeDir = tempHome();
    const seen: { authorization?: string; body?: string } = {};
    enableTelemetry({
      homeDir,
      endpointUrl: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      authToken: "bearer-secret",
    });
    recordWorkflowRun({ workflow: "doctor", status: "completed_with_warnings", payload: { warnings: ["Hook needs review: BeforeTool"] } }, { homeDir });

    const result = await sendTelemetry({
      homeDir,
      since: "7d",
      fetchImpl: async (_url, init) => {
        seen.authorization = init?.headers?.Authorization;
        seen.body = init?.body;
        return { ok: true, status: 202, text: async () => "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sent, 1);
    assert.equal(seen.authorization, "Bearer bearer-secret");
    assert.match(seen.body ?? "", /"workflow":"doctor"|\"workflow\": \"doctor\"/);
    assert.equal(telemetryStatus({ homeDir }).outboxCount, 0);
    assert.equal(telemetryStatus({ homeDir }).sentRunCount, 1);
  });
});

test("clean pass records stay local unless includePass is requested", async () => {
  await withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, async () => {
    const homeDir = tempHome();
    let calls = 0;
    enableTelemetry({
      homeDir,
      endpointUrl: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      authToken: "bearer-secret",
    });
    recordWorkflowRun({ workflow: "sync", status: "completed", payload: { status: "pass" } }, { homeDir });

    const skipped = await sendTelemetry({
      homeDir,
      since: "7d",
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 202, text: async () => "" };
      },
    });

    assert.equal(skipped.ok, true);
    assert.equal(skipped.sent, 0);
    assert.equal(calls, 0);
    assert.equal(telemetryStatus({ homeDir }).runCount, 1);

    const forced = await sendTelemetry({
      homeDir,
      since: "7d",
      includePass: true,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 202, text: async () => "" };
      },
    });

    assert.equal(forced.ok, true);
    assert.equal(forced.sent, 1);
    assert.equal(calls, 1);
  });
});

test("pass-only outbox envelopes are discarded without remote send", async () => {
  await withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1", OGB_TELEMETRY_CONFIG: undefined }, async () => {
    const homeDir = tempHome();
    let calls = 0;
    enableTelemetry({
      homeDir,
      endpointUrl: "https://telemetry.example.test/v1/telemetry/workflow-runs",
      authToken: "bearer-secret",
    });
    const record = recordWorkflowRun({ workflow: "dashboard", status: "completed", payload: { outcome: "pass" } }, { homeDir });
    const paths = telemetryPaths({ homeDir });
    fs.mkdirSync(paths.outboxDir, { recursive: true });
    fs.writeFileSync(path.join(paths.outboxDir, "old-pass.json"), JSON.stringify(buildTelemetryEnvelope([record], { homeDir })));

    const result = await sendTelemetry({
      homeDir,
      since: "7d",
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 202, text: async () => "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sent, 0);
    assert.equal(calls, 0);
    assert.equal(telemetryStatus({ homeDir }).outboxCount, 0);
    assert.equal(telemetryStatus({ homeDir }).sentRunCount, 0);
  });
});

test("CLI telemetry enable, status, preview, send, disable, and critical command recording", () => {
  withEnv({ OGB_TELEMETRY_DEFAULTS_DISABLED: "1" }, () => {
    const projectRoot = tempHome();
    const telemetryRoot = tempHome();
    const configPath = path.join(telemetryRoot, "config.json");
    const cli = path.join(process.cwd(), "src", "cli.ts");
    const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const env = { ...process.env, OGB_TELEMETRY_CONFIG: configPath };
    const run = (args: string[]) => spawnSync(process.execPath, [tsx, cli, "--project", projectRoot, ...args], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });

    const enabled = run(["telemetry", "enable", "--endpoint", "https://telemetry.example.test/v1/telemetry/workflow-runs", "--token", "cli-secret", "--json"]);
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.doesNotMatch(enabled.stdout, /cli-secret/);

    const status = run(["telemetry", "status", "--json"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /"ready": true/);
    assert.doesNotMatch(status.stdout, /cli-secret/);

    const disabled = run(["telemetry", "disable", "--json"]);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.match(disabled.stdout, /"enabled": false/);

    const doctor = run(["doctor", "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(fs.readdirSync(path.join(telemetryRoot, "runs")).filter((entry) => entry.endsWith(".json")).length, 1);

    const preview = run(["telemetry", "preview", "--since", "7d"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /"workflow": "doctor"/);

    const send = run(["telemetry", "send", "--since", "7d"]);
    assert.equal(send.status, 0, send.stderr);
    assert.match(send.stdout, /disabled or not ready/);
  });
});
