/**
 * loadSettings + requireComplete (LRN-04, AC-4.5).
 *
 * loadSettings is the one loader: it reads the user and project tier files
 * (absent tiers are undefined), resolves precedence purely, and resolves the
 * credential secret on demand. It writes zero bytes to disk.
 *
 * requireComplete is the shared guard LRN-11 calls before its first
 * inference: it returns runtime settings or a ConfigError naming every
 * missing required key with remediation text.
 */

import { type KeychainRunner, resolveCredentialSecret } from "./credential.js";
import { incompleteConfig, invalidValue } from "./errors.js";
import { resolveConfigPaths } from "./paths.js";
import { type FileReader, readTierFile } from "./read.js";
import { type ResolvedSettings, resolveSettings } from "./resolve.js";
import type { ConfigFlags, CredentialSecret } from "./settings.js";

export type LoadSettingsOptions = {
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly flags?: ConfigFlags;
  readonly readFile?: FileReader;
  readonly runKeychain?: KeychainRunner;
};

export type RuntimeSettings = {
  readonly baseUrl: string;
  readonly model: string;
  readonly credential: CredentialSecret;
  readonly credentialReference: string;
  /** Milliseconds per agent run; `undefined` selects context's default. */
  readonly maxWallClockMs: number | undefined;
  /** Both halves or neither; a half-configured pair is a config error. */
  readonly pricing: { readonly inputPerMTok: number; readonly outputPerMTok: number } | undefined;
};

export function loadSettings(options: LoadSettingsOptions = {}): ResolvedSettings {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const paths = resolveConfigPaths(env, cwd);
  const user = readTierFile(paths.userFile, options.readFile);
  const project = readTierFile(paths.projectFile, options.readFile);
  return resolveSettings({
    user,
    project,
    userPath: paths.userFile,
    projectPath: paths.projectFile,
    env,
    flags: options.flags ?? {},
    resolveSecret: (reference) => resolveCredentialSecret(reference, env, options.runKeychain),
  });
}

export function requireComplete(
  resolved: ResolvedSettings,
  userFile = "~/.om-code/config.json",
): RuntimeSettings {
  const missing: string[] = [];
  if (resolved.baseUrl.value === undefined) {
    missing.push("baseUrl");
  }
  if (resolved.model.value === undefined) {
    missing.push("model");
  }
  if (missing.length > 0) {
    throw incompleteConfig(
      missing,
      `Add the missing keys to ${userFile} (or set the matching env vars / flags):\n` +
        `{\n  "baseUrl": "https://<your-endpoint>/openai/v1",\n  "model": "<your-model-id>"\n}`,
    );
  }
  const baseUrl = resolved.baseUrl.value as string;
  const model = resolved.model.value as string;
  const maxWallClockMs =
    resolved.maxWallClockMs.value === undefined ? undefined : Number(resolved.maxWallClockMs.value);
  const inputPrice = resolved.pricingInputPerMTok.value;
  const outputPrice = resolved.pricingOutputPerMTok.value;
  if ((inputPrice === undefined) !== (outputPrice === undefined)) {
    const missing = inputPrice === undefined ? "pricingInputPerMTok" : "pricingOutputPerMTok";
    const present =
      inputPrice === undefined ? resolved.pricingOutputPerMTok : resolved.pricingInputPerMTok;
    throw invalidValue(
      present.origin,
      missing,
      "both pricingInputPerMTok and pricingOutputPerMTok together (a half-configured pair cannot price usage)",
    );
  }
  return {
    baseUrl,
    model,
    credential: resolved.credential.secret,
    credentialReference: resolved.credential.value as string,
    maxWallClockMs,
    pricing:
      inputPrice === undefined || outputPrice === undefined
        ? undefined
        : { inputPerMTok: Number(inputPrice), outputPerMTok: Number(outputPrice) },
  };
}
