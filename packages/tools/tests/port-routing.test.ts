import { expect, it } from "vitest";
import { readOnlyTools } from "../src/index.js";
import { collect, context, throwingIo } from "./fixtures.js";

const inputs = {
  read: { path: "a.txt" },
  grep: { pattern: "needle" },
  glob: { pattern: "**/*.ts" },
} as const;

it("surfaces the identical ToolIo error without a direct-I/O fallback", async () => {
  for (const tool of readOnlyTools()) {
    const sentinel = { tool: tool.descriptor().name };
    const input = inputs[tool.descriptor().name as keyof typeof inputs];
    let caught: unknown;
    try {
      await collect(tool.execute(input, throwingIo(sentinel), context()));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(sentinel);
  }
});
