// The application updater, its preferences, and the restart an admin of a joined server asked for.

import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";

import type { IdleRestart } from "../idle-restart";
import type { RequestedUpdate } from "../requested-update";
import { readUpdatePreference } from "../update-preference-store";
import type { UpdateService } from "../update-service";
import { parseIdleRestartTarget, parseUpdatePreference } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

declare const __RELEASE_REPOSITORY__: string;

export interface UpdateIpcDependencies {
  updater: UpdateService;
  updatePreferenceFile: string;
  requestedUpdate: Pick<RequestedUpdate, "cancel" | "setPreference">;
  idleRestart: Pick<IdleRestart, "request" | "cancel">;
}

export function updateIpcHandlers({
  updater,
  updatePreferenceFile,
  requestedUpdate,
  idleRestart,
}: UpdateIpcDependencies): Pick<IpcGroupHandlers, "update"> {
  return {
    update: {
      getReleasePage: handler(() => `https://github.com/${__RELEASE_REPOSITORY__}/releases`),
      getReleases: handler(() =>
        Effect.runPromise(
          Effect.tryPromise(async () => {
            const base = `https://api.github.com/repos/${__RELEASE_REPOSITORY__}/releases`;
            const options = {
              headers: { Accept: "application/vnd.github+json", "User-Agent": "Dengerbot" },
              signal: AbortSignal.timeout(10_000),
            };
            const latest = await fetch(`${base}/latest`, options);
            if (!latest.ok && latest.status !== 404) throw new Error("Release request failed");
            const latestText = latest.ok ? await latest.text() : "null";
            let size = latestText.length;
            const releases: unknown[] = [];
            let truncated = false;
            for (let page = 1; page <= 5; page++) {
              const response = await fetch(`${base}?per_page=100&page=${page}`, options);
              if (!response.ok) throw new Error("Release request failed");
              const text = await response.text();
              size += text.length;
              if (size > 1_900_000) throw new Error("Release response too large");
              const entries = JSON.parse(text);
              if (!Array.isArray(entries) || entries.length > 100) throw new Error("Invalid release response");
              releases.push(...entries);
              if (entries.length < 100) break;
              if (page === 5) truncated = true;
            }
            return JSON.stringify({
              repository: __RELEASE_REPOSITORY__,
              releases,
              latest: JSON.parse(latestText),
              truncated,
            });
          }),
        ),
      ),
      getStatus: handler(() => updater.getStatus()),
      check: handler(() => runCauseEffect(updater.checkForUpdates())),
      download: handler(() => runCauseEffect(updater.downloadUpdate())),
      install: handler(() => runCauseEffect(updater.installUpdate())),
      getPreference: handler(() => runCauseEffect(readUpdatePreference(updatePreferenceFile))),
      setPreference: payloadHandler(parseUpdatePreference, (parsed) =>
        runCauseEffect(requestedUpdate.setPreference(parsed)),
      ),
      cancelScheduledRestart: handler(() => {
        requestedUpdate.cancel();
        return updater.getStatus();
      }),
      restartWhenIdle: payloadHandler(parseIdleRestartTarget, (target) => idleRestart.request(target)),
      cancelIdleRestart: handler(() => idleRestart.cancel()),
    },
  };
}
