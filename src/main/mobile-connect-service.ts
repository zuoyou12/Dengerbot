// The local replacement for OpenBot's central account service: one small HTTP server that pairs a
// phone with this computer and mints the Signal tickets both ends spend. The upstream line it
// replaces (apps/auth-api plus the central-auth-manager chain) needed a cloud account, billing and
// email; a desktop that pairs with its owner's phone does not, so the fork runs its own.
//
// What it serves:
//   POST /v1/mobile-auth/redeem          the QR (or permanent link) becomes a mobile session
//   GET  /v1/me                          the synthetic local account the phone displays
//   GET  /v2/remote/hosts/               the host directory, one entry: this computer
//   POST /v2/remote/sessions/            open a remote session against the host
//   POST /v2/remote/sessions/:id/ticket  the ES256 Signal ticket for that session
//   POST /v2/remote/sessions/:id/end     end the remote session
//   POST /v2/remote/hosts/:id/…-push     the push relays, machine-token authenticated
// The email sign-in routes answer 404: only QR pairing exists here.
//
// Tickets are ES256 JWTs under `REMOTE_TICKET_AUDIENCE`, signed with a P-256 key this service
// generates and keeps in its state file. The same key signs the host's own Signal ticket, so
// `HostService.issueRemoteHostTicket` is wired to `issueHostSignalTicket`, and the JWKS file beside
// the state is what the LAN Signal container verifies against. Revoking a device deletes its
// session and bumps `authEpoch`, which stops every ticket minted before it.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createVerify,
  sign as cryptoSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { DshAccountInfo, DshAccountSignInState } from "@openbot/contracts/dsh-account";
import type {
  MobileConnectedDevice,
  MobileConnectLink,
  MobileConnectTicket,
  MobileDevicePlatform,
} from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  REMOTE_TICKET_AUDIENCE,
  REMOTE_TICKET_PROTOCOL_VERSION,
  type RemoteTicketClaims,
} from "@openbot/contracts/signal-protocol/ticket";
import QRCode from "qrcode";

// The LAN HTTP port. 8081 was the first choice and Metro took it, so the control plane moved here.
const DEFAULT_HTTP_PORT = 47822;
const HTTP_PORT_ATTEMPTS = 8;
// The Signal port of the LAN compose file, and the socket path the ticket must carry. A Signal URL
// without the `/v1/signal` path closes with 1006, which cost a day to find once already.
const SIGNAL_PORT = 8088;
const SIGNAL_PATH = "/v1/signal";
const STATE_FILE = "mobile-connect-service-state.json";
const JWKS_FILE = "signal-ticket-jwks.json";
const DSH_HANDOFF_FILE = "dengerbot-account.json";
// The bridge rewrites its handoff at least every 15 minutes; past 45 the account is stale.
const DSH_HANDOFF_MAX_AGE_MS = 45 * 60_000;
const PAIRING_CODE_TTL_MS = 10 * 60_000;
const TICKET_TTL_MS = 10 * 60_000;
// A paired device stays paired until revoked; the claim still needs an end, and activity rolls it.
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
// nanoMuse's numbers, adopted as design: per-IP sliding window, a tighter window on redeem because
// the ticket is a bearer credential, and a hard cap on concurrent sockets.
const RATE_LIMIT_PER_MINUTE = 60;
const REDEEM_LIMIT_PER_FIVE_MINUTES = 10;
const MAX_CONCURRENT_CONNECTIONS = 64;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_HEADERS_TIMEOUT_MS = 35_000;
const REQUEST_KEEP_ALIVE_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

type DshHandoff = {
  signedIn: boolean;
  name: string | null;
  avatarUrl: string | null;
  currency: string | null;
  balance: string | null;
  updatedAt: number;
};

interface PersistedSession {
  sessionId: string;
  /** SHA-256 of the bearer token; the token itself never touches the disk. */
  tokenHash: string;
  name: string;
  platform: MobileDevicePlatform;
  deviceId: string | null;
  via: "code" | "link";
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
}

interface PersistedPairing {
  /** SHA-256 of the pairing ticket. */
  ticketHash: string;
  sessionId: string | null;
  createdAt: number;
  expiresAt: number | null;
  /**
   * The raw ticket of a permanent link, kept so the settings tab can show the same link again. A
   * one-time code never comes back, so only its hash is kept.
   */
  rawTicket: string | null;
}

