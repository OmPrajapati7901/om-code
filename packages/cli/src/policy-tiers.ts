/**
 * Policy tier files (LRN-21d).
 *
 * Reads `<OM_HOME>/policy.json` (user) and `<root>/.om-code/policy.json`
 * (project) through stub drivers and parses them into rule lists. Absent
 * files are empty tiers, never errors; a malformed file fails startup
 * rather than guessing a policy. The session tier is supplied by approvals
 * (LRN-22), not by a file. Bounded reads: rule files above the cap fail
 * startup instead of loading half a policy.
 */

import {
  PROJECT_POLICY_PATH,
  parseRuleFile,
  type TierRules,
  USER_POLICY_PATH,
} from "@om-code/policy";
import type { CapabilityRequest } from "@om-code/protocol";
import { createLocalDriver, type StubClient } from "@om-code/stub-client";

const POLICY_READ_BYTES = 256 * 1024;
const POLICY_READ_MS = 10_000;

function envelope(cwd: string): {
  maxBytes: number;
  maxMs: number;
  cwd: string;
  envAllowlist: string[];
  capability: CapabilityRequest;
} {
  return {
    maxBytes: POLICY_READ_BYTES,
    maxMs: POLICY_READ_MS,
    cwd,
    envAllowlist: [],
    capability: { filesystem: { read: [], write: [] }, risk_class: "read" },
  };
}

async function readTierFile(
  stub: StubClient,
  cwd: string,
  path: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const stat = await stub.stat({ ...envelope(cwd), maxBytes: 1024, path }, signal);
  if (stat.entry === null) return undefined;
  const chunks: Uint8Array[] = [];
  let truncated = false;
  for await (const event of stub.read({ ...envelope(cwd), path }, signal)) {
    if (event.type === "chunk") chunks.push(event.bytes);
    else truncated = event.frame.truncated;
  }
  if (truncated) {
    throw new Error(
      `om: invalid policy file ${cwd}/${path}: exceeds the ${POLICY_READ_BYTES}-byte budget`,
    );
  }
  return Buffer.concat(chunks).toString("utf8");
}

function stubFor(root: string): StubClient {
  // Runs after session bootstrap, which creates OM_HOME — so the user-tier
  // root always exists here; a missing policy *file* reads as entry null.
  return createLocalDriver({ root });
}

export async function loadTierRules(deps: {
  omHome: string;
  projectRoot: string;
  signal: AbortSignal;
}): Promise<TierRules[]> {
  const tiers: TierRules[] = [];
  const files: { path: string; stub: StubClient; cwd: string; tier: TierRules["tier"] }[] = [
    { path: USER_POLICY_PATH, stub: stubFor(deps.omHome), cwd: deps.omHome, tier: "user" },
    {
      path: PROJECT_POLICY_PATH,
      stub: stubFor(deps.projectRoot),
      cwd: deps.projectRoot,
      tier: "project",
    },
  ];
  for (const file of files) {
    let text: string | undefined;
    try {
      text = await readTierFile(file.stub, file.cwd, file.path, deps.signal);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("om: invalid policy file"))
        throw error;
      throw new Error(
        `om: cannot read policy file ${file.cwd}/${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (text === undefined) continue;
    try {
      tiers.push({ tier: file.tier, rules: parseRuleFile(text) });
    } catch (error) {
      throw new Error(
        `om: invalid policy file ${file.cwd}/${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return tiers;
}
