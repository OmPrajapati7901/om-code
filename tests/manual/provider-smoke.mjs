// Explicit manual acceptance only. This command spends inference credits.
// Load credentials with node --env-file=.env; never print request headers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OpenAICompatibleProvider } from "../../packages/providers/dist/index.js";

const baseUrl = process.env.OM_BASE_URL ?? "https://api.groq.com/openai/v1";
const model = process.env.OM_MODEL ?? "qwen/qwen3.8-27b";
const key = process.env.GROQ_API_KEY ?? process.env.OM_API_KEY;
if (!key) throw new Error("Set GROQ_API_KEY or OM_API_KEY for this manual smoke command");
for (const kind of ["text", "tool"]) {
  const bytes = await readFile(
    new URL(`../../packages/providers/tests/fixtures/groq-${kind}.sse`, import.meta.url),
  );
  assert.equal(bytes.includes(Buffer.from(key)), false, "fixture must not contain credential");
}
const provider = new OpenAICompatibleProvider({
  baseUrl,
  getApiKey: () => key,
  requestTimeoutMs: 120_000,
  // Keep this paid verification bounded without adding a product setting.
  fetchImpl: (url, init) =>
    fetch(url, {
      ...init,
      body: JSON.stringify({ ...JSON.parse(String(init.body)), max_completion_tokens: 512 }),
    }),
});
for (const kind of ["text", "tool"]) {
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
  const counts = {};
  let completed;
  try {
    for await (const event of provider.stream(request, new AbortController().signal)) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      if (event.type === "message_stop") completed = event.response;
    }
  } catch (error) {
    console.error(
      JSON.stringify({ kind, failure: error.kind ?? "unknown", message: error.message }),
    );
    process.exitCode = 1;
    break;
  }
  assert.ok(completed);
  if (kind === "text") assert.ok(counts.text_delta > 1);
  else assert.equal(completed.tool_calls[0]?.name, "get_weather");
  console.log(JSON.stringify({ smoke: kind, model, events: counts, response: completed }));
}
