/**
 * Tier resolution (LRN-21b, AC-21.2b/21.3, LR-FR-016).
 *
 * Rule lists arrive per tier — user > project > session — and resolve into
 * one decision. Merge rule: a `deny` from any tier wins (a lower tier can
 * never loosen a higher tier's deny, and tightening is always honored);
 * otherwise `ask` beats `allow`; same-precedence ties go to the higher tier.
 * The reason always names the winning tier and rule. Pure: no clock, no
 * filesystem, no network. File I/O (reading `policy.json` tiers) belongs to
 * LRN-21d; here `parseRuleFile` turns already-read text into rules.
 */

import type { CapabilityRequest } from "@om-code/protocol";
import { z } from "zod";
import { isPolicyError, PolicyError } from "./errors.js";
import { evaluate, type PolicyDecision } from "./evaluate.js";
import { type PolicyOutcome, type PolicyRule, policyRuleSchema } from "./rule.js";

export const POLICY_TIERS = ["user", "project", "session"] as const;

export type PolicyTier = (typeof POLICY_TIERS)[number];

/**
 * Tier rule-file locations, relative to their bases (LRN-21d reads them;
 * this module only parses text): user `<OM_HOME>/policy.json`, project
 * `<project-root>/.om-code/policy.json`.
 */
export const USER_POLICY_PATH = "policy.json";
export const PROJECT_POLICY_PATH = ".om-code/policy.json";

export type TierRules = {
  readonly tier: PolicyTier;
  readonly rules: readonly PolicyRule[];
};

export type TieredDecision = PolicyDecision & {
  /** The winning tier, or `null` when every tier was empty (default ask). */
  readonly tier: PolicyTier | null;
};

const PRECEDENCE: Record<PolicyOutcome, number> = { deny: 0, ask: 1, allow: 2 };

export function resolveTiers(
  request: CapabilityRequest,
  tiers: readonly TierRules[],
): TieredDecision {
  const seen: Partial<Record<PolicyTier, PolicyRule[]>> = {};
  for (const { tier, rules } of tiers) {
    // Same-tier entries accumulate rather than overwrite: silently dropping
    // a duplicate list could drop a deny, and this module never drops rules.
    seen[tier] = [...(seen[tier] ?? []), ...rules];
  }
  // Tiers with no matching rule abstain (21a's default ask stays inside
  // `evaluate` for standalone use): otherwise every silent tier would
  // outrank a genuine allow elsewhere and session grants could never work.
  const contenders: { tier: PolicyTier; decision: PolicyDecision }[] = [];
  for (const tier of POLICY_TIERS) {
    const rules = seen[tier];
    if (rules === undefined) continue;
    const decision = evaluate(request, rules);
    if (decision.ruleId !== null) contenders.push({ tier, decision });
  }
  let winner: (typeof contenders)[number] | undefined;
  for (const contender of contenders) {
    if (
      winner === undefined ||
      PRECEDENCE[contender.decision.outcome] < PRECEDENCE[winner.decision.outcome]
    ) {
      winner = contender;
    }
  }
  if (winner === undefined) {
    return {
      outcome: "ask",
      reason: "no policy rule matched this capability",
      ruleId: null,
      tier: null,
    };
  }
  const { tier, decision } = winner;
  if (decision.ruleId === null) {
    // Default ask inside the winning tier: keep 21a's reason verbatim rather
    // than inventing a tier claim for a rule that does not exist.
    return { ...decision, tier };
  }
  return { ...decision, reason: `[${tier}] ${decision.reason}`, tier };
}

const ruleFileSchema = z.array(policyRuleSchema);

/** Parse rule-file text into rules; malformed files are a typed error, never a guess. */
export function parseRuleFile(text: string): PolicyRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PolicyError("invalid-rules", `invalid policy rules: not JSON (${detail})`);
  }
  const result = ruleFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new PolicyError(
      "invalid-rules",
      `invalid policy rules: ${issue?.message ?? "schema mismatch"}`,
      { path: issue?.path.map(String) ?? [] },
    );
  }
  return result.data;
}

export { isPolicyError };
