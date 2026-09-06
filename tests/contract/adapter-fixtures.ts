/** Synthetic scenarios shared by integration and the reusable contract. */
import { OpenAICompatibleProvider } from "@om-code/providers";
import type { ProviderScenario } from "./provider.js";

function event(delta: unknown, finish_reason: string | null = null) {
  return {
    id: "fixture-id",
    model: "fixture",
    choices: [{ index: 0, delta: { role: "assistant", ...(delta as object) }, finish_reason }],
  };
}
export function adapterFor(scenario: ProviderScenario): OpenAICompatibleProvider {
  const tool = (index: number, args = "{}") => ({
    index,
    id: `call_${index}`,
    function: { name: "read", arguments: args },
  });
  const events =
    scenario === "truncated"
      ? [event({ content: "partial" })]
      : scenario === "single-tool"
        ? [event({ tool_calls: [tool(0)] })]
        : scenario === "parallel-tools"
          ? [event({ tool_calls: [tool(0), tool(1)] })]
          : scenario === "malformed-arguments"
            ? [event({ tool_calls: [tool(0, "{'x':1,}")] })]
            : [event({ content: "hello" }), event({ content: " world" })];
  if (scenario !== "truncated") events.push(event({}, "stop"));
  const body =
    events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") +
    (scenario === "truncated" ? "" : "data: [DONE]\n\n");
  let attempt = 0;
  return new OpenAICompatibleProvider({
    baseUrl: "https://fixture.test/v1",
    fetchImpl: async () => {
      if (scenario === "rate-limit-then-success" && attempt++ === 0)
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
}
