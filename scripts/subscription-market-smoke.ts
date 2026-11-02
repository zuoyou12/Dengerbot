// Reads public registry metadata. No package installation, account login or model request.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect } from "effect";
import { SubscriptionPluginMarket } from "../src/main/subscription-market";

const market = new SubscriptionPluginMarket({ domesticMirror: () => false });
const directory = await Effect.runPromise(market.catalog());
assert.equal(directory.source, "registry");
assert(directory.entries.length >= 31);
assert(directory.entries.some((entry) => entry.providerIds.includes("workbuddy-ai")));
assert(directory.entries.some((entry) => entry.providerIds.includes("qoder-cn")));
assert(!directory.entries.some((entry) => /middleware-|agent-|tools-|page-/u.test(entry.packageName)));
const packages = [];
for (const packageName of ["@magpie-community/opencode-workbuddy-auth", "@magpie-community/opencode-qoder-auth"]) {
  const metadata = await Effect.runPromise(market.packageMetadata(packageName));
  assert(metadata.version);
  packages.push({ packageName, version: metadata.version });
}
const results = await Effect.runPromise(market.search("workbuddy"));
assert(results.some((entry) => entry.packageName === "@magpie-community/opencode-workbuddy-auth"));
const offline = new SubscriptionPluginMarket({
  domesticMirror: () => false,
  fetchImpl: async () => {
    throw new Error("Synthetic offline state");
  },
});
const fallback = await Effect.runPromise(offline.catalog());
assert.equal(fallback.source, "offline");
assert(fallback.entries.length >= 31);
const report = {
  ok: true,
  source: directory.source,
  providerPlugins: directory.entries.length,
  packages,
  searchResults: results.length,
  offlineFallback: fallback.entries.length,
};
const output = resolve(import.meta.dirname, "../.openbot-build/subscription-market-smoke");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report)}\n`);
