/**
 * Repository discovery (LRN-20, AC-20.1/20.2/20.4, LR-FR-024).
 *
 * Resolves the workspace root and loads `AGENTS.md` then `CLAUDE.md` into
 * the prompt in that order, journaled by content hash (the kernel's `prompt`
 * entry already carries path+sha256 — this module is the caller that was
 * missing). All reads go through the stub driver (DoD-5); only path+hash
 * ever reach the journal, content stays in memory for prompt assembly.
 *
 * Deferred with intent (AC-20.4): telling worktrees apart from main
 * checkouts, and monorepo package detection, are out of scope until needed.
 * `.gitignore` enforcement needs no code here: the local-ts driver delegates
 * search to `rg`, which is ignore-aware by construction (AC-20.3, ADR-025).
 */

import { createHash } from "node:crypto";
import type { InstructionFile } from "@om-code/kernel";
import type { CapabilityRequest } from "@om-code/protocol";
import { findGitRoot, findProjectRoot } from "@om-code/storage";
import type { StubClient } from "@om-code/stub-client";

export type DiscoveredRepository = {
  /** Workspace root: the git root, or cwd in single-directory mode. */
  readonly root: string;
  /** Git root, or `null` outside any repo (explicit single-directory mode). */
  readonly gitRoot: string | null;
};

export function discoverRepository(cwd: string): DiscoveredRepository {
  return { root: findProjectRoot(cwd), gitRoot: findGitRoot(cwd) };
}

/** Instruction files in prompt order (AC-20.2). */
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/** Files above this are skipped with a warning, never truncated into the prompt. */
const MAX_INSTRUCTION_BYTES = 64 * 1024;

const INSTRUCTION_READ_MS = 10_000;

export type InstructionDeps = {
  readonly stub: StubClient;
  /** Project root the files are read from (discovery's `root`). */
  readonly root: string;
  readonly signal: AbortSignal;
  readonly warn: (text: string) => void;
};

async function readOne(deps: InstructionDeps, name: string): Promise<InstructionFile | undefined> {
  const capability: CapabilityRequest = {
    filesystem: { read: [name], write: [] },
    risk_class: "read",
  };
  const envelope = {
    maxMs: INSTRUCTION_READ_MS,
    cwd: deps.root,
    envAllowlist: [] as string[],
    capability,
  };
  const stat = await deps.stub.stat({ ...envelope, maxBytes: 1024, path: name }, deps.signal);
  if (stat.entry === null) return undefined;
  if (stat.entry.size > MAX_INSTRUCTION_BYTES) {
    deps.warn(
      `om: skipping ${name}: ${stat.entry.size} bytes exceeds the ${MAX_INSTRUCTION_BYTES}-byte instruction budget\n`,
    );
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  for await (const event of deps.stub.read(
    { ...envelope, maxBytes: MAX_INSTRUCTION_BYTES, path: name },
    deps.signal,
  )) {
    if (event.type === "chunk") chunks.push(event.bytes);
    else if (event.frame.truncated) {
      // Raced growth between stat and read: skip rather than half-load.
      deps.warn(`om: skipping ${name}: grew past the instruction budget while reading\n`);
      return undefined;
    }
  }
  const content = Buffer.concat(chunks).toString("utf8");
  return {
    path: name,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    content,
  };
}

export async function loadInstructionFiles(deps: InstructionDeps): Promise<InstructionFile[]> {
  const loaded: InstructionFile[] = [];
  for (const name of INSTRUCTION_FILES) {
    const file = await readOne(deps, name);
    if (file !== undefined) loaded.push(file);
  }
  return loaded;
}
