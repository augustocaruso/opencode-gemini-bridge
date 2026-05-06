import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInventory } from "./inventory.js";

function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test("buildInventory collects Gemini files, imports, skills, agents, commands, hooks, and MCPs", () => {
  const projectRoot = tempDir("ogb-inventory-project-");
  const homeDir = tempDir("ogb-inventory-home-");

  fs.mkdirSync(path.join(projectRoot, ".gemini", "skills", "project-skill"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".gemini", "agents"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".gemini", "commands"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "GEMINI.md"), "@./rules.md\n");
  fs.writeFileSync(path.join(projectRoot, "rules.md"), "Project rules\n");
  fs.writeFileSync(path.join(projectRoot, ".gemini", "skills", "project-skill", "SKILL.md"), "---\nname: project-skill\n---\n");
  fs.writeFileSync(path.join(projectRoot, ".gemini", "agents", "study.md"), "Study agent\n");
  fs.writeFileSync(path.join(projectRoot, ".gemini", "commands", "review.md"), "Review command\n");
  fs.writeFileSync(path.join(projectRoot, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      local: {
        command: "node",
        args: ["server.js"],
        env: {
          SECRET_TOKEN: "do-not-copy",
        },
      },
      stream: {
        sseUrl: "http://localhost:3000/sse",
      },
    },
    hooks: {
      SessionStart: [{ command: "echo hi" }],
    },
  }));

  const extensionDir = path.join(homeDir, ".gemini", "extensions", "gemini-md-export");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({
    name: "gemini-md-export",
    mcpServers: {
      "gemini-md-export": {
        command: "node",
        args: ["${extensionPath}${/}src${/}mcp-server.js"],
        env: {
          GEMINI_MCP_CHROME_LAUNCH_IF_CLOSED: "false",
          SECRET_TOKEN: "extension-secret",
        },
      },
    },
  }));

  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "Global rules\n");

  const inv = buildInventory({ projectRoot, homeDir });

  assert.equal(inv.geminiFiles.length, 2);
  assert.equal(inv.imports.length, 1);
  assert.equal(inv.imports[0].status, "ok");
  assert.equal(inv.skills.length, 1);
  assert.equal(inv.agents.length, 1);
  assert.equal(inv.commands.length, 1);
  assert.equal(inv.hooks.length, 1);
  assert.equal(inv.mcps.length, 3);
  assert.deepEqual(inv.mcps.find((mcp) => mcp.name === "gemini-md-export")?.args, [path.join(extensionDir, "src", "mcp-server.js")]);
  assert.deepEqual(inv.mcps.find((mcp) => mcp.name === "gemini-md-export")?.environment, {
    GEMINI_MCP_CHROME_LAUNCH_IF_CLOSED: "false",
  });
  assert.deepEqual(inv.mcps.find((mcp) => mcp.name === "local")?.envKeys, ["SECRET_TOKEN"]);
  assert.equal(inv.mcps.find((mcp) => mcp.name === "local")?.status, "ok");
  assert.equal(inv.mcps.find((mcp) => mcp.name === "stream")?.status, "needs_review");
  assert.equal(JSON.stringify(inv).includes("do-not-copy"), false);
  assert.equal(JSON.stringify(inv).includes("extension-secret"), false);
});

test("buildInventory does not duplicate home resources when projectRoot is homeDir", () => {
  const homeDir = tempDir("ogb-inventory-home-project-");
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".gemini", "skills", "gemini-importer"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".gemini", "agents"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".gemini", "commands"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "skills", "gemini-importer", "SKILL.md"), "---\nname: gemini-importer\n---\n", "utf8");
  fs.writeFileSync(path.join(homeDir, ".gemini", "agents", "helper.md"), "Helper agent\n", "utf8");
  fs.writeFileSync(path.join(homeDir, ".gemini", "commands", "review.md"), "Review command\n", "utf8");
  fs.writeFileSync(path.join(homeDir, ".gemini", "settings.json"), JSON.stringify({
    mcpServers: {
      local: {
        command: "node",
        args: ["server.js"],
      },
    },
  }));

  const extensionDir = path.join(homeDir, ".gemini", "extensions", "gemini-md-export");
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "gemini-extension.json"), JSON.stringify({
    name: "gemini-md-export",
    mcpServers: {
      "gemini-md-export": {
        command: "node",
        args: ["${extensionPath}${/}src${/}mcp-server.js"],
      },
    },
  }));

  const inv = buildInventory({ projectRoot: homeDir, homeDir });

  assert.deepEqual(inv.skills.map((skill) => skill.name), ["gemini-importer"]);
  assert.deepEqual(inv.agents.map((agent) => agent.name), ["helper"]);
  assert.deepEqual(inv.commands.map((command) => command.name), ["review"]);
  assert.deepEqual(inv.mcps.map((mcp) => mcp.name).sort(), ["gemini-md-export", "local"]);
  assert.deepEqual(inv.extensions.map((extension) => extension.name), ["gemini-md-export"]);
});
