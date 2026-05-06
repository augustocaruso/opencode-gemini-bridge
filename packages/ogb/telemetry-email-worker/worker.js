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

function diagnosticContext(record) {
  return record.diagnosticContext || record.diagnostic_context || {};
}

function payloadSummary(record) {
  return record.payloadSummary || record.payload_summary || {};
}

function summaryMessages(summary, key) {
  return Array.isArray(summary[key]) ? summary[key].map((item) => String(item || "")).filter(Boolean) : [];
}

const NON_ACTIONABLE_ROOT_CAUSES = new Set(["no_issue_detected", "dashboard_echo", "rulesync_disabled"]);
const GENERIC_ROOT_CAUSES = new Set(["", "no_issue_detected", "workflow_warn", "workflow_failed"]);
const CAUSE_DETAILS = {
  dashboard_echo: {
    label: "Dashboard repetiu aviso de outro workflow",
    recovery: "Abra o workflow de origem no preview local para ver o aviso real.",
  },
  global_binary_mismatch: {
    label: "Binario global do OGB esta desatualizado",
    recovery: "Atualize o OGB global ou rode o comando pelo pacote local esperado.",
  },
  managed_file_conflict: {
    label: "Arquivo gerenciado foi editado manualmente",
    recovery: "Revise o arquivo apontado; use --force apenas se quiser sobrescrever a edicao local.",
  },
  missing_builtin_commands: {
    label: "Comandos built-in do OpenCode estao faltando",
    recovery: "Rode ogb sync para regenerar os comandos do OpenCode.",
  },
  no_issue_detected: {
    label: "Nenhum problema detectado",
    recovery: "",
  },
  plugin_inactive: {
    label: "Plugin OpenCode configurado mas inativo",
    recovery: "Rode ogb sync e reinicie o OpenCode se o aviso continuar.",
  },
  restart_required: {
    label: "OpenCode precisa reiniciar para carregar mudancas",
    recovery: "Reinicie o OpenCode e rode /bridge novamente.",
  },
  rulesync_disabled: {
    label: "Rulesync esta desativado",
    recovery: "Nenhuma acao se rulesync foi desativado de proposito; rode ogb sync --rulesync auto para reativar.",
  },
  stale_generated_files: {
    label: "Arquivos gerados estao desatualizados",
    recovery: "Rode ogb sync para regenerar arquivos com a versao atual.",
  },
  trust_review_required: {
    label: "Hooks/scripts precisam de revisao",
    recovery: "Revise o recurso e rode ogb trust-extension ou ogb pass --accept-hooks quando for seguro.",
  },
  validation_warn: {
    label: "Validacao OGB terminou com avisos",
    recovery: "Rode ogb validate --json para ver quais checks avisaram.",
  },
};

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function workflowDisplayName(workflow) {
  return {
    "auto-update": "Auto-update",
    dashboard: "Dashboard",
    doctor: "Doctor",
    pass: "Pass",
    "security-check": "Security-check",
    "setup-opencode": "Setup OpenCode",
    startup: "Plugin de startup",
    "startup-plugin": "Plugin de startup",
    sync: "Sync",
    validate: "Validacao OGB",
  }[workflow] || workflow || "Workflow OGB";
}

function workflowRecoveryCommand(workflow) {
  return {
    dashboard: "ogb dashboard",
    doctor: "ogb doctor",
    pass: "ogb pass",
    "security-check": "ogb security-check",
    "setup-opencode": "ogb setup-opencode",
    sync: "ogb sync",
    validate: "ogb validate",
  }[workflow] || "ogb bridge";
}

function causeResult(code, diagnostic, fallback = {}) {
  const details = CAUSE_DETAILS[code] || {};
  const diagnosticCode = String(diagnostic.rootCauseCode || diagnostic.root_cause_code || "");
  const useDiagnostic = diagnosticCode === code && !GENERIC_ROOT_CAUSES.has(diagnosticCode);
  return {
    code,
    label: String((useDiagnostic && (diagnostic.rootCauseLabel || diagnostic.root_cause_label)) || fallback.label || details.label || code || "Workflow issue"),
    recovery: String((useDiagnostic && (diagnostic.recoveryCommand || diagnostic.recovery_command)) || fallback.recovery || details.recovery || ""),
  };
}

