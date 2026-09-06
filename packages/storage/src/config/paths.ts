/**
 * Config path resolution (LRN-04).
 *
 * OM_HOME (default ~/.om-code) holds config.json; the env var exists so
 * tests point at a temp directory. Project root is the nearest ancestor of
 * cwd (inclusive) containing .git, else cwd; project settings are
 * <root>/.om-code/settings.json. LRN-06 reuses this root for its
 * <project-hash>.
 *
 * LRN-04 creates nothing — a missing directory or file is simply an absent
 * tier, so this task writes zero bytes to disk.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type ConfigPaths = {
  /** Resolved OM_HOME directory (may not exist — that is an absent tier). */
  readonly omHome: string;
  /** User-tier file: <OM_HOME>/config.json. */
  readonly userFile: string;
  /** Project root used for tier discovery. */
  readonly projectRoot: string;
  /** Project-tier file: <root>/.om-code/settings.json. */
  readonly projectFile: string;
};

export function resolveOmHome(env: Record<string, string | undefined>): string {
  const override = env.OM_HOME;
  if (override !== undefined && override.length > 0) {
    return resolve(override);
  }
  return join(homedir(), ".om-code");
}

export function findProjectRoot(
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): string {
  let current = isAbsolute(cwd) ? cwd : resolve(cwd);
  for (;;) {
    if (exists(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return isAbsolute(cwd) ? cwd : resolve(cwd);
    }
    current = parent;
  }
}

export function resolveConfigPaths(
  env: Record<string, string | undefined>,
  cwd: string,
): ConfigPaths {
  const omHome = resolveOmHome(env);
  const projectRoot = findProjectRoot(cwd);
  return {
    omHome,
    userFile: join(omHome, "config.json"),
    projectRoot,
    projectFile: join(projectRoot, ".om-code", "settings.json"),
  };
}
