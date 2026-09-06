/** AC-6.5 + recovery prerequisite: actual processes, no sockets or inference. */
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { v7 } from "uuid";
import { afterEach, expect, it } from "vitest";
import { JournalReader, JournalWriter, journalPaths } from "../src/index.js";

const roots: string[] = [];
const children: ReturnType<typeof spawn>[] = [];
async function location() {
  const root = await mkdtemp(join(tmpdir(), "om-lock-"));
  roots.push(root);
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  return { omHome: join(root, "home"), projectRoot, sessionId: v7() };
}
// AC-8.5: this child runs our own code, so it gets the shared network guard
// too, via --import rather than vitest's setupFiles (which only covers the
// worker process, not processes we spawn from it).
const guardUrl = fileURLToPath(new URL("../../../tests/guards/no-network.mjs", import.meta.url));
function child(options: unknown, stage: string) {
  const process = spawn(
    globalThis.process.execPath,
    [
      "--import",
      guardUrl,
      fileURLToPath(new URL("./fixtures/journal-child.mjs", import.meta.url)),
      JSON.stringify(options),
      stage,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(process);
  const exited = new Promise<void>((resolve, reject) => {
    process.once("error", reject);
    process.once("exit", () => resolve());
  });
  return { process, exited };
}
afterEach(async () => {
  for (const process of children.splice(0))
    if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("AC-6.5 names the live holder, refuses immediately, and reacquires after SIGKILL", async () => {
  const loc = await location();
  const holder = child(loc, "hold");
  await new Promise<void>((resolve, reject) => {
    holder.process.stdout?.once("data", () => resolve());
    holder.process.once("exit", () => reject(new Error("holder exited before ready")));
  });
  const started = performance.now();
  await expect(JournalWriter.open(loc)).rejects.toMatchObject({
    kind: "locked",
    details: { pid: holder.process.pid },
  });
  expect(performance.now() - started).toBeLessThan(1000);
  holder.process.kill("SIGKILL");
  await holder.exited;
  const writer = await JournalWriter.open(loc);
  await writer.close();
});

it.each(["backup-synced", "replacement-synced", "replacement-published"])(
  "restart after %s preserves committed prefix and one published repair",
  async (stage) => {
    const loc = await location();
    let writer = await JournalWriter.open(loc);
    await writer.append(
      { kind: "user_message", schemaVersion: 1, text: "preserve" },
      { by: "user" },
    );
    await writer.close();
    const path = journalPaths(loc, loc.sessionId).journal;
    const prefix = await readFile(path);
    await appendFile(path, "{partial");
    const killed = child(loc, stage);
    await killed.exited;
    expect(killed.process.signalCode).toBe("SIGKILL");
    writer = await JournalWriter.open(loc);
    await writer.close();
    expect((await readFile(path)).subarray(0, prefix.length)).toEqual(prefix);
    expect(
      (await new JournalReader(loc).readAll(loc.sessionId)).records.map((r) => r.entry.kind),
    ).toEqual(["user_message", "repair"]);
  },
);

it.each(["append-written", "append-synced"])(
  "restart after %s reads complete records without replaying an append",
  async (stage) => {
    const loc = await location();
    const killed = child(loc, stage);
    await killed.exited;
    expect(killed.process.signalCode).toBe("SIGKILL");
    const writer = await JournalWriter.open(loc);
    await writer.close();
    expect((await new JournalReader(loc).readAll(loc.sessionId)).records).toHaveLength(1);
  },
);
