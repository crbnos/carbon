// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { AuthSession } from "@carbon/auth";

export const PANEL_SESSION_TTL_SECONDS = 12 * 60 * 60;

export type PanelSession = {
  userId: string;
  companyId: string;
  companyGroupId: string;
  email: string;
  mfaVerified?: boolean;
  ssoProviderId?: string;
  /** When the ERP session it was minted from began: the absolute cap's clock. */
  createdAt: number;
  lastActiveAt: number;
};

/**
 * The identity a panel session carries, taken from the cookie session that
 * minted it. The Supabase tokens are deliberately left behind.
 */
export function panelSessionFromAuthSession(
  authSession: AuthSession,
  now: number
): PanelSession {
  return {
    userId: authSession.userId,
    companyId: authSession.companyId,
    companyGroupId: authSession.companyGroupId,
    email: authSession.email,
    ...(authSession.mfaVerified ? { mfaVerified: true } : {}),
    ...(authSession.ssoProviderId
      ? { ssoProviderId: authSession.ssoProviderId }
      : {}),
    createdAt: authSession.createdAt ?? now,
    lastActiveAt: now
  };
}

/**
 * Why a panel session must sign in again, or null when it may continue. The
 * policy `requireAuthSession` applies to the cookie session:
 *
 * - Controlled environments: the absolute cap and the idle lock, with the same
 *   comparisons as `isSessionExpiredAbsolute` and `isSessionIdleLocked`.
 * - A user who enrolled TOTP after the session was minted must pass it.
 */
export function panelSessionRefusal(
  session: Pick<PanelSession, "createdAt" | "lastActiveAt" | "mfaVerified">,
  now: number,
  policy: {
    controlled: boolean;
    absoluteMaxMs: number;
    idleLockMs: number;
    hasVerifiedTotpFactor: boolean;
  }
): "expired" | "idle" | "mfa" | null {
  if (policy.controlled && now - session.createdAt > policy.absoluteMaxMs) {
    return "expired";
  }
  if (policy.controlled && now - session.lastActiveAt > policy.idleLockMs) {
    return "idle";
  }
  if (!session.mfaVerified && policy.hasVerifiedTotpFactor) return "mfa";
  return null;
}

/**
 * A panel session never outlives the session it was minted from: in a
 * controlled environment its TTL stops at the absolute cap.
 */
export function panelSessionTtlSeconds(
  session: Pick<PanelSession, "createdAt">,
  now: number,
  { controlled, absoluteMaxMs }: { controlled: boolean; absoluteMaxMs: number }
): number {
  if (!controlled) return PANEL_SESSION_TTL_SECONDS;
  const remainingMs = session.createdAt + absoluteMaxMs - now;
  return Math.max(
    0,
    Math.min(PANEL_SESSION_TTL_SECONDS, Math.floor(remainingMs / 1000))
  );
}
