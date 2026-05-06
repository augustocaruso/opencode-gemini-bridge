import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectPaths {
  projectRoot: string;
  homeDir: string;
  generatedDir: string;
  inventoryPath: string;
  doctorPath: string;
  validationPath: string;
  securityPath: string;
  agentSyncAdoptionPath: string;
  bidirectionalSyncPath: string;
  extensionMapPath: string;
  modelRoutingPath: string;
  dashboardPath: string;
  dashboardMarkdownPath: string;
  telemetryStatusPath: string;
  passPath: string;
  updateStatusPath: string;
  limitsPath: string;
  quotaPath: string;
  ogbConfigPath: string;
  ohMyOpenAgentConfigPath: string;
  trustPath: string;
  pluginStatusPath: string;
  syncStatePath: string;
  expandedGeminiPath: string;
  generatedOpenCodeConfigPath: string;
}

export function resolveProjectPaths(projectRoot = process.cwd(), homeDir = os.homedir()): ProjectPaths {
  const root = path.resolve(projectRoot);
  const generatedDir = path.join(root, ".opencode", "generated");

  return {
    projectRoot: root,
    homeDir,
    generatedDir,
    inventoryPath: path.join(generatedDir, "ogb-inventory.json"),
    doctorPath: path.join(generatedDir, "ogb-doctor.json"),
    validationPath: path.join(generatedDir, "ogb-validation.json"),
    securityPath: path.join(generatedDir, "ogb-security.json"),
    agentSyncAdoptionPath: path.join(generatedDir, "ogb-agent-sync-adoption.json"),
    bidirectionalSyncPath: path.join(generatedDir, "ogb-bidirectional-sync.json"),
    extensionMapPath: path.join(generatedDir, "ogb-extension-map.json"),
    modelRoutingPath: path.join(generatedDir, "ogb-model-routing.json"),
    dashboardPath: path.join(generatedDir, "ogb-dashboard.json"),
    dashboardMarkdownPath: path.join(generatedDir, "ogb-dashboard.md"),
    telemetryStatusPath: path.join(generatedDir, "ogb-telemetry-status.json"),
    passPath: path.join(generatedDir, "ogb-pass.json"),
    updateStatusPath: path.join(generatedDir, "ogb-update-status.json"),
    limitsPath: path.join(generatedDir, "ogb-limits.json"),
    quotaPath: path.join(generatedDir, "ogb-quota.json"),
    ogbConfigPath: path.join(root, ".opencode", "ogb.config.jsonc"),
    ohMyOpenAgentConfigPath: path.join(root, ".opencode", "oh-my-openagent.jsonc"),
    trustPath: path.join(root, ".opencode", "ogb-trust.jsonc"),
    pluginStatusPath: path.join(generatedDir, "ogb-plugin-status.json"),
    syncStatePath: path.join(generatedDir, "ogb-sync-state.json"),
    expandedGeminiPath: path.join(generatedDir, "GEMINI.expanded.md"),
    generatedOpenCodeConfigPath: path.join(generatedDir, "opencode.generated.json"),
  };
}

export function defaultGeminiInput(projectRoot = process.cwd(), homeDir = os.homedir()): string {
  const projectGemini = path.join(projectRoot, "GEMINI.md");
  if (fs.existsSync(projectGemini)) return projectGemini;

  const globalGemini = path.join(homeDir, ".gemini", "GEMINI.md");
  if (fs.existsSync(globalGemini)) return globalGemini;

  return projectGemini;
}

export function toPosixRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}
