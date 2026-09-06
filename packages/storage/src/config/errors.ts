/**
 * ConfigError variants and their human formatting (LRN-04, AC-4.4).
 *
 * Every variant formats as a single message naming the file (or env var, or
 * flag), the field, and what was expected. The CLI catches ConfigError
 * explicitly so a stack trace never reaches the user.
 */

export type ConfigErrorKind =
  | "unreadable-file"
  | "invalid-json"
  | "invalid-field"
  | "invalid-value"
  | "incomplete";

export class ConfigError extends Error {
  readonly kind: ConfigErrorKind;

  constructor(kind: ConfigErrorKind, message: string) {
    super(message);
    this.name = "ConfigError";
    this.kind = kind;
  }
}

export function unreadableFile(path: string, detail: string): ConfigError {
  return new ConfigError("unreadable-file", `om: cannot read config file ${path}: ${detail}`);
}

export function invalidJson(
  path: string,
  line: number,
  column: number,
  detail: string,
): ConfigError {
  return new ConfigError(
    "invalid-json",
    `om: invalid JSON in ${path} at ${line}:${column}: ${detail}`,
  );
}

export function invalidField(pathOrSource: string, field: string, expected: string): ConfigError {
  return new ConfigError(
    "invalid-field",
    `om: invalid config in ${pathOrSource}: field "${field}" — expected ${expected}`,
  );
}

export function invalidValue(source: string, field: string, expected: string): ConfigError {
  return new ConfigError(
    "invalid-value",
    `om: invalid value for "${field}" from ${source}: expected ${expected}`,
  );
}

export function incompleteConfig(missing: readonly string[], remediation: string): ConfigError {
  return new ConfigError(
    "incomplete",
    `om: missing required config: ${missing.join(", ")}\n${remediation}`,
  );
}

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError;
}
