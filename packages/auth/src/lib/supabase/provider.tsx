import type { Database } from "@carbon/database";
import { useInterval } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import type { AuthSession } from "../../types";
import { path } from "../../utils/path";
import { getCarbon } from "./client";
import { setAuthSession } from "../../services/session.server";
import { set } from "zod/v4";

interface ICarbonState {
  carbon: SupabaseClient<Database>;
  accessToken: string;
  isRealtimeAuthSet: boolean;
}

interface ICarbonStoreActions {
  setAuthToken: (accessToken: string, refreshToken: string) => Promise<void>;
}

type CarbonStore = ICarbonState & ICarbonStoreActions;

export const useCarbon = create<CarbonStore>((set, get) => ({
  accessToken: "",
  isRealtimeAuthSet: false,
  carbon: getCarbon(),
  setAuthToken: async (accessToken, refreshToken) => {
    const { carbon, isRealtimeAuthSet } = get();
    let client = carbon;

    if (!isRealtimeAuthSet) {
      client = getCarbon(accessToken);
      return set({ accessToken, isRealtimeAuthSet: true, carbon: client });
    }

    await carbon.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    await carbon.realtime.setAuth(accessToken);

    set({ accessToken, isRealtimeAuthSet: true });
  },
}));

export const CarbonProvider = ({
  children,
  session,
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const { carbon, setAuthToken } = useCarbon();
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

  return <>{children}</>;
};
