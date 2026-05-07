#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runAgentSyncAdoption } from "./agent-sync-adoption.js";
import { runBidirectionalSync } from "./bidirectional-sync.js";
import { runDashboard } from "./dashboard.js";
import { runDoctor } from "./doctor.js";
import { externalOpenCodePlugins } from "./external-integrations.js";
import { formatCommand, installGeminiExtension, updateGeminiExtensions } from "./extensions.js";
import { flattenGeminiMd } from "./flatten.js";
import { cleanupHomeProjectArtifacts, printHomeCleanupReport } from "./home-cleanup.js";
import { printInstallReport, runInstall } from "./install.js";
import { buildInventory, writeInventory } from "./inventory.js";
import { formatLimits, refreshLimits } from "./limits.js";
import { buildOpenCodeLaunchArgs } from "./launch.js";
import { readOgbConfig } from "./ogb-config.js";
import { runPass } from "./pass.js";
import { defaultGeminiInput, isHomeProject, resolveProjectPaths } from "./paths.js";
import { spawnCommand } from "./process.js";
import { ensureProjectConfig } from "./project-config.js";
import { printResetReport, ResetConfirmationError, ResetNotHomeError, runReset } from "./reset.js";
import { rulesyncDefaultFeatures, type RulesyncMode } from "./rulesync.js";
import { printSetupReport, setupOpenCode } from "./setup-opencode.js";
import { printSetupUxReport, setupUx } from "./setup-ux.js";
import { runSecurityCheck } from "./security.js";
import { checkOgbUpdate, printAutoUpdateReport, printSelfUpdateReport, printUpdateCheckReport, runAutoUpdate, runSelfUpdate } from "./self-update.js";
import { printStartupSyncReport, runStartupSync } from "./startup-sync.js";
import { syncToOpenCode } from "./sync.js";
import { formatTelemetryEmailSetupResult, setupTelemetryEmailReceiver, TelemetrySetupError } from "./telemetry-email-setup.js";
import { disableTelemetry, enableTelemetry, previewTelemetryEnvelope, printTelemetrySendResult, printTelemetryStatus, recordWorkflowRun, safeRecordWorkflowRun, sendTelemetry, telemetryStatus, TELEMETRY_PAYLOAD_LEVELS, type TelemetryPayloadLevel } from "./telemetry.js";
import { runTrustExtension, runTrustReview } from "./trust.js";
import { OGB_VERSION } from "./types.js";
import { runValidation } from "./validation.js";
import { renderRitualReport, shouldUseRitualUi } from "./ritual-ui.js";

export const program = new Command();

export const LEGACY_PASS_WARNING = "warning: ogb pass is deprecated; use ogb check.";
export const LEGACY_SELF_UPDATE_WARNING = "warning: ogb self-update is deprecated; use ogb update.";
export const LEGACY_UPGRADE_WARNING = "warning: ogb upgrade-ogb is deprecated; use ogb update.";

function normalizeRulesyncMode(raw: unknown): RulesyncMode {
  if (raw === false) return "off";
  if (raw === "off" || raw === "auto" || raw === "require") return raw;
  throw new Error(`Invalid Rulesync mode: ${String(raw)}. Use auto, off, or require.`);
}

