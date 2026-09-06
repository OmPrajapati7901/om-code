/**
 * Wraps fetch to capture real traffic for a fixture (LRN-08, AC-8.4). Pure:
 * no node:fs here, so `packages/providers` keeps performing no direct
 * file/process I/O — the caller writes the captured text to a fixture file.
 */
import { sanitize } from "./guards.js";

export type RecordingFetch = {
  fetch: typeof fetch;
  /** Redacted response-body text captured across every call so far. */
  capture(): Promise<string>;
};

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
  /"authorization"\s*:\s*"[^"]*"/gi,
];

function scrub(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) if (secret) redacted = sanitize(redacted, secret);
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[redacted]");
  return redacted;
}

export function recordingFetch(
  inner: typeof fetch,
  options: { secrets?: readonly string[] } = {},
): RecordingFetch {
  const secrets = options.secrets ?? [];
  const pieces: string[] = [];
  const drains: Promise<void>[] = [];
  const wrapped: typeof fetch = async (input, init) => {
    const response = await inner(input, init);
    if (!response.body) return response;
    const [forCaller, forCapture] = response.body.tee();
    drains.push(
      (async () => {
        const reader = forCapture.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pieces.push(decoder.decode(value, { stream: true }));
          }
          pieces.push(decoder.decode());
        } catch {
          /* Capture is best-effort; the caller's own stream is unaffected. */
        }
      })(),
    );
    return new Response(forCaller, { status: response.status, headers: response.headers });
  };
  return {
    fetch: wrapped,
    capture: async () => {
      await Promise.all(drains);
      return scrub(pieces.join(""), secrets);
    },
  };
}
