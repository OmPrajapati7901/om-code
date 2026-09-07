import {
  createBounder,
  createRunBudget,
  DEFAULT_MAX_WALL_CLOCK_MS,
  DEFAULT_RESULT_BYTES,
  DEFAULT_TOOL_BUDGET,
} from "@om-code/context";
import type { SessionMode } from "@om-code/protocol";
import { materialize, type SessionView } from "@om-code/session";
import {
  type ConfigFlags,
  createBlobStore,
  JournalReader,
  requireComplete,
  resolveOmHome,
} from "@om-code/storage";
import { createLocalDriver } from "@om-code/stub-client";
import { createRegistry, readOnlyTools, toModelTool } from "@om-code/tools";
import { booleanFlag, type FlagDefinition, parseArgs, stringFlag } from "../args.js";
import { discoverRepository, loadInstructionFiles } from "../discovery.js";
import { buildEnvironment } from "../environment.js";
import { runRepl } from "../repl.js";
import { bootstrapSession } from "../session-bootstrap.js";
import { createToolRunner } from "../tool-runner.js";
import { driveTurn } from "../turn-driver.js";
import type { CliDeps, CliResult } from "../types.js";

const FLAGS: readonly FlagDefinition[] = [
  { name: "prompt", short: "p", takesValue: true },
  { name: "max-turns", takesValue: true },
  { name: "max-cost", takesValue: true },
  { name: "notrunc", takesValue: false },
  { name: "mode", takesValue: true },
  { name: "json", takesValue: false },
  { name: "base-url", takesValue: true },
  { name: "model", takesValue: true },
  { name: "credential", takesValue: true },
];

function parsePositiveInteger(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeMoney(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative number (USD)`);
  }
  return value;
}

function parseMode(raw: string | undefined): SessionMode {
  if (raw === undefined || raw === "manual") return "manual";
  if (raw === "read_only") return "plan";
  throw new Error('--mode must be "read_only" or "manual"');
}

export async function runCommand(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  const parsed = parseArgs(argv, "run", FLAGS);
  if (parsed.positionals.length > 0) {
    throw new Error(`unexpected argument "${parsed.positionals[0]}" for "run"`);
  }
  const baseUrl = stringFlag(parsed, "base-url");
  const model = stringFlag(parsed, "model");
  const credential = stringFlag(parsed, "credential");
  const flags: ConfigFlags = {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(model === undefined ? {} : { model }),
    ...(credential === undefined ? {} : { credential }),
  };
  const settings = requireComplete(deps.loadSettings({ env: deps.env, cwd: deps.cwd, flags }));
  // Blueprint §8.1 correction: startup rejects missing pricing — an endpoint
  // that reports no usage is unknowable before the first call, so that half
  // aborts mid-run (reason "max-cost-unknown-usage", exit 1) instead.
  const maxCostUsd = parseNonNegativeMoney(stringFlag(parsed, "max-cost"), "--max-cost");
  if (maxCostUsd !== undefined && settings.pricing === undefined) {
    throw new Error(
      "--max-cost cannot be enforced: pricing is unconfigured for the active model " +
        "(set OM_PRICING_INPUT_PER_MTOK and OM_PRICING_OUTPUT_PER_MTOK)",
    );
  }
  const mode = parseMode(stringFlag(parsed, "mode"));
  // Agent iterations: model inferences within one user request (LRN-19). The
  // old REPL user-line cap is gone; the kernel budget owns this number now.
  const maxTurns = parsePositiveInteger(stringFlag(parsed, "max-turns"), "--max-turns");
  const notrunc = booleanFlag(parsed, "notrunc");
  if (notrunc) {
    deps.io.writeErr("om: --notrunc disables result truncation for this run\n");
  }
  const json = booleanFlag(parsed, "json");
  const provider = deps.createProvider(settings);
  const startedAt = deps.now();
  const environment = buildEnvironment(deps.cwd, deps.osLabel, startedAt);
  const sessionId = deps.newId();
  const discovered = discoverRepository(deps.cwd);
  const location = {
    omHome: resolveOmHome(deps.env),
    projectRoot: discovered.root,
  };
  const emitRecord = (record: unknown) => {
    if (json) deps.io.write(`${JSON.stringify(record)}\n`);
  };
  const bootstrapped = await bootstrapSession({
    settings,
    location,
    sessionId,
    cwd: deps.cwd,
    mode,
    startedAt,
    now: deps.now,
    newId: deps.newId,
    onRecord: emitRecord,
  });
  let view: SessionView = bootstrapped.view;
  const stub = createLocalDriver({ root: location.projectRoot });
  const registry = createRegistry(readOnlyTools());
  const bounder = createBounder({
    blobs: createBlobStore({ omHome: location.omHome }),
    maxResultBytes: DEFAULT_RESULT_BYTES,
  });
  const toolRunner = createToolRunner({
    registry,
    io: stub,
    cwd: deps.cwd,
    envAllowlist: [],
    budget: { ...DEFAULT_TOOL_BUDGET },
    bounder,
    ...(notrunc ? { notrunc: true as const } : {}),
  });
  const modelTools = registry.descriptors().map(toModelTool);
  const maxWallClockMs = settings.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS;
  const runOne = async (text: string, signal: AbortSignal) => {
    // Fresh budget per user request: each agent run gets its own turn,
    // wall-clock and cost envelope.
    const budget = createRunBudget({
      maxTurns,
      maxWallClockMs,
      maxCostUsd,
      pricing: settings.pricing,
      now: () => Date.now(),
    });
    // Instruction files are re-read per request so mid-session edits apply;
    // only their hashes reach the journal (kernel `prompt` entry).
    const instructions = await loadInstructionFiles({
      stub,
      root: location.projectRoot,
      signal,
      warn: (message) => deps.io.writeErr(message),
    });
    const result = await driveTurn({
      session: view,
      text,
      provider,
      journal: bootstrapped.journal,
      newTurnId: deps.newId,
      signal,
      model: settings.model,
      environment,
      io: deps.io,
      json,
      modelTools,
      toolRunner,
      budget,
      instructions,
    });
    view = materialize((await new JournalReader(location).readAll(sessionId)).records);
    return result;
  };

  try {
    const prompt = stringFlag(parsed, "prompt");
    if (prompt !== undefined) {
      const controller = new AbortController();
      const interrupt = () => controller.abort();
      deps.io.input.on("om-interrupt", interrupt);
      try {
        const result = await runOne(prompt, controller.signal);
        if (result.phase === "interrupted") {
          deps.io.writeErr("om: turn interrupted\n");
        }
        return { stdout: "", stderr: "", exitCode: result.exitCode };
      } finally {
        deps.io.input.off("om-interrupt", interrupt);
      }
    }
    const exitCode = await runRepl({ io: deps.io, runTurn: runOne });
    return { stdout: "", stderr: "", exitCode };
  } finally {
    await bootstrapped.writer.close();
  }
}
