/**
 * LRN-21a completion clause (X-4): the shape LRN-16's `plan()` already
 * produces is consumed unchanged by `evaluate` — no reshaping on either
 * side. Plus LRN-21b/AC-21.3 through genuine `plan()` output. Lives here
 * (not in `packages/policy`) so policy keeps its protocol-only boundary;
 * the root workspace already depends on both.
 */
import { evaluate, resolveTiers } from "@om-code/policy";
import { readOnlyTools } from "@om-code/tools";
import { expect, it } from "vitest";

const ctx = {
  cwd: "/repo",
  envAllowlist: [],
  budget: { maxBytes: 4096, maxMs: 5000 },
  signal: new AbortController().signal,
};

it("X-4 evaluates real plan() capabilities without translation", async () => {
  const tools = readOnlyTools();
  const inputs: Record<string, unknown> = {
    read: { path: "notes.md" },
    grep: { pattern: "auth" },
    glob: { pattern: "**/*.ts" },
  };
  for (const tool of tools) {
    const capability = await tool.plan(inputs[tool.descriptor().name] ?? {}, ctx);
    const decision = evaluate(capability, [
      { id: "allow-reads", outcome: "allow", reason: "reads are safe", match: {} },
    ]);
    expect(decision).toEqual({
      outcome: "allow",
      reason: "reads are safe",
      ruleId: "allow-reads",
    });
  }
});

it("X-4 a read plan matches a scoped path rule by its capability paths", async () => {
  const read = readOnlyTools().find((tool) => tool.descriptor().name === "read");
  if (read === undefined) throw new Error("read tool missing");
  const capability = await read.plan({ path: "src/auth.ts" }, ctx);
  expect(
    evaluate(capability, [
      { id: "deny-src", outcome: "deny", reason: "locked", match: { paths: ["src"] } },
    ]).ruleId,
  ).toBe("deny-src");
});

it("AC-21.3 a user deny beats a session allow-all on a real plan() capability", async () => {
  const read = readOnlyTools().find((tool) => tool.descriptor().name === "read");
  if (read === undefined) throw new Error("read tool missing");
  const capability = await read.plan({ path: "src/auth.ts" }, ctx);
  const decision = resolveTiers(capability, [
    { tier: "user", rules: [{ id: "u-deny", outcome: "deny", reason: "locked", match: {} }] },
    { tier: "session", rules: [{ id: "s-allow", outcome: "allow", reason: "grant", match: {} }] },
  ]);
  expect(decision).toMatchObject({ outcome: "deny", tier: "user", ruleId: "u-deny" });
});
