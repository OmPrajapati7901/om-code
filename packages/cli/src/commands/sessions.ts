import { materialize } from "@om-code/session";
import { findProjectRoot, JournalReader, listSessions, resolveOmHome } from "@om-code/storage";
import { parseArgs } from "../args.js";
import { EXIT } from "../exit.js";
import { renderSessions } from "../render.js";
import type { CliDeps, CliResult } from "../types.js";

export async function sessionsCommand(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  const parsed = parseArgs(argv, "sessions", []);
  if (parsed.positionals.length > 0) {
    throw new Error(`unexpected argument "${parsed.positionals[0]}" for "sessions"`);
  }
  const location = {
    omHome: resolveOmHome(deps.env),
    projectRoot: findProjectRoot(deps.cwd),
  };
  const listed = await listSessions(location);
  const reader = new JournalReader(location);
  const rows = await Promise.all(
    listed.map(async ({ sessionId }) => {
      const view = materialize((await reader.readAll(sessionId)).records);
      return {
        id: sessionId,
        status: view.meta?.status ?? "unknown",
        lastActivity: view.lastActivityAt ?? "-",
      };
    }),
  );
  deps.io.write(renderSessions(rows));
  return { stdout: "", stderr: "", exitCode: EXIT.ok };
}
