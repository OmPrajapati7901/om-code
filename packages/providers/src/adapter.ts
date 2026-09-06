/** LangChain owns HTTP, SSE, message conversion and initial-call retries. */
import {
  type BaseMessageChunk,
  ChatMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import {
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  ProviderError,
} from "@om-code/protocol";
import { abortable, errorMessage, sanitize, settleCleanup } from "./guards.js";
import { ResponseProjection } from "./projection.js";

export type OpenAICompatibleOptions = {
  baseUrl: string;
  getApiKey?: () => string | undefined;
  includeUsage?: boolean;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
};

function messages(request: ModelRequest) {
  return request.messages.map((message) => {
    if (message.role === "tool")
      return new ToolMessage({ content: message.content, tool_call_id: message.call_id });
    if (message.role !== "assistant")
      return message.role === "system"
        ? new SystemMessage(message.content)
        : new HumanMessage(message.content);
    return new ChatMessage({
      role: "assistant",
      content: message.content,
      additional_kwargs: {
        tool_calls: (message.tool_calls ?? []).map((call) => ({
          id: call.call_id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments_raw },
        })),
      },
    });
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
    let iterator: AsyncIterator<BaseMessageChunk> | undefined;
    try {
      controller.signal.throwIfAborted();
      // The pinned Runnable.stream drops a disabled local tracing context.
      // Fail before constructing the SDK instead of mutating process-wide settings.
      for (const name of [
        "LANGCHAIN_VERBOSE",
        "LANGCHAIN_TRACING",
        "LANGCHAIN_TRACING_V2",
        "LANGSMITH_TRACING",
        "LANGSMITH_TRACING_V2",
      ])
        if (process.env[name] === "true")
          throw new ProviderError("http", `Disable ${name} to keep inference content private`);
      secret = options.getApiKey?.();
      const guardedFetch: typeof fetch = async (input, init) => {
        controller.signal.throwIfAborted();
        const headers = new Headers(init?.headers);
        // The SDK requires an API key even for an unauthenticated endpoint.
        if (!secret) headers.delete("authorization");
        headers.delete("openai-organization");
        headers.delete("openai-project");
        const pending = (options.fetchImpl ?? fetch)(input, {
          ...init,
          headers,
          signal: controller.signal,
          redirect: "error",
        });
        void pending.then(
          (late) => {
            if (controller.signal.aborted) void late.body?.cancel().catch(() => {});
          },
          () => {},
        );
        const response = await abortable(pending, controller.signal);
        const sse =
          response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
          "text/event-stream";
        if (!response.ok || !sse) {
          const message = await errorMessage(response, secret, controller.signal);
          if (response.ok) {
            const error = new ProviderError("http", message, undefined, response.status);
            abort(error);
            throw error;
          }
          // Bound/redact before the SDK reads or attaches an error body.
          return new Response(JSON.stringify({ error: { message } }), {
            status: response.status,
            headers: response.headers,
          });
        }
        if (!response.body) {
          const error = new ProviderError("malformed-stream", "endpoint returned an empty stream");
          abort(error);
          throw error;
        }
        return new Response(
          response.body.pipeThrough(new TransformStream(), { signal: controller.signal }),
          { status: response.status, headers: response.headers },
        );
      };
      const model = new ChatOpenAICompletions({
        model: request.model,
        apiKey: secret || "om-code-unauthenticated",
        n: 1,
        streamUsage: options.includeUsage ?? true,
        maxRetries: options.maxRetries ?? 2,
        configuration: {
          baseURL: options.baseUrl,
          fetch: guardedFetch,
          organization: "",
          project: "",
          logLevel: "off",
        },
      });
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
      const stream = await waitForChunk(
        model.stream(messages(request), {
          signal: controller.signal,
          ...(request.tools
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function" as const,
                  function: tool,
                })),
              }
            : {}),
          ...(request.tool_choice === undefined
            ? {}
            : {
                tool_choice:
                  typeof request.tool_choice === "object"
                    ? { type: "function" as const, function: request.tool_choice }
                    : request.tool_choice,
              }),
        }),
      );
      const activeIterator = stream[Symbol.asyncIterator]();
      iterator = activeIterator;
      for (;;) {
        const result = await waitForChunk(activeIterator.next());
        if (result.done) break;
        for (const event of projection.accept(result.value, request.model)) {
          controller.signal.throwIfAborted();
          yield event;
        }
      }
      controller.signal.throwIfAborted();
      const response = projection.finish();
      controller.abort();
      yield { type: "message_stop", response };
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
