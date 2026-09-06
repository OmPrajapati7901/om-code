/**
 * Shared primitives (LRN-05).
 *
 * Usage is a tagged union — { kind: "known"; … } | { kind: "unknown" } — so
 * LRN-07b's "never zero, never estimated" is a type error rather than a code
 * review. ToolStatus is the result-terminal set: call lifecycle stays in
 * memory until LRN-17 needs it durable.
 */

import { z } from "zod";

export const usageKnownSchema = z
  .object({
    kind: z.literal("known"),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const usageUnknownSchema = z
  .object({
    kind: z.literal("unknown"),
  })
  .strict();

export const usageSchema = z.union([usageKnownSchema, usageUnknownSchema]);

export type Usage = z.infer<typeof usageSchema>;

export const toolStatusSchema = z.enum([
  "ok",
  "error",
  "denied",
  "cancelled",
  "timeout",
  "unknown",
]);

export type ToolStatus = z.infer<typeof toolStatusSchema>;

/** Record id: UUIDv7 (blueprint §7: `id`). */
export const recordIdSchema = z.uuidv7();

/** Record timestamp: RFC 3339 UTC (blueprint §7: `ts`). */
export const timestampSchema = z.iso.datetime();

/**
 * The `by` actor (blueprint §7:304). A regex union is preferred over
 * z.templateLiteral so a bad value gets a legible error message.
 */
export const actorSchema = z.union([
  z.enum(["user", "model", "system"]),
  z.string().regex(/^tool:[^\s]+$/, 'a tool actor like "tool:<name>"'),
]);

export type Actor = z.infer<typeof actorSchema>;

/** sha256 hex digest carried on every record (blueprint §7:307). */
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "a 64-char lowercase hex sha256");

/** Journal sequence number: strictly increasing, starting at 1 (LR-FR-002). */
export const seqSchema = z.number().int().positive();
