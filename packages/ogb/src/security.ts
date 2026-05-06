import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { sha256File } from "./file-hash.js";
import { resolveProjectPaths } from "./paths.js";
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
  "opencode.jsonc",
  ".opencode/agents",
  ".opencode/commands",
  ".opencode/plugins",
  ".opencode/skills",
  ".opencode/tui-plugins",
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

function findSecretFiles(projectRoot: string, files: string[]): SecurityFinding {
  const suspicious = files
    .map((filePath) => toPosix(path.relative(projectRoot, filePath)))
    .filter((relPath) => {
      const base = path.posix.basename(relPath);
      if (/^\.env(\.|$)/.test(base) && !/\.(example|sample|template)$/i.test(base)) return true;
      if (base === ".npmrc") return true;
      if (/^(auth|credentials|service-account|token)\.json$/i.test(base)) return true;
      if (/^id_(rsa|ed25519|ecdsa)$/i.test(base)) return true;
      return /\.(pem|p12|pfx|key)$/i.test(base);
    });

  return {
    name: "Secret-like files",
    status: suspicious.length ? "warn" : "pass",
    message: suspicious.length ? `${suspicious.length} secret-like file(s) need review.` : "No obvious secret files found in the project checkout.",
    files: suspicious,
  };
}

function findSecretPatterns(projectRoot: string, files: string[]): SecurityFinding {
  const patterns: Array<[string, RegExp]> = [
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["OpenAI key", /sk-[A-Za-z0-9_-]{32,}/],
    ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
    ["GitHub token", /(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{30,}/],
    ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/],
    ["npm token", /_authToken\s*=\s*[A-Za-z0-9_-]{20,}/],
  ];
  const hits: string[] = [];

  for (const filePath of files) {
    const text = readTextMaybe(filePath);
    if (!text) continue;
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) {
        hits.push(`${toPosix(path.relative(projectRoot, filePath))} (${label})`);
        break;
      }
    }
  }

  return {
    name: "Secret patterns",
    status: hits.length ? "fail" : "pass",
    message: hits.length ? `${hits.length} high-confidence secret pattern(s) found.` : "No high-confidence secret patterns found.",
    files: hits,
  };
}

function checkOpenCodeEnvironment(projectRoot: string): SecurityFinding {
  const config = readJsonc(path.join(projectRoot, "opencode.jsonc"));
  const hits: string[] = [];
  const sensitiveKey = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|PRIVATE)/i;
  const safePlaceholder = /^(|false|true|0|1|<.*>|\$\{.*\}|process\.env\..*)$/;

  for (const [mcpName, mcpConfig] of Object.entries<any>(config?.mcp ?? {})) {
    const env = mcpConfig?.environment;
    if (!env || typeof env !== "object" || Array.isArray(env)) continue;
    for (const [key, value] of Object.entries(env)) {
      if (!sensitiveKey.test(key)) continue;
      if (typeof value === "string" && safePlaceholder.test(value)) continue;
      hits.push(`${mcpName}.${key}`);
    }
  }

  return {
    name: "OpenCode MCP environment",
    status: hits.length ? "fail" : "pass",
    message: hits.length ? `Sensitive MCP environment value(s) are materialized in opencode.jsonc: ${hits.join(", ")}.` : "No materialized sensitive MCP environment values found.",
    files: hits.length ? ["opencode.jsonc"] : undefined,
  };
}

function checkYoloAgent(projectRoot: string): SecurityFinding {
  const yoloPath = path.join(projectRoot, ".opencode", "agents", "YOLO.md");
  if (!fs.existsSync(yoloPath)) {
    return { name: "YOLO guardrails", status: "fail", message: "Missing .opencode/agents/YOLO.md." };
  }

  const text = fs.readFileSync(yoloPath, "utf8");
  const required = ["question: allow", "todowrite: allow", "edit: allow", "bash: allow", "task: allow", "external_directory: allow", "mode: primary"];
  const missing = required.filter((needle) => !text.includes(needle));
  return {
    name: "YOLO guardrails",
    status: missing.length ? "warn" : "pass",
    message: missing.length ? `YOLO agent is missing expected permission(s): ${missing.join(", ")}.` : "YOLO permissions are configured as allow.",
    files: [".opencode/agents/YOLO.md"],
  };
}

function checkExtensionProjection(projectRoot: string): SecurityFinding {
  const map = readJsonc(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"));
  if (!map) {
    return { name: "Extension projection safety", status: "warn", message: "Missing extension map. Run ogb sync." };
  }

  const projectedRisk: string[] = [];
  let hooks = 0;
  let scripts = 0;
  for (const extension of map.extensions ?? []) {
    for (const hook of extension.hooks ?? []) {
      hooks += 1;
      if (hook.projected !== false) projectedRisk.push(`${extension.name}/${hook.source}`);
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
      : `${hooks} hook(s) and ${scripts} script-like file(s) are mapped for review, not copied into OpenCode.`,
  };
}

function checkTrustedExtensionResources(projectRoot: string, homeDir?: string): SecurityFinding {
  const map = readJsonc(path.join(projectRoot, ".opencode", "generated", "ogb-extension-map.json"));
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
        ? `${trusted} trusted hook/script resource(s) still match recorded hashes.`
        : "No extension hooks/scripts are trusted for execution.",
    files: failures,
  };
}

export function runSecurityCheck(options: SecurityOptions = {}): SecurityReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const files = listProjectFiles(paths.projectRoot, path.resolve(paths.projectRoot) === path.resolve(paths.homeDir));
  const findings: SecurityFinding[] = [
    findSecretFiles(paths.projectRoot, files),
    findSecretPatterns(paths.projectRoot, files),
    checkOpenCodeEnvironment(paths.projectRoot),
    checkYoloAgent(paths.projectRoot),
    checkExtensionProjection(paths.projectRoot),
    checkTrustedExtensionResources(paths.projectRoot, paths.homeDir),
  ];

  const outcome = findings.some((finding) => finding.status === "fail")
    ? "fail"
    : findings.some((finding) => finding.status === "warn")
      ? "warn"
      : "pass";
  const report: SecurityReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    outcome,
    findings,
  };

  fs.mkdirSync(path.dirname(paths.securityPath), { recursive: true });
  fs.writeFileSync(paths.securityPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.silent) {
    // Report is written to disk for callers such as ogb pass.
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
