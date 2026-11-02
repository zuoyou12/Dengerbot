import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { parse } from "yaml";

const rendererPort = readRendererPort(process.env.OPENBOT_DEV_RENDERER_PORT);
const publish = parse(readFileSync(resolve("electron-builder.yml"), "utf8")).publish;
if (
  publish?.provider !== "github" ||
  typeof publish.owner !== "string" ||
  typeof publish.repo !== "string" ||
  !/^[\w.-]+$/.test(publish.owner) ||
  !/^[\w.-]+$/.test(publish.repo)
) {
  throw new Error("A GitHub publish owner and repository are required in electron-builder.yml.");
}
const releaseRepository = `${publish.owner}/${publish.repo}`;

export default defineConfig({
  main: {
    define: { __RELEASE_REPOSITORY__: JSON.stringify(releaseRepository) },
    // Workspace sources ship as TypeScript and must be bundled for the packaged app.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@openbot/brand",
          "@openbot/contracts",
          "@openbot/i18n",
          "@openbot/logging",
          "@openbot/team-client",
          "@openbot/telemetry",
          "@openbot/user-errors",
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          // The database host is its own process. Only node:* and the installed Effect package
          // are runtime imports; the unpacked host must not load the main process bundle.
          "agent-database-host": resolve("src/backend/agent-data/agent-database-host.ts"),
          // The voice hosts are their own processes too. They import only node:* and load the
          // sherpa-onnx addon by path.
          "voice-transcription-host": resolve("src/main/voice-transcription-host.ts"),
          "voice-speech-host": resolve("src/main/voice-speech-host.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@openbot/contracts"] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          teamWebrtc: resolve("src/preload/team-webrtc.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [solidPlugin(), tailwindcss({ optimize: false })],
    optimizeDeps: {
      include: ["@norbert_bodziony/bloub"],
    },
    resolve: {
      dedupe: ["solid-js", "@solidjs/web"],
    },
    ...(rendererPort ? { server: { port: rendererPort, strictPort: true } } : {}),
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          helper: resolve("src/renderer/helper.html"),
          browserPip: resolve("src/renderer/browser-pip.html"),
          browserPipControls: resolve("src/renderer/browser-pip-controls.html"),
          teamWebrtc: resolve("src/renderer/team-webrtc.html"),
        },
      },
    },
  },
});

function readRendererPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("OPENBOT_DEV_RENDERER_PORT must be an integer from 1024 to 65535.");
  }
  return port;
}
