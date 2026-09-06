// Suite-level network guard (LRN-08, AC-8.5). Plain ESM so this one file
// works both as a vitest `setupFiles` entry and as `node --import` for the
// node children our own tests spawn (packages/storage's journal-process
// tests). No loopback exception: docs/om-code-agent-execution-backlog.md
// already states this guard exempts nothing, and tests/manual/*.mjs run
// under bare `node`, outside this file entirely, when a live check is
// wanted on purpose.
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

const violations = [];

function record(label, detail) {
  const message = `network access blocked by test guard: ${label}${detail ? ` (${detail})` : ""}`;
  violations.push(message);
  console.error(`[no-network] ${message}`);
  throw new Error(message);
}

if (typeof globalThis.fetch === "function") {
  globalThis.fetch = (...args) => record("fetch", String(args[0]));
}

for (const [target, prop] of [
  [net, "connect"],
  [net, "createConnection"],
  [net.Socket.prototype, "connect"],
  [tls, "connect"],
]) {
  const label =
    target === tls ? "tls.connect" : target === net ? `net.${prop}` : "net.Socket#connect";
  target[prop] = () => record(label);
}

for (const fn of ["lookup", "resolve", "resolve4", "resolve6"]) {
  if (typeof dns[fn] === "function") dns[fn] = () => record(`dns.${fn}`);
  if (typeof dns.promises[fn] === "function") dns.promises[fn] = () => record(`dns.promises.${fn}`);
}

export function violationsSoFar() {
  return violations.slice();
}

/** Throws (and clears) if any guarded call happened since the last check — catches a caller that swallowed the original throw. */
export function checkNoViolations() {
  if (violations.length === 0) return;
  const message = violations.splice(0).join("; ");
  throw new Error(`AC-8.5: network access attempted during test — ${message}`);
}

// Detect an actual vitest worker via its own global, not process.env.VITEST:
// that env var is inherited by every child process we spawn (including the
// journal-process fixtures below), which are plain node processes with no
// real vitest runtime to call afterEach on.
if (typeof globalThis.__vitest_worker__ !== "undefined") {
  const { afterEach } = await import("vitest");
  afterEach(() => {
    checkNoViolations();
  });
} else {
  process.on("exit", () => {
    if (violations.length > 0 && !process.exitCode) process.exitCode = 1;
  });
}
