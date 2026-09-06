/** Storage failures carry structured diagnostics; never embed journal content. */
export type JournalErrorKind =
  | "locked"
  | "invalid-id"
  | "invalid-value"
  | "unsafe-path"
  | "unreadable"
  | "corrupt-record"
  | "seq-gap"
  | "seq-regression"
  | "incompatible"
  | "write-failed"
  | "closed";

export class JournalError extends Error {
  readonly kind: JournalErrorKind;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    kind: JournalErrorKind,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`om: ${message}`);
    this.name = "JournalError";
    this.kind = kind;
    this.details = details;
  }
}

export function isJournalError(error: unknown): error is JournalError {
  return error instanceof JournalError;
}
