#!/usr/bin/env node
/**
 * The `om` binary. The only module in this package that reads `process` or
 * writes to a stream; everything it decides is decided in `runCli`.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so pending stdout
 * writes are not truncated when output is piped.
 */

import { loadSettings } from "@om-code/storage";
import { runCli } from "./cli.js";

const result = runCli(process.argv.slice(2), {
  host: { platform: process.platform, arch: process.arch },
  env: process.env,
  cwd: process.cwd(),
  loadSettings: (options) => loadSettings(options),
});

if (result.stdout !== "") {
  process.stdout.write(result.stdout);
}
if (result.stderr !== "") {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
