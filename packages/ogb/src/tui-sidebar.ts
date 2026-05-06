import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { sha256Text } from "./file-hash.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState } from "./sync-state.js";
import { OGB_VERSION } from "./types.js";

export const TUI_SIDEBAR_PLUGIN_PATH = ".opencode/tui-plugins/ogb-sidebar.js";
export const TUI_CONFIG_PATH = ".opencode/tui.jsonc";
export const GLOBAL_TUI_SIDEBAR_PLUGIN_PATH = "tui-plugins/ogb-sidebar.js";
export const GLOBAL_TUI_CONFIG_PATH = "tui.json";
export const TUI_SIDEBAR_PLUGIN_SPEC = "./tui-plugins/ogb-sidebar.js";

export const TUI_SIDEBAR_PLUGIN_SOURCE = String.raw`import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createComponent, createElement, insert, spread } from "@opentui/solid";
import { createSignal, onCleanup, onMount } from "solid-js";

const id = "ogb:sidebar";
const REFRESH_MS = 5000;
const PROMPT_REFRESH_MS = 1000;
const GLOBAL_GENERATED_DIR = path.join(os.homedir(), ".config", "opencode-gemini-bridge", "generated");
let eventsRegistered = false;
let activeCall;
let eventDisposers = [];
const sessionParents = new Map();
const sessionModels = new Map();

function el(type, props, ...children) {
  const node = createElement(type);
  spread(node, props || {}, true);
  if (children.length > 0) insert(node, children.length === 1 ? children[0] : children);
  return node;
}

function line(props, ...children) {
  return el("text", props, ...children);
}

function box(props, ...children) {
  return el("box", props, ...children);
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function isHomeRoot(root) {
  try {
    return path.resolve(String(root || "")) === path.resolve(os.homedir());
  } catch {
    return false;
  }
}

function generatedDir(root) {
  if (isHomeRoot(root)) return GLOBAL_GENERATED_DIR;
  return path.join(root, ".opencode", "generated");
}

function countsTotal(counts) {
  if (!counts || typeof counts !== "object") return 0;
  return Number(counts.ok || 0) + Number(counts.warning || 0) + Number(counts.error || 0) + Number(counts.needs_review || 0);
}

function formatTime(value) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function durationLabel(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes <= 0) return "now";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return String(hours) + "h " + String(rest) + "m";
  if (hours > 0) return String(hours) + "h";
  return String(minutes) + "m";
}

function compactDurationLabel(value) {
  const text = String(value || "").replace(/\s+/g, "");
  const match = text.match(/^([0-9]+)h(?:([0-9]+)m)?$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    if (hours >= 48) return String(Math.floor((hours * 60 + minutes) / 1440)) + "d";
  }
  return text;
}

function formatElapsed(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  if (safeMs < 60000) return String(Math.floor(safeMs / 1000)) + "s";
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  return String(minutes) + "m" + String(seconds) + "s";
}

function resetText(lineData) {
  if (!lineData) return "";
  if (lineData.resetsAt) {
    const resetAt = new Date(lineData.resetsAt).getTime();
    if (!Number.isNaN(resetAt)) return durationLabel(resetAt - Date.now());
  }
  if (Number(lineData.periodDurationMs) > 0) return "~" + durationLabel(Number(lineData.periodDurationMs));
  return "";
}

function lineMetric(lineData) {
  if (!lineData) return "";
  if (lineData.format?.kind === "count") return String(Math.round(Number(lineData.used || 0))) + "/" + String(Math.round(Number(lineData.limit || 0)));
  const limit = Number(lineData.limit || 0);
  if (limit <= 0) return "0%";
  const percent = Math.max(0, Math.min(100, Math.round((Number(lineData.used || 0) / limit) * 100)));
  return String(percent) + "%";
}

function metricUsageLabel(metric) {
  if (!metric) return "";
  return metric.endsWith("%") ? metric + " used" : metric;
}

function providerMeta(provider) {
  const plan = provider?.plan ? String(provider.plan) : "";
  return plan;
}

function providerPrimaryLine(provider) {
  const lines = Array.isArray(provider?.lines) ? provider.lines : [];
  return lines.find((item) => item.label === "Session" && item.type === "progress")
    || lines.find((item) => item.label === "Weekly" && item.type === "progress")
    || lines.find((item) => item.label === "Quota" && item.type === "progress")
    || lines.find((item) => item.type === "progress")
    || lines[0];
}

function providerLabel(provider) {
  const name = String(provider?.displayName || "Provider");
  const meta = providerMeta(provider);
  return meta ? name + " " + meta : name;
}

function providerKind(providerID) {
  const id = String(providerID || "").toLowerCase();
  if (id.includes("anthropic") || id.includes("claude")) return "anthropic";
  if (id.includes("openai") || id.includes("gpt") || id.includes("codex")) return "openai";
  if (id.includes("google") || id.includes("gemini")) return "gemini";
  return id ? "other" : "unknown";
}

function readLimits(root) {
  const limits = safeReadJson(path.join(generatedDir(root), "ogb-limits.json"));
  if (!limits || !Array.isArray(limits.providers)) return { providers: [], status: "missing" };
  return {
    providers: limits.providers,
    status: String(limits.status || "unknown"),
    sources: limits.sources || {},
  };
}

function readUiPrefs(root) {
  const prefs = safeReadJson(path.join(generatedDir(root), "ogb-ui.json"));
  return prefs && typeof prefs === "object" ? prefs : {};
}

function externalQuotaPanel(root) {
  return readUiPrefs(root).quotaPanel === "external";
}

function shortLimitLabel(label) {
  const value = String(label || "Usage");
  if (value.toLowerCase() === "quota") return "Quota";
  return value;
}

function truncateText(value, width) {
  const text = String(value || "");
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return text.slice(0, width - 1) + "…";
}

function padRight(value, width) {
  const text = String(value || "");
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value || "");
  if (text.length >= width) return text.slice(text.length - width);
  return " ".repeat(width - text.length) + text;
}

function tableLine(label, metric, reset) {
  const left = "  " + truncateText(label, 12).padEnd(12, " ");
  const middle = String(metric || "").padStart(5, " ");
  const right = reset ? compactDurationLabel(reset).padStart(7, " ") : "";
  return left + middle + (right ? " " + right : "");
}

function providerDisplayName(provider) {
  const name = String(provider?.displayName || "Provider");
  const meta = providerMeta(provider);
  return meta ? name + " (" + meta + ")" : name;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function lineUsedPercent(lineData) {
  if (!lineData) return undefined;
  const direct = clampPercent(lineData.usedPercent ?? lineData.percentUsed);
  if (direct !== undefined) return direct;
  const limit = Number(lineData.limit || 0);
  if (limit <= 0) return undefined;
  return clampPercent((Number(lineData.used || 0) / limit) * 100);
}

const QUOTA_SIDEBAR_MAX_WIDTH = 36;
const TUI_SIDEBAR_LAYOUT = {
  maxWidth: QUOTA_SIDEBAR_MAX_WIDTH,
  narrowAt: QUOTA_SIDEBAR_MAX_WIDTH,
  tinyAt: 20,
};

function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function bar(percent, width) {
  const safePercent = clampPercent(percent) ?? 0;
  const filled = Math.round((clampInt(safePercent, 0, 100) / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatDisplayedPercentLabel(percent) {
  return String(clampPercent(percent) ?? 0) + "%";
}

function formatQuotaRows(entries, errors) {
  const layout = TUI_SIDEBAR_LAYOUT;
  const maxWidth = layout.maxWidth;
  const isTiny = maxWidth <= layout.tinyAt;
  const isNarrow = !isTiny && maxWidth <= layout.narrowAt;
  const separator = "  ";
  const percentCol = Math.max(4, ...entries.map((entry) => formatDisplayedPercentLabel(entry.percent).length));
  const timeCol = isTiny ? 6 : isNarrow ? 7 : 7;
  const barWidth = Math.max(10, maxWidth - separator.length - percentCol);
  const lines = [];

  const addPercentEntry = (name, reset, percent) => {
    const displayedPercent = clampPercent(percent) ?? 0;
    const percentLabel = formatDisplayedPercentLabel(percent);
    const leftText = name;
    const timeStr = reset ? compactDurationLabel(reset) : "";

    if (isTiny) {
      const tinyNameCol = Math.max(1, maxWidth - separator.length - timeCol - separator.length - percentCol);
      const line = [
        padRight(leftText, tinyNameCol),
        padLeft(timeStr, timeCol),
        padLeft(percentLabel, percentCol),
      ].join(separator);
      lines.push(line.slice(0, maxWidth));
      return;
    }

    const timeWidth = Math.max(timeStr.length, timeCol);
    const nameWidth = Math.max(1, barWidth - separator.length - timeWidth);
    const timeLine = padRight(leftText, nameWidth) + separator + padLeft(timeStr, timeWidth);
    lines.push(timeLine.slice(0, barWidth));

    const barCell = bar(displayedPercent, barWidth);
    const percentCell = padLeft(percentLabel, percentCol);
    lines.push([barCell, percentCell].join(separator));
  };

  for (const entry of entries) addPercentEntry(entry.label, entry.reset, entry.percent);
  for (const error of errors) lines.push(error.label + ": " + error.message);
  return lines;
}

function providerQuotaRows(provider) {
  const lines = (Array.isArray(provider?.lines) ? provider.lines : [])
    .filter((item) => item?.type === "progress" || lineUsedPercent(item) !== undefined)
    .slice(0, 4);
  const effectiveLines = lines.length > 0 ? lines : [providerPrimaryLine(provider)].filter(Boolean);
  const providerName = providerDisplayName(provider);
  return effectiveLines
    .map((item) => {
      const percent = lineUsedPercent(item);
      if (percent === undefined) return undefined;
      const shortLabel = shortLimitLabel(item.label);
      const label = effectiveLines.length > 1 && shortLabel !== "Quota"
        ? providerName + " " + shortLabel
        : providerName;
      return {
        label,
        reset: resetText(item),
        percent,
      };
    })
    .filter(Boolean);
}

function unavailableLimitRows(root) {
  const limits = readLimits(root);
  const providers = limits.providers || [];
  const providerText = providers.map((provider) => (String(provider.providerId || "") + " " + String(provider.displayName || "")).toLowerCase()).join(" ");
  const rows = [];
  const anthropic = limits.sources?.anthropicClaude;
  if (!providerText.includes("anthropic") && anthropic?.status && anthropic.status !== "ok" && anthropic.status !== "skipped") {
    rows.push({ label: "Anthropic", message: "unavailable" });
  }
  const gemini = limits.sources?.geminiCodeAssist;
  if (!providerText.includes("gemini") && gemini?.status && gemini.status !== "ok" && gemini.status !== "skipped") {
    rows.push({ label: "Gemini", message: "unavailable" });
  }
  return rows;
}

function quotaRows(root) {
  const limits = readLimits(root);
  const rows = [];
  for (const provider of limits.providers.slice(0, 4)) rows.push(...providerQuotaRows(provider));
  return rows;
}

function providerMatches(provider, providerID) {
  const name = (String(provider?.providerId || "") + " " + String(provider?.displayName || "")).toLowerCase();
  const id = String(providerID || "").toLowerCase();
  if (id.includes("anthropic") || id.includes("claude")) return name.includes("anthropic") || name.includes("claude");
  if (id.includes("openai") || id.includes("gpt") || id.includes("codex")) return name.includes("openai") || name.includes("chatgpt") || name.includes("codex");
  if (id.includes("google") || id.includes("gemini")) return name.includes("google") || name.includes("gemini");
  return id && name.includes(id);
}

function limitForProvider(root, providerID) {
  const providers = readLimits(root).providers;
  const provider = providerID ? providers.find((item) => providerMatches(item, providerID)) : providers[0];
  const primary = providerPrimaryLine(provider);
  const metric = lineMetric(primary);
  if (!provider || !metric) return undefined;
  const usageLabel = metricUsageLabel(metric);
  return {
    available: true,
    source: "limits",
    label: providerLabel(provider) + " " + usageLabel,
    promptLabel: String(provider.displayName || "Limits") + " " + usageLabel,
    resetIn: resetText(primary),
  };
}

function shouldTrackSession(sessionId) {
  const parentId = sessionParents.get(sessionId);
  return parentId === undefined || parentId === null || parentId === "";
}

function applyCachedModel(sessionId) {
  if (!activeCall || activeCall.sessionId !== sessionId) return;
  const cached = sessionModels.get(sessionId);
  if (!cached) return;
  activeCall.modelID = cached.modelID || activeCall.modelID || "";
  activeCall.providerID = cached.providerID || activeCall.providerID || "";
}

function startCall(sessionId, messageId) {
  if (!sessionId || !shouldTrackSession(sessionId)) return;
  const now = performance.now();
  if (!activeCall || activeCall.sessionId !== sessionId) {
    activeCall = {
      sessionId,
      messageId: messageId || "",
      startedAt: now,
      startedWallMs: Date.now(),
      active: true,
      modelID: "",
      providerID: "",
    };
  } else {
    activeCall.active = true;
    if (messageId) activeCall.messageId = messageId;
  }
  applyCachedModel(sessionId);
}

function clearCall(sessionId, force) {
  if (!activeCall || activeCall.sessionId !== sessionId) return;
  if (!force && !latestAssistantCompleted(activeCall.api, sessionId, activeCall)) return;
  activeCall = undefined;
}

function timestampMs(value) {
  if (!value) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function latestAssistantCompleted(api, sessionId, call) {
  if (!api || !sessionId) return false;
  const messages = api.state.session.messages(sessionId) || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const completed = Boolean(message.time?.completed || message.finish || message.error);
    if (!completed) return false;
    if (call?.messageId && message.id === call.messageId) return true;
    const completedMs = timestampMs(message.time?.completed);
    if (completedMs !== undefined && call?.startedWallMs !== undefined) return completedMs >= call.startedWallMs - 2000;
    return Boolean(call?.messageId);
  }
  return false;
}

function elapsedForSession(api, sessionId) {
  if (!activeCall || activeCall.sessionId !== sessionId) return "";
  activeCall.api = api;
  const status = api.state.session.status(sessionId)?.type;
  if (status && status !== "busy" && latestAssistantCompleted(api, sessionId, activeCall)) {
    clearCall(sessionId, true);
    return "";
  }
  return "⏱ " + formatElapsed(performance.now() - activeCall.startedAt);
}

function registerElapsedEvents(api) {
  if (eventsRegistered || !api.event?.on) return;
  eventsRegistered = true;

  const listen = (type, handler) => {
    const dispose = api.event.on(type, handler);
    if (typeof dispose === "function") eventDisposers.push(dispose);
  };

  listen("session.created", (event) => {
    const info = event?.properties?.info;
    if (info?.id) sessionParents.set(info.id, info.parentID ?? null);
  });

  listen("session.updated", (event) => {
    const info = event?.properties?.info;
    if (info?.id) sessionParents.set(info.id, info.parentID ?? null);
  });

  listen("session.status", (event) => {
    const sessionId = event?.properties?.sessionID;
    const status = event?.properties?.status?.type;
    if (!sessionId || !shouldTrackSession(sessionId)) return;
    if (status === "busy") {
      if (!activeCall || activeCall.sessionId !== sessionId) startCall(sessionId, "");
      else activeCall.active = true;
    }
    if (status && status !== "busy") clearCall(sessionId, false);
  });

  listen("session.idle", (event) => {
    clearCall(event?.properties?.sessionID, false);
  });

  listen("message.part.delta", (event) => {
    const sessionId = event?.properties?.sessionID;
    const messageId = event?.properties?.messageID;
    const field = event?.properties?.field;
    if (field === "text") startCall(sessionId, messageId);
  });

  listen("message.updated", (event) => {
    const sessionId = event?.properties?.sessionID;
    const info = event?.properties?.info;
    if (!sessionId || !info || !shouldTrackSession(sessionId)) return;
    const meta = modelMetaFromMessage(info);
    if (meta.providerID || meta.modelID) {
      const existing = sessionModels.get(sessionId) || {};
      sessionModels.set(sessionId, {
        modelID: meta.modelID || existing.modelID || "",
        providerID: meta.providerID || existing.providerID || "",
      });
      applyCachedModel(sessionId);
    }
    if (info.role === "assistant" && info.time?.completed) {
      const status = api.state.session.status(sessionId)?.type;
      if (status && status !== "busy") clearCall(sessionId, false);
    }
  });

  listen("session.deleted", (event) => {
    const sessionId = event?.properties?.sessionID;
    sessionParents.delete(sessionId);
    sessionModels.delete(sessionId);
    if (activeCall?.sessionId === sessionId) clearCall(sessionId, true);
  });

  api.lifecycle?.onDispose?.(() => {
    for (const dispose of eventDisposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
    activeCall = undefined;
    sessionParents.clear();
    sessionModels.clear();
    eventsRegistered = false;
  });
}

function normalizeOutcome(value) {
  const outcome = String(value || "unknown").toLowerCase();
  if (outcome === "pass" || outcome === "warn" || outcome === "fail") return outcome;
  return "unknown";
}

function lastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role === "assistant" && item?.tokens && Number(item.tokens.output || 0) > 0) return item;
  }
  return undefined;
}

function normalizeModelMeta(value) {
  if (!value || typeof value !== "object") return {};
  const providerID = value.providerID
    || value.providerId
    || value.provider?.id
    || value.model?.providerID
    || value.model?.providerId
    || "";
  const modelID = value.modelID
    || value.modelId
    || value.model?.id
    || value.model?.modelID
    || value.model?.modelId
    || "";
  return {
    providerID: providerID ? String(providerID) : "",
    modelID: modelID ? String(modelID) : "",
  };
}

function modelMetaFromMessage(message) {
  const direct = normalizeModelMeta(message);
  if (direct.providerID || direct.modelID) return direct;
  return normalizeModelMeta(message?.model);
}

function modelMetaFromModelState(api) {
  const candidates = [
    api?.state?.path?.state ? path.join(api.state.path.state, "model.json") : "",
    path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode", "model.json"),
  ].filter(Boolean);
  for (const filePath of candidates) {
    const state = safeReadJson(filePath);
    const recent = Array.isArray(state?.recent) ? state.recent[0] : undefined;
    const favorite = Array.isArray(state?.favorite) ? state.favorite[0] : undefined;
    const meta = normalizeModelMeta(recent || favorite);
    if (meta.providerID || meta.modelID) return meta;
  }
  return {};
}

function modelMetaFromMessages(api, sessionId, options = {}) {
  if (!sessionId) return {};
  const messages = api.state.session.messages(sessionId) || [];
  if (options.preferUser !== false) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== "user") continue;
      const meta = modelMetaFromMessage(messages[index]);
      if (meta.providerID || meta.modelID) return meta;
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = modelMetaFromMessage(messages[index]);
    if (meta.providerID || meta.modelID) return meta;
  }
  return sessionModels.get(sessionId) || {};
}

function selectedModelMeta(api, sessionId) {
  const stateModel = modelMetaFromModelState(api);
  if (stateModel.providerID || stateModel.modelID) return stateModel;
  return modelMetaFromMessages(api, sessionId);
}

async function fetchSessionModelMeta(api, sessionId) {
  if (!sessionId) return {};
  const stateModel = modelMetaFromModelState(api);
  if (stateModel.providerID || stateModel.modelID) {
    sessionModels.set(sessionId, stateModel);
    return stateModel;
  }
  if (!api.client.session?.get) return modelMetaFromMessages(api, sessionId);
  const attempts = [
    { path: { id: sessionId } },
    { path: { sessionID: sessionId } },
  ];
  for (const params of attempts) {
    try {
      const response = await api.client.session.get(params);
      const meta = normalizeModelMeta(response?.data || response);
      if (meta.providerID || meta.modelID) {
        const existing = sessionModels.get(sessionId) || {};
        const next = {
          providerID: meta.providerID || existing.providerID || "",
          modelID: meta.modelID || existing.modelID || "",
        };
        sessionModels.set(sessionId, next);
        return next;
      }
    } catch {}
  }
  return modelMetaFromMessages(api, sessionId);
}

function tokenTotal(tokens) {
  if (!tokens || typeof tokens !== "object") return 0;
  return Number(tokens.input || 0)
    + Number(tokens.output || 0)
    + Number(tokens.reasoning || 0)
    + Number(tokens.cache?.read || 0)
    + Number(tokens.cache?.write || 0);
}

function usageForSession(api, sessionId) {
  if (!sessionId) return { tokens: 0, percent: null, cost: 0, label: "ctx n/a", providerID: undefined, modelID: undefined };
  const messages = api.state.session.messages(sessionId) || [];
  const currentModel = selectedModelMeta(api, sessionId);
  const last = lastAssistantMessage(messages);
  const cost = messages.reduce((sum, item) => sum + (item?.role === "assistant" ? Number(item.cost || 0) : 0), 0);
  if (!last) return { tokens: 0, percent: null, cost, label: "ctx n/a", providerID: currentModel.providerID, modelID: currentModel.modelID };

  const tokens = tokenTotal(last.tokens);
  const providerID = last.providerID || currentModel.providerID;
  const modelID = last.modelID || currentModel.modelID;
  const provider = (api.state.provider || []).find((item) => item.id === providerID);
  const model = provider?.models?.[modelID];
  const limit = Number(model?.limit?.context || 0);
  const percent = limit > 0 ? Math.round((tokens / limit) * 100) : null;
  return {
    tokens,
    percent,
    cost,
    label: percent === null ? "ctx n/a" : String(percent) + "% ctx",
    providerID,
    modelID,
  };
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return (Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1)) + "%";
}

function quotaFromGquotaText(output) {
  const text = String(output || "");
  if (!text.includes("Gemini quota usage")) return undefined;

  const projectLine = text.split("\n").find((line) => line.includes("Gemini quota usage for project"));
  const projectId = projectLine
    ? projectLine.replace("Gemini quota usage for project", "").replaceAll(String.fromCharCode(96), "").trim()
    : undefined;
  const rows = [...text.matchAll(/([0-9]+(?:\.[0-9]+)?)%\s+([0-9]+h(?:\s+[0-9]+m)?|[0-9]+m|reset pending|now|-)/g)]
    .map((match) => {
      const remaining = Number(match[1]);
      return {
        remaining,
        used: Math.round((100 - remaining) * 10) / 10,
        resetIn: match[2],
      };
    })
    .filter((item) => Number.isFinite(item.remaining))
    .sort((left, right) => {
      if (left.remaining !== right.remaining) return left.remaining - right.remaining;
      return String(left.resetIn || "").localeCompare(String(right.resetIn || ""));
    });

  const worst = rows[0];
  if (!worst) return undefined;
  const used = formatPercent(worst.used);
  return {
    available: true,
    source: "/gquota",
    label: used ? used + " used" : "quota n/a",
    promptLabel: used ? "Gemini " + used + " used" : "Gemini quota n/a",
    resetIn: worst.resetIn && worst.resetIn !== "-" ? worst.resetIn : undefined,
    projectId,
  };
}

function quotaFromSession(api, sessionId) {
  if (!sessionId) return undefined;
  const messages = api.state.session.messages(sessionId) || [];
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const parts = api.state.part?.(message.id) || [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type === "tool" && part.tool === "gemini_quota" && part.state?.status === "completed") {
        const parsed = quotaFromGquotaText(part.state.output);
        if (parsed) return parsed;
      }
      if (part?.type === "text") {
        const parsed = quotaFromGquotaText(part.text);
        if (parsed) return parsed;
      }
    }
  }
  return undefined;
}

function quotaForUi(api, sessionId, root, usage, selectedModel) {
  const providerID = selectedModel?.providerID || usage?.providerID || "";
  if (!providerID) {
    return {
      available: false,
      source: "unknown",
      label: "",
      promptLabel: "",
    };
  }
  const kind = providerKind(providerID);
  if (kind === "gemini") {
    return quotaFromSession(api, sessionId) || limitForProvider(root, providerID) || {
      available: false,
      source: "missing",
      label: "",
      promptLabel: "",
    };
  }
  const providerLimit = limitForProvider(root, providerID);
  if (providerLimit) return providerLimit;
  return {
    available: false,
    source: "missing",
    label: "",
    promptLabel: "",
  };
}

function readPanel(root) {
  const generated = generatedDir(root);
  const dashboard = safeReadJson(path.join(generated, "ogb-dashboard.json"));
  const doctor = safeReadJson(path.join(generated, "ogb-doctor.json"));
  const inventory = safeReadJson(path.join(generated, "ogb-inventory.json"));
  const pluginStatus = safeReadJson(path.join(generated, "ogb-plugin-status.json"));
  const updateStatus = dashboard?.update || safeReadJson(path.join(generated, "ogb-update-status.json")) || {};
  const limits = readLimits(root);

  if (!dashboard && !doctor && !inventory) {
    return {
      available: false,
      outcome: "missing",
      message: "run /bridge",
    };
  }

  const resources = dashboard?.resources || {};
  const counts = doctor?.counts || {};
  const geminiFiles = Number(resources.geminiFiles ?? counts.geminiFiles ?? 0) || (Array.isArray(inventory?.geminiFiles) ? inventory.geminiFiles.length : 0);
  const mcps = countsTotal(resources.mcps || counts.mcps) || (Array.isArray(inventory?.mcps) ? inventory.mcps.length : 0);
  const skills = countsTotal(resources.skills || counts.skills) || (Array.isArray(inventory?.skills) ? inventory.skills.length : 0);
  const agents = countsTotal(resources.agents || counts.agents) || (Array.isArray(inventory?.agents) ? inventory.agents.length : 0);
  const commands = countsTotal(resources.commands || counts.commands) || (Array.isArray(inventory?.commands) ? inventory.commands.length : 0);
  const extensions = Number(dashboard?.extensionCompatibility?.extensions ?? doctor?.extensionCompatibility?.extensions ?? (Array.isArray(inventory?.extensions) ? inventory.extensions.length : 0));
  const projectedCommands = Number(dashboard?.extensionCompatibility?.projectedCommands ?? doctor?.extensionCompatibility?.projectedCommands ?? 0);
  const startup = dashboard?.startupSync || doctor?.startupSync || {};
  const startupState = String(startup.lastState || pluginStatus?.state || "unknown");

  return {
    available: true,
    outcome: normalizeOutcome(dashboard?.outcome || (Array.isArray(doctor?.errors) && doctor.errors.length ? "fail" : Array.isArray(doctor?.warnings) && doctor.warnings.length ? "warn" : "pass")),
    geminiFiles,
    mcps,
    skills,
    agents,
    commands,
    extensions,
    projectedCommands,
    startupState,
    startupTime: pluginStatus?.finishedAt || startup.lastFinishedAt,
    updateStatus: String(updateStatus.status || "missing"),
    updateLatest: String(updateStatus.latestTag || updateStatus.latestVersion || ""),
    updateRestartRequired: updateStatus.restartRequired === true,
    warnings: Array.isArray(dashboard?.warnings) ? dashboard.warnings.length : Array.isArray(doctor?.warnings) ? doctor.warnings.length : 0,
    errors: Array.isArray(dashboard?.errors) ? dashboard.errors.length : Array.isArray(doctor?.errors) ? doctor.errors.length : 0,
    generatedAt: dashboard?.generatedAt,
    limits,
  };
}

function outcomeColor(theme, outcome) {
  if (outcome === "pass") return theme.success;
  if (outcome === "fail") return theme.error;
  if (outcome === "warn") return theme.warning;
  return theme.textMuted;
}

function outcomeLabel(outcome) {
  return String(outcome || "unknown").toUpperCase();
}

function SyncText(props) {
  const data = () => props.panel();
  return line({ fg: props.theme().textMuted }, "sync ", data().startupState, " ", formatTime(data().startupTime));
}

function LimitsRows(props) {
  const rows = () => quotaRows(props.root);
  const unavailable = () => unavailableLimitRows(props.root);
  return box({ gap: 0 },
    line({ fg: props.theme().text }, "Quota"),
    () => {
      const data = rows();
      const missing = unavailable();
      if (data.length === 0 && missing.length === 0) return line({ fg: props.theme().textMuted, wrapMode: "none" }, "limits unavailable");
      const children = formatQuotaRows(data, missing).map((item) => line({ fg: props.theme().textMuted, wrapMode: "none" }, item || " "));
      return box({ gap: 0 }, ...children);
    },
  );
}

function StatusBlock(props) {
  return box({ gap: 0 },
    line({ fg: props.theme().text }, "OGB ", () => {
      const data = props.panel();
      return el("span", { style: { fg: outcomeColor(props.theme(), data.outcome) } }, outcomeLabel(data.outcome));
    }),
    createComponent(SyncText, { panel: props.panel, theme: props.theme }),
  );
}

function bridgeInventoryText(data) {
  return String(data.geminiFiles || 0) + " GEMINI.md files · "
    + String(data.mcps || 0) + " MCP servers · "
    + String(data.skills || 0) + " skills";
}

function updateText(data) {
  if (data.updateRestartRequired) return "update applied · restart OpenCode";
  if (data.updateStatus === "available" && data.updateLatest) return "update available " + data.updateLatest;
  if (data.updateStatus === "error") return "update failed";
  return "";
}

function BridgeRows(props) {
  const data = () => props.panel();
  return box({ gap: 0 },
    line({ fg: props.theme().info }, "BRIDGE"),
    line({ fg: props.theme().text }, "OGB ", () => {
      const current = data();
      return el("span", { style: { fg: outcomeColor(props.theme(), current.outcome) } }, outcomeLabel(current.outcome));
    }),
    createComponent(SyncText, { panel: props.panel, theme: props.theme }),
    line({ fg: props.theme().textMuted }, ""),
    line({ fg: props.theme().text }, () => el("b", {}, bridgeInventoryText(data()))),
    () => {
      const current = data();
      const text = updateText(current);
      if (!text) return undefined;
      return line({ fg: current.updateRestartRequired || current.updateStatus === "error" ? props.theme().warning : props.theme().textMuted }, text);
    },
    () => {
      const current = data();
      if (current.warnings === 0 && current.errors === 0) return undefined;
      return line({ fg: current.errors > 0 ? props.theme().error : props.theme().warning }, String(current.warnings), " warn · ", String(current.errors), " err");
    },
  );
}

function Panel(props) {
  const [panel, setPanel] = createSignal(readPanel(props.root));
  const theme = () => props.api.theme.current;
  const refresh = () => setPanel(readPanel(props.root));
  let timer;

  onMount(() => {
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  return box({ gap: 1 },
    () => {
      const data = panel();
      if (!data.available) {
        return box({ gap: 0 },
          line({ fg: theme().textMuted }, "Dashboard missing"),
          line({ fg: theme().textMuted }, data.message),
        );
      }
      return box({ gap: 1 },
        () => externalQuotaPanel(props.root) ? undefined : createComponent(LimitsRows, { root: props.root, theme }),
        createComponent(BridgeRows, { panel, theme }),
      );
    },
  );
}

function PromptRight(props) {
  const [panel, setPanel] = createSignal(readPanel(props.root));
  const initialUsage = usageForSession(props.api, props.sessionId);
  const initialModel = selectedModelMeta(props.api, props.sessionId);
  const [usage, setUsage] = createSignal(initialUsage);
  const [selectedModel, setSelectedModel] = createSignal(initialModel);
  const [quota, setQuota] = createSignal(quotaForUi(props.api, props.sessionId, props.root, initialUsage, initialModel));
  const [elapsed, setElapsed] = createSignal(elapsedForSession(props.api, props.sessionId));
  const theme = () => props.api.theme.current;
  const suppressQuota = () => externalQuotaPanel(props.root);
  const hasQuota = () => Boolean(!suppressQuota() && quota().available && quota().promptLabel);
  const hasReset = () => Boolean(hasQuota() && quota().resetIn);
  let modelRefreshVersion = 0;
  const refreshModel = () => {
    const version = ++modelRefreshVersion;
    fetchSessionModelMeta(props.api, props.sessionId)
      .then((nextModel) => {
        if (version !== modelRefreshVersion) return;
        const safeModel = nextModel || {};
        setSelectedModel(safeModel);
        setQuota(quotaForUi(props.api, props.sessionId, props.root, usage(), safeModel));
      })
      .catch(() => {});
  };
  const refresh = () => {
    setPanel(readPanel(props.root));
    const nextUsage = usageForSession(props.api, props.sessionId);
    setUsage(nextUsage);
    setQuota(quotaForUi(props.api, props.sessionId, props.root, nextUsage, selectedModel()));
    setElapsed(elapsedForSession(props.api, props.sessionId));
    refreshModel();
  };
  let timer;
  let promptEventDisposers = [];

  onMount(() => {
    refresh();
    timer = setInterval(refresh, PROMPT_REFRESH_MS);
    if (props.api.event?.on) {
      const listen = (type, handler) => {
        const dispose = props.api.event.on(type, handler);
        if (typeof dispose === "function") promptEventDisposers.push(dispose);
      };
      const maybeRefresh = (event) => {
        const eventSessionId = event?.properties?.sessionID || event?.properties?.info?.id;
        if (!eventSessionId || eventSessionId === props.sessionId) refresh();
      };
      listen("tui.session.select", maybeRefresh);
      listen("session.updated", maybeRefresh);
      listen("tui.command.execute", maybeRefresh);
      listen("message.updated", maybeRefresh);
    }
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
    for (const dispose of promptEventDisposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
  });

  return box({ flexDirection: "row", gap: 0, flexShrink: 0 },
    line({ fg: theme().textMuted, wrapMode: "none" }, () => elapsed()),
    line({ fg: theme().textMuted, wrapMode: "none" }, () => hasQuota() ? (elapsed() ? " · " : "") + quota().promptLabel : ""),
    line({ fg: theme().textMuted, wrapMode: "none" }, () => hasReset() ? " · reset " + compactDurationLabel(quota().resetIn) : ""),
  );
}

const tui = async (api) => {
  const root = api.state.path.directory || process.cwd();
  registerElapsedEvents(api);

  api.slots.register({
    id: "ogb-sidebar-content",
    order: 160,
    slots: {
      sidebar_content() {
        return createComponent(Panel, { api, root });
      },
      session_prompt_right(_ctx, props) {
        return createComponent(PromptRight, { api, root, sessionId: props.session_id });
      },
    },
  });

  api.command.register(() => [
    {
      title: "Refresh OGB Sidebar",
      value: "ogb.sidebar.refresh",
      category: "OGB",
      onSelect() {
        api.ui.toast({ variant: "info", title: "OGB", message: "Sidebar refreshes automatically." });
      },
    },
  ]);
};

export default {
  id,
  tui,
};
`;

