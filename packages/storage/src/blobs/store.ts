/**
 * Content-addressed blob spill (LRN-19, AC-19.3).
 *
 * Truncated tool output lands at `<OM_HOME>/blobs/sha256/<ab>/<hash>`
 * (blueprint §7:339), project-independent — only the home computation is
 * shared with the journal, factored here through `resolveOmHome` rather than
 * duplicated. Writes reuse the journal's reviewed recipe: `checkDirectory`
 * per level (0700, symlink-refusing), an atomic temp → fsync → rename →
 * dirsync publish through `openRegular` (0600), and idempotent re-put (an
 * existing address is never rewritten).
 *
 * Satisfies context's `BlobStore` port structurally — storage never imports
 * context, the same relationship `JournalSink`/`ToolIo` already have.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveOmHome } from "../config/paths.js";
import { JournalError } from "../journal/errors.js";
import { checkDirectory, hasCode, openRegular, syncDirectory } from "../journal/files.js";

export type BlobLocation = {
  /** Resolved OM_HOME; defaults to `resolveOmHome(process.env)` like the journal. */
  readonly omHome?: string;
};

const REF_PATTERN = /^sha256:([0-9a-f]{64})$/;

export function resolveBlobHome(location: BlobLocation): string {
  return location.omHome === undefined ? resolveOmHome(process.env) : resolve(location.omHome);
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Absolute file path for a validated blob ref under the given home. */
export function blobFileForRef(home: string, ref: string): string {
  const match = REF_PATTERN.exec(ref);
  if (match?.[1] === undefined) throw new JournalError("invalid-value", `invalid blob ref: ${ref}`);
  const hash = match[1];
  return join(home, "blobs", "sha256", hash.slice(0, 2), hash);
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
      throw new JournalError("write-failed", "short write spilling blob output");
    }
    offset += bytesWritten;
  }
}

/**
 * Store bytes under their sha256 address; returns `sha256:<hex>`.
 * Idempotent: an existing address is verified as a private regular file and
 * never rewritten.
 */
export async function putBlob(location: BlobLocation, bytes: Uint8Array): Promise<string> {
  const home = resolveBlobHome(location);
  const hash = hashOf(bytes);
  const ref = `sha256:${hash}`;
  const file = blobFileForRef(home, ref);
  const directory = dirname(file);
  await checkDirectory(home, true);
  await checkDirectory(join(home, "blobs"), true);
  await checkDirectory(join(home, "blobs", "sha256"), true);
  await checkDirectory(directory, true);
  let handle: FileHandle | undefined;
  try {
    handle = await openRegular(file, constants.O_RDONLY, false);
    await handle.close();
    return ref;
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const temporary = `${file}.tmp.${process.pid}`;
  const replacement = await openRegular(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    true,
  );
  try {
    await writeAll(replacement, bytes);
    await replacement.sync();
  } finally {
    await replacement.close();
  }
  try {
    await rename(temporary, file);
    await syncDirectory(directory);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return ref;
}

/** Retrieve spilled bytes by ref; the address is re-verified on read. */
export async function readBlob(location: BlobLocation, ref: string): Promise<Uint8Array> {
  const home = resolveBlobHome(location);
  const file = blobFileForRef(home, ref);
  const handle = await openRegular(file, constants.O_RDONLY, false);
  try {
    const { size } = await handle.stat();
    const out = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(out, offset, size - offset, offset);
      if (bytesRead === 0) throw new JournalError("unreadable", `blob shrank during read: ${ref}`);
      offset += bytesRead;
    }
    const expected = (REF_PATTERN.exec(ref) as RegExpExecArray)[1] as string;
    if (hashOf(out) !== expected)
      throw new JournalError("unreadable", `blob hash mismatch: ${ref}`);
    return new Uint8Array(out);
  } finally {
    await handle.close();
  }
}

/** The `BlobStore` shape context consumes — no import of context here. */
export function createBlobStore(location: BlobLocation): {
  put(bytes: Uint8Array): Promise<string>;
} {
  return {
    put: (bytes: Uint8Array) => putBlob(location, bytes),
  };
}
