/** Read-only, ripgrep-dialect content search (LRN-17). */

import type { CapabilityRequest, GrepMatch } from "@om-code/protocol";
import { z } from "zod";
import { toEnvelope } from "../envelope.js";
import { grepHeader } from "../format.js";
import { endEvent } from "../result.js";
import type { Tool } from "../tool.js";
import { parseInput } from "../validate.js";

export const grepInputSchema = z
  .object({
    pattern: z
      .string()
      .min(1)
      .describe("Rust regex syntax; lookaround and backreferences are unsupported."),
    root: z.string().min(1).optional().describe("Workspace-relative directory; defaults to '.'."),
    globs: z
      .array(z.string().min(1))
      .optional()
      .describe("Optional globset-compatible file filters."),
    caseInsensitive: z.boolean().optional().describe("Match without regard to case."),
  })
  .strict();

type GrepInput = z.infer<typeof grepInputSchema>;

export function grepCapabilityFor(input: GrepInput): CapabilityRequest {
  return { filesystem: { read: [input.root ?? "."], write: [] }, risk_class: "read" };
}

function renderMatches(pattern: string, root: string, matches: readonly GrepMatch[]): string {
  const files = new Set(matches.map((match) => match.path)).size;
  const header = grepHeader(pattern, root, matches.length, files);
  if (matches.length === 0) return header;
  return `${header}\n${matches
    .map((match) => `${match.path}:${match.lineNumber}:${match.line}`)
    .join("\n")}`;
}

export function createGrepTool(): Tool {
  return {
    descriptor: () => ({
      name: "grep",
      version: "0.1.0",
      description: "Search UTF-8 text files with ripgrep-compatible regex syntax.",
      risk_class: "read",
      parameters: z.toJSONSchema(grepInputSchema) as Record<string, unknown>,
    }),
    plan: (raw) => {
      const input = parseInput(grepInputSchema, "grep", raw);
      return Promise.resolve(grepCapabilityFor(input));
    },
    execute: async function* (raw, io, ctx) {
      const input = parseInput(grepInputSchema, "grep", raw);
      const capability = grepCapabilityFor(input);
      const matches: GrepMatch[] = [];
      for await (const event of io.grep(
        {
          ...toEnvelope(ctx, capability),
          pattern: input.pattern,
          ...(input.root !== undefined ? { root: input.root } : {}),
          ...(input.globs !== undefined ? { globs: input.globs } : {}),
          ...(input.caseInsensitive !== undefined
            ? { caseInsensitive: input.caseInsensitive }
            : {}),
        },
        ctx.signal,
      )) {
        if (event.type === "match") {
          matches.push(event.match);
          continue;
        }
        const preview = renderMatches(input.pattern, input.root ?? ".", matches);
        yield { type: "output", text: preview };
        yield endEvent(event.frame, preview);
      }
    },
  };
}
