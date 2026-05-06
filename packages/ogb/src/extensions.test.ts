import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildInstallExtensionArgs,
  buildUpdateExtensionsArgs,
  inspectExtensionSource,
  installGeminiExtension,
} from "./extensions.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-ext-"));
}

test("buildInstallExtensionArgs defaults remote git sources to auto-update", () => {
  assert.deepEqual(
    buildInstallExtensionArgs({
      source: "https://github.com/acme/study-pack.git",
      ref: "gemini-cli-extension",
      trust: true,
    }),
    [
      "extensions",
      "install",
      "https://github.com/acme/study-pack.git",
      "--ref",
      "gemini-cli-extension",
      "--auto-update",
      "--consent",
    ],
  );
});

test("inspectExtensionSource finds local manifest, hooks, and scripts", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "gemini-extension.json"), JSON.stringify({ name: "local-pack" }));
  fs.mkdirSync(path.join(root, "hooks"));
  fs.writeFileSync(path.join(root, "hooks", "hooks.json"), "{}");
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "setup.sh"), "#!/usr/bin/env bash\n");

  const inspection = inspectExtensionSource(root);

  assert.equal(inspection.local, true);
  assert.equal(inspection.installSource, root);
  assert.deepEqual(inspection.hooks, ["hooks/hooks.json"]);
  assert.deepEqual(inspection.scripts, ["scripts/setup.sh"]);
  assert.ok(inspection.warnings.some((warning) => warning.includes("Hooks found")));
});

test("installGeminiExtension blocks risky local extension without trust", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "gemini-extension.json"), JSON.stringify({ name: "local-pack" }));
  fs.mkdirSync(path.join(root, "hooks"));
  fs.writeFileSync(path.join(root, "hooks", "hooks.json"), "{}");

  const report = installGeminiExtension({ source: root });

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.command.slice(0, 3), ["gemini", "extensions", "install"]);
});

test("buildUpdateExtensionsArgs updates all by default or one named extension", () => {
  assert.deepEqual(buildUpdateExtensionsArgs(), ["extensions", "update", "--all"]);
  assert.deepEqual(buildUpdateExtensionsArgs({ name: "study-pack" }), ["extensions", "update", "study-pack"]);
});
