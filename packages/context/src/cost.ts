/**
 * Cost accounting (LRN-19, AC-19.6). Pure arithmetic over reported usage —
 * never estimated: unknown usage yields `undefined`, never zero.
 */

import type { Usage } from "@om-code/protocol";

export type ModelPricing = {
  /** USD per million input tokens. */
  readonly inputPerMTok: number;
  /** USD per million output tokens. */
  readonly outputPerMTok: number;
};

/** USD for one inference, or `undefined` when the endpoint reported nothing. */
export function usdFor(usage: Usage, pricing: ModelPricing): number | undefined {
  if (usage.kind === "unknown") return undefined;
  return (
    (usage.input_tokens / 1_000_000) * pricing.inputPerMTok +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMTok
  );
}
