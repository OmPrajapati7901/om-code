import type { CapabilityRequest, StubEnvelope } from "@om-code/protocol";
import type { ToolContext } from "./tool.js";

export function toEnvelope(ctx: ToolContext, capability: CapabilityRequest): StubEnvelope {
  return {
    maxBytes: ctx.budget.maxBytes,
    maxMs: ctx.budget.maxMs,
    cwd: ctx.cwd,
    envAllowlist: [...ctx.envAllowlist],
    capability,
  };
}
