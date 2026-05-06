import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { formatCommand } from "./extensions.js";
import { normalizePathInput, resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

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

export interface UpdateCheckOptions {
  repo?: string;
  currentVersion?: string;
  projectRoot?: string;
  write?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface UpdateCheckReport {
  status: "current" | "available" | "unknown";
  currentVersion: string;
  latestVersion?: string;
  latestTag?: string;
  releaseUrl?: string;
  checkedAt: string;
  message: string;
}

export interface AutoUpdateOptions extends SelfUpdateOptions {
  currentVersion?: string;
  write?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface AutoUpdateReport {
  status: "current" | "available" | "updated" | "error" | "unknown";
  currentVersion: string;
  latestVersion?: string;
  latestTag?: string;
  releaseUrl?: string;
  checkedAt: string;
  finishedAt?: string;
  restartRequired: boolean;
  message: string;
  check: UpdateCheckReport;
  selfUpdate?: SelfUpdateReport;
}

type FetchResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponseLike>;

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

function normalizeTagVersion(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^v/i, "");
}

function parseVersion(value: string | undefined): number[] | undefined {
  const normalized = normalizeTagVersion(value);
  const match = normalized?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: string | undefined, b: string | undefined): number | undefined {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return undefined;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function latestIsNewer(currentVersion: string, latestTag: string): boolean {
  const comparison = compareVersions(latestTag, currentVersion);
  if (comparison !== undefined) return comparison > 0;
  return normalizeTagVersion(latestTag) !== normalizeTagVersion(currentVersion);
}

function updateStatusPath(projectRoot: string | undefined): string {
  return resolveProjectPaths(projectRoot).updateStatusPath;
}

function writeUpdateReport(projectRoot: string | undefined, report: UpdateCheckReport | AutoUpdateReport): void {
  const filePath = updateStatusPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, ...report }, null, 2)}\n`, "utf8");
}

async function fetchLatestRelease(options: UpdateCheckOptions, repo: string): Promise<{
  tag: string;
  url?: string;
}> {
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  if (!fetcher) throw new Error("fetch is unavailable in this Node.js runtime.");

  const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "opencode-gemini-bridge",
    },
  });
  if (!response.ok) throw new Error(`GitHub releases API returned HTTP ${response.status}.`);

  const payload = await response.json() as Record<string, unknown>;
  const tag = typeof payload.tag_name === "string" ? payload.tag_name : "";
  if (!tag.trim()) throw new Error("GitHub latest release did not include tag_name.");
  const url = typeof payload.html_url === "string" ? payload.html_url : undefined;
  return { tag, url };
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
  if (options.prefix) args.push("--prefix", normalizePathInput(options.prefix));
  if (options.rulesync) args.push("--rulesync", options.rulesync);
  if (options.setup === false) args.push("--no-setup");
  if (options.ux === false) args.push("--no-ux");
  if (options.installOpenCode === false) args.push("--no-opencode");
  if (options.force) args.push("--force");
  return args;
}

function windowsBootstrapArgs(options: SelfUpdateOptions, repo: string, version: string, projectRoot: string): string[] {
  const args = ["-Repo", psQuote(repo), "-Version", psQuote(version), "-Project", psQuote(projectRoot)];
  if (options.prefix) args.push("-Prefix", psQuote(normalizePathInput(options.prefix)));
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
  const projectRoot = path.resolve(normalizePathInput(options.projectRoot ?? process.cwd()));

  if (platform === "win32") {
    const bootstrapUrl = `https://raw.githubusercontent.com/${repo}/main/scripts/bootstrap-windows.ps1`;
    const args = windowsBootstrapArgs(options, repo, version, projectRoot).join(" ");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$PSNativeCommandUseErrorActionPreference = $false",
      "$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('ogb-bootstrap-' + [System.Guid]::NewGuid().ToString('N') + '.ps1')",
      `Invoke-WebRequest -Uri ${psQuote(bootstrapUrl)} -OutFile $tmp`,
      `try { & $tmp ${args} } finally { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }`,
    ].join("; ");
    return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
  }

  const bootstrapUrl = `https://raw.githubusercontent.com/${repo}/main/scripts/bootstrap-mac.sh`;
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

