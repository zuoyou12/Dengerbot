// Real public plugins, isolated home. No user credentials, login or paid model request.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SubscriptionPluginRuntime } from "../src/main/subscription-runtime";

const output = resolve(import.meta.dirname, "../.openbot-build/subscription-plugin-install-smoke");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "isolated-"));
const home = join(directory, "home");
await mkdir(home, { recursive: true });
const runtime = new SubscriptionPluginRuntime({
  stateDirectory: join(directory, "state"),
  resourcesDirectory: resolve(import.meta.dirname, "../resources/subscription-plugins"),
  bunExecutable: () => process.execPath,
  environment: {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    BUN_INSTALL_CACHE_DIR: join(directory, "bun-cache"),
  },
});
const results: {
  packageName: string;
  version: string;
  providers: { id: string; methods: number; signedIn: boolean; models: number }[];
}[] = [];
try {
  for (const packageName of ["@magpie-community/opencode-workbuddy-auth", "@magpie-community/opencode-qoder-auth"]) {
    const state = await runtime.install({ packageName });
    const plugin = state.plugins.find((item) => item.packageName === packageName);
    assert(plugin?.installedVersion);
    assert(!plugin.error, plugin.error);
    const providers = state.providers.filter((item) => item.packageName === packageName);
    assert(providers.length > 0, `No provider loaded for ${packageName}`);
    for (const provider of providers) {
      assert.equal(provider.signedIn, false);
      assert.equal(provider.models.length, 0);
      assert(provider.methods.length > 0);
    }
    results.push({
      packageName,
      version: plugin.installedVersion,
      providers: providers.map((item) => ({
        id: item.id,
        methods: item.methods.length,
        signedIn: item.signedIn,
        models: item.models.length,
      })),
    });
    const updated = await runtime.update({ packageName });
    assert(updated.plugins.find((item) => item.packageName === packageName)?.installedVersion);
    assert(updated.providers.some((item) => item.packageName === packageName));
    const removed = await runtime.remove({ packageName });
    assert.equal(removed.plugins.find((item) => item.packageName === packageName)?.installedVersion, null);
    assert(!removed.providers.some((item) => item.packageName === packageName));
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ ok: true, isolatedHome: true, lifecycle: ["install", "update", "remove"], results }, null, 2),
  );
  process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
} finally {
  await runtime.stop();
  assert(directory.startsWith(`${output}\\`) || directory.startsWith(`${output}/`));
  await rm(directory, { recursive: true, force: true });
}
