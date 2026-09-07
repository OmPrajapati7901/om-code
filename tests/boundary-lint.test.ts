/**
 * AC-14.2: a planted violation of each banned-import category must fail the
 * lint, and the exempt modules must still pass it.
 *
 * The fixtures live as `*.ts.txt` so they stay out of `tsc` and out of
 * Biome's own file walk ("removed from the build" without touching
 * `files.includes`). The test builds a temp tree, copies the real,
 * unmodified `biome.json` into its root so the path-scoped overrides resolve
 * against the same base they do in production, and plants each fixture in a
 * banned path (`packages/kernel/src`) and an allowed mirror
 * (`packages/storage/src`). Assertions read the parsed `lint` diagnostics,
 * not the exit code, which conflates lint with formatting.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const biomeBin = join(root, "node_modules", ".bin", "biome");

const FIXTURES = ["banned-fs.ts.txt", "banned-child-process.ts.txt"] as const;
const BANNED_DIR = "packages/kernel/src";
const ALLOWED_DIR = "packages/storage/src";

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

type LintDiagnostic = {
  readonly category?: unknown;
  readonly location?: { readonly path?: unknown };
};

function lint(tree: string): LintDiagnostic[] {
  let stdout: string;
  try {
    stdout = execFileSync(biomeBin, ["lint", "--reporter=json", "--vcs-enabled=false", "."], {
      cwd: tree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // Biome exits nonzero when diagnostics fire; the JSON is still on stdout.
    stdout = (error as { stdout?: string }).stdout ?? "";
  }
  const report = JSON.parse(stdout) as { diagnostics?: LintDiagnostic[] };
  return report.diagnostics ?? [];
}

it("planted fs/child_process imports fail in kernel and pass in storage", () => {
  const tree = mkdtempSync(join(tmpdir(), "om-boundary-lint-"));
  trees.push(tree);
  copyFileSync(join(root, "biome.json"), join(tree, "biome.json"));
  const fixtureDir = join(root, "tests", "fixtures", "boundary-lint");
  const bannedPaths: string[] = [];
  for (const fixture of FIXTURES) {
    const source = readFileSync(join(fixtureDir, fixture), "utf8");
    const fileName = fixture.replace(/\.txt$/, "");
    for (const dir of [BANNED_DIR, ALLOWED_DIR]) {
      mkdirSync(join(tree, dir), { recursive: true });
      writeFileSync(join(tree, dir, fileName), source);
    }
    bannedPaths.push(`${BANNED_DIR}/${fileName}`);
  }
  const categoriesByPath = new Map<string, string[]>();
  for (const diagnostic of lint(tree)) {
    const path = diagnostic.location?.path;
    if (typeof path !== "string") continue;
    const categories = categoriesByPath.get(path) ?? [];
    if (typeof diagnostic.category === "string") categories.push(diagnostic.category);
    categoriesByPath.set(path, categories);
  }
  for (const banned of bannedPaths) {
    expect(categoriesByPath.get(banned)).toContain("lint/style/noRestrictedImports");
  }
  for (const fixture of FIXTURES) {
    const allowed = `${ALLOWED_DIR}/${fixture.replace(/\.txt$/, "")}`;
    expect(categoriesByPath.get(allowed) ?? []).not.toContain("lint/style/noRestrictedImports");
  }
});
