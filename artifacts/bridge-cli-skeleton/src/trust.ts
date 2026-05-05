import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { sha256File } from "./file-hash.js";
import { resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

export interface TrustOptions {
  projectRoot?: string;
  homeDir?: string;
  extension: string;
  hook?: string[];
  script?: string[];
  allHooks?: boolean;
  allScripts?: boolean;
  revoke?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface TrustedResource {
  sha256: string;
  trustedAt: string;
}

export interface OgbTrustFile {
  version: string;
  extensions: Record<string, {
    hooks?: Record<string, TrustedResource>;
    scripts?: Record<string, TrustedResource>;
  }>;
}

export interface TrustReport {
  version: string;
  projectRoot: string;
  extension: string;
  status: "applied" | "preview" | "error";
  trusted: string[];
  revoked: string[];
  warnings: string[];
  file: string;
}

export interface TrustReviewItem {
  extension: string;
  kind: "hook" | "script";
  source: string;
  absolutePath: string;
  exists: boolean;
  trusted: boolean;
  hashMatches?: boolean;
  commands: string[];
  reason?: string;
}

export interface TrustReviewReport {
  version: string;
  projectRoot: string;
  extension?: string;
  items: TrustReviewItem[];
  warnings: string[];
}

function readJsonc(filePath: string): any {
  try {
    return parseJsonc(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export function readTrustFile(projectRoot?: string, homeDir?: string): OgbTrustFile {
  const paths = resolveProjectPaths(projectRoot, homeDir);
  const parsed = readJsonc(paths.trustPath);
  if (!parsed || typeof parsed !== "object") return { version: OGB_VERSION, extensions: {} };
  return {
    version: typeof parsed.version === "string" ? parsed.version : OGB_VERSION,
    extensions: parsed.extensions && typeof parsed.extensions === "object" && !Array.isArray(parsed.extensions) ? parsed.extensions : {},
  };
}

function writeTrustFile(filePath: string, value: OgbTrustFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function findExtension(map: any, name: string): any | undefined {
  return (Array.isArray(map?.extensions) ? map.extensions : []).find((extension: any) => extension?.name === name);
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(String).map((item) => item.trim()).filter(Boolean))].sort();
}

function selectedSources(extension: any, kind: "hooks" | "scripts", explicit: string[], all?: boolean): string[] {
  const available = (Array.isArray(extension?.[kind]) ? extension[kind] : []).map((item: any) => String(item.source)).sort();
  if (all) return available;
  return explicit;
}

function trustedResource(trust: OgbTrustFile, extension: string, kind: "hooks" | "scripts", source: string): TrustedResource | undefined {
  return trust.extensions[extension]?.[kind]?.[source];
}

function collectCommandStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") return out;
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectCommandStrings(item, out);
    return out;
  }

  const object = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(object)) {
    if (/^(command|cmd|run|shell|script)$/i.test(key) && typeof item === "string" && item.trim()) out.push(item.trim());
    else if (Array.isArray(item) && /^(command|cmd|run|shell|script|args)$/i.test(key)) {
      const parts = item.filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
      if (parts.length > 0) out.push(parts.join(" "));
    } else collectCommandStrings(item, out);
  }
  return out;
}

function commandsForResource(filePath: string, kind: "hook" | "script"): string[] {
  if (!fs.existsSync(filePath)) return [];
  if (kind === "script") return [path.basename(filePath)];
  try {
    const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"));
    return [...new Set(collectCommandStrings(parsed))].sort();
  } catch {
    return [];
  }
}

export function buildTrustReviewReport(options: { projectRoot?: string; homeDir?: string; extension?: string } = {}): TrustReviewReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const map = readJsonc(paths.extensionMapPath);
  const trust = readTrustFile(paths.projectRoot, paths.homeDir);
  const warnings: string[] = [];
  const items: TrustReviewItem[] = [];
  const extensions = (Array.isArray(map?.extensions) ? map.extensions : [])
    .filter((extension: any) => !options.extension || extension?.name === options.extension);

  if (!map) warnings.push(`Extension map not found: ${paths.extensionMapPath}. Run ogb sync first.`);
  if (options.extension && extensions.length === 0) warnings.push(`Extension not found: ${options.extension}`);

  function add(extension: any, kind: "hooks" | "scripts", source: string, reason?: string): void {
    const resource = trustedResource(trust, extension.name, kind, source);
    const absolutePath = path.join(extension.path, ...source.split("/"));
    const exists = fs.existsSync(absolutePath);
    const hashMatches = resource && exists ? sha256File(absolutePath) === resource.sha256 : undefined;
    items.push({
      extension: extension.name,
      kind: kind === "hooks" ? "hook" : "script",
      source,
      absolutePath,
      exists,
      trusted: Boolean(resource),
      hashMatches,
      commands: commandsForResource(absolutePath, kind === "hooks" ? "hook" : "script"),
      reason,
    });
  }

  for (const extension of extensions) {
    for (const hook of Array.isArray(extension?.hooks) ? extension.hooks : []) add(extension, "hooks", String(hook.source), hook.reason);
    for (const script of Array.isArray(extension?.scripts) ? extension.scripts : []) add(extension, "scripts", String(script.source), script.reason);
  }

  return {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    extension: options.extension,
    items: items.sort((a, b) => `${a.extension}/${a.kind}/${a.source}`.localeCompare(`${b.extension}/${b.kind}/${b.source}`)),
    warnings,
  };
}

