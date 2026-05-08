export interface HelpAction {
  label: string;
  description: string;
  args?: string[];
  runnable?: boolean;
  hint?: string;
}

export interface HelpCommand {
  name: string;
  aliases?: string[];
  category: "Core" | "Inspect" | "Sync" | "Setup" | "Extensions" | "Telemetry" | "Debug" | "Legacy";
  summary: string;
  description: string;
  usage: string;
  examples: string[];
  recommended?: boolean;
  runArgs?: string[];
  runnable?: boolean;
  runHint?: string;
  actions?: HelpAction[];
}

export const HELP_COMMANDS: HelpCommand[] = [
  {
    name: "install",
    category: "Core",
    recommended: true,
    summary: "Install or reinstall the OGB OpenCode profile.",
    description: "Applies the managed OpenCode profile, global plugins, fallback wiring, startup sync wiring, and then runs the full check unless disabled.",
    usage: "ogb install [--dry-run] [--force] [--reset-global] [--progress-json]",
    examples: ["ogb install", "ogb install --dry-run", "ogb install --reset-global", "ogb install --dry-run --progress-json"],
  },
  {
    name: "update",
    aliases: ["self-update", "upgrade-ogb"],
    category: "Core",
    recommended: true,
    summary: "Update OGB from the release pack and run the post-update ritual.",
    description: "Downloads the selected release, runs the platform bootstrap installer, and refreshes the bridge check afterward.",
    usage: "ogb update [--release <tag>] [--dry-run] [--plain] [--progress-json]",
    examples: ["ogb update", "ogb update --release v0.1.3", "ogb update --dry-run", "ogb update --dry-run --progress-json"],
  },
  {
    name: "check",
    aliases: ["pass"],
    category: "Core",
    recommended: true,
    summary: "Run the complete bridge health ritual.",
    description: "Runs setup, Gemini extension update, sync, doctor, validation, security-check, and dashboard in one user-facing flow.",
    usage: "ogb check [--force] [--no-extension-update] [--no-patches] [--plain] [--json] [--progress-json]",
    examples: ["ogb check", "ogb check --force", "ogb check --no-extension-update", "ogb check --no-patches", "ogb check --plain", "ogb check --progress-json"],
  },
  {
    name: "reset",
    category: "Core",
    recommended: true,
    summary: "Rebuild the global OGB/OpenCode profile from home.",
    description: "Only runs in the home directory. Cleans old accidental home-project artifacts, reapplies global config, syncs, and verifies.",
    usage: "ogb reset --yes [--dry-run] [--progress-json]",
    examples: ["cd ~ && ogb reset --yes", "cd ~ && ogb reset --dry-run --yes", "cd ~ && ogb reset --dry-run --yes --progress-json"],
    actions: [
      {
        label: "Preview reset from home",
        description: "Shows cleanup, global profile writes, sync and checks without changing files.",
        args: ["reset", "--dry-run", "--yes"],
      },
      {
        label: "Run reset from home",
        description: "Rebuilds the global profile. The reset command itself refuses unsafe non-home contexts.",
        args: ["reset", "--yes"],
      },
      {
        label: "Automation progress stream",
        description: "Preview reset with versioned NDJSON progress events.",
        args: ["reset", "--dry-run", "--yes", "--progress-json"],
      },
    ],
  },
  {
    name: "dashboard",
    aliases: ["bridge"],
    category: "Inspect",
    recommended: true,
    summary: "Show the current bridge status summary.",
    description: "Combines doctor, validation, security, startup sync, update, telemetry, limits, model routing, and extension state.",
    usage: "ogb dashboard [--json] [--no-refresh] [--write-only] [--strict]",
    examples: ["ogb dashboard", "ogb bridge", "ogb dashboard --json", "ogb dashboard --no-refresh", "ogb dashboard --write-only", "ogb dashboard --strict"],
    actions: [
      {
        label: "Show dashboard",
        description: "Prints the human bridge summary after refreshing the supporting status files.",
        args: ["dashboard"],
      },
      {
        label: "Show dashboard via alias",
        description: "Runs the same dashboard through the shorter bridge alias.",
        args: ["bridge"],
      },
      {
        label: "Print dashboard JSON",
        description: "Prints the dashboard report as machine-readable JSON.",
        args: ["dashboard", "--json"],
      },
      {
        label: "Read current dashboard only",
        description: "Builds the dashboard without refreshing doctor or limits first.",
        args: ["dashboard", "--no-refresh"],
      },
      {
        label: "Write reports silently",
        description: "Refreshes the dashboard files without printing the human report.",
        args: ["dashboard", "--write-only"],
      },
      {
        label: "Strict dashboard check",
        description: "Exits non-zero when the dashboard is not clean.",
        args: ["dashboard", "--strict"],
      },
    ],
  },
  {
    name: "help",
    category: "Inspect",
    summary: "Browse OGB commands and actions.",
    description: "Opens the interactive command guide, prints classic help, or explains one command in detail.",
    usage: "ogb help [command] [--plain] [--json]",
    examples: ["ogb help", "ogb help check", "ogb help dashboard --plain", "ogb help --json"],
    actions: [
      {
        label: "Open interactive guide",
        description: "Browses commands, then actions/subcommands, in the terminal UI.",
        args: ["help"],
      },
      {
        label: "Print classic command list",
        description: "Prints the non-interactive help catalog.",
        args: ["help", "--plain"],
      },
      {
        label: "Explain check",
        description: "Shows detailed help and runnable actions for ogb check.",
        args: ["help", "check"],
      },
      {
        label: "Explain dashboard in plain mode",
        description: "Shows dashboard help without opening the interactive UI.",
        args: ["help", "dashboard", "--plain"],
      },
      {
        label: "Print help metadata JSON",
        description: "Prints the full command catalog as JSON for tooling.",
        args: ["help", "--json"],
      },
    ],
  },
  {
    name: "patches",
    category: "Inspect",
    summary: "Inspect OGB repair patch lifecycle and applied state.",
    description: "Shows registered versioned patches, why each exists, when cleanup/migration patches should retire, and what has already been applied on this machine.",
    usage: "ogb patches [status|list] [--json]",
    examples: ["ogb patches", "ogb patches status", "ogb patches list --json"],
    actions: [
      {
        label: "Show patch lifecycle status",
        description: "Prints patch health, retirement warnings, and applied state.",
        args: ["patches"],
      },
      {
        label: "Show patch status explicitly",
        description: "Same report as the default patches command.",
        args: ["patches", "status"],
      },
      {
        label: "Print patch metadata JSON",
        description: "Prints registry, lifecycle, warnings, and applied state as machine-readable JSON.",
        args: ["patches", "list", "--json"],
      },
    ],
  },
  {
    name: "doctor",
    category: "Inspect",
    summary: "Inspect inventory and compatibility state.",
    description: "Checks generated files, resources, plugin state, extensions, MCPs, commands, skills, agents, and startup sync status.",
    usage: "ogb doctor [--json] [--strict]",
    examples: ["ogb doctor", "ogb doctor --strict"],
  },
  {
    name: "validate",
    category: "Inspect",
    summary: "Run end-to-end config validation without calling a model by default.",
    description: "Validates generated context, OpenCode config, instructions, MCPs, plugin references, commands, and optional Windows static checks.",
    usage: "ogb validate [--windows] [--plain] [--json]",
    examples: ["ogb validate", "ogb validate --windows", "ogb validate --json"],
  },
  {
    name: "security-check",
    category: "Inspect",
    summary: "Scan generated bridge files for safety issues.",
    description: "Checks obvious secrets, YOLO guardrails, MCP env materialization, extension projection safety, and trusted hook/script hashes.",
    usage: "ogb security-check [--json] [--strict]",
    examples: ["ogb security-check", "ogb security-check --strict"],
  },
  {
    name: "limits",
    aliases: ["quota"],
    category: "Inspect",
    summary: "Refresh provider usage limits for the OGB UI.",
    description: "Reads OpenUsage when available and falls back to native provider auth where supported.",
    usage: "ogb limits [--json] [--cached]",
    examples: ["ogb limits", "ogb quota --cached"],
  },
  {
    name: "sync",
    category: "Sync",
    summary: "Generate the OpenCode projection from Gemini resources.",
    description: "Projects context, MCPs, agents, commands, skills, model routing, sidebar files, and external integration files.",
    usage: "ogb sync [--force] [--dry-run] [--rulesync <mode>]",
    examples: ["ogb sync", "ogb sync --force", "ogb sync --dry-run"],
  },
  {
    name: "startup-sync",
    category: "Sync",
    summary: "Run the lightweight startup projection used by the OpenCode plugin.",
    description: "Designed for OpenCode startup. It treats global warnings as non-fatal and writes startup status for dashboard diagnostics.",
    usage: "ogb startup-sync [--force] [--json]",
    examples: ["ogb startup-sync", "ogb startup-sync --json"],
  },
  {
    name: "bidirectional-sync",
    category: "Sync",
    summary: "Sync user-owned rule files between Gemini, OpenCode, and Codex.",
    description: "Moves rule files conservatively with backups and conflict detection. This is not part of the recommended daily path yet.",
    usage: "ogb bidirectional-sync [--dry-run] [--force]",
    examples: ["ogb bidirectional-sync --dry-run", "ogb bidirectional-sync --force"],
  },
  {
    name: "setup-opencode",
    category: "Setup",
    summary: "Install the OpenCode startup sync plugin and config.",
    description: "Debug command for wiring the startup plugin, generated startup config, and project/global OpenCode references.",
    usage: "ogb setup-opencode [--force] [--dry-run]",
    examples: ["ogb setup-opencode", "ogb setup-opencode --force"],
  },
  {
    name: "setup-ux",
    category: "Setup",
    summary: "Install the global OpenCode UX profile.",
    description: "Debug command for global commands, agents, YOLO permissions, plugins, TUI sidebar, DCP, fallback, and project profile wiring.",
    usage: "ogb setup-ux [--reset-global] [--dry-run]",
    examples: ["ogb setup-ux --dry-run", "ogb setup-ux --reset-global"],
  },
  {
    name: "maintainer",
    category: "Setup",
    summary: "Protect this local maintainer machine from preset overwrites.",
    description: "Parent command for enabling, disabling, and inspecting the local maintainer protection flag.",
    usage: "ogb maintainer <enable|disable|status> [--json]",
    examples: ["ogb maintainer status", "ogb maintainer enable", "ogb maintainer disable"],
    runArgs: ["maintainer", "status"],
    actions: [
      {
        label: "Show maintainer status",
        description: "Prints whether this machine is protected from OGB preset overwrites.",
        args: ["maintainer", "status"],
      },
      {
        label: "Enable maintainer protection",
        description: "Protects local OpenCode profile files from being overwritten by OGB defaults.",
        args: ["maintainer", "enable"],
      },
      {
        label: "Disable maintainer protection",
        description: "Allows OGB preset writes on this machine again.",
        args: ["maintainer", "disable"],
      },
    ],
  },
  {
    name: "cleanup-home",
    category: "Setup",
    summary: "Remove accidental project artifacts from the home directory.",
    description: "Backs up and removes old home-project files and prunes empty leftovers. Used by reset/install flows.",
    usage: "ogb cleanup-home [--dry-run] [--json]",
    examples: ["ogb cleanup-home --dry-run", "ogb cleanup-home"],
  },
  {
    name: "init",
    category: "Setup",
    summary: "Create a conservative project config for OGB.",
    description: "Initializes a project-level OGB config when the target is not the home/global scope.",
    usage: "ogb init [--dry-run] [--force]",
    examples: ["ogb init", "ogb init --dry-run"],
  },
  {
    name: "install-extension",
    category: "Extensions",
    summary: "Install a Gemini CLI extension, then sync and doctor.",
    description: "Wraps Gemini extension installation and runs the bridge follow-up checks. Local risky extensions require explicit trust.",
    usage: "ogb install-extension <source> [--trust] [--dry-run]",
    examples: ["ogb install-extension https://github.com/org/ext", "ogb install-extension ./my-ext --trust"],
    runnable: false,
    runHint: "This command needs an extension source first. Pick one of the examples and replace the source.",
  },
  {
    name: "update-extensions",
    category: "Extensions",
    summary: "Update Gemini CLI extensions, then sync and doctor.",
    description: "Updates one or all Gemini CLI extensions and refreshes the OpenCode projection afterward. Use --auto-consent for unattended runs.",
    usage: "ogb update-extensions [name] [--dry-run] [--auto-consent]",
    examples: ["ogb update-extensions --dry-run", "ogb update-extensions --auto-consent", "ogb update-extensions gemini-md-export --auto-consent"],
  },
  {
    name: "trust-report",
    category: "Extensions",
    summary: "Review mapped Gemini extension hooks/scripts.",
    description: "Shows hook/script risk surface and trust hash status without executing extension hooks or scripts.",
    usage: "ogb trust-report [extension] [--json]",
    examples: ["ogb trust-report", "ogb trust-report browsermcp-extension"],
  },
  {
    name: "trust-extension",
    category: "Extensions",
    summary: "Record trust for reviewed extension hooks/scripts.",
    description: "Stores reviewed hashes for extension hook/script resources after manual review.",
    usage: "ogb trust-extension <extension> [--all-hooks] [--all-scripts]",
    examples: ["ogb trust-extension browsermcp-extension --all-hooks"],
    runnable: false,
    runHint: "This command needs an extension name first. Use `ogb trust-report` to see available extensions.",
  },
  {
    name: "check-update",
    category: "Debug",
    summary: "Check GitHub Releases for a newer OGB version.",
    description: "Writes update status for dashboard without installing anything.",
    usage: "ogb check-update [--json] [--no-write]",
    examples: ["ogb check-update", "ogb check-update --json"],
  },
  {
    name: "auto-update",
    category: "Debug",
    summary: "Automatically update when a newer release exists.",
    description: "Used by automation/plugin flows. User-facing installs should prefer ogb update.",
    usage: "ogb auto-update [--dry-run] [--no-write]",
    examples: ["ogb auto-update --dry-run"],
  },
  {
    name: "inventory",
    category: "Debug",
    summary: "Inventory Gemini and OpenCode resources.",
    description: "Writes or prints counts for GEMINI.md files, imports, skills, MCPs, agents, commands, hooks, and extensions.",
    usage: "ogb inventory [-o <path>]",
    examples: ["ogb inventory", "ogb inventory -o inventory.json"],
  },
  {
    name: "flatten",
    category: "Debug",
    summary: "Expand GEMINI.md imports for OpenCode.",
    description: "Generates the expanded Gemini context file and reports missing imports or cycles.",
    usage: "ogb flatten [-i <path>] [-o <path>] [--dry-run]",
    examples: ["ogb flatten", "ogb flatten --dry-run"],
  },
  {
    name: "launch",
    category: "Debug",
    summary: "Sync/doctor and launch OpenCode.",
    description: "Runs the import/sync preparation and starts OpenCode with optional agent or YOLO shortcut.",
    usage: "ogb launch [--agent <name>] [--yolo]",
    examples: ["ogb launch", "ogb launch --yolo"],
  },
  {
    name: "adopt-agent-sync",
    category: "Debug",
    summary: "Inspect agent-rules-sync adoption without installing a daemon.",
    description: "Previews a safe adoption plan for agent rules sync.",
    usage: "ogb adopt-agent-sync [--json]",
    examples: ["ogb adopt-agent-sync", "ogb adopt-agent-sync --json"],
  },
  {
    name: "import",
    category: "Legacy",
    summary: "Legacy first-time Gemini to OpenCode import flow.",
    description: "Older entrypoint for inventory, flatten, Rulesync-backed sync, and doctor. Prefer ogb install or ogb check.",
    usage: "ogb import [--dry-run] [--force]",
    examples: ["ogb import --dry-run"],
  },
  {
    name: "telemetry",
    category: "Telemetry",
    summary: "Manage local-first OGB workflow telemetry.",
    description: "Parent command for telemetry setup, status, preview, send, enable, and disable.",
    usage: "ogb telemetry <subcommand>",
    examples: ["ogb telemetry status", "ogb telemetry preview"],
    runArgs: ["telemetry", "status"],
    actions: [
      {
        label: "Show telemetry status",
        description: "Shows local telemetry configuration without exposing the auth token.",
        args: ["telemetry", "status"],
      },
      {
        label: "Preview telemetry envelope",
        description: "Prints the redacted payload that would be sent.",
        args: ["telemetry", "preview"],
      },
      {
        label: "Send queued telemetry",
        description: "Sends queued records when telemetry is enabled.",
        args: ["telemetry", "send"],
      },
      {
        label: "Disable telemetry",
        description: "Turns telemetry off and keeps distribution defaults from re-enabling this install.",
        args: ["telemetry", "disable"],
      },
      {
        label: "Prepare email telemetry setup",
        description: "Dry-runs the Cloudflare Worker + Resend setup flow.",
        args: ["telemetry", "setup-email", "--dry-run"],
      },
      {
        label: "Enable telemetry manually",
        description: "Needs endpoint and token values before it can run.",
        args: ["telemetry", "enable", "--endpoint", "<url>", "--token", "<token>"],
        runnable: false,
        hint: "Replace <url> and <token>, then run the command from your shell.",
      },
      {
        label: "Record workflow telemetry",
        description: "Internal diagnostic command; needs workflow metadata before it can run.",
        args: ["telemetry", "record", "--workflow", "<name>"],
        runnable: false,
        hint: "This is an internal/debug command. Prefer telemetry status, preview, send, enable, or disable.",
      },
    ],
  },
];

