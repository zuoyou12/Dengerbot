import { z } from "zod";
import { updatesPort } from "./updates-port";
import { releaseVersion } from "./whats-new-history";
import notesUrl from "./whats-new-releases.json?url&no-inline";

const githubRelease = z.object({
  tag_name: z.string().min(1).max(200),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string().min(1).max(255), browser_download_url: z.string().max(2048) })),
});
const catalogSchema = z.object({
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  releases: z.array(githubRelease),
  latest: z.object({ tag_name: z.string().min(1).max(200) }).nullable(),
  truncated: z.boolean(),
});

const bundledRelease = z.object({
  version: z.string().refine((value) => releaseVersion(value) !== null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notices: z.array(z.string()),
  groups: z.array(z.object({ type: z.enum(["added", "changed", "fixed"]), items: z.array(z.string()) })),
});

export async function loadBundledWhatsNewReleases(signal: AbortSignal) {
  const response = await fetch(notesUrl, { signal });
  if (!response.ok) throw new Error("Release notes are unavailable.");
  return z.array(bundledRelease).parse(await response.json());
}

function parseReleaseBody(body: string) {
  const groups: Record<"added" | "changed" | "fixed", string[]> = { added: [], changed: [], fixed: [] };
  const notices: string[] = [];
  let section: "added" | "changed" | "fixed" | "notices" = "changed";
  for (const raw of body.split(/\r?\n/)) {
    const heading = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw)?.[1]?.toLowerCase();
    if (heading) {
      if (/notice|action required|breaking/.test(heading)) section = "notices";
      else if (/added|new|features/.test(heading)) section = "added";
      else if (/fixed|fixes|bug fixes/.test(heading)) section = "fixed";
      else section = "changed";
      continue;
    }
    const text = raw
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/(`+|\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/\*([^*]+)\*/g, "$1")
      .trim();
    if (!text || /^[-=]{3,}$/.test(text)) continue;
    if (section === "notices") notices.push(text);
    else groups[section].push(text);
  }
  return {
    notices,
    groups: (["added", "changed", "fixed"] as const)
      .map((type) => ({ type, items: groups[type] }))
      .filter((group) => group.items.length > 0),
  };
}

function safeAssetUrl(url: string, repository: string, tag: string, name: string): boolean {
  try {
    const parsed = new URL(url);
    const expected = `/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    return (
      parsed.protocol === "https:" &&
      parsed.host === "github.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname === expected
    );
  } catch {
    return false;
  }
}

export async function loadReleaseCatalog(signal: AbortSignal) {
  const text = await updatesPort().update.getReleases();
  signal.throwIfAborted();
  const data = catalogSchema.parse(JSON.parse(text));
  const catalog = data.releases
    .filter((release) => !release.draft)
    .map((release) => ({
      tag: release.tag_name,
      assets: release.assets
        .filter((asset) => safeAssetUrl(asset.browser_download_url, data.repository, release.tag_name, asset.name))
        .map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
    }));
  const notes = data.releases.flatMap((release) => {
    const version = releaseVersion(release.tag_name.replace(/^v/, ""));
    const date = release.published_at?.slice(0, 10);
    if (release.draft || release.prerelease || version === null || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return [];
    return [{ version, date, ...parseReleaseBody(release.body ?? "") }];
  });
  return { catalog, notes, latestTag: data.latest?.tag_name ?? null, truncated: data.truncated };
}

/** Read published stable release notes from the configured repository. */
export async function loadWhatsNewReleases(signal: AbortSignal) {
  return (await loadReleaseCatalog(signal)).notes;
}
