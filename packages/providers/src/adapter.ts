/** Own transport: HTTP, SSE framing, message conversion and retries. */
import {
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  ProviderError,
} from "@om-code/protocol";
import { abortable, errorMessage, retryDelay, sanitize, settleCleanup, sleep } from "./guards.js";
import { ResponseProjection } from "./projection.js";
import { decodeSse } from "./sse.js";

export type OpenAICompatibleOptions = {
  baseUrl: string;
  getApiKey?: () => string | undefined;
  includeUsage?: boolean;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
};

function messages(request: ModelRequest): unknown[] {
  return request.messages.map((message) => {
    if (message.role === "tool")
      return { role: "tool", tool_call_id: message.call_id, content: message.content };
    if (message.role !== "assistant") return { role: message.role, content: message.content };
    return {
      role: "assistant",
      content: message.content,
      ...(message.tool_calls?.length
        ? {
            tool_calls: message.tool_calls.map((call) => ({
              id: call.call_id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments_raw },
            })),
          }
        : {}),
    };
  });
}

function requestBody(request: ModelRequest, includeUsage: boolean): string {
  return JSON.stringify({
    model: request.model,
    messages: messages(request),
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(request.tools
      ? { tools: request.tools.map((tool) => ({ type: "function" as const, function: tool })) }
      : {}),
    ...(request.tool_choice === undefined
      ? {}
      : {
          tool_choice:
            typeof request.tool_choice === "object"
              ? { type: "function" as const, function: request.tool_choice }
              : request.tool_choice,
        }),
  });
}

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly options: OpenAICompatibleOptions;
  constructor(options: OpenAICompatibleOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new Error("baseUrl must be an absolute http(s) API root");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("baseUrl must be an http(s) API root without credentials, query or fragment");
    for (const duration of [options.idleTimeoutMs, options.requestTimeoutMs])
      if (
        duration !== undefined &&
        (!Number.isFinite(duration) || duration <= 0 || duration > 2_147_483_647)
      )
        throw new Error("timeouts must be positive bounded milliseconds");
    if (
      options.maxRetries !== undefined &&
      (!Number.isInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 2)
    )
      throw new Error("maxRetries must be 0, 1 or 2");
    this.options = { ...options, baseUrl: url.toString().replace(/\/+$/, "") };
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const options = this.options;
    const controller = new AbortController();
    const abort = (error: ProviderError) => {
      if (!controller.signal.aborted) controller.abort(error);
    };
    const callerAbort = () => abort(new ProviderError("aborted", "request aborted"));
    signal.addEventListener("abort", callerAbort, { once: true });
    if (signal.aborted) callerAbort();
    const deadline = setTimeout(
      () => abort(new ProviderError("stalled", "request deadline exceeded")),
      options.requestTimeoutMs ?? 300_000,
    );
    const projection = new ResponseProjection();
    let secret: string | undefined;
    let iterator: AsyncIterator<string> | undefined;
    try {
      controller.signal.throwIfAborted();
      secret = options.getApiKey?.();
      const headers = {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      };
      const payload = requestBody(request, options.includeUsage ?? true);
      const maxRetries = options.maxRetries ?? 2;
      const fetchImpl = options.fetchImpl ?? fetch;

      // Initial connection only: retry 429/5xx and pre-response transport
      // failures up to maxRetries. Once the stream has started, no retry.
      let response: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted();
        let raw: Response;
        try {
          raw = await abortable(
            fetchImpl(`${options.baseUrl}/chat/completions`, {
              method: "POST",
              headers,
              body: payload,
              signal: controller.signal,
              redirect: "error",
            }),
            controller.signal,
          );
        } catch (error) {
          if (error instanceof ProviderError || attempt >= maxRetries) throw error;
          await sleep(retryDelay(attempt, null, Date.now(), Math.random), controller.signal);
          continue;
        }
        const sse =
          raw.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
          "text/event-stream";
        if (raw.ok && sse) {
          response = raw;
          break;
        }
        if (!raw.ok && (raw.status === 429 || raw.status >= 500) && attempt < maxRetries) {
          if (raw.body) await raw.body.cancel().catch(() => {});
          const retryAfter = raw.headers.get("retry-after");
          await sleep(retryDelay(attempt, retryAfter, Date.now(), Math.random), controller.signal);
          continue;
        }
        const message = await errorMessage(raw, secret, controller.signal);
        const error = new ProviderError("http", message, undefined, raw.status);
        abort(error);
        throw error;
      }
      if (!response.body) {
        const error = new ProviderError("malformed-stream", "endpoint returned an empty stream");
        abort(error);
        throw error;
      }
      const bytes = response.body.pipeThrough(new TransformStream(), { signal: controller.signal });
      const waitForChunk = async <T>(work: Promise<T>): Promise<T> => {
        const idle = setTimeout(
          () => abort(new ProviderError("stalled", "stream idle timeout")),
          options.idleTimeoutMs ?? 60_000,
        );
        try {
          return await abortable(work, controller.signal);
        } finally {
          clearTimeout(idle);
        }
      };
      const activeIterator = decodeSse(bytes)[Symbol.asyncIterator]();
      iterator = activeIterator;
      for (;;) {
        const result = await waitForChunk(activeIterator.next());
        if (result.done) break;
        // "[DONE]" ends the logical stream regardless of whether the
        // underlying connection also closes.
        if (result.value === "[DONE]") break;
        const parsed: unknown = JSON.parse(result.value);
        for (const event of projection.accept(parsed)) {
          controller.signal.throwIfAborted();
          yield event;
        }
      }
      controller.signal.throwIfAborted();
      const finished = projection.finish();
      controller.abort();
      yield { type: "message_stop", response: finished };
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      const status =
        typeof failure === "object" &&
        failure !== null &&
        "status" in failure &&
        typeof failure.status === "number"
          ? failure.status
          : undefined;
      const kind =
        failure instanceof ProviderError
          ? failure.kind
          : status !== undefined
            ? "http"
            : failure instanceof SyntaxError
              ? "malformed-stream"
              : "disconnected";
      const message =
        failure instanceof Error ? sanitize(failure.message, secret) : "inference transport failed";
      throw new ProviderError(
        kind,
        message,
        kind === "http" ? undefined : projection.snapshot(kind),
        status,
      );
    } finally {
      controller.abort();
      clearTimeout(deadline);
      signal.removeEventListener("abort", callerAbort);
      const close = iterator?.return?.bind(iterator);
      if (close) await settleCleanup(close());
    }
  }
}
