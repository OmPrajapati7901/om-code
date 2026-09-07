import { type Environment, type JournalSink, runTurn } from "@om-code/kernel";
import type { ModelProvider } from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import type { CliIo } from "./cli.js";
import { EXIT, type ExitCode } from "./exit.js";
import { prefixedError } from "./render.js";

export type DrivenTurn = {
  readonly exitCode: ExitCode;
  readonly phase: "completed" | "failed" | "interrupted";
};

export type DriveTurnInput = {
  readonly session: SessionView;
  readonly text: string;
  readonly provider: ModelProvider;
  readonly journal: JournalSink;
  readonly newTurnId: () => string;
  readonly signal: AbortSignal;
  readonly model: string;
  readonly environment: Environment;
  readonly io: CliIo;
  readonly json: boolean;
};

export async function driveTurn(input: DriveTurnInput): Promise<DrivenTurn> {
  let terminal: DrivenTurn | undefined;
  let renderedText = false;
  for await (const event of runTurn({
    session: input.session,
    text: input.text,
    provider: input.provider,
    journal: input.journal,
    newTurnId: input.newTurnId,
    signal: input.signal,
    model: input.model,
    environment: input.environment,
    instructions: [],
    tools: [],
  })) {
    if (event.type === "text_delta" && !input.json) {
      input.io.write(event.text);
      renderedText = true;
    } else if (event.type === "thinking_delta" && !input.json && input.io.isTty) {
      input.io.write(`\u001b[2m${event.text}\u001b[22m`);
      renderedText = true;
    } else if (event.type === "turn_end") {
      if (!input.json && renderedText) input.io.write("\n");
      if (event.state.phase === "failed") {
        input.io.writeErr(prefixedError(event.state.error.message));
        terminal = { exitCode: EXIT.error, phase: "failed" };
      } else if (event.state.phase === "interrupted") {
        terminal = { exitCode: EXIT.error, phase: "interrupted" };
      } else {
        terminal = { exitCode: EXIT.ok, phase: "completed" };
      }
    }
  }
  if (terminal === undefined) throw new Error("turn ended without a terminal event");
  return terminal;
}
