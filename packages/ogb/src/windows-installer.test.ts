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
  assert.match(text, /\$InstallerParams = @\{\}/);
  assert.match(text, /\$InstallerParams\["Project"\] = \$Project/);
  assert.match(text, /& \$Installer\.FullName @InstallerParams/);
  assert.doesNotMatch(text, /@AllInstallerArgs/);
  assert.ok(text.indexOf("$Project = Normalize-PathArgument $Project") < text.indexOf('$InstallerParams["Project"] = $Project'));
});

test("Windows bootstrap repairs a file blocking the OpenCode config dir before installer download", () => {
  const text = scriptText("bootstrap-windows.ps1");

  assert.match(text, /function Repair-DirectoryBlocker/);
  assert.match(text, /function Repair-ReadOnlyDirectory/);
  assert.match(text, /Move-Item -LiteralPath \$Dir -Destination \$BackupPath -Force/);
  assert.match(text, /Repair-DirectoryBlocker \(Join-Path \$HOME "\.config\\opencode"\) "bootstrap"/);
  assert.match(text, /Repair-ReadOnlyDirectory \(Join-Path \$HOME "\.config\\opencode"\) "bootstrap"/);
  assert.ok(text.indexOf('Repair-DirectoryBlocker (Join-Path $HOME ".config\\opencode") "bootstrap"') < text.indexOf("Invoke-WebRequest -Uri $ReleaseUrl"));
  assert.ok(text.indexOf('Repair-ReadOnlyDirectory (Join-Path $HOME ".config\\opencode") "bootstrap"') < text.indexOf("Invoke-WebRequest -Uri $ReleaseUrl"));
});

test("Windows installer normalizes quoted project path before GetFullPath", () => {
  const text = scriptText("install-windows.ps1");

  assert.match(text, /function Normalize-PathArgument/);
  assert.match(text, /\$Project = Normalize-PathArgument \$Project/);
  assert.match(text, /\$Prefix = Normalize-PathArgument \$Prefix/);
  assert.ok(text.indexOf("$Project = Normalize-PathArgument $Project") < text.indexOf("$Project = [System.IO.Path]::GetFullPath($Project)"));
});

test("Windows installer repairs a file blocking the OpenCode config dir before mkdir", () => {
  const text = scriptText("install-windows.ps1");

  assert.match(text, /function Repair-DirectoryBlocker/);
  assert.match(text, /function Repair-ReadOnlyDirectory/);
  assert.match(text, /Move-Item -LiteralPath \$Dir -Destination \$BackupPath -Force/);
  assert.match(text, /Repair-DirectoryBlocker \(Join-Path \$HOME "\.config\\opencode"\) "windows-installer"/);
  assert.match(text, /Repair-ReadOnlyDirectory \(Join-Path \$HOME "\.config\\opencode"\) "windows-installer"/);
  assert.ok(
    text.indexOf('Repair-DirectoryBlocker (Join-Path $HOME ".config\\opencode") "windows-installer"')
    < text.indexOf('New-Item -ItemType Directory -Force (Join-Path $HOME ".config\\opencode")'),
  );
  assert.ok(
    text.indexOf('Repair-ReadOnlyDirectory (Join-Path $HOME ".config\\opencode") "windows-installer"')
    < text.indexOf('New-Item -ItemType Directory -Force (Join-Path $HOME ".config\\opencode")'),
  );
});
