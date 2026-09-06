/** Bounded HTTP helpers. Secrets only reach Authorization, never diagnostics. */
import { ProviderError } from "@om-code/protocol";

export function sanitize(message: string, secret: string | undefined): string {
  const redacted = secret ? message.split(secret).join("[redacted]") : message;
  return Array.from(redacted, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .slice(0, 8192);
}

export async function settleCleanup(work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 250);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function cancelBody(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  await settleCleanup(reader.cancel());
  try {
    reader.releaseLock();
  } catch {
    /* Aborted read may still settle. */
  }
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(new ProviderError("aborted", "request aborted"));
    };
    if (signal.aborted) {
      work.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function errorMessage(
  response: Response,
  secret: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) return `HTTP ${response.status}: empty body`;
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < 8192) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      const part = value.subarray(0, 8192 - length);
      pieces.push(part);
      length += part.length;
    }
  } finally {
    await cancelBody(reader);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of pieces) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const text = new TextDecoder().decode(bytes);
  let message = text;
  try {
    const raw: unknown = JSON.parse(text);
    if (
      typeof raw === "object" &&
      raw !== null &&
      "error" in raw &&
      typeof raw.error === "object" &&
      raw.error !== null &&
      "message" in raw.error &&
      typeof raw.error.message === "string"
    )
      message = raw.error.message;
  } catch {
    /* HTML proxy errors retain a bounded, sanitized excerpt. */
  }
  // Redact a credential prefix cut by the byte bound as well as whole secrets.
  if (secret)
    for (let count = Math.min(secret.length - 1, message.length); count >= 4; count--) {
      if (message.endsWith(secret.slice(0, count))) {
        message = `${message.slice(0, -count)}[redacted]`;
        break;
      }
    }
  return `HTTP ${response.status}: ${sanitize(message || "empty error body", secret)}`;
}

export function retryDelay(
  attempt: number,
  retryAfter: string | null,
  now: number,
  random: () => number,
): number {
  const exponential = Math.min(10_000, 500 * 2 ** attempt) * Math.max(0, Math.min(1, random()));
  let requested = 0;
  if (retryAfter !== null) {
    const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : Number.NaN;
    requested = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(retryAfter) - now);
  }
  return Math.min(10_000, Math.max(exponential, Number.isFinite(requested) ? requested : 0));
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProviderError("aborted", "request aborted"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new ProviderError("aborted", "request aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
