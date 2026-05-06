import assert from "node:assert/strict";
import test from "node:test";
import { STARTUP_SYNC_PLUGIN_SOURCE } from "./setup-opencode.js";

test("startup plugin wraps Windows cmd shims before spawning", () => {
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /function commandForPlatform/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /process\.platform !== "win32"/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /cmd\.exe/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /\["call", cmdToken\(command, true\)/);
  assert.match(STARTUP_SYNC_PLUGIN_SOURCE, /spawn\(normalized\.command, normalized\.args/);
});
