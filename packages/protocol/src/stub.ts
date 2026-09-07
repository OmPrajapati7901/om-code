/**
 * Stub RPC wire data types (LRN-12, blueprint §8.2).
 *
 * Every request carries the shared envelope `{maxBytes, maxMs, cwd,
 * envAllowlist, capability}`; every response ends with a terminal frame
 * `{status, bytes, truncated, elapsedMs}`. Per-method params schemas extend
 * the envelope so AC-12.2 holds by construction rather than by nine copied
 * field lists.
 *
 * Field naming: the stub RPC envelope and frame are camelCase per blueprint
 * §8.2 (`maxBytes`, `maxMs`, `elapsedMs`). This scopes AGENTS.md's
 * snake_case rule to the journal, which mirrors Rust DTOs in M4.
 *
 * Streaming methods (`read`, `exec`, `shell`, `grep`) resolve to an async
 * iterable whose last event carries the terminal frame — mirroring
 * ModelEvent's `{ type: "message_stop"; response }` in model.ts. Events
 * carrying bytes are TypeScript types only (Uint8Array has no JSON wire
 * form); everything JSON-serializable has a Zod schema, the `z.toJSONSchema()`
 * source for the Rust mirror (AC-30.4).
 */

import { z } from "zod";
import { capabilityRequestSchema } from "./capability.js";

export const stubEnvelopeSchema = z
  .object({
    maxBytes: z.number().int().positive(),
    maxMs: z.number().int().positive(),
    cwd: z.string().min(1),
    envAllowlist: z.array(z.string()),
    capability: capabilityRequestSchema,
  })
  .strict();

export type StubEnvelope = z.infer<typeof stubEnvelopeSchema>;

export const stubFrameSchema = z
  .object({
    status: z.enum(["ok", "failed", "timeout", "denied"]),
    bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    elapsedMs: z.number().int().nonnegative(),
    failure: z
      .object({ kind: z.string().min(1), message: z.string() })
      .strict()
      .optional(),
  })
  .strict();

export type StubFrame = z.infer<typeof stubFrameSchema>;

export const stubEntrySchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(["file", "dir", "symlink", "other"]),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export type StubEntry = z.infer<typeof stubEntrySchema>;

export const grepSubmatchSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();

export type GrepSubmatch = z.infer<typeof grepSubmatchSchema>;

export const grepMatchSchema = z
  .object({
    path: z.string().min(1),
    lineNumber: z.number().int().positive(),
    byteOffset: z.number().int().nonnegative(),
    line: z.string(),
    submatches: z.array(grepSubmatchSchema),
  })
  .strict();

export type GrepMatch = z.infer<typeof grepMatchSchema>;

export const healthParamsSchema = stubEnvelopeSchema.extend({});

export type HealthParams = z.infer<typeof healthParamsSchema>;

export const readParamsSchema = stubEnvelopeSchema.extend({
  path: z.string().min(1),
  range: z
    .object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() })
    .strict()
    .optional(),
});

export type ReadParams = z.infer<typeof readParamsSchema>;

export const writeParamsSchema = stubEnvelopeSchema.extend({
  path: z.string().min(1),
  contents: z.string(),
  mode: z.number().int().nonnegative().optional(),
  createOnly: z.boolean().optional(),
});

export type WriteParams = z.infer<typeof writeParamsSchema>;

export const statParamsSchema = stubEnvelopeSchema.extend({
  path: z.string().min(1),
});

export type StatParams = z.infer<typeof statParamsSchema>;

export const globParamsSchema = stubEnvelopeSchema.extend({
  pattern: z.string().min(1),
  root: z.string().min(1).optional(),
  includeIgnored: z.boolean().optional(),
});

export type GlobParams = z.infer<typeof globParamsSchema>;

export const grepParamsSchema = stubEnvelopeSchema.extend({
  pattern: z.string().min(1),
  root: z.string().min(1).optional(),
  globs: z.array(z.string().min(1)).optional(),
  caseInsensitive: z.boolean().optional(),
  maxMatchesPerFile: z.number().int().positive().optional(),
});

export type GrepParams = z.infer<typeof grepParamsSchema>;

export const execParamsSchema = stubEnvelopeSchema.extend({
  program: z.string().min(1),
  argv: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
});

export type ExecParams = z.infer<typeof execParamsSchema>;

export const plannedSubcommandSchema = z
  .object({
    program: z.string().min(1),
    argv: z.array(z.string()),
  })
  .strict();

export type PlannedSubcommand = z.infer<typeof plannedSubcommandSchema>;

export const shellParamsSchema = stubEnvelopeSchema.extend({
  command: z.string().min(1),
  plannedSubcommands: z.array(plannedSubcommandSchema),
});

export type ShellParams = z.infer<typeof shellParamsSchema>;

export const batchOpSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("health"), params: healthParamsSchema }).strict(),
  z.object({ method: z.literal("write"), params: writeParamsSchema }).strict(),
  z.object({ method: z.literal("stat"), params: statParamsSchema }).strict(),
  z.object({ method: z.literal("glob"), params: globParamsSchema }).strict(),
]);

export type BatchOp = z.infer<typeof batchOpSchema>;

export const batchParamsSchema = stubEnvelopeSchema.extend({
  ops: z.array(batchOpSchema),
});

export type BatchParams = z.infer<typeof batchParamsSchema>;

export const healthResultSchema = stubFrameSchema.extend({
  version: z.string().min(1),
  protocolVersion: z.number().int().nonnegative(),
  sandboxProfile: z.string().nullable(),
  enforcement: z.enum(["enforced", "unenforced", "unknown"]),
});

export type HealthResult = z.infer<typeof healthResultSchema>;

export const writeResultSchema = stubFrameSchema.extend({
  path: z.string().min(1),
  bytesWritten: z.number().int().nonnegative(),
});

export type WriteResult = z.infer<typeof writeResultSchema>;

export const statResultSchema = stubFrameSchema.extend({
  entry: stubEntrySchema.nullable(),
});

export type StatResult = z.infer<typeof statResultSchema>;

export const globResultSchema = stubFrameSchema.extend({
  paths: z.array(z.string()),
});

export type GlobResult = z.infer<typeof globResultSchema>;

export const batchResultSchema = stubFrameSchema.extend({
  results: z.array(stubFrameSchema),
  failedAt: z.number().int().nonnegative().optional(),
});

export type BatchResult = z.infer<typeof batchResultSchema>;

export const execFrameSchema = stubFrameSchema.extend({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export type ExecFrame = z.infer<typeof execFrameSchema>;

export type ReadEvent = { type: "chunk"; bytes: Uint8Array } | { type: "end"; frame: StubFrame };

export type ExecEvent =
  | { type: "stdout"; bytes: Uint8Array }
  | { type: "stderr"; bytes: Uint8Array }
  | { type: "end"; frame: ExecFrame };

export type GrepEvent = { type: "match"; match: GrepMatch } | { type: "end"; frame: StubFrame };