interface PersistedState {
  version: 1;
  /** The bearer any push relay call must present. Rotated on every start; the old one dies. */
  machineToken: string;
  account: { id: string; email: string };
  authEpoch: number;
  /** The ES256 private key as a PKCS#8 DER string, so the state file is the only key material. */
  privateKey: string;
  kid: string;
  sessions: PersistedSession[];
  pairings: PersistedPairing[];
}

export interface MobileConnectHostIdentity {
  hostId: string;
  name: string;
  /** The host's ed25519 device public key, base64; the host directory entry carries it. */
  devicePublicKey: string;
  /** The fingerprint the QR and the redeem answer carry: the team store computed it already. */
  fingerprint: string;
  ownerMembershipId: string;
}

export interface MobileConnectSignedInUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MobileConnectServiceOptions {
  /** Where the state, the JWKS and the machine token live: `<userData>/mobile-connect`. */
  stateDirectory: string;
  /** The host identity the directory and the tickets name, from the team store. */
  hostIdentity: () => MobileConnectHostIdentity | null;
  /** Turned off with `DENGERBOT_MOBILE_CONNECT=off`. */
  enabled?: boolean;
  /** `DENGERBOT_SIGNAL_ORIGIN` overrides `ws://<LAN-IP>:8088`. */
  signalOrigin?: string | null;
  /** `$DSH_HOME`, where the account bridge leaves its handoff file. */
  dshHome?: string | null;
  /** Ends the Team API side of a revoked session, so in-flight connections drop. */
  revokeRemoteSession?: (sessionId: string) => Promise<void>;
  log?: (message: string) => void;
  onDevicesChanged?: (devices: readonly MobileConnectedDevice[]) => void;
}

export class MobileConnectService {
  readonly #options: MobileConnectServiceOptions;
  #state: PersistedState | null = null;
  #privateKey: ReturnType<typeof createPrivateKey> | null = null;
  #server: Server | null = null;
  #httpPort: number | null = null;
  #apiOrigin: string | null = null;
  #openConnections = 0;
  /** Path → timestamps, per IP, for the sliding windows. */
  readonly #rateBuckets = new Map<string, number[]>();
  #devicesChangedTimer: NodeJS.Timeout | null = null;

  constructor(options: MobileConnectServiceOptions) {
    this.#options = options;
  }

