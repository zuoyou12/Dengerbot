import { Effect, Result } from "effect";
/**
 * Everything `OPENBOT_DEV_REMOTE_ROLE` adds to startup: handing the client the connection the
 * host wrote to a file in the dev runtime directory. None of it runs in a packaged build -
 * `developmentRemoteRole` is null unless the app is unpackaged and the variable is set to `host`
 * or `client`. The account half (signing a throwaway account in against the local account API)
 * is gone with the account service; `startDevelopmentRemoteRole` runs after
 * `remoteServers.initialize()`. The client half polls for thirty seconds and then throws,
 * deliberately: a dev client with no remote server is a failure worth seeing at startup rather
 * than an empty window.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { developmentRemoteConnectionPath } from "./development-runtime-directory";
import type { HostService } from "./host-service";
import type { DevelopmentRemoteServerConnection, RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";

export type DevelopmentRemoteRole = "host" | "client";

const developmentRemoteServerConnectionSchema: z.ZodType<DevelopmentRemoteServerConnection> = z.object({
  serverId: z.string().min(1),
  serverName: z.string().min(1),
  apiUrl: z.string().min(1),
  fingerprint: z.string().min(1),
  publicKey: z.string().min(1),
  username: z.string().min(1),
  sessionToken: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]).optional(),
});

export interface DevelopmentRemoteRoleOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  host: HostService;
  remoteServers: RemoteServerManager;
}

export const startDevelopmentRemoteRole = Effect.fn("DevelopmentRemote.startRole")(function* ({
  role,
  testClientEnabled,
  host,
  remoteServers,
}: DevelopmentRemoteRoleOptions) {
  if (role === "host") {
    yield* remoteCall(() => rm(developmentRemoteConnectionPath(), { force: true }));
    // A dev host that has not been named yet must not stop the app from opening. The host stays
    // offline until the user names it, and the rest of the window still loads.
    yield* Effect.gen(function* () {
      const status = yield* host.start();
      if (status.phase !== "online") yield* host.startDevelopmentLocal();
      if (testClientEnabled) yield* writeDevelopmentRemoteConnection(yield* host.createDevelopmentConnection());
    }).pipe(Effect.catch(() => Effect.void));
    return;
  }
  yield* connectDevelopmentRemoteServer(remoteServers);
});

const writeDevelopmentRemoteConnection = Effect.fn("DevelopmentRemote.writeConnection")(
  (connection: DevelopmentRemoteServerConnection) =>
    remoteCall(async () => {
      const path = developmentRemoteConnectionPath();
      // `bun run dev` has already made the runtime directory owner-only; this covers a start without it.
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(connection)}\n`, { encoding: "utf8", mode: 0o600 });
    }),
);

const connectDevelopmentRemoteServer = Effect.fn("DevelopmentRemote.connect")(function* (manager: RemoteServerManager) {
  const deadline = Date.now() + 30_000;
  let lastError: RemoteWorkflowError = new RemoteWorkflowError({
    cause: new Error("The local development host did not start."),
  });
  while (Date.now() < deadline) {
    const attempt = yield* Effect.gen(function* () {
      const text = yield* remoteCall(() => readFile(developmentRemoteConnectionPath(), "utf8"));
      const connection = yield* remoteDecode(() => developmentRemoteServerConnectionSchema.parse(JSON.parse(text)));
      yield* manager.connectDevelopmentServer(connection);
    }).pipe(Effect.result);
    if (Result.isSuccess(attempt)) return;
    lastError = attempt.failure;
    yield* Effect.sleep(250);
  }
  return yield* lastError;
});
