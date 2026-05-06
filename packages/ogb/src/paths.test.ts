import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isHomeProject, resolveProjectPaths } from "./paths.js";

test("resolveProjectPaths uses global OGB state paths when project root is home", () => {
  const homeDir = path.join(os.tmpdir(), "ogb-home-mode");
  const paths = resolveProjectPaths(homeDir, homeDir);

  assert.equal(isHomeProject(homeDir, homeDir), true);
  assert.equal(paths.homeMode, true);
  assert.equal(paths.generatedDir, path.join(homeDir, ".config", "opencode-gemini-bridge", "generated"));
  assert.equal(paths.ogbConfigPath, path.join(homeDir, ".config", "opencode-gemini-bridge", "ogb.config.jsonc"));
});
