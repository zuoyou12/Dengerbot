/**
 * What the DSH account bridge last reported about the DeepSeek account of this machine. The bridge
 * rewrites its handoff file when the account changes, and at least every 15 minutes as a fallback;
 * the reader treats a handoff file older than 45 minutes as expired.
 */
export interface DshAccountInfo {
  signedIn: boolean;
  /** The display name of the DeepSeek account, or null when signed out. */
  name: string | null;
  avatarUrl: string | null;
  currency: string | null;
  balance: string | null;
  /** Epoch milliseconds of the last bridge write. */
  updatedAt: number;
}

/**
 * The lifecycle of the DeepSeek account sign-in window, for the settings row that opens it and
 * closes it again once the account comes through. `failed` carries no detail: the sign-in window
 * discards all DSH output because the sign-in URL carries tokens, so there is nothing safe to show.
 */
export type DshAccountSignInPhase = "idle" | "signing-in" | "signed-in" | "failed";

export interface DshAccountSignInState {
  phase: DshAccountSignInPhase;
  account: DshAccountInfo | null;
}
