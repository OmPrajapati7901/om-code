/**
 * The run budget (LRN-19, AC-19.5/19.6): turn-count, wall-clock and cost caps
 * in one module. `now` is injected so the wall-clock cap is deterministic
 * under test. Overshoot is at most one in-flight call: the loop checks before
 * each inference and records after it.
 */

import type { Usage } from "@om-code/protocol";
import { type ModelPricing, usdFor } from "./cost.js";

export type BudgetTrip = {
  readonly reason: "max-turns" | "wall-clock" | "max-cost" | "max-cost-unknown-usage";
  readonly message: string;
};

export type RunBudget = {
  /** Before each inference. */
  check(): BudgetTrip | undefined;
  /** After each inference; counts the inference and accumulates cost. */
  recordInference(usage: Usage): BudgetTrip | undefined;
};

export function createRunBudget(deps: {
  readonly maxTurns?: number | undefined;
  readonly maxWallClockMs: number;
  readonly maxCostUsd?: number | undefined;
  readonly pricing?: ModelPricing | undefined;
  readonly now: () => number;
}): RunBudget {
  const startedAt = deps.now();
  let inferences = 0;
  let spentUsd = 0;

  const wallClockTrip = (): BudgetTrip | undefined => {
    if (deps.now() - startedAt >= deps.maxWallClockMs) {
      return {
        reason: "wall-clock",
        message:
          `wall-clock budget exceeded (${deps.maxWallClockMs} ms elapsed ` +
          `after ${inferences} inference(s))`,
      };
    }
    return undefined;
  };

  return {
    check() {
      if (deps.maxTurns !== undefined && inferences >= deps.maxTurns) {
        return {
          reason: "max-turns",
          message: `maximum turn limit (${deps.maxTurns}) reached after ${inferences} inference(s)`,
        };
      }
      return wallClockTrip();
    },
    recordInference(usage: Usage) {
      inferences += 1;
      if (deps.maxCostUsd === undefined) return wallClockTrip();
      const cost = deps.pricing === undefined ? undefined : usdFor(usage, deps.pricing);
      if (cost === undefined) {
        // Blueprint §8.1 correction: startup rejects missing pricing, but an
        // endpoint that reports no usage is unknowable before the first call —
        // abort here with an explanatory reason instead of estimating.
        return {
          reason: "max-cost-unknown-usage",
          message:
            "--max-cost cannot be enforced: the endpoint reported no usage " +
            `for inference ${inferences}, so cost is unknown (configure pricing and use an ` +
            "endpoint that reports usage, or drop --max-cost)",
        };
      }
      spentUsd += cost;
      if (spentUsd >= deps.maxCostUsd) {
        return {
          reason: "max-cost",
          message:
            `maximum cost exceeded ($${spentUsd.toFixed(6)} spent ` +
            `over ${inferences} inference(s); budget $${deps.maxCostUsd})`,
        };
      }
      return wallClockTrip();
    },
  };
}
