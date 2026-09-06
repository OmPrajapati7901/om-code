// Explicit manual acceptance only (LRN-08, AC-8.4). This command spends
// inference credits and writes real fixtures. Load credentials with
// node --env-file=.env; never print request headers.
//
// Usage: node --env-file=.env tests/manual/record-fixture.mjs <fixture-name>
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { OpenAICompatibleProvider, recordingFetch } from "../../packages/providers/dist/index.js";

const baseUrl = process.env.OM_BASE_URL ?? "https://api.groq.com/openai/v1";
const model = process.env.OM_MODEL ?? "qwen/qwen3.8-27b";
const key = process.env.GROQ_API_KEY ?? process.env.OM_API_KEY;
if (!key) throw new Error("Set GROQ_API_KEY or OM_API_KEY for this manual recording command");
const name = process.argv[2];
if (!name) throw new Error("Usage: node tests/manual/record-fixture.mjs <fixture-name>");

for (const kind of ["text", "tool"]) {
  const recorder = recordingFetch(fetch, { secrets: [key] });
  const provider = new OpenAICompatibleProvider({
    baseUrl,
    getApiKey: () => key,
    requestTimeoutMs: 120_000,
    // Keep this paid capture bounded without adding a product setting.
    fetchImpl: (url, init) =>
      recorder.fetch(url, {
        ...init,
        body: JSON.stringify({ ...JSON.parse(String(init.body)), max_completion_tokens: 512 }),
      }),
  });
  const request = {
    model,
    messages: [
      {
        role: "user",
        content:
          kind === "text"
            ? "Reply with exactly: hello world"
            : "Call get_weather for Paris. Do not answer directly.",
      },
    ],
    ...(kind === "tool"
      ? {
          tools: [
            {
              name: "get_weather",
              description: "Get weather for a city",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          ],
          tool_choice: { name: "get_weather" },
        }
      : {}),
  };
  let completed;
  try {
    for await (const event of provider.stream(request, new AbortController().signal))
      if (event.type === "message_stop") completed = event.response;
  } catch (error) {
    console.error(
      JSON.stringify({ kind, failure: error.kind ?? "unknown", message: error.message }),
    );
    process.exitCode = 1;
    continue;
  }
  const captured = await recorder.capture();
  assert.equal(captured.includes(key), false, "captured fixture must not contain the credential");
  const path = new URL(
    `../../packages/providers/tests/fixtures/${name}-${kind}.sse`,
    import.meta.url,
  );
  await writeFile(path, captured);
  console.log(
    JSON.stringify({
      recorded: kind,
      path: path.pathname,
      bytes: captured.length,
      response: completed,
    }),
  );
}
