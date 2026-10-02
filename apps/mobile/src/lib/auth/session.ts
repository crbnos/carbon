// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AuthSessionResponse } from "@carbon/mes-core";
import { LargeSecureStore } from "./LargeSecureStore";

/**
 * The Supabase tokens for ONE instance. Keyed by instance id because a company
 * id is not unique across Carbons — a staging server restored from a production
 * backup has the same ids — so only the instance can keep two sessions apart.
 */
const store = new LargeSecureStore();

const sessionKey = (instanceId: string) => `session.${instanceId}`;

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export async function loadSession(
  instanceId: string
): Promise<StoredSession | null> {
  const raw = await store.getItem(sessionKey(instanceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.accessToken && parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSession(
  instanceId: string,
  session: AuthSessionResponse | StoredSession
) {
  const value: StoredSession = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt
  };
  await store.setItem(sessionKey(instanceId), JSON.stringify(value));
}

export async function clearSession(instanceId: string) {
  await store.removeItem(sessionKey(instanceId));
}
