/**
 * AC-8.1 reuse seam: scenario factories map to an adapter's fake fetch or a
 * future fake provider's own script. Assertions concern public events only;
 * HTTP attempt counts/backoff remain adapter-local tests (AC-7.6).
 */
import type { ModelEvent, ModelProvider, ModelRequest } from "@om-code/protocol";
import { describe, expect, it } from "vitest";

export type ProviderScenario =
  | "text"
  | "single-tool"
  | "parallel-tools"
  | "malformed-arguments"
  | "truncated"
  | "rate-limit-then-success";
export const contractRequest: ModelRequest = {
  model: "fixture",
  messages: [{ role: "user", content: "test" }],
};
export function providerContract(
  name: string,
  makeProvider: (scenario: ProviderScenario) => ModelProvider,
): void {
  describe(`${name} shared ModelProvider contract`, () => {
    it.each<ProviderScenario>([
      "text",
      "single-tool",
      "parallel-tools",
      "malformed-arguments",
      "truncated",
      "rate-limit-then-success",
    ])("%s", async (scenario) => {
      const events: ModelEvent[] = [];
      const run = async () => {
        for await (const event of makeProvider(scenario).stream(
          contractRequest,
          new AbortController().signal,
        ))
          events.push(event);
      };
      if (scenario === "truncated") {
        await expect(run()).rejects.toMatchObject({
          kind: "disconnected",
          partial: {
            content: [{ type: "text", text: "partial" }],
            outcome: { kind: "interrupted" },
          },
        });
        expect(events.some((event) => event.type === "message_stop")).toBe(false);
      } else {
        await run();
        expect(events[0]?.type).toBe("message_start");
        const stops = events.filter((event) => event.type === "message_stop");
        expect(stops).toHaveLength(1);
        const response = stops[0]?.response;
        expect(response?.outcome.kind).toBe("complete");
        expect(response?.tool_calls).toHaveLength(
          scenario === "parallel-tools"
            ? 2
            : scenario === "single-tool" || scenario === "malformed-arguments"
              ? 1
              : 0,
        );
        if (scenario === "malformed-arguments")
          expect(response?.tool_calls[0]?.arguments_raw).toBe("{'x':1,}");
        if (scenario === "text")
          expect(
            events.filter((event) => event.type === "text_delta").map((event) => event.text),
          ).toEqual(["hello", " world"]);
      }
    });
  });
}
