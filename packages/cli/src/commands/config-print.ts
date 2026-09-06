/**
 * `om config print` (LRN-04, AC-4.2/AC-4.3).
 *
 * Renders an aligned three-column table (key, value, source). The credential
 * row prints the reference and a resolved/not-resolved marker — never the
 * secret.
 */

import type { ResolvedSettings } from "@om-code/storage";

function displayValueFor(key: string, resolved: ResolvedSettings): string {
  if (key === "baseUrl") {
    return resolved.baseUrl.value ?? "(missing)";
  }
  if (key === "model") {
    return resolved.model.value ?? "(missing)";
  }
  const ref = resolved.credential.value ?? "(missing)";
  const marker = resolved.credential.secret.resolved ? "(resolved)" : "(not-resolved)";
  return `${ref} ${marker}`;
}

function sourceFor(key: string, resolved: ResolvedSettings): string {
  if (key === "baseUrl") {
    return resolved.baseUrl.origin;
  }
  if (key === "model") {
    return resolved.model.origin;
  }
  return resolved.credential.origin;
}

export function renderConfigTable(resolved: ResolvedSettings): string {
  const rows: Array<[string, string, string]> = [
    ["baseUrl", displayValueFor("baseUrl", resolved), sourceFor("baseUrl", resolved)],
    ["model", displayValueFor("model", resolved), sourceFor("model", resolved)],
    ["credential", displayValueFor("credential", resolved), sourceFor("credential", resolved)],
  ];
  const keyWidth = Math.max("key".length, ...rows.map(([key]) => key.length));
  const valueWidth = Math.max("value".length, ...rows.map(([, value]) => value.length));
  const sourceWidth = Math.max("source".length, ...rows.map(([, , source]) => source.length));
  const header = `${"key".padEnd(keyWidth)}  ${"value".padEnd(valueWidth)}  ${"source".padEnd(sourceWidth)}`;
  const lines = rows.map(([key, value, source]) =>
    `${key.padEnd(keyWidth)}  ${value.padEnd(valueWidth)}  ${source.padEnd(sourceWidth)}`.trimEnd(),
  );
  return `${header}\n${lines.join("\n")}\n`;
}
