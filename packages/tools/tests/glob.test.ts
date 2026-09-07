import type { GlobParams } from "@om-code/protocol";
import { expect, it } from "vitest";
import { createGlobTool } from "../src/index.js";
import { collect, context, fakeIo, globResult } from "./fixtures.js";

it("renders an unnumbered path list and passes the terminal frame through", async () => {
  let params: GlobParams | undefined;
  const events = await collect(
    createGlobTool().execute(
      { pattern: "**/*.ts", includeIgnored: true },
      fakeIo({
        glob: (received) => {
          params = received;
          return Promise.resolve(
            globResult({ paths: ["app.ts", "src/main.ts"], bytes: 18, truncated: true }),
          );
        },
      }),
      context(),
    ),
  );
  const preview = 'glob "**/*.ts" in . — 2 files\napp.ts\nsrc/main.ts';
  expect(events).toEqual([
    { type: "output", text: preview },
    {
      type: "end",
      result: { status: "ok", preview, bytes: 18, truncated: true },
    },
  ]);
  expect(params?.includeIgnored).toBe(true);
});

it("renders zero files without inventing numbered rows", async () => {
  const events = await collect(
    createGlobTool().execute(
      { pattern: "*.rs", root: "src" },
      fakeIo({ glob: () => Promise.resolve(globResult()) }),
      context(),
    ),
  );
  expect(events[0]).toEqual({
    type: "output",
    text: 'glob "*.rs" in src — 0 files',
  });
});
