/** AC-14.1: OM_VERSION must track the manifest; tests may read fs. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { OM_VERSION, readVersion } from "../src/version.js";

it("OM_VERSION equals the version field in packages/cli/package.json", () => {
  const manifest = JSON.parse(
    readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "package.json"), "utf8"),
  ) as { version?: unknown };
  expect(manifest.version).toBe(OM_VERSION);
  expect(readVersion()).toBe(OM_VERSION);
});
