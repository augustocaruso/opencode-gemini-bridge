import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCommand } from "./command-resolution.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-command-"));
}

test("resolveCommand prefers Windows npm cmd shim for an extensionless command path", () => {
  const root = tempRoot();
  const shim = path.join(root, "opencode");
  fs.writeFileSync(`${shim}.cmd`, "@echo off\n", "utf8");

  assert.equal(
    resolveCommand(shim, {
      platform: "win32",
      includeLookup: false,
      includeNpmPrefix: false,
    }),
    `${shim}.cmd`,
  );
});

test("resolveCommand searches the Windows AppData npm directory", () => {
  const root = tempRoot();
  const homeDir = path.join(root, "home");
  const appData = path.join(homeDir, "AppData", "Roaming");
  const npmDir = path.join(appData, "npm");
  fs.mkdirSync(npmDir, { recursive: true });
  const shim = path.join(npmDir, "opencode.cmd");
  fs.writeFileSync(shim, "@echo off\n", "utf8");

  assert.equal(
    resolveCommand("opencode", {
      homeDir,
      platform: "win32",
      env: { APPDATA: appData },
      includeLookup: false,
      includeNpmPrefix: false,
    }),
    shim,
  );
});
