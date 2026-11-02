import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { loadCatalogSpec, packArchive } from "./build-production-catalog";

/**
 * Materializes the offline agent marketplace that ships beside the other resources:
 * `catalog.json` and the `skills/` folders verbatim, and each pack built the way
 * `build-production-catalog.ts` publishes it - as one `<slug>/` folder whose `SKILL.md` index and
 * `skills/<slug>-<folder>/` children the app installs as a pack. Run after changing
 * `marketplace/production-catalog`, then commit the result:
 *
 *   bun run marketplace:resource
 */

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "..");
const sourceRoot = join(projectRoot, "marketplace", "production-catalog");
const outputRoot = join(projectRoot, "resources", "marketplace-agents");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const spec = await loadCatalogSpec();
await cp(join(sourceRoot, "catalog.json"), join(outputRoot, "catalog.json"));
await cp(join(sourceRoot, "skills"), join(outputRoot, "skills"), { recursive: true });

for (const skill of spec.skills) {
  if (skill.source === "openbot") continue;
  if (!skill.pack) continue;
  const archive = await packArchive(skill.pack, spec.sources[skill.source]);
  for (const [name, bytes] of Object.entries(unzipSync(archive))) {
    const target = join(outputRoot, skill.slug, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

const entries = await readdir(outputRoot);
process.stdout.write(`Built the offline agent marketplace at ${outputRoot} (${entries.join(", ")}).\n`);
