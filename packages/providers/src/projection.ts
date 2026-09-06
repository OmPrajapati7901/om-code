/** Journal projection of LangChain chunks. Never use its eagerly parsed tool arguments. */
import { type BaseMessageChunk, isAIMessageChunk } from "@langchain/core/messages";
import {
  type ModelEvent,
  type ModelResponse,
  modelResponseSchema,
  ProviderError,
  type RawToolCall,
  type StreamFailureKind,
  type Usage,
} from "@om-code/protocol";

function malformed(message: string): never {
  throw new ProviderError("malformed-stream", message);
}
export function mapUsage(value: unknown): Usage {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { kind: "unknown" };
  const raw = value as Record<string, unknown>;
  const integer = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!integer(raw.prompt_tokens) || !integer(raw.completion_tokens)) return { kind: "unknown" };
  return {
    kind: "known",
    input_tokens: raw.prompt_tokens,
    output_tokens: raw.completion_tokens,
    ...(integer(raw.total_tokens) ? { total_tokens: raw.total_tokens } : {}),
  };
}

export class ResponseProjection {
  private readonly content: ModelResponse["content"] = [];
  private readonly calls = new Map<number, RawToolCall>();
  private usage: Usage = { kind: "unknown" };
  private id: string | undefined;
  private stopReason: string | undefined;
  private characters = 0;

  accept(chunk: BaseMessageChunk, model: string): ModelEvent[] {
    const events: ModelEvent[] = [];
    if (this.id === undefined) {
      this.id = chunk.id ?? crypto.randomUUID();
      events.push({ type: "message_start", id: this.id, model });
    }
    const reported = chunk.response_metadata.usage;
    if (reported && typeof reported === "object" && Object.keys(reported).length > 0)
      this.usage = mapUsage(reported);
    for (const [text, type] of [
      [chunk.additional_kwargs.reasoning_content, "thinking"],
      [chunk.content, "text"],
    ] as const) {
      if (text === undefined || text === null || text === "") continue;
      if (typeof text !== "string" || this.stopReason !== undefined)
        return malformed("invalid content delta");
      this.account(text.length);
      const last = this.content.at(-1);
      if (last?.type === type) last.text += text;
      else this.content.push({ type, text });
      events.push(
        type === "text" ? { type: "text_delta", text } : { type: "thinking_delta", text },
      );
    }
    if (isAIMessageChunk(chunk)) {
      for (const fragment of chunk.tool_call_chunks ?? []) {
        if (this.stopReason !== undefined) return malformed("tool delta after finish");
        events.push(this.tool(fragment));
      }
    }
    const finish = chunk.response_metadata.finish_reason;
    if (finish !== undefined && finish !== null) {
      if (typeof finish !== "string" || !finish || this.stopReason !== undefined)
        return malformed("invalid finish reason");
      this.stopReason = finish;
    }
    return events;
  }

  private account(characters: number): void {
    this.characters += characters;
    if (this.characters > 8_388_608) malformed("response exceeds character limit");
  }

  private tool(raw: { index?: number; id?: string; name?: string; args?: string }): ModelEvent {
    if (!Number.isSafeInteger(raw.index) || raw.index === undefined || raw.index < 0)
      return malformed("missing or invalid tool-call index");
    const call = { ...(this.calls.get(raw.index) ?? { index: raw.index, arguments_raw: "" }) };
    if (raw.id !== undefined) {
      if (
        typeof raw.id !== "string" ||
        !raw.id ||
        (call.call_id !== undefined && call.call_id !== raw.id) ||
        [...this.calls.values()].some(
          (other) => other.index !== raw.index && other.call_id === raw.id,
        )
      )
        return malformed("conflicting tool-call id");
      call.call_id = raw.id;
    }
    if (
      (raw.name !== undefined && typeof raw.name !== "string") ||
      (raw.args !== undefined && typeof raw.args !== "string")
    )
      return malformed("invalid tool-call fragment");
    this.account((raw.name?.length ?? 0) + (raw.args?.length ?? 0));
    if (raw.name) call.name = (call.name ?? "") + raw.name;
    call.arguments_raw += raw.args ?? "";
    this.calls.set(call.index, call);
    return {
      type: "tool_call_delta",
      index: call.index,
      ...(raw.id === undefined ? {} : { call_id: raw.id }),
      ...(raw.name === undefined ? {} : { name_delta: raw.name }),
      ...(raw.args === undefined ? {} : { arguments_delta: raw.args }),
    };
  }

  snapshot(reason?: StreamFailureKind): ModelResponse {
    return {
      content: structuredClone(this.content),
      tool_calls: [...this.calls.values()]
        .sort((a, b) => a.index - b.index)
        .map((call) => ({ ...call })),
      usage: { ...this.usage },
      ...(this.stopReason === undefined ? {} : { stop_reason: this.stopReason }),
      outcome: reason === undefined ? { kind: "complete" } : { kind: "interrupted", reason },
    };
  }

  finish(): ModelResponse {
    if (this.stopReason === undefined)
      throw new ProviderError("disconnected", "stream ended before finish_reason");
    const response = this.snapshot();
    if (!modelResponseSchema.safeParse(response).success)
      return malformed("incomplete tool call at stream completion");
    return response;
  }
}
