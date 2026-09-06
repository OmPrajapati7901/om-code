/** AC-8.4: the recorder captures traffic to a fixture with credentials stripped. */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordingFetch } from "../src/index.js";

const SECRET = "sk-test-secret-9f2a7c4b1e";

function sseBody(): string {
  return (
    `data: {"id":"id","model":"m","choices":[{"index":0,"delta":{"content":"hi ${SECRET} bye"}}]}\n\n` +
    `data: {"id":"id","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"debug":{"authorization":"Bearer ${SECRET}"}}\n\n` +
    "data: [DONE]\n\n"
  );
}
function fakeFetch(): typeof fetch {
  return (async () =>
    new Response(sseBody(), {
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;
}

describe("recordingFetch (AC-8.4)", () => {
  it("the fake fixture really leaks the credential, as a positive control", async () => {
    const rawText = await (await fakeFetch()("https://fixture.test")).text();
    expect(rawText).toContain(SECRET);
  });

  it("strips a known-secret literal from the captured fixture", async () => {
    const recorder = recordingFetch(fakeFetch(), { secrets: [SECRET] });
    const response = await recorder.fetch("https://fixture.test");
    await response.text();
    const captured = await recorder.capture();
    expect(captured).not.toContain(SECRET);
    expect(captured).toContain("hi [redacted] bye");
  });

  it("scrubs common credential patterns even with no secrets list supplied", async () => {
    const recorder = recordingFetch(fakeFetch(), {});
    const response = await recorder.fetch("https://fixture.test");
    await response.text();
    const captured = await recorder.capture();
    expect(captured).not.toMatch(/sk-[A-Za-z0-9_-]{10,}/);
    expect(captured).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{10,}/i);
  });

  it("leaves the caller's own response stream fully readable", async () => {
    const recorder = recordingFetch(fakeFetch(), { secrets: [SECRET] });
    const response = await recorder.fetch("https://fixture.test");
    const text = await response.text();
    expect(text).toContain(SECRET);
  });
});

describe("committed provider fixtures stay credential-free (AC-8.4 grep)", () => {
  it("greps every fixture for the key pattern", () => {
    const dir = new URL("./fixtures/", import.meta.url);
    const patterns = [
      /\bsk-[A-Za-z0-9_-]{10,}\b/,
      /\bgsk_[A-Za-z0-9_-]{10,}\b/,
      /Bearer\s+[A-Za-z0-9._-]{10,}/i,
    ];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".sse")) continue;
      const text = readFileSync(new URL(entry, dir), "utf8");
      for (const pattern of patterns) expect(text).not.toMatch(pattern);
    }
  });
});
