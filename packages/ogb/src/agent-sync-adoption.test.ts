import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentSyncAdoptionReport } from "./agent-sync-adoption.js";

test("buildAgentSyncAdoptionReport classifies user-owned Gemini rules as sync candidates", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-agent-sync-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogb-agent-sync-home-"));
  fs.mkdirSync(path.join(homeDir, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, ".gemini", "GEMINI.md"), "Global Gemini rules\n");

  const report = buildAgentSyncAdoptionReport({ projectRoot, homeDir });
  const globalGemini = report.candidates.find((candidate) => candidate.tool === "gemini" && candidate.scope === "global" && candidate.kind === "rules");

  assert.equal(globalGemini?.exists, true);
  assert.equal(globalGemini?.recommendation, "sync");
  assert.ok(report.recommendation.some((item) => item.includes("dry-run")));
});
