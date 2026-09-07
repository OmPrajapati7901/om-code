/**
 * Stub failures (LRN-12, AC-12.4, AC-12.6).
 *
 * Follows the `ProtocolError` / `ProviderError` / `JournalError` idiom: a
 * `Kind` union, an `Error` subclass carrying it, and an `is*` guard. The
 * `details` bag mirrors `storage/src/journal/errors.ts` — structured
 * diagnostics, never journal or file content.
 */

export type StubErrorKind =
  | "not-implemented"
  | "unsupported-pattern"
  | "path-escape"
  | "budget-exceeded"
  | "timeout"
  | "denied"
  | "io";

export class StubError extends Error {
  readonly kind: StubErrorKind;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    kind: StubErrorKind,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`om: ${message}`);
    this.name = "StubError";
    this.kind = kind;
    this.details = details;
  }
}

export function isStubError(error: unknown): error is StubError {
  return error instanceof StubError;
}

export type NotImplementedMethod = "write" | "shell" | "batch";

const NOT_IMPLEMENTED_UNTIL: Record<NotImplementedMethod, string> = {
  write: "M3 (LRN-26)",
  shell: "M3 (LRN-27)",
  batch: "M3",
};

/**
 * AC-12.4: the three M3 methods are present in the type from now on; drivers
 * that cannot implement them yet throw this — naming the milestone that
 * delivers them — instead of omitting the method. The parameter type is the
 * three pending methods only, so calling it for `read` does not compile.
 */
export function notImplemented(method: NotImplementedMethod): never {
  throw new StubError(
    "not-implemented",
    `stub method "${method}" is not implemented until ${NOT_IMPLEMENTED_UNTIL[method]}`,
    { method },
  );
}
