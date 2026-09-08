/**
 * Policy modes (LRN-21c, AC-21.6).
 *
 * Modes contribute implicit deny rules, merged into the user tier list by
 * the caller — deny-anywhere-wins keeps them global, so no tier can loosen
 * them and no signature change to `resolveTiers` is needed. `manual` imposes
 * nothing. The CLI maps its session mode (`plan`/`manual`) onto `PolicyMode`
 * where composition happens (LRN-21d/22), not here.
 */

import type { PolicyRule } from "./rule.js";

export const POLICY_MODES = ["read_only", "manual"] as const;

export type PolicyMode = (typeof POLICY_MODES)[number];

const READ_ONLY_DENIED = ["write_workspace", "exec", "destructive"] as const;

/**
 * Implicit rules for a mode. `read_only` denies every non-read capability
 * class; `manual` contributes none. Ids are namespaced `read-only/...` so
 * decisions stay attributable in the reason chain.
 */
export function rulesForMode(mode: PolicyMode): PolicyRule[] {
  if (mode === "manual") return [];
  return READ_ONLY_DENIED.map((risk_class) => ({
    id: `read-only/deny-${risk_class}`,
    outcome: "deny" as const,
    reason: `read_only mode denies ${risk_class} capabilities`,
    match: { risk_class: [risk_class] },
  }));
}
