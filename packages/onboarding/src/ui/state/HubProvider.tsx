// Provider + selector hooks for the hub store. The provider owns one store
// instance and re-hydrates it from loader data on every change; everything below
// it reads via hooks, so no view needs `states`/`fieldValues`/`canEdit` props.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef
} from "react";
import { useStore } from "zustand";
import type {
  GateValue,
  HubContacts,
  HubExclusions,
  HubStatus,
  StateKind,
  Tier
} from "../../types";
import {
  createHubStore,
  type HubData,
  type HubFlags,
  type HubState,
  type HubStore,
  type ResolveScreenUrl
} from "./hubStore";
import type { HubMutation } from "./mutations";

const noScreenUrl: ResolveScreenUrl = () => undefined;

const HubContext = createContext<HubStore | null>(null);

export function HubProvider({
  data,
  flags,
  dispatch,
  resolveScreenUrl = noScreenUrl,
  resolveVideoUrl = noScreenUrl,
  children
}: {
  data: HubData;
  flags: HubFlags;
  dispatch: (m: HubMutation) => void;
  resolveScreenUrl?: ResolveScreenUrl;
  resolveVideoUrl?: ResolveScreenUrl;
  children: ReactNode;
}) {
  const storeRef = useRef<HubStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createHubStore({ ...data, ...flags });
    storeRef.current
      .getState()
      .setData(data, flags, dispatch, resolveScreenUrl, resolveVideoUrl);
  }

  // Re-hydrate from the loader whenever it revalidates (e.g. after a mutation or
  // a realtime ping). The store mirrors the server; it never diverges from it.
  useEffect(() => {
    storeRef.current
      ?.getState()
      .setData(data, flags, dispatch, resolveScreenUrl, resolveVideoUrl);
  }, [data, flags, dispatch, resolveScreenUrl, resolveVideoUrl]);

  return (
    <HubContext.Provider value={storeRef.current}>
      {children}
    </HubContext.Provider>
  );
}

function useHubStoreApi(): HubStore {
  const store = useContext(HubContext);
  if (!store) {
    throw new Error("Hub hooks must be used within <HubProvider>");
  }
  return store;
}

// Generic selector hook. Prefer the named hooks below; reach for this for ad-hoc
// slices. Keep selectors returning primitives or stable refs (see useRows).
export function useHub<T>(selector: (s: HubState) => T): T {
  return useStore(useHubStoreApi(), selector);
}

export const useCanEdit = () => useHub((s) => s.canEdit);
export const usePreviewing = () => useHub((s) => s.previewing);
export const useIsInternal = () => useHub((s) => s.isInternal);
export const useTier = () => useHub((s) => s.tier);
export const useHubStatus = () => useHub((s) => s.status);
export const useExclusions = () => useHub((s) => s.exclusions);
export const useContacts = () => useHub((s) => s.contacts);
export const useSignals = () => useHub((s) => s.signals);
export const useCheckMap = () => useHub((s) => s.checkMap);
export const useFieldMap = () => useHub((s) => s.fieldMap);
// Resolve a deep link to the ERP screen for a stable screen key (or undefined).
export const useResolveScreenUrl = () => useHub((s) => s.resolveScreenUrl);
// Resolve a training video key to a watch URL (or undefined).
export const useResolveVideoUrl = () => useHub((s) => s.resolveVideoUrl);

// Custom rows for one collection. Selects the stable `rows` ref and filters in a
// memo so the selector never returns a fresh array (which would thrash useStore).
export function useRows(collection: string) {
  const rows = useHub((s) => s.rows);
  return useMemo(
    () => rows.filter((r) => r.collection === collection),
    [rows, collection]
  );
}

// Typed write helpers over the raw dispatch. Every call is a server round-trip.
export function useHubActions() {
  const dispatch = useHub((s) => s.dispatch);
  return useMemo(
    () => ({
      setCheck: (itemKey: string, kind: StateKind, value: string) =>
        dispatch({ intent: "setCheck", itemKey, kind, value }),
      // Boolean flag toggles (scopeFlag / check) persist as "1" | "0".
      toggleFlag: (itemKey: string, kind: StateKind, on: boolean) =>
        dispatch({ intent: "setCheck", itemKey, kind, value: on ? "1" : "0" }),
      setGate: (itemKey: string, value: GateValue) =>
        dispatch({ intent: "setCheck", itemKey, kind: "gate", value }),
      setField: (fieldKey: string, value: string) =>
        dispatch({ intent: "setField", fieldKey, value }),
      addRow: (collection: string, payload: Record<string, unknown>) =>
        dispatch({ intent: "addRow", collection, payload }),
      updateRow: (rowId: string, payload: Record<string, unknown>) =>
        dispatch({ intent: "updateRow", rowId, payload }),
      deleteRow: (rowId: string) => dispatch({ intent: "deleteRow", rowId }),
      setExclusions: (exclusions: HubExclusions) =>
        dispatch({ intent: "setExclusions", exclusions }),
      setTier: (tier: Tier) => dispatch({ intent: "setTier", tier }),
      setStatus: (status: HubStatus) =>
        dispatch({ intent: "setStatus", status }),
      setContacts: (contacts: HubContacts) =>
        dispatch({ intent: "setContacts", contacts })
    }),
    [dispatch]
  );
}
