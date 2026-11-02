// electron-builder afterPack hook.
//
// The DSH runtime tree under `build/dsh-runtime/<platform>/<arch>` is a real npm production install
// whose entry is `node_modules/@deepseek-ai/dsh`. `extraResources` always drops a nested directory
// named `node_modules` (electron-userland/electron-builder#3459), which no `filter` overrides. So
// the tree is copied here, after electron-builder has packed the app, straight onto the file system
// into `resources/dsh-runtime`, where `dshInstall` in `src/backend/cli.ts` resolves it with the
// shipped Node launcher at `resources/node`.
//
// Only the win32 x64 slim build runs DSH today; other platforms return without a copy.
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_BY_TARGET = {
  "win32-x64": path.join("build", "dsh-runtime", "win32", "x64"),
};

exports.afterPack = async (context) => {
  if (context.electronPlatformName !== "win32") return;
  // app-builder-lib Arch: ia32=0, x64=1, armv7l=2, arm64=3.
  const archName = context.arch === 1 ? "x64" : context.arch === 3 ? "arm64" : String(context.arch);
  const key = `win32-${archName}`;
  const source = SOURCE_BY_TARGET[key];
  if (!source) throw new Error(`No DSH runtime tree staged for ${key}.`);
  if (!fs.existsSync(path.join(source, "node_modules", "@deepseek-ai", "dsh"))) {
    throw new Error(`Run \`bun run prepare:dsh-runtime ${key.replace("-", " ")}\` first: ${source} has no DSH.`);
  }
  if (!fs.existsSync(path.join(source, "node_modules", "npm", "bin", "npm-cli.js"))) {
    throw new Error(`Run \`bun run prepare:dsh-runtime ${key.replace("-", " ")}\` first: ${source} has no npm.`);
  }
  const destination = path.join(context.appOutDir, "resources", "dsh-runtime");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
};
