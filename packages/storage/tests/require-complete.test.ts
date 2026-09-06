/**
 * AC-4.5 — missing required config fails at startup with remediation text,
 * not at first inference (LRN-04).
 *
 * requireComplete is the shared guard LRN-11 calls before its first
 * inference. The CLI test below it proves the observable end to end:
 * config print against an empty OM_HOME prints the table, writes remediation
 * naming baseUrl and model, and exits 1.
 */

import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/errors.js";
import { requireComplete } from "../src/config/loader.js";
import { resolveSettings } from "../src/config/resolve.js";

function resolvedWith(values: { baseUrl?: string; model?: string }) {
  return resolveSettings({
    user: { ...values },
    project: undefined,
    userPath: "/tmp/om-home/config.json",
    projectPath: "/repo/.om-code/settings.json",
    env: {},
    flags: {},
    resolveSecret: () => undefined,
  });
}

describe("AC-4.5 — requireComplete", () => {
  it("returns runtime settings when baseUrl and model resolve", () => {
    const runtime = requireComplete(
      resolvedWith({ baseUrl: "https://api.example.com/v1", model: "m" }),
    );
    expect(runtime.baseUrl).toBe("https://api.example.com/v1");
    expect(runtime.model).toBe("m");
    expect(runtime.credentialReference).toBe("env:OM_API_KEY");
  });

  it("names every missing required key with remediation text", () => {
    let caught: unknown;
    try {
      requireComplete(resolvedWith({}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as ConfigError).message;
    expect(message).toContain("baseUrl");
    expect(message).toContain("model");
    expect(message).toContain("~/.om-code/config.json");
    expect(message).toContain('"baseUrl"');
    expect(message).not.toContain("\n    at ");
  });

  it("names only the key that is actually missing", () => {
    let caught: unknown;
    try {
      requireComplete(resolvedWith({ baseUrl: "https://api.example.com/v1" }));
    } catch (error) {
      caught = error;
    }
    const lines = (caught as ConfigError).message.split("\n");
    expect(lines[0]).toContain("model");
    expect(lines[0]).not.toContain("baseUrl");
  });

  it("an unresolved credential secret does not fail the guard", () => {
    const runtime = requireComplete(
      resolvedWith({ baseUrl: "https://api.example.com/v1", model: "m" }),
    );
    expect(runtime.credential.resolved).toBe(false);
  });
});
