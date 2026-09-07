import { createInterface } from "node:readline/promises";
import type { ErrorEntry } from "@om-code/protocol";
import { EXIT, type ExitCode } from "./exit.js";
import { prefixedError } from "./render.js";
import type { DrivenTurn } from "./turn-driver.js";
import type { CliIo } from "./types.js";

export type ReplInput = {
  readonly io: CliIo;
  readonly maxTurns: number | undefined;
  readonly runTurn: (text: string, signal: AbortSignal) => Promise<DrivenTurn>;
  readonly appendLimit: (entry: ErrorEntry) => Promise<void>;
};

export async function runRepl(input: ReplInput): Promise<ExitCode> {
  const readline = createInterface({
    input: input.io.input,
    output: input.io.output,
    terminal: input.io.isTty,
  });
  let active: AbortController | undefined;
  let turns = 0;
  const onInterrupt = () => {
    active?.abort();
  };
  // readline's async iterator can stop pulling while the turn body awaits.
  // Watching the injected stream as well keeps the terminal in flowing mode
  // and makes a raw Ctrl-C byte abort the active provider immediately.
  const onInput = (chunk: unknown) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (text.includes("\u0003")) onInterrupt();
  };
  readline.on("SIGINT", onInterrupt);
  input.io.input.on("om-interrupt", onInterrupt);
  input.io.input.on("data", onInput);
  try {
    if (input.io.isTty) input.io.write("> ");
    for await (const line of readline) {
      if (line.length === 0) {
        if (input.io.isTty) input.io.write("> ");
        continue;
      }
      if (input.maxTurns !== undefined && turns >= input.maxTurns) {
        const message = `maximum turn limit (${input.maxTurns}) reached`;
        await input.appendLimit({
          kind: "error",
          schemaVersion: 1,
          source: "local",
          reason: "max-turns",
          message,
          retryable: false,
        });
        input.io.writeErr(prefixedError(message));
        return EXIT.limit;
      }

      active = new AbortController();
      input.io.input.resume();
      const result = await input.runTurn(line, active.signal);
      active = undefined;
      turns += 1;
      if (result.phase === "interrupted") {
        input.io.writeErr(prefixedError("turn interrupted; session kept"));
      }
      // A provider failure is terminal for the run; an interrupted turn is
      // explicitly recoverable in this same REPL.
      if (result.phase === "failed") return EXIT.error;
      if (input.io.isTty) input.io.write("> ");
    }
    return EXIT.ok;
  } finally {
    active?.abort();
    input.io.input.off("data", onInput);
    input.io.input.off("om-interrupt", onInterrupt);
    readline.off("SIGINT", onInterrupt);
    readline.close();
  }
}
