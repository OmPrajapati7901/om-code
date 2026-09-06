/**
 * SessionMeta and ModelRef (LRN-05).
 *
 * SessionMeta.mode keeps all five values — plan | manual | accept_edits |
 * auto | bypass — even though this release's CLI can set only two of them. A
 * journal written today stays readable when the remaining modes arrive,
 * rather than needing a schema bump to record them. This release's CLI maps
 * --mode read_only to plan and --mode manual to manual (a note for LRN-11).
 *
 * ModelRef matches LRN-04's resolved settings ({ id, base_url }). The
 * credential reference is deliberately excluded: the journal is a file we
 * write, so LR-FR-030 applies to it directly, and entry strictness makes a
 * credential key a parse failure.
 */

import { z } from "zod";
import { timestampSchema } from "./primitives.js";

export const modelRefSchema = z
  .object({
    id: z.string().min(1),
    base_url: z.string().min(1),
  })
  .strict();

export type ModelRef = z.infer<typeof modelRefSchema>;

export const sessionModeSchema = z.enum(["plan", "manual", "accept_edits", "auto", "bypass"]);

export type SessionMode = z.infer<typeof sessionModeSchema>;

export const sessionStatusSchema = z.enum(["active", "idle", "ended"]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionMetaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    project_root: z.string().min(1),
    cwd: z.string().min(1),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    status: sessionStatusSchema,
    mode: sessionModeSchema,
    model: modelRefSchema,
    sandbox_profile: z.string().min(1).optional(),
    tags: z.array(z.string()),
  })
  .strict();

export type SessionMeta = z.infer<typeof sessionMetaSchema>;
