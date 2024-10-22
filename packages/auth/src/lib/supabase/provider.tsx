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
}>({ carbon: undefined, accessToken: undefined });

export const CarbonProvider = ({
  children,
  session,
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const { accessToken, refreshToken, expiresAt } = session;
  const initialLoad = useRef(true);
  const authenticatedClientLoaded = useRef(false);
  const [carbon, setCarbon] = useState<SupabaseClient<Database> | undefined>(
    () => {
      // prevents server side initial state
      // init a default anonymous client in browser until we have an auth token
      if (isBrowser) return getCarbon();
    }
  );
  const refresh = useFetcher<{}>();

  useEffect(() => {
    const handleFocus = () => {
      refresh.submit(null, {
        method: "post",
        action: path.to.refreshSession,
      });
    };

    if (isBrowser) {
      window.addEventListener("focus", handleFocus);
    }

    return () => {
      if (isBrowser) {
        window.removeEventListener("focus", handleFocus);
      }
    };
  }, [refresh]);

  useInterval(() => {
    // refresh ten minutes before expiry
    const shouldRefresh = expiresAt - 60 * 10 < Date.now() / 1000;

    if (!initialLoad.current && shouldRefresh) {
      refresh.submit(null, {
        method: "post",
        action: path.to.refreshSession,
      });
    }

    initialLoad.current = false;
  }, 15000);

  if (isBrowser && accessToken && !authenticatedClientLoaded.current) {
    // recreate a carbon client to force provider's consumer to rerender
    setCarbon(getCarbon(accessToken));
    authenticatedClientLoaded.current = true;
  }

  useEffect(() => {
    if (!carbon || !accessToken || !refreshToken) return;

    carbon.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }, [accessToken, refreshToken, carbon]);

  const value = useMemo(() => ({ carbon, accessToken }), [carbon, accessToken]);

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
