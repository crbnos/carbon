// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

export interface ICarbonStore {
  carbon: SupabaseClient<Database>;
  accessToken: string;
  isRealtimeAuthSet: boolean;
  setAuthToken: (accessToken: string) => Promise<void>;
}

export const CarbonContext = createContext<StoreApi<ICarbonStore> | null>(null);

let __hmrStore: StoreApi<ICarbonStore> | null = null;

export const setCarbonHmrStore = (store: StoreApi<ICarbonStore>) => {
  __hmrStore = store;
};

export const useCarbon = () => {
  let store = useContext(CarbonContext);

  if (!store && __hmrStore) {
    store = __hmrStore;
  }

  if (!store) {
    throw new Error("useCarbon must be used within a CarbonProvider");
  }

  return useStore(store);
};