function splitFeatures(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function commonProjectOptions() {
  return program.opts<{ project?: string }>();
}

function runImportWorkflow(opts: { dryRun?: boolean; force?: boolean; rulesync?: unknown; features?: string }) {
  const projectRoot = commonProjectOptions().project;
  const paths = resolveProjectPaths(projectRoot);
  const geminiInput = paths.homeMode
    ? path.join(paths.homeDir, ".gemini", "GEMINI.md")
    : defaultGeminiInput(paths.projectRoot, paths.homeDir);

  if (opts.dryRun) {
    const inv = buildInventory({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
    console.log(`Would inventory ${inv.geminiFiles.length} GEMINI.md file(s), ${inv.imports.length} import(s), ${inv.mcps.length} MCP(s)`);
  } else {
    writeInventory({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  }
  flattenGeminiMd({
    input: geminiInput,
    output: paths.expandedGeminiPath,
    write: !opts.dryRun,
    homeDir: paths.homeDir,
  });
  syncToOpenCode({
    projectRoot: paths.projectRoot,
    homeDir: paths.homeDir,
    dryRun: opts.dryRun,
    force: opts.force,
    rulesyncMode: normalizeRulesyncMode(opts.rulesync),
    rulesyncFeatures: splitFeatures(opts.features),
  });
  if (opts.dryRun) console.log("Dry-run import complete");
  else {
    runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
    runDashboard({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true, refresh: false });
  }
}

function maybePostExtensionSync(opts: { dryRun?: boolean; skipSync?: boolean; skipDoctor?: boolean; force?: boolean }) {
  const { project } = commonProjectOptions();
  const paths = resolveProjectPaths(project);
  if (opts.dryRun) {
    if (!opts.skipSync) console.log("Would run ogb sync after extension command.");
    if (!opts.skipDoctor) console.log("Would run ogb doctor after extension command.");
    return;
  }

  if (!opts.skipSync) syncToOpenCode({ projectRoot: paths.projectRoot, force: opts.force });
  if (!opts.skipDoctor) {
    runDoctor({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
    runDashboard({ projectRoot: paths.projectRoot, homeDir: paths.homeDir, silent: true, refresh: false });
  }
}

function printExtensionReport(report: { status: string; command: string[]; inspection?: { warnings: string[] } }) {
  console.log(`Gemini extension command: ${report.status}`);
  console.log(formatCommand(report.command));
  for (const warning of report.inspection?.warnings ?? []) console.log(`Warning: ${warning}`);
}

function telemetryPayloadLevel(value: string | undefined): TelemetryPayloadLevel {
  if (!value) return "diagnostic_redacted";
  if ((TELEMETRY_PAYLOAD_LEVELS as readonly string[]).includes(value)) return value as TelemetryPayloadLevel;
  throw new Error(`Invalid payload level: ${value}. Use diagnostic_redacted or full_logs.`);
}

function payloadOutcome(payload: unknown, exitCode: number, error?: unknown): string {
  if (error || exitCode > 1) return "fail";
  if (exitCode === 1) return "warn";
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const raw = (payload as any).outcome ?? (payload as any).status ?? (payload as any).state;
    if (raw === "fail" || raw === "error" || raw === "blocked") return "fail";
    if (raw === "warn" || raw === "warning" || raw === "partial") return "warn";
  }
  return "pass";
}

function payloadStatus(payload: unknown, exitCode: number, error?: unknown): string {
  const outcome = payloadOutcome(payload, exitCode, error);
  if (outcome === "fail") return "failed";
  if (outcome === "warn") return "completed_with_warnings";
  return "completed";
}

async function withWorkflowTelemetry<T>(workflow: string, action: () => T | Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const { project } = commonProjectOptions();
  const paths = resolveProjectPaths(project);
  let payload: unknown;
  let thrown: unknown;
  try {
    payload = await action();
    return payload as T;
  } catch (error) {
    thrown = error;
    payload = { error: error instanceof Error ? error.message : String(error) };
    throw error;
  } finally {
    const previousExitCode = process.exitCode;
    const exitCode = Number(process.exitCode ?? (thrown ? 1 : 0));
    await safeRecordWorkflowRun({
      workflow,
      phase: "cli",
      status: payloadStatus(payload, exitCode, thrown),
      outcome: payloadOutcome(payload, exitCode, thrown),
      exitCode,
      durationMs: Date.now() - startedAt,
      command: `ogb ${workflow}`,
      source: "cli",
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      payload,
      rawPayload: payload,
    }, { homeDir: paths.homeDir });
    process.exitCode = previousExitCode;
  }
}

function warnLegacyCommand(message: string): void {
  console.error(message);
}

type CheckCliOptions = {
  json?: boolean;
  plain?: boolean;
  dryRun?: boolean;
  force?: boolean;
  acceptHooks?: boolean;
  windows?: boolean;
  setup?: boolean;
  sync?: boolean;
  validation?: boolean;
  security?: boolean;
  dashboard?: boolean;
};

function addCheckOptions(command: Command): Command {
  return command
    .option("--json", "Print JSON report")
    .option("--plain", "Use the classic text report instead of the rich terminal UI")
    .option("--dry-run", "Preview check actions without writing trust changes")
    .option("--force", "Overwrite files previously changed outside ogb management")
    .option("--accept-hooks", "Record current Gemini hooks as reviewed by hash")
    .option("--windows", "Include Windows installer/static checks during validation")
    .option("--no-setup", "Skip setup-opencode")
    .option("--no-sync", "Skip sync")
    .option("--no-validation", "Skip validate")
    .option("--no-security", "Skip security-check")
    .option("--no-dashboard", "Skip dashboard");
}

async function runCheckCli(opts: CheckCliOptions, workflow: "check" | "pass", legacyWarning?: string): Promise<void> {
  if (legacyWarning) warnLegacyCommand(legacyWarning);
  const useUi = shouldUseRitualUi({ json: opts.json, plain: opts.plain });
  await withWorkflowTelemetry(workflow, async () => {
    const { project } = commonProjectOptions();
    const report = runPass({
      projectRoot: project,
      json: opts.json,
      dryRun: opts.dryRun,
      force: opts.force,
      acceptHooks: opts.acceptHooks,
      windows: opts.windows,
      skipSetup: opts.setup === false,
      skipSync: opts.sync === false,
      skipValidation: opts.validation === false,
      skipSecurity: opts.security === false,
      skipDashboard: opts.dashboard === false,
      silent: useUi,
    });
    if (useUi) await renderRitualReport("check", report);
    return report;
  });
}

type UpdateCliOptions = {
  repo?: string;
  release?: string;
  prefix?: string;
  rulesync?: string;
  setup?: boolean;
  ux?: boolean;
  installOpencode?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  plain?: boolean;
};

function addUpdateOptions(command: Command): Command {
  return command
    .description("Update OGB from the GitHub release pack and run the full post-update check")
    .option("--repo <owner/repo>", "GitHub repo that publishes OGB releases", "augustocaruso/opencode-gemini-bridge")
    .option("--release <tag>", "Release tag to install; defaults to latest", "latest")
    .option("--prefix <path>", "Install prefix passed to the installer")
    .option("--rulesync <mode>", "Rulesync mode passed to first-run setup", "auto")
    .option("--no-setup", "Update ogb/profile only; skip import/setup/doctor validation")
    .option("--no-ux", "Do not reapply the global OpenCode UX profile")
    .option("--no-install-opencode", "Do not install OpenCode when it is missing")
    .option("--force", "Pass force to the bootstrap installer")
    .option("--dry-run", "Print the bootstrap command without running it")
    .option("--json", "Print JSON report")
    .option("--plain", "Use the classic text report instead of the rich terminal UI");
}

async function runUpdateCli(opts: UpdateCliOptions, legacyWarning?: string): Promise<void> {
  if (legacyWarning) warnLegacyCommand(legacyWarning);
  const { project } = commonProjectOptions();
  const useUi = shouldUseRitualUi({ json: opts.json, plain: opts.plain });
  const report = runSelfUpdate({
    repo: opts.repo,
    version: opts.release,
    projectRoot: project,
    prefix: opts.prefix,
    rulesync: opts.rulesync,
    setup: opts.setup,
    ux: opts.ux,
    installOpenCode: opts.installOpencode,
    force: opts.force,
    dryRun: opts.dryRun,
  });
  if (useUi) await renderRitualReport("update", report);
  else printSelfUpdateReport(report, opts.json);
  if (report.status === "error") process.exitCode = 2;
}

async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readTelemetryPayload(raw: string | undefined): Promise<unknown> {
  if (!raw) return {};
  let text = raw;
  if (raw === "-") text = await readStdinText();
  else if (fs.existsSync(raw) && fs.statSync(raw).isFile()) text = fs.readFileSync(raw, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

program
  .name("ogb")
  .description("OpenCode Gemini Bridge")
  .version(OGB_VERSION)
  .option("--project <path>", "Project root", process.cwd());

program.command("init")
  .description("Create a conservative opencode.jsonc for the bridge")
  .option("--dry-run", "Show what would be created without writing")
  .option("--force", "Overwrite ogb-managed opencode.jsonc")
  .action((opts) => {
    const { project } = commonProjectOptions();
    if (isHomeProject(project)) {
      console.log("Diretorio home detectado; init de projeto pulado. Use os arquivos globais do OpenCode/Gemini.");
      return;
    }
    const config = readOgbConfig(project);
    const result = ensureProjectConfig({ projectRoot: project, dryRun: opts.dryRun, force: opts.force, plugins: externalOpenCodePlugins(config) });
    console.log(`${result.status}: ${result.message ?? result.path}`);
  });

program.command("inventory")
  .description("Inventory Gemini and OpenCode resources")
  .option("-o, --output <path>", "Output JSON path")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const inv = writeInventory({ projectRoot: project, output: opts.output });
    console.log(`GEMINI.md files: ${inv.geminiFiles.length}`);
    console.log(`imports: ${inv.imports.length}`);
    console.log(`skills: ${inv.skills.length}`);
    console.log(`MCPs: ${inv.mcps.length}`);
    console.log(`agents: ${inv.agents.length}`);
    console.log(`commands: ${inv.commands.length}`);
    console.log(`hooks: ${inv.hooks.length}`);
    console.log(`extensions: ${inv.extensions.length}`);
  });

program.command("flatten")
  .description("Expand GEMINI.md imports for OpenCode")
  .option("-i, --input <path>", "Input GEMINI.md")
  .option("-o, --output <path>", "Output expanded md")
  .option("--max-depth <n>", "Maximum import depth", (value) => Number.parseInt(value, 10))
  .option("--dry-run", "Print expanded markdown without writing")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    const result = flattenGeminiMd({
      input: opts.input ?? defaultGeminiInput(paths.projectRoot, paths.homeDir),
      output: opts.output ?? paths.expandedGeminiPath,
      maxDepth: opts.maxDepth,
      write: !opts.dryRun,
      homeDir: paths.homeDir,
    });
    if (opts.dryRun) console.log(result.content);
    else console.log(`Generated ${result.output}`);
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) console.log(`Warning: ${warning}`);
    }
  });

program.command("sync")
  .description("Generate OpenCode projection")
  .option("--dry-run", "Show generated config and run Rulesync preview without final writes")
  .option("--force", "Overwrite files previously changed outside ogb/Rulesync management")
  .option("--bidirectional", "First sync user-owned rule files between Gemini, OpenCode, and Codex")
  .option("--rulesync <mode>", "Rulesync mode: auto, off, require", "auto")
  .option("--no-rulesync", "Disable Rulesync")
  .option("--features <list>", `Rulesync feature list (${rulesyncDefaultFeatures().join(",")})`)
  .action(async (opts) => {
    await withWorkflowTelemetry("sync", () => {
      const { project } = commonProjectOptions();
      let bidirectional: ReturnType<typeof runBidirectionalSync> | undefined;
      if (opts.bidirectional) {
        bidirectional = runBidirectionalSync({
          projectRoot: project,
          dryRun: opts.dryRun,
          force: opts.force,
        });
        if (bidirectional.warnings.length > 0) process.exitCode = 1;
      }
      const sync = syncToOpenCode({
        projectRoot: project,
        dryRun: opts.dryRun,
        force: opts.force,
        rulesyncMode: normalizeRulesyncMode(opts.rulesync),
        rulesyncFeatures: splitFeatures(opts.features),
      });
      return { bidirectional, sync };
    });
  });

program.command("startup-sync")
  .description("Run the lightweight startup projection used by the OpenCode plugin")
  .option("--force", "Overwrite files previously changed outside ogb management")
  .option("--dry-run", "Preview startup projection without writing")
  .option("--json", "Print JSON report")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const report = runStartupSync({
      projectRoot: project,
      force: opts.force,
      dryRun: opts.dryRun,
    });
    printStartupSyncReport(report, opts.json);
    if (report.outcome === "fail") process.exitCode = 2;
  });

