/**
 * Refresh this many seconds BEFORE the recorded expiry. Onshape access tokens
 * live about an hour; a two-minute margin covers a slow request, a clock
 * difference between Carbon and Onshape, and a token that would otherwise
 * expire between the check and the call.
 */
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
 * What a refresh does with the pair stored now. Another caller may have
 * refreshed since this request loaded its copy: a live token it stored is
 * adopted, and otherwise the stored refresh token is spent, because Onshape
 * rotates refresh tokens and the copy's is usually dead by then. The request's
 * copy is the fallback only when the row could not be read.
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
