/** LRN-07 shared model vocabulary. No transport, provider SDK or OS imports. */
import { z } from "zod";
import { textBlockSchema, thinkingBlockSchema } from "./content.js";
import { usageSchema } from "./primitives.js";

export const streamFailureSchema = z.enum([
  "disconnected",
  "aborted",
  "stalled",
  "malformed-stream",
]);
export type StreamFailureKind = z.infer<typeof streamFailureSchema>;
export const rawToolCallSchema = z
  .object({
    index: z.number().int().nonnegative(),
    call_id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    arguments_raw: z.string(),
  })
  .strict();
export type RawToolCall = z.infer<typeof rawToolCallSchema>;
export type CompleteToolCall = RawToolCall & { call_id: string; name: string };
export const responseContentSchema = z.array(
  z.discriminatedUnion("type", [textBlockSchema, thinkingBlockSchema]),
);
export const responseOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete") }).strict(),
  z.object({ kind: z.literal("interrupted"), reason: streamFailureSchema }).strict(),
]);
export const responseShape = {
  content: responseContentSchema,
  tool_calls: z.array(rawToolCallSchema),
  usage: usageSchema,
  stop_reason: z.string().optional(),
  outcome: responseOutcomeSchema,
};
function validateCalls(
  value: { tool_calls: RawToolCall[]; outcome: { kind: string } },
  context: z.RefinementCtx,
): void {
  const indices = new Set<number>();
  const ids = new Set<string>();
  for (const [i, call] of value.tool_calls.entries()) {
    if (indices.has(call.index) || (call.call_id !== undefined && ids.has(call.call_id))) {
      context.addIssue({
        code: "custom",
        path: ["tool_calls", i],
        message: "duplicate tool call identity",
      });
    }
    indices.add(call.index);
    if (call.call_id !== undefined) ids.add(call.call_id);
    if (value.outcome.kind === "complete" && (!call.call_id || !call.name)) {
      context.addIssue({
        code: "custom",
        path: ["tool_calls", i],
        message: "complete calls require id and name",
      });
    }
  }
}
export const modelResponseSchema = z.object(responseShape).strict().superRefine(validateCalls);
export const assistantMessageV2 = z
  .object({ kind: z.literal("assistant_message"), schemaVersion: z.literal(2), ...responseShape })
  .strict()
  .superRefine(validateCalls);
export type ModelResponse = z.infer<typeof modelResponseSchema>;
export type AssistantMessageV2 = z.infer<typeof assistantMessageV2>;

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: readonly CompleteToolCall[] }
  | { role: "tool"; call_id: string; content: string };
export type ModelTool = {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
};
export type ModelRequest = {
  model: string;
  messages: readonly ModelMessage[];
  tools?: readonly ModelTool[];
  tool_choice?: "auto" | "none" | "required" | { name: string };
};
export type ModelEvent =
  | { type: "message_start"; id: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      call_id?: string;
      name_delta?: string;
      arguments_delta?: string;
    }
  | { type: "message_stop"; response: ModelResponse };
export interface ModelProvider {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
export type ProviderErrorKind = "http" | StreamFailureKind;
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly partial: ModelResponse | undefined;
  readonly status: number | undefined;
  constructor(kind: ProviderErrorKind, message: string, partial?: ModelResponse, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.partial = partial;
    this.status = status;
  }
}
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
