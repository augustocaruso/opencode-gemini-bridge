import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function script(name: string): string {
  return fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8");
}

function assertScriptExists(name: string): void {
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts", name)), true, `Expected scripts/${name} to exist.`);
}

test("posix installer contract delegates the ritual to ogb install", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /INSTALL_ARGS=\(--project "\$PROJECT_DIR" install --rulesync "\$RULESYNC_MODE"\)/);
  assert.match(text, /Running OGB install ritual/);
  assert.match(text, /--no-ux/);
  assert.match(text, /--no-install-opencode/);
  assert.match(text, /--no-check/);
  assert.match(text, /--reset-global/);
  assert.match(text, /INSTALL_STATUS=\$\?/);
  assert.match(text, /"\$INSTALL_STATUS" -eq 1/);
  assert.match(text, /exit "\$INSTALL_STATUS"/);
  assert.doesNotMatch(text, /\bsetup-ux\b/);
  assert.doesNotMatch(text, /\bsetup-opencode\b/);
  assert.doesNotMatch(text, /\bcleanup-home\b/);
  assert.doesNotMatch(text, /\brun_final_check\b/);
});

test("posix installer repairs a file blocking the OpenCode config dir before mkdir", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /repair_directory_blocker\(\)/);
  assert.match(text, /mv "\$dir" "\$backup_path"/);
  assert.match(text, /Repaired file blocking OpenCode config directory/);
  assert.ok(
    text.indexOf('repair_directory_blocker "$HOME/.config/opencode" "posix-installer"')
    < text.indexOf('mkdir -p "$HOME/.config/opencode"'),
  );
});

test("mac installer remains a darwin wrapper around the shared POSIX installer", () => {
  const text = script("install-mac.sh");

  assert.match(text, /install-posix\.sh/);
  assert.match(text, /--platform darwin/);
  assert.match(script("bootstrap-mac.sh"), /run_installer/);
  assert.match(script("bootstrap-mac.sh"), /\$\{#INSTALLER_ARGS\[@\]\}/);
});

test("linux public scripts wrap the shared POSIX implementation", () => {
  for (const name of ["install-linux.sh", "bootstrap-linux.sh", "upgrade-linux.sh", "uninstall-linux.sh"]) {
    assertScriptExists(name);
  }

  assert.match(script("install-linux.sh"), /install-posix\.sh/);
  assert.match(script("install-linux.sh"), /--platform linux/);
  assert.match(script("bootstrap-linux.sh"), /install-linux\.sh/);
  assert.match(script("bootstrap-linux.sh"), /install-posix\.sh/);
  assert.match(script("bootstrap-linux.sh"), /install-mac\.sh/);
  assert.match(script("bootstrap-linux.sh"), /legacy POSIX installer/);
  assert.match(script("bootstrap-linux.sh"), /opencode-gemini-bridge-pack\.zip/);
  assert.match(script("bootstrap-linux.sh"), /run_installer/);
  assert.match(script("bootstrap-linux.sh"), /\$\{#INSTALLER_ARGS_PREFIX\[@\]\}/);
  assert.match(script("bootstrap-linux.sh"), /\$\{#INSTALLER_ARGS\[@\]\}/);
  assert.match(script("upgrade-linux.sh"), /install-linux\.sh/);
  assert.match(script("uninstall-linux.sh"), /uninstall-posix\.sh/);
});

test("linux POSIX installer persists env without macOS zsh config", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /linux_profile_targets/);
  assert.match(text, /\.profile/);
  assert.match(text, /\.bashrc/);
  assert.match(text, /\.zshrc/);
  assert.match(text, /\.config\/fish\/config\.fish/);
  assert.match(text, /set -gx OPENCODE_ENABLE_EXA 1/);
  assert.match(text, /contains "\$PREFIX\/bin" \\\$PATH/);
  assert.match(text, /OPENCODE_ENABLE_EXA/);
  assert.match(text, /repair_ogb_shim/);
  assert.match(text, /npm install did not complete/);
  assert.match(text, /rm -f "\$OGB_BIN"/);
  assert.match(text, /exec node/);
  assert.match(text, /Installed ogb verification returned no version output/);
  const linuxTargets = text.match(/linux_profile_targets\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(linuxTargets, /\.config\/zsh/);
});

test("posix installer installs ogb from a packed tarball instead of linking a source directory", () => {
  assertScriptExists("install-posix.sh");
  const text = script("install-posix.sh");

  assert.match(text, /install_ogb_package/);
  assert.match(text, /cd "\$CLI_DIR" && npm pack --pack-destination/);
  assert.match(text, /package_tgz/);
  assert.match(text, /npm install --prefix "\$PREFIX" -g "\$package_tgz"/);
  assert.doesNotMatch(text, /npm install --prefix "\$PREFIX" -g "\$CLI_DIR"/);
});

test("installers fail early when Node is older than 22", () => {
  const posix = script("install-posix.sh");
  const windows = script("install-windows.ps1");

  assert.match(posix, /require_node_22/);
  assert.match(posix, /Node\.js >=22 is required before installing ogb/);
  assert.match(windows, /Require-Node22/);
  assert.match(windows, /Node\.js >=22 is required before installing ogb/);
});

test("windows installer contract delegates the ritual to ogb install", () => {
  const text = script("install-windows.ps1");

  assert.match(text, /\$InstallArgs = @\("--project", \$Project, "install", "--rulesync", \$Rulesync, "--windows"\)/);
  assert.match(text, /Running OGB install ritual/);
  assert.match(text, /%USERPROFILE%\\\.ai\\opencode-pack\\opencode-gemini-bridge-cli\\dist\\cli\.js/);
  assert.match(text, /--no-ux/);
  assert.match(text, /--no-install-opencode/);
  assert.match(text, /--no-check/);
  assert.match(text, /--reset-global/);
  assert.match(text, /\$InstallStatus = \$LASTEXITCODE/);
  assert.match(text, /\$InstallStatus -eq 1/);
  assert.match(text, /exit \$InstallStatus/);
  assert.doesNotMatch(text, /node `"\$CliTarget`" %\*/);
  assert.doesNotMatch(text, /\bsetup-ux\b/);
  assert.doesNotMatch(text, /\bsetup-opencode\b/);
  assert.doesNotMatch(text, /\bcleanup-home\b/);
  assert.doesNotMatch(text, /\bInvoke-FinalOgbCheck\b/);
});
