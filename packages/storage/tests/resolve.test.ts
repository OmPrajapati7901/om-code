/**
 * AC-4.1 + AC-4.6 — pure tier precedence (LRN-04).
 *
 * One assertion per tier transition, each checking value and tier/origin.
 * resolveSettings takes already-read documents and a plain env record, so
 * these tests touch no filesystem. Precedence: flags > env > project >
 * user > defaults; the env tier sits where LR-FR-036 requires it.
 */

import { describe, expect, it } from "vitest";
import { type ResolveInput, resolveSettings } from "../src/config/resolve.js";

const USER_PATH = "/tmp/om-home/config.json";
const PROJECT_PATH = "/repo/.om-code/settings.json";

const USER_URL = "https://user.example.com/v1";
const PROJECT_URL = "https://project.example.com/v1";
const ENV_URL = "https://env.example.com/v1";
const FLAG_URL = "https://flag.example.com/v1";

function baseInput(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return {
    user: undefined,
    project: undefined,
    userPath: USER_PATH,
    projectPath: PROJECT_PATH,
    env: {},
    flags: {},
    resolveSecret: () => undefined,
    ...overrides,
  };
}

describe("AC-4.6 — tier precedence for baseUrl", () => {
  it("resolves from the user tier when nothing else sets it", () => {
    const resolved = resolveSettings(baseInput({ user: { baseUrl: USER_URL } }));
    expect(resolved.baseUrl.value).toBe(USER_URL);
    expect(resolved.baseUrl.tier).toBe("user");
    expect(resolved.baseUrl.origin).toBe(USER_PATH);
  });

  it("project overrides user", () => {
    const resolved = resolveSettings(
      baseInput({ user: { baseUrl: USER_URL }, project: { baseUrl: PROJECT_URL } }),
    );
    expect(resolved.baseUrl.value).toBe(PROJECT_URL);
    expect(resolved.baseUrl.tier).toBe("project");
    expect(resolved.baseUrl.origin).toBe(PROJECT_PATH);
  });

  it("env overrides project (the env tier between flag and project)", () => {
    const resolved = resolveSettings(
      baseInput({
        user: { baseUrl: USER_URL },
        project: { baseUrl: PROJECT_URL },
        env: { OM_BASE_URL: ENV_URL },
      }),
    );
    expect(resolved.baseUrl.value).toBe(ENV_URL);
    expect(resolved.baseUrl.tier).toBe("env");
    expect(resolved.baseUrl.origin).toBe("OM_BASE_URL");
  });

  it("flag overrides env", () => {
    const resolved = resolveSettings(
      baseInput({
        user: { baseUrl: USER_URL },
        project: { baseUrl: PROJECT_URL },
        env: { OM_BASE_URL: ENV_URL },
        flags: { baseUrl: FLAG_URL },
      }),
    );
    expect(resolved.baseUrl.value).toBe(FLAG_URL);
    expect(resolved.baseUrl.tier).toBe("flag");
    expect(resolved.baseUrl.origin).toBe("--base-url");
  });
});

describe("AC-4.6 — tier precedence for model", () => {
  it("resolves from the user tier, then project, then env, then flag", () => {
    const userOnly = resolveSettings(baseInput({ user: { model: "user-model" } }));
    expect(userOnly.model).toMatchObject({ value: "user-model", tier: "user", origin: USER_PATH });

    const withProject = resolveSettings(
      baseInput({ user: { model: "user-model" }, project: { model: "project-model" } }),
    );
    expect(withProject.model).toMatchObject({
      value: "project-model",
      tier: "project",
      origin: PROJECT_PATH,
    });

    const withEnv = resolveSettings(
      baseInput({
        user: { model: "user-model" },
        project: { model: "project-model" },
        env: { OM_MODEL: "env-model" },
      }),
    );
    expect(withEnv.model).toMatchObject({ value: "env-model", tier: "env", origin: "OM_MODEL" });

    const withFlag = resolveSettings(
      baseInput({
        user: { model: "user-model" },
        project: { model: "project-model" },
        env: { OM_MODEL: "env-model" },
        flags: { model: "flag-model" },
      }),
    );
    expect(withFlag.model).toMatchObject({
      value: "flag-model",
      tier: "flag",
      origin: "--model",
    });
  });
});

describe("defaults and missing values", () => {
  it("credential falls back to the env:OM_API_KEY default", () => {
    const resolved = resolveSettings(baseInput());
    expect(resolved.credential.value).toBe("env:OM_API_KEY");
    expect(resolved.credential.tier).toBe("default");
    expect(resolved.credential.origin).toBe("default");
  });

  it("baseUrl and model are undefined (not defaulted) when no tier sets them", () => {
    const resolved = resolveSettings(baseInput());
    expect(resolved.baseUrl.value).toBeUndefined();
    expect(resolved.baseUrl.tier).toBe("default");
    expect(resolved.model.value).toBeUndefined();
  });

  it("an invalid env value names the env var, not a file", () => {
    expect(() => resolveSettings(baseInput({ env: { OM_BASE_URL: "not-a-url" } }))).toThrowError(
      /OM_BASE_URL.*http\(s\) URL/,
    );
  });

  it("an invalid flag value names the flag", () => {
    expect(() => resolveSettings(baseInput({ flags: { model: "   " } }))).toThrowError(
      /--model.*non-empty/,
    );
  });
});