export async function checkOgbUpdate(options: UpdateCheckOptions = {}): Promise<UpdateCheckReport> {
  const repo = normalizeRepo(options.repo);
  const currentVersion = normalizeTagVersion(options.currentVersion ?? OGB_VERSION) ?? OGB_VERSION;
  const checkedAt = (options.now ?? new Date()).toISOString();

  try {
    const release = await fetchLatestRelease(options, repo);
    const latestVersion = normalizeTagVersion(release.tag);
    if (!parseVersion(release.tag)) {
      throw new Error(`Latest release tag "${release.tag}" is not a supported semantic version.`);
    }
    const available = latestIsNewer(currentVersion, release.tag);
    const report: UpdateCheckReport = {
      status: available ? "available" : "current",
      currentVersion,
      latestVersion,
      latestTag: release.tag,
      releaseUrl: release.url,
      checkedAt,
      message: available
        ? `OGB ${release.tag} is available; current version is ${currentVersion}.`
        : `OGB is current at ${currentVersion}.`,
    };
    if (options.write !== false) writeUpdateReport(options.projectRoot, report);
    return report;
  } catch (error) {
    const report: UpdateCheckReport = {
      status: "unknown",
      currentVersion,
      checkedAt,
      message: `Could not check OGB updates: ${error instanceof Error ? error.message : String(error)}`,
    };
    if (options.write !== false) writeUpdateReport(options.projectRoot, report);
    return report;
  }
}

export async function runAutoUpdate(options: AutoUpdateOptions = {}): Promise<AutoUpdateReport> {
  const check = await checkOgbUpdate({
    repo: options.repo,
    currentVersion: options.currentVersion,
    projectRoot: options.projectRoot,
    write: false,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });

  if (check.status !== "available") {
    const report: AutoUpdateReport = {
      status: check.status,
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      latestTag: check.latestTag,
      releaseUrl: check.releaseUrl,
      checkedAt: check.checkedAt,
      restartRequired: false,
      message: check.message,
      check,
    };
    if (options.write !== false) writeUpdateReport(options.projectRoot, report);
    return report;
  }

  const selfUpdateOptions: SelfUpdateOptions = {
    repo: options.repo,
    version: check.latestTag ?? check.latestVersion,
    projectRoot: options.projectRoot,
    prefix: options.prefix,
    rulesync: options.rulesync,
    setup: options.setup,
    ux: options.ux,
    installOpenCode: options.installOpenCode ?? false,
    force: options.force,
    dryRun: options.dryRun,
  };
  const selfUpdate = runSelfUpdate(selfUpdateOptions);
  const updated = selfUpdate.status === "applied";
  const report: AutoUpdateReport = {
    status: options.dryRun ? "available" : updated ? "updated" : "error",
    currentVersion: check.currentVersion,
    latestVersion: check.latestVersion,
    latestTag: check.latestTag,
    releaseUrl: check.releaseUrl,
    checkedAt: check.checkedAt,
    finishedAt: new Date().toISOString(),
    restartRequired: updated,
    message: options.dryRun
      ? `Would update OGB from ${check.currentVersion} to ${check.latestTag ?? check.latestVersion}.`
      : updated
        ? `OGB updated to ${check.latestTag ?? check.latestVersion}. Restart OpenCode to load the new plugin and commands.`
        : `OGB auto-update failed: ${selfUpdate.message}`,
    check,
    selfUpdate,
  };
  if (options.write !== false) writeUpdateReport(options.projectRoot, report);
  return report;
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

export function printUpdateCheckReport(report: UpdateCheckReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`OGB update check: ${report.status}`);
  console.log(report.message);
  if (report.releaseUrl) console.log(report.releaseUrl);
}

export function printAutoUpdateReport(report: AutoUpdateReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`OGB auto-update: ${report.status}`);
  console.log(report.message);
  if (report.selfUpdate) console.log(formatCommand(report.selfUpdate.command));
}
