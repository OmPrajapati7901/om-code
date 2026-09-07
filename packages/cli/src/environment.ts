import type { Environment } from "@om-code/kernel";
import { findProjectRoot } from "@om-code/storage";

export function buildEnvironment(cwd: string, osLabel: string, now: Date): Environment {
  return {
    cwd,
    projectRoot: findProjectRoot(cwd),
    os: osLabel,
    date: now.toISOString().slice(0, 10),
  };
}
