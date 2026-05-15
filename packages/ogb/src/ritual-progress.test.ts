import assert from "node:assert/strict";
import test from "node:test";
import { checkProgressSteps, updateProgressSteps } from "./ritual-progress.js";

function stepIds(steps: ReturnType<typeof checkProgressSteps>): string[] {
  return steps.map((step) => step.stepId);
}

test("check progress declares patch phases in the same order runPass emits them", () => {
  const steps = checkProgressSteps({
    setup: false,
    validation: false,
    security: false,
    dashboard: false,
  });

  assert.deepEqual(stepIds(steps), [
    "patches-pre-extension-update",
    "extension-update",
    "patches-post-extension-update",
    "patches-pre-sync",
    "sync",
    "patches-post-sync",
    "patches-pre-doctor",
    "doctor",
    "patches-post-check",
  ]);
  assert.equal(steps.find((step) => step.stepId === "patches-pre-sync")?.optional, true);
});

test("check progress removes patch phases when patches are disabled", () => {
  assert.deepEqual(stepIds(checkProgressSteps({
    setup: false,
    patches: false,
    validation: false,
    security: false,
    dashboard: false,
  })), [
    "extension-update",
    "sync",
    "doctor",
  ]);
});

test("update progress nests the post-update check steps after the updater phases", () => {
  assert.deepEqual(stepIds(updateProgressSteps({})), [
    "resolve",
    "download",
    "install",
    "post-check",
    "setup",
    "patches-pre-extension-update",
    "extension-update",
    "patches-post-extension-update",
    "patches-pre-sync",
    "sync",
    "patches-post-sync",
    "patches-pre-doctor",
    "doctor",
    "validate",
    "security",
    "dashboard",
    "patches-post-check",
  ]);
});

test("update dry-run and --no-setup keep only the updater phases", () => {
  const expected = ["resolve", "download", "install", "post-check"];
  assert.deepEqual(stepIds(updateProgressSteps({ dryRun: true })), expected);
  assert.deepEqual(stepIds(updateProgressSteps({ setup: false })), expected);
});
