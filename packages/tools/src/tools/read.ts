/**
 * Text read tool (LRN-17). Binary classification belongs above the byte-pipe
 * port: NUL follows ripgrep's first-8-KiB rule and UTF-8 decoding is fatal.
 * The production `intent` argument from FR-06 is deferred beyond learning
 * scope; LRN-23 can use the exact line anchors emitted here.
 */

import type { CapabilityRequest, ReadFrame } from "@om-code/protocol";
import { z } from "zod";
import { toEnvelope } from "../envelope.js";
import { ToolError } from "../errors.js";
import { numberLines, readHeader } from "../format.js";
import { endEvent } from "../result.js";
import type { Tool, ToolEvent } from "../tool.js";
import { parseInput } from "../validate.js";

const BINARY_SCAN_BYTES = 8 * 1024;

export const READ_REFUSAL_PREFIX = "read refused binary content:";

export type ReadRefusal =
  | { readonly kind: "binary-nul"; readonly offset: number }
  | { readonly kind: "invalid-utf8" };

export const readInputSchema = z
  .object({
    path: z.string().min(1).describe("Workspace-relative file path."),
    startLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("First line, 1-based and inclusive."),
    endLine: z.number().int().positive().optional().describe("Last line, 1-based and inclusive."),
  })
  .strict();

type ReadInput = z.infer<typeof readInputSchema>;

function validateRange(input: ReadInput): ReadInput {
  const hasStart = input.startLine !== undefined;
  const hasEnd = input.endLine !== undefined;
  if (
    hasStart !== hasEnd ||
    (input.startLine !== undefined &&
      input.endLine !== undefined &&
      input.startLine > input.endLine)
  ) {
    throw new ToolError("invalid-input", "invalid input for read", {
      tool: "read",
      reason: "startLine and endLine must be supplied together, with startLine <= endLine",
    });
  }
  return input;
}

export function readCapabilityFor(input: ReadInput): CapabilityRequest {
  return { filesystem: { read: [input.path], write: [] }, risk_class: "read" };
}

function refusalPreview(refusal: ReadRefusal): string {
  return refusal.kind === "binary-nul"
    ? `${READ_REFUSAL_PREFIX} NUL byte at offset ${refusal.offset}`
    : `${READ_REFUSAL_PREFIX} invalid UTF-8`;
}

function refusalEnd(frame: ReadFrame, refusal: ReadRefusal): ToolEvent {
  return {
    type: "end",
    result: {
      status: "error",
      preview: refusalPreview(refusal),
      bytes: frame.bytes,
      truncated: frame.truncated,
    },
  };
}

export function createReadTool(): Tool {
  return {
    descriptor: () => ({
      name: "read",
      version: "0.1.0",
      description: "Read a UTF-8 text file, optionally by an inclusive 1-based line range.",
      risk_class: "read",
      parameters: z.toJSONSchema(readInputSchema) as Record<string, unknown>,
    }),
    plan: (raw) => {
      const input = validateRange(parseInput(readInputSchema, "read", raw));
      return Promise.resolve(readCapabilityFor(input));
    },
    execute: async function* (raw, io, ctx) {
      const input = validateRange(parseInput(readInputSchema, "read", raw));
      const capability = readCapabilityFor(input);
      const range =
        input.startLine !== undefined && input.endLine !== undefined
          ? { startLine: input.startLine, endLine: input.endLine }
          : undefined;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const textParts: string[] = [];
      let refusal: ReadRefusal | undefined;
      let scanned = 0;
      // Buffering is intentional: the total-line header is known only at the
      // terminal frame. The runtime-owned maxBytes bound caps all input here.
      for await (const event of io.read(
        {
          ...toEnvelope(ctx, capability),
          path: input.path,
          ...(range !== undefined ? { range } : {}),
        },
        ctx.signal,
      )) {
        if (event.type === "chunk") {
          if (refusal === undefined && scanned < BINARY_SCAN_BYTES) {
            const inspected = event.bytes.subarray(0, BINARY_SCAN_BYTES - scanned);
            const nul = inspected.indexOf(0);
            if (nul >= 0) refusal = { kind: "binary-nul", offset: scanned + nul };
            scanned += inspected.length;
          }
          if (refusal === undefined) {
            try {
              textParts.push(decoder.decode(event.bytes, { stream: true }));
            } catch {
              refusal = { kind: "invalid-utf8" };
            }
          }
          continue;
        }
        if (refusal === undefined && !event.frame.truncated) {
          try {
            textParts.push(decoder.decode());
          } catch {
            refusal = { kind: "invalid-utf8" };
          }
        }
        if (refusal !== undefined) {
          yield refusalEnd(event.frame, refusal);
          return;
        }
        const text = textParts.join("");
        const header = readHeader(input.path, range, event.frame.totalLines);
        const body = numberLines(text, range?.startLine ?? 1);
        const preview = body.length > 0 ? `${header}\n${body}` : header;
        yield { type: "output", text: preview };
        yield endEvent(event.frame, preview);
      }
    },
  };
}
