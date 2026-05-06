import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { enableTelemetry, type TelemetryPayloadLevel } from "./telemetry.js";

const DEFAULT_WORKER_NAME = "ogb-telemetry-email-worker";
const DEFAULT_PAYLOAD_LEVEL: TelemetryPayloadLevel = "diagnostic_redacted";

export interface TelemetryEmailSetupOptions {
  homeDir?: string;
  toEmail?: string;
  fromEmail?: string;
  resendApiKey?: string;
  ingestToken?: string;
  workerName?: string;
  payloadLevel?: TelemetryPayloadLevel;
  activateLocal?: boolean;
  noDistributionDefaults?: boolean;
  skipTestEmail?: boolean;
  dryRun?: boolean;
  format?: "text" | "json";
  defaultsPath?: string;
  commandRunner?: SetupCommandRunner;
  fetchImpl?: typeof fetch;
}

export interface SetupCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type SetupCommandRunner = (command: string, args: string[], options: {
  cwd: string;
  input?: string;
}) => SetupCommandResult;

export interface TelemetryEmailSetupResult {
  ok: boolean;
  workerDir: string;
  receiptPath: string;
  distributionDefaultsPath: string;
  endpointUrl: string;
  toEmail: string;
  fromEmail: string;
  workerName: string;
  payloadLevel: TelemetryPayloadLevel;
  dryRun: boolean;
  digestWindowMinutes: number;
  deployOutputExcerpt: string;
  kvNamespace?: {
    ok: boolean;
    id?: string;
    previewId?: string;
    reused?: boolean;
    fallback?: string;
    error?: string;
    nextAction?: string;
  };
  testEmail?: Record<string, unknown>;
  localActivation?: Record<string, unknown>;
}

export class TelemetrySetupError extends Error {
  nextAction: string;

  constructor(message: string, nextAction: string) {
    super(message);
    this.name = "TelemetrySetupError";
    this.nextAction = nextAction;
  }
}

function packageRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(modulePath);
  if (path.basename(moduleDir) === "dist" || path.basename(moduleDir) === "src") return path.dirname(moduleDir);
  return moduleDir;
}

function repoRootCandidate(): string {
  return path.resolve(packageRoot(), "..", "..");
}

function templateDir(): string {
  const candidates = [
    path.join(packageRoot(), "telemetry-email-worker"),
    path.join(repoRootCandidate(), "examples", "telemetry-email-worker"),
    path.join(process.cwd(), "examples", "telemetry-email-worker"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "worker.js")) && fs.existsSync(path.join(candidate, "wrangler.toml.example"))) return candidate;
  }
  throw new TelemetrySetupError("telemetry email Worker template not found", "Check examples/telemetry-email-worker or reinstall the OGB package.");
}

function stateRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "opencode-gemini-bridge");
}

function defaultDefaultsPath(): string {
  return path.join(packageRoot(), "telemetry.defaults.json");
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function looksLikeSender(value: string): boolean {
  const match = value.match(/<([^>]+)>/);
  return looksLikeEmail((match ? match[1] : value).trim());
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function defaultCommandRunner(command: string, args: string[], options: { cwd: string; input?: string }): SetupCommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout || "",
    stderr: result.stderr || (result.error ? result.error.message : ""),
  };
}

function runChecked(
  runner: SetupCommandRunner,
  command: string,
  args: string[],
  options: { cwd: string; input?: string },
): SetupCommandResult {
  const result = runner(command, args, options);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new TelemetrySetupError(
      `command failed: ${[command, ...args].join(" ")}`,
      detail.slice(-1200) || "Run `npm exec --yes wrangler login` and try again.",
    );
  }
  return result;
}