export interface TuiSidebarResult {
  plugin: {
    path: string;
    relPath: string;
    status: "created" | "updated" | "unchanged" | "preview" | "conflict";
    message: string;
  };
  config: {
    path: string;
    relPath: string;
    status: "created" | "updated" | "unchanged" | "preview" | "conflict";
    message: string;
  };
  pluginCheck: {
    ok: boolean;
    message: string;
  };
  warnings: string[];
}

function writeManagedText(options: {
  projectRoot: string;
  relPath: string;
  content: string;
  dryRun?: boolean;
  force?: boolean;
}): TuiSidebarResult["plugin"] {
  const absPath = path.join(options.projectRoot, ...options.relPath.split("/"));
  const desiredHash = sha256Text(options.content);

  if (options.dryRun) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: fs.existsSync(absPath) ? "unchanged" : "preview",
      message: fs.existsSync(absPath) ? `Would leave existing ${options.relPath}` : `Would create ${options.relPath}`,
    };
  }

  const state = readSyncState(options.projectRoot) ?? emptySyncState(OGB_VERSION);
  const previousHash = managedHashFor(state, options.relPath, "ogb");
  const exists = fs.existsSync(absPath);
  const currentText = exists ? fs.readFileSync(absPath, "utf8") : "";
  const currentHash = exists ? sha256Text(currentText) : undefined;

  if (exists && currentHash === desiredHash) {
    upsertManagedFile(state, { path: options.relPath, sha256: desiredHash, source: "ogb" });
    writeSyncState(state, options.projectRoot);
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already installed`,
    };
  }

  if (exists && !options.force && previousHash !== currentHash) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "conflict",
      message: `${options.relPath} exists and is not managed by ogb; use --force to overwrite`,
    };
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, options.content, "utf8");
  upsertManagedFile(state, { path: options.relPath, sha256: desiredHash, source: "ogb" });
  writeSyncState(state, options.projectRoot);

  return {
    path: absPath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function writeUnmanagedText(options: {
  filePath: string;
  relPath: string;
  content: string;
  dryRun?: boolean;
}): TuiSidebarResult["plugin"] {
  const exists = fs.existsSync(options.filePath);
  const current = exists ? fs.readFileSync(options.filePath, "utf8") : "";
  if (current === options.content) {
    return {
      path: options.filePath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already installed`,
    };
  }
  if (options.dryRun) {
    return {
      path: options.filePath,
      relPath: options.relPath,
      status: "preview",
      message: exists ? `Would update ${options.relPath}` : `Would create ${options.relPath}`,
    };
  }

  fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
  fs.writeFileSync(options.filePath, options.content, "utf8");
  return {
    path: options.filePath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function pluginSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Array.isArray(item) ? item[0] : item)
    .filter((item): item is string => typeof item === "string");
}

