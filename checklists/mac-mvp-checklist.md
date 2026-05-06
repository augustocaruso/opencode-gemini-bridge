# Mac MVP checklist

## Install

- [ ] Install Node.js.
- [ ] Install Git.
- [ ] Install OpenCode.
- [ ] Confirm Gemini CLI works.
- [ ] Clone/create OpenCode Gemini Bridge repo.
- [ ] Run `scripts/install-mac.sh --project <project>`.
- [ ] Confirm `ogb --version` or use the printed full `ogb` path.
- [ ] Confirm `.opencode/plugins/ogb-startup-sync.js` exists.
- [ ] Confirm `.opencode/generated/ogb-startup-sync.json` exists.

## Auth

- [ ] `opencode auth login` for OpenAI if needed.
- [ ] Add `opencode-gemini-auth@latest` only if using Gemini account auth.
- [ ] Run `opencode auth login --provider google` if using Gemini plugin.
- [ ] Add `@slkiser/opencode-quota` after Gemini auth plugin.
- [ ] Run `/quota_status` inside OpenCode.

## MVP

- [x] Implement `ogb inventory`.
- [x] Implement `ogb flatten`.
- [x] Generate `.opencode/generated/GEMINI.expanded.md`.
- [x] Configure `opencode.jsonc` instructions.
- [ ] Test `opencode run` with instructions.
- [x] Implement basic `ogb doctor`.
- [x] Project OpenCode commands.
- [x] Project only the `YOLO` OpenCode agent.
- [x] Implement `ogb install-extension`.
- [x] Implement `ogb update-extensions`.
- [x] Implement `ogb launch`.
- [x] Implement `ogb setup-opencode`.
- [x] Package local npm tarball with `npm run pack:local`.

## Validation

- [ ] Test import cycles.
- [ ] Test missing imports.
- [ ] Test skills detection.
- [ ] Test MCP stdio conversion.
- [ ] Confirm generated files are marked DO NOT EDIT.
- [ ] Open OpenCode directly and confirm startup plugin runs `ogb sync`.
