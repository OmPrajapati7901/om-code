import type { GrepEvent, GrepParams } from "@om-code/protocol";
import { expect, it } from "vitest";
import { createGrepTool } from "../src/index.js";
import { collect, context, fakeIo, grepEvents } from "./fixtures.js";

const end: GrepEvent = {
  type: "end",
  frame: { status: "ok", bytes: 42, truncated: true, elapsedMs: 2 },
};

it("renders path:line:text and counts matches and files", async () => {
  const events = await collect(
    createGrepTool().execute(
      { pattern: "needle" },
      fakeIo({
        grep: () =>
          grepEvents([
            {
              type: "match",
              match: {
                path: "a.ts",
                lineNumber: 2,
                byteOffset: 4,
                line: "needle one",
                submatches: [{ start: 0, end: 6 }],
              },
            },
            {
              type: "match",
              match: {
                path: "b.ts",
                lineNumber: 8,
                byteOffset: 30,
                line: "two needle",
                submatches: [{ start: 4, end: 10 }],
              },
            },
            end,
          ]),
      }),
      context(),
    ),
  );
  const preview = 'grep "needle" in . — 2 matches in 2 files\na.ts:2:needle one\nb.ts:8:two needle';
  expect(events).toEqual([
    { type: "output", text: preview },
    {
      type: "end",
      result: { status: "ok", preview, bytes: 42, truncated: true },
    },
  ]);
});

it("renders zero matches as a successful result", async () => {
  let params: GrepParams | undefined;
  const events = await collect(
    createGrepTool().execute(
      {
        pattern: "absent",
        root: "src",
        globs: ["**/*.ts"],
        caseInsensitive: true,
      },
      fakeIo({
        grep: (received) => {
          params = received;
          return grepEvents([{ ...end, frame: { ...end.frame, truncated: false } }]);
        },
      }),
      context(),
    ),
  );
  expect(events[0]).toEqual({
    type: "output",
    text: 'grep "absent" in src — 0 matches in 0 files',
  });
  expect(events[1]).toMatchObject({ type: "end", result: { status: "ok" } });
  expect(params).toMatchObject({
    root: "src",
    globs: ["**/*.ts"],
    caseInsensitive: true,
  });
});
