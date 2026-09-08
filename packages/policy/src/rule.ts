/**
 * Policy rules as data (LRN-21a, LR-FR-016).
 *
 * Rules are serializable matchers over `CapabilityRequest` — never over tool
 * names (architecture: "authorize effects, not tool names"). Data, not
 * closures, so LRN-21b's tier files can load them unchanged. Zod is the one
 * source for the shape (the AC-16.5 argument), since 21b parses files into
 * exactly this schema.
 */

import { capabilityRequestSchema } from "@om-code/protocol";
import { z } from "zod";

export const policyOutcomeSchema = z.enum(["allow", "ask", "deny"]);

export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;

export const ruleMatcherSchema = z
  .object({
    /** Membership in one of the capability's own risk classes; omitted is wildcard. */
    risk_class: z.array(capabilityRequestSchema.shape.risk_class).min(1).optional(),
    /**
     * Literal path prefixes; omitted is wildcard. A request matches when any
     * of its filesystem read/write paths equals a listed path or sits under
     * it. No regex, no globs in 21a — user pattern syntax is 21b's job.
     */
    paths: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export type RuleMatcher = z.infer<typeof ruleMatcherSchema>;

export const policyRuleSchema = z
  .object({
    id: z.string().min(1),
    outcome: policyOutcomeSchema,
    reason: z.string().min(1),
    /** `{}` is an explicit match-all; every key omitted is a wildcard. */
    match: ruleMatcherSchema,
  })
  .strict();

export type PolicyRule = z.infer<typeof policyRuleSchema>;
