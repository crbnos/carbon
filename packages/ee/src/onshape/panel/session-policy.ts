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
  /** Start of the source ERP session; the absolute cap counts from it. */
  createdAt: number;
  lastActiveAt: number;
};

/** Identity only: the cookie session's Supabase tokens are left behind. */
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
 * The same sign-in in another company: `createdAt` and the MFA and SSO facts
 * carry over, so switching never extends the absolute cap or re-opens a gate.
 */
export function panelSessionForCompany(
  session: PanelSession,
  target: { companyId: string; companyGroupId: string },
  now: number
): PanelSession {
  return {
    ...session,
    companyId: target.companyId,
    companyGroupId: target.companyGroupId,
    lastActiveAt: now
  };
}

export type PanelCompanyChoice = {
  id: string;
  name: string;
  companyGroupId: string;
};

/**
 * Employee companies with the panel connected, plus the current one even when
 * it is not, so the selector can always name where the panel is.
 */
export function panelCompanyChoices(
  memberships: Array<{
    id: string | null;
    name: string | null;
    companyGroupId: string | null;
    role: string | null;
  }>,
  connectedCompanyIds: ReadonlySet<string>,
  currentCompanyId: string
): PanelCompanyChoice[] {
  return memberships.flatMap(({ id, name, companyGroupId, role }) =>
    id &&
    role === "employee" &&
    (id === currentCompanyId || connectedCompanyIds.has(id))
      ? [{ id, name: name ?? id, companyGroupId: companyGroupId ?? "" }]
      : []
  );
}

/**
 * The cookie session's policy: in a controlled environment the absolute cap
 * and idle lock; everywhere, a TOTP factor enrolled after minting.
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

/** Controlled environment: the TTL stops at the ERP session's absolute cap. */
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
