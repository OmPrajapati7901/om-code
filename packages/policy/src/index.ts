/**
 * Public surface of @om-code/policy (LRN-21a core, LRN-21b tiers, LRN-21c modes).
 *
 * Capability requests in, allow/ask/deny out. Depends on
 * `@om-code/protocol` and `zod` only. Fail-closed evaluation and journaling
 * arrive in LRN-21d — neither is stubbed here.
 */

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
