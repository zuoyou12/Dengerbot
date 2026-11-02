import { useText } from "@openbot/ui/text";
import { createMemo, Loading, Match, Show, Switch } from "solid-js";
import { AgentUsagePanel, WorkflowsPage } from "../../lazy-views";
import { useAgents } from "../agents/agents-context";
import { useConnectors } from "../connectors/connectors-context";
import { LocalGatewayPage } from "../gateway/LocalGatewayPage";
import { SchedulePanel } from "../schedule/SchedulePanel";
import { useServers } from "../servers/servers-context";
import { MarketplaceModal } from "../settings/MarketplaceModal";
import type { MarketplaceAgentRow } from "../settings/marketplace-controller";
import { MARKETPLACE_PLUGINS } from "../settings/marketplace-plugin-catalog";
import { useSettings } from "../settings/settings-context";
import { useUsage } from "../usage/usage-context";
import { SettingsPage } from "./SettingsPage";
import { type SettingsKind, useWindowPage } from "./window-page-context";

/**
 * The Marketplace as a window page. It is the upstream overlay adapted to this shell: single
 * computer, so the agents are this computer's assistants and the plugin server is the active one.
 */
function MarketplaceWindowPage() {
  const { agentList, activeAgent } = useAgents();
  const { activeServerId } = useServers();
  const connectors = useConnectors();
  const settings = useSettings();
  const agents = createMemo<MarketplaceAgentRow[]>(() =>
    agentList().map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue,
      avatarUrl: agent.avatarUrl,
    })),
  );
  return (
    <MarketplaceModal
      open={true}
      agents={agents()}
      activeAgentId={activeAgent()?.id ?? ""}
      onOpenChange={(open) => {
        if (!open) settings.setSkillsMarketplaceOpen(false);
      }}
      plugins={MARKETPLACE_PLUGINS}
      pluginServerId={activeServerId() ?? undefined}
      connectors={connectors.active}
    />
  );
}

/**
 * The page of the desktop window that covers the conversation: a settings page, usage, schedule,
 * workflows, the Marketplace or the gateway.
 */
export function WindowPageView() {
  const { t } = useText();
  const windowPage = useWindowPage();
  const usage = useUsage();
  const { servers } = useServers();
  const settingsKind = (): SettingsKind | null => {
    const page = windowPage.page();
    if (page === "settings") return "personal";
    return page === "server-settings" ? "server" : null;
  };
  const hostName = (serverId: string) =>
    servers().find((server) => server.id === serverId)?.name ?? t("app.page.serverFallback");
  return (
    <Show when={windowPage.page() !== "marketplace"} fallback={<MarketplaceWindowPage />}>
      <Show
        when={settingsKind() ? null : usage.state.serverId}
        fallback={
          <Show when={settingsKind()} keyed>
            {(kind) => <SettingsPage kind={kind} />}
          </Show>
        }
      >
        {(serverId) => (
          <Switch
            fallback={
              <Loading>
                <AgentUsagePanel
                  serverId={serverId()}
                  hostName={hostName(serverId())}
                  agentId={usage.state.agentId}
                  onBack={usage.closeUsage}
                />
              </Loading>
            }
          >
            <Match when={usage.state.view === "schedule"}>
              <SchedulePanel serverId={serverId()} hostName={hostName(serverId())} onBack={usage.closeUsage} />
            </Match>
            <Match when={usage.state.view === "workflows"}>
              <Loading>
                <WorkflowsPage serverId={serverId()} />
              </Loading>
            </Match>
            <Match when={usage.state.view === "gateway"}>
              <LocalGatewayPage onBack={usage.closeUsage} />
            </Match>
          </Switch>
        )}
      </Show>
    </Show>
  );
}
