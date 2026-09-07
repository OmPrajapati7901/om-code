import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps all illegal-transition compile-time assertions (AC-10.1)", () => {
  const source = readFileSync(new URL("./types/illegal-transitions.ts", import.meta.url), "utf8");
  expect(source.match(/@ts-expect-error/g)).toHaveLength(9);
});