program.command("bidirectional-sync")
  .description("Sync user-owned rule files between Gemini, OpenCode, and Codex with backups")
  .option("--dry-run", "Preview changes without writing")
  .option("--force", "Update differing targets after creating backups")
  .option("--json", "Print JSON report")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const report = runBidirectionalSync({
      projectRoot: project,
      dryRun: opts.dryRun,
      force: opts.force,
      json: opts.json,
    });
    if (report.warnings.length > 0) process.exitCode = 1;
  });

program.command("import")
  .description("First-time Gemini to OpenCode import: inventory, flatten, Rulesync-backed sync, doctor")
  .option("--dry-run", "Preview the import without final writes")
  .option("--force", "Allow overwriting files tracked by ogb or Rulesync")
  .option("--rulesync <mode>", "Rulesync mode: auto, off, require", "auto")
  .option("--no-rulesync", "Disable Rulesync")
  .option("--features <list>", `Rulesync feature list (${rulesyncDefaultFeatures().join(",")})`)
  .action(runImportWorkflow);

program.command("doctor")
  .description("Validate bridge state")
  .option("--json", "Print JSON report")
  .option("--strict", "Exit non-zero when warnings exist")
  .action(async (opts) => {
    await withWorkflowTelemetry("doctor", () => {
      const { project } = commonProjectOptions();
      return runDoctor({ projectRoot: project, json: opts.json, strict: opts.strict });
    });
  });

