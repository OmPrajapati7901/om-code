/**
 * Argument dispatch for `om`.
 *
 * `runCli` is a pure function of its arguments and its deps: it returns what
 * to print and what to exit with rather than writing or exiting itself. That
 * keeps every path — including the unsupported-host path — asserted by an
 * ordinary unit test. `src/om.ts` is the only module that touches `process`.
 *
 * The real agent commands (`run`, `sessions`, `show`) arrive in LRN-11. Until
 * then those names are recognised and refused with a pointer, rather than
 * reported as typos. `config print` arrives in LRN-04 and is dispatched for
 * real.
 */

import {
  type ConfigFlags,
  isConfigError,
  type LoadSettingsOptions,
  type ResolvedSettings,
  requireComplete,
} from "@om-code/storage";
import { renderConfigTable } from "./commands/config-print.js";
import { checkPlatform, type HostPlatform } from "./platform.js";
import { readVersion } from "./version.js";

export type CliResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type ConfigLoader = (options: LoadSettingsOptions) => ResolvedSettings;

export type CliDeps = {
  readonly host: HostPlatform;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  readonly loadSettings: ConfigLoader;
};

/** Commands the backlog defines but that no milestone has delivered yet. */
const PLANNED_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["run", "LRN-11"],
  ["sessions", "LRN-11"],
  ["show", "LRN-11"],
  ["resume", "LRN-29"],
]);

const HELP = `om — a learning coding agent (macOS arm64)

Usage:
  om --version          print the version
  om --help             print this message
  om config print --effective --with-sources
                        print the effective settings with their sources

No agent commands exist yet: om run, om sessions and om show arrive in LRN-11.
See docs/om-code-agent-execution-backlog.md.
`;

function ok(stdout: string): CliResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string): CliResult {
  return { stdout: "", stderr, exitCode: 1 };
}

type ConfigPrintArgs = {
  readonly flags: ConfigFlags;
};

function parseConfigPrintArgs(rest: readonly string[]): ConfigPrintArgs | CliResult {
  const flags: { baseUrl?: string; model?: string; credential?: string } = {};
  let index = 0;
  while (index < rest.length) {
    const arg = rest[index] as string;
    if (arg === "--effective" || arg === "--with-sources") {
      index += 1;
      continue;
    }
    if (arg === "--base-url" || arg === "--model" || arg === "--credential") {
      const next = rest[index + 1];
      if (next === undefined || next.startsWith("--")) {
        return fail(`om: flag "${arg}" requires a value.\n`);
      }
      if (arg === "--base-url") {
        flags.baseUrl = next;
      } else if (arg === "--model") {
        flags.model = next;
      } else {
        flags.credential = next;
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      flags.baseUrl = arg.slice("--base-url=".length);
      index += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      flags.model = arg.slice("--model=".length);
      index += 1;
      continue;
    }
    if (arg.startsWith("--credential=")) {
      flags.credential = arg.slice("--credential=".length);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return fail(`om: unknown flag "${arg}" for "config print".\n`);
    }
    return fail(`om: unexpected argument "${arg}" for "config print".\n`);
  }
  return { flags };
}

function runConfigPrint(argv: readonly string[], deps: CliDeps): CliResult {
  const subcommand = argv[1];
  if (subcommand === undefined) {
    return fail(`om: config requires a subcommand ("print").\n`);
  }
  if (subcommand !== "print") {
    return fail(`om: unknown config subcommand "${subcommand}". Run "om --help".\n`);
  }
  const parsed = parseConfigPrintArgs(argv.slice(2));
  if ("exitCode" in parsed) {
    return parsed;
  }
  let resolved: ResolvedSettings;
  try {
    resolved = deps.loadSettings({ env: deps.env, cwd: deps.cwd, flags: parsed.flags });
  } catch (error) {
    if (isConfigError(error)) {
      return fail(`${error.message}\n`);
    }
    throw error;
  }
  const table = renderConfigTable(resolved);
  try {
    requireComplete(resolved);
  } catch (error) {
    if (isConfigError(error)) {
      return { stdout: table, stderr: `${error.message}\n`, exitCode: 1 };
    }
    throw error;
  }
  return ok(table);
}

export function runCli(argv: readonly string[], deps: CliDeps): CliResult {
  // AC-3.4: the guard runs before any command, so no code path proceeds on an
  // unsupported host — not even one that would otherwise be harmless.
  const platform = checkPlatform(deps.host);
  if (!platform.supported) {
    return fail(`${platform.message}\n`);
  }

  const first = argv[0];
  if (first === undefined) {
    return ok(HELP);
  }

  switch (first) {
    case "--version":
    case "-v":
      return ok(`${readVersion()}\n`);
    case "--help":
    case "-h":
      return ok(HELP);
    case "config":
      return runConfigPrint(argv, deps);
    default:
      break;
  }

  const milestone = PLANNED_COMMANDS.get(first);
  if (milestone !== undefined) {
    return fail(`om: "${first}" is not implemented yet; it arrives in ${milestone}.\n`);
  }

  return fail(`om: unknown argument "${first}". Run "om --help".\n`);
}
