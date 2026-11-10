// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Refresh early to cover clock skew and a token expiring mid-call.
const REFRESH_MARGIN_SECONDS = 120;

export type StoredOnshapeCredentials = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
};

export function isFresh(
  credentials: StoredOnshapeCredentials | null | undefined,
  now: number
) {
  const expiresAt = credentials?.expiresAt
    ? new Date(credentials.expiresAt).getTime()
    : 0;
  return expiresAt - REFRESH_MARGIN_SECONDS * 1000 > now;
}

/**
 * Adopts a live token another caller stored, else exchanges the stored refresh
 * token: Onshape rotates them, so this request's copy is usually dead. The
 * request's copy is used only when the row could not be read.
 */
export function resolveOnshapeRefresh(
  stored: StoredOnshapeCredentials | null,
  requestCopy: StoredOnshapeCredentials,
  heldAccessToken: string,
  now: number
):
  | { action: "adopt"; credentials: StoredOnshapeCredentials }
  | { action: "exchange"; credentials: StoredOnshapeCredentials } {
  if (
    stored?.accessToken &&
    stored.accessToken !== heldAccessToken &&
    isFresh(stored, now)
  ) {
    return { action: "adopt", credentials: stored };
  }
  return { action: "exchange", credentials: stored ?? requestCopy };
}
