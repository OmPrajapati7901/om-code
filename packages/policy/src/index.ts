/**
 * Public surface of @om-code/policy (LRN-21a decision core, LRN-21b tiers).
 *
 * Capability requests in, allow/ask/deny out. Depends on
 * `@om-code/protocol` and `zod` only. Modes arrive in LRN-21c, fail-closed
 * evaluation and journaling in LRN-21d — neither is stubbed here.
 */

export { isPolicyError, PolicyError, type PolicyErrorKind } from "./errors.js";
export { evaluate, type PolicyDecision } from "./evaluate.js";
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
