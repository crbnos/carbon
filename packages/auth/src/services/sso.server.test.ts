import type { User, UserIdentity } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// Isolation mocks — sso.server reads env constants and constructs a logger at
// module load; stub them so the pure provider-extraction logic runs alone.
// (Mirrors session-timeout.test.ts.)
vi.mock("@carbon/env", () => ({
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  getAppUrl: () => "http://localhost:3000"
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

const { getSsoProviderIdFromSession, getSsoProviderIdFromUser } = await import(
  "./sso.server"
);

function makeUser(overrides: {
  identityProviders?: string[];
  appMetadataProvider?: string;
}): User {
  const identities = overrides.identityProviders?.map(
    (provider, i) =>
      ({
        id: `identity_${i}`,
        user_id: "user_1",
        identity_id: `identity_${i}`,
        identity_data: {},
        provider,
        created_at: "2026-01-01T00:00:00.000Z",
        last_sign_in_at: "2026-01-01T00:00:00.000Z"
      }) satisfies UserIdentity
  );

  return {
    id: "user_1",
    aud: "authenticated",
    app_metadata:
      overrides.appMetadataProvider !== undefined
        ? { provider: overrides.appMetadataProvider }
        : {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    ...(identities ? { identities } : {})
  } as User;
}

describe("getSsoProviderIdFromUser", () => {
  it('extracts the provider id from an "sso:"-prefixed identity', () => {
    const user = makeUser({ identityProviders: ["sso:abc-123"] });
    expect(getSsoProviderIdFromUser(user)).toBe("abc-123");
  });

  it("finds the sso identity even when other identities come first", () => {
    const user = makeUser({ identityProviders: ["google", "sso:abc-123"] });
    expect(getSsoProviderIdFromUser(user)).toBe("abc-123");
  });

  it("falls back to app_metadata.provider when no identity is sso-prefixed", () => {
    const user = makeUser({ appMetadataProvider: "sso:def-456" });
    expect(getSsoProviderIdFromUser(user)).toBe("def-456");
  });

  it("returns null for google, azure, and email providers", () => {
    for (const provider of ["google", "azure", "email"]) {
      const user = makeUser({
        identityProviders: [provider],
        appMetadataProvider: provider
      });
      expect(getSsoProviderIdFromUser(user)).toBeNull();
    }
  });

  it("returns null when the user has no identities and no provider metadata", () => {
    const user = makeUser({});
    expect(getSsoProviderIdFromUser(user)).toBeNull();
  });
});

// Unsigned-format JWT: decodeJwt only requires three dot-separated segments and
// never checks the signature, so a literal placeholder third segment suffices.
function makeToken(payload: Record<string, unknown>): string {
  const b64url = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

describe("getSsoProviderIdFromSession", () => {
  const ssoUser = makeUser({ identityProviders: ["google", "sso:abc-123"] });

  it("returns the provider id when the session's amr contains sso/saml", () => {
    const token = makeToken({
      amr: [{ method: "sso/saml", timestamp: 1755700000 }]
    });
    expect(getSsoProviderIdFromSession(token, ssoUser)).toBe("abc-123");
  });

  it("returns null for a non-SSO session even when the user HAS an sso identity (linked account)", () => {
    // The bug case: a linked account logging in via Google/magic link must not
    // be classified as SSO just because its identity list carries "sso:".
    const token = makeToken({
      amr: [{ method: "oauth", timestamp: 1755700000 }]
    });
    expect(getSsoProviderIdFromSession(token, ssoUser)).toBeNull();
  });

  it("returns null when the amr claim is missing (fail closed)", () => {
    const token = makeToken({ sub: "user_1" });
    expect(getSsoProviderIdFromSession(token, ssoUser)).toBeNull();
  });

  it("returns null for a malformed token (fail closed)", () => {
    expect(getSsoProviderIdFromSession("not-a-jwt", ssoUser)).toBeNull();
  });

  it("returns null when the session is SAML but the user has no sso identity", () => {
    const token = makeToken({
      amr: [{ method: "sso/saml", timestamp: 1755700000 }]
    });
    const user = makeUser({ identityProviders: ["google"] });
    expect(getSsoProviderIdFromSession(token, user)).toBeNull();
  });
});
