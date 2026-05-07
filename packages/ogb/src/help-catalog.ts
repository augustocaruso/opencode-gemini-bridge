export interface HelpCommand {
  name: string;
  aliases?: string[];
  category: "Core" | "Inspect" | "Sync" | "Setup" | "Extensions" | "Telemetry" | "Debug" | "Legacy";
  summary: string;
  description: string;
  usage: string;
  examples: string[];
  recommended?: boolean;
}

export const HELP_COMMANDS: HelpCommand[] = [
  {
    name: "install",
    category: "Core",
    recommended: true,
    summary: "Install or reinstall the OGB OpenCode profile.",
    description: "Applies the managed OpenCode profile, global plugins, fallback wiring, startup sync wiring, and then runs the full check unless disabled.",
    usage: "ogb install [--dry-run] [--force] [--reset-global]",
    examples: ["ogb install", "ogb install --dry-run", "ogb install --reset-global"],
  },
  {
    name: "update",
    aliases: ["self-update", "upgrade-ogb"],
    category: "Core",
    recommended: true,
    summary: "Update OGB from the release pack and run the post-update ritual.",
    description: "Downloads the selected release, runs the platform bootstrap installer, and refreshes the bridge check afterward.",
    usage: "ogb update [--release <tag>] [--dry-run] [--plain]",
    examples: ["ogb update", "ogb update --release v0.0.61", "ogb update --dry-run"],
  },
  {
    name: "check",
    aliases: ["pass"],
    category: "Core",
    recommended: true,
    summary: "Run the complete bridge health ritual.",
    description: "Runs setup, sync, doctor, validation, security-check, and dashboard in one user-facing flow.",
    usage: "ogb check [--force] [--plain] [--json]",
    examples: ["ogb check", "ogb check --force", "ogb check --plain"],
  },
  {
    name: "reset",
    category: "Core",
    recommended: true,
    summary: "Rebuild the global OGB/OpenCode profile from home.",
    description: "Only runs in the home directory. Cleans old accidental home-project artifacts, reapplies global config, syncs, and verifies.",
    usage: "ogb reset --yes [--dry-run]",
    examples: ["cd ~ && ogb reset --yes", "cd ~ && ogb reset --dry-run --yes"],
  },
  {
    name: "dashboard",
    aliases: ["bridge"],
    category: "Inspect",
    recommended: true,
    summary: "Show the current bridge status summary.",
    description: "Combines doctor, validation, security, startup sync, update, telemetry, limits, model routing, and extension state.",
    usage: "ogb dashboard [--plain] [--json]",
    examples: ["ogb dashboard", "ogb bridge", "ogb dashboard --json"],
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
  },
  {
    name: "update-extensions",
    category: "Extensions",
    summary: "Update Gemini CLI extensions, then sync and doctor.",
    description: "Updates one or all Gemini CLI extensions and refreshes the OpenCode projection afterward.",
    usage: "ogb update-extensions [name] [--dry-run]",
    examples: ["ogb update-extensions", "ogb update-extensions gemini-md-export"],
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
  },
];

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
  return commands.filter((command) => {
    const haystack = [
      command.name,
      ...(command.aliases ?? []),
      command.category,
      command.summary,
      command.description,
      command.usage,
      ...command.examples,
    ].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
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
