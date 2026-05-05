import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { flattenGeminiMd, parseGeminiImportLine } from "./flatten.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-flatten-"));
}

test("parseGeminiImportLine accepts plain, multiple, and quoted markdown imports", () => {
  assert.deepEqual(parseGeminiImportLine("@./a.md"), ["./a.md"]);
  assert.deepEqual(parseGeminiImportLine("@./a.md @../b.md"), ["./a.md", "../b.md"]);
  assert.deepEqual(parseGeminiImportLine("@\"dir with spaces/file.md\""), ["dir with spaces/file.md"]);
  assert.deepEqual(parseGeminiImportLine("prefix @./a.md"), []);
  assert.deepEqual(parseGeminiImportLine("@./a.txt"), []);
});

test("flattenGeminiMd expands nested imports and ignores imports inside code fences", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "GEMINI.md"), ["# Root", "@./a.md", "done"].join("\n"));
  fs.writeFileSync(path.join(root, "a.md"), ["A", "@./b.md", "```", "@./ignored.md", "```"].join("\n"));
  fs.writeFileSync(path.join(root, "b.md"), "B\n");

  const result = flattenGeminiMd({
    input: path.join(root, "GEMINI.md"),
    write: false,
  });

  assert.match(result.content, /# Root/);
  assert.match(result.content, /\nA\n/);
  assert.match(result.content, /\nB\n/);
  assert.match(result.content, /@\.\/ignored\.md/);
  assert.equal(result.imports.filter((item) => item.status === "ok").length, 2);
  assert.equal(result.warnings.length, 0);
});

test("flattenGeminiMd reports missing imports, cycles, and quoted paths with spaces", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "GEMINI.md"), ["# Root", "@\"space file.md\"", "@./missing.md", "@./cycle.md"].join("\n"));
  fs.writeFileSync(path.join(root, "space file.md"), "Spaced\n");
  fs.writeFileSync(path.join(root, "cycle.md"), "@./GEMINI.md\n");

  const result = flattenGeminiMd({
    input: path.join(root, "GEMINI.md"),
    write: false,
  });

  assert.match(result.content, /Spaced/);
  assert.match(result.content, /Missing import/);
  assert.match(result.content, /Skipped circular import/);
  assert.equal(result.imports.some((item) => item.raw === "space file.md" && item.status === "ok"), true);
  assert.equal(result.imports.some((item) => item.raw === "./missing.md" && item.status === "warning"), true);
  assert.equal(result.imports.some((item) => item.raw === "./GEMINI.md" && item.status === "warning"), true);
});
