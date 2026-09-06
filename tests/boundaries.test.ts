/** Temporary dependency checks until LRN-14; test-only OS reads are allowed. */
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
  readonly bansAllNodeImports: boolean;
  readonly bansClockReads: boolean;
};

const BOUNDARIES: readonly BoundarySpec[] = [
  {
    name: "session",
    allowedDependencies: ["@om-code/protocol"],
    bansAllNodeImports: true,
    bansClockReads: false,
  },
  {
    name: "providers",
    allowedDependencies: ["@om-code/protocol"],
    bansAllNodeImports: false,
    bansClockReads: false,
  },
  {
    name: "kernel",
    allowedDependencies: ["@om-code/protocol", "@om-code/session"],
    bansAllNodeImports: true,
    // AC-9.4: prompt assembly is a pure function of its input — the date is
    // passed in, never read live — so a clock call here is a regression.
    bansClockReads: true,
  },
];

it.each(BOUNDARIES)(
  "$name keeps approved dependencies and performs no direct file/process I/O",
  ({ name, allowedDependencies, bansAllNodeImports, bansClockReads }) => {
    const path = resolve(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...allowedDependencies].sort());
    for (const file of files(join(path, "src"))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /(?:from\s*|import\s*\()["'](?:node:)?(?:fs(?:\/promises)?|child_process)["']/,
      );
      if (bansAllNodeImports) expect(source).not.toMatch(/["']node:/);
      if (bansClockReads) expect(source).not.toMatch(/\bnew\s+Date\s*\(\s*\)|\bDate\.now\s*\(/);
    }
  },
);

// A grep signal, not a proof against aliases/data-driven dispatch. LRN-14 owns
// dependency-cruiser; self-review still checks for a smuggled system message.
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

// A grep signal, not a proof against aliases/data-driven dispatch. LRN-14 owns
// dependency-cruiser; self-review still checks model-derived behavior.
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
