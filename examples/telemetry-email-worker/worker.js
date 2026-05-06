const OGB_ENVELOPE_SCHEMA = "opencode-gemini-bridge.workflow-telemetry-envelope.v1";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const BUFFER_PREFIX = "pending:";
const DEFAULT_DIGEST_WINDOW_MINUTES = 15;
const DEFAULT_DIGEST_MAX_RECORDS = 100;

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function text(value, status = 200) {
  return new Response(value, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function requireBearer(request, env) {
  const expected = env.OGB_TELEMETRY_TOKEN || env.INGEST_TOKEN || env.TELEMETRY_TOKEN || "";
  const header = request.headers.get("authorization") || "";
  if (!expected) return { ok: false, response: json({ error: "worker_token_not_configured" }, 500) };
  if (header !== `Bearer ${expected}`) return { ok: false, response: json({ error: "unauthorized" }, 401) };
  return { ok: true };
}

async function readJsonBody(request, env) {
  const maxBytes = Number(env.MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  const textBody = await request.text();
  if (new TextEncoder().encode(textBody).byteLength > maxBytes) {
    return { ok: false, response: json({ error: "body_too_large" }, 413) };
  }
  try {
    return { ok: true, body: JSON.parse(textBody) };
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
}

function validateEnvelope(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body_must_be_object";
  if (body.schema !== OGB_ENVELOPE_SCHEMA) return "unsupported_schema";
  if (!Array.isArray(body.records)) return "records_must_be_array";
  if (typeof body.installId !== "string" || !body.installId) return "install_id_required";
  if (typeof body.generatedAt !== "string") return "generated_at_required";
  for (const record of body.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return "record_must_be_object";
    if (typeof record.runId !== "string" || !record.runId) return "record_run_id_required";
    if (typeof record.workflow !== "string" || !record.workflow) return "record_workflow_required";
  }
  return "";
}

function envelopeId(envelope) {
  return envelope.envelopeId || envelope.envelope_id || "";
}

function generatedAt(envelope) {
  return envelope.generatedAt || envelope.generated_at || "";
}

function installId(envelope) {
  return envelope.installId || envelope.install_id || "";
}

function payloadLevel(envelope) {
  return envelope.payloadLevel || envelope.payload_level || "unknown";
}

function runId(record) {
  return record.runId || record.run_id || "";
}

function recordedAt(record) {
  return record.recordedAt || record.recorded_at || "";
}

function compactRecord(record) {
  const diagnostic = record.diagnosticContext || record.diagnostic_context || {};
  const summary = record.payloadSummary || record.payload_summary || {};
  return {
    runId: runId(record),
    workflow: record.workflow,
    outcome: record.outcome || record.status || "unknown",
    status: record.status || "unknown",
    phase: record.phase || "",
    recordedAt: recordedAt(record),
    durationMs: Number(record.durationMs || 0),
    exitCode: Number(record.exitCode || 0),
    rootCauseCode: diagnostic.rootCauseCode || "",
    rootCauseLabel: diagnostic.rootCauseLabel || "",
    recoveryCommand: diagnostic.recoveryCommand || "",
    warnings: Array.isArray(summary.warnings) ? summary.warnings.slice(0, 5) : [],
    errors: Array.isArray(summary.errors) ? summary.errors.slice(0, 5) : [],
  };
}

function telemetryBuffer(env) {
  return env.TELEMETRY_BUFFER || env.TELEMETRY_KV;
}

function hasTelemetryBuffer(env) {
  const buffer = telemetryBuffer(env);
  return Boolean(buffer && typeof buffer.put === "function" && typeof buffer.list === "function");
}

async function appendEnvelope(env, envelope) {
  const buffer = telemetryBuffer(env);
  if (!hasTelemetryBuffer(env)) return "";
  const id = envelopeId(envelope) || cryptoRandomId();
  const key = `${BUFFER_PREFIX}${Date.now()}:${id}`;
  await buffer.put(key, JSON.stringify({
    ...envelope,
    bufferedAt: new Date().toISOString(),
  }));
  return key;
}

async function readBufferedEnvelopes(env) {
  const buffer = telemetryBuffer(env);
  if (!hasTelemetryBuffer(env)) return [];
  const maxRecords = digestMaxRecords(env);
  const entries = [];
  let recordCount = 0;
  let cursor;
  do {
    const page = await buffer.list({ prefix: BUFFER_PREFIX, cursor, limit: 100 });
    for (const item of page.keys || []) {
      const key = item.name || item;
      const raw = await buffer.get(key, "json");
      let envelope = raw;
      if (typeof raw === "string") {
        try {
          envelope = JSON.parse(raw);
        } catch {
          envelope = undefined;
        }
      }
      if (!envelope || !Array.isArray(envelope.records)) {
        if (typeof buffer.delete === "function") await buffer.delete(key);
        continue;
      }
      const nextCount = recordCount + envelope.records.length;
      if (entries.length && nextCount > maxRecords) return entries;
      entries.push({ key, envelope });
      recordCount = nextCount;
      if (recordCount >= maxRecords) return entries;
    }
    cursor = page.cursor;
    if (page.list_complete !== false) break;
  } while (cursor);
  return entries;
}

function buildDigestEnvelope(entries, env, reason) {
  const envelopes = entries.map((entry) => entry.envelope);
  const records = [];
  for (const envelope of envelopes) {
    for (const record of envelope.records || []) {
      records.push({
        ...record,
        installId: record.installId || record.install_id || installId(envelope),
        sourceEnvelopeId: envelopeId(envelope),
      });
    }
  }
  const first = envelopes[0] || {};
  return {
    schema: first.schema || OGB_ENVELOPE_SCHEMA,
    envelopeId: `digest-${cryptoRandomId()}`,
    generatedAt: new Date().toISOString(),
    digest: true,
    digestReason: reason,
    digestWindowMinutes: digestWindowMinutes(env),
    sourceEnvelopeCount: envelopes.length,
    installIds: [...new Set(envelopes.map((envelope) => installId(envelope)).filter(Boolean))],
    payloadLevels: Object.fromEntries(countBy(envelopes, (envelope) => payloadLevel(envelope))),
    installId: installId(first) || "digest",
    payloadLevel: payloadLevel(first),
    client: {
      ...(first.client || {}),
      app: first.client?.app || "opencode-gemini-bridge",
    },
    records,
    limits: {
      maxDigestRecords: digestMaxRecords(env),
      maxBodyBytes: Number(env.MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES),
    },
    truncated: envelopes.some((envelope) => envelope.truncated),
  };
}

function digestText(records) {
  const lines = [
    "OGB telemetry digest",
    "",
    `Runs: ${records.length}`,
    "",
  ];
  for (const record of records.slice(0, 80)) {
    lines.push(`- ${record.workflow}: ${record.outcome} (${record.status})`);
    if (record.rootCauseLabel) lines.push(`  Cause: ${record.rootCauseLabel}`);
    if (record.recoveryCommand) lines.push(`  Next: ${record.recoveryCommand}`);
    for (const warning of record.warnings || []) lines.push(`  Warning: ${warning}`);
    for (const error of record.errors || []) lines.push(`  Error: ${error}`);
  }
  if (records.length > 80) lines.push("", `...${records.length - 80} more run(s) omitted from this email.`);
  return lines.join("\n");
}

function digestHtml(envelope, records) {
  const rows = records.slice(0, 80).map((record) => (
    `<tr><td>${escapeHtml(record.workflow)}</td><td>${escapeHtml(record.outcome)}</td><td>${escapeHtml(record.status)}</td><td>${escapeHtml(record.rootCauseLabel || "")}</td></tr>`
  )).join("");
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; color: #1f2937;">
    <h2>OGB telemetry${envelope.digest ? " digest" : ""}</h2>
    <p><strong>Runs:</strong> ${records.length}</p>
    <p><strong>Generated:</strong> ${escapeHtml(generatedAt(envelope))}</p>
    <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse;">
      <thead><tr><th>Workflow</th><th>Outcome</th><th>Status</th><th>Cause</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <pre style="white-space: pre-wrap; background: #f3f4f6; padding: 12px;">${escapeHtml(JSON.stringify(sanitizeForEmail(envelope), null, 2)).slice(0, 50000)}</pre>
  </body>
</html>`;
}

function renderEmail(envelope) {
  const safeEnvelope = sanitizeForEmail(envelope);
  const records = (safeEnvelope.records || []).map(compactRecord);
  const failed = records.filter((record) => record.outcome === "fail" || record.status === "failed").length;
  const warned = records.filter((record) => record.outcome === "warn" || record.status === "completed_with_warnings").length;
  const severity = failed > 0 ? "high" : warned > 0 ? "medium" : "low";
  const digestLabel = safeEnvelope.digest ? "[digest]" : "";
  const focus = records[0]?.workflow || "workflow";
  return {
    subject: `[OGB]${digestLabel}[${severity}] ${records.length} run(s): ${focus}`.slice(0, 180),
    text: `${digestText(records)}\n\nEnvelope JSON\n\n${JSON.stringify(safeEnvelope, null, 2)}`,
    html: digestHtml(safeEnvelope, records),
  };
}

async function sendResendEmail(env, email) {
  const apiKey = env.RESEND_API_KEY || "";
  const from = env.RESEND_FROM || env.FROM_EMAIL || "";
  const to = env.RESEND_TO || env.TO_EMAIL || "";
  if (!apiKey || !from || !to) throw new Error("resend_not_configured");

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: to.split(",").map((item) => item.trim()).filter(Boolean),
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `resend_http_${response.status}`);
  }
}

async function acceptWorkflowRuns(request, env) {
  const auth = requireBearer(request, env);
  if (!auth.ok) return auth.response;
  const parsed = await readJsonBody(request, env);
  if (!parsed.ok) return parsed.response;
  const error = validateEnvelope(parsed.body);
  if (error) return json({ error }, 400);

  if (hasTelemetryBuffer(env)) {
    const key = await appendEnvelope(env, parsed.body);
    return json({
      ok: true,
      queued: true,
      accepted: parsed.body.records.length,
      bufferKey: key,
      digestWindowMinutes: digestWindowMinutes(env),
      schema: OGB_ENVELOPE_SCHEMA,
    });
  }

  const email = renderEmail(parsed.body);
  await sendResendEmail(env, email);
  return json({
    ok: true,
    queued: false,
    accepted: parsed.body.records.length,
    subject: email.subject,
    schema: OGB_ENVELOPE_SCHEMA,
  });
}

async function flushDigest(env, reason = "manual") {
  if (!hasTelemetryBuffer(env)) return { ok: true, sent: false, reason: "telemetry_buffer_not_configured" };
  const entries = await readBufferedEnvelopes(env);
  if (entries.length === 0) return { ok: true, sent: false, reason: "empty_digest", records: 0 };
  const digestEnvelope = buildDigestEnvelope(entries, env, reason);
  const email = renderEmail(digestEnvelope);

  try {
    await sendResendEmail(env, email);
    const buffer = telemetryBuffer(env);
    if (typeof buffer.delete === "function") {
      await Promise.all(entries.map((entry) => buffer.delete(entry.key)));
    }
    return {
      ok: true,
      sent: true,
      reason,
      envelopeCount: entries.length,
      records: digestEnvelope.records.length,
      subject: email.subject,
    };
  } catch (error) {
    return {
      ok: false,
      sent: false,
      error: "resend_failed",
      detail: String(error instanceof Error ? error.message : error).slice(0, 500),
      bufferedEnvelopes: entries.length,
      records: digestEnvelope.records.length,
    };
  }
}

async function sendDigest(request, env) {
  const auth = requireBearer(request, env);
  if (!auth.ok) return auth.response;
  const result = await flushDigest(env, "manual");
  return json(result, result.ok ? 200 : 502);
}

function digestWindowMinutes(env) {
  const parsed = Number(env.DIGEST_WINDOW_MINUTES || DEFAULT_DIGEST_WINDOW_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_DIGEST_WINDOW_MINUTES;
}

function digestMaxRecords(env) {
  const parsed = Number(env.DIGEST_MAX_RECORDS || DEFAULT_DIGEST_MAX_RECORDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_DIGEST_MAX_RECORDS;
}

function countBy(items, fn) {
  const out = new Map();
  for (const item of items) {
    const key = String(fn(item) || "unknown");
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

function cryptoRandomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function redactText(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, "[code omitted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(api[_-]?key|token|secret|password|authorization|bearer|cookie)(\s*[:=]\s*)(["']?)[^\s"',}]+/gi, "$1$2[redacted]")
    .replace(/https?:\/\/[^\s)>"]+/g, (match) => match.replace(/\?[^)\s>"]+/g, "?[redacted]"))
    .replace(/\b[A-Za-z0-9_=-]{36,}\b/g, "[redacted-token]")
    .slice(0, 4000);
}

function sanitizeForEmail(value, depth = 0) {
  if (depth > 8) return "[max-depth]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeForEmail(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 120)) {
      const lower = key.toLowerCase();
      if (/(token|secret|password|authorization|cookie|apikey|api_key)/.test(lower)) out[key] = "[redacted]";
      else if (/^(content|markdown|html|raw_chat|note_text|prompt|instructions)$/i.test(key) && typeof item === "string") out[key] = redactText(item).slice(0, 800);
      else out[key] = sanitizeForEmail(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return redactText(value);
  return value;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "ogb-telemetry-email-worker",
        schema: OGB_ENVELOPE_SCHEMA,
        digestWindowMinutes: digestWindowMinutes(env),
        resendConfigured: Boolean(env.RESEND_API_KEY && (env.RESEND_FROM || env.FROM_EMAIL) && (env.RESEND_TO || env.TO_EMAIL)),
        kvConfigured: hasTelemetryBuffer(env),
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/telemetry/workflow-runs") {
      return acceptWorkflowRuns(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/telemetry/digest/send") {
      return sendDigest(request, env);
    }
    return text("not found", 404);
  },

  async scheduled(_event, env, ctx) {
    const task = flushDigest(env, "scheduled").catch((error) => {
      console.error("ogb telemetry digest failed", error);
    });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
    else await task;
  },
};
