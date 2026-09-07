/**
 * Blob-store boundary owned by context (LRN-19, AC-19.3).
 *
 * Storage's blob store satisfies this port structurally, so context never
 * imports another adapter — the same shape kernel's `JournalSink` has with
 * storage and tools' `ToolIo` has with the stub client.
 */

/** Content-addressed spill for truncated tool output. Returns the blob ref. */
export type BlobStore = {
  put(bytes: Uint8Array): Promise<string>;
};
