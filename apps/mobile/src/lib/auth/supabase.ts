// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MeInstance } from "@carbon/mes-core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { LargeSecureStore } from "./LargeSecureStore";

/**
 * The supabase-js client, created only AFTER `/me` has answered — its url and
 * anon key arrive there, because nothing at a public path describes a Carbon.
 *
 * Used for exactly three things, all as the signed-in user under RLS:
 * realtime refetch triggers, step-record photo uploads, and the simple lookups
 * whose tables only require an employee of the company. Every WRITE goes
 * through `/api/v1` instead, so the backflush, cost posting, genealogy and
 * floor gates that live in the server's command code cannot be skipped.
 */
let client: SupabaseClient | null = null;
let clientKey: string | null = null;
let appStateSubscription: { remove: () => void } | null = null;

export function getSupabase(
  instanceId: string,
  instance: MeInstance
): SupabaseClient {
  const key = `${instanceId}:${instance.supabaseUrl}`;
  if (client && clientKey === key) return client;

  client = createClient(instance.supabaseUrl, instance.supabaseAnonKey, {
    auth: {
      storage: new LargeSecureStore(),
      storageKey: `supabase.${instanceId}`,
      autoRefreshToken: true,
      persistSession: true,
      // There is no browser URL to read a session out of on a device.
      detectSessionInUrl: false
    }
  });
  clientKey = key;

  // Refreshing while backgrounded burns battery and can race the OS suspending
  // the socket; Supabase's own React Native guidance is to pause it.
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") client?.auth.startAutoRefresh();
    else client?.auth.stopAutoRefresh();
  });

  return client;
}

export function resetSupabase() {
  appStateSubscription?.remove();
  appStateSubscription = null;
  client = null;
  clientKey = null;
}
