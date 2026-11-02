import type {
  AgentAccessChange,
  AgentAccessSnapshot,
  BrowserProfileSummary,
  HostStatus,
  HostUpdateStatus,
} from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { desktopBrowserProfileCalls } from "../src/features/browser/browser-profiles-port";
import type { ServerBrowserProfilesOptions } from "../src/features/browser/ServerBrowserProfilesPanel";
import { createBrowserProfilesStore } from "../src/features/browser/stores/browser-profiles-store";
import type { ServerAgentAccessOptions } from "../src/features/servers/ServerRolesSection";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import { STORY_AGENT_SUMMARIES, STORY_HOST_STATUS, STORY_PRESENCE } from "../src/preview/fixtures";
import {
  ServerSettingsStory,
  STORY_LOCAL_SERVER,
  STORY_REMOTE_SERVER,
  serverSettingsArgs,
} from "./server-settings-story";

const localServer = STORY_LOCAL_SERVER;
const remoteServer = STORY_REMOTE_SERVER;

const meta = {
  title: "Settings/ServerSettingsModal",
  component: ServerSettingsModal,
  render: (args) => <ServerSettingsStory settings={args} />,
  // `serverSettingsArgs()` leaves out `page`, which the story host supplies, and Storybook then makes
  // every story write it. Naming it here once keeps the story args at the fields each case changes.
  args: { ...serverSettingsArgs(), page: undefined },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: {
          name: "Server settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        serverMinimum: {
          name: "Server settings — 960 × 640",
          styles: { width: "960px", height: "640px" },
        },
        serverMobile: {
          name: "Server settings — 640 × 720",
          styles: { width: "640px", height: "720px" },
        },
        serverNarrow: {
          name: "Server settings — 480 × 720",
          styles: { width: "480px", height: "720px" },
        },
      },
    },
  },
} satisfies Meta<typeof ServerSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LocalFirstSetup: Story = {
  args: {
    server: { ...localServer, name: "Local", state: "online", apiUrl: null },
    hostStatus: {
      ...STORY_HOST_STATUS,
      phase: "unconfigured",
      configured: false,
      enabledOnLaunch: false,
      serverId: null,
      serverName: null,
      logoUrl: null,
      apiUrl: null,
      apiOnline: false,
      remoteDesktopReady: false,
      remoteDesktopScreenRecordingDenied: false,
      remoteDesktopUnattended: false,
      remoteDesktopActiveSessions: 0,
      remoteDesktopMaxSessions: 4,
    },
    members: [],
    invites: [],
  },
};

export const FirstSetupInvalidNameSmallViewport: Story = {
  args: LocalFirstSetup.args,
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

/** Members of a server with no name yet: publishing generates one, so the switch is ready. */
export const LocalFirstPublication: Story = {
  args: { ...LocalFirstSetup.args, initialSection: "members" },
};

export const RemoteDesktopAfterPublication: Story = {
  render: (args) => <PublicationSetupStory settings={args} />,
};

function PublicationSetupStory(props: { settings: ServerSettingsModalProps }) {
  const [published, setPublished] = createSignal(false);
  return (
    <ServerSettingsStory
      settings={{
        ...props.settings,
        initialSection: "members",
        get hostStatus(): HostStatus {
          return { ...STORY_HOST_STATUS, configured: true, phase: published() ? "online" : "idle" };
        },
        onSetPublished: async (value) => {
          setPublished(value);
        },
      }}
    />
  );
}

export const LocalOnline: Story = {
  args: {
    hostStatus: {
      ...STORY_HOST_STATUS,
      apiUrl: "https://eu-west-1.gateway.example.com/openbot/servers/team_7f3c19a2",
    },
  },
};

export const ActionError: Story = {
  args: {
    loadError: "The server did not respond. Check the connection and try again.",
  },
};

export const RemoteAdministrator: Story = {
  args: {
    server: { ...remoteServer, role: "admin" },
    hostStatus: null,
  },
};

export const RemoteMember: Story = {
  args: {
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
    invites: [],
  },
};

/**
 * The named profiles the section lists: the two the preview mock seeds, with the agent that uses one
 * and the tabs it holds open.
 */
const STORY_BROWSER_PROFILES: BrowserProfileSummary[] = [
  { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215, agentIds: ["sales"], tabCount: 2 },
  { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30, agentIds: [], tabCount: 0 },
];

/**
 * The section's options over the list one story shows: the preview mock answers every call, and only
 * the list comes from the story, so `storyBrowserProfiles([])` is the state with no named profile.
 */
function storyBrowserProfiles(profiles: BrowserProfileSummary[]): ServerBrowserProfilesOptions {
  const calls = desktopBrowserProfileCalls();
  return {
    store: createBrowserProfilesStore(() => ({
      ...calls,
      list: async () => ({ ...(await calls.list()), profiles }),
    })),
    listAgents: async () => STORY_AGENT_SUMMARIES.slice(0, 3),
  };
}

export const BrowserProfiles: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory settings={{ ...args, browserProfiles: storyBrowserProfiles(STORY_BROWSER_PROFILES) }} />
  ),
};

