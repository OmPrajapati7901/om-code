/**
 * The settings declaration registry (LRN-04).
 *
 * Settings are declared once, as records of (key, envVar, flag, parse,
 * describe, required, default). The loader, the CLI flag parser and the
 * config-print renderer all iterate this registry, so adding a setting later
 * is one entry, not four edits.
 *
 * Keep it small: baseUrl, model, credential. Turn/cost caps arrive with the
 * kernel; nothing else is added here.
 */

import { inspect } from "node:util";
import { invalidValue } from "./errors.js";

export type SettingKey = "baseUrl" | "model" | "credential";

export type ConfigFlags = {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly credential?: string;
};

export type CredentialKind = "env" | "keychain";

export type CredentialReference =
  | { readonly kind: "env"; readonly variable: string; readonly raw: string }
  | {
      readonly kind: "keychain";
      readonly service: string;
      readonly account: string;
      readonly raw: string;
    };

const ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseCredentialReference(raw: string, source: string): CredentialReference {
  const colon = raw.indexOf(":");
  if (colon <= 0) {
    throw invalidValue(source, "credential", '"env:<VAR>" or "keychain:<service>/<account>"');
  }
  const scheme = raw.slice(0, colon);
  const rest = raw.slice(colon + 1);
  if (scheme === "env") {
    if (rest.length === 0 || !ENV_VAR_PATTERN.test(rest)) {
      throw invalidValue(source, "credential", '"env:<VAR>" or "keychain:<service>/<account>"');
    }
    return { kind: "env", variable: rest, raw };
  }
  if (scheme === "keychain") {
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) {
      throw invalidValue(source, "credential", '"env:<VAR>" or "keychain:<service>/<account>"');
    }
    const service = rest.slice(0, slash);
    const account = rest.slice(slash + 1);
    if (service.length === 0 || account.length === 0 || account.includes("/")) {
      throw invalidValue(source, "credential", '"env:<VAR>" or "keychain:<service>/<account>"');
    }
    return { kind: "keychain", service, account, raw };
  }
  throw invalidValue(source, "credential", '"env:<VAR>" or "keychain:<service>/<account>"');
}

export function parseBaseUrl(raw: string, source: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidValue(source, "baseUrl", "an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidValue(source, "baseUrl", "an absolute http(s) URL");
  }
  return raw;
}

export function parseModel(raw: string, source: string): string {
  if (raw.trim().length === 0) {
    throw invalidValue(source, "model", "a non-empty string");
  }
  return raw;
}

export type SettingDefinition = {
  readonly key: SettingKey;
  readonly envVar: string;
  readonly flag: string;
  readonly required: boolean;
  readonly description: string;
  readonly default?: string;
  readonly parse: (raw: string, source: string) => string;
  readonly validateReference?: (raw: string, source: string) => void;
};

function parseCredentialAsString(raw: string, source: string): string {
  parseCredentialReference(raw, source);
  return raw;
}

export const SETTINGS: readonly SettingDefinition[] = [
  {
    key: "baseUrl",
    envVar: "OM_BASE_URL",
    flag: "--base-url",
    required: true,
    description: "OpenAI-compatible endpoint base URL (absolute http/https URL)",
    parse: parseBaseUrl,
  },
  {
    key: "model",
    envVar: "OM_MODEL",
    flag: "--model",
    required: true,
    description: "model id (non-empty)",
    parse: parseModel,
  },
  {
    key: "credential",
    envVar: "OM_CREDENTIAL",
    flag: "--credential",
    required: false,
    description: 'credential reference ("env:<VAR>" or "keychain:<service>/<account>")',
    default: "env:OM_API_KEY",
    parse: parseCredentialAsString,
  },
];

export function settingFor(key: SettingKey): SettingDefinition {
  const found = SETTINGS.find((entry) => entry.key === key);
  if (found === undefined) {
    throw new Error(`unknown setting "${key}"`);
  }
  return found;
}

/**
 * The secret itself, resolved on demand. The reference string is the only
 * credential-shaped thing that ever appears in a file, a flag, a log line or
 * config-print output. Every stringification of this wrapper renders
 * «redacted» so a stray log can never carry key material.
 */
export class CredentialSecret {
  private readonly secretValue: string | undefined;
  readonly reference: string;

  constructor(reference: string, secret: string | undefined) {
    this.reference = reference;
    this.secretValue = secret && secret.length > 0 ? secret : undefined;
  }

  /** The only accessor that returns key material. Never log its result. */
  unwrap(): string | undefined {
    return this.secretValue;
  }

  get resolved(): boolean {
    return this.secretValue !== undefined;
  }

  toString(): string {
    return "«redacted»";
  }

  toJSON(): string {
    return "«redacted»";
  }

  [inspect.custom](): string {
    return "«redacted»";
  }
}
