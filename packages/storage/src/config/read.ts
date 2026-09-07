/**
 * The only filesystem reads in packages/storage for config (LRN-04).
 *
 * read.ts turns tier documents into parsed docs or typed ConfigErrors.
 * Missing directories/files are an absent tier (undefined), never an error.
 * Everything else — unreadable file, invalid JSON with line/column, invalid
 * field with dotted path and expected shape — becomes a ConfigError whose
 * message names the file, the field and what was expected. Zod issues are
 * mapped into the invalid-field variant rather than printed raw.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { invalidField, invalidJson, unreadableFile } from "./errors.js";

const tierFileSchema = z
  .object({
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    credential: z.string().optional(),
    maxWallClockMs: z.string().optional(),
    pricingInputPerMTok: z.string().optional(),
    pricingOutputPerMTok: z.string().optional(),
  })
  .strict();

export type TierDocument = {
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly credential?: string | undefined;
  readonly maxWallClockMs?: string | undefined;
  readonly pricingInputPerMTok?: string | undefined;
  readonly pricingOutputPerMTok?: string | undefined;
};

export type FileReader = (path: string, encoding: "utf8") => string;

function jsonPositionToLineColumn(
  text: string,
  position: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(position, text.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < clamped; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function extractJsonPosition(detail: string): number | undefined {
  const match = /at position (\d+)/.exec(detail);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const position = Number.parseInt(match[1], 10);
  return Number.isNaN(position) ? undefined : position;
}

function zodExpected(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `a ${issue.expected}`;
    case "unrecognized_keys":
      return `no unknown keys (got ${(issue.keys ?? []).join(", ")})`;
    default:
      return "a valid value for this field";
  }
}

function zodFieldPath(issue: z.core.$ZodIssue): string {
  const path = (issue.path ?? []).map((segment) => String(segment)).join(".");
  return path.length > 0 ? path : "(root)";
}

export function parseTierDocument(path: string, text: string): TierDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const position = extractJsonPosition(detail);
    const { line, column } =
      position === undefined ? { line: 1, column: 1 } : jsonPositionToLineColumn(text, position);
    throw invalidJson(path, line, column, detail);
  }
  const result = tierFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue === undefined) {
      throw invalidField(
        path,
        "(root)",
        "a JSON object with optional baseUrl, model, credential, maxWallClockMs, pricingInputPerMTok, pricingOutputPerMTok",
      );
    }
    throw invalidField(path, zodFieldPath(issue), zodExpected(issue));
  }
  return result.data;
}

/**
 * Read one tier file. Returns undefined when the tier is absent (missing
 * file or missing directory). Throws ConfigError otherwise.
 */
export function readTierFile(
  path: string,
  readFile: FileReader = (file, encoding) => readFileSync(file, encoding),
): TierDocument | undefined {
  let text: string;
  try {
    text = readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw unreadableFile(path, detail);
  }
  return parseTierDocument(path, text);
}
