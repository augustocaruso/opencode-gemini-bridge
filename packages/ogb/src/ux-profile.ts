import type { OgbConfig } from "./ogb-config.js";

export const UX_PROFILE_SCHEMA = "opencode-gemini-bridge.ux-profile.v1";

export interface UxProfileGlobalConfig {
  schemaUrl: string;
  share: string;
  autoupdate: string;
  smallModel: string;
  defaultAgent: string;
  watcherIgnore: string[];
  toolOutput: Record<string, unknown>;
  compaction: Record<string, unknown>;
  permission: Record<string, unknown>;
  agent: {
    build: Record<string, unknown>;
    agent: Record<string, unknown>;
    compaction: Record<string, unknown>;
  };
}

export interface UxProfileFiles {
  globalAgentsMd: string;
  startupPlugin: string;
  tuiSidebarPlugin: string;
  commands: Record<string, string>;
  agents: Record<string, string>;
  skills?: Record<string, Record<string, string>>;
}

export interface UxProfilePreset {
  schema: typeof UX_PROFILE_SCHEMA;
  name: string;
  description?: string;
  safePlugins: string[];
  disabledPlugins: string[];
  removedGlobalCommands: string[];
  tuiRuntimeDependencies: Record<string, string>;
  globalConfig: UxProfileGlobalConfig;
  dcpConfig: Record<string, unknown>;
  fallbackConfig?: Record<string, unknown>;
  tuiConfig?: Record<string, unknown>;
  projectConfig: OgbConfig;
  files: UxProfileFiles;
}
