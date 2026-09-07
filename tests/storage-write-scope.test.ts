/**
 * AC-14.3: `packages/storage` may write only under `~/.om-code/` (the test's
 * temp `omHome`); it must never write a workspace path.
 *
 * Runtime proof drives a real `JournalWriter` through session start, appends
 * and a repair while snapshotting the project root: the listing must be
 * identical afterwards, while journal, lock and backup all land under
 * `omHome/sessions/<hash>/`. The static guard pins the set of storage
 * modules importing a write-capable `node:fs` API, so a new one is a
 * deliberate, reviewed diff. (`journal/lock.ts` writes only through handles
 * opened by `journal/files.ts`, and `config/credential.ts` only spawns the
 * platform keychain, so neither imports a write-capable fs API directly.)
 */

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JournalWriter, journalPaths } from "@om-code/storage";
import { afterEach, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function snapshot(directory: string): string[] {
  return readdirSync(directory, { recursive: true }).map(String).sort();
}

const SESSION_ID = "0193b4c8-0000-7000-8000-000000000014";

it("session start, appends and repair leave the project root untouched", async () => {
  const tree = mkdtempSync(join(tmpdir(), "om-write-scope-"));
  trees.push(tree);
  const projectRoot = join(tree, "project");
  const omHome = join(tree, "home");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  const before = snapshot(projectRoot);

  const location = { omHome, projectRoot };
  const paths = journalPaths(location, SESSION_ID);
  expect(relative(projectRoot, paths.journal).startsWith(`..${sep}`)).toBe(true);

  const first = await JournalWriter.open({ ...location, sessionId: SESSION_ID });
  await first.append({ kind: "user_message", schemaVersion: 1, text: "hello" }, { by: "user" });
  await first.append({ kind: "user_message", schemaVersion: 1, text: "world" }, { by: "user" });
  await first.close();
  // Simulate a crash between effect and durable result: an unterminated
  // final fragment. Reopening must repair it, writing backup + replacement.
  appendFileSync(paths.journal, '{"v":1,"seq":99,');
  const second = await JournalWriter.open({ ...location, sessionId: SESSION_ID });
  await second.append(
    { kind: "user_message", schemaVersion: 1, text: "after repair" },
    { by: "user" },
  );
  await second.close();

  expect(snapshot(projectRoot)).toEqual(before);
  expect(snapshot(projectRoot)).not.toContain(".om-code");
  const sessionFiles = snapshot(paths.directory);
  expect(sessionFiles.some((name) => name === `${SESSION_ID}.jsonl`)).toBe(true);
  expect(sessionFiles.some((name) => name === `${SESSION_ID}.lock`)).toBe(true);
  expect(sessionFiles.some((name) => name.startsWith(`${SESSION_ID}.jsonl.corrupt.`))).toBe(true);
});

const WRITE_CAPABLE = new Set(["mkdir", "open", "rename", "unlink", "writeFile", "chmod"]);
const SPECIFIER_PATTERN = /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g;

function importedNames(source: string): string[] {
  return [...source.matchAll(SPECIFIER_PATTERN)].flatMap((match) =>
    (match[1] ?? "").split(",").map((name) => name.trim().split(/\s+/).at(-1) ?? ""),
  );
}

function tsFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? tsFiles(join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(directory, entry.name)]
        : [],
  );
}

it("exactly journal/files.ts, journal/writer.ts and blobs/store.ts import write-capable fs APIs", () => {
  const src = join(root, "packages", "storage", "src");
  const writers = tsFiles(src)
    .filter((file) => importedNames(readFileSync(file, "utf8")).some((n) => WRITE_CAPABLE.has(n)))
    .map((file) => relative(root, file));
  expect(writers.sort()).toEqual([
    join("packages", "storage", "src", "blobs", "store.ts"),
    join("packages", "storage", "src", "journal", "files.ts"),
    join("packages", "storage", "src", "journal", "writer.ts"),
  ]);
});
