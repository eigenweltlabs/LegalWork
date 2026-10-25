/** Release is the default; Pre-release also accepts manually marked releases.
 * Alpha additionally accepts automatic dev builds. Electron resolves the
 * highest eligible published version, independently of GitHub's Latest badge.
 * The endpoint helpers below are retained for legacy Tauri clients only.
 */

import type { ReleaseChannel } from "../types";

/** Stable channel's Tauri updater manifest URL. */
export const STABLE_UPDATER_ENDPOINT =
  "https://github.com/eigenweltlabs/legalwork/releases/latest/download/latest.json";

/** Alpha channel's Tauri updater manifest URL (macOS-only, rolling). */
export const ALPHA_UPDATER_ENDPOINT =
  "https://github.com/eigenweltlabs/legalwork/releases/download/alpha-macos-latest/latest.json";

/** Rolling GitHub release tag that alpha macOS artifacts are published to. */
export const ALPHA_MACOS_RELEASE_TAG = "alpha-macos-latest";

export type PlatformKind = "darwin" | "linux" | "windows" | "web" | "unknown";

/**
 * Returns true when the given platform supports the alpha channel.
 *
 * Today alpha builds are produced only for macOS (arm64). The type-level
 * conservatism here is deliberate: it's easier to widen later than to
 * silently start advertising an alpha endpoint that serves no artifact.
 */
export function isAlphaChannelSupported(platform: PlatformKind): boolean {
  return platform === "darwin";
}

/**
 * Resolve the Tauri updater manifest URL for the requested channel.
 *
 * Falls back to the stable endpoint whenever alpha isn't supported on the
 * current platform, so the caller never needs to special-case "alpha chosen
 * on Linux" / "alpha chosen on Windows" etc.
 */
export function resolveUpdaterEndpoint(
  channel: ReleaseChannel,
  platform: PlatformKind = "darwin",
): string {
  if (channel === "alpha" && isAlphaChannelSupported(platform)) {
    return ALPHA_UPDATER_ENDPOINT;
  }
  return STABLE_UPDATER_ENDPOINT;
}

/** Narrow an arbitrary string to a valid ReleaseChannel, defaulting to stable. */
export function coerceReleaseChannel(value: unknown): ReleaseChannel {
  return value === "alpha" || value === "prerelease" ? value : "stable";
}
