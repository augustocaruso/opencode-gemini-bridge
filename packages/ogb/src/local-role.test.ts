import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  disableMaintainerRole,
  enableMaintainerRole,
  LOCAL_ROLE_SCHEMA,
  localRolePath,
  readLocalRole,
} from "./local-role.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-role-"));
}

test("maintainer local-role helpers create, read, and remove the local flag", () => {
  const homeDir = path.join(tempRoot(), "home");
  const enabled = enableMaintainerRole({ homeDir });

  assert.equal(enabled.enabled, true);
  assert.equal(enabled.role, "maintainer");
  assert.equal(enabled.schema, LOCAL_ROLE_SCHEMA);
  assert.equal(enabled.path, path.join(homeDir, ".config", "opencode-gemini-bridge", "local-role.json"));
  assert.equal(readLocalRole({ homeDir }).enabled, true);

  const disabled = disableMaintainerRole({ homeDir });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.role, "user");
  assert.equal(fs.existsSync(enabled.path), false);
});

test("local-role flag path uses the platform adapter on Windows", () => {
  assert.equal(
    localRolePath({
      homeDir: "C:\\Users\\Ada",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" },
    }),
    "C:\\Users\\Ada\\.config\\opencode-gemini-bridge\\local-role.json",
  );
});

test("CLI maintainer enable/status/disable manage the local flag", () => {
  const homeDir = path.join(tempRoot(), "home");
  fs.mkdirSync(homeDir, { recursive: true });
  const cli = path.join(process.cwd(), "src", "cli.ts");
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const env = { ...process.env, HOME: homeDir };
  const run = (args: string[]) => spawnSync(process.execPath, [tsx, cli, "--project", homeDir, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  const enabled = run(["maintainer", "enable", "--json"]);
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(JSON.parse(enabled.stdout).enabled, true);

  const status = run(["maintainer", "status", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).role, "maintainer");

  const disabled = run(["maintainer", "disable", "--json"]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(JSON.parse(disabled.stdout).enabled, false);
  assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode-gemini-bridge", "local-role.json")), false);
});
