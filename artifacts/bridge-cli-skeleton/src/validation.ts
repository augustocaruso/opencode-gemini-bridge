import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { BUILT_IN_AGENTS, BUILT_IN_COMMANDS, REMOVED_BUILT_IN_AGENT_NAMES } from "./built-ins.js";
import { runDoctor } from "./doctor.js";
import { resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

export interface ValidationOptions {
  projectRoot?: string;
  homeDir?: string;
  json?: boolean;
  strict?: boolean;
  windows?: boolean;
  opencodeRun?: boolean;
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
  outcome: "pass" | "warn" | "fail";
  checks: ValidationCheck[];
}

function commandExists(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function resolveCommand(command: string): string | undefined {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.error || result.status !== 0) return undefined;
  return String(result.stdout || "").split(/\r?\n/).find(Boolean)?.trim();
}

function run(command: string, args: string[], cwd: string, timeout = 30000, extraEnv: Record<string, string> = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
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

function addToolCheck(checks: ValidationCheck[], command: string, args: string[], cwd: string): void {
  if (!commandExists(command)) {
    checks.push({ name: `${command} on PATH`, status: "warn", message: `${command} is not available on PATH.` });
    return;
  }

  const result = run(command, args, cwd, 15000);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  checks.push({
    name: `${command} executable`,
    status: result.error || result.status !== 0 ? "warn" : "pass",
    message: result.error?.message ?? (output || `${command} responded successfully.`),
  });
}

function validateOgbGlobal(checks: ValidationCheck[], projectRoot: string): void {
  const resolved = resolveCommand("ogb");
  if (!resolved) {
    checks.push({ name: "ogb global binary", status: "warn", message: "ogb is not available on PATH." });
    return;
  }
  const result = run(resolved, ["--version"], projectRoot, 15000);
  const version = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  checks.push({
    name: "ogb global binary",
    status: result.error || result.status !== 0 || version !== OGB_VERSION ? "warn" : "pass",
    message: result.error?.message ?? (version === OGB_VERSION
      ? `ogb ${version} resolves to ${resolved}.`
      : `ogb resolves to ${resolved}, but reports ${version || "unknown version"}; expected ${OGB_VERSION}.`),
    details: { resolved, expectedVersion: OGB_VERSION, reportedVersion: version },
  });
}

function validateOpenCodeDebugConfig(projectRoot: string, checks: ValidationCheck[]): void {
  if (!commandExists("opencode")) {
    checks.push({ name: "OpenCode resolved config", status: "skip", message: "opencode is not on PATH." });
    return;
  }

  const result = run("opencode", ["debug", "config"], projectRoot, 45000, { OGB_STARTUP_SYNC: "0" });
  if (result.error || result.status !== 0) {
    checks.push({
      name: "OpenCode resolved config",
      status: "fail",
      message: result.error?.message ?? (result.stderr || "opencode debug config failed").trim(),
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
  const agentFiles = listMarkdownFiles(path.join(projectRoot, ".opencode", "agents")).map((filePath) => path.basename(filePath, ".md"));
  const commandFiles = listMarkdownFiles(path.join(projectRoot, ".opencode", "commands")).map((filePath) => path.basename(filePath, ".md"));
  const missingAgents = BUILT_IN_AGENTS.map((agent) => agent.name).filter((name) => !agentFiles.includes(name));
  const obsoleteAgents = REMOVED_BUILT_IN_AGENT_NAMES.filter((name) => agentFiles.includes(name));
  const missingCommands = BUILT_IN_COMMANDS.map((command) => command.name).filter((name) => !commandFiles.includes(name));
  const debugExposesBridgeAgents = BUILT_IN_AGENTS.some((agent) => agentNames.includes(agent.name));
  const debugExposesBridgeCommands = BUILT_IN_COMMANDS.some((command) => commandNames.includes(command.name));

  checks.push({
    name: "OpenCode YOLO agent",
    status: missingAgents.length || obsoleteAgents.length ? "fail" : "pass",
    message: missingAgents.length
      ? `Missing built-in agent file(s): ${missingAgents.join(", ")}.`
      : obsoleteAgents.length
        ? `Obsolete bridge agent file(s) still present: ${obsoleteAgents.join(", ")}.`
        : debugExposesBridgeAgents
          ? "YOLO agent is present and visible in OpenCode debug config."
          : "YOLO agent file is present; OpenCode debug config does not expose file-loaded agents.",
    details: { agentFiles, debugAgentCount: agentNames.length },
  });

  checks.push({
    name: "OpenCode bridge commands",
    status: missingCommands.length ? "fail" : "pass",
    message: missingCommands.length
      ? `Missing built-in command file(s): ${missingCommands.join(", ")}.`
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
    fs.existsSync(path.join(root, "artifacts", "scripts", "install-mac.sh")) &&
    fs.existsSync(path.join(root, "artifacts", "scripts", "install-windows.ps1"))
  ));
}

function validateReleaseBootstrap(projectRoot: string, checks: ValidationCheck[]): void {
  const repoRoot = findRepoRootWithScripts(projectRoot);
  if (!repoRoot) {
    checks.push({ name: "Release bootstrap static check", status: "skip", message: "Release scripts are not present in this checkout/package." });
    return;
  }

  const scripts = {
    macBootstrap: fs.readFileSync(path.join(repoRoot, "artifacts", "scripts", "bootstrap-mac.sh"), "utf8"),
    windowsBootstrap: fs.readFileSync(path.join(repoRoot, "artifacts", "scripts", "bootstrap-windows.ps1"), "utf8"),
    macInstaller: fs.readFileSync(path.join(repoRoot, "artifacts", "scripts", "install-mac.sh"), "utf8"),
    windowsInstaller: fs.readFileSync(path.join(repoRoot, "artifacts", "scripts", "install-windows.ps1"), "utf8"),
  };
  const required = [
    ["bootstrap-mac.sh default repo", scripts.macBootstrap, "augustocaruso/opencode-gemini-bridge"],
    ["bootstrap-mac.sh release asset", scripts.macBootstrap, "releases/latest/download/opencode-gemini-bridge-pack.zip"],
    ["bootstrap-mac.sh installer", scripts.macBootstrap, "install-mac.sh"],
    ["bootstrap-windows.ps1 default repo", scripts.windowsBootstrap, "augustocaruso/opencode-gemini-bridge"],
    ["bootstrap-windows.ps1 release asset", scripts.windowsBootstrap, "releases/latest/download/opencode-gemini-bridge-pack.zip"],
    ["bootstrap-windows.ps1 installer", scripts.windowsBootstrap, "install-windows.ps1"],
    ["install-mac.sh setup-ux", scripts.macInstaller, "setup-ux"],
    ["install-mac.sh setup-opencode", scripts.macInstaller, "setup-opencode"],
    ["install-windows.ps1 setup-ux", scripts.windowsInstaller, "setup-ux"],
    ["install-windows.ps1 setup-opencode", scripts.windowsInstaller, "setup-opencode"],
  ] as const;
  const missing = required.filter(([, text, needle]) => !text.includes(needle)).map(([label]) => label);

  checks.push({
    name: "Release bootstrap static check",
    status: missing.length ? "fail" : "pass",
    message: missing.length
      ? `Missing expected release/bootstrap token(s): ${missing.join(", ")}.`
      : "Bootstrap scripts download the release pack and installers apply setup-ux plus setup-opencode.",
    details: { repoRoot },
  });
}

function validateWindowsInstaller(projectRoot: string, checks: ValidationCheck[]): void {
  const repoRoot = findRepoRootWithScripts(projectRoot) ?? projectRoot;
  const scriptPath = path.join(repoRoot, "artifacts", "scripts", "install-windows.ps1");
  if (!fs.existsSync(scriptPath)) {
    checks.push({ name: "Windows installer static check", status: "skip", message: "artifacts/scripts/install-windows.ps1 is not present in this package checkout." });
    return;
  }

  const text = fs.readFileSync(scriptPath, "utf8");
  const required = [
    "Require-Command \"node\"",
    "Require-Command \"npm\"",
    "npm --prefix $CliDir install",
    "npm install --prefix $Prefix -g $CliDir",
    "ogb.cmd",
    "import",
    "setup-opencode",
    "setup-ux",
    "doctor",
    "validate --windows",
    "security-check",
    "dashboard",
  ];
  const missing = required.filter((needle) => !text.includes(needle));
  checks.push({
    name: "Windows installer static check",
    status: missing.length ? "fail" : "pass",
    message: missing.length ? `Missing expected installer token(s): ${missing.join(", ")}.` : "PowerShell installer has build, install, setup, doctor, validate, security-check and dashboard steps.",
  });
}

function validateOptionalOpenCodeRun(projectRoot: string, checks: ValidationCheck[]): void {
  if (!commandExists("opencode")) {
    checks.push({ name: "OpenCode live run", status: "skip", message: "opencode is not on PATH." });
    return;
  }

  const result = run("opencode", ["run", "--agent", "YOLO", "Say exactly: OGB_VALIDATE_OK"], projectRoot, 120000);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  checks.push({
    name: "OpenCode live run",
    status: result.error || result.status !== 0 || !output.includes("OGB_VALIDATE_OK") ? "warn" : "pass",
    message: result.error?.message ?? (output.includes("OGB_VALIDATE_OK") ? "OpenCode live run responded." : "OpenCode live run did not confirm the expected text."),
  });
}

export function runValidation(options: ValidationOptions = {}): ValidationReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const checks: ValidationCheck[] = [];
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

  addToolCheck(checks, "node", ["--version"], paths.projectRoot);
  addToolCheck(checks, "npm", ["--version"], paths.projectRoot);
  addToolCheck(checks, "gemini", ["--version"], paths.projectRoot);
  addToolCheck(checks, "opencode", ["--version"], paths.projectRoot);
  validateOgbGlobal(checks, paths.projectRoot);

  const generatedConfig = readJsonc(paths.generatedOpenCodeConfigPath);
  checks.push({
    name: "Generated config marker",
    status: generatedConfig?._generated?.tool === "ogb" && generatedConfig?._generated?.version === OGB_VERSION ? "pass" : "fail",
    message: generatedConfig?._generated?.tool === "ogb"
      ? `Generated config version is ${generatedConfig._generated.version ?? "unknown"}.`
      : "Missing ogb generated config marker.",
  });

  validateOpenCodeDebugConfig(paths.projectRoot, checks);
  validateReleaseBootstrap(paths.projectRoot, checks);
  if (options.windows) validateWindowsInstaller(paths.projectRoot, checks);
  if (options.opencodeRun) validateOptionalOpenCodeRun(paths.projectRoot, checks);

  const outcome = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";
  const report: ValidationReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    outcome,
    checks,
  };

  fs.mkdirSync(path.dirname(paths.validationPath), { recursive: true });
  fs.writeFileSync(paths.validationPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.json) {
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