function requiredTuiPluginSpecs(extraPlugins: string[] | undefined): string[] {
  return [...new Set([...(extraPlugins ?? []), TUI_SIDEBAR_PLUGIN_SPEC].map((item) => item.trim()).filter(Boolean))];
}

function tuiConfigTextWithPlugin(currentText: string | undefined, extraPlugins?: string[]): { text?: string; changed: boolean; error?: string } {
  const requiredPlugins = requiredTuiPluginSpecs(extraPlugins);

  if (!currentText) {
    return {
      changed: true,
      text: `${JSON.stringify({
        $schema: "https://opencode.ai/tui.json",
        plugin: requiredPlugins,
      }, null, 2)}\n`,
    };
  }

  let parsed: any;
  try {
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    parsed = parseJsonc(currentText, errors);
    if (errors.length > 0) return { changed: false, error: "TUI config has invalid JSONC syntax" };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { changed: false, error: "TUI config root is not an object" };
  }

  if (parsed.plugin !== undefined && !Array.isArray(parsed.plugin)) {
    return { changed: false, error: "TUI config plugin field is not an array" };
  }

  const existingPlugins = pluginSpecs(parsed.plugin);
  const missingPlugins = requiredPlugins.filter((plugin) => !existingPlugins.includes(plugin));
  if (missingPlugins.length === 0) {
    return { changed: false, text: currentText };
  }

  try {
    if (parsed.plugin === undefined) {
      const edits = modify(currentText, ["plugin"], requiredPlugins, {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        });
      return { changed: true, text: `${applyEdits(currentText, edits).trimEnd()}\n` };
    }

    let text = currentText;
    for (const plugin of missingPlugins) {
      const edits = modify(text, ["plugin", -1], plugin, {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        });
      text = applyEdits(text, edits);
    }
    return { changed: true, text: `${text.trimEnd()}\n` };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function ensureTuiConfigFile(options: {
  configPath: string;
  relPath: string;
  dryRun?: boolean;
  extraPlugins?: string[];
  stateProjectRoot?: string;
}): TuiSidebarResult["config"] {
  const absPath = options.configPath;
  const exists = fs.existsSync(absPath);
  const currentText = exists ? fs.readFileSync(absPath, "utf8") : undefined;
  const next = tuiConfigTextWithPlugin(currentText, options.extraPlugins);

  if (next.error) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "conflict",
      message: `${options.relPath} could not be updated: ${next.error}`,
    };
  }

  if (options.dryRun) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: exists ? "unchanged" : "preview",
      message: next.changed ? `Would ${exists ? "update" : "create"} ${options.relPath}` : `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`,
    };
  }

  if (!next.text) {
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`,
    };
  }

  if (!next.changed) {
    if (options.stateProjectRoot) {
      const state = readSyncState(options.stateProjectRoot) ?? emptySyncState(OGB_VERSION);
      upsertManagedFile(state, { path: options.relPath, sha256: sha256Text(next.text), source: "ogb" });
      writeSyncState(state, options.stateProjectRoot);
    }
    return {
      path: absPath,
      relPath: options.relPath,
      status: "unchanged",
      message: `${options.relPath} already references ${TUI_SIDEBAR_PLUGIN_SPEC}`,
    };
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, next.text, "utf8");
  if (options.stateProjectRoot) {
    const state = readSyncState(options.stateProjectRoot) ?? emptySyncState(OGB_VERSION);
    upsertManagedFile(state, { path: options.relPath, sha256: sha256Text(next.text), source: "ogb" });
    writeSyncState(state, options.stateProjectRoot);
  }

  return {
    path: absPath,
    relPath: options.relPath,
    status: exists ? "updated" : "created",
    message: `${exists ? "Updated" : "Created"} ${options.relPath}`,
  };
}

function ensureTuiConfig(options: { projectRoot: string; dryRun?: boolean; extraPlugins?: string[] }): TuiSidebarResult["config"] {
  return ensureTuiConfigFile({
    configPath: path.join(options.projectRoot, ...TUI_CONFIG_PATH.split("/")),
    relPath: TUI_CONFIG_PATH,
    dryRun: options.dryRun,
    extraPlugins: options.extraPlugins,
    stateProjectRoot: options.projectRoot,
  });
}

export function checkTuiSidebarPluginSyntax(pluginPath?: string): TuiSidebarResult["pluginCheck"] {
  let target = pluginPath;
  let tempDir: string | undefined;

  if (!target) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-sidebar-check-"));
    target = path.join(tempDir, "ogb-sidebar.js");
    fs.writeFileSync(target, TUI_SIDEBAR_PLUGIN_SOURCE, "utf8");
  }

  const result = spawnSync(process.execPath, ["--check", target], {
    encoding: "utf8",
    timeout: 10_000,
  });

  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });

  if (result.error) {
    return {
      ok: false,
      message: `Could not run node --check: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      message: `TUI sidebar plugin syntax check failed${detail ? `: ${detail}` : ""}`,
    };
  }

  return {
    ok: true,
    message: "TUI sidebar plugin syntax check passed",
  };
}