function classifyTelemetryCause(record) {
  const diagnostic = diagnosticContext(record);
  const summary = payloadSummary(record);
  const status = String(record.status || "").toLowerCase();
  const outcome = String(record.outcome || "").toLowerCase();
  const exitCode = Number(record.exitCode ?? record.exit_code ?? 0);
  const warnings = summaryMessages(summary, "warnings");
  const errors = summaryMessages(summary, "errors");
  const rawCode = String(diagnostic.rootCauseCode || diagnostic.root_cause_code || "");
  const rawLabel = String(diagnostic.rootCauseLabel || diagnostic.root_cause_label || "");
  const rawRecovery = String(diagnostic.recoveryCommand || diagnostic.recovery_command || "");
  const messagesText = [...warnings, ...errors, rawLabel, rawRecovery].join("\n").toLowerCase();

  if (rawCode && !GENERIC_ROOT_CAUSES.has(rawCode)) return causeResult(rawCode, diagnostic);
  if (includesAny(messagesText, ["opencode-auto-fallback is enabled", "plugin is not active", "plugin inactive"])) return causeResult("plugin_inactive", diagnostic);
  if (includesAny(messagesText, ["agent conflict", "exists or was edited manually", "managed file conflict"])) return causeResult("managed_file_conflict", diagnostic);
  if (includesAny(messagesText, ["hook needs review", "needs_review", "trusted hook/script changed", "trusted hook", "hooks/scripts"])) return causeResult("trust_review_required", diagnostic);
  if (includesAny(messagesText, ["opencode precisa reiniciar para carregar mudancas", "ogb foi atualizado automaticamente"])) return causeResult("restart_required", diagnostic);
  if (record.workflow === "dashboard" && includesAny(messagesText, ["validation passou com avisos", "doctor passou com avisos", "security passou com avisos"])) return causeResult("dashboard_echo", diagnostic);
  if (includesAny(messagesText, ["rulesync disabled"])) return causeResult("rulesync_disabled", diagnostic);
  if (messagesText.includes("generated by ogb") && messagesText.includes("current ogb")) return causeResult("stale_generated_files", diagnostic);
  if (includesAny(messagesText, ["missing built-in opencode commands"])) return causeResult("missing_builtin_commands", diagnostic);
  if (includesAny(messagesText, ["ogb global binary", "ogb resolves to"]) && messagesText.includes("expected")) return causeResult("global_binary_mismatch", diagnostic);
  if (record.workflow === "validate" && (status === "completed_with_warnings" || outcome === "warn")) return causeResult("validation_warn", diagnostic);
  if (exitCode !== 0 || status === "failed" || outcome === "fail" || errors.length > 0) {
    return causeResult("workflow_failed", diagnostic, {
      label: `${workflowDisplayName(record.workflow)} falhou`,
      recovery: `Rode ${workflowRecoveryCommand(record.workflow)} --json para ver o diagnostico.`,
    });
  }
  if (status === "completed_with_warnings" || outcome === "warn" || warnings.length > 0) {
    return causeResult("workflow_warn", diagnostic, {
      label: `${workflowDisplayName(record.workflow)} terminou com avisos`,
      recovery: `Rode ${workflowRecoveryCommand(record.workflow)} --json para ver os proximos passos.`,
    });
  }
  return causeResult("no_issue_detected", diagnostic);
}

function compactRecord(record) {
  const summary = payloadSummary(record);
  const cause = classifyTelemetryCause(record);
  return {
    runId: runId(record),
    workflow: record.workflow,
    outcome: record.outcome || record.status || "unknown",
    status: record.status || "unknown",
    phase: record.phase || "",
    recordedAt: recordedAt(record),
    durationMs: Number(record.durationMs || 0),
    exitCode: Number(record.exitCode || 0),
    rootCauseCode: cause.code,
    rootCauseLabel: cause.label,
    recoveryCommand: cause.recovery,
    warnings: summaryMessages(summary, "warnings").slice(0, 5),
    errors: summaryMessages(summary, "errors").slice(0, 5),
  };
}

