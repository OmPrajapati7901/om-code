/**
 * The journal envelope and kind/version dispatch (LRN-05, AC-5.5).
 *
 * Two version numbers, deliberately: the envelope's v (blueprint §7:300) is
 * the file format version — one number for the whole JSONL shape. Each entry
 * additionally carries schemaVersion (AC-5.4) so kinds evolve independently.
 *
 * Unlike LRN-04's read.ts, parseRecord returns a result instead of throwing:
 * storage needs to distinguish incompatible schemas from integrity failures.
 * LRN-06 stops on any invalid complete record; only an unterminated final
 * fragment may be repaired (LR-FR-002).
 *
 * Note for LRN-06: sha256 is computed over entry (blueprint §7:307), so the
 * journal hashes the canonical original entry, before this parser wraps an
 * unknown kind. LRN-06 defines the canonical encoding in storage.
 */

import { z } from "zod";
import { ENTRY_SCHEMAS, type Entry, type EntryKind } from "./entries.js";
import { invalidEntry, invalidRecord, type ProtocolError, unknownSchemaVersion } from "./errors.js";
import {
  actorSchema,
  recordIdSchema,
  seqSchema,
  sha256Schema,
  timestampSchema,
} from "./primitives.js";

export const ENVELOPE_VERSION = 1;

export const envelopeSchema = z
  .object({
    v: z.literal(ENVELOPE_VERSION),
    seq: seqSchema,
    id: recordIdSchema,
    ts: timestampSchema,
    by: actorSchema,
    turn_id: z.string().min(1).optional(),
    entry: z.unknown(),
    sha256: sha256Schema,
  })
  .strict();

export type Envelope = {
  readonly v: typeof ENVELOPE_VERSION;
  readonly seq: number;
  readonly id: string;
  readonly ts: string;
  readonly by: z.infer<typeof actorSchema>;
  readonly turn_id?: string | undefined;
  readonly entry: unknown;
  readonly sha256: string;
};

export type JournalRecord = Omit<Envelope, "entry"> & { readonly entry: Entry };

/**
 * A record whose entry kind is not in the registry. `raw` holds the object
 * as JSON.parse produced it, so key order is preserved and re-serialization
 * round-trips (AC-5.5).
 */
export type UnknownEntryRecord = Omit<Envelope, "entry"> & {
  readonly entry: UnknownEntry;
};

export type ReadableRecord = JournalRecord | UnknownEntryRecord;

export type UnknownEntry = {
  readonly kind: "unknown_entry";
  readonly original_kind: string;
  readonly schemaVersion: number;
  readonly raw: unknown;
};

export type ParseSuccess =
  | { readonly ok: true; readonly record: JournalRecord }
  | { readonly ok: true; readonly record: UnknownEntryRecord; readonly unknownEntry: true };

export type ParseFailure = { readonly ok: false; readonly error: ProtocolError };

export type ParseResult = ParseSuccess | ParseFailure;

function zodExpected(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `a ${issue.expected}`;
    case "unrecognized_keys":
      return `no unknown keys (got ${(issue.keys ?? []).join(", ")})`;
    case "invalid_value":
      return `one of ${(issue.values ?? []).map((value) => JSON.stringify(value)).join(", ")}`;
    case "invalid_format":
      return `a valid ${issue.format}`;
    default:
      return "a valid value for this field";
  }
}

function zodFieldPath(issue: z.core.$ZodIssue): string {
  const path = (issue.path ?? []).map((segment) => String(segment)).join(".");
  return path.length > 0 ? path : "(root)";
}

function firstIssue(error: z.ZodError): { path: string; expected: string } {
  const issue = error.issues[0];
  if (issue === undefined) {
    return { path: "(root)", expected: "a valid value" };
  }
  return { path: zodFieldPath(issue), expected: zodExpected(issue) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRecord(input: unknown): ParseResult {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) {
    const { path, expected } = firstIssue(envelope.error);
    return { ok: false, error: invalidRecord(path, expected) };
  }
  const { entry: rawEntry, ...rest } = envelope.data;

  if (!isObject(rawEntry)) {
    return { ok: false, error: invalidEntry("entry", "an object with kind and schemaVersion") };
  }
  const { kind, schemaVersion } = rawEntry;
  if (typeof kind !== "string" || typeof schemaVersion !== "number") {
    return { ok: false, error: invalidEntry("entry", "an object with kind and schemaVersion") };
  }

  if (!Object.hasOwn(ENTRY_SCHEMAS, kind)) {
    const preserved: UnknownEntryRecord = {
      ...rest,
      entry: {
        kind: "unknown_entry",
        original_kind: kind,
        schemaVersion,
        raw: rawEntry,
      },
    };
    return { ok: true, record: preserved, unknownEntry: true };
  }

  const versions = ENTRY_SCHEMAS[kind as EntryKind];
  const schema = versions.get(schemaVersion);
  if (schema === undefined) {
    return {
      ok: false,
      error: unknownSchemaVersion(kind, schemaVersion, [...versions.keys()]),
    };
  }
  const parsed = schema.safeParse(rawEntry);
  if (!parsed.success) {
    const { path, expected } = firstIssue(parsed.error as z.ZodError);
    return { ok: false, error: invalidEntry(path, expected) };
  }
  return { ok: true, record: { ...rest, entry: parsed.data as Entry } };
}
