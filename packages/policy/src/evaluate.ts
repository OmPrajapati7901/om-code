/**
 * The decision core (LRN-21a, AC-21.1/21.2a).
 *
 * `evaluate` takes a `CapabilityRequest` and nothing else — tool identity is
 * unrepresentable in the signature, so policy can never branch on which tool
 * asked. Pure: no clock, no filesystem, no network.
 */

import type { CapabilityRequest } from "@om-code/protocol";
import type { PolicyOutcome, PolicyRule } from "./rule.js";

export type PolicyDecision = {
  readonly outcome: PolicyOutcome;
  readonly reason: string;
  /** The winning rule, or `null` when nothing matched (default `ask`). */
  readonly ruleId: string | null;
};

const PRECEDENCE: Record<PolicyOutcome, number> = { deny: 0, ask: 1, allow: 2 };

function normalizeRulePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Exact match or under-on-`/`-boundaries: `src` covers `src/a.ts`, never `src-evil/x`. */
function pathCovers(rulePath: string, requestPath: string): boolean {
  const base = normalizeRulePath(rulePath);
  return requestPath === base || requestPath.startsWith(`${base}/`);
}

function requestPaths(request: CapabilityRequest): readonly string[] {
  return [...(request.filesystem?.read ?? []), ...(request.filesystem?.write ?? [])];
}

function matches(rule: PolicyRule, request: CapabilityRequest): boolean {
  if (rule.match.risk_class !== undefined && !rule.match.risk_class.includes(request.risk_class)) {
    return false;
  }
  if (rule.match.paths !== undefined) {
    const requested = requestPaths(request);
    if (
      !rule.match.paths.some((rulePath) => requested.some((path) => pathCovers(rulePath, path)))
    ) {
      return false;
    }
  }
  return true;
}

export function evaluate(request: CapabilityRequest, rules: readonly PolicyRule[]): PolicyDecision {
  let winner: PolicyRule | undefined;
  for (const rule of rules) {
    if (!matches(rule, request)) continue;
    // First match wins within a precedence; a stronger precedence always wins.
    if (winner === undefined || PRECEDENCE[rule.outcome] < PRECEDENCE[winner.outcome]) {
      winner = rule;
    }
  }
  if (winner === undefined) {
    return {
      outcome: "ask",
      reason: "no policy rule matched this capability",
      ruleId: null,
    };
  }
  return { outcome: winner.outcome, reason: winner.reason, ruleId: winner.id };
}