  get #log(): (message: string) => void {
    return this.#options.log ?? (() => {});
  }

  // ---- lifecycle

  async start(): Promise<void> {
    if (!this.#options.enabled) {
      this.#log("Mobile Connect is off (DENGERBOT_MOBILE_CONNECT=off).");
      return;
    }
    this.#state = await this.#loadState();
    this.#privateKey = createPrivateKey(this.#state.privateKey);
    await this.#writeJwks();
    await this.#listen();
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#httpPort = null;
    this.#apiOrigin = null;
    if (this.#devicesChangedTimer) {
      clearTimeout(this.#devicesChangedTimer);
      this.#devicesChangedTimer = null;
    }
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  #statePath(): string {
    return join(this.#options.stateDirectory, STATE_FILE);
  }

  async #loadState(): Promise<PersistedState> {
    const path = this.#statePath();
    try {
      const stored = decodePersistedState(JSON.parse(await readFile(path, "utf8")));
      if (stored) {
        // The machine token rotates every start; the old one is dead the moment this runs.
        stored.machineToken = randomBytes(32).toString("base64url");
        return stored;
      }
      this.#log("The Mobile Connect state file is unreadable; creating a fresh identity.");
    } catch {
      // Missing or unreadable state: fall through and create a fresh identity.
    }
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const fresh: PersistedState = {
      version: 1,
      machineToken: randomBytes(32).toString("base64url"),
      account: {
        id: `local-${randomBytes(8).toString("hex")}`,
        email: `local-${randomBytes(8).toString("hex")}@dengerbot.local`,
      },
      authEpoch: 1,
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      kid: randomBytes(8).toString("hex"),
      sessions: [],
      pairings: [],
    };
    await this.#persist(fresh);
    this.#log("Created a fresh Mobile Connect identity.");
    return fresh;
  }

  async #persist(state: PersistedState): Promise<void> {
    await mkdir(this.#options.stateDirectory, { recursive: true });
    const temporary = `${this.#statePath()}.tmp`;
    // 0600: the file carries the private key and the session token hashes.
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, this.#statePath());
  }

  async #writeJwks(): Promise<void> {
    if (!this.#state || !this.#privateKey) return;
    const jwk = createPublicKey(this.#privateKey).export({ format: "jwk" });
    // The JWKS the LAN Signal container reads needs the EC point present, not merely typed optional.
    if (jwk.kty !== "EC" || typeof jwk.crv !== "string" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
      throw new Error("The Mobile Connect signing key is not an EC P-256 key.");
    }
    const jwks = {
      keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: this.#state.kid, alg: "ES256", use: "sig" }],
    };
    await mkdir(this.#options.stateDirectory, { recursive: true });
    await writeFile(join(this.#options.stateDirectory, JWKS_FILE), JSON.stringify(jwks, null, 2));
  }

  async #listen(): Promise<void> {
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    server.keepAliveTimeout = REQUEST_KEEP_ALIVE_MS;
    server.headersTimeout = REQUEST_HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    for (let attempt = 0; attempt < HTTP_PORT_ATTEMPTS; attempt += 1) {
      const port = DEFAULT_HTTP_PORT + attempt;
      const listened = await new Promise<boolean>((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(port, "0.0.0.0", () => resolve(true));
      });
      if (listened) {
        this.#server = server;
        this.#httpPort = port;
        break;
      }
    }
    if (!this.#server) {
      this.#log("Mobile Connect could not find a free HTTP port; the service stays off.");
      return;
    }
    const lanAddress = this.#lanAddress();
    this.#apiOrigin = lanAddress ? `http://${lanAddress}:${this.#httpPort}` : null;
    this.#log(
      this.#apiOrigin
        ? `Mobile Connect serving on ${this.#apiOrigin}.`
        : "Mobile Connect is serving, but no LAN address was found; pairing needs one.",
    );
  }

  /** The first private IPv4 address of this machine, Tailscale's range included. */
  #lanAddress(): string | null {
    for (const interfaces of Object.values(networkInterfaces())) {
      for (const entry of interfaces ?? []) {
        if (entry.internal || entry.family !== "IPv4") continue;
        const octets = entry.address.split(".").map(Number);
        if (octets.length !== 4) continue;
        const [first, second] = octets;
        const privateRange =
          first === 10 ||
          (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
          (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
          (first === 192 && second === 168);
        if (privateRange) return entry.address;
      }
    }
    return null;
  }

  #signalUrl(): string | null {
    const lanAddress = this.#lanAddress();
    if (!lanAddress) return null;
    const override = this.#options.signalOrigin?.trim();
    if (override) return `${override.replace(/\/+$/u, "")}${SIGNAL_PATH}`;
    return `ws://${lanAddress}:${SIGNAL_PORT}${SIGNAL_PATH}`;
  }

  // ---- IPC surface

  listDevices(): readonly MobileConnectedDevice[] {
    return (this.#state?.sessions ?? []).map((session) => ({
      sessionId: session.sessionId,
      name: session.name,
      platform: session.platform,
      connectedAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      via: session.via,
    }));
  }

  /** One one-time code, rendered as the QR image the settings tab shows. */
  async createMobileConnect(): Promise<MobileConnectTicket> {
    const link = await this.#connectLink(PAIRING_CODE_TTL_MS);
    return {
      qrData: await QRCode.toDataURL(link, { margin: 1, width: 256 }),
      expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
    };
  }

  cancelMobileConnect(): void {
    // The one-time codes live in the pairing list with their own expiry; a cancelled code simply
    // ages out, and a replacement code already supersedes it on screen.
  }

  getMobileConnectLink(): MobileConnectLink | null {
    const state = this.#state;
    const pairing = state?.pairings.find((candidate) => candidate.expiresAt === null);
    const identity = pairing ? this.#options.hostIdentity() : null;
    if (!state || !pairing || !identity || !pairing.rawTicket) return null;
    return { url: this.#connectUrl(identity, pairing.rawTicket), createdAt: pairing.createdAt };
  }

  /** Builds one pairing ticket and, for a permanent link, keeps the raw ticket for re-display. */
  async #connectLink(ttlMs: number | null): Promise<MobileConnectLink["url"]> {
    const state = this.#requireState();
    const identity = this.#options.hostIdentity();
    if (!identity) throw new Error("The host identity is not ready yet; try again in a moment.");
    if (!this.#apiOrigin) throw new Error("No LAN address was found, so this computer cannot be paired.");
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = ttlMs === null ? null : Date.now() + ttlMs;
    state.pairings.push({
      ticketHash: sha256(ticket),
      sessionId: null,
      createdAt: Date.now(),
      expiresAt,
      rawTicket: ttlMs === null ? ticket : null,
    });
    state.pairings = state.pairings.filter((pairing) => pairing.expiresAt === null || pairing.expiresAt > Date.now());
    await this.#persist(state);
    return this.#connectUrl(identity, ticket);
  }

  #connectUrl(identity: MobileConnectHostIdentity, ticket: string): MobileConnectLink["url"] {
    const payload = new URLSearchParams({
      api: this.#apiOrigin ?? "",
      ticket,
      host: identity.hostId,
      fingerprint: identity.fingerprint,
    });
    return `openbot://mobile-connect?${payload.toString()}`;
  }

  async createMobileConnectLink(): Promise<MobileConnectLink> {
    await this.#connectLink(null);
    const link = this.getMobileConnectLink();
    if (!link) throw new Error("The permanent link could not be created.");
    return link;
  }

  /** Revokes the permanent link and every phone that paired through it. */
  async revokeMobileConnectLink(): Promise<void> {
    const state = this.#requireState();
    const linkPairing = state.pairings.find((candidate) => candidate.expiresAt === null);
    if (!linkPairing) return;
    const viaLink = state.sessions.filter((session) => session.sessionId === linkPairing.sessionId);
    state.pairings = state.pairings.filter((candidate) => candidate !== linkPairing);
    state.sessions = state.sessions.filter((session) => session.sessionId !== linkPairing.sessionId);
    if (viaLink.length > 0) state.authEpoch += 1;
    await this.#persist(state);
    for (const session of viaLink) {
      await this.#options.revokeRemoteSession?.(session.sessionId);
    }
    this.#notifyDevicesChanged();
  }

  async revokeDevice(sessionId: string): Promise<void> {
    const state = this.#requireState();
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((session) => session.sessionId !== sessionId);
    if (state.sessions.length === before) return;
    // A new epoch stops every ticket minted before it, even ones that have not expired yet.
    state.authEpoch += 1;
    state.pairings = state.pairings.filter((pairing) => pairing.sessionId !== sessionId);
    await this.#persist(state);
    await this.#options.revokeRemoteSession?.(sessionId);
    this.#log(`Revoked the mobile session ${sessionId}.`);
    this.#notifyDevicesChanged();
  }

  /** True when the bearer belongs to a live paired mobile session. The Team API checks this. */
  isPairedOwnerSession(token: string | null | undefined): boolean {
    if (!token) return false;
    const session = this.#sessionByToken(token);
    return session !== null;
  }

  /** The synthetic local account, with the bridge's name and avatar when it has one. */
  getSignedInUser(): MobileConnectSignedInUser | null {
    const state = this.#state;
    if (!state) return null;
    const handoff = this.#readDshHandoff();
    return {
      id: state.account.id,
      email: state.account.email,
      name: (handoff?.signedIn && handoff.name) || null,
      avatarUrl: (handoff?.signedIn && handoff.avatarUrl) || null,
    };
  }

  readDshAccount(): DshAccountInfo | null {
    const handoff = this.#readDshHandoff();
    if (!handoff) return null;
    return {
      signedIn: handoff.signedIn,
      name: handoff.name,
      avatarUrl: handoff.avatarUrl,
      currency: handoff.currency,
      balance: handoff.balance,
      updatedAt: handoff.updatedAt,
    };
  }

  dshSignInState(phase: DshAccountSignInState["phase"]): DshAccountSignInState {
    return { phase, account: this.readDshAccount() };
  }

  #readDshHandoff(): DshHandoff | null {
    const home = this.#options.dshHome;
    if (!home) return null;
    try {
      const handoff = decodeDshHandoff(JSON.parse(readFileSync(join(home, DSH_HANDOFF_FILE), "utf8")));
      if (!handoff) return null;
      // A stale handoff would show an account that may have signed out elsewhere.
      if (Date.now() - handoff.updatedAt > DSH_HANDOFF_MAX_AGE_MS) return null;
      return handoff;
    } catch {
      return null;
    }
  }

  // ---- tickets

  /**
   * The host's own Signal ticket. `HostService.issueRemoteHostTicket` is wired here, so the host
   * and its paired phones share one signing key and one Signal address.
   */
  async issueHostSignalTicket(): Promise<{ ticket: string; signalUrl: string; expiresAt: number }> {
    const state = this.#requireState();
    const identity = this.#options.hostIdentity();
    const signalUrl = this.#signalUrl();
    if (!identity || !signalUrl) throw new Error("The host identity or the Signal address is not ready.");
    const expiresAt = Date.now() + TICKET_TTL_MS;
    const claims: RemoteTicketClaims = {
      aud: REMOTE_TICKET_AUDIENCE,
      jti: randomUUID(),
      sessionId: `host-${randomUUID()}`,
      hostId: identity.hostId,
      userId: state.account.id,
      membershipId: identity.ownerMembershipId,
      role: "host",
      authEpoch: state.authEpoch,
      protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
      protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
      sessionExpiresAt: Math.floor(expiresAt / 1000),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt / 1000),
    };
    return { ticket: this.#signTicket(claims), signalUrl, expiresAt };
  }

  /**
   * Verifies a client ticket the way the deleted `central-auth-manager` did: signature, audience,
   * epoch, and that the session it names is still one of ours. `HostService` receives this through
   * `verifyRemoteSessionTicket`.
   */
  async verifySessionTicket(ticket: string): Promise<{
    hostId: string;
    sessionId: string;
    userId: string;
    membershipId: string;
    role: "owner" | "admin" | "member";
    clientPublicKey: string;
    sessionExpiresAt: number;
  }> {
    const state = this.#requireState();
    const claims = this.#verifyTicket(ticket);
    if (!claims || claims.aud !== REMOTE_TICKET_AUDIENCE) throw new Error("The session ticket is invalid.");
    if (claims.authEpoch !== state.authEpoch) throw new Error("The session ticket is stale.");
    if (claims.role === "host") throw new Error("A host ticket does not open a client session.");
    if (!claims.clientPublicKey) throw new Error("The session ticket carries no client key.");
    if (!state.sessions.some((session) => session.sessionId === claims.sessionId)) {
      throw new Error("The session ticket names an unknown session.");
    }
    return {
      hostId: claims.hostId,
      sessionId: claims.sessionId,
      userId: claims.userId,
      membershipId: claims.membershipId,
      role: claims.role,
      clientPublicKey: claims.clientPublicKey,
      sessionExpiresAt: claims.sessionExpiresAt * 1000,
    };
  }

  #signTicket(claims: RemoteTicketClaims): string {
    if (!this.#privateKey || !this.#state) throw new Error("The Mobile Connect service is not started.");
    const header = { alg: "ES256", kid: this.#state.kid, typ: "JWT" };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = cryptoSign("sha256", Buffer.from(signingInput, "utf8"), {
      key: this.#privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return `${signingInput}.${base64url(signature)}`;
  }

  #verifyTicket(ticket: string): RemoteTicketClaims | null {
    if (!this.#privateKey) throw new Error("The Mobile Connect service is not started.");
    const parts = ticket.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
    const verifier = createVerify("SHA256");
    verifier.update(Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"));
    verifier.end();
    const valid = verifier.verify(
      { key: this.#privateKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!valid) return null;
    try {
      const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
      if (!isDynamicRecord(header) || header.alg !== "ES256") return null;
      return decodeRemoteTicketClaims(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
    } catch {
      return null;
    }
  }

  // ---- HTTP

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.#openConnections >= MAX_CONCURRENT_CONNECTIONS) {
      this.#respond(response, 503, { error: { code: "overloaded", message: "Too many connections." } });
      request.destroy();
      return;
    }
    this.#openConnections += 1;
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const ip = request.socket.remoteAddress ?? "unknown";
      if (!this.#allow(ip, url.pathname)) {
        this.#respond(response, 429, { error: { code: "rate_limited", message: "Too many requests." } });
        return;
      }
      const body = await this.#readBody(request);
      await this.#route(request, response, url, body);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
      } else if (error instanceof HttpError) {
        this.#respond(response, error.status, { error: { code: error.code, message: error.message } });
      } else {
        this.#respond(response, 400, {
          error: { code: "bad_request", message: error instanceof Error ? error.message : "Bad request." },
        });
      }
    } finally {
      this.#openConnections -= 1;
    }
  }

  /** Per-IP sliding windows: 60 a minute everywhere, 10 per five minutes on the redeem route. */
  #allow(ip: string, path: string): boolean {
    const now = Date.now();
    if (!this.#slidingWindow(`${ip}:*`, now, RATE_LIMIT_PER_MINUTE, 60_000)) return false;
    if (
      path === "/v1/mobile-auth/redeem" &&
      !this.#slidingWindow(`${ip}:redeem`, now, REDEEM_LIMIT_PER_FIVE_MINUTES, 5 * 60_000)
    ) {
      return false;
    }
    return true;
  }

  #slidingWindow(key: string, now: number, limit: number, windowMs: number): boolean {
    const timestamps = (this.#rateBuckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (timestamps.length >= limit) {
      this.#rateBuckets.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.#rateBuckets.set(key, timestamps);
    return true;
  }

  #readBody(request: IncomingMessage): Promise<DynamicRecord> {
    if (request.method === "GET" || request.method === "HEAD") return Promise.resolve({});
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("The request body is too large."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(decodeJsonBody(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("The request body is not valid JSON."));
        }
      });
      request.on("error", reject);
    });
  }

  async #route(request: IncomingMessage, response: ServerResponse, url: URL, body: DynamicRecord): Promise<void> {
    const path = url.pathname;
    const method = request.method ?? "GET";
    if (path.startsWith("/v1/auth/email/")) {
      // No email sign-in in this build; the phone shows its QR path instead.
      this.#respond(response, 404, { error: { code: "not_found", message: "Email sign-in is not available." } });
      return;
    }
    if (method === "POST" && path === "/v1/mobile-auth/redeem") return void this.#redeem(response, body);
    if (path === "/v1/me" && method === "GET") return void this.#me(request, response);
    if (path.startsWith("/v2/remote/")) return void this.#remote(request, response, method, path, body);
    this.#respond(response, 404, { error: { code: "not_found", message: "Unknown route." } });
  }

  #bearer(request: IncomingMessage): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice("Bearer ".length) || null;
  }

  #sessionByToken(token: string): PersistedSession | null {
    const state = this.#state;
    if (!state) return null;
    const hash = sha256(token);
    const session = state.sessions.find((candidate) => candidate.tokenHash === hash);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) return null;
    return session;
  }

  #requireBearer(request: IncomingMessage): PersistedSession {
    const token = this.#bearer(request);
    const session = token ? this.#sessionByToken(token) : null;
    if (!session || !token) throw new HttpError(401, "unauthorized", "The session token is missing or expired.");
    session.lastActiveAt = Date.now();
    if (session.expiresAt - Date.now() < SESSION_TTL_MS / 2) {
      // Roll the expiry forward for an active device so a long-lived pairing does not die quietly.
      session.expiresAt = Date.now() + SESSION_TTL_MS;
      void this.#persist(this.#requireState()).catch(() => {});
    }
    return session;
  }

  #requireMachineToken(request: IncomingMessage): void {
    if (this.#bearer(request) !== this.#state?.machineToken) {
      throw new HttpError(401, "unauthorized", "The machine token is missing or wrong.");
    }
  }

  #redeem(response: ServerResponse, body: DynamicRecord): void {
    const state = this.#requireState();
    const identity = this.#options.hostIdentity();
    const ticket = typeof body.ticket === "string" ? body.ticket : "";
    const name = typeof body.deviceName === "string" ? body.deviceName.slice(0, 120) : "A phone";
    const platform = body.platform === "ios" || body.platform === "android" ? body.platform : "unknown";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 128) : null;
    if (!ticket || !identity) {
      this.#respond(response, 400, { error: { code: "invalid_ticket", message: "The connection code is not valid." } });
      return;
    }
    const hash = sha256(ticket);
    const pairing = state.pairings.find(
      (candidate) =>
        candidate.ticketHash === hash && (candidate.expiresAt === null || candidate.expiresAt > Date.now()),
    );
    if (!pairing) {
      this.#respond(response, 403, {
        error: { code: "invalid_ticket", message: "The connection code is expired or was already used." },
      });
      return;
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const session: PersistedSession = {
      sessionId: randomUUID(),
      tokenHash: sha256(sessionToken),
      name,
      platform,
      deviceId,
      via: pairing.expiresAt === null ? "link" : "code",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    state.sessions.push(session);
    pairing.sessionId = session.sessionId;
    // A one-time code is spent by the redeem; only the permanent link may redeem again.
    if (pairing.expiresAt !== null) state.pairings = state.pairings.filter((candidate) => candidate !== pairing);
    void this.#persist(state).catch(() => {});
    this.#log(`Paired the device "${name}" (${platform}).`);
    this.#notifyDevicesChanged();
    this.#respond(response, 200, {
      sessionToken,
      user: this.#userPayload(),
      host: { hostId: identity.hostId, fingerprint: identity.fingerprint },
    });
  }

  #userPayload(): DynamicRecord {
    const user = this.getSignedInUser();
    return { ...user, analyticsEnabled: null };
  }

  #me(request: IncomingMessage, response: ServerResponse): void {
    this.#requireBearer(request);
    this.#respond(response, 200, this.#userPayload());
  }

  #remote(request: IncomingMessage, response: ServerResponse, method: string, path: string, body: DynamicRecord): void {
    const state = this.#requireState();
    const identity = this.#options.hostIdentity();
    if (!identity) throw new HttpError(503, "host_unready", "The host identity is not ready yet.");
    const machineRelay = /^\/v2\/remote\/hosts\/[^/]+\/(android-notification|notification|live-activity)$/u.exec(path);
    if (machineRelay) {
      this.#requireMachineToken(request);
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
      this.#relayPush(response);
      return;
    }
    const session = this.#requireBearer(request);
    if (method === "GET" && path === "/v2/remote/hosts/") {
      this.#respond(response, 200, {
        hosts: [
          {
            hostId: identity.hostId,
            name: identity.name,
            devicePublicKey: identity.devicePublicKey,
            logoKey: null,
            membershipId: identity.ownerMembershipId,
            role: "owner",
          },
        ],
      });
      return;
    }
    if (method === "POST" && path === "/v2/remote/sessions/") {
      const hostId = typeof body.hostId === "string" ? body.hostId : "";
      if (hostId !== identity.hostId) {
        throw new HttpError(404, "unknown_host", "This account has no such host.");
      }
      const expiresAt = Math.min(session.expiresAt, Date.now() + SESSION_TTL_MS);
      this.#respond(response, 200, { sessionId: session.sessionId, hostId, expiresAt });
      return;
    }
    const remoteSession = /^\/v2\/remote\/sessions\/([^/]+)(\/ticket|\/end)?$/u.exec(path);
    if (remoteSession) {
      const [, sessionId, ticketSuffix] = remoteSession;
      if (sessionId !== session.sessionId) {
        throw new HttpError(403, "forbidden", "The session belongs to another device.");
      }
      if (ticketSuffix === "/ticket" && method === "POST") {
        const clientPublicKey = typeof body.clientPublicKey === "string" ? body.clientPublicKey : "";
        if (!clientPublicKey) throw new HttpError(400, "bad_request", "The client public key is missing.");
        const signalUrl = this.#signalUrl();
        if (!signalUrl) throw new HttpError(503, "no_signal", "No Signal address was found.");
        const expiresAt = Math.min(session.expiresAt, Date.now() + TICKET_TTL_MS);
        const claims: RemoteTicketClaims = {
          aud: REMOTE_TICKET_AUDIENCE,
          jti: randomUUID(),
          sessionId,
          hostId: identity.hostId,
          userId: state.account.id,
          membershipId: identity.ownerMembershipId,
          role: "owner",
          authEpoch: state.authEpoch,
          protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
          protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
          sessionExpiresAt: Math.floor(session.expiresAt / 1000),
          clientPublicKey,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(expiresAt / 1000),
        };
        this.#respond(response, 200, { ticket: this.#signTicket(claims), expiresAt, signalUrl });
        return;
      }
    }
    const endMatch = /^\/v2\/remote\/sessions\/([^/]+)\/end$/u.exec(path);
    if (endMatch && method === "POST") {
      const sessionId = endMatch[1];
      if (!sessionId || sessionId !== session.sessionId) {
        throw new HttpError(403, "forbidden", "The session belongs to another device.");
      }
      void this.revokeDevice(sessionId);
      this.#respond(response, 204, {});
      return;
    }
    this.#respond(response, 404, { error: { code: "not_found", message: "Unknown route." } });
  }

  /**
   * The push relays the report planned for a split deployment. No sender is wired yet — the FCM and
   * APNs senders come with the push work — so the route answers 501 rather than pretending.
   */
  #relayPush(response: ServerResponse): void {
    this.#respond(response, 501, { error: { code: "relay_unavailable", message: "Push relays are not configured." } });
  }

  #notifyDevicesChanged(): void {
    if (this.#devicesChangedTimer) return;
    this.#devicesChangedTimer = setTimeout(() => {
      this.#devicesChangedTimer = null;
      this.#options.onDevicesChanged?.(this.listDevices());
    }, 50);
  }

  #requireState(): PersistedState {
    if (!this.#state) throw new Error("The Mobile Connect service is not started.");
    return this.#state;
  }

  #respond(response: ServerResponse, status: number, payload: DynamicRecord): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
  }
}

