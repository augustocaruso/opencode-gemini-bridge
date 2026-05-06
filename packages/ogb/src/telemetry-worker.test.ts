import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const workerUrl = pathToFileURL(path.resolve(process.cwd(), "telemetry-email-worker", "worker.js")).href;

class MemoryKv {
  private store = new Map<string, string>();

  get size(): number {
    return this.store.size;
  }

  async get(key: string, type?: string): Promise<any> {
    const value = this.store.get(key) ?? null;
    if (type === "json" && value) return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options: { prefix?: string } = {}): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }> {
    const prefix = options.prefix || "";
    return {
      keys: [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort().map((name) => ({ name })),
      list_complete: true,
    };
  }
}

async function loadWorker(): Promise<any> {
  const mod = await import(workerUrl);
  return mod.default;
}

function envelope(records: Array<Record<string, unknown>> = [actionableRecord()]) {
  return {
    schema: "opencode-gemini-bridge.workflow-telemetry-envelope.v1",
    envelopeId: "env-1",
    generatedAt: "2026-05-06T12:00:00.000Z",
    installId: "install-1",
    payloadLevel: "diagnostic_redacted",
    client: { app: "opencode-gemini-bridge" },
    limits: { maxEnvelopeBytes: 262144 },
    truncated: false,
    records,
  };
}

function actionableRecord(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    workflow: "dashboard",
    status: "completed_with_warnings",
    outcome: "warn",
    recordedAt: "2026-05-06T12:00:00.000Z",
    diagnosticContext: {
      rootCauseCode: "plugin_inactive",
      rootCauseLabel: "Plugin OpenCode configurado mas inativo",
      recoveryCommand: "Rode ogb sync e reinicie o OpenCode se o aviso continuar.",
    },
    payloadSummary: {
      warnings: ["opencode-auto-fallback is enabled in OGB config, but the OpenCode plugin is not active."],
      errors: [],
    },
    ...overrides,
  };
}

function cleanRecord(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-clean",
    workflow: "sync",
    status: "completed",
    outcome: "pass",
    recordedAt: "2026-05-06T12:00:00.000Z",
    diagnosticContext: {
      rootCauseCode: "no_issue_detected",
      rootCauseLabel: "Nenhum problema detectado",
    },
    payloadSummary: { warnings: [], errors: [] },
    ...overrides,
  };
}

function legacyGenericWarningRecord(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-legacy-warning",
    workflow: "sync",
    status: "completed_with_warnings",
    outcome: "warn",
    recordedAt: "2026-05-06T12:00:00.000Z",
    diagnosticContext: {
      rootCauseCode: "workflow_warn",
      rootCauseLabel: "Workflow OGB terminou com avisos",
      recoveryCommand: "Rode ogb bridge para ver os proximos passos.",
    },
    payloadSummary: {
      warnings: ["Rulesync disabled"],
      errors: [],
    },
    ...overrides,
  };
}

function request(pathname: string, options: RequestInit = {}): Request {
  return new Request(`https://worker.example.test${pathname}`, options);
}

test("telemetry email worker health check", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(request("/health"), {});
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.schema, "opencode-gemini-bridge.workflow-telemetry-envelope.v1");
});

test("telemetry email worker rejects missing bearer token", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
    method: "POST",
    body: JSON.stringify(envelope()),
  }), { OGB_TELEMETRY_TOKEN: "secret" });

  assert.equal(response.status, 401);
});

test("telemetry email worker rejects invalid schema", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify({ schema: "wrong", records: [] }),
  }), { OGB_TELEMETRY_TOKEN: "secret" });
  const body = await response.json() as any;

  assert.equal(response.status, 400);
  assert.equal(body.error, "unsupported_schema");
});

test("telemetry email worker accepts an OGB envelope", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify(envelope()),
  }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.accepted, 1);
  assert.equal(body.actionable, 1);
  assert.equal(body.queued, true);
  assert.match(body.bufferKey, /^pending:/);
  assert.equal(kv.size, 1);
});

test("telemetry email worker accepts clean pass without queueing email", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify(envelope([cleanRecord()])),
  }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.accepted, 1);
  assert.equal(body.actionable, 0);
  assert.equal(body.queued, false);
  assert.equal(body.reason, "no_actionable_records");
  assert.equal(kv.size, 0);
});

