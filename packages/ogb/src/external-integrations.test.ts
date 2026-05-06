import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUTO_FALLBACK_PLUGIN,
  autoFallbackConfigFromProjection,
  externalOpenCodePlugins,
  OPENCODE_QUOTA_PLUGIN,
  projectExternalIntegrations,
  QUOTA_CONFIG_PATH,
} from "./external-integrations.js";
import type { GeminiExtensionProjectionMap } from "./extension-projection.js";
import type { OgbConfig } from "./ogb-config.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function projectionMap(overrides: Partial<GeminiExtensionProjectionMap> = {}): GeminiExtensionProjectionMap {
  return {
    _generated: {
      tool: "ogb",
      version: "test",
      warning: "test",
    },
    projectRoot: "/tmp/project",
    generatedAt: "2026-05-05T00:00:00.000Z",
    extensions: [],
    projectedCommands: [],
    projectedAgents: [],
    modelFallbacks: [],
    removedCommands: [],
    removedAgents: [],
    warnings: [],
    ...overrides,
  };
}

test("externalOpenCodePlugins keeps runtime fallback before quota server plugin", () => {
  const config: OgbConfig = {
    externalPlugins: {
      autoFallback: { enabled: true },
      quotaUi: { enabled: true },
    },
  };

  assert.deepEqual(externalOpenCodePlugins(config), [AUTO_FALLBACK_PLUGIN, OPENCODE_QUOTA_PLUGIN]);
});

test("externalOpenCodePlugins can skip project fallback plugin when installed globally", () => {
  const config: OgbConfig = {
    externalPlugins: {
      autoFallback: { enabled: true, installProjectPlugin: false },
      quotaUi: { enabled: true },
    },
  };

  assert.deepEqual(externalOpenCodePlugins(config), [OPENCODE_QUOTA_PLUGIN]);
});

test("autoFallbackConfigFromProjection converts OGB fallback chains to opencode-auto-fallback config", () => {
  const config: OgbConfig = {
    externalPlugins: {
      autoFallback: {
        enabled: true,
        cooldownMs: 10_000,
        maxRetries: 1,
      },
    },
  };
  const generated = autoFallbackConfigFromProjection(config, projectionMap({
    modelFallbacks: [
      {
        agent: "helper",
        extension: "study-pack",
        model: "openai/gpt-5.5",
        fallback_models: [
          { model: "openai/gpt-5.4-mini", variant: "medium", top_p: 0.8 },
          "anthropic/claude-haiku-4-5",
        ],
        source: "agent",
      },
    ],
  }));

  assert.equal(generated.enabled, true);
  assert.equal(generated.cooldownMs, 10_000);
  assert.equal(generated.maxRetries, 1);
  assert.deepEqual(generated.agentFallbacks, {
    helper: [
      { model: "openai/gpt-5.4-mini", variant: "medium", topP: 0.8 },
      "anthropic/claude-haiku-4-5",
    ],
  });
});

test("projectExternalIntegrations writes quota UI prefs and fallback runtime config", () => {
  const projectRoot = tempDir("ogb-ext-project-");
  const homeDir = tempDir("ogb-ext-home-");
  const config: OgbConfig = {
    externalPlugins: {
      quotaUi: {
        enabled: true,
        suppressOgbLimits: true,
        enableToast: false,
        onlyCurrentModel: true,
      },
      autoFallback: {
        enabled: true,
        cooldownMs: 30_000,
      },
    },
  };

  const report = projectExternalIntegrations({
    projectRoot,
    homeDir,
    config,
    extensionMap: projectionMap({
      modelFallbacks: [
        {
          agent: "helper",
          extension: "study-pack",
          fallback_models: ["openai/gpt-5.4-mini"],
          source: "agent",
        },
      ],
    }),
  });

  assert.ok(report.writes.some((write) => write.relPath === ".opencode/generated/ogb-ui.json"));
  assert.ok(report.writes.some((write) => write.relPath === QUOTA_CONFIG_PATH));
  assert.ok(report.writes.some((write) => write.relPath === ".config/opencode/plugins/fallback.json"));

  const ui = JSON.parse(fs.readFileSync(path.join(projectRoot, ".opencode", "generated", "ogb-ui.json"), "utf8"));
  const quota = JSON.parse(fs.readFileSync(path.join(projectRoot, ...QUOTA_CONFIG_PATH.split("/")), "utf8"));
  const fallback = JSON.parse(fs.readFileSync(path.join(homeDir, ".config", "opencode", "plugins", "fallback.json"), "utf8"));

  assert.equal(ui.quotaPanel, "external");
  assert.equal(quota.enabled, true);
  assert.equal(quota.enableToast, false);
  assert.equal(quota.onlyCurrentModel, true);
  assert.deepEqual(fallback.agentFallbacks, { helper: ["openai/gpt-5.4-mini"] });
});

test("projectExternalIntegrations keeps quota UI unfiltered by default", () => {
  const projectRoot = tempDir("ogb-ext-project-");
  const homeDir = tempDir("ogb-ext-home-");

  projectExternalIntegrations({
    projectRoot,
    homeDir,
    config: {
      externalPlugins: {
        quotaUi: { enabled: true },
      },
    },
    extensionMap: projectionMap(),
  });

  const quota = JSON.parse(fs.readFileSync(path.join(projectRoot, ...QUOTA_CONFIG_PATH.split("/")), "utf8"));
  assert.equal(quota.onlyCurrentModel, false);
});