/** An HTTP error that #route turns into the error envelope the phone's decoder reads. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

// ---- payload decoding

/** Parses one JSON body and keeps only objects, the shape every route below reads. */
function decodeJsonBody(text: string): DynamicRecord {
  const parsed = JSON.parse(text);
  return isDynamicRecord(parsed) ? parsed : {};
}

/** Reads the state file back, or null when anything required is missing or of the wrong type. */
function decodePersistedState(value: unknown): PersistedState | null {
  if (!isDynamicRecord(value) || value.version !== 1) return null;
  const { machineToken, privateKey, kid, account, authEpoch } = value;
  if (typeof machineToken !== "string" || typeof privateKey !== "string" || typeof kid !== "string") return null;
  if (typeof authEpoch !== "number" || !Number.isSafeInteger(authEpoch) || authEpoch < 1) return null;
  if (!isDynamicRecord(account) || typeof account.id !== "string" || typeof account.email !== "string") return null;
  if (!Array.isArray(value.sessions) || !Array.isArray(value.pairings)) return null;
  const sessions: PersistedSession[] = [];
  for (const entry of value.sessions) {
    if (!isDynamicRecord(entry)) return null;
    const via = entry.via;
    const platform = entry.platform;
    if (
      typeof entry.sessionId !== "string" ||
      typeof entry.tokenHash !== "string" ||
      typeof entry.name !== "string" ||
      (via !== "code" && via !== "link") ||
      (platform !== "ios" && platform !== "android" && platform !== "unknown") ||
      (entry.deviceId !== null && typeof entry.deviceId !== "string") ||
      typeof entry.createdAt !== "number" ||
      typeof entry.lastActiveAt !== "number" ||
      typeof entry.expiresAt !== "number"
    ) {
      return null;
    }
    sessions.push({
      sessionId: entry.sessionId,
      tokenHash: entry.tokenHash,
      name: entry.name,
      platform,
      deviceId: entry.deviceId,
      via,
      createdAt: entry.createdAt,
      lastActiveAt: entry.lastActiveAt,
      expiresAt: entry.expiresAt,
    });
  }
  const pairings: PersistedPairing[] = [];
  for (const entry of value.pairings) {
    if (!isDynamicRecord(entry)) return null;
    if (
      typeof entry.ticketHash !== "string" ||
      (entry.sessionId !== null && typeof entry.sessionId !== "string") ||
      typeof entry.createdAt !== "number" ||
      (entry.expiresAt !== null && typeof entry.expiresAt !== "number") ||
      (entry.rawTicket !== null && typeof entry.rawTicket !== "string")
    ) {
      return null;
    }
    pairings.push({
      ticketHash: entry.ticketHash,
      sessionId: entry.sessionId,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      rawTicket: entry.rawTicket,
    });
  }
  return {
    version: 1,
    machineToken,
    account: { id: account.id, email: account.email },
    authEpoch,
    privateKey,
    kid,
    sessions,
    pairings,
  };
}

