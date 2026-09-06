/**
 * The version `om --version` prints (AC-3.3) comes from this package's
 * `package.json` and nowhere else, so there is one place to bump.
 *
 * `createRequire` resolves relative to this module: `dist/version.js` and
 * `src/version.ts` both sit one directory below the manifest, so the built
 * binary and the test run read the same file. This is a read of our own
 * manifest, not of a workspace path, so it does not belong behind the
 * `stub-client` boundary (AGENTS.md).
 */

import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

type PackageManifest = {
  readonly version?: unknown;
};

export function readVersion(): string {
  const manifest = requireFromHere("../package.json") as PackageManifest;
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error('packages/cli/package.json is missing a usable "version" field');
  }
  return manifest.version;
}
