/**
 * AC-16.1: a `Tool` lacking `plan()` does not compile.
 *
 * Follows the `tests/boundary-lint.test.ts` idiom exactly: fixtures live as
 * `*.ts.txt` so `tsc` and Biome never walk them, and the test builds a temp
 * tree with a tsconfig extending the repo's `tsconfig.base.json` by absolute
 * path, mapping `@om-code/tools` (and its protocol dependency) to sources so
 * no build is needed. Both fixtures compile in one `tsc --noEmit` run: the
 * missing-plan file must error naming `plan`, and the complete file must
 * carry no diagnostics — the positive control that stops this test passing
 * for the wrong reason.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const tscBin = join(root, "node_modules", ".bin", "tsc");

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

it("a tool without plan() fails typecheck while a complete tool passes", () => {
  const tree = mkdtempSync(join(tmpdir(), "om-tool-type-"));
  trees.push(tree);
  const fixtureDir = join(root, "tests", "fixtures", "tool-type");
  for (const fixture of ["missing-plan", "complete-tool"] as const) {
    copyFileSync(join(fixtureDir, `${fixture}.ts.txt`), join(tree, `${fixture}.ts`));
  }
  // The temp tree mirrors a real package: ESM (NodeNext treats .ts as
  // CommonJS without it) and node types for AbortSignal.
  writeFileSync(join(tree, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    join(tree, "tsconfig.json"),
    JSON.stringify({
      extends: join(root, "tsconfig.base.json"),
      compilerOptions: {
        baseUrl: tree,
        paths: {
          "@om-code/tools": [join(root, "packages", "tools", "src", "index.ts")],
          "@om-code/protocol": [join(root, "packages", "protocol", "src", "index.ts")],
        },
        types: ["node"],
        // pnpm does not hoist: @types/node lives in each workspace.
        typeRoots: [join(root, "tests", "node_modules", "@types")],
        noEmit: true,
      },
      include: ["missing-plan.ts", "complete-tool.ts"],
    }),
  );
  let output = "";
  try {
    execFileSync(tscBin, ["-p", join(tree, "tsconfig.json")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
  }
  expect(output).toMatch(/missing-plan\.ts.*\bplan\b|\bplan\b.*missing-plan\.ts/s);
  expect(output).not.toMatch(/complete-tool\.ts/);
});
