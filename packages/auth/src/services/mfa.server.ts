import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { oncePerRead } from "@carbon/logger/middleware.server";
import type { AuthSession as SupabaseAuthSession } from "@supabase/supabase-js";
import { getCarbon } from "../lib/supabase";
import { getCarbonServiceRole } from "../lib/supabase/client.server";

const log = getLogger("auth");

// Bounds staleness if an invalidation fails to delete the key — enroll,
// unenroll, and admin reset all delete it explicitly. 1 hour, matching the
// permission claims cache.
const MFA_FACTOR_CACHE_TTL_SECONDS = 3600;

export function getMfaFactorCacheKey(userId: string) {
  return `mfa:factors:${userId}`;
}

export async function invalidateMfaFactorCache(userId: string) {
  try {
    await redis.del(getMfaFactorCacheKey(userId));
  } catch (e) {
    log.error("Failed to invalidate MFA factor cache", { error: e });
  }
}

export type TotpFactor = {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string;
};

/**
 * All TOTP factors on the auth user, via the admin API (no user session
 * needed). Factors belong to the auth user, not to a company.
 */
export async function getTotpFactors(userId: string): Promise<TotpFactor[]> {
  const { data, error } =
    await getCarbonServiceRole().auth.admin.mfa.listFactors({ userId });

  if (error || !data) {
    log.error("Failed to list MFA factors", { userId, error });
    return [];
  }

  return data.factors
    .filter((factor) => factor.factor_type === "totp")
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      status: factor.status,
      createdAt: factor.created_at
    }));
}

/**
 * Whether the user must pass a TOTP challenge. Redis-cached because
 * `requireAuthSession` calls this on every authenticated request; memoized
 * per read request like `getUserClaims` so a page's loaders share one lookup.
 *
 * Fails OPEN (returns false) on lookup errors — a transient Redis/GoTrue blip
 * must not lock every enrolled user out of the app.
 */
export function userHasVerifiedTotpFactor(userId: string): Promise<boolean> {
  return oncePerRead(`mfa:${userId}`, () => loadHasVerifiedTotpFactor(userId));
}

async function loadHasVerifiedTotpFactor(userId: string): Promise<boolean> {
  const cacheKey = getMfaFactorCacheKey(userId);

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === "1";
  } catch (e) {
    log.error("Failed to read MFA factor cache", { error: e });
  }

  const { data, error } =
    await getCarbonServiceRole().auth.admin.mfa.listFactors({ userId });

  if (error || !data) {
    log.error("Failed to list MFA factors", { userId, error });
    return false;
  }

  const hasVerified = data.factors.some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified"
  );

  try {
    await redis.set(
      cacheKey,
      hasVerified ? "1" : "0",
      "EX",
      MFA_FACTOR_CACHE_TTL_SECONDS
    );
  } catch (e) {
    log.error("Failed to cache MFA factor status", { error: e });
  }

  return hasVerified;
}

type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

/**
 * The `supabase.auth.mfa.*` methods read the client's INTERNAL session, not
 * the `Authorization` header override that `getCarbon(accessToken)` uses — so
 * MFA calls need a fresh client seeded via `setSession`.
 */
async function getUserAuthClient(tokens: SessionTokens) {
  const client = getCarbon();
  const { error } = await client.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken
  });

  if (error) {
    log.error("Failed to seed auth client session for MFA", { error });
    return null;
  }

  return client;
}

export type TotpEnrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
};

/**
 * Strip the one character an otpauth issuer may not contain.
 *
 * `otpauth://totp/{issuer}:{account}` uses the colon as its delimiter, and the
 * Key-URI spec forbids it in either field — a company name like "Acme: West"
 * would otherwise split the label and render as a different account entirely.
 */
function sanitizeIssuer(value: string) {
  return value.replace(/[:%]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Start TOTP enrollment for the session user. Returns the QR code (SVG) and
 * plain secret to show once; the factor stays `unverified` until
 * `verifyTotpChallenge` succeeds with a code from the authenticator app.
 */
export async function enrollTotpFactor(
  tokens: SessionTokens,
  friendlyName?: string,
  /** Shown as the account name in the user's authenticator app. */
  issuer?: string
): Promise<TotpEnrollment | null> {
  const client = await getUserAuthClient(tokens);
  if (!client) return null;

  // An abandoned enrollment leaves an `unverified` factor behind, which
  // blocks re-enrolling under the same friendly name — clear them first.
  const { data: existing } = await client.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
    ...(issuer ? { issuer: sanitizeIssuer(issuer) } : {})
  });

  if (error || !data) {
    log.error("Failed to enroll TOTP factor", { error });
    return null;
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri
  };
}

/**
 * Verify a TOTP code against a factor (login challenge, enrollment
 * confirmation, or step-up). On success GoTrue rotates the session to AAL2 —
 * the returned Supabase session's tokens MUST replace the ones in the cookie,
 * or the next refresh fails on the rotated-out refresh token.
 */
export async function verifyTotpChallenge(
  tokens: SessionTokens,
  factorId: string,
  code: string
): Promise<SupabaseAuthSession | null> {
  const client = await getUserAuthClient(tokens);
  if (!client) return null;

  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code
  });

  if (error) return null;

  // Enrollment confirmation flips the factor to `verified`; a plain login
  // challenge changes nothing. The del is cheap either way.
  const { data: userData } = await client.auth.getUser();
  if (userData.user) await invalidateMfaFactorCache(userData.user.id);

  const { data } = await client.auth.getSession();
  return data.session ?? null;
}

/**
 * Remove a TOTP factor, requiring a current code — both as proof of
 * possession and because GoTrue refuses to unenroll a verified factor from
 * an AAL1 session. Returns the rotated session for cookie re-issue.
 */
export async function unenrollTotpFactor(
  tokens: SessionTokens,
  factorId: string,
  code: string
): Promise<{ success: boolean; session: SupabaseAuthSession | null }> {
  const client = await getUserAuthClient(tokens);
  if (!client) return { success: false, session: null };

  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code
  });

  if (verifyError) return { success: false, session: null };

  const { error } = await client.auth.mfa.unenroll({ factorId });

  if (error) {
    log.error("Failed to unenroll TOTP factor", { factorId, error });
    return { success: false, session: null };
  }

  const { data: userData } = await client.auth.getUser();
  if (userData.user) await invalidateMfaFactorCache(userData.user.id);

  const { data } = await client.auth.getSession();
  return { success: true, session: data.session ?? null };
}

/**
 * Admin recovery for a locked-out user (lost authenticator): removes every
 * TOTP factor so the next login is a plain magic link and they can re-enroll.
 * Factors are global to the auth user, so this affects all their companies.
 */
export async function adminDeleteTotpFactors(userId: string): Promise<boolean> {
  const serviceRole = getCarbonServiceRole();
  const factors = await getTotpFactors(userId);

  for (const factor of factors) {
    const { error } = await serviceRole.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId
    });

    if (error) {
      log.error("Failed to delete TOTP factor", { userId, factor, error });
      return false;
    }
  }

  await invalidateMfaFactorCache(userId);
  return true;
}
