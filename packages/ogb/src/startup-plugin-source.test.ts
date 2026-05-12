import assert from "node:assert/strict";
import test from "node:test";
import { STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";

test("startup plugin wraps Windows cmd shims before spawning", () => {
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function commandForPlatform/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function normalizeCommandInput/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /escapedFirst ===/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /normalized\.slice\(2, -2\)/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /process\.platform !== "win32"/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /cmd\.exe/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /\["\/d", "\/s", "\/c", commandLine\]/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /windowsVerbatimArguments: true/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /windowsVerbatimArguments: normalized\.windowsVerbatimArguments === true/);
  assert.doesNotMatch(STARTUP_SYNC_PLUGIN_SOURCE, /\["call", cmdToken\(normalizedCommand, true\)/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /spawn\(normalized\.command, normalized\.args/);
});

test("startup plugin uses the dedicated startup command and quiet lifecycle", () => {
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /const DEFAULT_ARGS = \["startup-sync"\]/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /const LIMITS_ARGS = \["limits", "--json"\]/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /const DEFAULT_LIMITS_REFRESH_MS = 60_000/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /const startupEvents = new Set\(\["session\.created"\]\)/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /failure backoff is active/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /already attempted in this OpenCode process/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function limitsPlanFrom\(syncPlan\)/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function scheduleLimitsRefresh\(\)/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /OGB_LIMITS_REFRESH_MS/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /ogb limits refreshed/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function safeUpdateArgs/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /\["auto-update", "update", "self-update", "upgrade-ogb"\]/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function withoutProjectArgs/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /commandName === "bridge"\) return \[plan\(\["check"/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /export default OgbStartupSync/);
  assert.doesNotMatch(STARTUP_SYNC_PLUGIN_SOURCE, /"session\.updated", "session\.idle"/);
});
