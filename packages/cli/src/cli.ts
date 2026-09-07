/** Argument dispatch and injected runtime seams for `om`. */

import {
  type ConfigFlags,
  isConfigError,
  type ResolvedSettings,
  requireComplete,
} from "@om-code/storage";
import { booleanFlag, type FlagDefinition, parseArgs, stringFlag } from "./args.js";
import { renderConfigTable } from "./commands/config-print.js";
import { runCommand } from "./commands/run.js";
import { sessionsCommand } from "./commands/sessions.js";
import { showCommand } from "./commands/show.js";
import { EXIT } from "./exit.js";
import { checkPlatform } from "./platform.js";
import { prefixedError } from "./render.js";
import type { CliDeps, CliResult } from "./types.js";
import { readVersion } from "./version.js";

export type { CliDeps, CliIo, CliResult, ConfigLoader } from "./types.js";

/** Commands the backlog defines but that no milestone has delivered yet. */
const PLANNED_COMMANDS: ReadonlyMap<string, string> = new Map([["resume", "LRN-29"]]);

const HELP = `om — a learning coding agent (macOS arm64)

Usage:
  om run [-p <prompt>] [--mode read_only|manual] [--max-turns N] [--json]
                        start a conversation or run one prompt
  om sessions           list this project's sessions
  om show <id>           render a journaled session without inference
  om config print --effective --with-sources
                        print the effective settings with their sources
  om --version          print the version
  om --help             print this message

Exit codes: 0 success, 1 error, 2 needs approval, 3 limit, 4 denied.
Codes 2 and 4 become reachable when policy lands in LRN-22.
`;

function ok(stdout: string): CliResult {
  return { stdout, stderr: "", exitCode: EXIT.ok };
}

function fail(stderr: string): CliResult {
  return { stdout: "", stderr, exitCode: EXIT.error };
}

const CONFIG_FLAGS: readonly FlagDefinition[] = [
  { name: "effective", takesValue: false },
  { name: "with-sources", takesValue: false },
  { name: "base-url", takesValue: true },
  { name: "model", takesValue: true },
  { name: "credential", takesValue: true },
];

function runConfigPrint(argv: readonly string[], deps: CliDeps): CliResult {
  const subcommand = argv[1];
  if (subcommand === undefined) {
    return fail('om: config requires a subcommand ("print").\n');
  }
  if (subcommand !== "print") {
    return fail(`om: unknown config subcommand "${subcommand}". Run "om --help".\n`);
  }
  const parsed = parseArgs(argv.slice(2), "config print", CONFIG_FLAGS);
  if (parsed.positionals.length > 0) {
    return fail(`om: unexpected argument "${parsed.positionals[0]}" for "config print".\n`);
  }
  // Accepted for compatibility and discoverability; their presence is not
  // required because config print always prints the effective sourced view.
  booleanFlag(parsed, "effective");
  booleanFlag(parsed, "with-sources");
  const baseUrl = stringFlag(parsed, "base-url");
  const model = stringFlag(parsed, "model");
  const credential = stringFlag(parsed, "credential");
  const flags: ConfigFlags = {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(model === undefined ? {} : { model }),
    ...(credential === undefined ? {} : { credential }),
  };
  let resolved: ResolvedSettings;
  try {
    resolved = deps.loadSettings({ env: deps.env, cwd: deps.cwd, flags });
  } catch (error) {
    if (isConfigError(error)) return fail(`${error.message}\n`);
    throw error;
  }
  const table = renderConfigTable(resolved);
  try {
    requireComplete(resolved);
  } catch (error) {
    if (isConfigError(error)) {
      return { stdout: table, stderr: `${error.message}\n`, exitCode: EXIT.error };
    }
    throw error;
  }
  return ok(table);
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  // AC-3.4: no command proceeds on an unsupported host.
  const platform = checkPlatform(deps.host);
  if (!platform.supported) return fail(`${platform.message}\n`);

  const first = argv[0];
  if (first === undefined) return ok(HELP);

  try {
    switch (first) {
      case "--version":
      case "-v":
        return ok(`${readVersion()}\n`);
      case "--help":
      case "-h":
        return ok(HELP);
      case "config":
        return runConfigPrint(argv, deps);
      case "run":
        return await runCommand(argv.slice(1), deps);
      case "sessions":
        return await sessionsCommand(argv.slice(1), deps);
      case "show":
        return await showCommand(argv.slice(1), deps);
      default:
        break;
    }

    const milestone = PLANNED_COMMANDS.get(first);
    if (milestone !== undefined) {
      return fail(`om: "${first}" is not implemented yet; it arrives in ${milestone}.\n`);
    }
    return fail(`om: unknown argument "${first}". Run "om --help".\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(prefixedError(message));
  }
}
