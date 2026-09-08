/**
 * Fail-closed decisions (LRN-21d, AC-21.4/21.5).
 *
 * `decide` is the only entry point the runtime calls: it validates the raw
 * capability (anything unrecognized or partly parsed becomes `ask`, never
 * `allow` — the Rejects clause), resolves tiers, and converts *any* thrown
 * error anywhere in that path into a `deny`. Failing closed is structural
 * here, not a comment: there is no code path from a throw to `allow`.
 *
 * An implicit allow for `risk_class: "read"` sits below every tier so
 * read-only exploration keeps working with no policy files configured. It
 * carries a visible builtin id and loses to any explicit deny.
 */

import { capabilityRequestSchema } from "@om-code/protocol";
import type { PolicyRule } from "./rule.js";
import { resolveTiers, type TieredDecision, type TierRules } from "./tiers.js";

const BUILTIN_ALLOW_READ: PolicyRule = {
  id: "builtin/allow-read",
  outcome: "allow",
  reason: "read capabilities are allowed without configured policy",
  match: { risk_class: ["read"] },
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function decide(raw: unknown, tiers: readonly TierRules[]): TieredDecision {
  try {
    const parsed = capabilityRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined ? "(root)" : issue.path.map(String).join(".") || "(root)";
      return {
        outcome: "ask",
        reason: `unrecognized capability at ${where}: ${issue?.message ?? "schema mismatch"}`,
        ruleId: null,
        tier: null,
      };
    }
    return resolveTiers(parsed.data, [...tiers, { tier: "session", rules: [BUILTIN_ALLOW_READ] }]);
  } catch (error) {
    return {
      outcome: "deny",
      reason: `policy evaluation failed: ${messageOf(error)}`,
      ruleId: null,
      tier: null,
    };
  }
}
