#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Command } from "commander";
import { runAgentSyncAdoption } from "./agent-sync-adoption.js";
import { runBidirectionalSync } from "./bidirectional-sync.js";
import { runDashboard } from "./dashboard.js";
import { runDoctor } from "./doctor.js";
import { externalOpenCodePlugins } from "./external-integrations.js";
import { formatCommand, installGeminiExtension, updateGeminiExtensions } from "./extensions.js";
import { flattenGeminiMd } from "./flatten.js";
import { buildInventory, writeInventory } from "./inventory.js";
import { formatLimits, refreshLimits } from "./limits.js";
import { buildOpenCodeOpenArgs } from "./launch.js";
import { readOgbConfig } from "./ogb-config.js";
import { defaultGeminiInput, resolveProjectPaths } from "./paths.js";
import { ensureProjectConfig } from "./project-config.js";
import { rulesyncDefaultFeatures, type RulesyncMode } from "./rulesync.js";
import { printSetupReport, setupOpenCode } from "./setup-opencode.js";
import { printSetupUxReport, setupUx } from "./setup-ux.js";
import { runSecurityCheck } from "./security.js";
import { printSelfUpdateReport, runSelfUpdate } from "./self-update.js";
import { syncToOpenCode } from "./sync.js";
import { runTrustExtension, runTrustReview } from "./trust.js";
import { OGB_VERSION } from "./types.js";
import { runValidation } from "./validation.js";

const program = new Command();

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

  if (opts.dryRun) {
    const inv = buildInventory({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
    console.log(`Would inventory ${inv.geminiFiles.length} GEMINI.md file(s), ${inv.imports.length} import(s), ${inv.mcps.length} MCP(s)`);
  } else {
    writeInventory({ projectRoot: paths.projectRoot, homeDir: paths.homeDir });
  }
  flattenGeminiMd({
    input: defaultGeminiInput(paths.projectRoot, paths.homeDir),
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

function spawnOpenCode(projectRoot: string, args: string[]) {
  const child = spawn("opencode", args, { cwd: projectRoot, stdio: "inherit", shell: process.platform === "win32" });
  child.on("error", (error) => {
    console.error(`Failed to start opencode: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
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
  .action((opts) => {
    const { project } = commonProjectOptions();
    if (opts.bidirectional) {
      const bidirectional = runBidirectionalSync({
        projectRoot: project,
        dryRun: opts.dryRun,
        force: opts.force,
      });
      if (bidirectional.warnings.length > 0) process.exitCode = 1;
    }
    syncToOpenCode({
      projectRoot: project,
      dryRun: opts.dryRun,
      force: opts.force,
      rulesyncMode: normalizeRulesyncMode(opts.rulesync),
      rulesyncFeatures: splitFeatures(opts.features),
    });
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
  .action((opts) => {
    const { project } = commonProjectOptions();
    runDoctor({ projectRoot: project, json: opts.json, strict: opts.strict });
  });

program.command("dashboard")
  .alias("bridge")
  .description("Show a simple OpenCode Gemini Bridge dashboard")
  .option("--json", "Print JSON report")
  .option("--no-refresh", "Do not refresh doctor before building the dashboard")
  .option("--write-only", "Write dashboard JSON/Markdown without printing")
  .option("--strict", "Exit non-zero when dashboard is not clean")
  .action(async (opts) => {
    const { project } = commonProjectOptions();
    if (opts.refresh !== false) {
      await refreshLimits({ projectRoot: project });
    }
    runDashboard({
      projectRoot: project,
      json: opts.json,
      refresh: opts.refresh,
      writeOnly: opts.writeOnly,
      strict: opts.strict,
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

program.command("validate")
  .description("Run end-to-end bridge validation without calling a model by default")
  .option("--json", "Print JSON report")
  .option("--strict", "Exit non-zero on warnings or failures")
  .option("--windows", "Also run static Windows installer checks")
  .option("--opencode-run", "Run a real OpenCode model call; may use tokens/cost")
  .action((opts) => {
    const { project } = commonProjectOptions();
    runValidation({
      projectRoot: project,
      json: opts.json,
      strict: opts.strict,
      windows: opts.windows,
      opencodeRun: opts.opencodeRun,
    });
  });

program.command("security-check")
  .description("Scan bridge-generated setup for obvious security risks")
  .option("--json", "Print JSON report")
  .option("--strict", "Exit non-zero on warnings or failures")
  .action((opts) => {
    const { project } = commonProjectOptions();
    runSecurityCheck({ projectRoot: project, json: opts.json, strict: opts.strict });
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

program.command("open")
  .description("Open OpenCode with YOLO unless this project defines another default_agent")
  .argument("[projectPath]", "Project root to open")
  .option("--agent <name>", "Start OpenCode with a specific agent")
  .option("--yolo", "Start OpenCode with the YOLO agent")
  .action((projectPath: string | undefined, opts) => {
    const { project } = commonProjectOptions();
    const paths = resolveProjectPaths(projectPath ?? project);
    const args = buildOpenCodeOpenArgs({ projectRoot: paths.projectRoot, agent: opts.agent, yolo: opts.yolo });
    spawnOpenCode(paths.projectRoot, args);
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
    runDoctor({ projectRoot: paths.projectRoot, strict: opts.doctor === "strict" });
    const args = buildOpenCodeOpenArgs({ projectRoot: paths.projectRoot, agent: opts.agent, yolo: opts.yolo });
    spawnOpenCode(paths.projectRoot, args);
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
  .option("--sync-args <list>", "Comma-separated startup sync args", "sync")
  .option("--json", "Print JSON report")
  .action((opts) => {
    const { project } = commonProjectOptions();
    const report = setupOpenCode({
      projectRoot: project,
      dryRun: opts.dryRun,
      force: opts.force,
      skipDoctor: opts.skipDoctor,
      skipCommandCheck: opts.skipCommandCheck,
      command: opts.command,
      baseArgs: splitFeatures(opts.baseArgs),
      syncArgs: splitFeatures(opts.syncArgs) ?? ["sync"],
    });
    printSetupReport(report, opts.json);
    if (report.plugin.status === "conflict" || report.startupConfig.status === "conflict") process.exitCode = 2;
    else if (!report.commandCheck.ok || !report.pluginCheck.ok) process.exitCode = 1;
    else if (opts.strict && report.warnings.length > 0) process.exitCode = 1;
  });

program.command("setup-ux")
  .description("Install the global OpenCode UX profile used by OGB")
  .option("--dry-run", "Preview files and plugin installs without writing")
  .option("--force", "Replace an existing project .opencode/ogb.config.jsonc profile")
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
      installOpenCode: opts.installOpencode,
      installPlugins: opts.plugins,
      writeProjectProfile: opts.projectProfile,
    });
    printSetupUxReport(report, opts.json);
    if (opts.strict && report.warnings.length > 0) process.exitCode = 1;
  });

program.command("self-update")
  .alias("upgrade-ogb")
  .description("Update OGB from the GitHub release pack and reapply the local UX profile")
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
  .action((opts) => {
    const { project } = commonProjectOptions();
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
    printSelfUpdateReport(report, opts.json);
    if (report.status === "error") process.exitCode = 2;
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

program.parse();
