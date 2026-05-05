import { spawnSync } from "node:child_process";
import path from "node:path";
import { formatCommand } from "./extensions.js";

const DEFAULT_REPO = "augustocaruso/opencode-gemini-bridge";
const DEFAULT_VERSION = "latest";

export interface SelfUpdateOptions {
  repo?: string;
  version?: string;
  projectRoot?: string;
  prefix?: string;
  rulesync?: string;
  setup?: boolean;
  ux?: boolean;
  installOpenCode?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export interface SelfUpdateReport {
  status: "preview" | "applied" | "error";
  command: string[];
  message: string;
}

function normalizeRepo(repo: string | undefined): string {
  const value = repo?.trim() || DEFAULT_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid GitHub repo "${value}". Use OWNER/REPO.`);
  }
  return value;
}

function normalizeVersion(version: string | undefined): string {
  const value = version?.trim() || DEFAULT_VERSION;
  if (!/^(latest|[A-Za-z0-9._/-]+)$/.test(value)) {
    throw new Error(`Invalid release version "${value}". Use latest or a tag like v0.0.23.`);
  }
  return value;
}

function shQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function bootstrapArgs(options: SelfUpdateOptions, repo: string, version: string, projectRoot: string): string[] {
  const args = ["--repo", repo, "--version", version, "--project", projectRoot];
  if (options.prefix) args.push("--prefix", options.prefix);
  if (options.rulesync) args.push("--rulesync", options.rulesync);
  if (options.setup === false) args.push("--no-setup");
  if (options.ux === false) args.push("--no-ux");
  if (options.installOpenCode === false) args.push("--no-opencode");
  if (options.force) args.push("--force");
  return args;
}

function windowsBootstrapArgs(options: SelfUpdateOptions, repo: string, version: string, projectRoot: string): string[] {
  const args = ["-Repo", psQuote(repo), "-Version", psQuote(version), "-Project", psQuote(projectRoot)];
  if (options.prefix) args.push("-Prefix", psQuote(options.prefix));
  if (options.rulesync) args.push("-Rulesync", psQuote(options.rulesync));
  if (options.setup === false) args.push("-NoSetup");
  if (options.ux === false) args.push("-NoUx");
  if (options.installOpenCode === false) args.push("-NoOpenCode");
  if (options.force) args.push("-Force");
  return args;
}

export function buildSelfUpdateCommand(options: SelfUpdateOptions = {}, platform: NodeJS.Platform = process.platform): string[] {
  const repo = normalizeRepo(options.repo);
  const version = normalizeVersion(options.version);
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

  if (platform === "win32") {
    const bootstrapUrl = `https://raw.githubusercontent.com/${repo}/main/artifacts/scripts/bootstrap-windows.ps1`;
    const args = windowsBootstrapArgs(options, repo, version, projectRoot).join(" ");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('ogb-bootstrap-' + [System.Guid]::NewGuid().ToString('N') + '.ps1')",
      `Invoke-WebRequest -Uri ${psQuote(bootstrapUrl)} -OutFile $tmp`,
      `try { & $tmp ${args} } finally { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }`,
    ].join("; ");
    return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
  }

  const bootstrapUrl = `https://raw.githubusercontent.com/${repo}/main/artifacts/scripts/bootstrap-mac.sh`;
  const args = bootstrapArgs(options, repo, version, projectRoot).map(shQuote).join(" ");
  const script = `curl -fsSL ${shQuote(bootstrapUrl)} | bash -s -- ${args}`;
  return ["bash", "-lc", script];
}

export function runSelfUpdate(options: SelfUpdateOptions = {}): SelfUpdateReport {
  const command = buildSelfUpdateCommand(options);
  if (options.dryRun) {
    return {
      status: "preview",
      command,
      message: "Would download the selected OGB release and rerun the official bootstrap installer.",
    };
  }

  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    return { status: "error", command, message: result.error.message };
  }
  if (result.status !== 0) {
    return { status: "error", command, message: `Bootstrap exited with code ${result.status ?? "unknown"}.` };
  }
  return {
    status: "applied",
    command,
    message: "OGB bootstrap completed. OpenCode settings were reapplied without copying Gemini user content.",
  };
}

export function printSelfUpdateReport(report: SelfUpdateReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`OGB self-update: ${report.status}`);
  console.log(report.message);
  console.log(formatCommand(report.command));
}
