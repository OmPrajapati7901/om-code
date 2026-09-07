/**
 * What neither lint tool expresses (LRN-14 owns the rest). Biome's
 * `noRestrictedImports` bans `node:fs`/`child_process`/`module`/`os` outside
 * `storage`/`stub-client` (AC-14.1, asserted by `boundary-lint.test.ts`), and
 * `dependency-cruiser` enforces direction on the real import graph (AC-14.4).
 * This file keeps the declared-manifest allowlist — which catches
 * declared-but-unused workspace deps that dependency-cruiser cannot see —
 * plus the clock (AC-9.4), system-message (AC-9.1) and model-name (AC-7.5)
 * greps. Test-only OS reads are allowed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(path, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(path, entry.name)]
        : [],
  );
}

type BoundarySpec = {
  readonly name: string;
  readonly allowedDependencies: readonly string[];
  readonly bannedDependencies: readonly string[];
  readonly bansClockReads: boolean;
};

const BOUNDARIES: readonly BoundarySpec[] = [
  {
    name: "cli",
    allowedDependencies: [
      "@om-code/kernel",
      "@om-code/protocol",
      "@om-code/providers",
      "@om-code/session",
      "@om-code/storage",
      "@om-code/stub-client",
      "@om-code/tools",
      "uuid",
    ],
    bannedDependencies: ["@om-code/sandbox"],
    bansClockReads: false,
  },
  {
    name: "session",
    allowedDependencies: ["@om-code/protocol"],
    bannedDependencies: [],
    bansClockReads: false,
  },
  {
    name: "providers",
    allowedDependencies: ["@om-code/protocol"],
    bannedDependencies: [],
    bansClockReads: false,
  },
  {
    name: "kernel",
    allowedDependencies: ["@om-code/protocol", "@om-code/session"],
    bannedDependencies: [
      "@om-code/providers",
      "@om-code/storage",
      "@om-code/sandbox",
      "@om-code/stub-client",
    ],
    // AC-9.4: prompt assembly is a pure function of its input — the date is
    // passed in, never read live — so a clock call here is a regression.
    bansClockReads: true,
  },
  {
    name: "stub-client",
    allowedDependencies: ["@om-code/protocol"],
    bannedDependencies: ["@om-code/policy"],
    bansClockReads: false,
  },
  {
    name: "tools",
    allowedDependencies: ["@om-code/protocol", "zod"],
    bannedDependencies: [
      "@om-code/stub-client",
      "@om-code/storage",
      "@om-code/sandbox",
      "@om-code/providers",
      "@om-code/context",
    ],
    bansClockReads: false,
  },
];

it.each(BOUNDARIES)(
  "$name keeps approved dependencies and reads no live clock",
  ({ name, allowedDependencies, bannedDependencies, bansClockReads }) => {
    const path = resolve(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...allowedDependencies].sort());
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };
    expect(bannedDependencies.filter((dependency) => dependency in declared)).toEqual([]);
    if (!bansClockReads) return;
    for (const file of files(join(path, "src"))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\bnew\s+Date\s*\(\s*\)|\bDate\.now\s*\(/);
    }
  },
);

function declaredBannedDependencies(
  manifest: Record<string, Record<string, string> | undefined>,
  banned: readonly string[],
): string[] {
  const declared = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return banned.filter((dependency) => dependency in declared);
}

it("AC-10.5 dependency grep detects a planted kernel boundary violation", () => {
  expect(
    declaredBannedDependencies(
      { dependencies: {}, devDependencies: { "@om-code/storage": "workspace:*" } },
      ["@om-code/providers", "@om-code/storage"],
    ),
  ).toEqual(["@om-code/storage"]);
  expect(
    declaredBannedDependencies(
      { dependencies: { "@om-code/protocol": "workspace:*" }, devDependencies: {} },
      ["@om-code/providers", "@om-code/storage"],
    ),
  ).toEqual([]);
});

// A grep signal, not a proof against aliases/data-driven dispatch.
// dependency-cruiser owns direction; self-review still checks for a smuggled
// system message.
function buildsSystemMessage(source: string): boolean {
  // Requires a trailing comma so `{ role: "system" | "user"; ... }` — the
  // ModelMessage type union in protocol/src/model.ts — does not false-positive.
  return /role\s*:\s*["']system["']\s*,/.test(source);
}
it("AC-9.1 system-message grep detects planted violations and scans every package but kernel", () => {
  expect(buildsSystemMessage('return { role: "system", content: sys };')).toBe(true);
  expect(buildsSystemMessage("const role = message.role;")).toBe(false);
  expect(buildsSystemMessage('type M = { role: "system" | "user"; content: string };')).toBe(false);
  for (const packageName of readdirSync(resolve(root, "packages"))) {
    if (packageName === "kernel") continue;
    const srcPath = resolve(root, "packages", packageName, "src");
    if (!existsSync(srcPath)) continue;
    for (const file of files(srcPath)) {
      expect(buildsSystemMessage(readFileSync(file, "utf8"))).toBe(false);
    }
  }
});

// A grep signal, not a proof against aliases/data-driven dispatch.
// dependency-cruiser owns direction; self-review still checks model-derived
// behavior.
function branchesOnModel(source: string): boolean {
  // Type checks validate payloads; they do not infer model capabilities.
  const withoutTypeChecks = source.replace(
    /\btypeof\s+[\w.]+\s*(?:===|!==|==|!=)\s*["'](?:string|undefined|object|number|boolean|function|symbol|bigint)["']/g,
    "TYPE_CHECK",
  );
  return /\bmodel\s*(?:===|!==|==|!=)|\bmodel\.(?:includes|startsWith|endsWith|match)\s*\(|switch\s*\(\s*model\s*\)|["'](?:gpt-|claude-|llama|qwen|mistral|gemini)/i.test(
    withoutTypeChecks,
  );
}
it("AC-7.5 model-name grep detects planted branches and scans production source only", () => {
  expect(branchesOnModel('if (model.startsWith("gpt-")) {}')).toBe(true);
  expect(branchesOnModel("switch (model) {}")).toBe(true);
  expect(branchesOnModel("const body = { model: request.model };")).toBe(false);
  expect(branchesOnModel('if (typeof raw.model !== "string") throw Error();')).toBe(false);
  for (const file of files(join(root, "packages/providers/src")))
    expect(branchesOnModel(readFileSync(file, "utf8"))).toBe(false);
});
