// electron-builder afterPack hook.
//
// The DSH runtime tree under `build/dsh-runtime/<platform>/<arch>` is a real npm production install
// whose entry is `node_modules/@deepseek-ai/dsh`. `extraResources` always drops a nested directory
// named `node_modules` (electron-userland/electron-builder#3459), which no `filter` overrides. So
// the tree is copied here, after electron-builder has packed the app, straight onto the file system
// into the app's `resources/dsh-runtime`, where `dshInstall` in `src/backend/cli.ts` resolves it with
// the shipped Node launcher at `resources/node`.
//
// Every platform build runs DSH, so every platform build hard-fails here when the DSH tree, npm or
// the packed Node launcher is missing: a package without them cannot run its DeepSeek providers, and
// a warning would ship it anyway.
const fs = require("node:fs");
const path = require("node:path");

// app-builder-lib Arch: ia32=0, x64=1, armv7l=2, arm64=3.
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" };

/** The folder inside the packed app that the resources land in, per platform. */
function resourcesDirectory(context) {
  if (context.electronPlatformName === "darwin") {
    // macOS packs `<productName>.app` inside appOutDir, and its Resources folder is the target; the
    // bare `resources` path that the other platforms use does not exist inside the bundle.
    return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources");
  }
  return path.join(context.appOutDir, "resources");
}

exports.afterPack = async (context) => {
  const archName = ARCH_NAMES[context.arch] ?? String(context.arch);
  const key = `${context.electronPlatformName}-${archName}`;
  const source = path.join("build", "dsh-runtime", context.electronPlatformName, archName);
  const resources = resourcesDirectory(context);
  if (!fs.existsSync(path.join(source, "node_modules", "@deepseek-ai", "dsh"))) {
    throw new Error(`Run \`bun run prepare:dsh-runtime ${context.electronPlatformName} ${archName}\` first: ${source} has no DSH.`);
  }
  if (!fs.existsSync(path.join(source, "node_modules", "npm", "bin", "npm-cli.js"))) {
    throw new Error(`Run \`bun run prepare:dsh-runtime ${context.electronPlatformName} ${archName}\` first: ${source} has no npm.`);
  }
  if (!fs.existsSync(path.join(resources, "node"))) {
    throw new Error(`The packed app has no Node launcher at ${path.join("resources", "node")}: check the electron-builder extraResources.`);
  }
  const destination = path.join(resources, "dsh-runtime");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
};
