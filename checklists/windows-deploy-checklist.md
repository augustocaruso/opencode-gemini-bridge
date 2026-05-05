# Windows deployment checklist

## Before Windows

- [ ] MVP works on Mac.
- [x] Scripts have PowerShell versions.
- [x] No hardcoded Mac paths in generated startup config; installer writes machine-local command path.
- [ ] No symlink dependency unless fallback exists.
- [ ] All generated files are cross-platform.

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
- [ ] Run `artifacts\scripts\install-windows.ps1 -Project <project>`.
- [ ] Confirm `ogb.cmd --version` or use the printed full path.
- [ ] Confirm `.opencode\plugins\ogb-startup-sync.js` exists.
- [ ] Run `ogb doctor`.
- [ ] Run `ogb launch`.

## Safety

- [ ] Do not copy tokens/auth from Mac.
- [ ] Re-authenticate providers on Windows.
- [ ] Validate MCP env variables.
- [ ] Keep `yolo` disabled or separate until trust is established.
