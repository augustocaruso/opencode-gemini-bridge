export type RitualProgressStatus = "queued" | "running" | "pass" | "warn" | "fail" | "skipped";

export interface RitualProgressEvent {
  stepId: string;
  label: string;
  detail?: string;
  status: RitualProgressStatus;
  message?: string;
}

export type RitualProgressSink = (event: RitualProgressEvent) => void;

export interface RitualProgressDefinition {
  stepId: string;
  label: string;
  detail?: string;
}

export function emitRitualProgress(sink: RitualProgressSink | undefined, event: RitualProgressEvent): void {
  sink?.(event);
}

export function progressStatusFromOutcome(outcome: string | undefined): RitualProgressStatus {
  if (outcome === "pass" || outcome === "applied") return "pass";
  if (outcome === "warn") return "warn";
  if (outcome === "fail" || outcome === "error") return "fail";
  if (outcome === "preview" || outcome === "skipped" || outcome === "cancelled") return "skipped";
  return "pass";
}

export function progressStatusFromFindings(errors: number, warnings: number): RitualProgressStatus {
  if (errors > 0) return "fail";
  if (warnings > 0) return "warn";
  return "pass";
}

