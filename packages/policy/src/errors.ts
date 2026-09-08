/**
 * Policy failures (LRN-21b).
 *
 * Follows the `StubError`/`ToolError` idiom: a `Kind` union, an `Error`
 * subclass carrying it, and an `is*` guard. Messages name the problem, never
 * rule content.
 */

export type PolicyErrorKind = "invalid-rules";

export class PolicyError extends Error {
  readonly kind: PolicyErrorKind;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    kind: PolicyErrorKind,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`om: ${message}`);
    this.name = "PolicyError";
    this.kind = kind;
    this.details = details;
  }
}

export function isPolicyError(error: unknown): error is PolicyError {
  return error instanceof PolicyError;
}
