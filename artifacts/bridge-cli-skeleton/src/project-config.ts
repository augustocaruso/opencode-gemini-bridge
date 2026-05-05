import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { sha256Text } from "./file-hash.js";
import { resolveProjectPaths } from "./paths.js";
import { emptySyncState, managedHashFor, readSyncState, upsertManagedFile, writeSyncState } from "./sync-state.js";
import { OGB_VERSION } from "./types.js";

export interface ProjectConfigResult {
  path: string;
  status: "created" | "updated" | "unchanged" | "preview" | "conflict";
  message?: string;
}

export interface ProjectConfigOptions {
  projectRoot?: string;
  dryRun?: boolean;
  force?: boolean;
  mcp?: Record<string, unknown>;
  plugins?: string[];
}

function normalizePluginSpecs(plugins: string[] | undefined): string[] {
  return [...new Set((plugins ?? []).map((item) => item.trim()).filter(Boolean))];
}

export function projectConfigText(options: { mcp?: Record<string, unknown>; plugins?: string[] } = {}): string {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    instructions: [".opencode/generated/GEMINI.expanded.md"],
    default_agent: "agent",
    agent: {
      build: {
        disable: true,
      },
      agent: {
        mode: "primary",
        description: "Agente principal para conversar, editar e executar ferramentas conforme permissoes.",
        permission: {
          question: "allow",
          plan_enter: "allow",
        },
      },
    },
    watcher: {
      ignore: [
        ".git/**",
        "node_modules/**",
        "dist/**",
        "build/**",
        ".venv/**",
        "__pycache__/**",
        ".opencode/generated/**",
      ],
    },
  };

  if (options.mcp && Object.keys(options.mcp).length > 0) config.mcp = options.mcp;
  const plugins = normalizePluginSpecs(options.plugins);
  if (plugins.length > 0) config.plugin = plugins;

  return `${JSON.stringify(config, null, 2)}\n`;
}

export function ensureProjectConfig(options: ProjectConfigOptions = {}): ProjectConfigResult {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const configPath = path.join(projectRoot, "opencode.jsonc");
  const relPath = "opencode.jsonc";
  const desiredText = projectConfigText({ mcp: options.mcp, plugins: options.plugins });
  const desiredHash = sha256Text(desiredText);

  if (options.dryRun) {
    return {
      path: configPath,
      status: fs.existsSync(configPath) ? "unchanged" : "preview",
      message: fs.existsSync(configPath) ? "opencode.jsonc already exists" : "Would create opencode.jsonc",
    };
  }

  const state = readSyncState(projectRoot) ?? emptySyncState(OGB_VERSION);
  const existed = fs.existsSync(configPath);
  let currentHash: string | undefined;
  if (existed) currentHash = sha256Text(fs.readFileSync(configPath, "utf8"));

  if (existed && !options.force) {
    const previousHash = managedHashFor(state, relPath, "ogb");
    if (previousHash !== currentHash) {
      return {
        path: configPath,
        status: "conflict",
        message: "opencode.jsonc exists and is not managed by ogb; leaving it unchanged",
      };
    }
  }

  if (currentHash === desiredHash) {
    upsertManagedFile(state, {
      path: relPath,
      sha256: desiredHash,
      source: "ogb",
    });
    writeSyncState(state, projectRoot);
    return {
      path: configPath,
      status: "unchanged",
      message: "opencode.jsonc already up to date",
    };
  }

  fs.writeFileSync(configPath, desiredText, "utf8");
  upsertManagedFile(state, {
    path: relPath,
    sha256: desiredHash,
    source: "ogb",
  });
  writeSyncState(state, projectRoot);

  return {
    path: configPath,
    status: existed ? "updated" : "created",
    message: existed ? "Updated opencode.jsonc" : "Created opencode.jsonc",
  };
}

export function configReferencesExpandedGemini(projectRoot = process.cwd()): boolean {
  const configPath = path.join(projectRoot, "opencode.jsonc");
  if (!fs.existsSync(configPath)) return false;
  const parsed = parseJsonc(fs.readFileSync(configPath, "utf8"));
  return Array.isArray(parsed?.instructions) && parsed.instructions.includes(".opencode/generated/GEMINI.expanded.md");
}

export function projectConfigPath(projectRoot = process.cwd()): string {
  return path.join(resolveProjectPaths(projectRoot).projectRoot, "opencode.jsonc");
}