function shellishSplit(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) result.push(current);
  return result;
}

function argsFromHelpExample(example: string): string[] | undefined {
  const trimmed = example.trim();
  const homePrefix = /^cd\s+~\s+&&\s+ogb\s+(.+)$/u.exec(trimmed);
  if (homePrefix) return shellishSplit(homePrefix[1]);
  const ogbPrefix = /^ogb\s+(.+)$/u.exec(trimmed);
  if (ogbPrefix) return shellishSplit(ogbPrefix[1]);
  return undefined;
}

function hasPlaceholder(args: readonly string[] | undefined): boolean {
  return Boolean(args?.some((arg) => /^<[^>]+>$/.test(arg) || arg.includes("<") || arg.includes(">")));
}

function actionKey(action: HelpAction): string {
  return action.args?.join("\0") ?? action.label;
}

function inferredActionDescription(command: HelpCommand, args: string[] | undefined, example: string): string {
  if (!args) return "Shell example from the command docs; run it manually from your shell.";
  const commandName = args[0];
  const aliasTarget = command.aliases?.includes(commandName) ? command.name : undefined;
  if (aliasTarget) return `Runs ${command.name} through its ${commandName} alias.`;
  if (example.startsWith("cd ~")) return "Runs from the home directory, which OGB treats as global scope.";
  if (args.includes("--progress-json")) return "Emits versioned NDJSON progress events for automation.";
  if (args.includes("--json")) return "Prints machine-readable JSON instead of the human report.";
  if (args.includes("--plain")) return "Uses the classic plain-text output instead of the interactive UI.";
  if (args.includes("--dry-run")) return "Previews the action without applying file or install changes.";
  if (args.includes("--force")) return "Allows OGB-managed files to be overwritten after conflict checks.";
  if (args.includes("--strict")) return "Exits non-zero when warnings or an unclean state are present.";
  if (args.includes("--windows")) return "Includes Windows-specific validation and installer checks.";
  if (args.includes("--cached")) return "Uses a fresh cached provider-usage result when available.";
  if (args.includes("--no-refresh")) return "Reads existing generated reports without refreshing supporting checks first.";
  if (args.includes("--write-only")) return "Writes generated reports without printing the human summary.";
  if (args.includes("--no-sync") || args.includes("--skip-sync")) return "Skips the sync/projection part of the flow.";
  if (args.includes("--no-extension-update")) return "Skips the automatic Gemini extension update before sync.";
  if (args.includes("--no-patches")) return "Skips versioned OGB repair patches during the check.";
  if (args.includes("--accept-hooks")) return "Records current Gemini hooks as reviewed by hash during the check.";
  if (args.includes("--auto-consent") || args.includes("--yes")) return "Runs unattended by answering supported confirmation prompts automatically.";
  if (args.includes("--reset-global")) return "Rebuilds the global OpenCode profile from OGB defaults.";
  return command.summary;
}

