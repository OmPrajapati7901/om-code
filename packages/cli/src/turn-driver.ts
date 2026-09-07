import {
  type Environment,
  type JournalSink,
  runTurn,
  type ToolRunner,
  type TurnBudget,
} from "@om-code/kernel";
import type { ModelProvider, ModelTool } from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import { EXIT, type ExitCode } from "./exit.js";
import { prefixedError } from "./render.js";
import type { CliIo } from "./types.js";

export type DrivenTurn = {
  readonly exitCode: ExitCode;
  readonly phase: "completed" | "failed" | "interrupted" | "limited";
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
  readonly modelTools?: readonly ModelTool[];
  readonly toolRunner?: ToolRunner | undefined;
  readonly budget?: TurnBudget | undefined;
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
    tools: input.modelTools ?? [],
    toolRunner: input.toolRunner,
    budget: input.budget,
  })) {
    if (event.type === "text_delta" && !input.json) {
      input.io.write(event.text);
      renderedText = true;
    } else if (event.type === "thinking_delta" && !input.json && input.io.isTty) {
      input.io.write(`\u001b[2m${event.text}\u001b[22m`);
      renderedText = true;
    } else if (event.type === "tool_call" && !input.json) {
      if (renderedText) {
        input.io.write("\n");
        renderedText = false;
      }
      input.io.write(`⏺ ${event.call.name}(${event.call.arguments_raw})\n`);
    } else if (event.type === "tool_result" && !input.json) {
      const firstLine = event.result.preview.split("\n", 1)[0] ?? "";
      const summary = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
      input.io.write(
        `  ⎿ ${event.call_id} ${event.result.status}${summary.length > 0 ? ` — ${summary}` : ""}\n`,
      );
    } else if (event.type === "turn_end") {
      if (!input.json && renderedText) input.io.write("\n");
      if (event.state.phase === "failed") {
        input.io.writeErr(prefixedError(event.state.error.message));
        terminal = { exitCode: EXIT.error, phase: "failed" };
      } else if (event.state.phase === "interrupted") {
        terminal = { exitCode: EXIT.error, phase: "interrupted" };
      } else if (event.state.phase === "limited") {
        input.io.writeErr(prefixedError(event.state.error.message));
        terminal = { exitCode: EXIT.limit, phase: "limited" };
      } else {
        terminal = { exitCode: EXIT.ok, phase: "completed" };
      }
    }
  }
  if (terminal === undefined) throw new Error("turn ended without a terminal event");
  return terminal;
}
