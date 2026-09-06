/**
 * Startup platform guard (LR-FR-019, AC-3.4).
 *
 * ADR-023 scopes this release to macOS on arm64. The guard exists so an
 * unsupported host is told exactly that, at the first instruction, instead of
 * discovering it later through a Seatbelt profile that cannot be generated or a
 * stub binary that will not run. It never degrades to "try anyway".
 *
 * `checkPlatform` takes the host as an argument rather than reading
 * `process.platform` so the unsupported paths are testable from a supported
 * machine — which is the only machine this project has.
 */

export const SUPPORTED_PLATFORM = "darwin";
export const SUPPORTED_ARCHITECTURES: readonly string[] = ["arm64"];

export type HostPlatform = {
  readonly platform: string;
  readonly arch: string;
};

export type PlatformCheck =
  | { readonly supported: true }
  | { readonly supported: false; readonly message: string };

const SCOPE_REFERENCE = "docs/adr/ADR-023-macos-openai-compatible-learning-scope.md";

export function checkPlatform(host: HostPlatform): PlatformCheck {
  const platformOk = host.platform === SUPPORTED_PLATFORM;
  const archOk = SUPPORTED_ARCHITECTURES.includes(host.arch);
  if (platformOk && archOk) {
    return { supported: true };
  }

  const supportedArches = SUPPORTED_ARCHITECTURES.join(", ");
  return {
    supported: false,
    message: [
      `om: unsupported host ${host.platform}/${host.arch}.`,
      `om-code runs only on ${SUPPORTED_PLATFORM}/${supportedArches}.`,
      `Scope decision: ${SCOPE_REFERENCE}`,
    ].join("\n"),
  };
}
