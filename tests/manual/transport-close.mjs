// Explicit loopback demonstration, intentionally outside the socket-free suite.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { OpenAICompatibleProvider } from "../../packages/providers/dist/index.js";

for (const tool of [false, true]) {
  let closed;
  const didClose = new Promise((resolve) => {
    closed = resolve;
  });
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const delta = tool
      ? { tool_calls: [{ index: 0, id: "c", function: { name: "read", arguments: "{" } }] }
      : { content: "partial" };
    response.write(
      `data: ${JSON.stringify({ id: "local", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] })}\n\n`,
    );
    request.socket.once("close", closed);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let timer;
  try {
    const address = server.address();
    const provider = new OpenAICompatibleProvider({
      baseUrl: `http://127.0.0.1:${address.port}`,
      idleTimeoutMs: 2000,
    });
    const controller = new AbortController();
    const stream = provider.stream(
      { model: "fixture", messages: [{ role: "user", content: "hello" }] },
      controller.signal,
    );
    await stream.next();
    await stream.next();
    const pending = stream.next();
    const start = performance.now();
    controller.abort();
    await assert.rejects(pending, { kind: "aborted" });
    await Promise.race([
      didClose,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("socket did not close within 1s")), 1000);
      }),
    ]);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000);
    console.log(
      JSON.stringify({ stream: tool ? "tool" : "text", socket_close_ms: Math.round(elapsed) }),
    );
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
