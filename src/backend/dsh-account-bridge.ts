// The Dengerbot ↔ DSH account bridge: a small Cordis plugin that runs inside the DeepSeek Harness
// and writes a display-safe account projection to `$DSH_HOME/dengerbot-account.json`.
//
// Why a plugin at all: DSH keeps the DeepSeek Platform account (name, avatar, wallet) on its own
// `deepseekAccount` service, and its ACP surface does not expose it (`authMethods: []`, an empty
// `authenticate()`). The plugin injects that service in the harness process and writes the
// projection; Dengerbot reads the file. It never writes account tokens, Platform sessions or device
// identifiers — DSH marks those host-only, and `getProfile`/`getBalance` already return exactly the
// display-safe layer.
//
// Installation follows three facts that each cost a detour to learn:
//  1. A bare `- id:` patch entry overrides an existing row. A NEW plugin must be wrapped in
//     `insert:` — `{ insert: [{ id: … }] }` — which the loader's patch applier pushes into the
//     entry list (`cordis-plugin-include`).
//  2. The plugin file lives in the profile directory and is referenced by a relative path
//     (`./dengerbot-account-bridge.mjs`). A profile's `node_modules` is pnpm-managed and pruned;
//     the profile directory itself is the second module-resolution anchor. The `.mjs` suffix keeps
//     the harness from rewriting the profile's own `package.json`.
//  3. The plugin reaches `$DSH_HOME` from its own location: `$DSH_HOME/profiles/<profile>/` is two
//     directories up. The ACP and web profiles install the same file into their own directories.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export const DSH_ACCOUNT_BRIDGE_ID = "./dengerbot-account-bridge.mjs";
export const DSH_ACCOUNT_BRIDGE_FILE = "dengerbot-account-bridge.mjs";
export const DSH_ACCOUNT_HANDOFF_FILE = "dengerbot-account.json";

/** The patch entry that adds the plugin to a profile, wrapped in `insert` as a new row. */
export const DSH_ACCOUNT_BRIDGE_PATCH_ENTRY = { insert: [{ id: DSH_ACCOUNT_BRIDGE_ID }] };

const DSH_ACCOUNT_BRIDGE_PLUGIN_SOURCE = `// Dengerbot's account bridge, installed by Dengerbot into this profile.
// Writes the display-safe DeepSeek account projection next to the DSH home; Dengerbot reads it.
// The projection carries no tokens, sessions or device identifiers: DSH keeps those host-only, and
// the service's own getProfile/getBalance results are already the display-safe layer.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dengerbot-account-bridge";
export const inject = ["deepseekAccount"];

const HANDOFF = join(dirname(dirname(fileURLToPath(import.meta.url))), "dengerbot-account.json");
// The identity the Host derives Platform request headers from. The bridge is not a UI; plausible
// constants are what the hosted pages send, and the language only picks a server-authored message
// the bridge never shows.
const client = () => ({
  version: "0.0.0",
  locale: "en",
  timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
});

let lastSignature = null;
let lastWriteAt = 0;
// One writer at a time: a slow platform call must not let an older snapshot overwrite a newer one.
let writeSequence = 0;
// Set when the plugin is disposed: an identity read that was already on its way must not land after
// the stop, or a late write would report an account the harness no longer runs.
let disposed = false;

async function rewrite(account, force) {
  const sequence = ++writeSequence;
  try {
    const view = await account.getState();
    if (disposed || sequence !== writeSequence) return;
    const signedIn = view?.status === "credential-stored";
    let name = null;
    let avatarUrl = null;
    let currency = null;
    let balance = null;
    if (signedIn) {
      const profile = await account.getProfile(client()).catch(() => null);
      const wallets = await account.getBalance(client()).catch(() => null);
      // Each await is a place where a newer poll or a dispose can pass this one: check again.
      if (disposed || sequence !== writeSequence) return;
      if (profile?.status === "ready") {
        name = profile.value?.name ?? null;
        avatarUrl = profile.value?.avatarUrl ?? null;
      }
      const wallet = wallets?.status === "ready" ? (wallets.value?.[0] ?? null) : null;
      if (wallet) {
        currency = wallet.currency ?? null;
        balance = wallet.balance ?? null;
      }
    }
    // A change rewrites at once; an unchanged account still falls back to a periodic rewrite.
    const signature = JSON.stringify([signedIn, name, avatarUrl, currency, balance]);
    if (!force && signature === lastSignature && Date.now() - lastWriteAt < 15 * 60_000) return;
    if (sequence !== writeSequence) return; // A newer poll is already past this point.
    const payload = { signedIn, name, avatarUrl, currency, balance, updatedAt: Date.now() };
    await mkdir(dirname(HANDOFF), { recursive: true });
    const temporary = \\\`\${HANDOFF}.tmp\\\`;
    await writeFile(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 });
    await rename(temporary, HANDOFF);
    lastSignature = signature;
    lastWriteAt = Date.now();
  } catch {
    // A diagnostic file must never take the harness down; the next poll tries again.
  }
}

export function apply(ctx, account) {
  let polling = null;
  let fallback = null;
  const stop = () => {
    disposed = true;
    if (polling) clearInterval(polling);
    if (fallback) clearInterval(fallback);
    polling = null;
    fallback = null;
  };
  // getState reads stored presence only; the platform calls run at a rewrite, and the fallback
  // timer bounds how stale the file can get when nothing about the presence changes.
  polling = setInterval(() => void rewrite(account, false), 60_000);
  fallback = setInterval(() => void rewrite(account, true), 15 * 60_000);
  ctx.on("dispose", stop);
  void rewrite(account, true);
}
`;

/**
 * Installs the bridge plugin into one DSH profile: writes the plugin file and, for a profile whose
 * patch Dengerbot does not own (the web profile, which the sign-in window opens), appends the patch
 * entry only when it is missing. The ACP profile's patch is written whole by
 * `configureDshCustomProviders`, which includes {@link DSH_ACCOUNT_BRIDGE_PATCH_ENTRY} itself.
 */
export function installDshAccountBridge(home: string, profile: "acp" | "web"): void {
  const profileDir = join(home, "profiles", profile);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(profileDir, DSH_ACCOUNT_BRIDGE_FILE), DSH_ACCOUNT_BRIDGE_PLUGIN_SOURCE, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (profile === "web") {
    const patchPath = join(profileDir, "cordis.patch.yml");
    let entries: unknown[] = [];
    try {
      const parsed = JSON.parse(readFileSync(patchPath, "utf8"));
      if (Array.isArray(parsed)) entries = parsed;
    } catch (error) {
      // A missing patch starts a fresh list. Any other read failure (permissions, IO) must reach
      // the caller: treating it as "no configuration yet" would overwrite the user's own patch.
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    const present = entries.some(
      (entry) => isDynamicRecord(entry) && JSON.stringify(entry.insert ?? null).includes(DSH_ACCOUNT_BRIDGE_ID),
    );
    if (!present) {
      entries.push(DSH_ACCOUNT_BRIDGE_PATCH_ENTRY);
      writeFileSync(patchPath, `${JSON.stringify(entries, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  }
}

/** Whether the handoff file of `home` exists, for the diagnostics a support report shows. */
export function dshAccountBridgeInstalled(home: string): boolean {
  return existsSync(join(home, "profiles", "acp", DSH_ACCOUNT_BRIDGE_FILE));
}
