// Type contracts that the deleted `central-auth-*` modules used to export.
//
// The central account line (apps/auth-api, central-auth-manager/records/effects) is gone from this
// build, but the remote server and team transport still run in an account-less mode: they skip the
// account directory (`if (!account) return`) and keep only local / LAN hosts. Those files still name
// these shapes in their signatures, so the shapes live here, restored from their remaining
// consumers rather than re-created as runtime code.
//
// Nothing here runs. Every member below is taken from an actual read in `src/main`:
//   - RemoteHostSummary: devicePublicKey, hostId, hosted, keyHandovers, logoKey, memberLimit, name,
//     role (remote-server-host-directory.ts, remote-server-manager.ts)
//   - RemoteMemberRecord / RemoteInviteRecord / RemoteInvitePreview: the account-directory records
//     that `RemoteTeamDirectory` maps into `TeamMemberSummary` / `TeamInviteSummary`
//     (remote-team-directory.ts)
//   - RemoteConnectionBootstrap: `bootstrap.ticket` and `bootstrap.signalUrl`
//     (team-webrtc-client-transport.ts)
//   - VerifiedRemoteSessionTicket: the verified ticket claims checked in team-webrtc-host-peer.ts
//   - CentralAuthOperationError: `failure.cause` (webhook-relay.ts)

import type { HostKeyHandover } from "@openbot/contracts/host-key-handover";
import type { RemoteSessionTicket } from "@openbot/contracts/remote-control-plane";
import type {
  RemoteInvitePreview as RemoteInvitePreviewRecord,
  RemoteTeamHost,
  RemoteTeamInvite,
  RemoteTeamMember,
} from "@openbot/team-client";

/** A refusal from the (now removed) account service. Only its `cause` is inspected. */
export interface CentralAuthOperationError {
  readonly cause: unknown;
}

/** One host the account directory listed, as the remote server reconciler reads it. */
export interface RemoteHostSummary extends RemoteTeamHost {
  /** The host's signed key handovers, which a listed host always carries. */
  readonly keyHandovers: HostKeyHandover[];
}

/** A membership record from the account directory, before it is mapped to a team member summary. */
export type RemoteMemberRecord = RemoteTeamMember & { readonly createdAt: number };

/** An invitation record from the account directory, before it is mapped to a team invite summary. */
export type RemoteInviteRecord = RemoteTeamInvite;

/** The preview an invitation token resolves to. */
export type RemoteInvitePreview = RemoteInvitePreviewRecord;

/** A ticket and the Signal address to spend it at. */
export type RemoteConnectionBootstrap = RemoteSessionTicket;

/** The claims a verified remote session ticket carries. */
export interface VerifiedRemoteSessionTicket {
  readonly hostId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly role: "owner" | "admin" | "member";
  readonly clientPublicKey: string;
  readonly sessionExpiresAt: number;
}
