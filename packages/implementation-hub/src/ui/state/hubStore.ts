// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hub store — a SERVER-DRIVEN distribution layer, not a client state owner.
//
// The React Router loader is the single source of truth. Each render the provider
// hydrates this store from fresh loader data (`setData`). Components read slices
// via selector hooks (so a change to one slice doesn't re-render every consumer)
// and write ONLY through `dispatch`, which round-trips to the `/state` server
// action (`serverDispatch`); Supabase Realtime then revalidates the loader and
// the cycle repeats. `setData` is the authoritative writer of business fields —
// only the provider calls it, and it always rebuilds from the server snapshot.
//
// One exception, for responsiveness: `dispatch` records an OPTIMISTIC override
// for `setCheck` / `setChecks` toggles (checkboxes/gates, single or batched) in
// `optimisticChecks` before the round-trip, so a tick reflects instantly
// instead of after the full submit→revalidate cycle. `checkMap` is always the server state with these
// overrides layered on top. Each override is held until the loader actually
// reports the value we wrote, then released — so it survives stale/early
// revalidations (whose snapshot doesn't yet reflect the write, and which would
// otherwise flash the toggle back) and reconciles to server truth once the write
// lands. An answer to an open question (`answerQuestion`) is held the same
// way: `optimisticAnswers` is layered over the server rows, and the question's
// tick over `checkMap`. No other intent is patched locally; everything else
// waits for the loader. A write the server refuses never lands, so the route
// calls `discardPending` and the page shows the server's state again.
//
// `checkMap` / `fieldMap` are cheap derived lookups rebuilt on hydration so view
// components do O(1) reads instead of each rebuilding a Map per render.

import { createStore } from "zustand/vanilla";
import {
  answerQuestionPayload,
  checkKey,
  EMPTY_EXCLUSIONS,
  fieldMap,
  type OnboardingCountKey,
  type QuestionChange,
  type Signals,
  stateMap,
  withPendingAnswers
} from "../../logic";
import type {
  AssignmentRow,
  CheckStateRow,
  FieldValueRow,
  HubContacts,
  HubExclusions,
  HubPerson,
  HubStatus,
  ImplementationRowData,
  Tier
} from "../../types";
import type { HubMutation } from "./mutations";

// Server check state with the pending optimistic overrides layered on top.
// `checkMap` is always derived through here so an in-flight toggle wins until the
// loader catches up.
function mergeChecks(
  checkStates: CheckStateRow[],
  optimistic: Map<string, string>
): Map<string, string> {
  const map = stateMap(checkStates);
  for (const [key, value] of optimistic) map.set(key, value);
  return map;
}

const checkRows = (rows: CheckStateRow[]) =>
  new Map(rows.map((row) => [row.itemKey, row]));

const assignmentMap = (rows: AssignmentRow[]) =>
  new Map(rows.map((row) => [row.itemKey, row.assigneeId]));

const peopleById = (people: HubPerson[]) =>
  new Map(people.map((person) => [person.id, person]));

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
  // Setup counts (getSetupCounts): evidence next to steps and the readiness of
  // operational tasks. A null count could not be read.
  counts: Partial<Record<OnboardingCountKey, number | null>>;
  assignments: AssignmentRow[];
  // The company's active employees, for assignee pickers and names.
  people: HubPerson[];
  // The person viewing, for "My tasks" and owning their own objectives.
  userId: string;
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
  // itemKey -> the full check-state row, for its source and verification.
  checkRowMap: Map<string, CheckStateRow>;
  // itemKey -> assignee user id.
  assignmentMap: Map<string, string>;
  // user id -> person.
  peopleById: Map<string, HubPerson>;
  // Pending optimistic check overrides (itemKey -> value), layered over the
  // server checkMap. Each is held until the loader reports the value we wrote,
  // so an in-flight toggle never flashes back when a stale/early revalidation
  // lands before the write does. Internal; views read checkMap.
  optimisticChecks: Map<string, string>;
  // Pending answers to open questions (row id -> answer), layered over the
  // server rows until the loader reports them. Internal; views read rows.
  optimisticAnswers: Map<string, QuestionChange>;
  // The rows as the loader sent them, before pending answers are layered on.
  serverRows: ImplementationRowData[];
  // Public write path: optimistic check override (setCheck/setChecks) + round-trip.
  dispatch: (m: HubMutation) => void;
  // Drops every pending tick and answer: the server refused the write, so the
  // loader will never report it.
  discardPending: () => void;
  // The raw server round-trip the route injects; `dispatch` wraps it.
  serverDispatch: (m: HubMutation) => void;
  resolveScreenUrl: ResolveScreenUrl;
  // Resolve a training video key to a watch URL (academy or video), via the ERP
  // trainingConfig the route injects. Same shape as resolveScreenUrl.
  resolveVideoUrl: ResolveScreenUrl;
  // Provider-only: re-hydrate the whole store from the latest loader snapshot.
  setData: (
    data: HubData,
    flags: HubFlags,
    serverDispatch: (m: HubMutation) => void,
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
  counts: {},
  assignments: [],
  people: [],
  userId: "",
  isInternal: false,
  previewing: false,
  canEdit: false
};