addCheckOptions(program.command("check")
  .description("Run the full bridge check: setup, sync, doctor, validation, security, dashboard"))
  .action(async (opts) => {
    await runCheckCli(opts, "check");
  });

addCheckOptions(program.command("pass")
  .description("Deprecated alias for check"))
  .action(async (opts) => {
    await runCheckCli(opts, "pass", LEGACY_PASS_WARNING);
  });

program.command("dashboard")
  .alias("bridge")
  .description("Show a simple OpenCode Gemini Bridge dashboard")
  .option("--json", "Print JSON report")
  .option("--no-refresh", "Do not refresh doctor before building the dashboard")
  .option("--write-only", "Write dashboard JSON/Markdown without printing")
  .option("--strict", "Exit non-zero when dashboard is not clean")
  .action(async (opts) => {
    await withWorkflowTelemetry("dashboard", async () => {
      const { project } = commonProjectOptions();
      if (opts.refresh !== false) {
        await refreshLimits({ projectRoot: project });
      }
      return runDashboard({
        projectRoot: project,
        json: opts.json,
        refresh: opts.refresh,
        writeOnly: opts.writeOnly,
        strict: opts.strict,
      });
    });
  });

program.command("limits")
  .alias("quota")
  .description("Refresh and show provider usage limits used by the OGB TUI")
  .option("--json", "Print JSON report")
  .option("--cached", "Use a fresh cache entry when available")
  .option("--no-write", "Do not write .opencode/generated/ogb-limits.json")
  .option("--no-gemini-fallback", "Do not use Gemini Code Assist quota as fallback when OpenUsage has no Gemini provider")
  .option("--strict", "Exit non-zero when no limits are available")
  .action(async (opts) => {
    const { project } = commonProjectOptions();
    const report = await refreshLimits({
      projectRoot: project,
      force: !opts.cached,
      write: opts.write,
      includeGeminiFallback: opts.geminiFallback,
    });
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatLimits(report).trimEnd());
    if (opts.strict && report.providers.length === 0) process.exitCode = report.status === "error" ? 2 : 1;
  });

const telemetry = program.command("telemetry")
  .description("Manage local-first OGB workflow telemetry");

