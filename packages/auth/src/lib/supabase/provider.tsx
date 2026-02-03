import type { Database } from "@carbon/database";
import { useInterval } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { StoreApi } from "zustand";
import { createStore, useStore } from "zustand";
import type { AuthSession } from "../../types";
import { path } from "../../utils/path";
import { createCarbonWithAuthGetter } from "./client";

interface ICarbonStore {
  carbon: SupabaseClient<Database>;
  accessToken: string;
  isRealtimeAuthSet: boolean;
  setAuthToken: (accessToken: string) => Promise<void>;
}

const CarbonContext = createContext<StoreApi<ICarbonStore>>(null);

// Module-level store reference that persists across HMR
let __hmrStore: StoreApi<ICarbonStore> | null = null;

export const CarbonProvider = ({
  children,
  session
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const store = useRef<StoreApi<ICarbonStore>>(null);

  if (!store.current) {
    store.current = createStore<ICarbonStore>((set, get) => ({
      accessToken: session.accessToken,
      isRealtimeAuthSet: false,
      carbon: createCarbonWithAuthGetter(store),
      setAuthToken: async (accessToken) => {
        const { carbon } = get();

        await carbon.realtime.setAuth(accessToken);

        set({ accessToken, isRealtimeAuthSet: true });
      }
    }));
    // Keep a module-level reference for HMR recovery
    __hmrStore = store.current;
  }

  const { carbon, setAuthToken } = useStore<StoreApi<ICarbonStore>>(
    store.current
  );

  const initialLoad = useRef(true);
  const refresh = useFetcher<{}>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    setAuthToken(session.accessToken);
  }, [carbon, setAuthToken, session.accessToken]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh.submit(null, {
          method: "post",
          action: path.to.refreshSession
        });
      }
    };

    if (isBrowser) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (isBrowser) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
      }
    };
  }, [refresh]);

  useInterval(() => {
    // refresh ten minutes before expiry
    const shouldRefresh = session.expiresAt - 60 * 10 < Date.now() / 1000;
    const shouldReload = session.expiresAt < Date.now() / 1000;

    if (shouldReload) {
      window.location.reload();
    }

    if (!initialLoad.current && shouldRefresh && carbon) {
      refresh.submit(null, {
        method: "post",
        action: path.to.refreshSession
      });
    }

    initialLoad.current = false;
  }, 60000); // Check every minute

  return (
    <CarbonContext.Provider value={store.current}>
      {children}
    </CarbonContext.Provider>
  );
};

export const useCarbon = () => {
  let store = useContext(CarbonContext);

  // During HMR, the context can temporarily be null - use the module-level store
  if (!store && __hmrStore) {
    store = __hmrStore;
  }

  if (!store) {
    throw new Error("useCarbon must be used within a CarbonProvider");
  }

  return useStore(store);
};
