import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureProjectConfig, configReferencesExpandedGemini } from "./project-config.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-config-"));
}

test("ensureProjectConfig creates a conservative OpenCode config and avoids manual overwrite", () => {
  const projectRoot = tempProject();
  const created = ensureProjectConfig({ projectRoot });

  assert.equal(created.status, "created");
  assert.equal(configReferencesExpandedGemini(projectRoot), true);
  const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "lsp"), false);
  assert.equal(parsed.default_agent, "agent");
  assert.equal(parsed.agent.build.disable, true);
  assert.equal(parsed.agent.agent.mode, "primary");
  assert.equal(parsed.agent.agent.permission.question, "allow");
  assert.equal(parsed.agent.agent.permission.plan_enter, "allow");
  assert.equal(parsed.agent.agent.permission.bash["*"], "ask");
  assert.equal(parsed.agent.agent.permission.bash["git status*"], "allow");
  assert.equal(parsed.agent.agent.permission.bash["rg*"], "allow");
  assert.equal(parsed.agent.agent.permission.bash["git push*"], "deny");
  assert.equal(parsed.agent.plan.permission.bash["*"], "ask");
  assert.equal(parsed.agent.plan.permission.bash["git status*"], "allow");
  assert.equal(parsed.agent.plan.permission.bash["rg*"], "allow");
  assert.equal(parsed.agent.plan.permission.bash["git push*"], "deny");
  assert.equal(parsed.agent.plan.permission.edit, "ask");
  assert.equal(parsed.agent.plan.permission.question, "allow");

  const unchanged = ensureProjectConfig({ projectRoot });
  assert.equal(unchanged.status, "unchanged");

  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), "{ \"instructions\": [] }\n");
  const conflict = ensureProjectConfig({ projectRoot });

  assert.equal(conflict.status, "conflict");
  assert.equal(configReferencesExpandedGemini(projectRoot), false);
});

test("ensureProjectConfig can choose a default OpenCode agent", () => {
  const projectRoot = tempProject();
  const created = ensureProjectConfig({ projectRoot, defaultAgent: "YOLO" });

  assert.equal(created.status, "created");
  const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  assert.equal(parsed.default_agent, "YOLO");
});

test("ensureProjectConfig includes external plugin specs when configured", () => {
  const projectRoot = tempProject();
  const created = ensureProjectConfig({
    projectRoot,
    plugins: ["opencode-auto-fallback", "@slkiser/opencode-quota", "opencode-auto-fallback"],
  });

  assert.equal(created.status, "created");
  const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.jsonc"), "utf8"));
  assert.deepEqual(parsed.plugin, ["opencode-auto-fallback", "@slkiser/opencode-quota"]);
});

test("ensureProjectConfig creates a central backup before forced overwrite", () => {
  const projectRoot = tempProject();
  const homeDir = tempProject();
  const configPath = path.join(projectRoot, "opencode.jsonc");
  fs.writeFileSync(configPath, "{ \"manual\": true }\n", "utf8");

  const conflict = ensureProjectConfig({ projectRoot, homeDir });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.backups?.length ?? 0, 0);

  const forced = ensureProjectConfig({ projectRoot, homeDir, force: true });
  assert.equal(forced.status, "updated");
  assert.ok(forced.backup);
  assert.ok(forced.backup.startsWith(path.join(homeDir, ".config", "opencode-gemini-bridge", "backups", "project-config")));
  assert.equal(fs.readFileSync(forced.backup, "utf8"), "{ \"manual\": true }\n");
});
