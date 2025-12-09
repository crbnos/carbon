import type { Database } from "@carbon/database";
import { useInterval } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AuthSession } from "../../types";
import { path } from "../../utils/path";
import { getCarbon } from "./client";

const CarbonContext = createContext<{
  carbon: SupabaseClient<Database> | undefined;
  accessToken: string | undefined;
  realtimeAuthSet: boolean;
}>({ carbon: undefined, accessToken: undefined, realtimeAuthSet: false });

export const CarbonProvider = ({
  children,
  session,
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const { accessToken, expiresAt } = session;
  const initialLoad = useRef(true);

  const carbon = useMemo(() => getCarbon(accessToken), [accessToken]);
  const [realtimeAuthSet, setRealtimeAuthSet] = useState(false);
  const refresh = useFetcher<{}>();

  useEffect(() => {
    const updateRealtimeAuth = async () => {
      if (carbon && accessToken) {
        await carbon.realtime.setAuth(accessToken);
        setRealtimeAuthSet(true);
      }
    };
    updateRealtimeAuth();
  }, [carbon, accessToken, realtimeAuthSet]);

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
    const shouldRefresh = expiresAt - 60 * 10 < Date.now() / 1000;
    const shouldReload = expiresAt < Date.now() / 1000;

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

  const value = useMemo(
    () => ({ carbon, accessToken, realtimeAuthSet }),
    [carbon, accessToken, realtimeAuthSet]
  );

  return (
    <CarbonContext.Provider value={value}>{children}</CarbonContext.Provider>
  );
};

export const useCarbon = () => {
  const context = useContext(CarbonContext);

  if (isBrowser && context === undefined) {
    throw new Error(`useCarbon must be used within a CarbonProvider.`);
  }

  return context;
};
