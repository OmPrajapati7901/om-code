/** Temporary dependency checks until LRN-14; test-only OS reads are allowed. */
import { readdirSync, readFileSync } from "node:fs";
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
it.each(["session", "providers"])(
  "%s keeps approved dependencies and performs no direct file/process I/O",
  (name) => {
    const path = resolve(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["@om-code/protocol"]);
    for (const file of files(join(path, "src"))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /(?:from\s*|import\s*\()["'](?:node:)?(?:fs(?:\/promises)?|child_process)["']/,
      );
      if (name === "session") expect(source).not.toMatch(/["']node:/);
    }
  },
);

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
