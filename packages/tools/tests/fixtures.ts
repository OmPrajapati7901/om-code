/**
 * Trivial fake tools for the interface and registry tests. Real tools arrive
 * in LRN-17/26/27/28; these exist only to exercise the shape.
 */
import type { CapabilityRequest } from "@om-code/protocol";
import type {
  Tool,
  ToolContext,
  ToolDescriptor,
  ToolEvent,
  ToolIo,
  ToolName,
} from "../src/index.js";

export type { ToolIo };

export function fakeDescriptor(name: ToolName): ToolDescriptor {
  return {
    name,
    version: "0.1.0",
    description: `fake ${name} tool`,
    risk_class: "read",
    parameters: {},
  };
}

export function fakeCapability(): CapabilityRequest {
  return { risk_class: "read" };
}

export async function* fakeEnd(): AsyncIterable<ToolEvent> {
  yield {
    type: "end",
    result: { status: "ok", preview: "", bytes: 0, truncated: false },
  };
}

export function fakeTool(name: ToolName): Tool {
  return {
    descriptor: () => fakeDescriptor(name),
    plan: async (_input: unknown, _ctx: ToolContext) => fakeCapability(),
    execute: (_input: unknown, _io: ToolIo, _ctx: ToolContext) => fakeEnd(),
  };
}
