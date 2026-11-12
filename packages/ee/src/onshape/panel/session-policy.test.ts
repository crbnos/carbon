// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { AuthSession } from "@carbon/auth";
import { describe, expect, it } from "vitest";
import {
  PANEL_SESSION_TTL_SECONDS,
  panelCompanyChoices,
  panelSessionForCompany,
  panelSessionFromAuthSession,
  panelSessionRefusal,
  panelSessionTtlSeconds
} from "./session-policy";

const NOW = 1_780_000_000_000;
const HOUR = 60 * 60 * 1000;

const authSession: AuthSession = {
  accessToken: "access",
  refreshToken: "refresh",
  userId: "user-1",
  companyId: "company-1",
  companyGroupId: "group-1",
  email: "someone@example.com",
  expiresIn: 3600,
  expiresAt: NOW / 1000 + 3600,
  createdAt: NOW - 2 * HOUR,
  lastActiveAt: NOW - 1000,
  mfaVerified: true,
  console: "company-1"
};

describe("panelSessionFromAuthSession", () => {
  it("keeps identity and drops every Supabase token and the console flag", () => {
    const session = panelSessionFromAuthSession(authSession, NOW);
    expect(session).toEqual({
      userId: "user-1",
      companyId: "company-1",
      companyGroupId: "group-1",
      email: "someone@example.com",
      mfaVerified: true,
      createdAt: NOW - 2 * HOUR,
      lastActiveAt: NOW
    });
  });
});

describe("panelSessionForCompany", () => {
  it("moves the company and keeps the sign-in's age and MFA and SSO facts", () => {
    const session = {
      userId: "user-1",
      companyId: "company-1",
      companyGroupId: "group-1",
      email: "someone@example.com",
      mfaVerified: true,
      ssoProviderId: "provider-1",
      createdAt: NOW - 2 * HOUR,
      lastActiveAt: NOW - HOUR
    };
    expect(
      panelSessionForCompany(
        session,
        { companyId: "company-2", companyGroupId: "group-2" },
        NOW
      )
    ).toEqual({
      userId: "user-1",
      companyId: "company-2",
      companyGroupId: "group-2",
      email: "someone@example.com",
      mfaVerified: true,
      ssoProviderId: "provider-1",
      createdAt: NOW - 2 * HOUR,
      lastActiveAt: NOW
    });
  });
});

describe("panelCompanyChoices", () => {
  const membership = (id: string, role = "employee") => ({
    id,
    name: `Company ${id}`,
    companyGroupId: `group-${id}`,
    role
  });
  const choice = (id: string) => ({
    id,
    name: `Company ${id}`,
    companyGroupId: `group-${id}`
  });

  it("offers the employee memberships with the panel connected", () => {
    expect(
      panelCompanyChoices(
        [membership("a"), membership("b"), membership("c")],
        new Set(["a", "c"]),
        "a"
      )
    ).toEqual([choice("a"), choice("c")]);
  });

  it("never offers a company where the user is a customer or supplier", () => {
    expect(
      panelCompanyChoices(
        [
          membership("a"),
          membership("b", "customer"),
          membership("c", "supplier")
        ],
        new Set(["a", "b", "c"]),
        "a"
      )
    ).toEqual([choice("a")]);
  });

  it("keeps the current company listed while it is not connected", () => {
    expect(
      panelCompanyChoices(
        [membership("a"), membership("b")],
        new Set(["b"]),
        "a"
      )
    ).toEqual([choice("a"), choice("b")]);
  });
});

describe("panelSessionRefusal", () => {
  const policy = {
    controlled: true,
    absoluteMaxMs: 12 * HOUR,
    idleLockMs: 15 * 60 * 1000,
    hasVerifiedTotpFactor: false
  };
  const fresh = {
    createdAt: NOW - 2 * HOUR,
    lastActiveAt: NOW - 60 * 1000,
    mfaVerified: true
  };

  it("lets a fresh session continue", () => {
    expect(panelSessionRefusal(fresh, NOW, policy)).toBeNull();
  });

  it("ends a session past the absolute cap in a controlled environment", () => {
    const old = { ...fresh, createdAt: NOW - 13 * HOUR };
    expect(panelSessionRefusal(old, NOW, policy)).toBe("expired");
    expect(
      panelSessionRefusal(old, NOW, { ...policy, controlled: false })
    ).toBeNull();
  });

  it("locks an idle session in a controlled environment", () => {
    const idle = { ...fresh, lastActiveAt: NOW - 20 * 60 * 1000 };
    expect(panelSessionRefusal(idle, NOW, policy)).toBe("idle");
    expect(
      panelSessionRefusal(idle, NOW, { ...policy, controlled: false })
    ).toBeNull();
  });

  it("sends a user who enrolled TOTP after minting through the challenge", () => {
    const unverified = { ...fresh, mfaVerified: undefined };
    expect(
      panelSessionRefusal(unverified, NOW, {
        ...policy,
        controlled: false,
        hasVerifiedTotpFactor: true
      })
    ).toBe("mfa");
    expect(
      panelSessionRefusal(unverified, NOW, { ...policy, controlled: false })
    ).toBeNull();
  });
});

describe("panelSessionTtlSeconds", () => {
  const session = { createdAt: NOW - 2 * HOUR };

  it("is the fixed TTL outside a controlled environment", () => {
    expect(
      panelSessionTtlSeconds(session, NOW, {
        controlled: false,
        absoluteMaxMs: 3 * HOUR
      })
    ).toBe(PANEL_SESSION_TTL_SECONDS);
  });

  it("stops at the ERP session's absolute cap in a controlled environment", () => {
    expect(
      panelSessionTtlSeconds(session, NOW, {
        controlled: true,
        absoluteMaxMs: 3 * HOUR
      })
    ).toBe(3600);
  });

  it("is zero once the cap has passed", () => {
    expect(
      panelSessionTtlSeconds(session, NOW, {
        controlled: true,
        absoluteMaxMs: HOUR
      })
    ).toBe(0);
  });
});