test("telemetry email worker suppresses old generic rulesync-disabled warnings", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify(envelope([legacyGenericWarningRecord()])),
  }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.accepted, 1);
  assert.equal(body.actionable, 0);
  assert.equal(body.queued, false);
  assert.equal(body.reason, "no_actionable_records");
  assert.equal(kv.size, 0);
});

test("telemetry email worker sends immediate email without KV", async () => {
  const worker = await loadWorker();
  const previousFetch = globalThis.fetch;
  const sent: Array<any> = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response('{"id":"email_1"}', { status: 200 });
  }) as typeof fetch;
  try {
    const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify(envelope()),
    }), {
      OGB_TELEMETRY_TOKEN: "secret",
      RESEND_API_KEY: "resend-secret",
      RESEND_FROM: "ogb@example.test",
      RESEND_TO: "maintainer@example.test",
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.queued, false);
    assert.equal(body.actionable, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /\[OGB\]\[medium\] 1 issue\(s\): Plugin OpenCode configurado mas inativo/);
    assert.doesNotMatch(sent[0].text, /Envelope JSON/);
    assert.doesNotMatch(sent[0].text, /"schema"/);
    assert.doesNotMatch(sent[0].html, /<pre/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telemetry email worker upgrades old generic warnings to specific causes", async () => {
  const worker = await loadWorker();
  const previousFetch = globalThis.fetch;
  const sent: Array<any> = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response('{"id":"email_1"}', { status: 200 });
  }) as typeof fetch;
  try {
    const response = await worker.fetch(request("/v1/telemetry/workflow-runs", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify(envelope([
        legacyGenericWarningRecord({
          workflow: "setup-opencode",
          payloadSummary: {
            warnings: ["Expanded GEMINI file was generated by ogb 0.0.34; current ogb is 0.0.51. Run ogb sync."],
            errors: [],
          },
        }),
      ])),
    }), {
      OGB_TELEMETRY_TOKEN: "secret",
      RESEND_API_KEY: "resend-secret",
      RESEND_FROM: "ogb@example.test",
      RESEND_TO: "maintainer@example.test",
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.actionable, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Arquivos gerados estao desatualizados/);
    assert.match(sent[0].text, /Cause: stale_generated_files/);
    assert.doesNotMatch(sent[0].subject, /Workflow OGB terminou com avisos/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telemetry email worker does not send an empty digest", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(request("/v1/telemetry/digest/send", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: new MemoryKv() });
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.sent, false);
  assert.equal(body.reason, "empty_digest");
});

test("telemetry email worker keeps digest buffer when Resend fails", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("resend down", { status: 500 })) as typeof fetch;
  try {
    await worker.fetch(request("/v1/telemetry/workflow-runs", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify(envelope()),
    }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });

    const response = await worker.fetch(request("/v1/telemetry/digest/send", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    }), {
      OGB_TELEMETRY_TOKEN: "secret",
      TELEMETRY_BUFFER: kv,
      RESEND_API_KEY: "resend-secret",
      RESEND_FROM: "ogb@example.test",
      RESEND_TO: "maintainer@example.test",
    });
    const body = await response.json() as any;

    assert.equal(response.status, 502);
    assert.equal(body.sent, false);
    assert.equal(kv.size, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telemetry email worker drops pass-only digest entries", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  await kv.put("pending:clean", JSON.stringify(envelope([cleanRecord()])));

  const response = await worker.fetch(request("/v1/telemetry/digest/send", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  }), {
    OGB_TELEMETRY_TOKEN: "secret",
    TELEMETRY_BUFFER: kv,
    RESEND_API_KEY: "resend-secret",
    RESEND_FROM: "ogb@example.test",
    RESEND_TO: "maintainer@example.test",
  });
  const body = await response.json() as any;

  assert.equal(response.status, 200);
  assert.equal(body.sent, false);
  assert.equal(body.reason, "no_actionable_records");
  assert.equal(kv.size, 0);
});

