import type { StubFrame } from "@om-code/protocol";
import { expect, it } from "vitest";
import { endEvent } from "../src/result.js";

it("maps every stub status and copies byte accounting verbatim", () => {
  for (const [status, expected] of [
    ["ok", "ok"],
    ["failed", "error"],
    ["timeout", "timeout"],
    ["denied", "denied"],
  ] as const) {
    const frame: StubFrame = { status, bytes: 17, truncated: true, elapsedMs: 9 };
    expect(endEvent(frame, "rendered")).toEqual({
      type: "end",
      result: { status: expected, preview: "rendered", bytes: 17, truncated: true },
    });
  }
});
