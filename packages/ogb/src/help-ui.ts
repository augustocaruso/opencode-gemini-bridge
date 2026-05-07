import React, { useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, type Instance } from "ink";
import { filterHelpCommands, type HelpCommand } from "./help-catalog.js";

function frameWidth(): number {
  return Math.max(60, process.stdout.columns ?? 100);
}

function categoryColor(category: HelpCommand["category"]): string {
  if (category === "Core") return "green";
  if (category === "Inspect") return "cyan";
  if (category === "Sync") return "blue";
  if (category === "Setup") return "magenta";
  if (category === "Extensions") return "yellow";
  if (category === "Telemetry") return "gray";
  if (category === "Legacy") return "gray";
  return "white";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, width: number): string {
  if (width <= 1) return value.slice(0, Math.max(0, width));
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

function visibleWindow<T>(items: readonly T[], selected: number, size: number): { items: T[]; offset: number } {
  const offset = clamp(selected - Math.floor(size / 2), 0, Math.max(0, items.length - size));
  return { items: items.slice(offset, offset + size), offset };
}

function HelpDetails(props: { command: HelpCommand | undefined }) {
  const command = props.command;
  if (!command) {
    return React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "No commands found"),
      React.createElement(Text, { color: "gray" }, "Clear the filter or type a broader term."),
    );
  }
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true }, `ogb ${command.name}`),
    command.aliases?.length
      ? React.createElement(Text, { color: "gray" }, `Aliases: ${command.aliases.join(", ")}`)
      : null,
    React.createElement(Box, { marginTop: 1 },
      React.createElement(Text, null, command.description),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Usage"),
      React.createElement(Text, { color: "gray" }, command.usage),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Examples"),
      ...command.examples.map((example) => React.createElement(Text, { key: example, color: "gray" }, `- ${example}`)),
    ),
  );
}

function HelpApp(props: { commands: HelpCommand[] }) {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const width = frameWidth();
  const summaryWidth = Math.max(20, width - 40);
  const filtered = useMemo(() => filterHelpCommands(query, props.commands), [props.commands, query]);
  const safeSelected = filtered.length === 0 ? 0 : clamp(selected, 0, filtered.length - 1);
  const window = visibleWindow(filtered, safeSelected, 12);
  const current = filtered[safeSelected];

  useInput((input, key) => {
    if (key.escape) {
      if (query) {
        setQuery("");
        setSelected(0);
      } else {
        exit();
      }
      return;
    }
    if ((input === "q" || input === "Q") && !query) {
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelected((value) => clamp(value - 1, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelected((value) => clamp(value + 1, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.pageUp) {
      setSelected((value) => clamp(value - 6, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.pageDown) {
      setSelected((value) => clamp(value + 6, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      setSelected(0);
      return;
    }
    if (input && /^[\w\s./:-]$/.test(input)) {
      setQuery((value) => `${value}${input}`);
      setSelected(0);
    }
  });

  return React.createElement(
    Box,
    { borderStyle: "round", borderColor: "gray", paddingX: 1, flexDirection: "column", width },
    React.createElement(
      Box,
      { flexDirection: "row", justifyContent: "space-between" },
      React.createElement(Text, { bold: true, color: "green" }, "OGB command guide"),
      React.createElement(Text, { color: "gray" }, "q/Esc exit  ↑↓ move  type filter"),
    ),
    React.createElement(Text, { color: "gray" }, query ? `Filter: ${query}` : "Filter: type any command, topic, or flag"),
    React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      ...window.items.map((command, index) => {
        const actualIndex = window.offset + index;
        const active = actualIndex === safeSelected;
        const prefix = active ? ">" : " ";
        const name = truncate(command.name, 17).padEnd(17);
        const category = truncate(command.category, 9).padEnd(9);
        const summary = truncate(command.summary, summaryWidth);
        return React.createElement(Box, { key: command.name, flexDirection: "row" },
          React.createElement(Text, { color: active ? "green" : "gray", bold: active }, `${prefix} ${name} `),
          React.createElement(Text, { color: categoryColor(command.category) }, `${category} `),
          React.createElement(Text, { color: active ? "white" : "gray" }, summary),
        );
      }),
    ),
    React.createElement(HelpDetails, { command: current }),
  );
}

export async function renderInteractiveHelp(commands: HelpCommand[]): Promise<void> {
  let instance: Instance | undefined;
  try {
    instance = render(React.createElement(HelpApp, { commands }), {
      exitOnCtrlC: true,
      patchConsole: false,
    });
    await instance.waitUntilExit();
  } finally {
    instance?.unmount();
    instance?.cleanup();
  }
}
