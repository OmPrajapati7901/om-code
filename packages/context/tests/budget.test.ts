/**
 * LRN-19 run-budget acceptance (AC-19.5, AC-19.6, DoD-2).
 */
import { expect, it } from "vitest";
import { createRunBudget } from "../src/index.js";

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

it("AC-19.5 trips max-turns before the over-budget inference", () => {
  const { now } = clock();
  const budget = createRunBudget({ maxTurns: 2, maxWallClockMs: 60_000, now });
  expect(budget.check()).toBeUndefined();
  expect(budget.recordInference({ kind: "unknown" })).toBeUndefined();
  expect(budget.check()).toBeUndefined();
  expect(budget.recordInference({ kind: "unknown" })).toBeUndefined();
  expect(budget.check()).toMatchObject({ reason: "max-turns" });
});

it("AC-19.5 trips the wall-clock cap deterministically under an injected clock", () => {
  const time = clock();
  const budget = createRunBudget({ maxWallClockMs: 5_000, now: time.now });
  expect(budget.check()).toBeUndefined();
  time.advance(4_999);
  expect(budget.check()).toBeUndefined();
  time.advance(1);
  expect(budget.check()).toMatchObject({ reason: "wall-clock" });
});

it("AC-19.6 enforces max-cost within one in-flight call when pricing and usage exist", () => {
  const { now } = clock();
  const budget = createRunBudget({
    maxWallClockMs: 60_000,
    maxCostUsd: 1,
    pricing: { inputPerMTok: 1, outputPerMTok: 4 },
    now,
  });
  // 500k input + 125k output tokens at $1/$4 per MTok = exactly $1.00.
  const trip = budget.recordInference({
    kind: "known",
    input_tokens: 500_000,
    output_tokens: 125_000,
  });
  expect(trip).toMatchObject({ reason: "max-cost" });
  expect(trip?.message).toContain("$1");
});

it("AC-19.6 never estimates: unknown usage with a cost cap aborts explicitly", () => {
  const { now } = clock();
  const budget = createRunBudget({
    maxWallClockMs: 60_000,
    maxCostUsd: 1,
    pricing: { inputPerMTok: 1, outputPerMTok: 1 },
    now,
  });
  const trip = budget.recordInference({ kind: "unknown" });
  expect(trip).toMatchObject({ reason: "max-cost-unknown-usage" });
});

it("an unbounded budget (no caps) never trips", () => {
  const { now } = clock();
  const budget = createRunBudget({ maxWallClockMs: Number.MAX_SAFE_INTEGER, now });
  for (let i = 0; i < 5; i += 1) {
    expect(budget.check()).toBeUndefined();
    expect(budget.recordInference({ kind: "unknown" })).toBeUndefined();
  }
});