/** No named profile yet: the agents use the shared profile or their own. */
export const BrowserProfilesEmpty: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => <ServerSettingsStory settings={{ ...args, browserProfiles: storyBrowserProfiles([]) }} />,
};

const STORY_HOST_UPDATE: HostUpdateStatus = {
  phase: "available",
  currentVersion: "0.23.0",
  availableVersion: "0.24.0",
  progress: null,
  errorCode: null,
  remoteUpdates: "allowed",
  autoDownload: true,
  autoInstall: false,
  restart: null,
};

const remoteUpdateArgs = {
  server: { ...remoteServer, role: "admin" as const },
  hostStatus: null,
  hostUpdate: {},
  initialSection: "updates" as const,
};

export const RemoteUpdateAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => <ServerSettingsStory settings={args} hostUpdate={STORY_HOST_UPDATE} />,
};

export const RemoteUpdateWaiting: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "ready",
        progress: 100,
        restart: { requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: ["agent-turn", "routine-run"] },
      }}
    />
  ),
};

export const RemoteUpdateDownloading: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "downloading",
        progress: 42,
        restart: { requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: [] },
      }}
    />
  ),
};

export const RemoteUpdateAutomatic: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "ready",
        progress: 100,
        autoInstall: true,
        restart: { requestedBy: null, mode: "when-idle", waitingFor: ["agent-turn"] },
      }}
    />
  ),
};

export const RemoteUpdateDisabled: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory settings={args} hostUpdate={{ ...STORY_HOST_UPDATE, remoteUpdates: "disabled" }} />
  ),
};

export const SmallViewport: Story = {
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

export const HostedReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" }}
    />
  ),
};

export const ContainerReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "container" }}
    />
  ),
};

/**
 * The roles of one story server: Research is closed to Everyone, Legal chats with it, and Finance
 * reads Sales. A save keeps its change until Storybook loads the story file again.
 */
function storyAgentAccess(): ServerAgentAccessOptions {
  let stored: AgentAccessChange = {
    revision: 3,
    everyone: { research: "none", sales: "view" },
    roles: [
      { id: "role-legal", name: "Legal", agents: { research: "chat" }, memberIds: ["member-jon"] },
      { id: "role-finance", name: "Finance", agents: { sales: "manage" }, memberIds: ["member-jon", "member-maya"] },
    ],
  };
  const read = (): AgentAccessSnapshot => ({
    ...structuredClone(stored),
    mine: Object.fromEntries(STORY_AGENT_SUMMARIES.map((agent) => [agent.id, "manage" as const])),
  });
  return {
    calls: {
      getAgentAccess: async () => read(),
      setAgentAccess: async (change) => {
        stored = { ...structuredClone(change), revision: change.revision + 1 };
        return read();
      },
    },
    listAgents: async () => STORY_AGENT_SUMMARIES.slice(0, 3),
  };
}

/** Everyone, then the custom roles. A role page sets the level of each agent. */
export const Roles: Story = {
  args: { initialSection: "roles", agentAccess: storyAgentAccess() },
};

/** The role menu of each member row holds the server role and the custom roles. */
export const MembersWithRoles: Story = {
  args: { initialSection: "members", agentAccess: storyAgentAccess() },
};

/** Only the owner and no invitation: sample invitations land behind the invite action, one at a time. */
export const MembersEmpty: Story = {
  args: {
    initialSection: "members",
    members: STORY_PRESENCE.members.filter((member) => member.role === "owner"),
    invites: [],
  },
};