export function createHubStore(initial: Partial<HubData & HubFlags> = {}) {
  const seed = { ...HUB_INITIAL, ...initial };
  return createStore<HubState>()((set, get) => ({
    ...seed,
    optimisticChecks: new Map(),
    optimisticAnswers: new Map(),
    serverRows: seed.rows,
    checkMap: stateMap(seed.checkStates),
    fieldMap: fieldMap(seed.fieldValues),
    checkRowMap: checkRows(seed.checkStates),
    assignmentMap: assignmentMap(seed.assignments),
    peopleById: peopleById(seed.people),
    // Stable wrapper, created once. Records an optimistic override for a
    // checkbox/gate toggle so the UI updates instantly, then round-trips. The
    // override is layered over the server checkMap and released by setData once
    // the loader confirms the written value (see below).
    dispatch: (m) => {
      // Batched setChecks overrides every key it writes — this also replaces
      // any in-flight single-toggle override for those keys, so a toggle whose
      // POST the batch cancels (shared fetcher) can't strand a stale value.
      if (m.intent === "setCheck" || m.intent === "setChecks") {
        const optimisticChecks = new Map(get().optimisticChecks);
        if (m.intent === "setCheck") {
          optimisticChecks.set(m.itemKey, m.value);
        } else {
          for (const itemKey of m.itemKeys) {
            optimisticChecks.set(itemKey, m.value);
          }
        }
        set({
          optimisticChecks,
          checkMap: mergeChecks(get().checkStates, optimisticChecks)
        });
      }
      // The answer shows at once, and so does the tick the server will set
      // from it.
      if (m.intent === "answerQuestion") {
        const row = get().rows.find((r) => r.id === m.rowId);
        if (row) {
          const answer = answerQuestionPayload(row.payload, m.change);
          const optimisticAnswers = new Map(get().optimisticAnswers);
          optimisticAnswers.set(m.rowId, m.change);
          const optimisticChecks = new Map(get().optimisticChecks);
          optimisticChecks.set(
            checkKey("question", m.rowId),
            answer.answered ? "1" : "0"
          );
          set({
            optimisticAnswers,
            optimisticChecks,
            rows: get().rows.map((r) =>
              r.id === m.rowId ? { ...r, payload: answer.payload } : r
            ),
            checkMap: mergeChecks(get().checkStates, optimisticChecks)
          });
        }
      }
      get().serverDispatch(m);
    },
    discardPending: () => {
      const optimisticChecks = new Map<string, string>();
      set({
        optimisticChecks,
        optimisticAnswers: new Map(),
        rows: get().serverRows,
        checkMap: mergeChecks(get().checkStates, optimisticChecks)
      });
    },
    // Real server dispatch + resolvers are injected by the provider via setData.
    serverDispatch: () => undefined,
    resolveScreenUrl: () => undefined,
    resolveVideoUrl: () => undefined,
    setData: (
      data,
      flags,
      serverDispatch,
      resolveScreenUrl,
      resolveVideoUrl
    ) => {
      // Reconcile per key: drop an override only once the loader actually reports
      // the value we wrote (row absence = effective "todo"). This holds the
      // override through any number of stale/early revalidations whose snapshot
      // doesn't yet reflect the write — so the toggle never flickers back — and
      // releases it the moment the server confirms. (upsertCheckState always
      // writes the value, including "todo", so a confirmed write always matches.)
      const serverMap = stateMap(data.checkStates);
      const optimisticChecks = new Map(get().optimisticChecks);
      for (const [key, value] of optimisticChecks) {
        if ((serverMap.get(key) ?? "todo") === value)
          optimisticChecks.delete(key);
      }
      const answers = withPendingAnswers(data.rows, get().optimisticAnswers);
      set({
        ...data,
        ...flags,
        rows: answers.rows,
        serverRows: data.rows,
        optimisticAnswers: answers.pending,
        optimisticChecks,
        checkMap: mergeChecks(data.checkStates, optimisticChecks),
        fieldMap: fieldMap(data.fieldValues),
        checkRowMap: checkRows(data.checkStates),
        assignmentMap: assignmentMap(data.assignments),
        peopleById: peopleById(data.people),
        serverDispatch,
        resolveScreenUrl,
        resolveVideoUrl
      });
    }
  }));
}
