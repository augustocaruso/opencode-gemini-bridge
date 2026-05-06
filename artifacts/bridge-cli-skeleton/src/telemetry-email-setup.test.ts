import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setupTelemetryEmailReceiver, type SetupCommandRunner } from "./telemetry-email-setup.js";
import { telemetryStatus } from "./telemetry.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-telemetry-email-"));
}

test("setupTelemetryEmailReceiver configures Worker, receipt, defaults and local activation", async () => {
  const homeDir = tempHome();
  const defaultsPath = path.join(tempHome(), "telemetry.defaults.json");
  const secrets: Record<string, string> = {};
  const commands: string[][] = [];
  const runner: SetupCommandRunner = (_command, args, options) => {
    commands.push(args);
    const joined = args.join(" ");
    if (joined.includes("kv namespace create TELEMETRY_BUFFER --preview")) {
      return { status: 0, stdout: 'id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"\n', stderr: "" };
    }
    if (joined.includes("kv namespace create TELEMETRY_BUFFER")) {
      return { status: 0, stdout: 'id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n', stderr: "" };
    }
    if (joined.includes("secret put")) {
      secrets[String(args.at(-1))] = String(options.input || "").trim();
      return { status: 0, stdout: "", stderr: "" };
    }
    if (joined.includes("wrangler deploy")) {
      return { status: 0, stdout: "Published ogb\nhttps://ogb-telemetry-email-worker.example.workers.dev\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const result = await setupTelemetryEmailReceiver({
    homeDir,
    toEmail: "maintainer@example.test",
    fromEmail: "OGB <telemetry@example.test>",
    resendApiKey: "resend-secret",
    ingestToken: "ingest-secret",
    defaultsPath,
    activateLocal: true,
    commandRunner: runner,
    fetchImpl: async (_url, init) => {
      assert.equal(init?.headers?.Authorization, "Bearer ingest-secret");
      return new Response('{"ok":true}', { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.endpointUrl, "https://ogb-telemetry-email-worker.example.workers.dev/v1/telemetry/workflow-runs");
  assert.equal(result.kvNamespace?.id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(secrets.OGB_TELEMETRY_TOKEN, "ingest-secret");
  assert.equal(secrets.RESEND_API_KEY, "resend-secret");
  assert.equal(fs.existsSync(path.join(result.workerDir, "worker.js")), true);
  assert.equal(fs.existsSync(path.join(result.workerDir, "wrangler.toml")), true);
  assert.equal(fs.existsSync(result.receiptPath), true);
  assert.equal(fs.existsSync(defaultsPath), true);
  assert.equal(telemetryStatus({ homeDir }).ready, true);
  const previousDefaults = process.env.OGB_TELEMETRY_DEFAULTS;
  process.env.OGB_TELEMETRY_DEFAULTS = defaultsPath;
  try {
    const freshStatus = telemetryStatus({ homeDir: tempHome() });
    assert.equal(freshStatus.ready, true);
    assert.equal(freshStatus.source, "distribution_default");
  } finally {
    if (previousDefaults === undefined) delete process.env.OGB_TELEMETRY_DEFAULTS;
    else process.env.OGB_TELEMETRY_DEFAULTS = previousDefaults;
  }
  assert.doesNotMatch(JSON.stringify(result), /ingest-secret|resend-secret/);
  assert.ok(commands.some((args) => args.join(" ").includes("wrangler deploy")));
});

test("setupTelemetryEmailReceiver reuses an existing digest KV namespace", async () => {
  const homeDir = tempHome();
  const defaultsPath = path.join(tempHome(), "telemetry.defaults.json");
  const runner: SetupCommandRunner = (_command, args, _options) => {
    const joined = args.join(" ");
    if (joined.includes("kv namespace create TELEMETRY_BUFFER")) {
      return { status: 1, stdout: "", stderr: 'A KV namespace with the title "TELEMETRY_BUFFER" already exists.' };
    }
    if (joined.includes("kv namespace list")) {
      return { status: 0, stdout: JSON.stringify([{ id: "cccccccccccccccccccccccccccccccc", title: "TELEMETRY_BUFFER" }]), stderr: "" };
    }
    if (joined.includes("secret put")) return { status: 0, stdout: "", stderr: "" };
    if (joined.includes("wrangler deploy")) {
      return { status: 0, stdout: "Uploaded ogb\nhttps://ogb-telemetry-email-worker.example.workers.dev\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  const result = await setupTelemetryEmailReceiver({
    homeDir,
    toEmail: "maintainer@example.test",
    fromEmail: "OGB <telemetry@example.test>",
    resendApiKey: "resend-secret",
    ingestToken: "ingest-secret",
    defaultsPath,
    skipTestEmail: true,
    commandRunner: runner,
  });

  assert.equal(result.kvNamespace?.ok, true);
  assert.equal(result.kvNamespace?.reused, true);
  assert.equal(result.kvNamespace?.id, "cccccccccccccccccccccccccccccccc");
  assert.match(fs.readFileSync(path.join(result.workerDir, "wrangler.toml"), "utf8"), /cccccccccccccccccccccccccccccccc/);
});

test("CLI telemetry setup-email dry-run prepares local worker without printing secrets", () => {
  const projectRoot = tempHome();
  const homeDir = tempHome();
  const cli = path.join(process.cwd(), "src", "cli.ts");
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsx, cli, "--project", projectRoot, "telemetry", "setup-email",
    "--to-email", "maintainer@example.test",
    "--from-email", "telemetry@example.test",
    "--resend-api-key", "resend-secret",
    "--ingest-token", "ingest-secret",
    "--dry-run",
    "--json",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: homeDir },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ogb-telemetry-email-worker/);
  assert.doesNotMatch(result.stdout, /resend-secret|ingest-secret/);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "telemetry-email-worker", "worker.js")), true);
});
