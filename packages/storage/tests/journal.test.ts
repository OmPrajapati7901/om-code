/** AC-6.1–6.6: real storage, conservative recovery and failure injection. */
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v7 } from "uuid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalReader, JournalWriter, journalPaths } from "../src/index.js";
import { canonicalJson, hashEntry } from "../src/journal/canonical.js";
import { scanJournal } from "../src/journal/reader.js";
import { assertNoSecret } from "./helpers/secret-guard.js";

const roots: string[] = [];
async function location() {
  const root = await mkdtemp(join(tmpdir(), "om-journal-"));
  roots.push(root);
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  return { omHome: join(root, "home"), projectRoot, sessionId: v7() };
}
const entry = (text = "hello") => ({ kind: "user_message", schemaVersion: 1, text }) as const;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("canonical JSON (AC-6.2)", () => {
  it("orders numeric keys lexically and preserves __proto__ and Unicode", () => {
    expect(canonicalJson(JSON.parse('{"2":2,"10":10,"__proto__":{"x":1}}'))).toBe(
      '{"10":10,"2":2,"__proto__":{"x":1}}',
    );
    expect(canonicalJson({ "\ufffd": 1, "😀": 2, "\r": 3 })).toBe('{"\\r":3,"😀":2,"�":1}');
    expect(canonicalJson({ x: [3, 1], omit: undefined, text: '"\\\n' })).toBe(
      '{"text":"\\"\\\\\\n","x":[3,1]}',
    );
    expect(hashEntry({ a: 1, b: 2 })).toBe(hashEntry({ b: 2, a: 1 }));
  });
  it("rejects values that JSON.stringify would silently change", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [
      NaN,
      Infinity,
      1n,
      new Date(),
      new Map(),
      cycle,
      [undefined],
      Array(1),
      "\ud800",
      {
        get x() {
          throw new Error("must not invoke");
        },
      },
    ]) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });
});

