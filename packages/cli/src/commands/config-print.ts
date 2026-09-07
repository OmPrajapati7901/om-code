/**
 * `om config print` (LRN-04, AC-4.2/AC-4.3; cap rows added in LRN-19).
 *
 * Renders an aligned three-column table (key, value, source). The credential
 * row prints the reference and a resolved/not-resolved marker — never the
 * secret. Unset optional caps render as `(missing)`; their effective defaults
 * live in `@om-code/context` (the bounding authority), not here.
 */

import type { ResolvedSettings, SettingKey } from "@om-code/storage";

const ROW_KEYS: readonly SettingKey[] = [
  "baseUrl",
  "model",
  "credential",
  "maxWallClockMs",
  "pricingInputPerMTok",
  "pricingOutputPerMTok",
];

function displayValueFor(key: SettingKey, resolved: ResolvedSettings): string {
  if (key === "credential") {
    const ref = resolved.credential.value ?? "(missing)";
    const marker = resolved.credential.secret.resolved ? "(resolved)" : "(not-resolved)";
    return `${ref} ${marker}`;
  }
  return resolved[key].value ?? "(missing)";
}

function sourceFor(key: SettingKey, resolved: ResolvedSettings): string {
  if (key === "credential") return resolved.credential.origin;
  return resolved[key].origin;
}

export function renderConfigTable(resolved: ResolvedSettings): string {
  const rows: Array<[string, string, string]> = ROW_KEYS.map((key) => [
    key,
    displayValueFor(key, resolved),
    sourceFor(key, resolved),
  ]);
  const keyWidth = Math.max("key".length, ...rows.map(([key]) => key.length));
  const valueWidth = Math.max("value".length, ...rows.map(([, value]) => value.length));
  const sourceWidth = Math.max("source".length, ...rows.map(([, , source]) => source.length));
  const header = `${"key".padEnd(keyWidth)}  ${"value".padEnd(valueWidth)}  ${"source".padEnd(sourceWidth)}`;
  const lines = rows.map(([key, value, source]) =>
    `${key.padEnd(keyWidth)}  ${value.padEnd(valueWidth)}  ${source.padEnd(sourceWidth)}`.trimEnd(),
  );
  return `${header}\n${lines.join("\n")}\n`;
}
