#!/usr/bin/env node
/**
 * The `om` binary. The only module in this package that reads `process` or
 * writes to a stream; everything it decides is decided in `runCli`.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so pending stdout
 * writes are not truncated when output is piped.
 */

import { OpenAICompatibleProvider } from "@om-code/providers";
import { loadSettings } from "@om-code/storage";
import { v7 } from "uuid";
import { type CliResult, runCli } from "./cli.js";

const forwardInterrupt = () => process.stdin.emit("om-interrupt");
process.on("SIGINT", forwardInterrupt);
let result: CliResult;
try {
  result = await runCli(process.argv.slice(2), {
    host: { platform: process.platform, arch: process.arch },
    env: process.env,
    cwd: process.cwd(),
    loadSettings: (options) => loadSettings(options),
    io: {
      write: (text) => process.stdout.write(text),
      writeErr: (text) => process.stderr.write(text),
      input: process.stdin,
      output: process.stdout,
      isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    },
    now: () => new Date(),
    newId: () => v7(),
    createProvider: (settings) =>
      new OpenAICompatibleProvider({
        baseUrl: settings.baseUrl,
        getApiKey: () => settings.credential.unwrap(),
      }),
    osLabel: `${process.platform}/${process.arch}`,
  });
} finally {
  process.off("SIGINT", forwardInterrupt);
}

if (result.stdout !== "") {
  process.stdout.write(result.stdout);
}
if (result.stderr !== "") {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