export function runTrustExtension(options: TrustOptions): TrustReport {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const map = readJsonc(paths.extensionMapPath);
  const extension = findExtension(map, options.extension);
  const warnings: string[] = [];
  const trusted: string[] = [];
  const revoked: string[] = [];

  if (!extension) {
    const report: TrustReport = {
      version: OGB_VERSION,
      projectRoot: paths.projectRoot,
      extension: options.extension,
      status: "error",
      trusted,
      revoked,
      warnings: [`Extension not found in ${paths.extensionMapPath}. Run ogb sync first.`],
      file: paths.trustPath,
    };
    printTrustReport(report, options.json);
    process.exitCode = 2;
    return report;
  }

  const hookSources = selectedSources(extension, "hooks", normalizeList(options.hook), options.allHooks);
  const scriptSources = selectedSources(extension, "scripts", normalizeList(options.script), options.allScripts);
  if (hookSources.length === 0 && scriptSources.length === 0) {
    warnings.push("No hooks/scripts selected. Use --hook, --script, --all-hooks, or --all-scripts.");
  }

  const trust = readTrustFile(paths.projectRoot, paths.homeDir);
  const bucket = trust.extensions[options.extension] ?? {};
  bucket.hooks ??= {};
  bucket.scripts ??= {};

  function apply(kind: "hooks" | "scripts", source: string): void {
    const sourcePath = path.join(extension.path, ...source.split("/"));
    if (!fs.existsSync(sourcePath)) {
      warnings.push(`${kind.slice(0, -1)} not found: ${options.extension}/${source}`);
      return;
    }
    const key = `${options.extension}/${source}`;
    if (options.revoke) {
      delete bucket[kind]?.[source];
      revoked.push(key);
      return;
    }
    bucket[kind]![source] = {
      sha256: sha256File(sourcePath),
      trustedAt: new Date().toISOString(),
    };
    trusted.push(key);
  }

  for (const source of hookSources) apply("hooks", source);
  for (const source of scriptSources) apply("scripts", source);
  if (Object.keys(bucket.hooks ?? {}).length === 0) delete bucket.hooks;
  if (Object.keys(bucket.scripts ?? {}).length === 0) delete bucket.scripts;
  if (Object.keys(bucket).length === 0) delete trust.extensions[options.extension];
  else trust.extensions[options.extension] = bucket;

  const report: TrustReport = {
    version: OGB_VERSION,
    projectRoot: paths.projectRoot,
    extension: options.extension,
    status: options.dryRun ? "preview" : "applied",
    trusted,
    revoked,
    warnings,
    file: paths.trustPath,
  };

  if (!options.dryRun && warnings.length === 0) writeTrustFile(paths.trustPath, trust);
  printTrustReport(report, options.json);
  if (warnings.length > 0) process.exitCode = 1;
  return report;
}

export function printTrustReport(report: TrustReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("OpenCode Gemini Bridge Trust");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Extension: ${report.extension}`);
  console.log(`Status: ${report.status}`);
  console.log(`Trust file: ${report.file}`);
  for (const item of report.trusted) console.log(`- trusted ${item}`);
  for (const item of report.revoked) console.log(`- revoked ${item}`);
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
}

export function runTrustReview(options: { projectRoot?: string; homeDir?: string; extension?: string; json?: boolean } = {}): TrustReviewReport {
  const report = buildTrustReviewReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("OpenCode Gemini Bridge Trust Review");
    console.log(`Project: ${report.projectRoot}`);
    if (report.extension) console.log(`Extension: ${report.extension}`);
    for (const item of report.items) {
      const status = item.trusted
        ? item.hashMatches === false ? "TRUSTED-CHANGED" : "TRUSTED"
        : "UNTRUSTED";
      console.log(`- ${status} ${item.extension}/${item.source} (${item.kind})`);
      if (item.commands.length > 0) console.log(`  commands: ${item.commands.join(" | ")}`);
      if (!item.exists) console.log("  warning: file missing");
    }
    if (report.items.length === 0) console.log("- No mapped hooks/scripts found.");
    for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  }
  if (report.warnings.length > 0 || report.items.some((item) => item.trusted && item.hashMatches === false)) process.exitCode = 1;
  return report;
}
