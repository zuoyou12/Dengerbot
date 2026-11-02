/**
 * The custom URL scheme this product registers.
 *
 * The scheme is part of the application's identity: the operating system keeps one handler for each
 * scheme, so sharing `openbot:` with OpenBot would let whichever installation ran last open every
 * link. Dengerbot registers `dengerbot:` only. A parser still accepts `openbot:` for a link that is
 * handed to this process directly, such as one written before the fork or one in a saved message.
 */
export const APP_SCHEME = "dengerbot";
export const LEGACY_APP_SCHEME = "openbot";

/** Every scheme the parsers accept, with the colon that `URL.protocol` carries. */
export const APP_SCHEMES: ReadonlySet<string> = new Set([`${APP_SCHEME}:`, `${LEGACY_APP_SCHEME}:`]);

/** A link in this product's own scheme, such as `dengerbot://join`. */
export function createAppUrl(hostAndPath: string): string {
  return `${APP_SCHEME}://${hostAndPath}`;
}