telemetry.command("setup-email")
  .description("Configure Cloudflare Worker + Resend email telemetry using Wrangler")
  .option("--to-email <email>", "Email that receives telemetry reports")
  .option("--from-email <email>", "Verified Resend sender")
  .option("--resend-api-key <key>", "Resend API key; omit to type it securely")
  .option("--ingest-token <token>", "Shared ingest token; omit to generate one")
  .option("--worker-name <name>", "Cloudflare Worker name", "ogb-telemetry-email-worker")
  .option("--payload-level <level>", "diagnostic_redacted or full_logs", "diagnostic_redacted")
  .option("--activate-local", "Enable telemetry for this local install after deploy")
  .option("--no-distribution-defaults", "Do not write telemetry.defaults.json for private builds")
  .option("--skip-test-email", "Do not send a test email after deploy")
  .option("--dry-run", "Prepare local Worker files and show intended endpoint without calling Wrangler")
  .option("--json", "Print JSON result")
  .action(async (opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    try {
      const result = await setupTelemetryEmailReceiver({
        homeDir: paths.homeDir,
        toEmail: opts.toEmail,
        fromEmail: opts.fromEmail,
        resendApiKey: opts.resendApiKey,
        ingestToken: opts.ingestToken,
        workerName: opts.workerName,
        payloadLevel: telemetryPayloadLevel(opts.payloadLevel),
        activateLocal: opts.activateLocal,
        noDistributionDefaults: opts.distributionDefaults === false,
        skipTestEmail: opts.skipTestEmail,
        dryRun: opts.dryRun,
      });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else console.log(formatTelemetryEmailSetupResult(result).trimEnd());
    } catch (error) {
      const nextAction = error instanceof TelemetrySetupError ? error.nextAction : "Run `npm exec --yes wrangler login` and try again.";
      if (opts.json) console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), nextAction }, null, 2));
      else {
        console.error(`Telemetry setup failed: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`Next action: ${nextAction}`);
      }
      process.exitCode = 2;
    }
  });

telemetry.command("status")
  .description("Show telemetry status without exposing the auth token")
  .option("--json", "Print JSON status")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    printTelemetryStatus(telemetryStatus({ homeDir: paths.homeDir }), opts.json);
  });

telemetry.command("enable")
  .description("Enable remote telemetry using an explicit endpoint and bearer token")
  .requiredOption("--endpoint <url>", "Telemetry endpoint URL")
  .requiredOption("--token <token>", "Bearer token")
  .option("--payload-level <level>", "diagnostic_redacted or full_logs", "diagnostic_redacted")
  .option("--json", "Print JSON status")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    const status = enableTelemetry({
      homeDir: paths.homeDir,
      endpointUrl: opts.endpoint,
      authToken: opts.token,
      payloadLevel: telemetryPayloadLevel(opts.payloadLevel),
    });
    printTelemetryStatus(status, opts.json);
  });

telemetry.command("disable")
  .description("Disable telemetry and keep distribution defaults from re-enabling this install")
  .option("--json", "Print JSON status")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    printTelemetryStatus(disableTelemetry({ homeDir: paths.homeDir }), opts.json);
  });

telemetry.command("preview")
  .description("Preview the redacted envelope that would be sent")
  .option("--since <duration>", "Include records since duration or date", "7d")
  .option("--limit <n>", "Maximum run records", (value) => Number.parseInt(value, 10))
  .action((opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    const envelope = previewTelemetryEnvelope({ homeDir: paths.homeDir, since: opts.since, limit: opts.limit });
    console.log(JSON.stringify(envelope, null, 2));
  });

telemetry.command("send")
  .description("Send queued and unsent telemetry records, keeping failures in the outbox")
  .option("--since <duration>", "Include records since duration or date", "7d")
  .option("--limit <n>", "Maximum run records", (value) => Number.parseInt(value, 10))
  .option("--include-pass", "Also send clean pass records for manual debugging")
  .option("--json", "Print JSON result")
  .action(async (opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    const result = await sendTelemetry({ homeDir: paths.homeDir, since: opts.since, limit: opts.limit, includePass: opts.includePass });
    printTelemetrySendResult(result, opts.json);
    if (!result.ok && result.reason !== "telemetry_not_enabled") process.exitCode = 1;
  });

telemetry.command("record")
  .description("Internal best-effort workflow telemetry recorder")
  .requiredOption("--workflow <name>", "Workflow name")
  .option("--phase <phase>", "Workflow phase", "manual")
  .option("--status <status>", "Workflow status")
  .option("--outcome <outcome>", "Workflow outcome")
  .option("--exit-code <n>", "Workflow exit code", (value) => Number.parseInt(value, 10), 0)
  .option("--duration-ms <n>", "Workflow duration in milliseconds", (value) => Number.parseInt(value, 10), 0)
  .option("--command <command>", "Command summary")
  .option("--source <source>", "cli, plugin, agent, or test", "plugin")
  .option("--payload <json-or-path-or-stdin>", "Payload JSON, path, or '-' for stdin")
  .option("--no-send", "Only write the local run record")
  .option("--json", "Print JSON record")
  .action(async (opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    const payload = await readTelemetryPayload(opts.payload);
    const input = {
      workflow: opts.workflow,
      phase: opts.phase,
      status: opts.status,
      outcome: opts.outcome,
      exitCode: Number(opts.exitCode ?? 0),
      durationMs: Number(opts.durationMs ?? 0),
      command: opts.command,
      source: opts.source,
      projectRoot: paths.projectRoot,
      homeDir: paths.homeDir,
      payload,
      rawPayload: payload,
    };
    const record = opts.send === false
      ? recordWorkflowRun(input, { homeDir: paths.homeDir })
      : await safeRecordWorkflowRun(input, { homeDir: paths.homeDir });
    if (opts.json) console.log(JSON.stringify(record, null, 2));
    else if (record) console.log(`Recorded telemetry run ${record.runId}`);
  });

program.command("validate")
  .description("Run end-to-end bridge validation without calling a model by default")
  .option("--json", "Print JSON report")
  .option("--strict", "Exit non-zero on warnings or failures")
  .option("--windows", "Also run static Windows installer checks")
  .option("--opencode-run", "Run a real OpenCode model call; may use tokens/cost")
  .action(async (opts) => {
    await withWorkflowTelemetry("validate", () => {
      const { project } = commonProjectOptions();
      return runValidation({
        projectRoot: project,
        json: opts.json,
        strict: opts.strict,
        windows: opts.windows,
        opencodeRun: opts.opencodeRun,
      });
    });
  });

program.command("security-check")
  .description("Scan bridge-generated setup for obvious security risks")
  .option("--json", "Print JSON report")
  .option("--strict", "Exit non-zero on warnings or failures")
  .action(async (opts) => {
    await withWorkflowTelemetry("security-check", () => {
      const { project } = commonProjectOptions();
      return runSecurityCheck({ projectRoot: project, json: opts.json, strict: opts.strict });
    });
  });

program.command("trust-extension")
  .description("Record trust for reviewed Gemini extension hooks/scripts without executing them")
  .argument("<extension>", "Gemini extension name")
  .option("--hook <source...>", "Trust one or more hook sources, for example hooks/hooks.json")
  .option("--script <source...>", "Trust one or more script sources")
  .option("--all-hooks", "Trust all mapped hooks in the extension")
  .option("--all-scripts", "Trust all mapped scripts in the extension")
  .option("--revoke", "Revoke trust instead of adding it")
  .option("--dry-run", "Preview trust changes without writing")
  .option("--json", "Print JSON report")
  .action((extension, opts) => {
    const { project } = commonProjectOptions();
    runTrustExtension({
      projectRoot: project,
      extension,
      hook: opts.hook,
      script: opts.script,
      allHooks: opts.allHooks,
      allScripts: opts.allScripts,
      revoke: opts.revoke,
      dryRun: opts.dryRun,
      json: opts.json,
    });
  });

program.command("trust-report")
  .description("Review mapped Gemini extension hooks/scripts and their trust status")
  .argument("[extension]", "Optional Gemini extension name")
  .option("--json", "Print JSON report")
  .action((extension, opts) => {
    const { project } = commonProjectOptions();
    runTrustReview({
      projectRoot: project,
      extension,
      json: opts.json,
    });
  });

program.command("adopt-agent-sync")
  .description("Inspect a safe agent-rules-sync adoption plan without installing a daemon")
  .option("--json", "Print JSON report")
  .action((opts) => {
    const { project } = commonProjectOptions();
    runAgentSyncAdoption({ projectRoot: project, json: opts.json });
  });

program.command("launch")
  .description("Import/sync, doctor, then launch OpenCode")
  .option("--skip-sync", "Skip import/sync before launching")
  .option("--doctor <mode>", "Doctor mode: normal or strict", "normal")
  .option("--rulesync <mode>", "Rulesync mode: auto, off, require", "auto")
  .option("--no-rulesync", "Disable Rulesync")
  .option("--agent <name>", "Start OpenCode with a specific agent")
  .option("--yolo", "Start OpenCode with the YOLO agent")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(project);
    if (!opts.skipSync) {
      runImportWorkflow({ rulesync: opts.rulesync });
    }
    if (!paths.homeMode) {
      runDoctor({ projectRoot: paths.projectRoot, strict: opts.doctor === "strict" });
    }
    const args = buildOpenCodeLaunchArgs({ agent: opts.agent, yolo: opts.yolo });
    const child = spawnCommand("opencode", args, { cwd: paths.projectRoot, stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
  });

program.command("install")
  .description("Install or reinstall the OGB OpenCode profile and run the full check")
  .option("--dry-run", "Preview install actions without writing")
  .option("--force", "Overwrite OGB-managed files previously changed outside ogb management")
  .option("--rulesync <mode>", "Rulesync mode used by the final check", "auto")
  .option("--no-rulesync", "Disable Rulesync during the final check")
  .option("--no-ux", "Do not reapply the global OpenCode UX profile")
  .option("--reset-global", "Replace the global OpenCode config from OGB defaults instead of merging existing fields")
  .option("--no-install-opencode", "Do not install OpenCode when it is missing")
  .option("--no-plugins", "Do not run global OpenCode plugin installers")
  .option("--no-project-profile", "Do not write the project OGB fallback/profile config")
  .option("--no-cleanup-home", "Do not clean old OGB project artifacts from the home directory")
  .option("--no-check", "Skip the final ogb check")
  .option("--accept-hooks", "Record current Gemini hooks as reviewed during the final check")
  .option("--windows", "Include Windows installer/static checks during the final check")
  .option("--json", "Print JSON report")
  .option("--plain", "Use the classic text report instead of the rich terminal UI")
  .action(async (opts) => {
    const useUi = shouldUseRitualUi({ json: opts.json, plain: opts.plain });
    await withWorkflowTelemetry("install", async () => {
      const { project } = commonProjectOptions();
      const report = runInstall({
        projectRoot: project,
        dryRun: opts.dryRun,
        force: opts.force,
        ux: opts.ux,
        resetGlobal: opts.resetGlobal,
        installOpenCode: opts.installOpencode,
        installPlugins: opts.plugins,
        writeProjectProfile: opts.projectProfile,
        cleanupHome: opts.cleanupHome,
        check: opts.check,
        acceptHooks: opts.acceptHooks,
        windows: opts.windows,
        rulesyncMode: normalizeRulesyncMode(opts.rulesync),
      });
      if (useUi) await renderRitualReport("install", report);
      else printInstallReport(report, opts.json);
      process.exitCode = report.outcome === "fail" ? 2 : report.outcome === "warn" ? 1 : 0;
      return report;
    });
  });

program.command("setup-opencode")
  .description("Install the OpenCode startup sync plugin and validate the setup")
  .option("--dry-run", "Preview files and validation without writing")
  .option("--force", "Overwrite files previously changed outside ogb management")
  .option("--skip-doctor", "Do not run ogb doctor after setup")
  .option("--skip-command-check", "Do not verify the startup command")
  .option("--strict", "Exit non-zero when setup has warnings")
  .option("--command <path>", "Command used by the startup plugin instead of the current ogb CLI")
  .option("--base-args <list>", "Comma-separated args placed before sync, useful for node + cli.js")
  .option("--sync-args <list>", "Comma-separated startup sync args", "startup-sync")
  .option("--json", "Print JSON report")
  .action(async (opts) => {
    await withWorkflowTelemetry("setup-opencode", () => {
      const { project } = commonProjectOptions();
      const report = setupOpenCode({
        projectRoot: project,
        dryRun: opts.dryRun,
        force: opts.force,
        skipDoctor: opts.skipDoctor,
        skipCommandCheck: opts.skipCommandCheck,
        command: opts.command,
        baseArgs: splitFeatures(opts.baseArgs),
        syncArgs: splitFeatures(opts.syncArgs) ?? ["startup-sync"],
      });
      printSetupReport(report, opts.json);
      if (report.plugin.status === "conflict" || report.startupConfig.status === "conflict") process.exitCode = 2;
      else if (!report.commandCheck.ok || !report.pluginCheck.ok) process.exitCode = 1;
      else if (opts.strict && report.warnings.length > 0) process.exitCode = 1;
      return report;
    });
  });

program.command("setup-ux")
  .description("Install the global OpenCode UX profile used by OGB")
  .option("--dry-run", "Preview files and plugin installs without writing")
  .option("--force", "Replace an existing project .opencode/ogb.config.jsonc profile")
  .option("--reset-global", "Replace the global OpenCode config from OGB defaults instead of merging existing fields")
  .option("--no-install-opencode", "Do not install OpenCode when it is missing")
  .option("--no-plugins", "Do not run global OpenCode plugin installers")
  .option("--no-project-profile", "Do not write the project OGB fallback/profile config")
  .option("--strict", "Exit non-zero when setup has warnings")
  .option("--json", "Print JSON report")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const report = setupUx({
      projectRoot: project,
      dryRun: opts.dryRun,
      force: opts.force,
      resetGlobal: opts.resetGlobal,
      installOpenCode: opts.installOpencode,
      installPlugins: opts.plugins,
      writeProjectProfile: opts.projectProfile,
    });
    printSetupUxReport(report, opts.json);
    if (opts.strict && report.warnings.length > 0) process.exitCode = 1;
  });

program.command("cleanup-home")
  .description("Backup and remove old OGB project artifacts that were mistakenly created in the home directory")
  .option("--dry-run", "Preview cleanup without removing files")
  .option("--json", "Print JSON report")
  .action((opts) => {
    const report = cleanupHomeProjectArtifacts({ dryRun: opts.dryRun, json: opts.json });
    printHomeCleanupReport(report, opts.json);
    if (report.warnings.length > 0) process.exitCode = 1;
  });

program.command("reset")
  .description("Reset the global OGB/OpenCode profile; only works when project is the home directory")
  .option("--yes", "Confirm the reset without the interactive prompt")
  .option("--dry-run", "Preview cleanup, global config reset, and sync without writing")
  .option("--rulesync <mode>", "Rulesync mode passed to global sync", "auto")
  .option("--no-install-opencode", "Do not install OpenCode when it is missing")
  .option("--no-plugins", "Do not run global OpenCode plugin installers")
  .option("--json", "Print JSON report")
  .option("--plain", "Use the classic text report instead of the rich terminal UI")
  .action(async (opts) => {
    const useUi = shouldUseRitualUi({ json: opts.json, plain: opts.plain });
    await withWorkflowTelemetry("reset", async () => {
      const { project } = commonProjectOptions();
      try {
        const report = await runReset({
          projectRoot: project,
          yes: opts.yes,
          dryRun: opts.dryRun,
          rulesyncMode: normalizeRulesyncMode(opts.rulesync),
          installOpenCode: opts.installOpencode,
          installPlugins: opts.plugins,
        });
        if (useUi) await renderRitualReport("reset", report);
        else printResetReport(report, opts.json);
        if (report.outcome === "cancelled") process.exitCode = 1;
        else if (report.check?.outcome === "fail" || (report.doctor?.errors.length ?? 0) > 0) process.exitCode = 2;
        return report;
      } catch (error) {
        const expected = error instanceof ResetNotHomeError || error instanceof ResetConfirmationError;
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = expected ? 1 : 2;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });
  });

addUpdateOptions(program.command("update"))
  .action(async (opts) => {
    await runUpdateCli(opts);
  });

addUpdateOptions(program.command("self-update"))
  .description("Deprecated alias for update")
  .action(async (opts) => {
    await runUpdateCli(opts, LEGACY_SELF_UPDATE_WARNING);
  });

addUpdateOptions(program.command("upgrade-ogb"))
  .description("Deprecated alias for update")
  .action(async (opts) => {
    await runUpdateCli(opts, LEGACY_UPGRADE_WARNING);
  });

program.command("check-update")
  .description("Check GitHub Releases for a newer OGB version")
  .option("--repo <owner/repo>", "GitHub repo that publishes OGB releases", "augustocaruso/opencode-gemini-bridge")
  .option("--no-write", "Do not write .opencode/generated/ogb-update-status.json")
  .option("--json", "Print JSON report")
  .action(async (opts) => {
    const { project } = commonProjectOptions();
    const report = await checkOgbUpdate({
      repo: opts.repo,
      projectRoot: project,
      write: opts.write,
    });
    printUpdateCheckReport(report, opts.json);
    if (report.status === "unknown") process.exitCode = 1;
  });

program.command("auto-update")
  .description("Update OGB automatically when a newer GitHub release exists")
  .option("--repo <owner/repo>", "GitHub repo that publishes OGB releases", "augustocaruso/opencode-gemini-bridge")
  .option("--prefix <path>", "Install prefix passed to the installer")
  .option("--rulesync <mode>", "Rulesync mode passed to first-run setup", "auto")
  .option("--no-setup", "Update ogb/profile only; skip import/setup/doctor validation")
  .option("--no-ux", "Do not reapply the global OpenCode UX profile")
  .option("--install-opencode", "Allow auto-update to install OpenCode when it is missing", false)
  .option("--force", "Pass force to the bootstrap installer")
  .option("--dry-run", "Check and print the bootstrap command without running it")
  .option("--no-write", "Do not write .opencode/generated/ogb-update-status.json")
  .option("--json", "Print JSON report")
  .action(async (opts) => {
    await withWorkflowTelemetry("auto-update", async () => {
      const { project } = commonProjectOptions();
      const report = await runAutoUpdate({
        repo: opts.repo,
        projectRoot: project,
        prefix: opts.prefix,
        rulesync: opts.rulesync,
        setup: opts.setup,
        ux: opts.ux,
        installOpenCode: opts.installOpencode,
        force: opts.force,
        dryRun: opts.dryRun,
        write: opts.write,
      });
      printAutoUpdateReport(report, opts.json);
      if (report.status === "error") process.exitCode = 2;
      else if (report.status === "unknown") process.exitCode = 1;
      return report;
    });
  });

program.command("install-extension")
  .description("Install a Gemini CLI extension, then sync and doctor")
  .argument("<source>", "Git URL or local path")
  .option("--dry-run", "Preview Gemini install and bridge follow-up without writing")
  .option("--ref <ref>", "Git ref passed to gemini extensions install")
  .option("--auto-update", "Enable Gemini CLI auto-update for this extension")
  .option("--no-auto-update", "Do not request Gemini CLI auto-update")
  .option("--pre-release", "Enable Gemini CLI pre-release updates")
  .option("--trust", "Acknowledge extension install risk and allow local hooks/scripts")
  .option("--skip-sync", "Do not run ogb sync after install")
  .option("--skip-doctor", "Do not run ogb doctor after install")
  .option("--force", "Pass force to the post-install sync")
  .action((source, opts) => {
    const report = installGeminiExtension({
      source,
      ref: opts.ref,
      autoUpdate: opts.autoUpdate,
      preRelease: opts.preRelease,
      trust: opts.trust,
      dryRun: opts.dryRun,
    });
    printExtensionReport(report);

    if (report.status === "blocked") {
      console.error("Blocked: local extension has hooks/scripts. Re-run with --trust after reviewing it.");
      process.exitCode = 3;
      return;
    }
    if (report.status === "error") {
      process.exitCode = 2;
      return;
    }

    maybePostExtensionSync(opts);
  });

program.command("update-extensions")
  .description("Update Gemini CLI extensions, then sync and doctor")
  .argument("[name]", "Specific Gemini extension name; defaults to all")
  .option("--all", "Update all Gemini CLI extensions", true)
  .option("--dry-run", "Preview Gemini update and bridge follow-up without writing")
  .option("--skip-sync", "Do not run ogb sync after update")
  .option("--skip-doctor", "Do not run ogb doctor after update")
  .option("--force", "Pass force to the post-update sync")
  .action((name, opts) => {
    const report = updateGeminiExtensions({
      name,
      all: opts.all,
      dryRun: opts.dryRun,
    });
    printExtensionReport(report);

    if (report.status === "error") {
      process.exitCode = 2;
      return;
    }

    maybePostExtensionSync(opts);
  });

function isCliEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(modulePath);
  } catch {
    return path.resolve(process.argv[1]) === modulePath;
  }
}

if (isCliEntryPoint()) {
  program.parse();
}
