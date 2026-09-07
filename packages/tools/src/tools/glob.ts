/**
 * Read-only, ripgrep-backed path discovery (LRN-17). Results are not numbered:
 * each path is already its own location, and a prefix could be mistaken for a
 * source line number by the model.
 */

import type { CapabilityRequest } from "@om-code/protocol";
import { z } from "zod";
import { toEnvelope } from "../envelope.js";
import { globHeader } from "../format.js";
import { endEvent } from "../result.js";
import type { Tool } from "../tool.js";
import { parseInput } from "../validate.js";

export const globInputSchema = z
  .object({
    pattern: z.string().min(1).describe("Globset-compatible path pattern."),
    root: z.string().min(1).optional().describe("Workspace-relative directory; defaults to '.'."),
    includeIgnored: z.boolean().optional().describe("Include paths ignored by repository rules."),
  })
  .strict();

type GlobInput = z.infer<typeof globInputSchema>;

export function globCapabilityFor(input: GlobInput): CapabilityRequest {
  return { filesystem: { read: [input.root ?? "."], write: [] }, risk_class: "read" };
}

export function createGlobTool(): Tool {
  return {
    descriptor: () => ({
      name: "glob",
      version: "0.1.0",
      description: "List repository paths matching a ripgrep-compatible glob.",
      risk_class: "read",
      parameters: z.toJSONSchema(globInputSchema) as Record<string, unknown>,
    }),
    plan: (raw) => {
      const input = parseInput(globInputSchema, "glob", raw);
      return Promise.resolve(globCapabilityFor(input));
    },
    execute: async function* (raw, io, ctx) {
      const input = parseInput(globInputSchema, "glob", raw);
      const capability = globCapabilityFor(input);
      const result = await io.glob(
        {
          ...toEnvelope(ctx, capability),
          pattern: input.pattern,
          ...(input.root !== undefined ? { root: input.root } : {}),
          ...(input.includeIgnored !== undefined ? { includeIgnored: input.includeIgnored } : {}),
        },
        ctx.signal,
      );
      const header = globHeader(input.pattern, input.root ?? ".", result.paths.length);
      const preview = result.paths.length > 0 ? `${header}\n${result.paths.join("\n")}` : header;
      yield { type: "output", text: preview };
      yield endEvent(result, preview);
    },
  };
}
