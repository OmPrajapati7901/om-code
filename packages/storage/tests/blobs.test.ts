/**
 * LRN-19 blob spill acceptance (AC-19.3, DoD-2).
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  blobFileForRef,
  createBlobStore,
  isJournalError,
  putBlob,
  readBlob,
  resolveBlobHome,
} from "../src/index.js";

const trees: string[] = [];
afterEach(async () => {
  await Promise.all(trees.splice(0).map((tree) => rm(tree, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const tree = await mkdtemp(join(tmpdir(), "om-blobs-"));
  trees.push(tree);
  return join(tree, "home");
}

function hexOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

it("round-trips bytes through the <ab>/<hash> fan-out path", async () => {
  const omHome = await home();
  const bytes = Buffer.from("spilled tool output\nsecond line\n", "utf8");
  const ref = await putBlob({ omHome }, bytes);
  const hash = hexOf(bytes);
  expect(ref).toBe(`sha256:${hash}`);
  expect(blobFileForRef(omHome, ref)).toBe(
    join(resolveBlobHome({ omHome }), "blobs", "sha256", hash.slice(0, 2), hash),
  );
  expect(await readBlob({ omHome }, ref)).toEqual(new Uint8Array(bytes));
});

it("creates 0700 directories and 0600 files", async () => {
  const omHome = await home();
  const ref = await putBlob({ omHome }, Buffer.from("private", "utf8"));
  const file = blobFileForRef(omHome, ref);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(join(file, "..", ".."))).mode & 0o777).toBe(0o700);
  expect((await stat(join(resolveBlobHome({ omHome }), "blobs"))).mode & 0o777).toBe(0o700);
});

it("re-put of the same bytes is idempotent and never rewrites", async () => {
  const omHome = await home();
  const bytes = Buffer.from("same content", "utf8");
  const first = await putBlob({ omHome }, bytes);
  const before = (await stat(blobFileForRef(omHome, first))).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await putBlob({ omHome }, bytes);
  expect(second).toBe(first);
  expect((await stat(blobFileForRef(omHome, first))).mtimeMs).toBe(before);
  expect(await readBlob({ omHome }, first)).toEqual(new Uint8Array(bytes));
});

it("rejects malformed refs and detects hash mismatch", async () => {
  const omHome = await home();
  await expect(readBlob({ omHome }, "not-a-ref")).rejects.toSatisfy(isJournalError);
  await expect(readBlob({ omHome }, "sha256:xyz")).rejects.toSatisfy(isJournalError);
  const ref = await putBlob({ omHome }, Buffer.from("original", "utf8"));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(blobFileForRef(omHome, ref), "tampered");
  await expect(readBlob({ omHome }, ref)).rejects.toSatisfy(isJournalError);
});

it("exposes the context BlobStore shape without importing context", async () => {
  const omHome = await home();
  const store = createBlobStore({ omHome });
  const ref = await store.put(Buffer.from("via port", "utf8"));
  expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(await readBlob({ omHome }, ref)).toEqual(new Uint8Array(Buffer.from("via port", "utf8")));
});
