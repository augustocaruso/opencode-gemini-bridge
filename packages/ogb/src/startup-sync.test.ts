import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runStartupSync } from "./startup-sync.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-startup-sync-"));
}

test("runStartupSync treats global sync warnings as non-fatal", () => {
  const homeDir = tempHome();
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "# Global Gemini\n", "utf8");
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      local: {
        command: "node",
        args: ["server.js"],
      },
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
    mcp: [],
  }, null, 2), "utf8");

  const report = runStartupSync({ projectRoot: homeDir, homeDir });

  assert.equal(report.outcome, "pass");
  assert.equal(report.homeMode, true);
  assert.equal(report.errors.length, 0);
  assert.ok(report.warnings.some((warning) => warning.includes("non-object mcp field")));
});

test("runStartupSync writes the global expanded context in home mode", () => {
  const homeDir = tempHome();
  fs.mkdirSync(path.join(homeDir, ".gemini", "extensions", "study"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extensions", "study", "GEMINI.md"), "# Extension Context\n", "utf8");

  const report = runStartupSync({ projectRoot: homeDir, homeDir });
  const expandedPath = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md");

  assert.equal(report.outcome, "pass");
  assert.equal(fs.existsSync(expandedPath), true);
  assert.match(fs.readFileSync(expandedPath, "utf8"), /Extension Context/);
});

test("runStartupSync treats a quoted home project path as global home mode", () => {
  const homeDir = tempHome();
  fs.mkdirSync(path.join(homeDir, ".gemini", "extensions", "study"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "extensions", "study", "GEMINI.md"), "# Extension Context\n", "utf8");

  const report = runStartupSync({ projectRoot: `"${homeDir}"`, homeDir });
  const expandedPath = path.join(homeDir, ".config", "opencode-gemini-bridge", "generated", "GEMINI.expanded.md");

  assert.equal(report.outcome, "pass");
  assert.equal(report.homeMode, true);
  assert.equal(report.projectRoot, path.resolve(homeDir));
  assert.equal(fs.existsSync(expandedPath), true);
  assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "generated")), false);
});
