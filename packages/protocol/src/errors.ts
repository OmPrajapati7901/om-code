/**
 * ProtocolError variants and their human formatting (LRN-05).
 *
 * Mirrors packages/storage/src/config/errors.ts: every variant names what was
 * seen and what was expected. parseRecord returns these instead of throwing —
 * LRN-06's corrupt-tail repair (LR-FR-002) must keep reading past a bad
 * record, and a thrown error would make that control flow awkward at exactly
 * the point it matters.
 */

export type ProtocolErrorKind = "invalid-record" | "unknown-schema-version" | "invalid-entry";

export class ProtocolError extends Error {
  readonly kind: ProtocolErrorKind;

  constructor(kind: ProtocolErrorKind, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.kind = kind;
  }
}

export function invalidRecord(fieldPath: string, expected: string): ProtocolError {
  return new ProtocolError(
    "invalid-record",
    `om: invalid journal record: field "${fieldPath}" — expected ${expected}`,
  );
}

export function unknownSchemaVersion(
  kind: string,
  seen: number,
  supported: readonly number[],
): ProtocolError {
  return new ProtocolError(
    "unknown-schema-version",
    `om: unknown schemaVersion for entry kind "${kind}": saw ${seen}, supported: ${supported.join(", ")}`,
  );
}

export function invalidEntry(fieldPath: string, expected: string): ProtocolError {
  return new ProtocolError(
    "invalid-entry",
    `om: invalid journal entry: field "${fieldPath}" — expected ${expected}`,
  );
}

export function isProtocolError(error: unknown): error is ProtocolError {
  return error instanceof ProtocolError;
}
