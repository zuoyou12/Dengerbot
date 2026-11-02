import type { WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";

const WHATS_NEW_VERSION_KEY = "openbot:whats-new-version";
const LEGACY_VERSION_KEY = "openbot:analytics-app-version";

/** A desktop release: `x.y.z`, with an optional semver prerelease such as `-preview`. */
const RELEASE_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?$/u;

/** A version this build can compare. Unknown builds must not consume release notes. */
export function releaseVersion(value: string | null): string | null {
  if (value === null) return null;
  const match = RELEASE_VERSION.exec(value);
  if (!match) return null;
  const core = `${match[1]}.${match[2]}.${match[3]}`;
  return match[4] ? `${core}-${match[4]}` : core;
}

interface ParsedReleaseVersion {
  core: readonly [number, number, number];
  prerelease: readonly string[];
}

function parseReleaseVersion(value: string): ParsedReleaseVersion | null {
  const match = RELEASE_VERSION.exec(value);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Semver order: `1.0.0-preview` sorts before `1.0.0`. */
export function compareReleaseVersions(left: string, right: string): number {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = Number(x);
    const yn = Number(y);
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) {
      if (xn !== yn) return xn < yn ? -1 : 1;
      continue;
    }
    if (!Number.isNaN(xn)) return -1;
    if (!Number.isNaN(yn)) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function selectWhatsNewReleases(
  releases: readonly WhatsNewRelease[],
  current: string,
  previous: string | null,
): WhatsNewRelease[] {
  return releases
    .filter((release) =>
      previous === null
        ? release.version === current
        : compareReleaseVersions(release.version, previous) > 0 &&
          compareReleaseVersions(release.version, current) <= 0,
    )
    .sort((a, b) => compareReleaseVersions(b.version, a.version));
}

export interface VersionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read before Settings records analytics for this launch. Never write the old analytics key. */
export function readWhatsNewVersion(storage: VersionStorage): string | null {
  try {
    return releaseVersion(storage.getItem(WHATS_NEW_VERSION_KEY) ?? storage.getItem(LEGACY_VERSION_KEY));
  } catch {
    return null;
  }
}

/** Claim before opening. A failed write disables automatic display, so it cannot repeat each launch. */
export function claimWhatsNewVersion(storage: VersionStorage, current: string): boolean {
  try {
    const saved = releaseVersion(storage.getItem(WHATS_NEW_VERSION_KEY));
    if (saved !== null && compareReleaseVersions(saved, current) >= 0) return false;
    storage.setItem(WHATS_NEW_VERSION_KEY, current);
    return true;
  } catch {
    return false;
  }
}
