// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { resetSupabase } from "~/lib/auth/supabase";
import {
  addInstance,
  getCurrentInstanceId,
  listInstances,
  removeInstance,
  saveInstance,
  setCurrentInstanceId
} from "./store";
import type { Instance } from "./types";

type InstanceContextValue = {
  loading: boolean;
  instances: Instance[];
  current: Instance | null;
  link: (args: {
    serverUrl: string;
    scheme: "https" | "http";
  }) => Promise<Instance>;
  switchTo: (id: string) => Promise<void>;
  unlink: (id: string) => Promise<void>;
  update: (instance: Instance) => Promise<void>;
};

const InstanceContext = createContext<InstanceContextValue | null>(null);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loaded, current] = await Promise.all([
      listInstances(),
      getCurrentInstanceId()
    ]);
    setInstances(loaded);
    setCurrentId(current ?? loaded[0]?.id ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /**
   * Switching instance throws away EVERY cached query and the supabase client.
   * Without this, staging data could render under production for the moment
   * before the new fetch lands — the shape of the cross-tenant leak in
   * `.ai/lessons.md` ("Client-side entity caches must be company-keyed").
   * Query keys are instance-scoped too; this is the belt to that braces.
   */
  const resetCaches = useCallback(() => {
    queryClient.clear();
    resetSupabase();
  }, [queryClient]);

  const value = useMemo<InstanceContextValue>(
    () => ({
      loading,
      instances,
      current: instances.find((i) => i.id === currentId) ?? null,
      async link(args) {
        const instance = await addInstance(args);
        resetCaches();
        await refresh();
        return instance;
      },
      async switchTo(id) {
        resetCaches();
        await setCurrentInstanceId(id);
        await refresh();
      },
      async unlink(id) {
        resetCaches();
        await removeInstance(id);
        await refresh();
      },
      async update(instance) {
        await saveInstance(instance);
        await refresh();
      }
    }),
    [loading, instances, currentId, refresh, resetCaches]
  );

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
}

export function useInstances() {
  const value = useContext(InstanceContext);
  if (!value) {
    throw new Error("useInstances must be used inside an InstanceProvider");
  }
  return value;
}