export function ensureTuiSidebar(options: { projectRoot?: string; dryRun?: boolean; force?: boolean; extraPlugins?: string[] } = {}): TuiSidebarResult {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const warnings: string[] = [];
  const plugin = writeManagedText({
    projectRoot,
    relPath: TUI_SIDEBAR_PLUGIN_PATH,
    content: TUI_SIDEBAR_PLUGIN_SOURCE,
    dryRun: options.dryRun,
    force: options.force,
  });
  if (plugin.status === "conflict") warnings.push(plugin.message);

  const config = ensureTuiConfig({ projectRoot, dryRun: options.dryRun, extraPlugins: options.extraPlugins });
  if (config.status === "conflict") warnings.push(config.message);

  const pluginCheck = options.dryRun || plugin.status === "conflict"
    ? checkTuiSidebarPluginSyntax()
    : checkTuiSidebarPluginSyntax(plugin.path);
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);

  return {
    plugin,
    config,
    pluginCheck,
    warnings,
  };
}

export function ensureGlobalTuiSidebar(options: { configDir: string; dryRun?: boolean; extraPlugins?: string[] }): TuiSidebarResult {
  const configDir = path.resolve(options.configDir);
  const warnings: string[] = [];
  const pluginPath = path.join(configDir, ...GLOBAL_TUI_SIDEBAR_PLUGIN_PATH.split("/"));
  const plugin = writeUnmanagedText({
    filePath: pluginPath,
    relPath: GLOBAL_TUI_SIDEBAR_PLUGIN_PATH,
    content: TUI_SIDEBAR_PLUGIN_SOURCE,
    dryRun: options.dryRun,
  });

  const config = ensureTuiConfigFile({
    configPath: path.join(configDir, GLOBAL_TUI_CONFIG_PATH),
    relPath: GLOBAL_TUI_CONFIG_PATH,
    dryRun: options.dryRun,
    extraPlugins: options.extraPlugins,
  });
  if (config.status === "conflict") warnings.push(config.message);

  const pluginCheck = options.dryRun
    ? checkTuiSidebarPluginSyntax()
    : checkTuiSidebarPluginSyntax(plugin.path);
  if (!pluginCheck.ok) warnings.push(pluginCheck.message);

  return {
    plugin,
    config,
    pluginCheck,
    warnings,
  };
}
