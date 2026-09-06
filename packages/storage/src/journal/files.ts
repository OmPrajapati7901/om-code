/** Reviewed host-state boundary: only application-owned session files. */

import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { type FileHandle, lstat, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { recordIdSchema } from "@om-code/protocol";
import { resolveOmHome } from "../config/paths.js";
import { JournalError } from "./errors.js";

export type JournalLocation = { omHome?: string; projectRoot: string };
export type JournalPaths = {
  home: string;
  sessions: string;
  directory: string;
  journal: string;
  lock: string;
};

export function journalPaths(location: JournalLocation, sessionId: string): JournalPaths {
  if (!recordIdSchema.safeParse(sessionId).success)
    throw new JournalError("invalid-id", "invalid session UUIDv7");
  const root = realpathSync.native(location.projectRoot);
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const home =
    location.omHome === undefined ? resolveOmHome(process.env) : resolve(location.omHome);
  const sessions = join(home, "sessions");
  const directory = join(sessions, hash);
  return {
    home,
    sessions,
    directory,
    journal: join(directory, `${sessionId}.jsonl`),
    lock: join(directory, `${sessionId}.lock`),
  };
}

export function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function checkDirectory(path: string, create = false): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new JournalError("unsafe-path", `not a real directory: ${path}`);
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    const opened = await handle.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev)
      throw new JournalError("unsafe-path", `directory changed: ${path}`);
    if (create) await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

export async function checkDirectories(paths: JournalPaths, create = false): Promise<void> {
  for (const path of [paths.home, paths.sessions, paths.directory])
    await checkDirectory(path, create);
}

export async function openRegular(
  path: string,
  flags: number,
  enforceMode = false,
): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  } catch (error) {
    if (hasCode(error, "ELOOP")) throw new JournalError("unsafe-path", `symlink refused: ${path}`);
    throw error;
  }
  try {
    const info = await handle.stat();
    const named = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.ino !== named.ino || info.dev !== named.dev) {
      throw new JournalError("unsafe-path", `not a private regular file: ${path}`);
    }
    if (enforceMode) await handle.chmod(0o600);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readExtent(handle: FileHandle): Promise<Buffer> {
  const { size } = await handle.stat();
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (bytesRead === 0) throw new JournalError("unreadable", "journal shrank during read");
    offset += bytesRead;
  }
  return bytes;
}
