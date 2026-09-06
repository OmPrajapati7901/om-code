import { describe, expect, it } from "vitest";
import { checkPlatform, SUPPORTED_ARCHITECTURES, SUPPORTED_PLATFORM } from "../src/platform.js";

describe("AC-3.4 — startup platform guard", () => {
  it("accepts macOS on arm64", () => {
    expect(checkPlatform({ platform: "darwin", arch: "arm64" })).toEqual({ supported: true });
  });

  it.each([
    ["linux", "x64"],
    ["linux", "arm64"],
    ["win32", "x64"],
    ["win32", "arm64"],
    ["darwin", "x64"],
    ["freebsd", "arm64"],
  ])("rejects %s/%s and names it", (platform, arch) => {
    const result = checkPlatform({ platform, arch });
    expect(result.supported).toBe(false);
    if (result.supported) {
      throw new Error("unreachable: the guard reported an unsupported host as supported");
    }
    // The message must name the actual host, so the failure is self-explaining.
    expect(result.message).toContain(`${platform}/${arch}`);
    expect(result.message).toContain(SUPPORTED_PLATFORM);
    expect(result.message).toContain("ADR-023");
  });

  it("pins the supported target to macOS arm64 only", () => {
    expect(SUPPORTED_PLATFORM).toBe("darwin");
    expect([...SUPPORTED_ARCHITECTURES]).toEqual(["arm64"]);
  });
});