/** Reads the bridge handoff, or null when it is not the shape the bridge is supposed to write. */
function decodeDshHandoff(value: unknown): DshHandoff | null {
  if (!isDynamicRecord(value)) return null;
  const { signedIn, name, avatarUrl, currency, balance, updatedAt } = value;
  if (typeof signedIn !== "boolean" || typeof updatedAt !== "number") return null;
  const nullableText = (field: unknown): field is string | null => field === null || typeof field === "string";
  if (!nullableText(name) || !nullableText(avatarUrl) || !nullableText(currency) || !nullableText(balance)) {
    return null;
  }
  return { signedIn, name, avatarUrl, currency, balance, updatedAt };
}

/** Reads verified ticket claims back, or null when a field is missing or of the wrong type. */
function decodeRemoteTicketClaims(value: unknown): RemoteTicketClaims | null {
  if (!isDynamicRecord(value)) return null;
  const role = value.role;
  if (
    value.aud !== REMOTE_TICKET_AUDIENCE ||
    typeof value.jti !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.hostId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.membershipId !== "string" ||
    (role !== "host" && role !== "owner" && role !== "admin" && role !== "member") ||
    typeof value.authEpoch !== "number" ||
    typeof value.protocolMinimum !== "number" ||
    typeof value.protocolMaximum !== "number" ||
    typeof value.sessionExpiresAt !== "number" ||
    (value.clientPublicKey !== undefined && typeof value.clientPublicKey !== "string") ||
    typeof value.iat !== "number" ||
    typeof value.exp !== "number"
  ) {
    return null;
  }
  return {
    aud: REMOTE_TICKET_AUDIENCE,
    jti: value.jti,
    sessionId: value.sessionId,
    hostId: value.hostId,
    userId: value.userId,
    membershipId: value.membershipId,
    role,
    authEpoch: value.authEpoch,
    protocolMinimum: value.protocolMinimum,
    protocolMaximum: value.protocolMaximum,
    sessionExpiresAt: value.sessionExpiresAt,
    clientPublicKey: value.clientPublicKey,
    iat: value.iat,
    exp: value.exp,
  };
}