export function helpActionsForCommand(command: HelpCommand): HelpAction[] {
  const explicit = command.actions ?? [];
  const inferred = command.examples.map((example): HelpAction => {
    const args = argsFromHelpExample(example);
    const runnable = command.runnable !== false && Boolean(args) && !hasPlaceholder(args);
    return {
      label: args ? formatHelpRunLine(args) : example,
      description: inferredActionDescription(command, args, example),
      args,
      runnable,
      hint: runnable ? undefined : command.runHint ?? "Replace placeholders or run this example manually from your shell.",
    };
  });
  const all = [...explicit, ...inferred];
  const seen = new Set<string>();
  return all.filter((action) => {
    const key = actionKey(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function runArgsForHelpCommand(command: HelpCommand): string[] | undefined {
  if (command.runnable === false) return undefined;
  if (command.runArgs) return command.runArgs;
  return helpActionsForCommand(command).find((action) => action.runnable !== false && action.args)?.args;
}

export function formatHelpRunLine(args: readonly string[]): string {
  return `ogb ${args.join(" ")}`;
}

export function findHelpCommand(name: string | undefined, commands: readonly HelpCommand[] = HELP_COMMANDS): HelpCommand | undefined {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return undefined;
  return commands.find((command) =>
    command.name.toLowerCase() === normalized
    || command.aliases?.some((alias) => alias.toLowerCase() === normalized)
  );
}

export function filterHelpCommands(query: string, commands: readonly HelpCommand[] = HELP_COMMANDS): HelpCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...commands];
  return commands.map((command, index) => {
    const haystack = [
      command.name,
      ...(command.aliases ?? []),
      command.category,
      command.summary,
      command.description,
      command.usage,
      ...command.examples,
    ].join(" ").toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return undefined;
    const aliases = command.aliases?.map((alias) => alias.toLowerCase()) ?? [];
    const score = Math.min(...terms.map((term) => {
      if (command.name.toLowerCase() === term) return 0;
      if (aliases.some((alias) => alias === term)) return 1;
      if (command.name.toLowerCase().startsWith(term)) return 2;
      if (aliases.some((alias) => alias.startsWith(term))) return 3;
      if (`${command.category} ${command.summary}`.toLowerCase().includes(term)) return 4;
      return 5;
    }));
    return { command, index, score };
  }).filter((item): item is { command: HelpCommand; index: number; score: number } => Boolean(item))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((item) => item.command);
}

export function formatHelpCommand(command: HelpCommand): string {
  const lines = [
    `ogb ${command.name}`,
    command.summary,
    "",
    command.description,
    "",
    `Usage: ${command.usage}`,
  ];
  if (command.aliases?.length) lines.push(`Aliases: ${command.aliases.join(", ")}`);
  if (command.examples.length > 0) {
    lines.push("", "Examples");
    for (const example of command.examples) lines.push(`  ${example}`);
  }
  const actions = helpActionsForCommand(command);
  if (actions.length > 0) {
    lines.push("", "Actions");
    for (const action of actions) {
      const commandLine = action.args ? formatHelpRunLine(action.args) : action.label;
      const state = action.runnable === false ? "manual" : "run";
      lines.push(`  ${state.padEnd(6)} ${commandLine}`);
      lines.push(`         ${action.description}`);
      if (action.runnable === false && action.hint) lines.push(`         ${action.hint}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatHelpCatalog(commands: readonly HelpCommand[] = HELP_COMMANDS): string {
  const categories = [...new Set(commands.map((command) => command.category))];
  const lines = [
    "OGB help",
    "",
    "Recommended",
    ...commands.filter((command) => command.recommended).map((command) => `  ${command.name.padEnd(14)} ${command.summary}`),
  ];
  for (const category of categories) {
    const items = commands.filter((command) => command.category === category && !command.recommended);
    if (items.length === 0) continue;
    lines.push("", category);
    for (const command of items) lines.push(`  ${command.name.padEnd(18)} ${command.summary}`);
  }
  lines.push("", "Use `ogb help <command>` for details. In an interactive terminal, run `ogb help` for the navigable guide.");
  return `${lines.join("\n")}\n`;
}
