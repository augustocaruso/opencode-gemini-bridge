import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_PASS_WARNING, LEGACY_SELF_UPDATE_WARNING, LEGACY_UPGRADE_WARNING, program } from "./cli.js";

function command(name: string) {
  const found = program.commands.find((candidate) => candidate.name() === name);
  assert.ok(found, `expected ogb ${name} to be registered`);
  return found;
}

test("CLI exposes the first cargo-like installer API verbs", () => {
  assert.match(command("install").description(), /Install or reinstall/);
  assert.match(command("check").description(), /full bridge check/);
  assert.match(command("update").description(), /post-update check/);
  assert.match(command("reset").description(), /Reset the global OGB\/OpenCode profile/);
});

test("legacy installer API verbs stay available with explicit warnings", () => {
  assert.equal(command("pass").description(), "Deprecated alias for check");
  assert.equal(command("self-update").description(), "Deprecated alias for update");
  assert.equal(command("upgrade-ogb").description(), "Deprecated alias for update");
  assert.equal(LEGACY_PASS_WARNING, "warning: ogb pass is deprecated; use ogb check.");
  assert.equal(LEGACY_SELF_UPDATE_WARNING, "warning: ogb self-update is deprecated; use ogb update.");
  assert.equal(LEGACY_UPGRADE_WARNING, "warning: ogb upgrade-ogb is deprecated; use ogb update.");
});

test("user-facing installer verbs keep a stable plain output escape hatch", () => {
  for (const name of ["install", "check", "pass", "update", "self-update", "upgrade-ogb", "reset"]) {
    assert.ok(command(name).options.some((option) => option.long === "--plain"), `expected ogb ${name} to support --plain`);
  }
});
