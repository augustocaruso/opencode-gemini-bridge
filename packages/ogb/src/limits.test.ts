import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshLimits } from "./limits.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAnthropicAuthConstants(homeDir: string): void {
  const constants = path.join(homeDir, ".cache", "opencode", "packages", "@ex-machina", "opencode-anthropic-auth@latest", "node_modules", "@ex-machina", "opencode-anthropic-auth", "dist", "constants.js");
  fs.mkdirSync(path.dirname(constants), { recursive: true });
  fs.writeFileSync(constants, "export const CLIENT_ID = 'anthropic-client-id';\n", "utf8");
}

test("refreshLimits stores OpenUsage providers in a safe cache", async () => {
  const projectRoot = tempDir("ogb-limits-project-");
  const homeDir = tempDir("ogb-limits-home-");
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "http://127.0.0.1:6736/v1/usage");
    return new Response(JSON.stringify([
      {
        providerId: "codex",
        displayName: "OpenAI",
        plan: "Plus",
        fetchedAt: "2026-05-04T12:00:00.000Z",
        lines: [
          { label: "Session", type: "progress", used: 20, limit: 100, resetsAt: "2026-05-04T16:00:00.000Z" },
        ],
      },
      {
        providerId: "claude",
        displayName: "Anthropic",
        plan: "Max",
        fetchedAt: "2026-05-04T12:00:00.000Z",
        lines: [
          { label: "Weekly", type: "progress", used: 40, limit: 100, resetsAt: "2026-05-06T16:00:00.000Z" },
        ],
      },
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshLimits({ projectRoot, homeDir, force: true, includeGeminiFallback: false });
    const cacheFile = path.join(projectRoot, ".opencode", "generated", "ogb-limits.json");

    assert.equal(report.status, "ok");
    assert.equal(report.providers.length, 2);
    assert.equal(report.sources.openusage.status, "ok");
    assert.equal(fs.existsSync(cacheFile), true);
    assert.match(fs.readFileSync(cacheFile, "utf8"), /OpenAI/);
    assert.match(fs.readFileSync(cacheFile, "utf8"), /Anthropic/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshLimits uses native OpenAI OAuth fallback when OpenUsage is unavailable", async () => {
  const projectRoot = tempDir("ogb-limits-project-");
  const homeDir = tempDir("ogb-limits-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({
    openai: {
      type: "oauth",
      access: "header.payload.signature",
      expires: Date.now() + 60_000,
      accountId: "acct_test",
    },
  }), "utf8");

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === "http://127.0.0.1:6736/v1/usage") {
      throw new Error("offline");
    }
    assert.equal(String(input), "https://chatgpt.com/backend-api/wham/usage");
    assert.equal((init?.headers as Record<string, string>)["ChatGPT-Account-Id"], "acct_test");
    assert.match((init?.headers as Record<string, string>).Authorization, /^Bearer /);
    return new Response(JSON.stringify({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 18,
          reset_after_seconds: 7200,
        },
        secondary_window: {
          used_percent: 24,
          reset_after_seconds: 68400,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 11,
          reset_after_seconds: 93600,
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshLimits({ projectRoot, homeDir, force: true, includeGeminiFallback: false, includeAnthropicFallback: false });
    const openai = report.providers.find((provider) => provider.providerId === "openai");

    assert.equal(report.status, "ok");
    assert.equal(report.sources.openusage.status, "unavailable");
    assert.equal(report.sources.openaiChatGPT?.status, "ok");
    assert.equal(openai?.displayName, "OpenAI");
    assert.equal(openai?.plan, "Pro");
    assert.deepEqual(openai?.lines?.map((line) => [line.label, line.used]), [
      ["Session", 18],
      ["Weekly", 24],
      ["Reviews", 11],
    ]);
    assert.ok(report.warnings.some((warning) => warning.includes("native ChatGPT OAuth fallback")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshLimits uses native Anthropic OAuth fallback when OpenUsage is unavailable", async () => {
  const projectRoot = tempDir("ogb-limits-project-");
  const homeDir = tempDir("ogb-limits-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({
    anthropic: {
      type: "oauth",
      access: "anthropic_test_token",
      refresh: "refresh_test",
      expires: Date.now() + 60_000,
    },
  }), "utf8");

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === "http://127.0.0.1:6736/v1/usage") {
      throw new Error("offline");
    }
    assert.equal(String(input), "https://api.anthropic.com/api/oauth/usage");
    assert.equal((init?.headers as Record<string, string>)["anthropic-beta"], "oauth-2025-04-20");
    assert.match((init?.headers as Record<string, string>).Authorization, /^Bearer /);
    return new Response(JSON.stringify({
      five_hour: {
        utilization: 30,
        resets_at: "2026-05-04T22:50:00.000Z",
      },
      seven_day: {
        utilization: 21,
        resets_at: "2026-05-07T04:00:00.000Z",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshLimits({
      projectRoot,
      homeDir,
      force: true,
      includeGeminiFallback: false,
      includeOpenAIFallback: false,
    });
    const claude = report.providers.find((provider) => provider.providerId === "anthropic");

    assert.equal(report.status, "ok");
    assert.equal(report.sources.openusage.status, "unavailable");
    assert.equal(report.sources.anthropicClaude?.status, "ok");
    assert.equal(claude?.displayName, "Claude");
    assert.deepEqual(claude?.lines?.map((line) => [line.label, line.used]), [
      ["Session", 30],
      ["Weekly", 21],
    ]);
    assert.ok(report.warnings.some((warning) => warning.includes("native Anthropic OAuth fallback")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshLimits refreshes expired Anthropic OAuth before reading usage", async () => {
  const projectRoot = tempDir("ogb-limits-project-");
  const homeDir = tempDir("ogb-limits-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  writeAnthropicAuthConstants(homeDir);
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({
    anthropic: {
      type: "oauth",
      access: "expired_anthropic_token",
      refresh: "anthropic_refresh",
      expires: Date.now() - 60_000,
    },
  }), "utf8");

  const calls: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    if (String(input) === "http://127.0.0.1:6736/v1/usage") {
      throw new Error("offline");
    }
    if (String(input) === "https://platform.claude.com/v1/oauth/token") {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        grant_type: "refresh_token",
        refresh_token: "anthropic_refresh",
        client_id: "anthropic-client-id",
      });
      return new Response(JSON.stringify({
        access_token: "fresh_anthropic_token",
        refresh_token: "rotated_anthropic_refresh",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(String(input), "https://api.anthropic.com/api/oauth/usage");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fresh_anthropic_token");
    return new Response(JSON.stringify({
      five_hour: { utilization: 12, resets_at: "2026-05-04T22:50:00.000Z" },
      seven_day: { utilization: 3, resets_at: "2026-05-07T04:00:00.000Z" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshLimits({
      projectRoot,
      homeDir,
      force: true,
      includeGeminiFallback: false,
      includeOpenAIFallback: false,
    });
    const stored = JSON.parse(fs.readFileSync(authFile, "utf8"));

    assert.equal(report.sources.anthropicClaude?.status, "ok");
    assert.equal(report.providers.find((provider) => provider.providerId === "anthropic")?.lines?.[0]?.used, 12);
    assert.equal(stored.anthropic.access, "fresh_anthropic_token");
    assert.equal(stored.anthropic.refresh, "rotated_anthropic_refresh");
    assert.deepEqual(calls, [
      "http://127.0.0.1:6736/v1/usage",
      "https://platform.claude.com/v1/oauth/token",
      "https://api.anthropic.com/api/oauth/usage",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshLimits reports unavailable when OpenUsage and Gemini fallback are unavailable", async () => {
  const projectRoot = tempDir("ogb-limits-project-");
  const homeDir = tempDir("ogb-limits-home-");
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  try {
    const report = await refreshLimits({ projectRoot, homeDir, force: true });

    assert.equal(report.status, "unavailable");
    assert.equal(report.providers.length, 0);
    assert.equal(report.sources.openusage.status, "unavailable");
    assert.equal(report.sources.openaiChatGPT?.status, "unavailable");
    assert.equal(report.sources.anthropicClaude?.status, "unavailable");
    assert.equal(report.sources.geminiCodeAssist.status, "unavailable");
    assert.ok(report.warnings.some((warning) => warning.includes("OpenUsage offline")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});
