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

import type { AuthSession } from "~/services/auth";
import { path } from "~/utils/path";
import { getSupabase } from "./client";

const SupabaseContext = createContext<{
  supabase: SupabaseClient<Database> | undefined;
  accessToken: string | undefined;
}>({ supabase: undefined, accessToken: undefined });

export const SupabaseProvider = ({
  children,
  session,
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const { accessToken, refreshToken, expiresIn, expiresAt } = session;
  const [browserSessionExpiresAt, setBrowserSessionExpiresAt] = useState<
    number | undefined
  >();
  const initialLoad = useRef(true);
  const [supabase, setSupabaseClient] = useState<SupabaseClient | undefined>(
    () => {
      // prevents server side initial state
      // init a default anonymous client in browser until we have an auth token
      if (isBrowser) return getSupabase();
    }
  );
  const refresh = useFetcher<{}>();

  useInterval(() => {
    if (!initialLoad.current && expiresIn) {
      refresh.submit(null, {
        method: "post",
        action: path.to.refreshSession,
      });
    }

    initialLoad.current = false;
  }, expiresIn);

  if (isBrowser && expiresAt !== browserSessionExpiresAt && accessToken) {
    // recreate a supabase client to force provider's consumer to rerender
    setSupabaseClient(getSupabase(accessToken));
    setBrowserSessionExpiresAt(expiresAt);
  }

  useEffect(() => {
    if (!supabase || !accessToken || !refreshToken) return;

    supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }, [accessToken, refreshToken, supabase]);

  const value = useMemo(
    () => ({ supabase, accessToken }),
    [supabase, accessToken]
  );

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
};

export const useSupabase = () => {
  const context = useContext(SupabaseContext);

  if (isBrowser && context === undefined) {
    throw new Error(`useSupabase must be used within a SupabaseProvider.`);
  }

  return context;
};
