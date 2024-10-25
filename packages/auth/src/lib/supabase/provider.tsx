import type { Database } from "@carbon/database";
import { useInterval } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

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
  const { accessToken, expiresAt } = session;
  const initialLoad = useRef(true);

  const carbon = useMemo(() => getCarbon(accessToken), [accessToken]);
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
