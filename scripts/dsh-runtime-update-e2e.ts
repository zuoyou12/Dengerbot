import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { activeDshRuntime } from "../src/backend/dsh-runtime";
import { createDshRuntimeUpdater } from "../src/main/dsh-runtime-updater";

const state = process.env.DSH_TEST_EXISTING_STATE || (await mkdtemp(join(tmpdir(), "dsh-update-e2e-")));
const node = process.env.DSH_TEST_NODE || "node";
const bundledNpm = process.env.DSH_TEST_NPM_PACKAGE;
if (bundledNpm) {
  const resources = join(state, "resources");
  await mkdir(join(resources, "dsh-runtime", "node_modules"), { recursive: true });
  await cp(bundledNpm, join(resources, "dsh-runtime", "node_modules", "npm"), { recursive: true });
  Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
}
const updater = createDshRuntimeUpdater({
  stateDirectory: state,
  nodeExecutable: () => node,
  packaged: Boolean(bundledNpm),
});
const report: {
  state: string;
  bundledNpm: boolean;
  reusedExisting: boolean;
  latestAvailable?: string;
  release?: string;
  installed?: boolean;
  invalidVersionRefused?: boolean;
  existingInstallPreserved?: boolean;
  failedInstallPreserved?: boolean;
  failedCheckCleared?: boolean;
  interruptedDownloadPreserved?: boolean;
  errorCategoriesVerified?: boolean;
  newerBundledSelected?: boolean;
  error?: string;
} = { state, bundledNpm: Boolean(bundledNpm), reusedExisting: Boolean(process.env.DSH_TEST_EXISTING_STATE) };
try {
  const existing = process.env.DSH_TEST_EXISTING_STATE ? activeDshRuntime(state) : null;
  const checked = await updater.checkForUpdate();
  report.latestAvailable = checked.latest?.version;
  const version = existing?.version ?? checked.latest?.version;
  if (!version) throw new Error("No newer release is available for the isolated test.");
  report.release = version;
  if (!existing) {
    const installed = await updater.installUpdate({ version });
    if (installed.active.version !== version || installed.active.source !== "installed")
      throw new Error("The release was not activated.");
  }
  const manifest = join(state, "dsh-runtime", version, "node_modules", "@deepseek-ai", "dsh", "package.json");
  const before = await readFile(manifest, "utf8");
  let refused = false;
  try {
    await updater.installUpdate({ version: "../../escape" });
  } catch {
    refused = true;
  }
  if (!refused || (await readFile(manifest, "utf8")) !== before || activeDshRuntime(state)?.version !== version)
    throw new Error("A rejected update changed the active installation.");
  report.installed = !existing;
  report.invalidVersionRefused = true;
  report.existingInstallPreserved = true;
  let failCheck = false;
  const failing = createDshRuntimeUpdater({
    stateDirectory: state,
    nodeExecutable: () => join(state, "missing-node"),
    fetchImpl: Object.assign(
      async () => {
        if (failCheck) throw new Error("Network unavailable secret-test-token");
        return new Response(
          JSON.stringify([
            { draft: false, tag_name: "dsh-v998.0.0", published_at: "2026-02-01T00:00:00Z" },
            { draft: false, tag_name: "dsh-v999.0.0", published_at: "2026-01-01T00:00:00Z" },
          ]),
        );
      },
      { preconnect: fetch.preconnect },
    ),
  });
  const ordered = await failing.checkForUpdate();
  if (ordered.latest?.version !== "999.0.0") throw new Error("The highest release version was not selected.");
  let failed = false;
  try {
    await failing.installUpdate({ version: "999.0.0" });
  } catch (error) {
    failed = error instanceof Error && error.message === sourceText("error.provider.dshRuntime");
  }
  if (!failed || (await readFile(manifest, "utf8")) !== before || activeDshRuntime(state)?.version !== version)
    throw new Error("A failed install changed the active installation.");
  report.failedInstallPreserved = true;
  failCheck = true;
  let networkError = false;
  try {
    await failing.checkForUpdate();
  } catch (error) {
    networkError = error instanceof Error && error.message === sourceText("error.provider.dshReleaseNetwork");
  }
  if (!networkError || (await failing.status()).latest !== null)
    throw new Error("A failed check did not report or clear the update.");
  report.failedCheckCleared = true;

  let downloadStarted = false;
  const server = createServer((_request, response) => {
    downloadStarted = true;
    response.writeHead(200, { "content-length": "1000", connection: "close" });
    response.end("partial package data");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server port.");
  const fakeResources = await mkdtemp(join(state, "interrupted-resources-"));
  const fakeNpmDir = join(fakeResources, "dsh-runtime", "node_modules", "npm", "bin");
  await mkdir(fakeNpmDir, { recursive: true });
  await writeFile(
    join(fakeNpmDir, "npm-cli.js"),
    `const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] === '--version') process.stdout.write('11.13.0');
else if (process.argv[2] === 'config') process.stdout.write('allow-git = all');
else if (process.env.DSH_TEST_FAILURE === 'integrity') { process.stderr.write('EINTEGRITY secret-test-token'); process.exit(1); }
else if (process.env.DSH_TEST_FAILURE === 'install') { process.stderr.write('EACCES secret-test-token'); process.exit(1); }
else http.get('http://127.0.0.1:${address.port}/package', res => {
  res.on('data', () => fs.writeFileSync(path.join(__dirname, 'received'), 'yes'));
  res.on('aborted', () => { process.stderr.write('ECONNRESET secret-test-token'); process.exit(1); });
  res.on('error', () => { process.stderr.write('ECONNRESET secret-test-token'); process.exit(1); });
  res.on('end', () => process.exit(2));
  res.resume();
}).on('error', () => process.exit(1));`,
  );
  const priorResources = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  try {
    Object.defineProperty(process, "resourcesPath", { value: fakeResources, configurable: true });
    const interrupted = createDshRuntimeUpdater({
      stateDirectory: state,
      nodeExecutable: () => node,
      packaged: true,
      fetchImpl: Object.assign(
        async () =>
          new Response(
            JSON.stringify([{ draft: false, tag_name: "dsh-v999.0.0", published_at: "2026-01-01T00:00:00Z" }]),
          ),
        { preconnect: fetch.preconnect },
      ),
    });
    await interrupted.checkForUpdate();
    let refusedDownload = false;
    try {
      await interrupted.installUpdate({ version: "999.0.0" });
    } catch (error) {
      refusedDownload = error instanceof Error && error.message === sourceText("error.provider.dshDownload");
    }
    if (
      !downloadStarted ||
      (await readFile(join(fakeNpmDir, "received"), "utf8")) !== "yes" ||
      !refusedDownload ||
      (await readFile(manifest, "utf8")) !== before ||
      activeDshRuntime(state)?.version !== version
    ) {
      throw new Error("An interrupted download changed the active installation.");
    }
    report.interruptedDownloadPreserved = true;
    for (const [failure, expected] of [
      ["integrity", sourceText("error.provider.dshIntegrity")],
      ["install", sourceText("error.provider.dshInstall")],
    ] as const) {
      process.env.DSH_TEST_FAILURE = failure;
      let matched = false;
      try {
        await interrupted.installUpdate({ version: "999.0.0" });
      } catch (error) {
        matched = error instanceof Error && error.message === expected && !error.message.includes("secret-test-token");
      }
      if (!matched) throw new Error(`Incorrect safe error category: ${failure}.`);
    }
    const zh = translateFor("zh");
    if (
      zh("error.provider.dshDownload") === sourceText("error.provider.dshDownload") ||
      zh("error.provider.dshIntegrity") === sourceText("error.provider.dshIntegrity") ||
      zh("error.provider.dshRuntime") === sourceText("error.provider.dshRuntime") ||
      zh("error.provider.dshReleaseNetwork") === sourceText("error.provider.dshReleaseNetwork")
    )
      throw new Error("DSH error translations are missing.");
    report.errorCategoriesVerified = true;
  } finally {
    delete process.env.DSH_TEST_FAILURE;
    server.close();
    if (priorResources) Object.defineProperty(process, "resourcesPath", priorResources);
    else Reflect.deleteProperty(process, "resourcesPath");
  }
  const resources = join(state, "fake-resources");
  const bundled = join(resources, "dsh-runtime", "node_modules", "@deepseek-ai", "dsh");
  await mkdir(bundled, { recursive: true });
  await writeFile(join(bundled, "package.json"), JSON.stringify({ version: "999.0.1" }));
  const originalResources = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  try {
    Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
    if (activeDshRuntime(state)?.source !== "bundled") throw new Error("The newer bundled runtime was not selected.");
    report.newerBundledSelected = true;
  } finally {
    if (originalResources) Object.defineProperty(process, "resourcesPath", originalResources);
    else Reflect.deleteProperty(process, "resourcesPath");
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const directory = resolve(".openbot-build");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "dsh-runtime-update-e2e.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
