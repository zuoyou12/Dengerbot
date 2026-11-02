/**
 * The version as the interface shows it.
 *
 * The release tooling needs SemVer, so the package version is `0.0.1`. The product presents the
 * first version as `0.0.001`: the same three numbers with the patch zero-padded to three digits,
 * so `0.0.1` reads as `0.0.001`. Prerelease and build metadata pass through unchanged.
 */
export function displayAppVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) return version;
  const [, major = "0", minor = "0", patch = "0", suffix = ""] = match;
  return `${major}.${minor}.${patch.padStart(3, "0")}${suffix}`;
}