test("telemetry email worker scheduled digest sends and clears KV", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const previousFetch = globalThis.fetch;
  const sent: Array<any> = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response('{"id":"email_1"}', { status: 200 });
  }) as typeof fetch;
  try {
    await worker.fetch(request("/v1/telemetry/workflow-runs", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify(envelope()),
    }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });

    const pending: Promise<unknown>[] = [];
    await worker.scheduled({}, {
      OGB_TELEMETRY_TOKEN: "secret",
      TELEMETRY_BUFFER: kv,
      RESEND_API_KEY: "resend-secret",
      RESEND_FROM: "ogb@example.test",
      RESEND_TO: "maintainer@example.test",
    }, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);

    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /\[OGB\]\[digest\]\[medium\] 1 issue\(s\): Plugin OpenCode configurado mas inativo/);
    assert.equal(kv.size, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telemetry email worker groups repeated fingerprints in digest subject and body", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const previousFetch = globalThis.fetch;
  const sent: Array<any> = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response('{"id":"email_1"}', { status: 200 });
  }) as typeof fetch;
  try {
    await worker.fetch(request("/v1/telemetry/workflow-runs", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify(envelope([
        cleanRecord(),
        actionableRecord({ runId: "run-1", recordedAt: "2026-05-06T12:00:00.000Z" }),
        actionableRecord({ runId: "run-2", recordedAt: "2026-05-06T12:05:00.000Z" }),
      ])),
    }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });

    const response = await worker.fetch(request("/v1/telemetry/digest/send", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    }), {
      OGB_TELEMETRY_TOKEN: "secret",
      TELEMETRY_BUFFER: kv,
      RESEND_API_KEY: "resend-secret",
      RESEND_FROM: "ogb@example.test",
      RESEND_TO: "maintainer@example.test",
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.sent, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /\[OGB\]\[digest\]\[medium\] 1 issue\(s\): Plugin OpenCode configurado mas inativo/);
    assert.match(sent[0].text, /2x \[medium\] Plugin OpenCode configurado mas inativo/);
    assert.doesNotMatch(sent[0].text, /sync: pass/);
    assert.doesNotMatch(sent[0].text, /Envelope JSON/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telemetry email worker groups restart-required across workflows", async () => {
  const worker = await loadWorker();
  const kv = new MemoryKv();
  const previousFetch = globalThis.fetch;
  const sent: Array<any> = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response('{"id":"email_1"}', { status: 200 });
  }) as typeof fetch;
  try {
    const restartDiagnostic = {
      rootCauseCode: "restart_required",
      rootCauseLabel: "OpenCode precisa reiniciar para carregar mudancas",
      recoveryCommand: "Reinicie o OpenCode e rode /bridge novamente.",
    };
    await worker.fetch(request("/v1/telemetry/workflow-runs", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify(envelope([
        actionableRecord({
          runId: "run-restart-auto",
          workflow: "auto-update",
          status: "completed",
          outcome: "pass",
          recordedAt: "2026-05-06T12:00:00.000Z",
          diagnosticContext: restartDiagnostic,
          payloadSummary: { warnings: ["Update applied; restart required."], errors: [] },
        }),
        actionableRecord({
          runId: "run-restart-dashboard",
          workflow: "dashboard",
          status: "completed_with_warnings",
          outcome: "warn",
          recordedAt: "2026-05-06T12:01:00.000Z",
          diagnosticContext: restartDiagnostic,
          payloadSummary: { warnings: ["OGB foi atualizado automaticamente; reinicie o OpenCode."], errors: [] },
        }),
      ])),
    }), { OGB_TELEMETRY_TOKEN: "secret", TELEMETRY_BUFFER: kv });

    const response = await worker.fetch(request("/v1/telemetry/digest/send", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    }), {
      OGB_TELEMETRY_TOKEN: "secret",
      TELEMETRY_BUFFER: kv,
      RESEND_API_KEY: "resend-secret",
      RESEND_FROM: "ogb@example.test",
      RESEND_TO: "maintainer@example.test",
    });

    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /\[OGB\]\[digest\]\[medium\] 1 issue\(s\): OpenCode precisa reiniciar para carregar mudancas/);
    assert.match(sent[0].text, /2x \[medium\] OpenCode precisa reiniciar para carregar mudancas/);
    assert.match(sent[0].text, /Cause: restart_required/);
    assert.match(sent[0].text, /Workflows: auto-update, dashboard/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
