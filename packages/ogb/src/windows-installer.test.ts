import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function scriptText(name: string): string {
  return fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8");
}

test("Windows bootstrap normalizes quoted path arguments before forwarding them", () => {
  const text = scriptText("bootstrap-windows.ps1");

  assert.match(text, /function Normalize-PathArgument/);
  assert.match(text, /\$Project = Normalize-PathArgument \$Project/);
  assert.match(text, /\$Prefix = Normalize-PathArgument \$Prefix/);
  assert.ok(text.indexOf("$Project = Normalize-PathArgument $Project") < text.indexOf('if ($Project) { $AllInstallerArgs += @("-Project", $Project) }'));
});

test("Windows installer normalizes quoted project path before GetFullPath", () => {
  const text = scriptText("install-windows.ps1");

  assert.match(text, /function Normalize-PathArgument/);
  assert.match(text, /\$Project = Normalize-PathArgument \$Project/);
  assert.match(text, /\$Prefix = Normalize-PathArgument \$Prefix/);
  assert.ok(text.indexOf("$Project = Normalize-PathArgument $Project") < text.indexOf("$Project = [System.IO.Path]::GetFullPath($Project)"));
});
