import {
  type ReleaseCatalogEntry,
  summarizeWhatsNew,
  type WhatsNewNotes,
  type WhatsNewRelease,
} from "@openbot/ui/features/updates/whats-new";
import { createEffect, createStore, onSettled } from "solid-js";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import {
  claimWhatsNewVersion,
  compareReleaseVersions,
  readWhatsNewVersion,
  releaseVersion,
  selectWhatsNewReleases,
} from "./whats-new-history";
import { loadBundledWhatsNewReleases, loadReleaseCatalog } from "./whats-new-releases";

const WhatsNew = createSimpleContext({
  name: "WhatsNew",
  init: (props: { loadReleases?: (signal: AbortSignal) => Promise<readonly WhatsNewRelease[]> }) => {
    const platform = usePlatform();
    // Capture the old analytics value before Settings writes this launch's version.
    const storage = {
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    };
    const previous = readWhatsNewVersion(storage);
    const [state, setState] = createStore<{
      open: boolean;
      version: string;
      previousVersion: string | null;
      notes: WhatsNewNotes;
      catalog: readonly ReleaseCatalogEntry[];
      latestTag: string | null;
      catalogFailed: boolean;
      truncated: boolean;
      offlineNotes: boolean;
    }>({
      open: false,
      version: "",
      previousVersion: null,
      notes: { status: "loading" },
      catalog: [],
      latestTag: null,
      catalogFailed: false,
      truncated: false,
      offlineNotes: false,
    });
    let initialized = false;
    let request = 0;
    let pending: AbortController | undefined;
    onSettled(() => () => {
      request++;
      pending?.abort();
    });

    async function load(automatic: boolean, version: string, from: string | null): Promise<void> {
      const id = ++request;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      setState((draft) => {
        draft.version = version;
        draft.previousVersion = from;
        draft.notes = { status: "loading" };
        draft.offlineNotes = false;
        draft.catalogFailed = false;
        if (!automatic) draft.open = true;
      });
      let notes: WhatsNewNotes;
      let catalog: readonly ReleaseCatalogEntry[] = [];
      let latestTag: string | null = null;
      let catalogFailed = false;
      let offlineNotes = false;
      let truncated = false;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
        const result = props.loadReleases
          ? { notes: await props.loadReleases(signal), catalog: [], latestTag: null, truncated: false }
          : await loadReleaseCatalog(signal);
        catalog = result.catalog;
        latestTag = result.latestTag;
        truncated = result.truncated;
        notes = { status: "ready", releases: selectWhatsNewReleases(result.notes, version, from) };
      } catch {
        catalogFailed = true;
        try {
          const fallback = await loadBundledWhatsNewReleases(controller.signal);
          notes = { status: "ready", releases: selectWhatsNewReleases(fallback, version, from) };
          offlineNotes = true;
        } catch {
          notes = { status: "failed" };
        }
      }
      if (id !== request) return;
      // Failed network requests do not consume the automatic notice.
      if (!catalogFailed && notes.status === "ready" && !claimWhatsNewVersion(storage, version) && automatic) return;
      const summary = notes.status === "ready" ? summarizeWhatsNew(notes.releases) : null;
      setState((draft) => {
        draft.notes = notes;
        draft.catalog = catalog;
        draft.latestTag = latestTag;
        draft.catalogFailed = catalogFailed;
        draft.offlineNotes = offlineNotes;
        draft.truncated = truncated;
        if (automatic)
          draft.open = catalogFailed || summary === null || summary.notices.length > 0 || summary.groups.length > 0;
      });
    }

    createEffect(platform.appInfo, (info) => {
      if (initialized || platform.landingPreview || !platform.appInfoLoadedFromHost()) return;
      const current = releaseVersion(info?.version ?? null);
      if (current === null) return;
      initialized = true;
      if (previous !== null) claimWhatsNewVersion(storage, previous);
      setState((draft) => {
        draft.version = current;
      });
      if (previous === null) {
        claimWhatsNewVersion(storage, current);
      } else if (compareReleaseVersions(current, previous) > 0) {
        // The workspace calls start after login and setup, so notes do not cover onboarding.
        setState((draft) => {
          draft.previousVersion = previous;
        });
      }
    });

    let started = false;
    function start(): void {
      if (started || !state.version) return;
      started = true;
      if (state.previousVersion !== null) void load(true, state.version, state.previousVersion);
    }

    function reopen(): void {
      const version = state.version;
      if (!version) return;
      started = true;
      void load(false, version, null);
    }

    return {
      state,
      start,
      reopen,
      retry: () => {
        void load(false, state.version, state.previousVersion);
      },
      close: () => {
        request++;
        pending?.abort();
        setState((draft) => {
          draft.open = false;
        });
      },
    };
  },
});

export const WhatsNewProvider = WhatsNew.provider;
export const useWhatsNew = WhatsNew.use;
