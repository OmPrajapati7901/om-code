/**
 * Project-root discovery for the project settings tier (LRN-04).
 *
 * Nearest ancestor of cwd (inclusive) containing .git, else cwd. LRN-06
 * reuses this root for its <project-hash>.
 */

import { describe, expect, it } from "vitest";
import { findGitRoot, findProjectRoot } from "../src/config/paths.js";

describe("findProjectRoot", () => {
  it("returns cwd itself when it contains .git", () => {
    expect(findProjectRoot("/repo", (path) => path === "/repo/.git")).toBe("/repo");
  });

  it("walks up to the nearest ancestor containing .git", () => {
    const exists = (path: string): boolean => path === "/repo/.git";
    expect(findProjectRoot("/repo/packages/cli", exists)).toBe("/repo");
  });

  it("prefers the nearer .git when nested", () => {
    const exists = (path: string): boolean =>
      path === "/repo/.git" || path === "/repo/packages/.git";
    expect(findProjectRoot("/repo/packages/cli", exists)).toBe("/repo/packages");
  });

  it("falls back to cwd outside any repo", () => {
    expect(findProjectRoot("/tmp/no-repo-here", () => false)).toBe("/tmp/no-repo-here");
  });
});

describe("findGitRoot (LRN-20)", () => {
  it("returns the root from a subdirectory", () => {
    expect(findGitRoot("/repo/packages/cli", (path) => path === "/repo/.git")).toBe("/repo");
  });

  it("returns null outside any repo", () => {
    expect(findGitRoot("/tmp/no-repo-here", () => false)).toBeNull();
  });
});
