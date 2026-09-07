/** AC-16.3, AC-16.4: roster pin, duplicate and off-roster rejection. */
import { describe, expect, it } from "vitest";
import { createRegistry, isToolError, TOOL_ROSTER, type ToolName } from "../src/index.js";
import { fakeTool } from "./fixtures.js";

describe("registry (AC-16.3, AC-16.4)", () => {
  it("pins the roster at exactly seven names", () => {
    expect([...TOOL_ROSTER]).toEqual(["read", "grep", "glob", "edit", "write", "bash", "todo"]);
  });

  it("registers the roster and serves get/list/descriptors", () => {
    const registry = createRegistry(TOOL_ROSTER.map((name) => fakeTool(name)));
    expect(registry.list()).toHaveLength(7);
    expect(registry.get("read")?.descriptor().name).toBe("read");
    expect(registry.get("missing")).toBeUndefined();
    expect(
      registry
        .descriptors()
        .map((descriptor) => descriptor.name)
        .sort(),
    ).toEqual([...TOOL_ROSTER].sort());
  });

  it("rejects a duplicate tool name", () => {
    let caught: unknown;
    try {
      createRegistry([fakeTool("read"), fakeTool("read")]);
    } catch (error) {
      caught = error;
    }
    expect(isToolError(caught)).toBe(true);
    expect((caught as { kind: string }).kind).toBe("duplicate-name");
  });

  it("rejects a name outside the roster — registering an eighth fails", () => {
    let caught: unknown;
    try {
      createRegistry([
        ...TOOL_ROSTER.map((name) => fakeTool(name)),
        fakeTool("search" as ToolName),
      ]);
    } catch (error) {
      caught = error;
    }
    expect(isToolError(caught)).toBe(true);
    expect((caught as { kind: string }).kind).toBe("not-in-roster");
  });
});
