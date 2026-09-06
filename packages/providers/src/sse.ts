/** SSE framing only: UTF-8, CR/LF/CRLF, multiline data, optional BOM. */
import { ProviderError } from "@om-code/protocol";

export async function* decodeSse(chunks: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let eventLength = 0;

  function* lines(final: boolean): Iterable<string> {
    let start = 0;
    for (let index = 0; index < buffer.length; index++) {
      const char = buffer[index];
      if (char !== "\r" && char !== "\n") continue;
      if (char === "\r" && index === buffer.length - 1 && !final) break;
      const line = buffer.slice(start, index);
      if (char === "\r" && buffer[index + 1] === "\n") index++;
      start = index + 1;
      if (line === "") {
        if (data.length > 0) yield data.join("\n");
        data = [];
        eventLength = 0;
      } else if (line === "data" || line.startsWith("data:")) {
        let value = line === "data" ? "" : line.slice(5);
        if (value.startsWith(" ")) value = value.slice(1);
        eventLength += value.length + 1;
        if (eventLength > 1_048_576)
          throw new ProviderError("malformed-stream", "SSE event exceeds character limit");
        data.push(value);
      }
    }
    buffer = buffer.slice(start);
    if (buffer.length > 1_048_576)
      throw new ProviderError("malformed-stream", "SSE line exceeds character limit");
  }

  const decode = (chunk?: Uint8Array) => {
    try {
      return chunk === undefined ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch {
      throw new ProviderError("malformed-stream", "invalid UTF-8 stream");
    }
  };

  for await (const chunk of chunks) {
    buffer += decode(chunk);
    yield* lines(false);
  }
  buffer += decode();
  yield* lines(true);
  // SSE does not dispatch a pending event without its final empty line.
}
