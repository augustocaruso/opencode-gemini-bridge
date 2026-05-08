import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";
import { readSyncState } from "./sync-state.js";
import { ensureGlobalTuiSidebar, ensureTuiSidebar, GLOBAL_TUI_CONFIG_PATH, GLOBAL_TUI_SIDEBAR_PLUGIN_PATH, TUI_CONFIG_PATH, TUI_SIDEBAR_PLUGIN_PATH, TUI_SIDEBAR_PLUGIN_SPEC } from "./tui-sidebar.js";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-tui-"));
}

function projectPath(projectRoot: string, relPath: string): string {
  return path.join(projectRoot, ...relPath.split("/"));
}

test("ensureTuiSidebar installs a TUI plugin and tui config entry", () => {
  const projectRoot = tempProject();
  const report = ensureTuiSidebar({ projectRoot });

  assert.equal(report.plugin.status, "created");
  assert.equal(report.config.status, "created");
  assert.equal(report.pluginCheck.ok, true);
  assert.equal(fs.existsSync(projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH)), true);
  assert.equal(fs.existsSync(projectPath(projectRoot, TUI_CONFIG_PATH)), true);
  assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "plugins", "ogb-sidebar.js")), false);

  const plugin = fs.readFileSync(projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH), "utf8");
  const config = parseJsonc(fs.readFileSync(projectPath(projectRoot, TUI_CONFIG_PATH), "utf8"));
  const state = readSyncState(projectRoot);

  assert.match(plugin, /sidebar_content/);
  assert.doesNotMatch(plugin, new RegExp("sidebar_" + "footer"));
  assert.match(plugin, /session_prompt_right/);
  assert.doesNotMatch(plugin, new RegExp("OGB_TUI_HIDE_" + "LSP"));
  assert.doesNotMatch(plugin, new RegExp("installHide" + "LspPatch"));
  assert.doesNotMatch(plugin, new RegExp("__ogbHidden" + "Lsp"));
  assert.doesNotMatch(plugin, new RegExp("lsp" + "PatchRestore"));
  assert.doesNotMatch(plugin, new RegExp("lsp" + "PatchDisposeRegistered"));
  assert.doesNotMatch(plugin, /lsp:\s*false/);
  assert.match(plugin, /session\.status/);
  assert.match(plugin, /session\.idle/);
  assert.match(plugin, /message\.part\.delta/);
  assert.match(plugin, /⏱ /);
  assert.doesNotMatch(plugin, /\bRUN\b/);
  assert.match(plugin, /gemini_quota/);
  assert.match(plugin, /ogb-limits\.json/);
  assert.match(plugin, /Quota/);
  assert.match(plugin, /el\("b", \{\}, "Usage"\)/);
  assert.match(plugin, /QUOTA_SIDEBAR_MAX_WIDTH = 36/);
  assert.match(plugin, /TUI_SIDEBAR_LAYOUT = \{\n  maxWidth: QUOTA_SIDEBAR_MAX_WIDTH,\n  narrowAt: QUOTA_SIDEBAR_MAX_WIDTH,\n  tinyAt: 20,/);
  assert.match(plugin, /function formatQuotaRows\(entries, errors\)/);
  assert.match(plugin, /const barWidth = Math\.max\(10, maxWidth - separator\.length - percentCol\);/);
  assert.match(plugin, /const timeLine = padRight\(leftText, nameWidth\) \+ separator \+ padLeft\(timeStr, timeWidth\);/);
  assert.match(plugin, /const barCell = bar\(displayedPercent, barWidth\);/);
  assert.match(plugin, /const filled = Math\.round\(\(clampInt\(safePercent, 0, 100\) \/ 100\) \* width\);/);
  assert.match(plugin, /return "█"\.repeat\(filled\) \+ "░"\.repeat\(empty\);/);
  assert.match(plugin, /wrapMode: "none"/);
  assert.match(plugin, /function LimitsRows\(props\) \{[\s\S]*return box\(\{ gap: 0 \},\n    line\(\{ fg: props\.theme\(\)\.text \}, el\("b", \{\}, "Usage"\)\)/);
  assert.match(plugin, /return box\(\{ gap: 0 \}, \.\.\.children\);/);
  assert.match(plugin, /providerQuotaRows/);
  assert.match(plugin, /function providerFooterLine\(provider\)/);
  assert.match(plugin, /if \(providerKind\(providerId\) === "gemini"\) return quota/);
  assert.match(plugin, /if \(\(lineUsedPercent\(weekly\) \?\? 0\) >= 100\) return weekly;/);
  assert.match(plugin, /if \(\(lineUsedPercent\(session\) \?\? 0\) >= 100\) return session;/);
  assert.match(plugin, /return session \|\| quota \|\| weekly/);
  assert.match(plugin, /limits unavailable/);
  assert.doesNotMatch(plugin, /Usage limits/);
  assert.doesNotMatch(plugin, /OpenUsage off · \/gquota/);
  assert.match(plugin, /promptLabel: ""/);
  assert.match(plugin, /promptLabel: used \? used \+ " used" : "quota n\/a"/);
  assert.match(plugin, /promptLabel: usageLabel/);
  assert.match(plugin, /function quotaUsageColor\(theme, percent\)/);
  assert.match(plugin, /if \(value >= 100\) return theme\.error;/);
  assert.match(plugin, /if \(value >= 85\) return theme\.warning;/);
  assert.match(plugin, /\+ "quota " : ""/);
  assert.match(plugin, /status !== "busy"/);
  assert.match(plugin, /latestAssistantCompleted/);
  assert.match(plugin, /startedWallMs/);
  assert.match(plugin, /BRIDGE/);
  assert.match(plugin, /function SyncInline\(props\)/);
  assert.match(plugin, /function BridgeRows\(props\) \{[\s\S]*"BRIDGE"[\s\S]*outcomeLabel\(current\.outcome\)[\s\S]*createComponent\(SyncInline/);
  assert.match(plugin, /line\(\{ fg: props\.theme\(\)\.textMuted \}, ""\),\n    line\(\{ fg: props\.theme\(\)\.text \}, \(\) => bridgeInventoryText\(data\(\)\)\)/);
  const bridgeRowsOffset = plugin.indexOf("function BridgeRows(props)");
  const warningOffset = plugin.indexOf('String(current.warnings), " warn · "', bridgeRowsOffset);
  const spacerOffset = plugin.indexOf('line({ fg: props.theme().textMuted }, ""),', bridgeRowsOffset);
  const inventoryOffset = plugin.indexOf("bridgeInventoryText(data())", bridgeRowsOffset);
  assert.ok(warningOffset > bridgeRowsOffset);
  assert.ok(warningOffset < spacerOffset);
  assert.ok(spacerOffset < inventoryOffset);
  assert.match(plugin, /ogb-ui\.json/);
  assert.match(plugin, /externalQuotaPanel/);
  assert.doesNotMatch(plugin, /ogb-telemetry-status\.json/);
  assert.doesNotMatch(plugin, /telemetry ready/);
  assert.match(plugin, /GEMINI\.md · /);
  assert.match(plugin, /MCP · /);
  assert.doesNotMatch(plugin, /GEMINI\.md files/);
  assert.doesNotMatch(plugin, /MCP servers/);
  assert.match(plugin, /Gemini auth repaired · restart OpenCode/);
  assert.match(plugin, /authRepairText/);
  assert.doesNotMatch(plugin, /ext\s+cmd/);
  assert.match(plugin, /modelMetaFromMessages/);
  assert.match(plugin, /modelMetaFromModelState/);
  assert.match(plugin, /selectedModelMeta/);
  assert.match(plugin, /model\.json/);
  assert.match(plugin, /preferUser/);
  assert.match(plugin, /fetchSessionModelMeta/);
  assert.match(plugin, /api\.client\.session\.get/);
  assert.match(plugin, /tui\.session\.select/);
  assert.match(plugin, /ctx n\/a/);
  assert.match(plugin, /ogb-dashboard\.json/);
  assert.deepEqual(config.plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
  assert.ok(state?.managedFiles.some((file) => file.path === TUI_SIDEBAR_PLUGIN_PATH && file.source === "ogb"));
  assert.ok(state?.managedFiles.some((file) => file.path === TUI_CONFIG_PATH && file.source === "ogb"));
});

test("ensureTuiSidebar appends to existing tui.jsonc without dropping user settings", () => {
  const projectRoot = tempProject();
  const tuiConfig = projectPath(projectRoot, TUI_CONFIG_PATH);
  fs.mkdirSync(path.dirname(tuiConfig), { recursive: true });
  fs.writeFileSync(tuiConfig, `{
  // keep this comment
  "theme": "opencode",
  "plugin": [
    "existing-plugin"
  ]
}
`);

  const report = ensureTuiSidebar({ projectRoot });
  const text = fs.readFileSync(tuiConfig, "utf8");
  const parsed = parseJsonc(text);

  assert.equal(report.config.status, "updated");
  assert.match(text, /keep this comment/);
  assert.equal(parsed.theme, "opencode");
  assert.deepEqual(parsed.plugin, ["existing-plugin", TUI_SIDEBAR_PLUGIN_SPEC]);
});

test("ensureTuiSidebar can add external TUI plugin before OGB sidebar", () => {
  const projectRoot = tempProject();
  const report = ensureTuiSidebar({
    projectRoot,
    extraPlugins: ["@slkiser/opencode-quota"],
  });
  const parsed = parseJsonc(fs.readFileSync(projectPath(projectRoot, TUI_CONFIG_PATH), "utf8"));

  assert.equal(report.config.status, "created");
  assert.deepEqual(parsed.plugin, ["@slkiser/opencode-quota", TUI_SIDEBAR_PLUGIN_SPEC]);
});

test("ensureTuiSidebar appends missing external TUI plugin without duplicating OGB sidebar", () => {
  const projectRoot = tempProject();
  const tuiConfig = projectPath(projectRoot, TUI_CONFIG_PATH);
  fs.mkdirSync(path.dirname(tuiConfig), { recursive: true });
  fs.writeFileSync(tuiConfig, `{
  "plugin": [
    "${TUI_SIDEBAR_PLUGIN_SPEC}"
  ]
}
`);

  const report = ensureTuiSidebar({
    projectRoot,
    extraPlugins: ["@slkiser/opencode-quota"],
  });
  const parsed = parseJsonc(fs.readFileSync(tuiConfig, "utf8"));

  assert.equal(report.config.status, "updated");
  assert.deepEqual(parsed.plugin, [TUI_SIDEBAR_PLUGIN_SPEC, "@slkiser/opencode-quota"]);
});

test("ensureTuiSidebar refuses to overwrite manually changed plugin without force", () => {
  const projectRoot = tempProject();
  const homeDir = tempProject();
  ensureTuiSidebar({ projectRoot, homeDir });
  const pluginPath = projectPath(projectRoot, TUI_SIDEBAR_PLUGIN_PATH);
  fs.writeFileSync(pluginPath, "export default { id: 'manual', tui: async () => {} }\n", "utf8");

  const conflict = ensureTuiSidebar({ projectRoot, homeDir });
  assert.equal(conflict.plugin.status, "conflict");
  assert.match(fs.readFileSync(pluginPath, "utf8"), /manual/);

  const forced = ensureTuiSidebar({ projectRoot, homeDir, force: true });
  assert.equal(forced.plugin.status, "updated");
  assert.ok(forced.plugin.backup);
  assert.ok(forced.plugin.backup.startsWith(path.join(homeDir, ".config", "opencode-gemini-bridge", "backups", "tui-sidebar")));
  assert.match(fs.readFileSync(forced.plugin.backup, "utf8"), /manual/);
  assert.match(fs.readFileSync(pluginPath, "utf8"), /ogb:sidebar/);
});

test("ensureGlobalTuiSidebar installs global TUI plugin and preserves config settings", () => {
  const configDir = tempProject();
  const tuiConfig = path.join(configDir, GLOBAL_TUI_CONFIG_PATH);
  fs.writeFileSync(tuiConfig, JSON.stringify({
    $schema: "https://opencode.ai/tui.json",
    mouse: true,
    plugin: [],
  }, null, 2) + "\n");

  const report = ensureGlobalTuiSidebar({ configDir });
  const pluginPath = path.join(configDir, ...GLOBAL_TUI_SIDEBAR_PLUGIN_PATH.split("/"));
  const config = JSON.parse(fs.readFileSync(tuiConfig, "utf8"));
  const plugin = fs.readFileSync(pluginPath, "utf8");

  assert.equal(report.plugin.status, "created");
  assert.equal(report.config.status, "updated");
  assert.equal(report.pluginCheck.ok, true);
  assert.equal(config.mouse, true);
  assert.deepEqual(config.plugin, [TUI_SIDEBAR_PLUGIN_SPEC]);
  assert.match(plugin, /GLOBAL_GENERATED_DIR/);
  assert.match(plugin, /function generatedDir\(root\)/);
});
