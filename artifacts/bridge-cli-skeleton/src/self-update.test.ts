import assert from "node:assert/strict";
import test from "node:test";
import { buildSelfUpdateCommand, runSelfUpdate } from "./self-update.js";

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
  assert.match(command.join(" "), /bootstrap-windows\.ps1/);
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
