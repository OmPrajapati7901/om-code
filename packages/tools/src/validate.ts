import type { z } from "zod";
import { ToolError } from "./errors.js";

export function parseInput<T>(schema: z.ZodType<T>, toolName: string, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new ToolError("invalid-input", `invalid input for ${toolName}`, {
    tool: toolName,
    issues: parsed.error.issues,
  });
}
