// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CarbonContext,
  type ICarbonStore,
  setCarbonHmrStore,
  useInterval
} from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type React from "react";
import type { PropsWithChildren } from "react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { StoreApi } from "zustand";
import { createStore, useStore } from "zustand";
import type { AuthSession } from "../../types";
import { path } from "../../utils/path";
import { createCarbonWithAuthGetter } from "./client";

export { useCarbon } from "@carbon/react";

export const CarbonProvider = ({
  children,
  session
}: PropsWithChildren<{
  session: Partial<AuthSession>;
}>) => {
  const store = useRef<StoreApi<ICarbonStore>>(
    null
  ) as React.MutableRefObject<StoreApi<ICarbonStore> | null>;

  if (!store.current) {
    store.current = createStore<ICarbonStore>((set, get) => ({
      accessToken: session.accessToken ?? "",
      isRealtimeAuthSet: false,
      carbon: createCarbonWithAuthGetter(
        store as React.MutableRefObject<StoreApi<{ accessToken: string }>>
      ),
      setAuthToken: async (accessToken) => {
        const { carbon } = get();

        await carbon.realtime.setAuth(accessToken);

        set({ accessToken, isRealtimeAuthSet: true });
      }
    }));
    // Keep a module-level reference for HMR recovery
    setCarbonHmrStore(store.current);
  }

  const { carbon, setAuthToken } = useStore<StoreApi<ICarbonStore>>(
    store.current!
  );

  const initialLoad = useRef(true);
  const refresh = useFetcher<{}>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (session.accessToken) {
      setAuthToken(session.accessToken);
    }
  }, [carbon, setAuthToken, session.accessToken]);

  // The access token the client holds comes from the shell loader, so only the
  // shell is told to re-run after a refresh. Without that, every loader on the
  // page re-ran each time the tab regained focus.
  const refreshIfDue = (canRefresh: boolean) => {
    const expiresAt = session.expiresAt ?? 0;
    const now = Date.now() / 1000;

    if (expiresAt < now) {
      window.location.reload();
      return;
    }

    // refresh ten minutes before expiry
    if (canRefresh && expiresAt - 60 * 10 < now) {
      refresh.submit(null, {
        method: "post",
        action: path.to.refreshSession,
        defaultShouldRevalidate: false
      });
    }
  };

  // Timers are throttled in a background tab, so a tab that comes back may be
  // past the point where the interval below would have refreshed it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshIfDue reads the latest session
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfDue(true);
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
  }, [refresh, session.expiresAt]);

  useInterval(() => {
    refreshIfDue(!initialLoad.current && !!carbon);
    initialLoad.current = false;
  }, 60000); // Check every minute

  return (
    <CarbonContext.Provider value={store.current}>
      {children}
    </CarbonContext.Provider>
  );
};
