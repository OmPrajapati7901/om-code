import type { ModelEvent, ModelRequest } from "@om-code/protocol";

export const request: ModelRequest = {
  model: "fixture-model",
  messages: [{ role: "user", content: "hello" }],
};
export function chunk(
  delta: unknown,
  finish_reason: string | null = null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "fixture-id",
    model: "fixture-model",
    choices: [{ index: 0, delta: { role: "assistant", ...(delta as object) }, finish_reason }],
    ...extra,
  };
}
export function wire(...events: unknown[]): string {
  return events
    .map((event) => `data: ${event === "[DONE]" ? event : JSON.stringify(event)}\n\n`)
    .join("");
}
export function response(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
export async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const result: ModelEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
