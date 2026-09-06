/**
 * Reusable secret-absence guard (LRN-04, AC-4.3).
 *
 * LRN-06 (journal) and LRN-11 (logs) extend this same guard: point it at any
 * directory we wrote and it fails if the sentinel appears in any file.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

export function assertNoSecret(dir: string, sentinel: string): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      assertNoSecret(path, sentinel);
      continue;
    }
    const bytes = readFileSync(path);
    expect(bytes.includes(Buffer.from(sentinel))).toBe(false);
  }
}
