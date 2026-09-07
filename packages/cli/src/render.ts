import type { AssistantMessageV2 } from "@om-code/protocol";
import type { SessionView } from "@om-code/session";

export type SessionRow = {
  readonly id: string;
  readonly status: string;
  readonly lastActivity: string;
};

function table(rows: readonly (readonly string[])[], headers: readonly string[]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return `${format(headers)}\n${rows.map(format).join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

export function renderSessions(rows: readonly SessionRow[]): string {
  return table(
    rows.map((row) => [row.id, row.status, row.lastActivity]),
    ["id", "status", "last activity"],
  );
}

function assistantText(entry: AssistantMessageV2): string {
  return entry.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function renderTranscript(sessionId: string, view: SessionView): string {
  const lines = [`Session ${sessionId}`];
  for (const entry of view.conversation) {
    if (entry.kind === "user_message") {
      lines.push("", `You: ${entry.text}`);
      continue;
    }
    const text =
      entry.schemaVersion === 2
        ? assistantText(entry)
        : entry.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
    const suffix =
      entry.schemaVersion === 2 && entry.outcome.kind === "interrupted" ? " [interrupted]" : "";
    lines.push("", `Assistant${suffix}: ${text}`);
  }
  for (const error of view.errors)
    lines.push("", `Error (${error.source}/${error.reason}): ${error.message}`);
  return `${lines.join("\n")}\n`;
}

export function prefixedError(message: string): string {
  return `${message.startsWith("om:") ? message : `om: ${message}`}\n`;
}