function isActionableRecord(record) {
  const summary = payloadSummary(record);
  const cause = classifyTelemetryCause(record);
  const status = String(record.status || "").toLowerCase();
  const outcome = String(record.outcome || "").toLowerCase();
  const exitCode = Number(record.exitCode ?? record.exit_code ?? 0);
  const warnings = summaryMessages(summary, "warnings");
  const errors = summaryMessages(summary, "errors");
  if (exitCode !== 0) return true;
  if (status === "failed" || outcome === "fail") return true;
  if (errors.length > 0) return true;
  if (NON_ACTIONABLE_ROOT_CAUSES.has(cause.code)) return false;
  if (status === "completed_with_warnings" || outcome === "warn") return true;
  if (warnings.length > 0) return true;
  if (cause.code && cause.code !== "no_issue_detected") return true;
  return false;
}

function actionableEnvelope(envelope) {
  return {
    ...envelope,
    records: Array.isArray(envelope.records) ? envelope.records.filter(isActionableRecord) : [],
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
      if (!isActionableRecord(record)) continue;
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

function normalizeProblemText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[0-9a-f]{8,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function severityOf(record) {
  if (record.outcome === "fail" || record.status === "failed" || Number(record.exitCode || 0) !== 0) return "high";
  if (record.rootCauseCode === "setup_test" || record.workflow === "telemetry") return "low";
  if (record.outcome === "warn" || record.status === "completed_with_warnings" || record.warnings.length || record.rootCauseCode) return "medium";
  return "low";
}

function severityRank(value) {
  return value === "high" ? 3 : value === "medium" ? 2 : value === "low" ? 1 : 0;
}

function problemLabel(record) {
  if (record.rootCauseLabel) return record.rootCauseLabel;
  if (record.errors[0]) return record.errors[0];
  if (record.warnings[0]) return record.warnings[0];
  return record.workflow || "workflow issue";
}

function problemFingerprint(record) {
  const code = record.rootCauseCode || "unknown";
  if (code && code !== "unknown" && code !== "workflow_warn" && code !== "workflow_failed") return code;
  const basis = record.errors[0] || record.warnings[0] || record.rootCauseLabel || record.status || record.outcome;
  return [record.workflow, code, normalizeProblemText(basis)].join("|");
}

function groupProblems(records) {
  const groups = new Map();
  for (const record of records) {
    const key = problemFingerprint(record);
    const severity = severityOf(record);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        code: record.rootCauseCode || "unknown",
        count: 1,
        severity,
        workflows: new Set([record.workflow]),
        label: problemLabel(record),
        nextAction: record.recoveryCommand || "",
        firstAt: record.recordedAt || "",
        lastAt: record.recordedAt || "",
        sampleWarnings: record.warnings.slice(0, 2),
        sampleErrors: record.errors.slice(0, 2),
      });
      continue;
    }
    existing.count += 1;
    existing.workflows.add(record.workflow);
    if (severityRank(severity) > severityRank(existing.severity)) existing.severity = severity;
    if (!existing.nextAction && record.recoveryCommand) existing.nextAction = record.recoveryCommand;
    if (record.recordedAt && (!existing.firstAt || record.recordedAt < existing.firstAt)) existing.firstAt = record.recordedAt;
    if (record.recordedAt && (!existing.lastAt || record.recordedAt > existing.lastAt)) existing.lastAt = record.recordedAt;
    for (const warning of record.warnings) if (existing.sampleWarnings.length < 2 && !existing.sampleWarnings.includes(warning)) existing.sampleWarnings.push(warning);
    for (const error of record.errors) if (existing.sampleErrors.length < 2 && !existing.sampleErrors.includes(error)) existing.sampleErrors.push(error);
  }
  return [...groups.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count || a.label.localeCompare(b.label));
}

function digestText(envelope, records) {
  const groups = groupProblems(records);
  const severityCounts = Object.fromEntries(countBy(groups, (group) => group.severity));
  const lines = [
    envelope.digest ? "OGB actionable telemetry digest" : "OGB actionable telemetry",
    "",
    `Actionable runs: ${records.length}`,
    `Problems: ${groups.length}`,
    `Severity: high=${severityCounts.high || 0}, medium=${severityCounts.medium || 0}, low=${severityCounts.low || 0}`,
    `Generated: ${generatedAt(envelope)}`,
    "",
    "Problems",
    "",
  ];
  for (const group of groups.slice(0, 12)) {
    lines.push(`- ${group.count}x [${group.severity}] ${group.label}`);
    if (group.code && group.code !== "unknown") lines.push(`  Cause: ${group.code}`);
    lines.push(`  Workflows: ${[...group.workflows].sort().join(", ")}`);
    if (group.nextAction) lines.push(`  Next: ${group.nextAction}`);
    if (group.firstAt || group.lastAt) lines.push(`  Window: ${group.firstAt || "?"} -> ${group.lastAt || "?"}`);
    for (const warning of group.sampleWarnings) lines.push(`  Warning sample: ${warning}`);
    for (const error of group.sampleErrors) lines.push(`  Error sample: ${error}`);
  }
  if (groups.length > 12) lines.push("", `...${groups.length - 12} more problem group(s) omitted.`);
  lines.push("", "Debug");
  lines.push("Run `ogb telemetry preview --since 24h` on the affected machine for full local context.");
  return lines.join("\n");
}

