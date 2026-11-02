/**
 * The DeepSeek Harness runtime. The application ships one baseline build and can install a newer
 * one from its update channel into the user data folder; the newer one wins at the next session.
 */
export interface DshRuntimeStatus {
  /** The version the next agent session starts with. */
  active: { version: string; source: "bundled" | "installed" | "development" };
  /** Versions installed under the user data folder, newest first. */
  installed: readonly { version: string }[];
  /** The version the update channel offers, or null when it offers nothing newer. */
  latest: { version: string } | null;
  /** Whether an update channel is configured at all. */
  channelConfigured: boolean;
}

export interface InstallDshRuntimeInput {
  version: string;
}
