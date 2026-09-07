import { expect, it } from "vitest";
import { createReadTool, isToolError, READ_REFUSAL_PREFIX, runTool } from "../src/index.js";
import { collect, context, fakeIo, readEvents } from "./fixtures.js";

const tool = createReadTool();

it("renders whole files and inclusive ranges with total line counts", async () => {
  const whole = await collect(
    tool.execute(
      { path: "src/main.ts" },
      fakeIo({ read: () => readEvents(["one\ntwo → here\n"], { totalLines: 2 }) }),
      context(),
    ),
  );
  expect(whole).toEqual([
    {
      type: "output",
      text: "src/main.ts (lines 1-2 of 2)\n     1→one\n     2→two → here",
    },
    {
      type: "end",
      result: {
        status: "ok",
        preview: "src/main.ts (lines 1-2 of 2)\n     1→one\n     2→two → here",
        bytes: 17,
        truncated: false,
      },
    },
  ]);

  const ranged = await collect(
    tool.execute(
      { path: "src/main.ts", startLine: 2, endLine: 3 },
      fakeIo({
        read: () => readEvents(["second\nthird\n"], { totalLines: 4 }),
      }),
      context(),
    ),
  );
  expect(ranged[0]).toEqual({
    type: "output",
    text: "src/main.ts (lines 2-3 of 4)\n     2→second\n     3→third",
  });
});

it("renders empty, unknown-total, and past-EOF headers", async () => {
  const empty = await collect(
    tool.execute(
      { path: "empty.txt" },
      fakeIo({ read: () => readEvents([], { totalLines: 0 }) }),
      context(),
    ),
  );
  expect(empty[0]).toEqual({ type: "output", text: "empty.txt (empty file)" });

  const unknown = await collect(
    tool.execute(
      { path: "x", startLine: 40, endLine: 60 },
      fakeIo({ read: () => readEvents([], { status: "timeout", totalLines: null }) }),
      context(),
    ),
  );
  expect(unknown[0]).toEqual({ type: "output", text: "x (lines 40-60 of unknown)" });

  const past = await collect(
    tool.execute(
      { path: "x", startLine: 400, endLine: 410 },
      fakeIo({ read: () => readEvents([], { totalLines: 120 }) }),
      context(),
    ),
  );
  expect(past[0]).toEqual({ type: "output", text: "x (lines 400-410 of 120)" });
});

it("returns typed end-event refusals for NUL and invalid UTF-8", async () => {
  const nul = await collect(
    tool.execute(
      { path: "binary" },
      fakeIo({ read: () => readEvents([new Uint8Array([0x61, 0, 0xff])], { totalLines: 1 }) }),
      context(),
    ),
  );
  expect(nul).toHaveLength(1);
  expect(nul[0]).toMatchObject({ type: "end", result: { status: "error", bytes: 3 } });
  if (nul[0]?.type === "end") {
    expect(nul[0].result.preview).toBe(`${READ_REFUSAL_PREFIX} NUL byte at offset 1`);
    expect(nul[0].result.preview).not.toContain("�");
  }

  const invalid = await collect(
    tool.execute(
      { path: "invalid" },
      fakeIo({ read: () => readEvents([new Uint8Array([0xc3, 0x28])], { totalLines: 1 }) }),
      context(),
    ),
  );
  expect(invalid).toHaveLength(1);
  if (invalid[0]?.type === "end") {
    expect(invalid[0].result.status).toBe("error");
    expect(invalid[0].result.preview).toBe(`${READ_REFUSAL_PREFIX} invalid UTF-8`);
    expect(invalid[0].result.preview).not.toContain("�");
  }
});

it("accepts split multibyte characters and ignores a truncated multibyte tail", async () => {
  const split = await collect(
    tool.execute(
      { path: "utf8" },
      fakeIo({
        read: () =>
          readEvents([new Uint8Array([0xce]), new Uint8Array([0xb2, 0x0a])], { totalLines: 1 }),
      }),
      context(),
    ),
  );
  expect(split[0]).toEqual({ type: "output", text: "utf8 (lines 1-1 of 1)\n     1→β" });

  const truncated = await collect(
    tool.execute(
      { path: "utf8" },
      fakeIo({
        read: () => readEvents([new Uint8Array([0x61, 0xce])], { truncated: true, totalLines: 1 }),
      }),
      context(),
    ),
  );
  expect(truncated[0]).toEqual({ type: "output", text: "utf8 (lines 1-1 of 1)\n     1→a" });
});

it("rejects incomplete and reversed ranges during plan", async () => {
  for (const input of [
    { path: "x", startLine: 2 },
    { path: "x", endLine: 2 },
    { path: "x", startLine: 3, endLine: 2 },
  ]) {
    let caught: unknown;
    try {
      await tool.plan(input, context());
    } catch (error) {
      caught = error;
    }
    expect(isToolError(caught)).toBe(true);
    if (isToolError(caught)) expect(caught.kind).toBe("invalid-input");
  }
});

it("rejects an incomplete range before runTool can reach ToolIo", async () => {
  let reads = 0;
  const io = fakeIo({
    read: () => {
      reads += 1;
      return readEvents([], { totalLines: 0 });
    },
  });
  await expect(
    collect(
      runTool(tool, { path: "x", startLine: 2 }, io, context(), {
        callId: "bad-read",
        record: () => Promise.resolve(),
      }),
    ),
  ).rejects.toMatchObject({ kind: "invalid-input" });
  expect(reads).toBe(0);
});
