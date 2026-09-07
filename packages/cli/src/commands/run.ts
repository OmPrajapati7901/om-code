import type { SessionMode } from "@om-code/protocol";
import { materialize, type SessionView } from "@om-code/session";
import {
  type ConfigFlags,
  findProjectRoot,
  JournalReader,
  requireComplete,
  resolveOmHome,
} from "@om-code/storage";
import { createLocalDriver } from "@om-code/stub-client";
import { createRegistry, readOnlyTools, toModelTool } from "@om-code/tools";
import { booleanFlag, type FlagDefinition, parseArgs, stringFlag } from "../args.js";
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
  if (stringFlag(parsed, "max-cost") !== undefined) {
    throw new Error("--max-cost cannot be enforced: pricing is unconfigured for the active model");
  }
  const mode = parseMode(stringFlag(parsed, "mode"));
  const maxTurns = parsePositiveInteger(stringFlag(parsed, "max-turns"), "--max-turns");
  const json = booleanFlag(parsed, "json");
  const provider = deps.createProvider(settings);
  const startedAt = deps.now();
  const environment = buildEnvironment(deps.cwd, deps.osLabel, startedAt);
  const sessionId = deps.newId();
  const location = {
    omHome: resolveOmHome(deps.env),
    projectRoot: findProjectRoot(deps.cwd),
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
  // LRN-19 takes ownership of these numbers; the interim budget below only
  // lets LRN-18's tools run behind the same envelope the stub enforces.
  const INTERIM_BUDGET = { maxBytes: 64 * 1024, maxMs: 30_000 };
  const stub = createLocalDriver({ root: location.projectRoot });
  const registry = createRegistry(readOnlyTools());
  const toolRunner = createToolRunner({
    registry,
    io: stub,
    cwd: deps.cwd,
    envAllowlist: [],
    budget: INTERIM_BUDGET,
  });
  const modelTools = registry.descriptors().map(toModelTool);
  const runOne = async (text: string, signal: AbortSignal) => {
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
    const exitCode = await runRepl({
      io: deps.io,
      maxTurns,
      runTurn: runOne,
      appendLimit: async (entry) => {
        await bootstrapped.journal.append(entry, { by: "system" });
      },
    });
    return { stdout: "", stderr: "", exitCode };
  } finally {
    await bootstrapped.writer.close();
  }
}