async function promptLine(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new TelemetrySetupError(`missing ${label}`, `Pass --${label.toLowerCase().replaceAll(" ", "-")}.`);
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(`${label}: `)).trim();
  } finally {
    rl.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) return promptLine(label);
  output.write(`${label}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  return await new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new TelemetrySetupError("secret prompt interrupted", "Run setup-email again when ready."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          output.write("\n");
          resolve(value.trim());
          return;
        }
        if (char === "\b" || char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

function prepareWorkerDir(workDir: string, workerName: string): void {
  const source = templateDir();
  fs.mkdirSync(workDir, { recursive: true });
  fs.copyFileSync(path.join(source, "worker.js"), path.join(workDir, "worker.js"));
  const wrangler = fs.readFileSync(path.join(source, "wrangler.toml.example"), "utf8")
    .replace(/^name = ".*"$/m, `name = "${workerName}"`);
  fs.writeFileSync(path.join(workDir, "wrangler.toml"), wrangler, "utf8");
}

function extractKvId(outputText: string): string {
  return outputText.match(/id\s*=\s*"([^"]+)"/)?.[1]
    || outputText.match(/\b([0-9a-f]{32})\b/i)?.[1]
    || "";
}

function patchKvIds(wranglerPath: string, namespaceId: string, previewId: string): void {
  const text = fs.readFileSync(wranglerPath, "utf8")
    .replaceAll("REPLACE_WITH_KV_NAMESPACE_ID", namespaceId)
    .replaceAll("REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID", previewId);
  fs.writeFileSync(wranglerPath, text, "utf8");
}

function removeKvBinding(wranglerPath: string): void {
  const text = fs.readFileSync(wranglerPath, "utf8").replace(
    /\n# Optional but recommended for digest emails[\s\S]*?\[\[kv_namespaces\]\][\s\S]*?(?=\n# Configure secrets|\Z)/,
    "\n",
  );
  fs.writeFileSync(wranglerPath, text, "utf8");
}

function parseExistingKvId(outputText: string, title: string): string {
  try {
    const namespaces = JSON.parse(outputText) as Array<{ id?: unknown; title?: unknown; name?: unknown }>;
    const match = namespaces.find((namespace) => namespace.title === title || namespace.name === title);
    return typeof match?.id === "string" ? match.id : "";
  } catch {
    return "";
  }
}

function findExistingKvNamespace(workDir: string, runner: SetupCommandRunner, title: string): string {
  const listed = runChecked(runner, npmCommand(), ["exec", "--yes", "wrangler", "kv", "namespace", "list"], { cwd: workDir });
  return parseExistingKvId(`${listed.stdout}\n${listed.stderr}`, title);
}

function configureDigestKv(workDir: string, runner: SetupCommandRunner): TelemetryEmailSetupResult["kvNamespace"] {
  try {
    let reused = false;
    let id = "";
    let previewId = "";
    try {
      const created = runChecked(runner, npmCommand(), ["exec", "--yes", "wrangler", "kv", "namespace", "create", "TELEMETRY_BUFFER"], { cwd: workDir });
      const createdPreview = runChecked(runner, npmCommand(), ["exec", "--yes", "wrangler", "kv", "namespace", "create", "TELEMETRY_BUFFER", "--preview"], { cwd: workDir });
      id = extractKvId(`${created.stdout}\n${created.stderr}`);
      previewId = extractKvId(`${createdPreview.stdout}\n${createdPreview.stderr}`) || id;
    } catch (error) {
      const detail = `${error instanceof Error ? error.message : String(error)}\n${error instanceof TelemetrySetupError ? error.nextAction : ""}`;
      if (!/already exists/i.test(detail)) throw error;
      id = findExistingKvNamespace(workDir, runner, "TELEMETRY_BUFFER");
      previewId = id;
      reused = true;
    }
    if (!id) {
      throw new TelemetrySetupError("could not detect KV namespace id", "Create a KV namespace manually, update wrangler.toml, then run wrangler deploy.");
    }
    patchKvIds(path.join(workDir, "wrangler.toml"), id, previewId);
    return { ok: true, id, previewId, reused };
  } catch (error) {
    removeKvBinding(path.join(workDir, "wrangler.toml"));
    return {
      ok: false,
      fallback: "immediate_email",
      error: error instanceof Error ? error.message : String(error),
      nextAction: error instanceof TelemetrySetupError ? error.nextAction : "Digest KV failed; Worker will send one email per envelope.",
    };
  }
}

function putSecret(workDir: string, runner: SetupCommandRunner, name: string, value: string): void {
  runChecked(runner, npmCommand(), ["exec", "--yes", "wrangler", "secret", "put", name], { cwd: workDir, input: `${value}\n` });
}

function extractWorkerUrl(outputText: string): string {
  const matches = [...outputText.matchAll(/https:\/\/[^\s]+?\.workers\.dev(?:\/[^\s]*)?/g)];
  return matches.length ? matches[matches.length - 1][0].replace(/[.,]+$/, "") : "";
}

function ensureEndpointPath(url: string): string {
  if (!url) return url;
  return url.endsWith("/v1/telemetry/workflow-runs") ? url : `${url.replace(/\/+$/, "")}/v1/telemetry/workflow-runs`;
}

async function sendTestEmail(endpointUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const envelope = {
    schema: "opencode-gemini-bridge.workflow-telemetry-envelope.v1",
    envelopeId: `setup-test-${crypto.randomBytes(8).toString("hex")}`,
    generatedAt: new Date().toISOString(),
    installId: "setup-test",
    payloadLevel: "diagnostic_redacted",
    client: {
      app: "opencode-gemini-bridge",
      source: "ogb telemetry setup-email",
    },
    records: [{
      runId: "setup-test",
      workflow: "telemetry",
      status: "completed",
      outcome: "pass",
      phase: "setup-email",
      diagnosticContext: {
        rootCauseCode: "setup_test",
        rootCauseLabel: "Telemetry receiver is configured",
        recoveryCommand: "",
      },
      payloadSummary: {
        counts: { testRecords: 1 },
        warnings: [],
        errors: [],
      },
      diagnosticSnippets: ["setup email delivery test"],
    }],
    limits: { maxEnvelopeBytes: 262144 },
    truncated: false,
  };
  const response = await fetchImpl(endpointUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelope),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new TelemetrySetupError(
      "test telemetry email failed",
      `HTTP ${response.status}: ${text.slice(0, 800)}. Check Resend sender/domain, RESEND_API_KEY, RESEND_TO and RESEND_FROM.`,
    );
  }
  try {
    return { ok: true, status: response.status, response: JSON.parse(text) };
  } catch {
    return { ok: true, status: response.status, response: text.slice(0, 500) };
  }
}

function writePrivateJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod is best effort on Windows and some mounted filesystems.
  }
}

function writeDistributionDefaults(filePath: string, endpointUrl: string, token: string, payloadLevel: TelemetryPayloadLevel): void {
  writePrivateJson(filePath, {
    schema: "opencode-gemini-bridge.telemetry-defaults.v1",
    enabled: true,
    endpoint_url: endpointUrl,
    auth_token: token,
    payload_level: payloadLevel,
    max_envelope_bytes: 262144,
  });
}

export async function setupTelemetryEmailReceiver(options: TelemetryEmailSetupOptions = {}): Promise<TelemetryEmailSetupResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const root = stateRoot(homeDir);
  const workerName = options.workerName || DEFAULT_WORKER_NAME;
  const payloadLevel = options.payloadLevel || DEFAULT_PAYLOAD_LEVEL;
  const toEmail = options.toEmail || await promptLine("Email que vai receber os reports");
  const fromEmail = options.fromEmail || await promptLine("Remetente verificado no Resend");
  const resendApiKey = options.resendApiKey || process.env.RESEND_API_KEY || await promptSecret("Resend API key");
  const ingestToken = options.ingestToken || crypto.randomBytes(32).toString("base64url");

  if (!looksLikeEmail(toEmail)) throw new TelemetrySetupError("--to-email does not look like an email", "Pass a valid email address.");
  if (!looksLikeSender(fromEmail)) throw new TelemetrySetupError("--from-email does not look valid", "Use a verified Resend sender such as telemetry@your-domain.com.");
  if (!resendApiKey) throw new TelemetrySetupError("missing Resend API key", "Create a Resend API key and pass it through the prompt or --resend-api-key.");
  if (!ingestToken) throw new TelemetrySetupError("missing ingest token", "Omit --ingest-token to generate one automatically.");

  const workDir = path.join(root, "telemetry-email-worker");
  const receiptPath = path.join(root, "telemetry-receiver.json");
  const defaultsPath = path.resolve(options.defaultsPath || defaultDefaultsPath());
  prepareWorkerDir(workDir, workerName);

  let endpointUrl = "";
  let deployOutput = "";
  let kvNamespace: TelemetryEmailSetupResult["kvNamespace"];
  const runner = options.commandRunner || defaultCommandRunner;

  if (options.dryRun) {
    endpointUrl = `https://${workerName}.<your-workers-subdomain>.workers.dev/v1/telemetry/workflow-runs`;
  } else {
    kvNamespace = configureDigestKv(workDir, runner);
    putSecret(workDir, runner, "OGB_TELEMETRY_TOKEN", ingestToken);
    putSecret(workDir, runner, "RESEND_API_KEY", resendApiKey);
    putSecret(workDir, runner, "RESEND_TO", toEmail);
    putSecret(workDir, runner, "RESEND_FROM", fromEmail);
    const deploy = runChecked(runner, npmCommand(), ["exec", "--yes", "wrangler", "deploy"], { cwd: workDir });
    deployOutput = `${deploy.stdout}\n${deploy.stderr}`;
    endpointUrl = ensureEndpointPath(extractWorkerUrl(deployOutput));
    if (!endpointUrl) {
      throw new TelemetrySetupError(
        "could not detect Worker URL from wrangler deploy output",
        "Open the Cloudflare Workers dashboard, copy the worker URL, then run `ogb telemetry enable` with that endpoint.",
      );
    }
  }

  const result: TelemetryEmailSetupResult = {
    ok: true,
    workerDir: workDir,
    receiptPath,
    distributionDefaultsPath: defaultsPath,
    endpointUrl,
    toEmail,
    fromEmail,
    workerName,
    payloadLevel,
    dryRun: Boolean(options.dryRun),
    digestWindowMinutes: 15,
    deployOutputExcerpt: deployOutput.slice(-1200),
    kvNamespace,
  };

  if (!options.dryRun) {
    if (!options.skipTestEmail) result.testEmail = await sendTestEmail(endpointUrl, ingestToken, options.fetchImpl);
    writePrivateJson(receiptPath, {
      ...result,
      ingestToken,
      resendApiKeyStoredInCloudflareOnly: true,
    });
    if (!options.noDistributionDefaults) writeDistributionDefaults(defaultsPath, endpointUrl, ingestToken, payloadLevel);
    if (options.activateLocal) {
      result.localActivation = enableTelemetry({
        homeDir,
        endpointUrl,
        authToken: ingestToken,
        payloadLevel,
      }) as unknown as Record<string, unknown>;
    }
  }

  return result;
}

export function formatTelemetryEmailSetupResult(result: TelemetryEmailSetupResult): string {
  const lines = [
    "Telemetria por email configurada.",
    "",
    `Endpoint: ${result.endpointUrl}`,
    `Reports chegam em: ${result.toEmail}`,
    `Remetente: ${result.fromEmail}`,
    `Worker local: ${result.workerDir}`,
    `Recibo local: ${result.receiptPath}`,
    `Defaults para build privado: ${result.distributionDefaultsPath}`,
    `Digest: ${result.kvNamespace?.ok === false ? "fallback email imediato" : `${result.digestWindowMinutes} min`}`,
  ];
  if (result.dryRun) lines.splice(1, 0, "DRY RUN: nada foi enviado ao Cloudflare.");
  if (result.localActivation) lines.push("", "Esta instalacao local ja foi ativada.");
  if (!result.dryRun) lines.push("", "O token de ingestao ficou salvo no recibo local e nos defaults privados; ele nao foi impresso aqui.");
  return `${lines.join("\n")}\n`;
}
