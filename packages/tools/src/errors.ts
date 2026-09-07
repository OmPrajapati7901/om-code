/**
 * Tool failures (LRN-16, AC-16.3–16.4).
 *
 * Follows the `StubError` idiom exactly: a `Kind` union, an `Error` subclass
 * carrying it, and an `is*` guard. The `details` bag carries structured
 * diagnostics, never journal or file content.
 */

export type ToolErrorKind = "duplicate-name" | "not-in-roster" | "invalid-input";

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    kind: ToolErrorKind,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`om: ${message}`);
    this.name = "ToolError";
    this.kind = kind;
    this.details = details;
  }
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}
