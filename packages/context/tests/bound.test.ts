/**
 * LRN-19 bounder acceptance (AC-19.2, AC-19.7, DoD-2).
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { BlobStore } from "../src/index.js";
import { type BoundInput, createBounder } from "../src/index.js";

function memoryBlobs(): BlobStore & { readonly puts: Uint8Array[] } {
  const puts: Uint8Array[] = [];
  return {
    puts,
    put: async (bytes: Uint8Array) => {
      puts.push(bytes);
      return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    },
  };
}

function outcome(preview: string): BoundInput {
  return {
    status: "ok",
    preview,
    bytes: Buffer.byteLength(preview, "utf8"),
    truncated: false,
  };
}

it("AC-19.2 passes small results through unchanged with no spill", async () => {
  const blobs = memoryBlobs();
  const bounder = createBounder({ blobs, maxResultBytes: 64 });
  const bound = await bounder.bound(outcome("tiny"));
  expect(bound).toEqual({ status: "ok", preview: "tiny", bytes: 4, truncated: false });
  expect(blobs.puts).toHaveLength(0);
  expect(bound.blob_ref).toBeUndefined();
});

it("AC-19.2 truncates with a structured notice stating bytes and spill location", async () => {
  const blobs = memoryBlobs();
  const bounder = createBounder({ blobs, maxResultBytes: 256 });
  const preview = `line\n`.repeat(80);
  const total = Buffer.byteLength(preview, "utf8");
  expect(total).toBeGreaterThan(256);
  const bound = await bounder.bound(outcome(preview));

  expect(Buffer.byteLength(bound.preview, "utf8")).toBeLessThanOrEqual(256);
  expect(bound.truncated).toBe(true);
  expect(bound.bytes).toBe(total);
  expect(blobs.puts).toHaveLength(1);
  expect(Buffer.from(blobs.puts[0] ?? []).toString("utf8")).toBe(preview);
  const ref = bound.blob_ref;
  expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(bound.preview).toContain(`${total} bytes total`);
  expect(bound.preview).toContain(`full output at ${ref}`);
  expect(bound.preview).toContain("first");
  expect(bound.preview).toContain("shown");
});

it("never splits a multi-byte character at the cut boundary", async () => {
  const blobs = memoryBlobs();
  const bounder = createBounder({ blobs, maxResultBytes: 256 });
  const preview = `${"a".repeat(114)}é${"b".repeat(300)}`;
  const bound = await bounder.bound(outcome(preview));
  expect(bound.truncated).toBe(true);
  const head = bound.preview.split("\n")[0] ?? "";
  // Valid UTF-8 round-trip with no replacement character: nothing half-written.
  expect(Buffer.from(head, "utf8").toString("utf8")).toBe(head);
  expect(head).not.toContain("�");
  // "é" survives whole or is dropped whole — never a lone lead byte.
  expect(head.endsWith("é") || !head.includes("é")).toBe(true);
  expect(Buffer.byteLength(bound.preview, "utf8")).toBeLessThanOrEqual(256);
});

it("cutAtCharBoundary drops a character whole when the budget lands inside it", async () => {
  const { cutAtCharBoundary } = await import("../src/index.js");
  expect(cutAtCharBoundary("aaaaaaaaé", 9)).toBe("aaaaaaaa");
  expect(cutAtCharBoundary("aaaaaaaaé", 10)).toBe("aaaaaaaaé");
  expect(cutAtCharBoundary("abc", 0)).toBe("");
  expect(cutAtCharBoundary("abc", 99)).toBe("abc");
});

it("AC-19.7 honours notrunc for explicitly marked calls", async () => {
  const blobs = memoryBlobs();
  const bounder = createBounder({ blobs, maxResultBytes: 16 });
  const large = outcome("x".repeat(1024));
  const bound = await bounder.bound(large, { notrunc: true });
  expect(bound.preview).toBe(large.preview);
  expect(bound.truncated).toBe(false);
  expect(blobs.puts).toHaveLength(0);
});
