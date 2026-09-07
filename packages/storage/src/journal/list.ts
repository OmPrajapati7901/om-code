/** Deliberately small session discovery surface owned by storage. */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { recordIdSchema } from "@om-code/protocol";
import { type JournalLocation, journalPaths } from "./files.js";

export type ListedSession = { readonly sessionId: string; readonly path: string };

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function listSessions(location: JournalLocation): Promise<ListedSession[]> {
  // journalPaths centralizes project hashing and OM_HOME resolution. The id is
  // used only to obtain its containing directory.
  const directory = journalPaths(location, "00000000-0000-7000-8000-000000000000").directory;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({ name, sessionId: name.slice(0, -".jsonl".length) }))
    .filter(({ sessionId }) => recordIdSchema.safeParse(sessionId).success)
    .sort((left, right) => right.sessionId.localeCompare(left.sessionId))
    .map(({ name, sessionId }) => ({ sessionId, path: join(directory, name) }));
}
