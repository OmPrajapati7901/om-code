/** Scenario -> FakeProvider mapping, mirroring adapter-fixtures.ts (AC-8.1). */
import { FakeProvider, type FakeScript } from "@om-code/providers";
import type { ProviderScenario } from "./provider.js";

function tool(index: number, args = "{}") {
  return {
    tool: { index, call_id: `call_${index}`, name: "read", arguments: args },
  } as const;
}

export function fakeFor(scenario: ProviderScenario): FakeProvider {
  const scripts: Record<ProviderScenario, FakeScript> = {
    text: { turns: [{ kind: "stream", deltas: [{ text: "hello" }, { text: " world" }] }] },
    "single-tool": { turns: [{ kind: "stream", deltas: [tool(0)] }] },
    "parallel-tools": { turns: [{ kind: "stream", deltas: [tool(0), tool(1)] }] },
    "malformed-arguments": { turns: [{ kind: "stream", deltas: [tool(0, "{'x':1,}")] }] },
    truncated: {
      turns: [{ kind: "stream", deltas: [{ text: "partial" }], interrupt: "disconnected" }],
    },
    "rate-limit-then-success": {
      turns: [
        [
          { kind: "http-error", status: 429 },
          { kind: "stream", deltas: [{ text: "ok" }] },
        ],
      ],
    },
  };
  return new FakeProvider(scripts[scenario]);
}
