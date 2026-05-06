import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRefreshParts, refreshQuota, summarizeQuotaBuckets } from "./quota.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeGeminiAuthConstants(homeDir: string, packageDir = "opencode-gemini-auth@latest"): void {
  const constants = path.join(homeDir, ".cache", "opencode", "packages", packageDir, "node_modules", "opencode-gemini-auth", "src", "constants.ts");
  fs.mkdirSync(path.dirname(constants), { recursive: true });
  fs.writeFileSync(constants, [
    'export const GEMINI_CLIENT_ID = "client-id";',
    'export const GEMINI_CLIENT_SECRET = "client-secret";',
    "",
  ].join("\n"), "utf8");
}

test("parseRefreshParts reads OpenCode Gemini managed project ids", () => {
  assert.deepEqual(parseRefreshParts("refresh-token|user-project|managed-project"), {
    refreshToken: "refresh-token",
    projectId: "user-project",
    managedProjectId: "managed-project",
  });
});

test("summarizeQuotaBuckets reports the most constrained bucket as used quota", () => {
  const result = summarizeQuotaBuckets([
    {
      modelId: "gemini-3-flash-preview",
      remainingFraction: 0.982,
      resetTime: "2026-05-05T14:00:00.000Z",
    },
    {
      modelId: "gemini-3-pro-preview",
      remainingFraction: 0.98,
      resetTime: "2026-05-04T21:00:00.000Z",
    },
  ]);

  assert.equal(result.summary.modelId, "gemini-3-pro-preview");
  assert.equal(result.summary.remainingPercent, 98);
  assert.equal(result.summary.usedPercent, 2);
  assert.equal(result.summary.label, "2% used");
  assert.equal(result.buckets.length, 2);
});

test("summarizeQuotaBuckets keeps vertex variants readable", () => {
  const result = summarizeQuotaBuckets([
    {
      modelId: "gemini-2.5-pro_vertex",
      remainingFraction: 0.5,
      tokenType: "tokens",
    },
  ]);

  assert.equal(result.buckets[0]?.modelId, "gemini-2.5-pro");
  assert.equal(result.buckets[0]?.variant, "vertex");
  assert.equal(result.buckets[0]?.tokenType, "TOKENS");
  assert.equal(result.summary.label, "50% used");
});

test("refreshQuota reads OpenCode auth and writes a safe quota cache", async () => {
  const projectRoot = tempDir("ogb-quota-project-");
  const homeDir = tempDir("ogb-quota-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  const originalAuth = {
    google: {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token|user-project|managed-project",
      expires: Date.now() + 60 * 60 * 1000,
    },
  };
  writeJson(authFile, originalAuth);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer access-token");
    assert.equal(init?.body, JSON.stringify({ project: "managed-project" }));
    return new Response(JSON.stringify({
      buckets: [
        { modelId: "gemini-3-pro-preview", remainingFraction: 0.98, resetTime: "2026-05-04T21:00:00.000Z" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshQuota({ projectRoot, homeDir, force: true });
    const cacheFile = path.join(projectRoot, ".opencode", "generated", "ogb-quota.json");

    assert.equal(report.status, "ok");
    assert.equal(report.projectId, "managed-project");
    assert.equal(report.summary.label, "2% used");
    assert.equal(fs.existsSync(cacheFile), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(authFile, "utf8")), originalAuth);
    assert.doesNotMatch(fs.readFileSync(cacheFile, "utf8"), /access-token|refresh-token/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshQuota does not refresh expired Gemini OAuth without configured client credentials", async () => {
  const projectRoot = tempDir("ogb-quota-project-");
  const homeDir = tempDir("ogb-quota-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  writeJson(authFile, {
    google: {
      type: "oauth",
      access: "expired-access-token",
      refresh: "refresh-token|user-project|managed-project",
      expires: Date.now() - 60 * 1000,
    },
  });

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("fetch should not run without OGB_GEMINI_CLIENT_ID and OGB_GEMINI_CLIENT_SECRET");
  }) as typeof fetch;

  try {
    const report = await refreshQuota({ projectRoot, homeDir, force: true });
    assert.equal(report.status, "unavailable");
    assert.match(report.message ?? "", /Token Google indisponivel/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshQuota finds Gemini auth constants in versioned OpenCode plugin package dirs", async () => {
  const projectRoot = tempDir("ogb-quota-project-");
  const homeDir = tempDir("ogb-quota-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  writeGeminiAuthConstants(homeDir, "opencode-gemini-auth@1.4.12");
  writeJson(authFile, {
    google: {
      type: "oauth",
      access: "expired-access-token",
      refresh: "refresh-token|user-project|managed-project",
      expires: Date.now() - 60 * 1000,
    },
  });

  const calls: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    if (String(input) === "https://oauth2.googleapis.com/token") {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("client_id"), "client-id");
      assert.equal(body.get("client_secret"), "client-secret");
      return new Response(JSON.stringify({ access_token: "fresh-access-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      buckets: [
        { modelId: "gemini-3-flash-preview", remainingFraction: 0.88 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshQuota({ projectRoot, homeDir, force: true });
    assert.equal(report.status, "ok");
    assert.deepEqual(calls, [
      "https://oauth2.googleapis.com/token",
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("refreshQuota refreshes expired Gemini OAuth using installed auth plugin constants", async () => {
  const projectRoot = tempDir("ogb-quota-project-");
  const homeDir = tempDir("ogb-quota-home-");
  const authFile = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  writeGeminiAuthConstants(homeDir);
  writeJson(authFile, {
    google: {
      type: "oauth",
      access: "expired-access-token",
      refresh: "refresh-token|user-project|managed-project",
      expires: Date.now() - 60 * 1000,
    },
  });

  const calls: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    if (String(input) === "https://oauth2.googleapis.com/token") {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("client_id"), "client-id");
      assert.equal(body.get("client_secret"), "client-secret");
      assert.equal(body.get("refresh_token"), "refresh-token");
      return new Response(JSON.stringify({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(String(input), "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fresh-access-token");
    return new Response(JSON.stringify({
      buckets: [
        { modelId: "gemini-3-flash-preview", remainingFraction: 0.88 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const report = await refreshQuota({ projectRoot, homeDir, force: true });
    const stored = JSON.parse(fs.readFileSync(authFile, "utf8"));

    assert.equal(report.status, "ok");
    assert.deepEqual(calls, [
      "https://oauth2.googleapis.com/token",
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    ]);
    assert.equal(stored.google.access, "fresh-access-token");
    assert.match(stored.google.refresh, /^rotated-refresh-token\|user-project\|managed-project$/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
