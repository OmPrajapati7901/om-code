/**
 * PURE precedence resolution (LRN-04, AC-4.1/AC-4.2/AC-4.6).
 *
 * resolve.ts takes already-read documents and a plain env record, so
 * precedence has no filesystem in its tests. Order:
 * flags > env > project file > user file > defaults.
 *
 * AC-4.1's four tiers are preserved as a subsequence; env is inserted where
 * LR-FR-036 requires it to be useful.
 */

import type { TierDocument } from "./read.js";
import { type ConfigFlags, CredentialSecret, SETTINGS, type SettingKey } from "./settings.js";

export type Tier = "flag" | "env" | "project" | "user" | "default";

export type ResolvedEntry = {
  readonly value: string | undefined;
  readonly tier: Tier;
  /** "--model" | "OM_MODEL" | "<abs path>" | "default" */
  readonly origin: string;
};

export type ResolvedSettings = {
  readonly baseUrl: ResolvedEntry;
  readonly model: ResolvedEntry;
  readonly credential: ResolvedEntry & { readonly secret: CredentialSecret };
};

export type ResolveInput = {
  readonly user?: TierDocument | undefined;
  readonly project?: TierDocument | undefined;
  readonly userPath: string;
  readonly projectPath: string;
  readonly env: Record<string, string | undefined>;
  readonly flags: ConfigFlags;
  readonly resolveSecret: (reference: string) => string | undefined;
};

function pickRaw(
  key: SettingKey,
  envVar: string,
  input: ResolveInput,
): { raw: string | undefined; tier: Tier; origin: string } {
  const flagValue = input.flags[key];
  if (flagValue !== undefined) {
    return { raw: flagValue, tier: "flag", origin: flagNameFor(key) };
  }
  const envValue = input.env[envVar];
  if (envValue !== undefined) {
    return { raw: envValue, tier: "env", origin: envVar };
  }
  const projectValue = input.project?.[key];
  if (projectValue !== undefined) {
    return { raw: projectValue, tier: "project", origin: input.projectPath };
  }
  const userValue = input.user?.[key];
  if (userValue !== undefined) {
    return { raw: userValue, tier: "user", origin: input.userPath };
  }
  return { raw: undefined, tier: "default", origin: "default" };
}

function flagNameFor(key: SettingKey): string {
  const found = SETTINGS.find((entry) => entry.key === key);
  return found?.flag ?? `--${key}`;
}

export function resolveSettings(input: ResolveInput): ResolvedSettings {
  const entries = {} as Record<SettingKey, ResolvedEntry>;
  for (const setting of SETTINGS) {
    const picked = pickRaw(setting.key, setting.envVar, input);
    const raw = picked.raw ?? setting.default;
    if (raw === undefined) {
      entries[setting.key] = { value: undefined, tier: picked.tier, origin: picked.origin };
      continue;
    }
    const tier: Tier = picked.raw !== undefined ? picked.tier : "default";
    const origin = picked.raw !== undefined ? picked.origin : "default";
    // Validation: throws ConfigError naming the origin on bad values.
    setting.parse(raw, origin);
    entries[setting.key] = { value: raw, tier, origin };
  }
  const credentialRef = entries.credential.value ?? "env:OM_API_KEY";
  const credentialEntry = entries.credential;
  const secret = input.resolveSecret(credentialRef);
  return {
    baseUrl: entries.baseUrl,
    model: entries.model,
    credential: {
      value: credentialRef,
      tier: credentialEntry.tier,
      origin: credentialEntry.origin,
      secret: new CredentialSecret(credentialRef, secret),
    },
  };
}
