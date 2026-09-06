/**
 * LRN-06 commit point: EVERY append resolves only after its complete LF-ended
 * record and fsync. Intent must be awaited before inference/tool side effects.
 * Streaming UI deltas are provisional until the assistant record commits.
 * Directory fsync follows durable creation/replacement. Process-kill tests
 * establish process recovery, not drive-cache/power-loss guarantees.
 *
 * Repair is the sole non-append mutation: preserve the damaged original,
 * then publish an intact verified prefix plus its repair record atomically.
 * Compaction (AC-37.2) remains append-only. truncated_from is the first
 * discarded seq, so it equals the repair record's seq (minimum 1).
 */
import { constants } from "node:fs";
import { type FileHandle, rename, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { type Actor, type Entry, type JournalRecord, parseRecord } from "@om-code/protocol";
import { v7 } from "uuid";
import { canonicalJson, hashEntry } from "./canonical.js";
import { JournalError } from "./errors.js";
import {
  checkDirectories,
  type JournalLocation,
  journalPaths,
  openRegular,
  readExtent,
  syncDirectory,
} from "./files.js";
import { acquireJournalLock } from "./lock.js";
import { scanJournal } from "./reader.js";

export type AppendContext = { by: Actor; turn_id?: string };
export type JournalStage =
  | "append-written"
  | "append-synced"
  | "backup-synced"
  | "replacement-synced"
  | "replacement-published";
export type JournalHooks = {
  sync?: (handle: FileHandle) => Promise<void>;
  write?: (handle: FileHandle, bytes: Buffer, offset: number) => Promise<number>;
  stage?: (stage: JournalStage) => void | Promise<void>;
};
export type JournalWriterOptions = JournalLocation & {
  sessionId: string;
  now?: () => Date;
  newId?: () => string;
  hooks?: JournalHooks;
};

async function writeAll(handle: FileHandle, bytes: Buffer, hooks: JournalHooks): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const count = hooks.write
      ? await hooks.write(handle, bytes, offset)
      : (await handle.write(bytes, offset, bytes.length - offset, null)).bytesWritten;
    if (!Number.isInteger(count) || count <= 0 || count > bytes.length - offset)
      throw new Error("invalid short write");
    offset += count;
  }
}

export class JournalWriter {
  private queue: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private failure: JournalError | undefined;
  private handle: FileHandle;
  private readonly release: () => Promise<void>;
  private seq: number;
  private readonly options: JournalWriterOptions;
  private constructor(
    handle: FileHandle,
    release: () => Promise<void>,
    seq: number,
    options: JournalWriterOptions,
  ) {
    this.handle = handle;
    this.release = release;
    this.seq = seq;
    this.options = options;
  }

  static async open(options: JournalWriterOptions): Promise<JournalWriter> {
    const paths = journalPaths(options, options.sessionId);
    let release: (() => Promise<void>) | undefined;
    let handle: FileHandle | undefined;
    try {
      await checkDirectories(paths, true);
      // Persist the directory chain as well as the eventual session file.
      for (const directory of [dirname(paths.home), paths.home, paths.sessions])
        await syncDirectory(directory);
      release = await acquireJournalLock(paths.lock);
      handle = await openRegular(
        paths.journal,
        constants.O_RDWR | constants.O_APPEND | constants.O_CREAT,
        true,
      );
      await syncDirectory(paths.directory);
      const bytes = await readExtent(handle);
      const scan = scanJournal(bytes);
      const writer = new JournalWriter(handle, release, scan.records.length, options);
      if (scan.diagnostics.length > 0) {
        await writer.repair(paths.journal, bytes, scan.validBytes);
        handle = writer.handle;
      }
      return writer;
    } catch (error) {
      try {
        await handle?.close();
      } finally {
        await release?.();
      }
      if (error instanceof JournalError) throw error;
      throw new JournalError("unreadable", "cannot open journal");
    }
  }

  private record(entry: Entry, context: AppendContext, seq: number): JournalRecord {
    const raw = {
      v: 1,
      seq,
      id: (this.options.newId ?? v7)(),
      ts: (this.options.now ?? (() => new Date()))().toISOString(),
      by: context.by,
      ...(context.turn_id === undefined ? {} : { turn_id: context.turn_id }),
      entry,
      sha256: hashEntry(entry),
    };
    const parsed = parseRecord(raw);
    if (!parsed.ok || "unknownEntry" in parsed)
      throw new JournalError("invalid-value", "invalid journal append");
    return parsed.record;
  }

  private async sync(handle: FileHandle): Promise<void> {
    await (this.options.hooks?.sync ?? ((h) => h.sync()))(handle);
  }

  append(entry: Entry, context: AppendContext): Promise<JournalRecord> {
    if (this.closing) return Promise.reject(new JournalError("closed", "journal is closed"));
    // Snapshot before queueing: later caller mutations cannot alter this append.
    let snapshot: Entry;
    let actor: AppendContext;
    try {
      snapshot = JSON.parse(canonicalJson(entry)) as Entry;
      actor = JSON.parse(canonicalJson(context)) as AppendContext;
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = this.queue.then(async () => {
      if (this.failure) throw this.failure;
      const record = this.record(snapshot, actor, this.seq + 1);
      const bytes = Buffer.from(`${canonicalJson(record)}\n`);
      try {
        await writeAll(this.handle, bytes, this.options.hooks ?? {});
        await this.options.hooks?.stage?.("append-written");
        await this.sync(this.handle);
        await this.options.hooks?.stage?.("append-synced");
        this.seq = record.seq;
        return record;
      } catch {
        this.failure = new JournalError(
          "write-failed",
          "journal append outcome is uncertain; close and reopen",
        );
        throw this.failure;
      }
    });
    this.queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  close(): Promise<void> {
    this.closing ??= this.queue.then(async () => {
      try {
        await this.handle.close();
      } finally {
        await this.release();
      }
    });
    return this.closing;
  }

  private async repair(path: string, bytes: Buffer, validBytes: number): Promise<void> {
    const suffix = v7();
    const backupPath = `${path}.corrupt.${suffix}`;
    const temporaryPath = `${path}.repair.${suffix}.tmp`;
    const backup = await openRegular(
      backupPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      true,
    );
    try {
      await writeAll(backup, bytes, {});
      await this.sync(backup);
    } finally {
      await backup.close();
    }
    await syncDirectory(dirname(path));
    await this.options.hooks?.stage?.("backup-synced");
    const record = this.record(
      {
        kind: "repair",
        schemaVersion: 1,
        truncated_from: this.seq + 1,
        reason: `incomplete-tail; backup=${basename(backupPath)}; bytes=[${validBytes},${bytes.length})`,
      },
      { by: "system" },
      this.seq + 1,
    );
    const replacement = await openRegular(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      true,
    );
    try {
      try {
        await writeAll(replacement, bytes.subarray(0, validBytes), {});
        await writeAll(replacement, Buffer.from(`${canonicalJson(record)}\n`), {});
        await this.sync(replacement);
      } finally {
        await replacement.close();
      }
      await this.options.hooks?.stage?.("replacement-synced");
      await rename(temporaryPath, path);
      await syncDirectory(dirname(path));
      await this.options.hooks?.stage?.("replacement-published");
      const next = await openRegular(path, constants.O_RDWR | constants.O_APPEND, true);
      await this.handle.close();
      this.handle = next;
      this.seq = record.seq;
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
  }
}
