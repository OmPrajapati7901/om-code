/**
 * Shared driver contract suite (LRN-13, AC-13.6–AC-13.8; feeds AC-30.5).
 *
 * An exported, parameterized test module — not tests inlined against one
 * implementation. Run it from `tests/driver-contract.test.ts` against
 * `createLocalDriver`; LRN-30 adds a second one-line caller against the Rust
 * stub and changes nothing else. A deliberately broken second driver must
 * fail this suite (verified, uncommitted) — that is the mechanical proof the
 * suite is not welded to one implementation.
 *
 * Offline: the suite spawns `rg` as a child process, never a socket, so it
 * is in scope of `tests/guards/no-network.mjs` by design, not a violation.
 *
 * AC-13.8 discipline — a reviewer must be able to confirm by reading:
 * every regex below is in the Rust-`regex` ∩ JS-`RegExp` intersection (no
 * lookaround, no backreferences), every glob is in the `globset` subset from
 * `dialect.ts` (no extglob, no leading-`!`), no two fixture paths differ only
 * by ASCII case or only by Unicode normalization form, and no assertion turns
 * on a normalization-equivalence outcome. A lookahead or a
 * normalization-dependent path in this suite is a defect in the suite.
 *
 * rg-derived expectation tables below were captured from ripgrep 15.2.0. M4
 * checks the Rust engine against this fixed table rather than against its
 * own output.
 */

import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStubError, type StubClient } from "@om-code/stub-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

export type DriverHandle = {
  client: StubClient;
  close?: () => Promise<void>;
};

