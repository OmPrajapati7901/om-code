import { type CapabilityRequest, capabilityRequestSchema } from "@om-code/protocol";
import { expect, it } from "vitest";
import { readOnlyTools, type ToolIo } from "../src/index.js";
import { collect, context, fakeIo, globResult, grepEvents, readEvents } from "./fixtures.js";

const inputs = {
  read: { path: "src/main.ts", startLine: 2, endLine: 3 },
  grep: { pattern: "needle", root: "src" },
  glob: { pattern: "**/*.ts", root: "packages" },
} as const;

it("every read-only tool plans filesystem reads with no write or process capability", async () => {
  for (const tool of readOnlyTools()) {
    const input = inputs[tool.descriptor().name as keyof typeof inputs];
    const capability = await tool.plan(input, context());
    expect(capabilityRequestSchema.parse(capability)).toEqual(capability);
    expect(capability.risk_class).toBe("read");
    expect(capability.filesystem?.write).toEqual([]);
    expect(Object.hasOwn(capability, "process")).toBe(false);
    expect(Object.hasOwn(capability, "network")).toBe(false);
  }
});

it("execute sends exactly the planned capability through ToolIo", async () => {
  for (const tool of readOnlyTools()) {
    const input = inputs[tool.descriptor().name as keyof typeof inputs];
    const planned = await tool.plan(input, context());
    let received: CapabilityRequest | undefined;
    const capture = (capability: CapabilityRequest): void => {
      received = capability;
    };
    const io: ToolIo = fakeIo({
      read: (params) => {
        capture(params.capability);
        return readEvents([], { totalLines: 0 });
      },
      grep: (params) => {
        capture(params.capability);
        return grepEvents([
          {
            type: "end",
            frame: { status: "ok", bytes: 0, truncated: false, elapsedMs: 0 },
          },
        ]);
      },
      glob: (params) => {
        capture(params.capability);
        return Promise.resolve(globResult());
      },
    });
    await collect(tool.execute(input, io, context()));
    expect(received).toEqual(planned);
  }
});
