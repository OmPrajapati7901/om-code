/**
 * Public surface of @om-code/policy (LRN-21a).
 *
 * The decision core: capability requests in, allow/ask/deny out. Depends on
 * `@om-code/protocol` and `zod` only. Tiers arrive in LRN-21b, modes in
 * LRN-21c, fail-closed evaluation and journaling in LRN-21d — none are
 * stubbed here.
 */

export { evaluate, type PolicyDecision } from "./evaluate.js";
export {
  type PolicyOutcome,
  type PolicyRule,
  policyOutcomeSchema,
  policyRuleSchema,
  type RuleMatcher,
  ruleMatcherSchema,
} from "./rule.js";