describe("journal (AC-6.1–6.6)", () => {
  it("does not allow runtime context fields to override assigned sequence or identity", async () => {
    const loc = await location();
    const writer = await JournalWriter.open(loc);
    const context = { by: "user" as const, seq: 99, id: "not-a-record-id", v: 20 };
    const record = await writer.append(entry(), context);
    await writer.close();
    expect(record.seq).toBe(1);
    expect(record.v).toBe(1);
    expect(record.id).not.toBe(context.id);
  });

  it("keeps seq ordered when timestamps go backwards and preserves close's queued work", async () => {
    const loc = await location();
    let time = Date.parse("2026-09-06T12:00:00Z");
    const writer = await JournalWriter.open({
      ...loc,
      now: () => {
        time -= 1000;
        return new Date(time);
      },
    });
    const first = writer.append(entry("one"), { by: "user" });
    const second = writer.append(entry("two"), { by: "user" });
    const close = writer.close();
    const [a, b] = await Promise.all([first, second]);
    await close;
    expect(b.seq).toBe(a.seq + 1);
    expect(b.ts < a.ts).toBe(true);
  });

  it("recovers a partial write without replaying the failed append", async () => {
    const loc = await location();
    let writer = await JournalWriter.open(loc);
    await writer.append(entry("committed"), { by: "user" });
    await writer.close();
    writer = await JournalWriter.open({
      ...loc,
      hooks: {
        write: async (handle, bytes, offset) => {
          if (offset !== 0) throw new Error("disk full");
          return (await handle.write(bytes, 0, 12, null)).bytesWritten;
        },
      },
    });
    await expect(writer.append(entry("uncertain"), { by: "user" })).rejects.toMatchObject({
      kind: "write-failed",
    });
    await writer.close();
    writer = await JournalWriter.open(loc);
    await writer.close();
    const read = await new JournalReader(loc).readAll(loc.sessionId);
    expect(read.records.map((r) => r.entry.kind)).toEqual(["user_message", "repair"]);
    expect(read.records[0]?.entry).toEqual(entry("committed"));
  });

  it("refuses to publish repair when backup sync fails and releases the lock", async () => {
    const loc = await location();
    let writer = await JournalWriter.open(loc);
    await writer.append(entry(), { by: "user" });
    await writer.close();
    const path = journalPaths(loc, loc.sessionId).journal;
    await appendFile(path, "{torn");
    const before = await readFile(path);
    await expect(
      JournalWriter.open({
        ...loc,
        hooks: {
          sync: async () => {
            throw new Error("disk full");
          },
        },
      }),
    ).rejects.toBeDefined();
    expect(await readFile(path)).toEqual(before);
    writer = await JournalWriter.open(loc);
    await writer.close();
  });
  it("serializes concurrent appends, snapshots inputs, and syncs each record exactly once", async () => {
    const loc = await location();
    const sync = vi.fn(async (handle: { sync(): Promise<void> }) => handle.sync());
    const writer = await JournalWriter.open({ ...loc, hooks: { sync } });
    const mutable = { ...entry("before") };
    const first = writer.append(mutable, { by: "user", turn_id: "turn" });
    mutable.text = "after";
    const rest = Array.from({ length: 10 }, (_, i) =>
      writer.append(entry(String(i)), { by: "user" }),
    );
    const records = await Promise.all([first, ...rest]);
    await writer.close();
    await writer.close();
    expect(sync).toHaveBeenCalledTimes(11);
    expect(records.map((record) => record.seq)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1),
    );
    expect((await new JournalReader(loc).readAll(loc.sessionId)).records).toEqual(records);
    expect(records[0]?.entry).toEqual(entry("before"));
    expect(
      (await new JournalReader(loc).readAll(loc.sessionId, 10)).records.map((r) => r.seq),
    ).toEqual([10, 11]);
    await expect(writer.append(entry(), { by: "user" })).rejects.toMatchObject({ kind: "closed" });
  });

  it("creates private state and tightens pre-existing directory modes", async () => {
    const loc = await location();
    await mkdir(loc.omHome, { mode: 0o755 });
    const writer = await JournalWriter.open(loc);
    await writer.append(entry(), { by: "user" });
    await writer.close();
    const paths = journalPaths(loc, loc.sessionId);
    for (const path of [paths.home, paths.sessions, paths.directory])
      expect((await stat(path)).mode & 0o777).toBe(0o700);
    for (const path of [paths.journal, paths.lock])
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    assertNoSecret(loc.omHome, "SENTINEL_CREDENTIAL");
  });

  it("repairs only the incomplete tail and preserves the original plus valid prefix", async () => {
    const loc = await location();
    let writer = await JournalWriter.open(loc);
    const committed = await writer.append(entry(), { by: "user" });
    await writer.close();
    const paths = journalPaths(loc, loc.sessionId);
    const prefix = await readFile(paths.journal);
    await appendFile(paths.journal, '{"seq":2');
    const damaged = await readFile(paths.journal);
    const reader = new JournalReader(loc);
    expect((await reader.readAll(loc.sessionId)).diagnostics).toEqual([
      { kind: "incomplete-tail", offset: prefix.length, bytes: 8 },
    ]);
    expect(await readFile(paths.journal)).toEqual(damaged);
    writer = await JournalWriter.open(loc);
    await writer.close();
    const read = await reader.readAll(loc.sessionId);
    expect(read.records[0]).toEqual(committed);
    expect(read.records[1]?.entry).toMatchObject({ kind: "repair", truncated_from: 2 });
    expect(read.diagnostics).toEqual([]);
    expect((await readFile(paths.journal)).subarray(0, prefix.length)).toEqual(prefix);
    const backups = (await readdir(paths.directory)).filter((name) => name.includes(".corrupt."));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(paths.directory, backups[0] ?? ""))).toEqual(damaged);
    writer = await JournalWriter.open(loc);
    await writer.close();
    expect((await reader.readAll(loc.sessionId)).records).toHaveLength(2);
  });

  it.each(["hash", "gap", "duplicate", "version", "entry", "json", "zeros"])(
    "refuses %s damage without altering bytes",
    async (kind) => {
      const loc = await location();
      const writer = await JournalWriter.open(loc);
      const record = await writer.append(entry(), { by: "user" });
      await writer.close();
      const raw = { ...record };
      if (kind === "hash") raw.sha256 = "0".repeat(64);
      if (kind === "gap") raw.seq = 3;
      if (kind === "duplicate") raw.seq = 1;
      const changed: unknown =
        kind === "version"
          ? {
              ...raw,
              entry: { ...entry(), schemaVersion: 99 },
              sha256: hashEntry({ ...entry(), schemaVersion: 99 }),
            }
          : kind === "entry"
            ? { ...raw, entry: { ...entry(), text: 9 }, sha256: hashEntry({ ...entry(), text: 9 }) }
            : raw;
      const bytes =
        kind === "json"
          ? Buffer.from("oops\n")
          : kind === "zeros"
            ? Buffer.from([0, 0])
            : Buffer.from(
                `${kind === "duplicate" ? `${canonicalJson(record)}\n` : ""}${canonicalJson(changed)}\n`,
              );
      const path = journalPaths(loc, loc.sessionId).journal;
      await writeFile(path, bytes);
      await expect(JournalWriter.open(loc)).rejects.toBeDefined();
      expect(await readFile(path)).toEqual(bytes);
    },
  );

  it("verifies earlier records even when filtering from a later seq", async () => {
    const loc = await location();
    const writer = await JournalWriter.open(loc);
    await writer.append(entry("x".repeat(70_000)), { by: "user" });
    await writer.append(entry("tail"), { by: "user" });
    await writer.close();
    const path = journalPaths(loc, loc.sessionId).journal;
    await writeFile(path, (await readFile(path, "utf8")).replace("xxx", "yxx"));
    await expect(new JournalReader(loc).readAll(loc.sessionId, 2)).rejects.toMatchObject({
      kind: "corrupt-record",
    });
    await expect(JournalWriter.open(loc)).rejects.toMatchObject({ kind: "corrupt-record" });
  });

  it("hashes unknown raw entries before wrapping them", async () => {
    const loc = await location();
    const writer = await JournalWriter.open(loc);
    const record = await writer.append(entry(), { by: "user" });
    await writer.close();
    const unknown = { kind: "constructor", schemaVersion: 9, value: { "2": 2, "10": 10 } };
    const bytes = Buffer.from(
      `${canonicalJson({ ...record, entry: unknown, sha256: hashEntry(unknown) })}\n`,
    );
    expect(scanJournal(bytes).records[0]?.entry).toMatchObject({
      kind: "unknown_entry",
      raw: unknown,
    });
  });

  it("handles short writes and poisons the queue after uncertain sync failure", async () => {
    const loc = await location();
    const sync = vi.fn(async () => {
      throw new Error("disk");
    });
    const writer = await JournalWriter.open({
      ...loc,
      hooks: {
        sync,
        write: async (handle, bytes, offset) =>
          (await handle.write(bytes, offset, Math.min(7, bytes.length - offset), null))
            .bytesWritten,
      },
    });
    const a = writer.append(entry(), { by: "user" });
    const b = writer.append(entry("never"), { by: "user" });
    await expect(a).rejects.toMatchObject({ kind: "write-failed" });
    await expect(b).rejects.toMatchObject({ kind: "write-failed" });
    await writer.close();
    expect(sync).toHaveBeenCalledTimes(1);
    expect((await new JournalReader(loc).readAll(loc.sessionId)).records).toHaveLength(1);
  });

  it("rejects symlink targets and invalid session paths", async () => {
    const loc = await location();
    const writer = await JournalWriter.open(loc);
    await writer.close();
    const path = journalPaths(loc, loc.sessionId).journal;
    await rm(path);
    const target = join(loc.projectRoot, "untouched");
    await writeFile(target, "safe");
    await symlink(target, path);
    await expect(JournalWriter.open(loc)).rejects.toMatchObject({ kind: "unsafe-path" });
    expect(await readFile(target, "utf8")).toBe("safe");
    expect(() => journalPaths(loc, "../escape")).toThrow();
  });
});
