/** Full verification precedes sequence filtering. Reads never repair. */
import { constants } from "node:fs";
import { envelopeSchema, parseRecord, type ReadableRecord } from "@om-code/protocol";
import { hashEntry } from "./canonical.js";
import { JournalError } from "./errors.js";
import {
  checkDirectories,
  type JournalLocation,
  journalPaths,
  openRegular,
  readExtent,
} from "./files.js";

export type TailDiagnostic = { kind: "incomplete-tail"; offset: number; bytes: number };
export type JournalRead = {
  records: ReadableRecord[];
  diagnostics: TailDiagnostic[];
  validBytes: number;
};

export function scanJournal(bytes: Uint8Array): JournalRead {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: ReadableRecord[] = [];
  let offset = 0;
  let expected = 1;
  while (offset < buffer.length) {
    const end = buffer.indexOf(10, offset);
    if (end < 0) break;
    let raw: unknown;
    try {
      raw = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(offset, end)),
      );
    } catch {
      throw new JournalError("corrupt-record", `malformed record at byte ${offset}`, { offset });
    }
    if (typeof raw === "object" && raw !== null && "v" in raw && raw.v !== 1) {
      throw new JournalError(
        "incompatible",
        `unsupported journal envelope version at byte ${offset}`,
        { offset },
      );
    }
    const envelope = envelopeSchema.safeParse(raw);
    if (!envelope.success)
      throw new JournalError("corrupt-record", `invalid envelope at byte ${offset}`, { offset });
    let hash: string;
    try {
      hash = hashEntry(envelope.data.entry);
    } catch {
      throw new JournalError("corrupt-record", `invalid JSON value at byte ${offset}`, { offset });
    }
    if (hash !== envelope.data.sha256)
      throw new JournalError("corrupt-record", `hash mismatch at seq ${envelope.data.seq}`, {
        offset,
      });
    if (envelope.data.seq !== expected)
      throw new JournalError(
        envelope.data.seq > expected ? "seq-gap" : "seq-regression",
        `expected seq ${expected}, found ${envelope.data.seq}`,
        { offset },
      );
    const parsed = parseRecord(raw);
    if (!parsed.ok)
      throw new JournalError("incompatible", parsed.error.message, {
        offset,
        protocol_kind: parsed.error.kind,
      });
    records.push(parsed.record);
    expected++;
    offset = end + 1;
  }
  if (buffer.subarray(offset).includes(0))
    throw new JournalError("corrupt-record", "zero-filled journal tail", { offset });
  return {
    records,
    validBytes: offset,
    diagnostics:
      offset < buffer.length
        ? [{ kind: "incomplete-tail", offset, bytes: buffer.length - offset }]
        : [],
  };
}

export class JournalReader {
  private readonly location: JournalLocation;
  constructor(location: JournalLocation) {
    this.location = location;
  }

  async readAll(sessionId: string, fromSeq = 1): Promise<JournalRead> {
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 1)
      throw new JournalError("invalid-value", "fromSeq must be positive");
    const paths = journalPaths(this.location, sessionId);
    try {
      await checkDirectories(paths);
      const handle = await openRegular(paths.journal, constants.O_RDONLY);
      let bytes: Buffer;
      try {
        bytes = await readExtent(handle);
      } finally {
        await handle.close();
      }
      const result = scanJournal(bytes);
      return { ...result, records: result.records.filter((record) => record.seq >= fromSeq) };
    } catch (error) {
      if (error instanceof JournalError) throw error;
      throw new JournalError("unreadable", `cannot read session ${sessionId}`);
    }
  }

  async *read(sessionId: string, fromSeq = 1): AsyncIterable<ReadableRecord> {
    const result = await this.readAll(sessionId, fromSeq);
    yield* result.records;
  }
}
