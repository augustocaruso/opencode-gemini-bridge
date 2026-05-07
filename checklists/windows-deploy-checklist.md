# Windows deployment checklist

## Before Windows

- [ ] MVP works on Mac.
- [x] Scripts have PowerShell versions.
- [x] No hardcoded Mac paths in generated startup config; installer writes machine-local command path.
- [x] No symlink dependency unless fallback exists.
- [x] All generated files are cross-platform.
- [ ] Read `docs/20-windows-installer-lessons.md` before changing installer/update/startup code.
- [ ] Add or update regression tests for every Windows boundary touched.

## Windows machine prep

- [ ] Install Git.
- [ ] Install Node.js LTS.
- [ ] Install OpenCode.
- [ ] Install Gemini CLI if needed.
- [ ] Confirm PowerShell version.
- [ ] Confirm path to user profile.
- [ ] Confirm permissions for symlink/junction or choose copy mode.

## Install

- [ ] Clone repo.
- [ ] Run `scripts\install-windows.ps1 -Project <project>`.
- [ ] Confirm `ogb.cmd --version` or use the printed full path.
- [ ] Confirm `.opencode\plugins\ogb-startup-sync.js` exists.
- [ ] Run `ogb pass --windows`.
- [ ] Run `ogb dashboard`.
- [ ] Run `ogb launch`.

## Update

- [ ] Run `ogb self-update --release vX.Y.Z`.
- [ ] Confirm `ogb --version`.
- [ ] Confirm `ogb pass --windows`.
- [ ] Confirm `ogb dashboard` does not keep stale `restart OpenCode` after a clean pass/current version.
- [ ] Test `ogb self-update` without `--release` when validating the `latest` path.

## Safety

- [ ] Do not copy tokens/auth from Mac.
- [ ] Re-authenticate providers on Windows.
- [ ] Validate MCP env variables.
- [ ] Keep `yolo` disabled or separate until trust is established.
