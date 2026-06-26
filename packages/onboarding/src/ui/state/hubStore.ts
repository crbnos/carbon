// The hub store — a SERVER-DRIVEN distribution layer, not a client state owner.
//
// The React Router loader is the single source of truth. Each render the provider
// hydrates this store from fresh loader data (`setData`). Components read slices
// via selector hooks (so a change to one slice doesn't re-render every consumer)
// and write ONLY through `dispatch`, which round-trips to the `/state` server
// action; Supabase Realtime then revalidates the loader and the cycle repeats.
// There is no optimistic local mutation and no client-owned domain state here —
// `setData` is the only writer of business fields, and only the provider calls it.
//
// `checkMap` / `fieldMap` are cheap derived lookups rebuilt on hydration so view
// components do O(1) reads instead of each rebuilding a Map per render.

import { createStore } from "zustand/vanilla";
import {
  EMPTY_EXCLUSIONS,
  fieldMap,
  type Signals,
  stateMap
} from "../../logic";
import type {
  CheckStateRow,
  FieldValueRow,
  HubContacts,
  HubExclusions,
  HubStatus,
  ImplementationRowData,
  Tier
} from "../../types";
import type { HubMutation } from "./mutations";

// The per-company server data the hub renders from (all loader-sourced).
export interface HubData {
  tier: Tier;
  status: HubStatus;
  exclusions: HubExclusions;
  checkStates: CheckStateRow[];
  fieldValues: FieldValueRow[];
  rows: ImplementationRowData[];
  contacts: HubContacts;
  signals: Signals;
}

// Viewer context. `canEdit` is UX-only (show/hide controls); the server action is
// the real authority on who may write — never trust this for security.
export interface HubFlags {
  isInternal: boolean;
  previewing: boolean;
  canEdit: boolean;
}

// App-routing injection. The package can't reach the ERP's `path.to`, so the
// route layer supplies a resolver mapping a stable screen key (e.g. a setup
// row's key) to a URL. Views render a deep link only when this returns a URL.
export type ResolveScreenUrl = (appKey: string) => string | undefined;

export interface HubState extends HubData, HubFlags {
  checkMap: Map<string, string>;
  fieldMap: Map<string, string>;
  dispatch: (m: HubMutation) => void;
  resolveScreenUrl: ResolveScreenUrl;
  // Resolve a training video key to a watch URL (academy or video), via the ERP
  // trainingConfig the route injects. Same shape as resolveScreenUrl.
  resolveVideoUrl: ResolveScreenUrl;
  // Provider-only: re-hydrate the whole store from the latest loader snapshot.
  setData: (
    data: HubData,
    flags: HubFlags,
    dispatch: (m: HubMutation) => void,
    resolveScreenUrl: ResolveScreenUrl,
    resolveVideoUrl: ResolveScreenUrl
  ) => void;
}

export type HubStore = ReturnType<typeof createHubStore>;

const EMPTY_SIGNALS: Signals = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};

export const HUB_INITIAL: HubData & HubFlags = {
  tier: "self_serve",
  status: "tailoring",
  exclusions: EMPTY_EXCLUSIONS,
  checkStates: [],
  fieldValues: [],
  rows: [],
  contacts: {},
  signals: EMPTY_SIGNALS,
  isInternal: false,
  previewing: false,
  canEdit: false
};

export function createHubStore(initial: Partial<HubData & HubFlags> = {}) {
  const seed = { ...HUB_INITIAL, ...initial };
  return createStore<HubState>()((set) => ({
    ...seed,
    checkMap: stateMap(seed.checkStates),
    fieldMap: fieldMap(seed.fieldValues),
    // Real dispatch + resolvers are injected by the provider via setData on mount.
    dispatch: () => undefined,
    resolveScreenUrl: () => undefined,
    resolveVideoUrl: () => undefined,
    setData: (data, flags, dispatch, resolveScreenUrl, resolveVideoUrl) =>
      set({
        ...data,
        ...flags,
        checkMap: stateMap(data.checkStates),
        fieldMap: fieldMap(data.fieldValues),
        dispatch,
        resolveScreenUrl,
        resolveVideoUrl
      })
  }));
}
