/**
 * AC-4.2 + AC-4.5 + AC-4.6 end to end through runCli (LRN-04).
 *
 * Uses the real storage loader against temp OM_HOME / temp project roots so
 * the provenances in the table are the real file paths, env names and flag
 * names — not stub strings. Temp cwds keep project discovery hermetic (the
 * repo itself has a .git that must not leak into these assertions).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { loadSettings } from "@om-code/storage";
import { describe, expect, it } from "vitest";
import { type CliDeps, runCli } from "../src/cli.js";

const HOST = { platform: "darwin", arch: "arm64" };

function deps(env: Record<string, string | undefined>, cwd: string): CliDeps {
  const stream = new PassThrough();
  return {
    host: HOST,
    env,
    cwd,
    loadSettings: (options) => loadSettings(options),
    io: {
      write: () => {},
      writeErr: () => {},
      input: stream,
      output: stream,
      isTty: false,
    },
    now: () => new Date("2026-09-06T00:00:00Z"),
    newId: () => "00000000-0000-7000-8000-000000000000",
    createProvider: () => {
      throw new Error("provider must not be created by config print");
    },
    osLabel: "darwin/arm64",
  };
}

function makeHome(files: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "om-home-"));
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(home, name), typeof value === "string" ? value : JSON.stringify(value));
  }
  return home;
}

function makeProject(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "om-project-"));
  mkdirSync(join(root, ".git"));
  for (const [name, value] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value));
  }
  return root;
}

describe("AC-4.2 — config print shows each value with its source", () => {
  it("renders values spread across user, project and flag tiers", async () => {
    const home = makeHome({
      "config.json": { baseUrl: "https://user.example.com/v1", model: "user-model" },
    });
    const project = makeProject({
      ".om-code/settings.json": { model: "project-model" },
    });
    const result = await runCli(
      ["config", "print", "--effective", "--with-sources", "--credential", "env:OM_TEST_KEY"],
      deps({ OM_HOME: home }, project),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    // baseUrl only exists in the user tier.
    expect(result.stdout).toContain("https://user.example.com/v1");
    expect(result.stdout).toContain(join(home, "config.json"));
    // project overrides the user model.
    expect(result.stdout).toContain("project-model");
    expect(result.stdout).toContain(join(project, ".om-code", "settings.json"));
    expect(result.stdout).not.toContain("user-model");
    // credential arrived by flag and is shown as a reference, never a secret.
    expect(result.stdout).toContain("env:OM_TEST_KEY");
    expect(result.stdout).toContain("--credential");
  });

  it("an env value overrides the project tier (AC-4.6 from the terminal)", async () => {
    const home = makeHome({
      "config.json": { baseUrl: "https://user.example.com/v1", model: "user-model" },
    });
    const project = makeProject({
      ".om-code/settings.json": { model: "project-model" },
    });
    const result = await runCli(
      ["config", "print", "--effective", "--with-sources"],
      deps({ OM_HOME: home, OM_MODEL: "env-model" }, project),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("env-model");
    expect(result.stdout).toContain("OM_MODEL");
  });

  it("a --model flag overrides env", async () => {
    const home = makeHome({
      "config.json": { baseUrl: "https://user.example.com/v1", model: "user-model" },
    });
    const project = makeProject({});
    const result = await runCli(
      ["config", "print", "--effective", "--with-sources", "--model", "flag-model"],
      deps({ OM_HOME: home, OM_MODEL: "env-model" }, project),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("flag-model");
    expect(result.stdout).toContain("--model");
  });

  it("the credential row marks resolved vs not-resolved and never prints the secret", async () => {
    const home = makeHome({
      "config.json": {
        baseUrl: "https://user.example.com/v1",
        model: "m",
        credential: "env:OM_TEST_SECRET",
      },
    });
    const project = makeProject({});
    const resolved = await runCli(
      ["config", "print", "--effective", "--with-sources"],
      deps({ OM_HOME: home, OM_TEST_SECRET: "sk-live-sentinel" }, project),
    );
    expect(resolved.exitCode).toBe(0);
    expect(resolved.stdout).toContain("(resolved)");
    expect(resolved.stdout).not.toContain("sk-live-sentinel");

    const missing = await runCli(
      ["config", "print", "--effective", "--with-sources"],
      deps({ OM_HOME: home }, project),
    );
    expect(missing.exitCode).toBe(0);
    expect(missing.stdout).toContain("(not-resolved)");
  });
});

describe("AC-4.5 — empty config fails with remediation, not at inference", () => {
  it("prints the table, writes remediation naming baseUrl and model, exits 1", async () => {
    const home = mkdtempSync(join(tmpdir(), "om-empty-home-"));
    const project = makeProject({});
    const result = await runCli(
      ["config", "print", "--effective", "--with-sources"],
      deps({ OM_HOME: home }, project),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("baseUrl");
    expect(result.stdout).toContain("model");
    expect(result.stderr).toContain("baseUrl");
    expect(result.stderr).toContain("model");
    expect(result.stderr).toContain("~/.om-code/config.json");
  });
});

describe("AC-4.4 — malformed config through the CLI", () => {
  it("a broken user file exits 1 naming the file, with no stack trace", async () => {
    const home = makeHome({ "config.json": '{"baseUrl": ' });
    const project = makeProject({});
    const result = await runCli(
      ["config", "print", "--effective", "--with-sources"],
      deps({ OM_HOME: home }, project),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(join(home, "config.json"));
    expect(result.stderr).not.toContain("\n    at ");
  });
});

describe("config argument errors", () => {
  it("rejects unknown config subcommands with exit 1", async () => {
    const result = await runCli(["config", "bogus"], deps({}, tmpdir()));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown config subcommand "bogus"');
  });

  it("requires a subcommand", async () => {
    const result = await runCli(["config"], deps({}, tmpdir()));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("subcommand");
  });

  it("rejects unknown flags with exit 1", async () => {
    const result = await runCli(["config", "print", "--bogus"], deps({}, tmpdir()));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown flag "--bogus"');
  });

  it("rejects a value flag without a value", async () => {
    const result = await runCli(["config", "print", "--model"], deps({}, tmpdir()));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('flag "--model" requires a value');
  });

  it("an invalid flag value exits 1 naming the flag, with no stack", async () => {
    const result = await runCli(["config", "print", "--base-url", "not-a-url"], deps({}, tmpdir()));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--base-url");
    expect(result.stderr).not.toContain("\n    at ");
  });
});
