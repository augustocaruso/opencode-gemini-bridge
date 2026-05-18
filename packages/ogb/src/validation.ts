import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { createBackupSession } from "./backup-policy.js";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS, REMOVED_BUILT_IN_AGENT_NAMES } from "./built-ins.js";
import { resolveCommand } from "./command-resolution.js";
import { runDoctor } from "./doctor.js";
import { diagnoseOpenCodeMcpConfig } from "./mcp-projection.js";
import { runNativeCommand, type NativeCommandResult } from "./native-runner.js";
import { globalOpenCodeConfigDir, globalOpenCodeConfigFiles } from "./opencode-paths.js";
import { resolveProjectPaths } from "./paths.js";
import { isLegacyGlobalStartupPluginSpec } from "./setup-ux.js";
import { writeStateRecord } from "./state-store.js";
import { OGB_VERSION } from "./types.js";

export interface ValidationOptions {
  projectRoot?: string;
  homeDir?: string;
  json?: boolean;
  strict?: boolean;
  windows?: boolean;
  opencodeRun?: boolean;
  silent?: boolean;
}

export interface ValidationCheck {
  name: string;
  status: "pass" | "warn" | "fail" | "skip";
  message: string;
  details?: unknown;
}

export interface ValidationReport {
  version: string;
  projectRoot: string;
  generatedAt: string;
  outcome: "pass" | "warn" | "fail";
  checks: ValidationCheck[];
}