export function driverContract(
  name: string,
  makeDriver: (root: string) => Promise<DriverHandle>,
): void {
  describe(`${name} shared stub-driver contract`, () => {
    let base = "";
    let root = "";
    let canonicalRoot = "";
    let client: StubClient;
    let closer: (() => Promise<void>) | undefined;

    const MAIN_TS = [
      "export const alpha = 1;",
      "// needle one: the quick brown fox",
      'export const beta = "needle two here";',
      "export const gamma = 3;",
      "",
    ].join("\n");

    beforeEach(async () => {
      base = mkdtempSync(join(tmpdir(), "om-driver-"));
      root = join(base, "ws");
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(join(root, ".gitignore"), "ignored.log\ndist/\n");
      writeFileSync(join(root, "src", "main.ts"), MAIN_TS);
      writeFileSync(join(root, "src", "util.ts"), "export const helper = 42;\n");
      writeFileSync(join(root, "app.ts"), "export const app = true;\n");
      writeFileSync(join(root, "notes.txt"), "just a needle in notes\nsecond line here\n");
      writeFileSync(join(root, "utf8.txt"), "alpha\nβeta gamma\ncafé au lait\n");
      writeFileSync(join(root, "no-final-newline.txt"), "first\nsecond");
      writeFileSync(join(root, "empty.txt"), "");
      writeFileSync(join(root, "big.txt"), "0123456789abcdef\n".repeat(16384));
      writeFileSync(
        join(root, "ticks.txt"),
        ["tick 1", "tick 2", "tick 3", "tick 4", "tick 5", ""].join("\n"),
      );
      writeFileSync(join(root, "ignored.log"), "needle hiding in ignored.log\n");
      writeFileSync(join(root, "dist", "bundle.js"), "var needle = 1;\n");
      writeFileSync(join(root, "sentinel.txt"), "do not delete\n");
      writeFileSync(join(base, "outside.txt"), "outside the root\n");
      mkdirSync(join(base, "ws-evil"), { recursive: true });
      writeFileSync(join(base, "ws-evil", "x.txt"), "sibling trap\n");
      symlinkSync(join(base, "outside.txt"), join(root, "link-out"));
      symlinkSync("src", join(root, "subdir-link"));
      canonicalRoot = realpathSync.native(root);
      const handle = await makeDriver(root);
      client = handle.client;
      closer = handle.close;
    });

    afterEach(async () => {
      await closer?.();
      closer = undefined;
      rmSync(base, { recursive: true, force: true });
    });

    function envelope(overrides?: { maxBytes?: number; maxMs?: number }): {
      maxBytes: number;
      maxMs: number;
      cwd: string;
      envAllowlist: string[];
      capability: { risk_class: "read" };
    } {
      return {
        maxBytes: overrides?.maxBytes ?? 1_000_000,
        maxMs: overrides?.maxMs ?? 10_000,
        cwd: root,
        envAllowlist: [],
        capability: { risk_class: "read" },
      };
    }

    const signal = () => new AbortController().signal;

    async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
      const events: T[] = [];
      for await (const event of stream) events.push(event);
      return events;
    }

    function expectPathEscape(error: unknown): void {
      expect(isStubError(error)).toBe(true);
      if (isStubError(error)) expect(error.kind).toBe("path-escape");
    }

    async function expectPathEscapeFrom(run: () => Promise<unknown>): Promise<void> {
      try {
        await run();
      } catch (error) {
        expectPathEscape(error);
        return;
      }
      expect.unreachable("expected a path-escape StubError");
    }

    /** UTF-8 byte offset of each 1-based line start in `content`. */
    function lineByteOffsets(content: string): number[] {
      const offsets = [0];
      let byte = 0;
      for (const line of content.split("\n").slice(0, -1)) {
        byte += Buffer.byteLength(`${line}\n`, "utf8");
        offsets.push(byte);
      }
      return offsets;
    }

    it("health reports an un-sandboxed driver", async () => {
      const result = await client.health(envelope(), signal());
      expect(result.status).toBe("ok");
      expect(result.enforcement).toBe("unenforced");
      expect(result.sandboxProfile).toBeNull();
      expect(result.version.length).toBeGreaterThan(0);
    });

    it("read returns exact file bytes", async () => {
      const events = await collect(client.read({ ...envelope(), path: "src/main.ts" }, signal()));
      const chunks = events.filter((event) => event.type === "chunk");
      const end = events.find((event) => event.type === "end");
      expect(Buffer.concat(chunks.map((event) => Buffer.from(event.bytes))).toString("utf8")).toBe(
        MAIN_TS,
      );
      expect(end?.frame.status).toBe("ok");
      expect(end?.frame.truncated).toBe(false);
      expect(end?.frame.totalLines).toBe(4);
    });

    it("read honors a line range", async () => {
      const events = await collect(
        client.read(
          { ...envelope(), path: "src/main.ts", range: { startLine: 2, endLine: 3 } },
          signal(),
        ),
      );
      const text = Buffer.concat(
        events.filter((event) => event.type === "chunk").map((event) => Buffer.from(event.bytes)),
      ).toString("utf8");
      expect(text).toBe(
        '// needle one: the quick brown fox\nexport const beta = "needle two here";\n',
      );
      const end = events.find((event) => event.type === "end");
      expect(end?.frame.totalLines).toBe(4);
    });

    it("read round-trips multibyte UTF-8 byte-exactly", async () => {
      const events = await collect(client.read({ ...envelope(), path: "utf8.txt" }, signal()));
      const bytes = Buffer.concat(
        events.filter((event) => event.type === "chunk").map((event) => Buffer.from(event.bytes)),
      );
      expect(bytes.equals(readFileSync(join(root, "utf8.txt")))).toBe(true);
    });

    it("ranged read round-trips multibyte UTF-8 byte-exactly", async () => {
      const events = await collect(
        client.read(
          { ...envelope(), path: "utf8.txt", range: { startLine: 2, endLine: 3 } },
          signal(),
        ),
      );
      const bytes = Buffer.concat(
        events.filter((event) => event.type === "chunk").map((event) => Buffer.from(event.bytes)),
      );
      expect(bytes.equals(Buffer.from("βeta gamma\ncafé au lait\n"))).toBe(true);
    });

    it("read counts a final partial line and an empty file", async () => {
      const partial = await collect(
        client.read({ ...envelope(), path: "no-final-newline.txt" }, signal()),
      );
      expect(partial.find((event) => event.type === "end")?.frame.totalLines).toBe(2);
      const empty = await collect(client.read({ ...envelope(), path: "empty.txt" }, signal()));
      expect(empty.find((event) => event.type === "end")?.frame.totalLines).toBe(0);
    });

    it("stat reports files, directories, and absence", async () => {
      const file = await client.stat({ ...envelope(), path: "src/main.ts" }, signal());
      expect(file.status).toBe("ok");
      expect(file.entry?.kind).toBe("file");
      expect(file.entry?.size).toBe(Buffer.byteLength(MAIN_TS, "utf8"));
      expect(file.entry?.path).toBe(join(canonicalRoot, "src", "main.ts"));
      const dir = await client.stat({ ...envelope(), path: "src" }, signal());
      expect(dir.entry?.kind).toBe("dir");
      const missing = await client.stat({ ...envelope(), path: "nope.txt" }, signal());
      expect(missing.status).toBe("ok");
      expect(missing.entry).toBeNull();
    });

    it("AC-13.2 rejects ../ traversal", async () => {
      await expectPathEscapeFrom(async () => {
        await collect(client.read({ ...envelope(), path: "../outside.txt" }, signal()));
      });
    });

    it("AC-13.2 rejects an absolute path outside the root", async () => {
      await expectPathEscapeFrom(async () => {
        await client.stat({ ...envelope(), path: join(base, "outside.txt") }, signal());
      });
    });

    it("AC-13.2 rejects a symlink inside the root pointing outside", async () => {
      await expectPathEscapeFrom(async () => {
        await collect(client.read({ ...envelope(), path: "link-out" }, signal()));
      });
    });

    it("AC-13.2 allows a path whose parent is a symlink resolving inside", async () => {
      const events = await collect(
        client.read({ ...envelope(), path: "subdir-link/main.ts" }, signal()),
      );
      const text = Buffer.concat(
        events.filter((event) => event.type === "chunk").map((event) => Buffer.from(event.bytes)),
      ).toString("utf8");
      expect(text).toBe(MAIN_TS);
    });

    it("rejects the /root-evil sibling prefix trap", async () => {
      await expectPathEscapeFrom(async () => {
        await client.stat({ ...envelope(), path: "../ws-evil/x.txt" }, signal());
      });
    });

    it("AC-13.3 read stops at the byte budget with truncated: true", async () => {
      const events = await collect(
        client.read({ ...envelope({ maxBytes: 1024 }), path: "big.txt" }, signal()),
      );
      const end = events.find((event) => event.type === "end");
      const total = events
        .filter((event) => event.type === "chunk")
        .reduce((sum, event) => sum + event.bytes.length, 0);
      expect(total).toBe(1024);
      expect(end?.frame.status).toBe("ok");
      expect(end?.frame.truncated).toBe(true);
      expect(end?.frame.totalLines).toBe(16384);
    });

    it("AC-13.3 read aborts at the time budget with elapsedMs", async () => {
      const fifo = join(root, "stall");
      execFileSync("mkfifo", [fifo]);
      const writer = openSync(fifo, constants.O_RDWR);
      try {
        const events = await collect(
          client.read({ ...envelope({ maxMs: 300 }), path: "stall" }, signal()),
        );
        const end = events.find((event) => event.type === "end");
        expect(end?.frame.status).toBe("timeout");
        expect(end?.frame.elapsedMs ?? 0).toBeGreaterThanOrEqual(200);
        expect(end?.frame.totalLines).toBeNull();
      } finally {
        closeSync(writer);
      }
    });

    it("exec streams stdout and reports exitCode 0", async () => {
      const events = await collect(
        client.exec({ ...envelope(), program: "/bin/echo", argv: ["hello", "world"] }, signal()),
      );
      const text = Buffer.concat(
        events.filter((event) => event.type === "stdout").map((event) => Buffer.from(event.bytes)),
      ).toString("utf8");
      const end = events.find((event) => event.type === "end");
      expect(text).toBe("hello world\n");
      expect(end?.frame.status).toBe("ok");
      expect(end?.frame.exitCode).toBe(0);
    });

    it("AC-13.4 treats argv as literal: no shell interpretation", async () => {
      const events = await collect(
        client.exec({ ...envelope(), program: "/bin/echo", argv: ["; rm -rf x"] }, signal()),
      );
      const text = Buffer.concat(
        events.filter((event) => event.type === "stdout").map((event) => Buffer.from(event.bytes)),
      ).toString("utf8");
      expect(text).toContain("; rm -rf x");
      expect(existsSync(join(root, "sentinel.txt"))).toBe(true);
    });

    it("AC-13.3 exec stops a chatty program at the byte budget", async () => {
      const events = await collect(
        client.exec(
          { ...envelope({ maxBytes: 512 }), program: "/bin/cat", argv: ["big.txt"] },
          signal(),
        ),
      );
      const end = events.find((event) => event.type === "end");
      const total = events
        .filter((event) => event.type === "stdout" || event.type === "stderr")
        .reduce((sum, event) => sum + event.bytes.length, 0);
      expect(total).toBe(512);
      expect(end?.frame.status).toBe("ok");
      expect(end?.frame.truncated).toBe(true);
    });

    it("AC-13.3 exec kills a sleeping program at the time budget", async () => {
      const events = await collect(
        client.exec({ ...envelope({ maxMs: 300 }), program: "/bin/sleep", argv: ["30"] }, signal()),
      );
      const end = events.find((event) => event.type === "end");
      expect(end?.frame.status).toBe("timeout");
      expect(end?.frame.elapsedMs ?? 0).toBeGreaterThanOrEqual(200);
    });

    it("AC-13.5 glob matches the recorded rg table", async () => {
      const all = await client.glob({ ...envelope(), pattern: "**/*.ts" }, signal());
      expect(all.status).toBe("ok");
      expect(all.paths).toEqual(["app.ts", "src/main.ts", "src/util.ts"]);
      const src = await client.glob({ ...envelope(), pattern: "src/*.ts" }, signal());
      expect(src.paths).toEqual(["src/main.ts", "src/util.ts"]);
    });

    it("AC-13.5 glob honours .gitignore unless includeIgnored", async () => {
      const excluded = await client.glob({ ...envelope(), pattern: "**/*.log" }, signal());
      expect(excluded.paths).toEqual([]);
      const included = await client.glob(
        { ...envelope(), pattern: "**/*.log", includeIgnored: true },
        signal(),
      );
      expect(included.paths).toEqual(["ignored.log"]);
      const bundle = await client.glob({ ...envelope(), pattern: "**/bundle.js" }, signal());
      expect(bundle.paths).toEqual([]);
    });

    it("glob refuses extglob as unsupported-pattern", async () => {
      try {
        await client.glob({ ...envelope(), pattern: "src/!(*.ts)" }, signal());
      } catch (error) {
        expect(isStubError(error)).toBe(true);
        if (isStubError(error)) expect(error.kind).toBe("unsupported-pattern");
        return;
      }
      expect.unreachable("expected an unsupported-pattern StubError");
    });

    it("AC-13.5 grep matches the recorded rg table with byte offsets", async () => {
      const events = await collect(client.grep({ ...envelope(), pattern: "needle" }, signal()));
      const matches = events.filter((event) => event.type === "match").map((event) => event.match);
      const mainOffsets = lineByteOffsets(MAIN_TS);
      const notes = "just a needle in notes\nsecond line here\n";
      const notesOffsets = lineByteOffsets(notes);
      const mainNeedle2 = "// needle one: the quick brown fox".indexOf("needle");
      const mainNeedle3 = 'export const beta = "needle two here";'.indexOf("needle");
      expect(matches).toEqual([
        {
          path: "notes.txt",
          lineNumber: 1,
          byteOffset: notesOffsets[0] ?? 0,
          line: "just a needle in notes",
          submatches: [
            {
              start: "just a ".length,
              end: "just a ".length + "needle".length,
            },
          ],
        },
        {
          path: "src/main.ts",
          lineNumber: 2,
          byteOffset: mainOffsets[1] ?? 0,
          line: "// needle one: the quick brown fox",
          submatches: [{ start: mainNeedle2, end: mainNeedle2 + "needle".length }],
        },
        {
          path: "src/main.ts",
          lineNumber: 3,
          byteOffset: mainOffsets[2] ?? 0,
          line: 'export const beta = "needle two here";',
          submatches: [{ start: mainNeedle3, end: mainNeedle3 + "needle".length }],
        },
      ]);
      const end = events.find((event) => event.type === "end");
      expect(end?.frame.status).toBe("ok");
    });

    it("grep filters through globs and caseInsensitive", async () => {
      const scoped = await collect(
        client.grep({ ...envelope(), pattern: "needle", globs: ["src/*.ts"] }, signal()),
      );
      expect(
        scoped.filter((event) => event.type === "match").map((event) => event.match.path),
      ).toEqual(["src/main.ts", "src/main.ts"]);
      const sensitive = await collect(client.grep({ ...envelope(), pattern: "NEEDLE" }, signal()));
      expect(sensitive.some((event) => event.type === "match")).toBe(false);
      const folded = await collect(
        client.grep({ ...envelope(), pattern: "NEEDLE", caseInsensitive: true }, signal()),
      );
      expect(folded.filter((event) => event.type === "match")).toHaveLength(3);
    });

    it("grep honours maxMatchesPerFile", async () => {
      const events = await collect(
        client.grep({ ...envelope(), pattern: "tick", maxMatchesPerFile: 2 }, signal()),
      );
      expect(
        events.filter((event) => event.type === "match").map((event) => event.match.lineNumber),
      ).toEqual([1, 2]);
    });

    it("AC-12.6 grep refuses lookahead rather than silently accepting it", async () => {
      try {
        await collect(client.grep({ ...envelope(), pattern: "needle(?= one)" }, signal()));
      } catch (error) {
        expect(isStubError(error)).toBe(true);
        if (isStubError(error)) expect(error.kind).toBe("unsupported-pattern");
        return;
      }
      expect.unreachable("expected an unsupported-pattern StubError");
    });

    it("write, shell and batch throw not-implemented naming the milestone", async () => {
      for (const [method, milestone] of [
        ["write", "M3 (LRN-26)"],
        ["shell", "M3 (LRN-27)"],
        ["batch", "M3"],
      ] as const) {
        try {
          if (method === "write") {
            await client.write({ ...envelope(), path: "x.txt", contents: "x" }, signal());
          } else if (method === "shell") {
            await collect(
              client.shell({ ...envelope(), command: "echo x", plannedSubcommands: [] }, signal()),
            );
          } else {
            await client.batch({ ...envelope(), ops: [] }, signal());
          }
        } catch (error) {
          expect(isStubError(error)).toBe(true);
          if (isStubError(error)) {
            expect(error.kind).toBe("not-implemented");
            expect(error.message).toContain(milestone);
          }
          continue;
        }
        expect.unreachable(`expected not-implemented for ${method}`);
      }
    });
  });
}
