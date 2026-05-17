import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { sha256File } from "./file-hash.js";
import { globalOpenCodeConfigDir, globalOpenCodeConfigFiles } from "./opencode-paths.js";
import { resolveProjectPaths } from "./paths.js";
import { writeStateRecord } from "./state-store.js";
import { readTrustFile } from "./trust.js";
import { OGB_VERSION } from "./types.js";

export interface SecurityOptions {
  projectRoot?: string;
  homeDir?: string;
  json?: boolean;
  strict?: boolean;
  silent?: boolean;
}

export interface SecurityFinding {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  files?: string[];
}

export interface SecurityReport {
  version: string;
  projectRoot: string;
  generatedAt: string;
  outcome: "pass" | "warn" | "fail";
  findings: SecurityFinding[];
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".opencode/generated",
]);

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".cjs",
  ".toml",
  ".yaml",
  ".yml",
  ".sh",
  ".ps1",
  ".txt",
]);

function toPosix(input: string): string {
  return input.split(path.sep).join("/");
}

const HOME_SCOPED_SECURITY_PATHS = [
  ".config/opencode/opencode.json",
  ".config/opencode/opencode.jsonc",
  ".config/opencode/agents",
  ".config/opencode/commands",
  ".config/opencode/plugins",
  ".config/opencode/skills",
  ".config/opencode/tui-plugins",
  ".config/opencode/tui.json",
  ".config/opencode/tui.jsonc",
  ".config/opencode/dcp.jsonc",
  ".config/opencode-gemini-bridge/ogb.config.jsonc",
  ".config/opencode-gemini-bridge/ogb-trust.jsonc",
  ".config/opencode-gemini-bridge/generated/GEMINI.expanded.md",
  ".config/opencode-gemini-bridge/generated/ogb-extension-map.json",
];

function listProjectFiles(root: string, homeScoped = false): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      const relPath = toPosix(path.relative(root, fullPath));
      const relParts = relPath.split("/");
      if (entry.isDirectory()) {
        if (relParts.some((part, index) => IGNORED_DIRS.has(part) || IGNORED_DIRS.has(relParts.slice(0, index + 1).join("/")))) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".tgz") || entry.name.endsWith(".zip")) continue;
        out.push(fullPath);
      }
    }
  }

  if (homeScoped) {
    for (const relPath of HOME_SCOPED_SECURITY_PATHS) {
      const fullPath = path.join(root, ...relPath.split("/"));
      if (!fs.existsSync(fullPath)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(fullPath);
      else if (stat.isFile()) out.push(fullPath);
    }
  } else {
    walk(root);
  }
  return out;
}

