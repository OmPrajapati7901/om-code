/**
 * LRN-19 fuzz (AC-19.4, DoD-4): generated outputs up to and beyond 50 MB
 * never produce a context entry above its byte budget. Bytes are generated
 * lazily per run so the suite stays inside its time budget; the BlobStore is
 * a fake that hashes without retaining.
 */
import { createHash } from "node:crypto";
import fc from "fast-check";
import { expect, it } from "vitest";
import type { BlobStore } from "../src/index.js";
import { createBounder } from "../src/index.js";

function hashingBlobs(): BlobStore {
  return {
    put: async (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

it("AC-19.4 zero budget violations over generated sizes incl. >= 50 MB", async () => {
  const blobs = hashingBlobs();
  await fc.assert(
    fc.asyncProperty(
      // Small caps keep the property tight; sizes mix bytes with 50-52 MB so
      // the AC-19.4 regime is hit on most seeds without paying 50 MB every run.
      fc.integer({ min: 1, max: 4096 }),
      fc.oneof(
        { weight: 3, arbitrary: fc.integer({ min: 0, max: 4096 }) },
        { weight: 1, arbitrary: fc.integer({ min: 50 * 1024 * 1024, max: 52 * 1024 * 1024 }) },
      ),
      fc.boolean(),
      async (maxResultBytes, size, notrunc) => {
        const bounder = createBounder({ blobs, maxResultBytes });
        // Lazily built per case: one Buffer, released after the assertion.
        const preview = Buffer.alloc(size, "x").toString("utf8");
        const bound = await bounder.bound(
          { status: "ok", preview, bytes: size, truncated: false },
          { notrunc },
        );
        if (notrunc) {
          expect(bound.preview).toBe(preview);
        } else {
          expect(Buffer.byteLength(bound.preview, "utf8")).toBeLessThanOrEqual(maxResultBytes);
          expect(bound.bytes).toBe(size);
          expect(bound.truncated).toBe(size > maxResultBytes);
        }
      },
    ),
    { numRuns: 25 },
  );
}, 120_000);
