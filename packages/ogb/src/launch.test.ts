import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenCodeLaunchArgs } from "./launch.js";

test("buildOpenCodeLaunchArgs starts OpenCode normally by default", () => {
  assert.deepEqual(buildOpenCodeLaunchArgs({}), []);
});

test("buildOpenCodeLaunchArgs can start OpenCode with an explicit agent", () => {
  assert.deepEqual(buildOpenCodeLaunchArgs({ agent: "YOLO" }), ["--agent", "YOLO"]);
});

test("buildOpenCodeLaunchArgs provides a YOLO shortcut", () => {
  assert.deepEqual(buildOpenCodeLaunchArgs({ yolo: true }), ["--agent", "YOLO"]);
});

test("buildOpenCodeLaunchArgs rejects conflicting agent options", () => {
  assert.throws(() => buildOpenCodeLaunchArgs({ yolo: true, agent: "agent" }), /Use --yolo or --agent agent/);
});
