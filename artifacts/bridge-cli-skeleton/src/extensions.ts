import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ExtensionInstallOptions {
  source: string;
  ref?: string;
  autoUpdate?: boolean;
  preRelease?: boolean;
  trust?: boolean;
  dryRun?: boolean;
  geminiBin?: string;
}

export interface ExtensionUpdateOptions {
  name?: string;
  all?: boolean;
  dryRun?: boolean;
  geminiBin?: string;
}

export interface ExtensionSourceInspection {
  source: string;
  installSource: string;
  local: boolean;
  extensionRoot?: string;
  manifestPath?: string;
  hooks: string[];
  scripts: string[];
  warnings: string[];
}

export interface ExtensionCommandReport {
  status: "applied" | "preview" | "blocked" | "error";
  command: string[];
  inspection?: ExtensionSourceInspection;
}

function isRemoteSource(source: string): boolean {
  return /^(https?:|git@|ssh:|git:)/.test(source) || source.endsWith(".git");
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function findManifestRoot(root: string): string | undefined {
  if (fileExists(path.join(root, "gemini-extension.json"))) return root;
  if (!dirExists(root)) return undefined;

  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    if (fileExists(path.join(candidate, "gemini-extension.json"))) return candidate;
  }

  return undefined;
}

function listRiskFiles(root: string, relRoot = "", depth = 0): { hooks: string[]; scripts: string[] } {
  const hooks: string[] = [];
  const scripts: string[] = [];
  if (!dirExists(root) || depth > 3) return { hooks, scripts };

  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    const relPath = path.join(relRoot, entry.name).split(path.sep).join("/");

    if (entry.isDirectory()) {
      const nested = listRiskFiles(fullPath, relPath, depth + 1);
      hooks.push(...nested.hooks);
      scripts.push(...nested.scripts);
      continue;
    }

    if (!entry.isFile()) continue;
    if (relPath === "hooks/hooks.json" || relPath.endsWith("/hooks/hooks.json") || entry.name === "hooks.json") hooks.push(relPath);
    if (/\.(sh|bash|zsh|ps1|bat|cmd)$/i.test(entry.name)) scripts.push(relPath);
  }

  return { hooks, scripts };
}

export function inspectExtensionSource(source: string): ExtensionSourceInspection {
  if (isRemoteSource(source)) {
    return {
      source,
      installSource: source,
      local: false,
      hooks: [],
      scripts: [],
      warnings: ["Remote extensions cannot be inspected before install; use --trust only for sources you trust."],
    };
  }

  const resolved = path.resolve(source);
  const extensionRoot = findManifestRoot(resolved);
  const warnings: string[] = [];
  if (!extensionRoot) warnings.push("Missing gemini-extension.json; Gemini CLI install may fail.");
  const risks = extensionRoot ? listRiskFiles(extensionRoot) : { hooks: [], scripts: [] };
  if (risks.hooks.length) warnings.push(`Hooks found: ${risks.hooks.join(", ")}`);
  if (risks.scripts.length) warnings.push(`Executable scripts found: ${risks.scripts.join(", ")}`);

  return {
    source,
    installSource: extensionRoot ?? resolved,
    local: true,
    extensionRoot,
    manifestPath: extensionRoot ? path.join(extensionRoot, "gemini-extension.json") : undefined,
    hooks: risks.hooks,
    scripts: risks.scripts,
    warnings,
  };
}

export function buildInstallExtensionArgs(options: ExtensionInstallOptions): string[] {
  const inspection = inspectExtensionSource(options.source);
  const args = ["extensions", "install", inspection.installSource];
  if (options.ref) args.push("--ref", options.ref);
  if (options.autoUpdate ?? !inspection.local) args.push("--auto-update");
  if (options.preRelease) args.push("--pre-release");
  if (options.trust) args.push("--consent");
  return args;
}

export function buildUpdateExtensionsArgs(options: ExtensionUpdateOptions = {}): string[] {
  const args = ["extensions", "update"];
  if (options.name) args.push(options.name);
  else if (options.all !== false) args.push("--all");
  return args;
}

function runGemini(geminiBin: string, args: string[], cwd = process.cwd()): boolean {
  const result = spawnSync(geminiBin, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  return !result.error && result.status === 0;
}

export function installGeminiExtension(options: ExtensionInstallOptions): ExtensionCommandReport {
  const geminiBin = options.geminiBin ?? process.env.GEMINI_BIN ?? "gemini";
  const inspection = inspectExtensionSource(options.source);
  const command = [geminiBin, ...buildInstallExtensionArgs(options)];
  const hasLocalRisk = inspection.local && (inspection.hooks.length > 0 || inspection.scripts.length > 0);

  if (hasLocalRisk && !options.trust) {
    return { status: options.dryRun ? "preview" : "blocked", command, inspection };
  }

  if (options.dryRun) return { status: "preview", command, inspection };

  if (inspection.local && inspection.extensionRoot) {
    const valid = runGemini(geminiBin, ["extensions", "validate", inspection.extensionRoot]);
    if (!valid) return { status: "error", command, inspection };
  }

  return {
    status: runGemini(geminiBin, command.slice(1)) ? "applied" : "error",
    command,
    inspection,
  };
}

export function updateGeminiExtensions(options: ExtensionUpdateOptions = {}): ExtensionCommandReport {
  const geminiBin = options.geminiBin ?? process.env.GEMINI_BIN ?? "gemini";
  const command = [geminiBin, ...buildUpdateExtensionsArgs(options)];

  if (options.dryRun) return { status: "preview", command };
  return {
    status: runGemini(geminiBin, command.slice(1)) ? "applied" : "error",
    command,
  };
}

export function formatCommand(command: string[]): string {
  return command.map((part) => /^[A-Za-z0-9_./:=@%+-]+$/.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`).join(" ");
}
