import path from "node:path";
import { resolveCommand } from "./command-resolution.js";
import { formatCommand } from "./extensions.js";
import { buildInstallerPlan, type InstallerPlan } from "./installer-planner.js";
import { runNativeCommand } from "./native-runner.js";
import { normalizePathInput, resolveProjectPaths } from "./paths.js";
import { writeStateRecord } from "./state-store.js";
import { OGB_VERSION } from "./types.js";
import type { RulesyncMode } from "./rulesync.js";

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
  postUpdate?: boolean;
  writeStatus?: boolean;
}

export interface SelfUpdateReport {
  status: "preview" | "applied" | "error";
  command: string[];
  plan: InstallerPlan;
  message: string;
  postUpdate?: PostUpdateRitualReport;
}

export interface PostUpdateRitualReport {
  status: "preview" | "skipped" | "pass" | "warn" | "fail" | "error";
  command: string[];
  exitCode?: number | null;
  signal?: string | null;
  message: string;
  stdoutTail?: string;
  stderrTail?: string;
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
  plan: InstallerPlan;
  selfUpdate?: SelfUpdateReport;
  postUpdate?: PostUpdateRitualReport;
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

function writeUpdateReport(projectRoot: string | undefined, report: UpdateCheckReport | AutoUpdateReport): void {
  writeStateRecord("update", { version: 1, ...report }, { projectRoot });
}

export function writeSelfUpdateSuccessStatus(options: SelfUpdateOptions = {}, now = new Date()): AutoUpdateReport {
  const selectedVersion = normalizeVersion(options.version);
  const latestTag = selectedVersion === "latest" ? undefined : selectedVersion;
  const checkedAt = now.toISOString();
  const check: UpdateCheckReport = {
    status: latestTag ? "available" : "unknown",
    currentVersion: OGB_VERSION,
    latestVersion: normalizeTagVersion(latestTag),
    latestTag,
    checkedAt,
    message: latestTag
      ? `OGB update completed for ${latestTag}.`
      : "OGB update completed from the latest release.",
  };
  const report: AutoUpdateReport = {
    status: "updated",
    currentVersion: OGB_VERSION,
    latestVersion: check.latestVersion,
    latestTag,
    checkedAt,
    finishedAt: checkedAt,
    restartRequired: true,
    message: latestTag
      ? `OGB update completed for ${latestTag}. Running the full bridge check and then restart OpenCode.`
      : "OGB update completed. Running the full bridge check and then restart OpenCode.",
    check,
    plan: buildUpdatePlan(options),
  };
  writeUpdateReport(options.projectRoot, report);
  return report;
}

function outputTail(value: unknown, maxChars = 4000): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

export function buildPostUpdateRitualCommand(options: SelfUpdateOptions = {}, platform: NodeJS.Platform = process.platform): string[] {
  const paths = resolveProjectPaths(options.projectRoot);
  const ogb = resolveCommand("ogb", { homeDir: paths.homeDir }) ?? "ogb";
  const args = ["--project", paths.projectRoot, "check", "--force"];
  if (platform === "win32") args.push("--windows");
  return [ogb, ...args];
}

function buildUpdatePlan(options: SelfUpdateOptions = {}, platform: NodeJS.Platform = process.platform): InstallerPlan {
  const paths = resolveProjectPaths(options.projectRoot);
  const rulesyncMode: RulesyncMode | undefined = options.rulesync === "auto" || options.rulesync === "off" || options.rulesync === "require"
    ? options.rulesync
    : undefined;
  return buildInstallerPlan({
    intent: "update",
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    platform,
    dryRun: options.dryRun,
    force: options.force,
    release: options.version,
    prefix: options.prefix,
    rulesyncMode,
    windows: platform === "win32",
  });
}

export function runPostUpdateRitual(options: SelfUpdateOptions = {}): PostUpdateRitualReport {
  const command = buildPostUpdateRitualCommand(options);
  if (options.setup === false) {
    return {
      status: "skipped",
      command,
      message: "Post-update check skipped because setup was disabled.",
    };
  }
  if (options.dryRun) {
    return {
      status: "preview",
      command,
      message: "Would run the full post-update bridge check.",
    };
  }

  const paths = resolveProjectPaths(options.projectRoot);
  const result = runNativeCommand({
    command: command[0],
    args: command.slice(1),
    cwd: paths.projectRoot,
    timeoutMs: 5 * 60_000,
    env: {
      ...process.env,
      NO_COLOR: process.env.NO_COLOR ?? "1",
    },
  });
  const stdoutTail = outputTail(result.stdout);
  const stderrTail = outputTail(result.stderr);

  if (result.error) {
    return {
      status: "error",
      command,
      exitCode: result.status,
      signal: result.signal,
      message: `Post-update check could not run: ${result.error}`,
      stdoutTail,
      stderrTail,
    };
  }

  const status = result.status === 0 ? "pass" : result.status === 1 ? "warn" : "fail";
  return {
    status,
    command,
    exitCode: result.status,
    signal: result.signal,
    message: status === "pass"
      ? "Post-update check completed cleanly."
      : status === "warn"
        ? "Post-update check completed with warnings."
        : `Post-update check failed with exit code ${result.status ?? "unknown"}.`,
    stdoutTail,
    stderrTail,
  };
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
  const plan = buildUpdatePlan(options);
  if (options.dryRun) {
    return {
      status: "preview",
      command,
      plan,
      message: "Would download the selected OGB release and rerun the official bootstrap installer.",
      postUpdate: runPostUpdateRitual({ ...options, dryRun: true }),
    };
  }

  const result = runNativeCommand({
    command: command[0],
    args: command.slice(1),
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    return { status: "error", command, plan, message: result.error };
  }
  if (result.status !== 0) {
    return { status: "error", command, plan, message: `Bootstrap exited with code ${result.status ?? "unknown"}.` };
  }
  let successStatus: AutoUpdateReport | undefined;
  try {
    if (options.writeStatus !== false) successStatus = writeSelfUpdateSuccessStatus(options);
  } catch {
    // Updating dashboard status must never turn a successful bootstrap into a failed self-update.
  }
  const postUpdate = options.postUpdate === false ? undefined : runPostUpdateRitual(options);
  if (successStatus && postUpdate) {
    try {
      writeUpdateReport(options.projectRoot, { ...successStatus, postUpdate });
    } catch {
      // Updating dashboard status must never turn a successful bootstrap into a failed self-update.
    }
  }
  const postUpdateFailed = postUpdate?.status === "fail" || postUpdate?.status === "error";
  if (postUpdateFailed) {
    return {
      status: "error",
      command,
      plan,
      postUpdate,
      message: `OGB bootstrap completed, but the post-update check did not finish cleanly: ${postUpdate.message}`,
    };
  }
  return {
    status: "applied",
    command,
    plan,
    postUpdate,
    message: postUpdate?.status === "warn"
      ? "OGB bootstrap completed. Full bridge check ran with warnings; see ogb check/dashboard for details."
      : postUpdate?.status === "skipped"
        ? "OGB bootstrap completed. Post-update check was skipped because setup was disabled."
        : "OGB bootstrap completed. Full bridge check was refreshed.",
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
      plan: buildUpdatePlan(options),
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
    postUpdate: false,
    writeStatus: false,
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
        ? `OGB updated to ${check.latestTag ?? check.latestVersion}. Running the full bridge check and then restart OpenCode.`
        : `OGB auto-update failed: ${selfUpdate.message}`,
    check,
    plan: buildUpdatePlan(selfUpdateOptions),
    selfUpdate,
  };
  if (options.write !== false) writeUpdateReport(options.projectRoot, report);
  if (updated && !options.dryRun) {
    const postUpdate = runPostUpdateRitual(options);
    report.postUpdate = postUpdate;
    report.selfUpdate = { ...selfUpdate, postUpdate };
    if (postUpdate.status === "fail" || postUpdate.status === "error") {
      report.status = "error";
      report.restartRequired = false;
      report.message = `OGB updated, but the post-update check did not finish cleanly: ${postUpdate.message}`;
    }
    if (options.write !== false) writeUpdateReport(options.projectRoot, report);
  }
  return report;
}

export function printSelfUpdateReport(report: SelfUpdateReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`OGB update: ${report.status}`);
  console.log(report.message);
  console.log(formatCommand(report.command));
  if (report.postUpdate) {
    console.log(`Post-update check: ${report.postUpdate.status}`);
    console.log(report.postUpdate.message);
    console.log(formatCommand(report.postUpdate.command));
  }
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
  if (report.postUpdate) {
    console.log(`Post-update check: ${report.postUpdate.status}`);
    console.log(report.postUpdate.message);
    console.log(formatCommand(report.postUpdate.command));
  }
}
