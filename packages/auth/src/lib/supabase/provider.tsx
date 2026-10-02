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
    const expiresAt = session.expiresAt ?? 0;
    const shouldRefresh = expiresAt - 60 * 10 < Date.now() / 1000;
    const shouldReload = expiresAt < Date.now() / 1000;

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
