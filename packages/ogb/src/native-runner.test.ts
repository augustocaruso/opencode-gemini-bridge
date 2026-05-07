import assert from "node:assert/strict";
import test from "node:test";
import { prepareNativeCommand, runNativeCommand } from "./native-runner.js";

test("runner contract executes Windows .cmd through cmd.exe", () => {
  const prepared = prepareNativeCommand({
    command: "C:\\Users\\leona\\AppData\\Roaming\\npm\\opencode.cmd",
    args: ["debug", "info"],
    platform: "win32",
  });

  assert.match(prepared.command, /cmd\.exe$/i);
  assert.deepEqual(prepared.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(prepared.args[3], /opencode\.cmd/);
  assert.equal(prepared.windowsVerbatimArguments, true);
});

test("runner contract executes Windows .bat through cmd.exe", () => {
  const prepared = prepareNativeCommand({
    command: "C:\\Tools\\ogb tools\\repair.bat",
    args: ["--safe"],
    platform: "win32",
  });

  assert.match(prepared.command, /cmd\.exe$/i);
  assert.match(prepared.args[3], /repair\.bat/);
  assert.equal(prepared.windowsVerbatimArguments, true);
});

test("runner contract executes Windows .exe directly", () => {
  const prepared = prepareNativeCommand({
    command: "\"C:\\Program Files\\nodejs\\node.exe\"",
    args: ["--version"],
    platform: "win32",
  });

  assert.equal(prepared.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(prepared.args, ["--version"]);
  assert.equal(prepared.windowsVerbatimArguments, undefined);
});

test("runner contract treats stderr with exit 0 as successful diagnostic output", () => {
  const result = runNativeCommand({
    command: "npm",
    args: ["install"],
    platform: "darwin",
  }, (command, args, options) => ({
    pid: 123,
    output: [],
    signal: null,
    status: 0,
    stdout: "installed\n",
    stderr: "npm warn deprecated koa-router\n",
    error: undefined,
  } as any));

  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "installed\n");
  assert.match(result.stderr, /deprecated/);
});

test("runner contract preserves command, args, status, signal, and error", () => {
  const result = runNativeCommand({
    command: "ogb",
    args: ["check"],
    platform: "darwin",
  }, () => ({
    pid: 123,
    output: [],
    signal: "SIGTERM",
    status: null,
    stdout: "",
    stderr: "stopped\n",
    error: new Error("spawn failed"),
  } as any));

  assert.equal(result.ok, false);
  assert.equal(result.command, "ogb");
  assert.deepEqual(result.args, ["check"]);
  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.error, "spawn failed");
});

test("runner contract forwards cwd, env, timeout, and stdio to the native process", () => {
  const result = runNativeCommand({
    command: "node",
    args: ["--version"],
    cwd: "/tmp/project",
    env: { OGB_TEST: "1" },
    timeoutMs: 1234,
    stdio: "inherit",
  }, (_command, _args, options) => {
    assert.equal(options.cwd, "/tmp/project");
    assert.deepEqual(options.env, { OGB_TEST: "1" });
    assert.equal(options.timeout, 1234);
    assert.equal(options.stdio, "inherit");
    return {
      pid: 123,
      output: [],
      signal: null,
      status: 0,
      stdout: null,
      stderr: null,
      error: undefined,
    } as any;
  });

  assert.equal(result.ok, true);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
