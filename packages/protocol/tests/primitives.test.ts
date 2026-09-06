/**
 * AC-5.3: ToolStatus includes unknown and round-trips; Usage's unknown
 * variant round-trips too. Plus the shared primitives' accept/reject table.
 */

import { describe, expect, it } from "vitest";
import {
  actorSchema,
  recordIdSchema,
  sha256Schema,
  timestampSchema,
  toolResultV1,
  toolStatusSchema,
  turnEndV1,
  usageSchema,
} from "../src/index.js";
import { RECORD_SHA } from "./fixtures.js";

describe("primitives", () => {
  it("accepts every ToolStatus including unknown", () => {
    for (const status of ["ok", "error", "denied", "cancelled", "timeout", "unknown"]) {
      expect(toolStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(toolStatusSchema.safeParse("bogus").success).toBe(false);
  });

  it("a tool_result carrying unknown status round-trips unchanged", () => {
    const entry = {
      kind: "tool_result",
      schemaVersion: 1,
      call_id: "call_1",
      preview: "effect unknown after crash",
      truncated: false,
      bytes: 27,
      status: "unknown",
    };
    const first = toolResultV1.safeParse(entry);
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    const second = toolResultV1.safeParse(JSON.parse(JSON.stringify(first.data)));
    expect(second.success).toBe(true);
    if (!second.success) {
      return;
    }
    expect(second.data).toEqual(first.data);
  });

  it("Usage accepts known and unknown, rejects anything else", () => {
    expect(
      usageSchema.safeParse({ kind: "known", input_tokens: 10, output_tokens: 5 }).success,
    ).toBe(true);
    expect(
      usageSchema.safeParse({ kind: "known", input_tokens: 10, output_tokens: 5, total_tokens: 15 })
        .success,
    ).toBe(true);
    expect(usageSchema.safeParse({ kind: "unknown" }).success).toBe(true);
    // Never zero as a stand-in for missing: known requires real counters.
    expect(usageSchema.safeParse({ kind: "known" }).success).toBe(false);
    expect(usageSchema.safeParse({}).success).toBe(false);
    expect(usageSchema.safeParse("unknown").success).toBe(false);
  });

  it("Usage unknown round-trips through turn_end unchanged", () => {
    const entry = { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } };
    const first = turnEndV1.safeParse(entry);
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    const second = turnEndV1.safeParse(JSON.parse(JSON.stringify(first.data)));
    expect(second.success).toBe(true);
    if (!second.success) {
      return;
    }
    expect(second.data).toEqual(first.data);
  });

  it("accepts user/model/system and tool: actors, rejects the rest", () => {
    for (const by of ["user", "model", "system", "tool:bash", "tool:read"]) {
      expect(actorSchema.safeParse(by).success).toBe(true);
    }
    for (const by of ["alien", "tool:", "tool:has space", ""]) {
      expect(actorSchema.safeParse(by).success).toBe(false);
    }
  });

  it("record ids are UUIDv7 — a v4 id is rejected", () => {
    expect(recordIdSchema.safeParse("0193b4c8-0000-7000-8000-000000000000").success).toBe(true);
    expect(recordIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(false);
    expect(recordIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("timestamps are RFC 3339", () => {
    expect(timestampSchema.safeParse("2026-09-06T12:00:00Z").success).toBe(true);
    expect(timestampSchema.safeParse("2026-09-06").success).toBe(false);
    expect(timestampSchema.safeParse("yesterday").success).toBe(false);
  });

  it("sha256 is 64 lowercase hex chars", () => {
    expect(sha256Schema.safeParse(RECORD_SHA).success).toBe(true);
    expect(sha256Schema.safeParse("0".repeat(63)).success).toBe(false);
    expect(sha256Schema.safeParse("g".repeat(64)).success).toBe(false);
  });
});
