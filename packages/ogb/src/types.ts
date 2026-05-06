export const OGB_VERSION = "0.0.54";

export type ResourceStatus = "ok" | "warning" | "error" | "needs_review";
export type ResourceScope = "project" | "global";
export type ResourceSource = "gemini" | "opencode";

export interface GeminiImport {
  source: string;
  target: string;
  raw: string;
  depth: number;
  status: ResourceStatus;
  message?: string;
}

export interface GeminiMcpServer {
  name: string;
  source: string;
  type: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  environment?: Record<string, string>;
  envKeys?: string[];
  status: ResourceStatus;
  message?: string;
}

export interface SkillInfo {
  name: string;
  path: string;
  source: ResourceSource;
  scope: ResourceScope;
  status: ResourceStatus;
  message?: string;
}

export interface AgentInfo {
  name: string;
  path: string;
  source: ResourceSource;
  scope: ResourceScope;
  status: ResourceStatus;
  message?: string;
}

export interface CommandInfo {
  name: string;
  path: string;
  source: ResourceSource;
  scope: ResourceScope;
  status: ResourceStatus;
  message?: string;
}

export interface HookInfo {
  name: string;
  source: string;
  scope: ResourceScope;
  status: ResourceStatus;
  message?: string;
}

export interface ExtensionInfo {
  name: string;
  path: string;
  scope: ResourceScope;
  status: ResourceStatus;
  message?: string;
}

export interface Inventory {
  version: string;
  projectRoot: string;
  geminiFiles: string[];
  imports: GeminiImport[];
  mcps: GeminiMcpServer[];
  skills: SkillInfo[];
  agents: AgentInfo[];
  commands: CommandInfo[];
  hooks: HookInfo[];
  extensions: ExtensionInfo[];
}

export interface StatusCounts {
  ok: number;
  warning: number;
  error: number;
  needs_review: number;
}
