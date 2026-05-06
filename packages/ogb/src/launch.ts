export function resolveLaunchAgent(options: { agent?: string; yolo?: boolean }): string | undefined {
  const requested = typeof options.agent === "string" ? options.agent.trim() : "";
  if (options.yolo && requested && requested.toLowerCase() !== "yolo") {
    throw new Error(`Use --yolo or --agent ${requested}, not both.`);
  }
  if (options.yolo) return "YOLO";
  return requested || undefined;
}

export function buildOpenCodeLaunchArgs(options: { agent?: string; yolo?: boolean }): string[] {
  const agent = resolveLaunchAgent(options);
  return agent ? ["--agent", agent] : [];
}
