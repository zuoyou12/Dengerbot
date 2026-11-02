import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack nie akceptuje już Dengerbot w tym obszarze roboczym. Mógł zostać odinstalowany. Połącz obszar roboczy ponownie.",
  "messaging.help.secret_storage_unavailable":
    "Dengerbot nie może odczytać zapisanych tokenów na tym komputerze. Rozłącz obszar roboczy, a potem połącz go ponownie.",
  "messaging.help.relay_unavailable":
    "Dengerbot nie może odbierać zdarzeń Slack na tym komputerze. Zaloguj się, nadaj temu komputerowi nazwę w ustawieniach serwera i nie zamykaj Dengerbot.",
  "messaging.discordHelp.invalid_token":
    "Discord nie akceptuje już Dengerbot na tym serwerze Discord. Mógł zostać usunięty. Połącz serwer Discord ponownie.",
  "messaging.discordHelp.secret_storage_unavailable":
    "Dengerbot nie może odczytać zapisanych tokenów na tym komputerze. Rozłącz serwer Discord, a potem połącz go ponownie.",
  "messaging.discordHelp.relay_unavailable":
    "Dengerbot nie może odbierać zdarzeń Discord na tym komputerze. Zaloguj się, nadaj temu komputerowi nazwę w ustawieniach serwera i nie zamykaj Dengerbot.",
} as const satisfies PartialTranslation<typeof source>;
