import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSelfUpdateCommand, checkOgbUpdate, runAutoUpdate, runSelfUpdate } from "./self-update.js";
import { resolveProjectPaths } from "./paths.js";

test("buildSelfUpdateCommand uses GitHub bootstrap on POSIX platforms", () => {
  const command = buildSelfUpdateCommand({
    projectRoot: "/tmp/ogb project",
    prefix: "/tmp/ogb-prefix",
    rulesync: "off",
    setup: false,
    ux: false,
    installOpenCode: false,
    force: true,
  }, "darwin");

  assert.equal(command[0], "bash");
  assert.equal(command[1], "-lc");
  assert.match(command[2], /bootstrap-mac\.sh/);
  assert.match(command[2], /--repo/);
  assert.match(command[2], /augustocaruso\/opencode-gemini-bridge/);
  assert.match(command[2], /--version/);
  assert.match(command[2], /latest/);
  assert.match(command[2], /--project/);
  assert.match(command[2], /ogb project/);
  assert.match(command[2], /--no-setup/);
  assert.match(command[2], /--no-ux/);
  assert.match(command[2], /--no-opencode/);
  assert.match(command[2], /--force/);
});

test("buildSelfUpdateCommand uses PowerShell bootstrap on Windows", () => {
  const command = buildSelfUpdateCommand({
    repo: "acme/bridge",
    version: "v9.9.9",
    projectRoot: "C:\\Users\\Friend\\Project",
    setup: false,
    ux: false,
    installOpenCode: false,
  }, "win32");

  assert.equal(command[0], "powershell.exe");
  assert.match(command.join(" "), /scripts\/bootstrap-windows\.ps1/);
  assert.match(command.join(" "), /PSNativeCommandUseErrorActionPreference = \$false/);
  assert.match(command.join(" "), /-Repo 'acme\/bridge'/);
  assert.match(command.join(" "), /-Version 'v9\.9\.9'/);
  assert.match(command.join(" "), /-NoSetup/);
  assert.match(command.join(" "), /-NoUx/);
  assert.match(command.join(" "), /-NoOpenCode/);
});

test("runSelfUpdate dry-run does not execute the bootstrap", () => {
  const report = runSelfUpdate({ dryRun: true, projectRoot: "/tmp/ogb" });

  assert.equal(report.status, "preview");
  assert.equal(report.command[0], process.platform === "win32" ? "powershell.exe" : "bash");
  assert.match(report.message, /Would download/);
});

test("buildSelfUpdateCommand rejects invalid repo names", () => {
  assert.throws(() => buildSelfUpdateCommand({ repo: "bad;repo" }), /OWNER\/REPO/);
});

test("checkOgbUpdate reports available releases and writes status", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-update-"));
  const report = await checkOgbUpdate({
    projectRoot,
    currentVersion: "0.0.38",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v0.0.39",
        html_url: "https://github.com/acme/bridge/releases/tag/v0.0.39",
      }),
    }),
    now: new Date("2026-05-06T12:00:00.000Z"),
  });

  assert.equal(report.status, "available");
  assert.equal(report.latestVersion, "0.0.39");
  assert.equal(report.latestTag, "v0.0.39");
  const saved = JSON.parse(fs.readFileSync(resolveProjectPaths(projectRoot).updateStatusPath, "utf8"));
  assert.equal(saved.status, "available");
  assert.equal(saved.checkedAt, "2026-05-06T12:00:00.000Z");
});

test("checkOgbUpdate reports current when latest tag matches current version", async () => {
  const report = await checkOgbUpdate({
    currentVersion: "0.0.38",
    write: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v0.0.38" }),
    }),
  });

  assert.equal(report.status, "current");
});

test("runAutoUpdate dry-run builds a self-update command without installing OpenCode", async () => {
  const report = await runAutoUpdate({
    currentVersion: "0.0.38",
    projectRoot: "/tmp/ogb-auto",
    dryRun: true,
    write: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v0.0.39" }),
    }),
  });

  assert.equal(report.status, "available");
  assert.equal(report.restartRequired, false);
  assert.ok(report.selfUpdate);
  assert.match(report.selfUpdate.command.join(" "), /v0\.0\.39/);
  assert.match(report.selfUpdate.command.join(" "), /no-(opencode|openCode)/i);
});

test("checkOgbUpdate reports unknown when the release lookup fails", async () => {
  const report = await checkOgbUpdate({
    currentVersion: "0.0.38",
    write: false,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }),
  });

  assert.equal(report.status, "unknown");
  assert.match(report.message, /HTTP 500/);
});
