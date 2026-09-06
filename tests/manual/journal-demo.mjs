// Manual journal acceptance against temporary host state. No inference/network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JournalReader, JournalWriter, journalPaths } from "../../packages/storage/dist/index.js";

const root = await mkdtemp(join(tmpdir(), "om-journal-demo-"));
const projectRoot = join(root, "project");
await mkdir(projectRoot);
const options = {
  projectRoot,
  omHome: join(root, "home"),
  sessionId: "0193b4c8-0000-7000-8000-000000000001",
};
let holder;
try {
  let writer = await JournalWriter.open(options);
  await writer.append({ kind: "user_message", schemaVersion: 1, text: "durable" }, { by: "user" });
  await writer.close();
  holder = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../packages/storage/tests/fixtures/journal-child.mjs", import.meta.url),
      ),
      JSON.stringify(options),
      "hold",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise((resolve) => holder.once("exit", resolve));
  await new Promise((resolve, reject) => {
    holder.stdout.once("data", resolve);
    holder.once("error", reject);
    holder.once("exit", () => reject(new Error("holder exited before ready")));
  });
  const start = performance.now();
  await assert.rejects(JournalWriter.open(options), (error) => {
    assert.equal(error.kind, "locked");
    assert.equal(error.details.pid, holder.pid);
    console.log(
      JSON.stringify({ refusal: error.message, latency_ms: Math.round(performance.now() - start) }),
    );
    return true;
  });
  holder.kill("SIGKILL");
  await exited;
  writer = await JournalWriter.open(options);
  await writer.close();
  const paths = journalPaths(options, options.sessionId);
  const lockInode = (await stat(paths.lock)).ino;
  await appendFile(paths.journal, '{"unfinished":');
  writer = await JournalWriter.open(options);
  await writer.close();
  const result = await new JournalReader(options).readAll(options.sessionId);
  assert.equal((await stat(paths.lock)).ino, lockInode);
  assert.equal(result.records[1].entry.kind, "repair");
  console.log(
    JSON.stringify({
      reacquired_after_sigkill: true,
      repair: result.records[1].entry,
      diagnostics: result.diagnostics,
      backups: (await readdir(paths.directory)).filter((name) => name.includes(".corrupt.")),
    }),
  );
  const modes = {};
  for (const [name, path] of Object.entries(paths))
    modes[name] = ((await stat(path)).mode & 0o777).toString(8);
  console.log(JSON.stringify({ modes, permanent_lock_inode_preserved: true }));
} finally {
  if (holder?.exitCode === null && holder?.signalCode === null) holder.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
}
