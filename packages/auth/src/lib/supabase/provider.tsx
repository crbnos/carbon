import type { Database } from "@carbon/database";
import { useInterval } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand";
import { createStore, useStore } from "zustand";
import type { AuthSession } from "../../types";
import { path } from "../../utils/path";
import { getCarbon } from "./client";

interface ICarbonStore {
  carbon: SupabaseClient<Database>;
  accessToken: string;
  isRealtimeAuthSet: boolean;
  setAuthToken: (accessToken: string, refreshToken: string) => Promise<void>;
}

const CarbonContext = createContext<StoreApi<ICarbonStore>>(null);

export const CarbonProvider = ({
  children,
  session,
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const [store] = useState(() =>
    createStore<ICarbonStore>((set, get) => ({
      accessToken: session.accessToken || "",
      isRealtimeAuthSet: false,
      carbon: getCarbon(session.accessToken),
      setAuthToken: async (accessToken, refreshToken) => {
        const { carbon } = get();

        await carbon.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        await carbon.realtime.setAuth(accessToken);

        set({ accessToken, isRealtimeAuthSet: true });
      },
    }))
  );

  const { carbon, setAuthToken } = useStore(store);

  const initialLoad = useRef(true);
  const refresh = useFetcher<{}>();

  useEffect(() => {
    setAuthToken(session.accessToken, session.refreshToken);
  }, [carbon, session.refreshToken, setAuthToken, session.accessToken]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh.submit(null, {
          method: "post",
          action: path.to.refreshSession,
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
        action: path.to.refreshSession,
      });
    }

    initialLoad.current = false;
  }, 60000); // Check every minute

  return (
    <CarbonContext.Provider value={store}>{children}</CarbonContext.Provider>
  );
};

export const useCarbon = () => {
  const store = useContext(CarbonContext);

  if (!store) {
    throw new Error("useCarbon must be used within a CarbonProvider");
  }

  return useStore(store);
};
