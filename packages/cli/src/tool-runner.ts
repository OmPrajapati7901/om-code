/**
 * LRN-18: the CLI adapter satisfying kernel's `ToolRunner`.
 * LRN-19: every outcome passes through context's bounder before it returns.
 * LRN-21d: the policy gate — every capability is decided and the decision
 * journaled (permission v2) before execution; anything but `allow` ends
 * `denied` without `execute()` running.
 *
 * Delegates to `runTool` so AC-16.6's plan() → record → execute() sequencing
 * is preserved rather than reimplemented. Tool failures return a
 * failed-status outcome and never throw (AC-18.4), so one bad call cannot
 * abort the turn — but a *journal* failure rethrows and fails the turn,
 * because proceeding without the authorizing record would violate
 * append-before-effect. Truncation lives here, in the runtime — never in
 * any tool (AC-19.1).
 */

import type { Bounder } from "@om-code/context";
import type { ToolRunner } from "@om-code/kernel";
import { decide, type TieredDecision, type TierRules } from "@om-code/policy";
import type { CompleteToolCall, Permission, ToolCall } from "@om-code/protocol";
import { runTool, type ToolIo, type ToolRegistry } from "@om-code/tools";

export type ToolRunnerDeps = {
  readonly registry: ToolRegistry;
  readonly io: ToolIo;
  readonly cwd: string;
  readonly envAllowlist: readonly string[];
  readonly budget: { readonly maxBytes: number; readonly maxMs: number };
  readonly bounder: Bounder;
  /** Operator opt-out from `om run --notrunc` (AC-19.7); never model-settable. */
  readonly notrunc?: boolean;
  /** Policy tiers (user + project); the session tier arrives with approvals in LRN-22. */
  readonly policyTiers: readonly TierRules[];
};

type RawOutcome = {
  readonly status: "error" | "ok" | "denied" | "cancelled" | "timeout" | "unknown";
  readonly preview: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly blob_ref?: string;
};

function failedOutcome(preview: string): RawOutcome {
  return {
    status: "error",
    preview,
    bytes: Buffer.byteLength(preview, "utf8"),
    truncated: false,
  };
}

export function createToolRunner(deps: ToolRunnerDeps): ToolRunner {
  return {
    async run(
      call: CompleteToolCall,
      runnerDeps: {
        readonly record: (call: ToolCall) => Promise<void>;
        readonly signal: AbortSignal;
        readonly recordPermission?: (entry: Permission) => Promise<void>;
      },
    ) {
      const raw = await executeRaw(deps, call, runnerDeps);
      try {
        return await deps.bounder.bound(raw, deps.notrunc === true ? { notrunc: true } : {});
      } catch {
        // A spill failure (e.g. unwritable OM_HOME) must not turn a good tool
        // result into a turn-aborting throw (AC-18.4); the raw outcome still
        // journals, and the commit path surfaces durable failures instead.
        return raw;
      }
    },
  };
}

function deniedPreview(call: CompleteToolCall, decision: TieredDecision): string {
  const head =
    decision.outcome === "deny"
      ? `policy denied tool "${call.name}" (${call.call_id}): ${decision.reason}`
      : `policy approval required for tool "${call.name}" (${call.call_id}): ${decision.reason}`;
  return `${head} — interactive approval arrives in LRN-22`;
}

async function executeRaw(
  deps: ToolRunnerDeps,
  call: CompleteToolCall,
  runnerDeps: {
    readonly record: (call: ToolCall) => Promise<void>;
    readonly signal: AbortSignal;
    readonly recordPermission?: (entry: Permission) => Promise<void>;
  },
): Promise<RawOutcome> {
  const tool = deps.registry.get(call.name);
  if (tool === undefined) {
    return failedOutcome(`unknown tool "${call.name}" for call ${call.call_id}`);
  }
  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(call.arguments_raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failedOutcome(
      `invalid JSON arguments for tool "${call.name}" (${call.call_id}): ${detail}; raw: ${call.arguments_raw}`,
    );
  }
  const ctx = {
    cwd: deps.cwd,
    envAllowlist: deps.envAllowlist,
    budget: deps.budget,
    signal: runnerDeps.signal,
  };
  let permissionError: unknown;
  try {
    let terminal: RawOutcome | undefined;
    let decision: TieredDecision | undefined;
    for await (const event of runTool(tool, parsedInput, deps.io, ctx, {
      record: runnerDeps.record,
      callId: call.call_id,
      authorize: async (capability) => {
        decision = decide(capability, deps.policyTiers);
        try {
          await runnerDeps.recordPermission?.({
            kind: "permission",
            schemaVersion: 2,
            call_id: call.call_id,
            decision: decision.outcome,
            scope: "once",
            decided_by: decision.ruleId === null ? "system" : "rule",
            reason: decision.reason,
          });
        } catch (error) {
          // A failed permission journal must abort the turn, not convert
          // into a tool failure: proceeding without the authorizing record
          // would violate append-before-effect (reidentified below).
          permissionError = error;
          throw error;
        }
        return decision.outcome === "allow";
      },
    })) {
      // Each tool yields its preview as `output` and then again inside
      // `end` — discard the former and journal the latter verbatim.
      if (event.type === "end") terminal = event.result;
    }
    if (terminal === undefined) {
      return failedOutcome(
        `tool "${call.name}" violated the event protocol: generator ended without an end event (${call.call_id})`,
      );
    }
    if (terminal.status === "denied" && decision !== undefined && decision.outcome !== "allow") {
      // Reasons stay out of the tools package (AC-16.2): the seam yields an
      // empty denied end and the caller substitutes its own accounting here.
      const preview = deniedPreview(call, decision);
      return { ...terminal, preview, bytes: Buffer.byteLength(preview, "utf8") };
    }
    return terminal;
  } catch (error) {
    if (error === permissionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return failedOutcome(`tool "${call.name}" failed (${call.call_id}): ${message}`);
  }
}
