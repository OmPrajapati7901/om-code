/**
 * Argument dispatch for `om`.
 *
 * `runCli` is a pure function of its arguments and the host descriptor: it
 * returns what to print and what to exit with rather than writing or exiting
 * itself. That keeps every path — including the unsupported-host path — asserted
 * by an ordinary unit test. `src/om.ts` is the only module that touches
 * `process`.
 *
 * The real command surface (`run`, `sessions`, `show`) arrives in LRN-11 and
 * `config` in LRN-04. Until then those names are recognised and refused with a
 * pointer, rather than reported as typos.
 */

import { checkPlatform, type HostPlatform } from "./platform.js";
import { readVersion } from "./version.js";

export type CliResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

/** Commands the backlog defines but that no milestone has delivered yet. */
const PLANNED_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["run", "LRN-11"],
  ["sessions", "LRN-11"],
  ["show", "LRN-11"],
  ["resume", "LRN-29"],
  ["config", "LRN-04"],
]);

const HELP = `om — a learning coding agent (macOS arm64)

Usage:
  om --version          print the version
  om --help             print this message

No agent commands exist yet: om run, om sessions and om show arrive in LRN-11,
om config in LRN-04. See docs/om-code-agent-execution-backlog.md.
`;

function ok(stdout: string): CliResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string): CliResult {
  return { stdout: "", stderr, exitCode: 1 };
}

export function runCli(argv: readonly string[], host: HostPlatform): CliResult {
  // AC-3.4: the guard runs before any command, so no code path proceeds on an
  // unsupported host — not even one that would otherwise be harmless.
  const platform = checkPlatform(host);
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
    default:
      break;
  }

  const milestone = PLANNED_COMMANDS.get(first);
  if (milestone !== undefined) {
    return fail(`om: "${first}" is not implemented yet; it arrives in ${milestone}.\n`);
  }

  return fail(`om: unknown argument "${first}". Run "om --help".\n`);
}
