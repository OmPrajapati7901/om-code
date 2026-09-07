import { readFileSync } from "node:fs";

export function planted(path: string): string {
  return readFileSync(path, "utf8");
}