function run(command: string, args: string[], cwd: string, timeout = 30000, extraEnv: Record<string, string> = {}): NativeCommandResult {
  return runNativeCommand({
    command,
    args,
    cwd,
    timeoutMs: timeout,
    env: {
      ...process.env,
      NO_COLOR: process.env.NO_COLOR ?? "1",
      ...extraEnv,
    },
  });
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function globalOpenCodeConfigPath(homeDir: string): string {
  const files = globalOpenCodeConfigFiles({ homeDir });
  return files.find((filePath) => fs.existsSync(filePath)) ?? path.join(globalOpenCodeConfigDir({ homeDir }), "opencode.json");
}

function repairDirectoryBlocker(targetPath: string, paths: ReturnType<typeof resolveProjectPaths>, checks: ValidationCheck[], name: string): boolean {
  if (!fs.existsSync(targetPath)) return false;
  if (fs.statSync(targetPath).isDirectory()) return false;
  try {
    const backupSession = createBackupSession({
      bridgeConfigDir: paths.bridgeConfigDir,
      operation: "validation-repair",
      roots: [{ root: paths.homeDir, prefix: "home" }],
    });
    const backup = backupSession.backupExisting(targetPath);
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.mkdirSync(targetPath, { recursive: true });
    checks.push({
      name,
      status: "pass",
      message: `Repaired stale file blocking ${targetPath}; backup created at ${backup}.`,
      details: { path: targetPath, backup },
    });
    return true;
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      message: `Could not repair stale file blocking ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
      details: { path: targetPath },
    });
    return false;
  }
}

function repairGlobalOpenCodeConfigDir(paths: ReturnType<typeof resolveProjectPaths>, checks: ValidationCheck[]): void {
  repairDirectoryBlocker(globalOpenCodeConfigDir({ homeDir: paths.homeDir }), paths, checks, "Global OpenCode config directory");
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function decodeErrorPath(candidate: string): string {
  const trimmed = candidate.trim();
  if (/^[A-Za-z]:\\\\/.test(trimmed)) return trimmed.replace(/\\\\/g, "\\");
  return trimmed;
}

function openCodeConfigDirFromMkdirError(result: NativeCommandResult, homeDir: string): string | undefined {
  const text = [result.error, result.stderr, result.stdout].filter(Boolean).join("\n");
  if (!/\bEEXIST\b|file already exists/i.test(text)) return undefined;
  if (!/\bmkdir\b|path:/i.test(text)) return undefined;
  const candidates = [
    ...text.matchAll(/\bmkdir\s+["']([^"']+)["']/gi),
    ...text.matchAll(/\bpath:\s*["']([^"']+)["']/gi),
  ].map((match) => decodeErrorPath(match[1] ?? ""));
  return candidates.find((candidate) => {
    const normalized = candidate.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.endsWith("/.config/opencode") && isInsideOrEqual(homeDir, candidate);
  });
}

function resolveConfigPathReference(configPath: string, reference: string, homeDir: string): string {
  if (reference.startsWith("~/")) return path.resolve(homeDir, reference.slice(2));
  if (path.isAbsolute(reference)) return path.resolve(reference);
  return path.resolve(path.dirname(configPath), reference);
}

function configReferencesInstruction(configPath: string, instructionPath: string, homeDir: string): boolean {
  const config = readJsonc(configPath);
  const instructions = Array.isArray(config?.instructions) ? config.instructions : [];
  const expected = path.resolve(instructionPath);
  return instructions.some((item: unknown) =>
    typeof item === "string" && resolveConfigPathReference(configPath, item, homeDir) === expected
  );
}

function configOgbStartupPluginState(configPath: string, homeDir: string): { ok: boolean; legacySpecs: string[] } {
  const config = readJsonc(configPath);
  const plugins: unknown[] = Array.isArray(config?.plugin) ? config.plugin : [];
  const expected = pathToFileURL(path.join(globalOpenCodeConfigDir({ homeDir }), "plugins", "ogb-startup-sync.js")).href;
  const stringPlugins = plugins.filter((plugin): plugin is string => typeof plugin === "string");
  return {
    ok: stringPlugins.some((plugin) => plugin === expected),
    legacySpecs: stringPlugins.filter(isLegacyGlobalStartupPluginSpec),
  };
}

function addToolCheck(checks: ValidationCheck[], command: string, args: string[], cwd: string, homeDir: string): void {
  const resolved = resolveCommand(command, { homeDir });
  if (!resolved) {
    checks.push({ name: `${command} on PATH`, status: "warn", message: `${command} is not available on PATH.` });
    return;
  }

  const result = run(resolved, args, cwd, 15000);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  checks.push({
    name: `${command} executable`,
    status: result.error || result.status !== 0 ? "warn" : "pass",
    message: result.error ?? (output || `${command} responded successfully.`),
  });
}

function validateOgbGlobal(checks: ValidationCheck[], projectRoot: string, homeDir: string): void {
  const resolved = resolveCommand("ogb", { homeDir });
  if (!resolved) {
    checks.push({ name: "ogb global binary", status: "warn", message: "ogb is not available on PATH." });
    return;
  }
  const result = run(resolved, ["--version"], projectRoot, 15000);
  const version = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  checks.push({
    name: "ogb global binary",
    status: result.error || result.status !== 0 || version !== OGB_VERSION ? "warn" : "pass",
    message: result.error ?? (version === OGB_VERSION
      ? `ogb ${version} resolves to ${resolved}.`
      : `ogb resolves to ${resolved}, but reports ${version || "unknown version"}; expected ${OGB_VERSION}.`),
    details: { resolved, expectedVersion: OGB_VERSION, reportedVersion: version },
  });
}

function validateHomeGlobalFiles(paths: ReturnType<typeof resolveProjectPaths>, checks: ValidationCheck[]): void {
  const globalRoot = globalOpenCodeConfigDir({ homeDir: paths.homeDir });
  const configPath = globalOpenCodeConfigPath(paths.homeDir);
  const config = readJsonc(configPath);
  const expandedText = readText(paths.expandedGeminiPath);
  const expandedVersion = expandedText?.match(/^Generator:\s+ogb\s+(.+)$/m)?.[1]?.trim();
  const expandedOk = Boolean(expandedText?.startsWith("# GENERATED BY OpenCode Gemini Bridge. DO NOT EDIT.") && expandedVersion === OGB_VERSION);

  checks.push({
    name: "Global expanded Gemini context",
    status: expandedOk ? "pass" : "fail",
    message: expandedText
      ? `Global expanded Gemini context version is ${expandedVersion ?? "unknown"}.`
      : "Missing global expanded Gemini context. Run ogb sync.",
  });

  checks.push({
    name: "Global OpenCode config",
    status: isRecord(config) ? "pass" : "fail",
    message: isRecord(config) ? `${configPath} is parseable.` : `Missing or invalid global OpenCode config: ${configPath}.`,
  });

  checks.push({
    name: "Global OpenCode instructions",
    status: configReferencesInstruction(configPath, paths.expandedGeminiPath, paths.homeDir) ? "pass" : "fail",
    message: configReferencesInstruction(configPath, paths.expandedGeminiPath, paths.homeDir)
      ? "Global OpenCode config references the OGB expanded Gemini context."
      : "Global OpenCode config does not reference the OGB expanded Gemini context. Run ogb sync.",
  });

  const mcp = config?.mcp;
  const mcpShapeWarnings = diagnoseOpenCodeMcpConfig(mcp);
  checks.push({
    name: "Global OpenCode MCP config",
    status: mcp === undefined || isRecord(mcp) ? "pass" : "fail",
    message: isRecord(mcp)
      ? `${Object.keys(mcp).length} MCP server(s) configured globally.`
      : mcp === undefined
        ? "No global MCP servers configured."
        : "Global OpenCode mcp field must be an object.",
  });
  if (isRecord(mcp)) {
    checks.push({
      name: "Global OpenCode MCP shape",
      status: mcpShapeWarnings.length > 0 ? "warn" : "pass",
      message: mcpShapeWarnings.length > 0
        ? `${mcpShapeWarnings.length} MCP shape warning(s).`
        : "Global MCP entries use the OpenCode shape.",
      details: mcpShapeWarnings,
    });
  }

  const startupPluginState = configOgbStartupPluginState(configPath, paths.homeDir);
  checks.push({
    name: "Global OGB startup plugin",
    status: startupPluginState.ok && startupPluginState.legacySpecs.length === 0 ? "pass" : "fail",
    message: startupPluginState.legacySpecs.length > 0
      ? `Global OpenCode config still includes legacy OGB startup plugin spec(s): ${startupPluginState.legacySpecs.join(", ")}. Run ogb setup-ux --force.`
      : startupPluginState.ok
        ? "Global OpenCode config includes the OGB startup plugin."
        : "Global OpenCode config is missing the OGB startup plugin. Run ogb reset --yes.",
  });

  const agentFiles = listMarkdownFiles(path.join(globalRoot, "agents")).map((filePath) => path.basename(filePath, ".md"));
  const commandFiles = listMarkdownFiles(path.join(globalRoot, "commands")).map((filePath) => path.basename(filePath, ".md"));
  checks.push({
    name: "Global OpenCode YOLO agent",
    status: agentFiles.includes("YOLO") ? "pass" : "fail",
    message: agentFiles.includes("YOLO") ? "Global YOLO agent file is present." : "Missing global YOLO agent file. Run ogb reset --yes.",
    details: { agentFiles },
  });
  checks.push({
    name: "Global OpenCode commands",
    status: commandFiles.length > 0 ? "pass" : "fail",
    message: commandFiles.length > 0 ? `${commandFiles.length} global command file(s) present.` : "No global OpenCode command files found.",
    details: { commandFiles },
  });
}

function validateOpenCodeDebugConfig(paths: ReturnType<typeof resolveProjectPaths>, checks: ValidationCheck[]): void {
  const { projectRoot, homeDir, homeMode } = paths;
  const opencode = resolveCommand("opencode", { homeDir });
  if (!opencode) {
    checks.push({ name: "OpenCode resolved config", status: "skip", message: "opencode is not on PATH." });
    return;
  }

  let result = run(opencode, ["debug", "config"], projectRoot, 45000, { OGB_STARTUP_SYNC: "0" });
  if (result.error || result.status !== 0) {
    const blockedConfigDir = openCodeConfigDirFromMkdirError(result, homeDir);
    if (blockedConfigDir && repairDirectoryBlocker(blockedConfigDir, paths, checks, "OpenCode config directory from debug error")) {
      result = run(opencode, ["debug", "config"], projectRoot, 45000, { OGB_STARTUP_SYNC: "0" });
    }
  }
  if (result.error || result.status !== 0) {
    checks.push({
      name: "OpenCode resolved config",
      status: "fail",
      message: result.error ?? (result.stderr || "opencode debug config failed").trim(),
    });
    return;
  }

  const config = readJsoncFromText(result.stdout);
  if (!config) {
    checks.push({ name: "OpenCode resolved config", status: "fail", message: "opencode debug config did not return parseable JSON." });
    return;
  }

  const agentNames = Object.keys(config.agent ?? {}).sort();
  const commandNames = Object.keys(config.command ?? {}).sort();
  const bridgeRoot = homeMode ? globalOpenCodeConfigDir({ homeDir }) : path.join(projectRoot, ".opencode");
  const agentFiles = listMarkdownFiles(path.join(bridgeRoot, "agents")).map((filePath) => path.basename(filePath, ".md"));
  const commandFiles = listMarkdownFiles(path.join(bridgeRoot, "commands")).map((filePath) => path.basename(filePath, ".md"));
  const expectedAgents = homeMode ? ["YOLO"] : BUILT_IN_AGENTS.map((agent) => agent.name);
  const expectedCommands = homeMode ? ["research", "upgrade-ogb"] : BUILT_IN_COMMANDS.map((command) => command.name);
  const missingAgents = expectedAgents.filter((name) => !agentFiles.includes(name));
  const obsoleteAgents = homeMode ? [] : REMOVED_BUILT_IN_AGENT_NAMES.filter((name) => agentFiles.includes(name));
  const missingCommands = expectedCommands.filter((name) => !commandFiles.includes(name));
  const debugExposesBridgeAgents = expectedAgents.some((name) => agentNames.includes(name));
  const debugExposesBridgeCommands = expectedCommands.some((name) => commandNames.includes(name));

  checks.push({
    name: homeMode ? "Global OpenCode YOLO agent in debug config" : "OpenCode YOLO agent",
    status: missingAgents.length || obsoleteAgents.length ? "fail" : "pass",
    message: missingAgents.length
      ? `Missing agent file(s): ${missingAgents.join(", ")}.`
      : obsoleteAgents.length
        ? `Obsolete bridge agent file(s) still present: ${obsoleteAgents.join(", ")}.`
        : debugExposesBridgeAgents
          ? "YOLO agent is present and visible in OpenCode debug config."
          : "YOLO agent file is present; OpenCode debug config does not expose file-loaded agents.",
    details: { agentFiles, debugAgentCount: agentNames.length },
  });

  checks.push({
    name: homeMode ? "Global OpenCode bridge commands in debug config" : "OpenCode bridge commands",
    status: missingCommands.length ? "fail" : "pass",
    message: missingCommands.length
      ? `Missing command file(s): ${missingCommands.join(", ")}.`
      : debugExposesBridgeCommands
        ? "Built-in bridge commands are present and visible in OpenCode debug config."
        : "Built-in bridge command files are present; OpenCode debug config does not expose slash command files.",
    details: { commandFileCount: commandFiles.length, debugCommandCount: commandNames.length },
  });

  checks.push({
    name: "OpenCode projected command files",
    status: commandFiles.length ? "pass" : "fail",
    message: commandFiles.length ? `${commandFiles.length} projected command file(s) present.` : "No projected command files found.",
  });
}

function readJsoncFromText(text: string): any {
  try {
    return parseJsonc(text);
  } catch {
    return undefined;
  }
}

function listMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(fullPath);
  }
  return out.sort();
}

function candidateRepoRoots(projectRoot: string): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return Array.from(new Set([
    projectRoot,
    process.cwd(),
    path.resolve(moduleDir, "..", "..", ".."),
  ]));
}

function findRepoRootWithScripts(projectRoot: string): string | undefined {
  return candidateRepoRoots(projectRoot).find((root) => (
    fs.existsSync(path.join(root, "scripts", "install-mac.sh")) &&
    fs.existsSync(path.join(root, "scripts", "install-windows.ps1"))
  ));
}

function validateReleaseBootstrap(projectRoot: string, checks: ValidationCheck[]): void {
  const repoRoot = findRepoRootWithScripts(projectRoot);
  if (!repoRoot) {
    checks.push({ name: "Release bootstrap static check", status: "skip", message: "Release scripts are not present in this checkout/package." });
    return;
  }

  const requiredFiles = [
    "scripts/install-posix.sh",
    "scripts/install-mac.sh",
    "scripts/install-linux.sh",
    "scripts/bootstrap-mac.sh",
    "scripts/bootstrap-linux.sh",
    "scripts/bootstrap-windows.ps1",
    "scripts/upgrade-linux.sh",
    "scripts/uninstall-posix.sh",
    "scripts/uninstall-linux.sh",
    "scripts/install-windows.ps1",
  ];
  const missingFiles = requiredFiles.filter((relPath) => !fs.existsSync(path.join(repoRoot, relPath)));
  if (missingFiles.length > 0) {
    checks.push({
      name: "Release bootstrap static check",
      status: "fail",
      message: `Missing expected release/bootstrap file(s): ${missingFiles.join(", ")}.`,
      details: { repoRoot },
    });
    return;
  }

  const readScript = (name: string) => fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8");
  const scripts = {
    posixInstaller: readScript("install-posix.sh"),
    macInstaller: readScript("install-mac.sh"),
    linuxInstaller: readScript("install-linux.sh"),
    macBootstrap: readScript("bootstrap-mac.sh"),
    linuxBootstrap: readScript("bootstrap-linux.sh"),
    windowsBootstrap: readScript("bootstrap-windows.ps1"),
    linuxUpgrade: readScript("upgrade-linux.sh"),
    posixUninstaller: readScript("uninstall-posix.sh"),
    linuxUninstaller: readScript("uninstall-linux.sh"),
    windowsInstaller: readScript("install-windows.ps1"),
  };
  const required = [
    ["bootstrap-mac.sh default repo", scripts.macBootstrap, "augustocaruso/opencode-gemini-bridge"],
    ["bootstrap-mac.sh release asset", scripts.macBootstrap, "releases/latest/download/opencode-gemini-bridge-pack.zip"],
    ["bootstrap-mac.sh installer", scripts.macBootstrap, "install-mac.sh"],
    ["bootstrap-linux.sh default repo", scripts.linuxBootstrap, "augustocaruso/opencode-gemini-bridge"],
    ["bootstrap-linux.sh release asset", scripts.linuxBootstrap, "releases/latest/download/opencode-gemini-bridge-pack.zip"],
    ["bootstrap-linux.sh installer", scripts.linuxBootstrap, "install-linux.sh"],
    ["bootstrap-linux.sh posix fallback", scripts.linuxBootstrap, "install-posix.sh"],
    ["bootstrap-linux.sh legacy fallback", scripts.linuxBootstrap, "install-mac.sh"],
    ["bootstrap-linux.sh fallback message", scripts.linuxBootstrap, "legacy POSIX installer"],
    ["bootstrap-windows.ps1 default repo", scripts.windowsBootstrap, "augustocaruso/opencode-gemini-bridge"],
    ["bootstrap-windows.ps1 release asset", scripts.windowsBootstrap, "releases/latest/download/opencode-gemini-bridge-pack.zip"],
    ["bootstrap-windows.ps1 installer", scripts.windowsBootstrap, "install-windows.ps1"],
    ["bootstrap-windows.ps1 path arg normalization", scripts.windowsBootstrap, "Normalize-PathArgument"],
    ["bootstrap-windows.ps1 repairs blocked OpenCode config dir", scripts.windowsBootstrap, "Repair-DirectoryBlocker (Join-Path $HOME \".config\\opencode\") \"bootstrap\""],
    ["install-posix.sh repairs blocked OpenCode config dir", scripts.posixInstaller, "repair_directory_blocker \"$HOME/.config/opencode\" \"posix-installer\""],
    ["install-posix.sh delegates install", scripts.posixInstaller, "install --rulesync"],
    ["install-posix.sh ritual message", scripts.posixInstaller, "Running OGB install ritual"],
    ["install-posix.sh no ux flag", scripts.posixInstaller, "--no-ux"],
    ["install-posix.sh no opencode flag", scripts.posixInstaller, "--no-install-opencode"],
    ["install-posix.sh no check flag", scripts.posixInstaller, "--no-check"],
    ["install-posix.sh home sync", scripts.posixInstaller, "RUN_HOME_SYNC"],
    ["install-posix.sh reset global", scripts.posixInstaller, "--reset-global"],
    ["install-posix.sh Exa websearch env", scripts.posixInstaller, "OPENCODE_ENABLE_EXA"],
    ["install-posix.sh macOS zsh config", scripts.posixInstaller, ".config/zsh/.zshrc"],
    ["install-posix.sh Linux profile targets", scripts.posixInstaller, "linux_profile_targets"],
    ["install-posix.sh Linux profile", scripts.posixInstaller, ".profile"],
    ["install-posix.sh Linux bash rc", scripts.posixInstaller, ".bashrc"],
    ["install-posix.sh Linux fish config", scripts.posixInstaller, ".config/fish/config.fish"],
    ["install-posix.sh fish env syntax", scripts.posixInstaller, "set -gx OPENCODE_ENABLE_EXA 1"],
    ["install-posix.sh repairs ogb shim", scripts.posixInstaller, "repair_ogb_shim"],
    ["install-posix.sh retries npm install on stale shim", scripts.posixInstaller, "npm install did not complete"],
    ["install-posix.sh removes broken shim before wrapper", scripts.posixInstaller, "rm -f \"$OGB_BIN\""],
    ["install-posix.sh node shim fallback", scripts.posixInstaller, "exec node"],
    ["install-posix.sh version verification", scripts.posixInstaller, "Installed ogb verification returned no version output"],
    ["install-mac.sh shared POSIX installer", scripts.macInstaller, "install-posix.sh"],
    ["install-mac.sh darwin platform", scripts.macInstaller, "--platform darwin"],
    ["install-linux.sh shared POSIX installer", scripts.linuxInstaller, "install-posix.sh"],
    ["install-linux.sh linux platform", scripts.linuxInstaller, "--platform linux"],
    ["upgrade-linux.sh delegates Linux installer", scripts.linuxUpgrade, "install-linux.sh"],
    ["uninstall-posix.sh removes CLI", scripts.posixUninstaller, "npm uninstall"],
    ["uninstall-linux.sh shared POSIX uninstaller", scripts.linuxUninstaller, "uninstall-posix.sh"],
    ["install-windows.ps1 path arg normalization", scripts.windowsInstaller, "Normalize-PathArgument"],
    ["install-windows.ps1 repairs blocked OpenCode config dir", scripts.windowsInstaller, "Repair-DirectoryBlocker (Join-Path $HOME \".config\\opencode\") \"windows-installer\""],
    ["install-windows.ps1 delegates install", scripts.windowsInstaller, "\"install\", \"--rulesync\""],
    ["install-windows.ps1 ritual message", scripts.windowsInstaller, "Running OGB install ritual"],
    ["install-windows.ps1 no ux flag", scripts.windowsInstaller, "--no-ux"],
    ["install-windows.ps1 no opencode flag", scripts.windowsInstaller, "--no-install-opencode"],
    ["install-windows.ps1 no check flag", scripts.windowsInstaller, "--no-check"],
    ["install-windows.ps1 windows flag", scripts.windowsInstaller, "--windows"],
    ["install-windows.ps1 home sync", scripts.windowsInstaller, "RunHomeSync"],
    ["install-windows.ps1 reset global", scripts.windowsInstaller, "--reset-global"],
    ["install-windows.ps1 Exa websearch env", scripts.windowsInstaller, "OPENCODE_ENABLE_EXA"],
  ] as const;
  const missing = required.filter(([, text, needle]) => !text.includes(needle)).map(([label]) => label);

  checks.push({
    name: "Release bootstrap static check",
    status: missing.length ? "fail" : "pass",
    message: missing.length
      ? `Missing expected release/bootstrap token(s): ${missing.join(", ")}.`
      : "Bootstrap scripts for macOS, Linux, fish, and Windows download the release pack, set Exa websearch env, and thin installers delegate the ritual to ogb install with the expected platform flags.",
    details: { repoRoot },
  });
}

function validateWindowsInstaller(projectRoot: string, checks: ValidationCheck[]): void {
  const repoRoot = findRepoRootWithScripts(projectRoot) ?? projectRoot;
  const scriptPath = path.join(repoRoot, "scripts", "install-windows.ps1");
  if (!fs.existsSync(scriptPath)) {
    checks.push({ name: "Windows installer static check", status: "skip", message: "scripts/install-windows.ps1 is not present in this package checkout." });
    return;
  }

  const text = fs.readFileSync(scriptPath, "utf8");
  const required = [
    "Require-Command \"node\"",
    "Require-Command \"npm\"",
    "Resolve-NpmCommand",
    "$PSNativeCommandUseErrorActionPreference = $false",
    "Repair-DirectoryBlocker",
    "Repaired file blocking OpenCode config directory",
    "Invoke-NativeCommand",
    "$ErrorActionPreference = \"Continue\"",
    "2>&1",
    "Test-WritableDir",
    "Resolve-AppDataNpmPrefix",
    "Resolve-DefaultPrefix",
    "npm prefix -g",
    "Invoke-NativeCommand $script:NpmCommand @(\"--prefix\", $CliDir, \"install\")",
    "opencode-gemini-bridge-cli",
    "Invoke-NativeCommand $script:NpmCommand @(\"--prefix\", $InstallDir, \"install\", \"--omit=dev\")",
    "Install-StableCli $CliDir $CliInstallDir",
    "$CliTarget = Join-Path $CliInstallDir \"dist\\cli.js\"",
    "Test-CleanCliPath $CliTarget \"CLI target\"",
    "Test-CleanOgbShim $OgbBin $CliTarget",
    "Repair-HomeOgbShim $CliTarget",
    "Repaired old home ogb shim",
    "Installed ogb verification returned no version output.",
    "Runtime-OgbCliTarget",
    "%USERPROFILE%\\.ai\\opencode-pack\\opencode-gemini-bridge-cli\\dist\\cli.js",
    "ogb.cmd",
    "\"install\", \"--rulesync\"",
    "--no-ux",
    "--no-install-opencode",
    "--no-check",
    "--windows",
    "SetEnvironmentVariable(\"Path\"",
    "SetEnvironmentVariable(\"OPENCODE_ENABLE_EXA\"",
    "Ensure-OpenCodeExaEnvironment",
    "Running OGB install ritual",
    "Verified ogb",
    "ogb command:",
  ];
  const missing = required.filter((needle) => !text.includes(needle));
  const forbidden = [
    "[string]$Prefix = $(if ($env:OGB_PREFIX)",
    "npm --prefix $InstallDir install --omit=dev",
    "return $CliTarget",
    "$CliTarget = Install-StableCli",
    "Install-StableCli returned $($CliTargetValues.Count) values",
    "$InstalledVersion.Trim()",
  ].filter((needle) => text.includes(needle));
  checks.push({
    name: "Windows installer static check",
    status: missing.length || forbidden.length ? "fail" : "pass",
    message: missing.length
      ? `Missing expected installer token(s): ${missing.join(", ")}.`
      : forbidden.length
        ? `Forbidden unsafe installer token(s): ${forbidden.join(", ")}.`
        : "PowerShell installer has safe native command capture, build, install, Exa websearch env, and delegates the install ritual to the ogb CLI.",
  });
}

function validateOptionalOpenCodeRun(projectRoot: string, homeDir: string, checks: ValidationCheck[]): void {
  const opencode = resolveCommand("opencode", { homeDir });
  if (!opencode) {
    checks.push({ name: "OpenCode live run", status: "skip", message: "opencode is not on PATH." });
    return;
  }

  const result = run(opencode, ["run", "--agent", "YOLO", "Say exactly: OGB_VALIDATE_OK"], projectRoot, 120000);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  checks.push({
    name: "OpenCode live run",
    status: result.error || result.status !== 0 || !output.includes("OGB_VALIDATE_OK") ? "warn" : "pass",
    message: result.error ?? (output.includes("OGB_VALIDATE_OK") ? "OpenCode live run responded." : "OpenCode live run did not confirm the expected text."),
  });
}

export function runValidation(options: ValidationOptions = {}): ValidationReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const checks: ValidationCheck[] = [];
  repairGlobalOpenCodeConfigDir(paths, checks);
  const doctor = runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true });

  checks.push({
    name: "ogb doctor",
    status: doctor.errors.length > 0 ? "fail" : doctor.warnings.length > 0 ? "warn" : "pass",
    message: doctor.errors.length > 0
      ? `${doctor.errors.length} doctor error(s).`
      : doctor.warnings.length > 0
        ? `${doctor.warnings.length} doctor warning(s).`
        : "Doctor is clean.",
    details: { warnings: doctor.warnings, errors: doctor.errors },
  });

  addToolCheck(checks, "node", ["--version"], paths.projectRoot, paths.homeDir);
  addToolCheck(checks, "npm", ["--version"], paths.projectRoot, paths.homeDir);
  addToolCheck(checks, "gemini", ["--version"], paths.projectRoot, paths.homeDir);
  addToolCheck(checks, "opencode", ["--version"], paths.projectRoot, paths.homeDir);
  validateOgbGlobal(checks, paths.projectRoot, paths.homeDir);

  if (paths.homeMode) {
    validateHomeGlobalFiles(paths, checks);
  } else {
    const generatedConfig = readJsonc(paths.generatedOpenCodeConfigPath);
    checks.push({
      name: "Generated config marker",
      status: generatedConfig?._generated?.tool === "ogb" && generatedConfig?._generated?.version === OGB_VERSION ? "pass" : "fail",
      message: generatedConfig?._generated?.tool === "ogb"
        ? `Generated config version is ${generatedConfig._generated.version ?? "unknown"}.`
        : "Missing ogb generated config marker.",
    });
  }

  validateOpenCodeDebugConfig(paths, checks);
  validateReleaseBootstrap(paths.projectRoot, checks);
  if (options.windows) validateWindowsInstaller(paths.projectRoot, checks);
  if (options.opencodeRun) validateOptionalOpenCodeRun(paths.projectRoot, paths.homeDir, checks);

  const outcome = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";
  const report: ValidationReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    generatedAt: new Date().toISOString(),
    outcome,
    checks,
  };

  writeStateRecord("validation", report as unknown as Record<string, unknown>, { projectRoot: paths.projectRoot, homeDir: paths.homeDir });

  if (options.silent) {
    // Report is written to disk for callers such as ogb check.
  } else if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("OpenCode Gemini Bridge Validation");
    console.log(`Project: ${report.projectRoot}`);
    console.log(`Outcome: ${report.outcome}`);
    for (const check of checks) console.log(`- ${check.status.toUpperCase()} ${check.name}: ${check.message}`);
  }

  if (options.strict && outcome !== "pass") process.exitCode = outcome === "fail" ? 2 : 1;
  return report;
}
