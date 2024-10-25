import type { Database } from "@carbon/database";
import { useInterval, useMount } from "@carbon/react";
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

  const [carbon, setCarbon] = useState<SupabaseClient<Database> | undefined>(
    undefined
  );
  const refresh = useFetcher<{}>();

  useEffect(() => {
    if (!carbon || !accessToken || !refreshToken) return;

    carbon.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }, [carbon, accessToken, refreshToken]);

  useMount(() => {
    const supabase = getCarbon(accessToken);
    setCarbon(supabase);

    // Enable auto-refresh of the session
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) {
        refresh.submit(null, {
          method: "post",
          action: path.to.refreshSession,
        });
      }
    });
  });

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
    // refresh five minutes before expiry
    const shouldRefresh = expiresAt - 60 * 5 < Date.now() / 1000;

    if (!initialLoad.current && shouldRefresh && carbon) {
      carbon.auth.refreshSession().then(({ data, error }) => {
        if (!error && data.session) {
          refresh.submit(null, {
            method: "post",
            action: path.to.refreshSession,
          });
        }
      });
    }

    initialLoad.current = false;
  }, 60000); // Check every minute

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