function readTextMaybe(filePath: string): string | undefined {
  const ext = path.extname(filePath);
  if (!TEXT_EXTENSIONS.has(ext) && ![".env", ".npmrc"].includes(path.basename(filePath))) return undefined;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return undefined;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export function isSecretLikeRelPath(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  if (/^\.env(\.|$)/.test(base) && !/\.(example|sample|template)$/i.test(base)) return true;
  if (base === ".npmrc") return true;
  if (/^(auth|credentials|service-account|token)\.json$/i.test(base)) return true;
  if (/^id_(rsa|ed25519|ecdsa)$/i.test(base)) return true;
  return /\.(pem|p12|pfx|key)$/i.test(base);
}

export const HIGH_CONFIDENCE_SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["OpenAI key", /sk-[A-Za-z0-9_-]{32,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["GitHub token", /(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{30,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ["npm token", /_authToken\s*=\s*[A-Za-z0-9_-]{20,}/],
];

export function secretPatternLabels(text: string): string[] {
  return HIGH_CONFIDENCE_SECRET_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function findSecretFiles(projectRoot: string, files: string[]): SecurityFinding {
  const suspicious = files
    .map((filePath) => toPosix(path.relative(projectRoot, filePath)))
    .filter(isSecretLikeRelPath);

  return {
    name: "Secret-like files",
    status: suspicious.length ? "warn" : "pass",
    message: suspicious.length ? `${suspicious.length} secret-like file(s) need review.` : "No obvious secret files found in the project checkout.",
    files: suspicious,
  };
}

function findSecretPatterns(projectRoot: string, files: string[]): SecurityFinding {
  const hits: string[] = [];

  for (const filePath of files) {
    const text = readTextMaybe(filePath);
    if (!text) continue;
    const labels = secretPatternLabels(text);
    if (labels.length > 0) hits.push(`${toPosix(path.relative(projectRoot, filePath))} (${labels[0]})`);
  }

  return {
    name: "Secret patterns",
    status: hits.length ? "fail" : "pass",
    message: hits.length ? `${hits.length} high-confidence secret pattern(s) found.` : "No high-confidence secret patterns found.",
    files: hits,
  };
}

function checkOpenCodeEnvironment(configPath: string, displayPath: string): SecurityFinding {
  const config = readJsonc(configPath);
  const hits: string[] = [];
  const sensitiveKey = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|PRIVATE)/i;
  const safePlaceholder = /^(|false|true|0|1|<.*>|\$\{.*\}|\{env:[A-Za-z_][A-Za-z0-9_]*\}|process\.env\..*)$/;
  const sensitiveValue = /(\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk-|ntn_|ghp_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9._-]{8,}|["']?(?:authorization|api[_-]?key|token|secret|password)["']?\s*[:=]\s*["'][^"']{8,}["'])/i;

  for (const [mcpName, mcpConfig] of Object.entries<any>(config?.mcp ?? {})) {
    const env = mcpConfig?.environment;
    if (!env || typeof env !== "object" || Array.isArray(env)) continue;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && safePlaceholder.test(value)) continue;
      if (!sensitiveKey.test(key) && !(typeof value === "string" && sensitiveValue.test(value))) continue;
      hits.push(`${mcpName}.${key}`);
    }
  }

  return {
    name: "OpenCode MCP environment",
    status: hits.length ? "fail" : "pass",
    message: hits.length ? `Sensitive MCP environment value(s) are materialized in ${displayPath}: ${hits.join(", ")}.` : "No materialized sensitive MCP environment values found.",
    files: hits.length ? [displayPath] : undefined,
  };
}

function checkYoloAgent(yoloPath: string, displayPath: string): SecurityFinding {
  if (!fs.existsSync(yoloPath)) {
    return { name: "YOLO guardrails", status: "fail", message: `Missing ${displayPath}.` };
  }

  const text = fs.readFileSync(yoloPath, "utf8");
  const required = ["question: allow", "todowrite: allow", "edit: allow", "bash: allow", "task: allow", "external_directory: allow", "mode: primary"];
  const missing = required.filter((needle) => !text.includes(needle));
  return {
    name: "YOLO guardrails",
    status: missing.length ? "warn" : "pass",
    message: missing.length ? `YOLO agent is missing expected permission(s): ${missing.join(", ")}.` : "YOLO permissions are configured as allow.",
    files: [displayPath],
  };
}

function checkExtensionProjection(mapPath: string): SecurityFinding {
  const map = readJsonc(mapPath);
  if (!map) {
    return { name: "Extension projection safety", status: "warn", message: `Missing extension map: ${mapPath}. Run ogb sync.` };
  }

  const projectedRisk: string[] = [];
  let activeHooks = 0;
  let reviewOnlyHooks = 0;
  let scripts = 0;
  for (const extension of map.extensions ?? []) {
    for (const hook of extension.hooks ?? []) {
      if (hook.projected === true && typeof hook.target === "string" && hook.target.startsWith("opencode-plugin:")) activeHooks += 1;
      else if (hook.projected !== false) projectedRisk.push(`${extension.name}/${hook.source}`);
      else reviewOnlyHooks += 1;
    }
    for (const script of extension.scripts ?? []) {
      scripts += 1;
      if (script.projected !== false) projectedRisk.push(`${extension.name}/${script.source}`);
    }
  }

  return {
    name: "Extension projection safety",
    status: projectedRisk.length ? "fail" : "pass",
    message: projectedRisk.length
      ? `Hooks/scripts should not be auto-projected: ${projectedRisk.join(", ")}.`
      : `${activeHooks} hook(s) are synced through the OGB OpenCode plugin; ${reviewOnlyHooks} hook(s) and ${scripts} script-like file(s) are review-only.`,
  };
}

function checkTrustedExtensionResources(mapPath: string, projectRoot: string, homeDir?: string): SecurityFinding {
  const map = readJsonc(mapPath);
  const trust = readTrustFile(projectRoot, homeDir);
  const failures: string[] = [];
  let trusted = 0;

  for (const [extensionName, extensionTrust] of Object.entries(trust.extensions ?? {})) {
    const extension = (Array.isArray(map?.extensions) ? map.extensions : []).find((item: any) => item?.name === extensionName);
    if (!extension) {
      failures.push(`${extensionName} (extension missing from current map)`);
      continue;
    }

    for (const [kind, resources] of Object.entries<Record<string, { sha256?: string }>>({
      hooks: extensionTrust.hooks ?? {},
      scripts: extensionTrust.scripts ?? {},
    })) {
      for (const [source, record] of Object.entries(resources)) {
        trusted += 1;
        const filePath = path.join(extension.path, ...source.split("/"));
        if (!fs.existsSync(filePath)) {
          failures.push(`${extensionName}/${source} (${kind.slice(0, -1)} missing)`);
          continue;
        }
        const currentHash = sha256File(filePath);
        if (record.sha256 !== currentHash) failures.push(`${extensionName}/${source} (${kind.slice(0, -1)} hash changed)`);
      }
    }
  }

  return {
    name: "Trusted extension hooks/scripts",
    status: failures.length ? "fail" : "pass",
    message: failures.length
      ? `Trusted hook/script changed or disappeared: ${failures.join(", ")}. Re-review before trusting again.`
      : trusted > 0
        ? `${trusted} reviewed hook/script hash record(s) still match.`
        : "No manual hook/script hash records; supported extension hooks are synced automatically.",
    files: failures,
  };
}

export function runSecurityCheck(options: SecurityOptions = {}): SecurityReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const scanRoot = paths.homeMode ? paths.homeDir : paths.projectRoot;
  const files = listProjectFiles(scanRoot, paths.homeMode);
  const globalRoot = globalOpenCodeConfigDir({ homeDir: paths.homeDir });
  const globalConfigPath = globalOpenCodeConfigFiles({ homeDir: paths.homeDir }).find((filePath) => fs.existsSync(filePath))
    ?? path.join(globalRoot, "opencode.json");
  const configPath = paths.homeMode ? globalConfigPath : path.join(paths.projectRoot, "opencode.jsonc");
  const configDisplayPath = paths.homeMode ? toPosix(path.relative(paths.homeDir, configPath)) : "opencode.jsonc";
  const yoloPath = paths.homeMode
    ? path.join(globalRoot, "agents", "YOLO.md")
    : path.join(paths.projectRoot, ".opencode", "agents", "YOLO.md");
  const yoloDisplayPath = paths.homeMode ? ".config/opencode/agents/YOLO.md" : ".opencode/agents/YOLO.md";
  const findings: SecurityFinding[] = [
    findSecretFiles(scanRoot, files),
    findSecretPatterns(scanRoot, files),
    checkOpenCodeEnvironment(configPath, configDisplayPath),
    checkYoloAgent(yoloPath, yoloDisplayPath),
    checkExtensionProjection(paths.extensionMapPath),
    checkTrustedExtensionResources(paths.extensionMapPath, paths.projectRoot, paths.homeDir),
  ];

  const outcome = findings.some((finding) => finding.status === "fail")
    ? "fail"
    : findings.some((finding) => finding.status === "warn")
      ? "warn"
      : "pass";
  const report: SecurityReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    generatedAt: new Date().toISOString(),
    outcome,
    findings,
  };

  writeStateRecord("security", report as unknown as Record<string, unknown>, { projectRoot: paths.projectRoot, homeDir: paths.homeDir });

  if (options.silent) {
    // Report is written to disk for callers such as ogb check.
  } else if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("OpenCode Gemini Bridge Security Check");
    console.log(`Project: ${report.projectRoot}`);
    console.log(`Outcome: ${report.outcome}`);
    for (const finding of findings) console.log(`- ${finding.status.toUpperCase()} ${finding.name}: ${finding.message}`);
  }

  if (options.strict && outcome !== "pass") process.exitCode = outcome === "fail" ? 2 : 1;
  return report;
}
