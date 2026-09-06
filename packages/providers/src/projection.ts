/** Payload normalization. Tool arguments stay unparsed, including malformed JSON. */
import {
  type ModelEvent,
  type ModelResponse,
  modelResponseSchema,
  ProviderError,
  type RawToolCall,
  type StreamFailureKind,
  type Usage,
} from "@om-code/protocol";

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ProviderError("malformed-stream", "expected a JSON object in stream");
  return value as Record<string, unknown>;
}

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

  accept(payload: unknown): ModelEvent[] {
    const raw = object(payload);
    if (raw.error !== undefined) return malformed("endpoint returned an error in its stream");
    const events: ModelEvent[] = [];
    if (this.id === undefined) {
      if (typeof raw.id !== "string" || !raw.id || typeof raw.model !== "string")
        return malformed("missing response identity");
      this.id = raw.id;
      events.push({ type: "message_start", id: raw.id, model: raw.model });
    } else if (raw.id !== undefined && raw.id !== this.id) {
      return malformed("response identity changed");
    }
    if (raw.usage !== undefined && raw.usage !== null) this.usage = mapUsage(raw.usage);
    if (!Array.isArray(raw.choices) || raw.choices.length > 1)
      return malformed("expected at most one completion choice");
    if (raw.choices.length === 0) return events;
    const choice = object(raw.choices[0]);
    if (choice.index !== 0) return malformed("expected completion choice index 0");
    const delta = object(choice.delta);
    for (const [field, type] of [
      ["content", "text"],
      ["reasoning_content", "thinking"],
    ] as const) {
      const text = delta[field];
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
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls) || this.stopReason !== undefined)
        return malformed("invalid tool-call delta");
      for (const fragment of delta.tool_calls) events.push(this.tool(fragment));
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (
        typeof choice.finish_reason !== "string" ||
        choice.finish_reason.length === 0 ||
        this.stopReason !== undefined
      )
        return malformed("invalid finish reason");
      this.stopReason = choice.finish_reason;
    }
    return events;
  }

  private account(characters: number): void {
    this.characters += characters;
    if (this.characters > 8_388_608) malformed("response exceeds character limit");
  }

  private tool(value: unknown): ModelEvent {
    const raw = object(value);
    if (typeof raw.index !== "number" || !Number.isSafeInteger(raw.index) || raw.index < 0)
      return malformed("missing or invalid tool-call index");
    if (raw.type !== undefined && raw.type !== "function")
      return malformed("unsupported tool-call type");
    const fn = raw.function === undefined ? {} : object(raw.function);
    const previous = this.calls.get(raw.index) ?? { index: raw.index, arguments_raw: "" };
    const call = { ...previous };
    if (raw.id !== undefined) {
      if (
        typeof raw.id !== "string" ||
        !raw.id ||
        (call.call_id !== undefined && call.call_id !== raw.id)
      )
        return malformed("conflicting tool-call id");
      if (
        [...this.calls.values()].some(
          (other) => other.index !== raw.index && other.call_id === raw.id,
        )
      )
        return malformed("duplicate tool-call id");
      call.call_id = raw.id;
    }
    if (fn.name !== undefined && typeof fn.name !== "string")
      return malformed("invalid tool name fragment");
    if (fn.arguments !== undefined && typeof fn.arguments !== "string")
      return malformed("invalid tool arguments fragment");
    if (typeof fn.name === "string" && fn.name.length > 0) call.name = (call.name ?? "") + fn.name;
    if (typeof fn.arguments === "string") call.arguments_raw += fn.arguments;
    this.account(
      (typeof fn.name === "string" ? fn.name.length : 0) +
        (typeof fn.arguments === "string" ? fn.arguments.length : 0),
    );
    this.calls.set(call.index, call);
    return {
      type: "tool_call_delta",
      index: call.index,
      ...(typeof raw.id === "string" ? { call_id: raw.id } : {}),
      ...(typeof fn.name === "string" ? { name_delta: fn.name } : {}),
      ...(typeof fn.arguments === "string" ? { arguments_delta: fn.arguments } : {}),
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
