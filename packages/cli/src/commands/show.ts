import { materialize } from "@om-code/session";
import { findProjectRoot, JournalReader, resolveOmHome } from "@om-code/storage";
import { parseArgs } from "../args.js";
import { EXIT } from "../exit.js";
import { renderTranscript } from "../render.js";
import type { CliDeps, CliResult } from "../types.js";

export async function showCommand(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  const parsed = parseArgs(argv, "show", []);
  if (parsed.positionals.length !== 1) {
    throw new Error("show requires exactly one session id");
  }
  const sessionId = parsed.positionals[0] as string;
  const location = {
    omHome: resolveOmHome(deps.env),
    projectRoot: findProjectRoot(deps.cwd),
  };
  const view = materialize((await new JournalReader(location).readAll(sessionId)).records);
  deps.io.write(renderTranscript(sessionId, view));
  return { stdout: "", stderr: "", exitCode: EXIT.ok };
}