function digestHtml(envelope, records) {
  const groups = groupProblems(records);
  const rows = groups.slice(0, 20).map((group) => (
    `<tr><td>${escapeHtml(String(group.count))}x</td><td>${escapeHtml(group.severity)}</td><td>${escapeHtml(group.label)}${group.code && group.code !== "unknown" ? `<br><code>${escapeHtml(group.code)}</code>` : ""}</td><td>${escapeHtml([...group.workflows].sort().join(", "))}</td><td>${escapeHtml(group.nextAction || "")}</td></tr>`
  )).join("");
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; color: #1f2937;">
    <h2>OGB actionable telemetry${envelope.digest ? " digest" : ""}</h2>
    <p><strong>Actionable runs:</strong> ${records.length}</p>
    <p><strong>Problems:</strong> ${groups.length}</p>
    <p><strong>Generated:</strong> ${escapeHtml(generatedAt(envelope))}</p>
    <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse;">
      <thead><tr><th>Count</th><th>Severity</th><th>Problem</th><th>Workflows</th><th>Next action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color: #6b7280;">For full local context, run <code>ogb telemetry preview --since 24h</code> on the affected machine.</p>
  </body>
</html>`;
}

function renderEmail(envelope) {
  const safeEnvelope = sanitizeForEmail(envelope);
  const records = (safeEnvelope.records || []).filter(isActionableRecord).map(compactRecord);
  const groups = groupProblems(records);
  const severity = groups.reduce((current, group) => severityRank(group.severity) > severityRank(current) ? group.severity : current, "low");
  const digestLabel = safeEnvelope.digest ? "[digest]" : "";
  const focus = groups.slice(0, 3).map((group) => group.label).join(", ") || "no actionable issues";
  return {
    subject: `[OGB]${digestLabel}[${severity}] ${groups.length} issue(s): ${focus}`.slice(0, 180),
    text: digestText(safeEnvelope, records),
    html: digestHtml(safeEnvelope, records),
    actionableCount: records.length,
    problemCount: groups.length,
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

  const actionable = actionableEnvelope(parsed.body);
  if (actionable.records.length === 0) {
    return json({
      ok: true,
      queued: false,
      accepted: parsed.body.records.length,
      actionable: 0,
      reason: "no_actionable_records",
      schema: OGB_ENVELOPE_SCHEMA,
    });
  }

  if (hasTelemetryBuffer(env)) {
    const key = await appendEnvelope(env, actionable);
    return json({
      ok: true,
      queued: true,
      accepted: parsed.body.records.length,
      actionable: actionable.records.length,
      bufferKey: key,
      digestWindowMinutes: digestWindowMinutes(env),
      schema: OGB_ENVELOPE_SCHEMA,
    });
  }

  const email = renderEmail(actionable);
  await sendResendEmail(env, email);
  return json({
    ok: true,
    queued: false,
    accepted: parsed.body.records.length,
    actionable: actionable.records.length,
    subject: email.subject,
    schema: OGB_ENVELOPE_SCHEMA,
  });
}

async function flushDigest(env, reason = "manual") {
  if (!hasTelemetryBuffer(env)) return { ok: true, sent: false, reason: "telemetry_buffer_not_configured" };
  const entries = await readBufferedEnvelopes(env);
  if (entries.length === 0) return { ok: true, sent: false, reason: "empty_digest", records: 0 };
  const digestEnvelope = buildDigestEnvelope(entries, env, reason);
  if (!digestEnvelope.records.length) {
    const buffer = telemetryBuffer(env);
    if (typeof buffer.delete === "function") await Promise.all(entries.map((entry) => buffer.delete(entry.key)));
    return { ok: true, sent: false, reason: "no_actionable_records", records: 0 };
  }
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
