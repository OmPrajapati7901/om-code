/**
 * The version `om --version` prints (AC-3.3).
 *
 * This is a plain constant, not a read of our own `package.json`: reading the
 * manifest at runtime needs `node:module`'s `createRequire`, which AC-14.1
 * bans outside `storage`/`stub-client` because it is a filesystem read in
 * disguise. The manifest is still the source of truth for the release; the
 * drift test in `packages/cli/tests/version.test.ts` keeps the two equal, so
 * a stale bump fails the gate instead of shipping a wrong `--version`.
 */

export const OM_VERSION = "0.1.0";

export function readVersion(): string {
  return OM_VERSION;
}
