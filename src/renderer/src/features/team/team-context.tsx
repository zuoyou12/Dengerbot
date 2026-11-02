import type { TeamPresenceMember, TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { createMemo, createSignal, flush, onSettled } from "solid-js";
import { EMPTY_TEAM_PRESENCE } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { teamPort } from "./team-port";

/**
 * Who else is on the active workspace. Slim build: no central account, so no
 * presence member can be matched to the reader, and `currentTeamMember` is
 * always undefined. That also keeps `directPeople` empty, as before for a
 * signed-out user: a list of people to message is meaningless without a "me"
 * to exclude from it.
 *
 * The snapshot itself is per server, but the read that seeds it is one of the
 * eight the workspace bootstrap and `selectServer` both run, so the *load* stays
 * with whoever owns that sequence and only the state lives here. That is why
 * `setTeamPresence` is exported: the server switch clears it and the bootstrap
 * fills it. Both callers disappear once the per-server scope owns its own init.
 *
 * `activeDirectMember` is deliberately not here. It reads the selected member,
 * and selection sits under this domain.
 */
const Presence = createSimpleContext({
  name: "Presence",
  init: () => {
    const [teamPresence, setTeamPresence] = createSignal<TeamPresenceSnapshot>(EMPTY_TEAM_PRESENCE);

    // No central identity exists to match a member against. The memo stays so
    // every reader keeps its shape; it never resolves to a member.
    const currentTeamMember = createMemo<TeamPresenceMember | undefined>(() => undefined);

    const directPeople = createMemo(() => {
      const currentMemberId = currentTeamMember()?.id;
      if (!currentMemberId) return [];
      return teamPresence().members.filter((member) => member.id !== currentMemberId && !member.disabled);
    });

    onSettled(() => teamPort().servers.onPresence((snapshot) => flush(() => setTeamPresence(snapshot))));

    return { teamPresence, setTeamPresence, currentTeamMember, directPeople };
  },
});

export const PresenceProvider = Presence.provider;
export const usePresence = Presence.use;
