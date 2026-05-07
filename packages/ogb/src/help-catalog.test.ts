import assert from "node:assert/strict";
import test from "node:test";
import { filterHelpCommands, findHelpCommand, formatHelpCatalog, formatHelpCommand, HELP_COMMANDS } from "./help-catalog.js";

test("help catalog exposes the recommended cargo-like commands", () => {
  const recommended = HELP_COMMANDS.filter((command) => command.recommended).map((command) => command.name);

  assert.deepEqual(recommended, ["install", "update", "check", "reset", "dashboard"]);
});

test("help catalog resolves aliases to their canonical command", () => {
  assert.equal(findHelpCommand("pass")?.name, "check");
  assert.equal(findHelpCommand("self-update")?.name, "update");
  assert.equal(findHelpCommand("bridge")?.name, "dashboard");
  assert.equal(findHelpCommand("quota")?.name, "limits");
});

test("help catalog filters commands by command name, alias, category, and description", () => {
  assert.deepEqual(filterHelpCommands("fallback").map((command) => command.name).slice(0, 3), ["install", "setup-ux"]);
  assert.ok(filterHelpCommands("Extensions").some((command) => command.name === "trust-report"));
  assert.ok(filterHelpCommands("self-update").some((command) => command.name === "update"));
  assert.ok(filterHelpCommands("--reset-global").some((command) => command.name === "install"));
});

test("plain help catalog and command details include descriptions and examples", () => {
  const catalog = formatHelpCatalog();
  const check = formatHelpCommand(findHelpCommand("check")!);

  assert.match(catalog, /Recommended/);
  assert.match(catalog, /install\s+Install or reinstall/);
  assert.match(catalog, /Use `ogb help <command>`/);
  assert.match(check, /Run the complete bridge health ritual/);
  assert.match(check, /Usage: ogb check/);
  assert.match(check, /Examples/);
});

