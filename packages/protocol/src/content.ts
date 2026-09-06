import { z } from "zod";

export const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() }).strict();
export const thinkingBlockSchema = z
  .object({ type: z.literal("thinking"), text: z.string(), signature: z.string().optional() })
  .strict();
