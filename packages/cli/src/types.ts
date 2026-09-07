/**
 * Shared CLI seams (`CliDeps`, `CliIo`, `CliResult`, `ConfigLoader`).
 *
 * This is a leaf inside `packages/cli/src`: it imports only workspace ports
 * and `platform.ts`, never the dispatch in `cli.ts` or any command. That
 * keeps the import graph acyclic — `cli.ts` is the composition root that
 * commands import types from, so if the types lived in `cli.ts` every
 * command would close a `cli -> command -> cli` cycle (LRN-14,
 * `no-circular`). Import these from `./types.js`, never from `./cli.js`.
 */

import type { ModelProvider } from "@om-code/protocol";
import type { LoadSettingsOptions, ResolvedSettings, RuntimeSettings } from "@om-code/storage";
import type { HostPlatform } from "./platform.js";

export type CliResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type ConfigLoader = (options: LoadSettingsOptions) => ResolvedSettings;

export type CliIo = {
  readonly write: (text: string) => void;
  readonly writeErr: (text: string) => void;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly isTty: boolean;
};

export type CliDeps = {
  readonly host: HostPlatform;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  readonly loadSettings: ConfigLoader;
  readonly io: CliIo;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly createProvider: (settings: RuntimeSettings) => ModelProvider;
  readonly osLabel: string;
};
