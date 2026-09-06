/**
 * The only process spawn in packages/storage for config (LRN-04).
 *
 * The credential reference is the only credential-shaped thing that ever
 * appears in a file, a flag, a log line or config-print output. The secret
 * itself is resolved on demand here: env:<VAR> reads the live environment,
 * keychain:<service>/<account> spawns `security find-generic-password -w`.
 *
 * A keychain lookup that returns non-zero (item not found) resolves to
 * "unresolved", not a crash. No network. The spawn is injectable so tests run
 * offline with a fake; one optionally-skipped test exercises the real
 * `security` binary only when OM_TEST_REAL_KEYCHAIN is set.
 */

import { execFileSync } from "node:child_process";
import { parseCredentialReference } from "./settings.js";

export type KeychainRunner = (
  program: string,
  args: readonly string[],
) => { status: number; stdout: string };

function defaultRunner(
  program: string,
  args: readonly string[],
): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(program, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout: typeof stdout === "string" ? stdout : String(stdout) };
  } catch (error) {
    const failure = error as { status?: unknown; stdout?: unknown };
    const status = typeof failure.status === "number" ? failure.status : 1;
    const stdout = typeof failure.stdout === "string" ? failure.stdout : "";
    return { status, stdout };
  }
}

function stripSingleTrailingNewline(text: string): string {
  return text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function resolveCredentialSecret(
  reference: string,
  env: Record<string, string | undefined>,
  run: KeychainRunner = defaultRunner,
): string | undefined {
  let parsed: ReturnType<typeof parseCredentialReference>;
  try {
    parsed = parseCredentialReference(reference, "<credential>");
  } catch {
    return undefined;
  }
  if (parsed.kind === "env") {
    const value = env[parsed.variable];
    return value !== undefined && value.length > 0 ? value : undefined;
  }
  const result = run("security", [
    "find-generic-password",
    "-w",
    "-s",
    parsed.service,
    "-a",
    parsed.account,
  ]);
  if (result.status !== 0) {
    return undefined;
  }
  const secret = stripSingleTrailingNewline(result.stdout);
  return secret.length > 0 ? secret : undefined;
}
