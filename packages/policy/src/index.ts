/**
 * Public surface of @om-code/policy (LRN-21a core, LRN-21b tiers, LRN-21c
 * modes, LRN-21d fail-closed decisions).
 *
 * Capability requests in, allow/ask/deny out. Depends on
 * `@om-code/protocol` and `zod` only. Journaling and approvals arrive with
 * the runtime gate (LRN-21d) and LRN-22 — neither is stubbed here.
 */

export { decide } from "./decide.js";
export { isPolicyError, PolicyError, type PolicyErrorKind } from "./errors.js";
export { evaluate, type PolicyDecision } from "./evaluate.js";
export { POLICY_MODES, type PolicyMode, rulesForMode } from "./modes.js";
export {
  type PolicyOutcome,
  type PolicyRule,
  policyOutcomeSchema,
  policyRuleSchema,
  type RuleMatcher,
  ruleMatcherSchema,
} from "./rule.js";
export {
  POLICY_TIERS,
  type PolicyTier,
  PROJECT_POLICY_PATH,
  parseRuleFile,
  resolveTiers,
  type TieredDecision,
  type TierRules,
  USER_POLICY_PATH,
} from "./tiers.js";
