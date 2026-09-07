/**
 * LRN-20 repository discovery (AC-20.1, AC-20.2, AC-20.4, DoD-1/DoD-2).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GrepParams, ReadParams, StatParams } from "@om-code/protocol";
import type { StubClient } from "@om-code/stub-client";
import { StubError } from "@om-code/stub-client";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRepository, loadInstructionFiles } from "../src/discovery.js";

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function repo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "om-discovery-"));
  trees.push(root);
  mkdirSync(join(root, ".git"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

/** Minimal StubClient backed by real temp files; unneeded methods throw. */
function fileStub(): StubClient {
  const unused = (): never => {
    throw new StubError("io", "unused stub method");
  };
  return {
    health: () => unused(),
    write: () => unused(),
    batch: () => unused(),
    shell: () => unused(),
    exec: () => unused(),
    glob: () => unused(),
    stat: async (params: StatParams) => {
      const { statSync } = await import("node:fs");
      try {
        const info = statSync(join(params.cwd, params.path));
        return {
          status: "ok" as const,
          bytes: 0,
          truncated: false,
          elapsedMs: 0,
          entry: { path: params.path, kind: "file" as const, size: info.size },
        };
      } catch {
        return {
          status: "ok" as const,
          bytes: 0,
          truncated: false,
          elapsedMs: 0,
          entry: null,
        };
      }
    },
    read: async function* (params: ReadParams) {
      const { readFileSync } = await import("node:fs");
      const bytes = readFileSync(join(params.cwd, params.path));
      const allowed = params.maxBytes;
      if (bytes.length > allowed) {
        yield { type: "chunk" as const, bytes: new Uint8Array(bytes.subarray(0, allowed)) };
        yield {
          type: "end" as const,
          frame: {
            status: "ok" as const,
            bytes: bytes.length,
            truncated: true,
            elapsedMs: 0,
            totalLines: null,
          },
        };
        return;
      }
      yield { type: "chunk" as const, bytes: new Uint8Array(bytes) };
      yield {
        type: "end" as const,
        frame: {
          status: "ok" as const,
          bytes: bytes.length,
          truncated: false,
          elapsedMs: 0,
          totalLines: null,
        },
      };
    },
    grep: (_params: GrepParams) => unused(),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("discoverRepository", () => {
  it("AC-20.1 resolves the git root from a subdirectory", () => {
    const root = repo();
    const sub = join(root, "packages", "cli");
    mkdirSync(sub, { recursive: true });
    expect(discoverRepository(sub)).toEqual({ root, gitRoot: root });
  });

  it("AC-20.1 outside a repo is single-directory mode, not a crash", () => {
    const lone = mkdtempSync(join(tmpdir(), "om-lone-"));
    trees.push(lone);
    expect(discoverRepository(lone)).toEqual({ root: lone, gitRoot: null });
  });
});

describe("loadInstructionFiles", () => {
  it("AC-20.2 loads AGENTS.md then CLAUDE.md with content hashes", async () => {
    const root = repo({ "AGENTS.md": "# A\n", "CLAUDE.md": "# C\n" });
    const warnings: string[] = [];
    const files = await loadInstructionFiles({
      stub: fileStub(),
      root,
      signal: new AbortController().signal,
      warn: (text) => warnings.push(text),
    });
    expect(files.map((file) => file.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(files[0]).toMatchObject({ sha256: sha256("# A\n"), content: "# A\n" });
    expect(files[1]).toMatchObject({ sha256: sha256("# C\n"), content: "# C\n" });
    expect(warnings).toEqual([]);
  });

  it("a missing file is absent, not an error", async () => {
    const root = repo({ "CLAUDE.md": "# C\n" });
    const warnings: string[] = [];
    const files = await loadInstructionFiles({
      stub: fileStub(),
      root,
      signal: new AbortController().signal,
      warn: (text) => warnings.push(text),
    });
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md"]);
    expect(warnings).toEqual([]);
  });

  it("an oversize file is skipped with a warning, never half-loaded", async () => {
    const big = `x`.repeat(70 * 1024);
    const root = repo({ "AGENTS.md": big, "CLAUDE.md": "# C\n" });
    const warnings: string[] = [];
    const files = await loadInstructionFiles({
      stub: fileStub(),
      root,
      signal: new AbortController().signal,
      warn: (text) => warnings.push(text),
    });
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("AGENTS.md");
  });

  it("a failing driver surfaces its typed error (DoD-2)", async () => {
    const root = repo();
    const failing: StubClient = {
      ...fileStub(),
      stat: async () => {
        throw new StubError("io", "disk gone");
      },
    };
    await expect(
      loadInstructionFiles({
        stub: failing,
        root,
        signal: new AbortController().signal,
        warn: () => {},
      }),
    ).rejects.toThrow("disk gone");
  });
});
