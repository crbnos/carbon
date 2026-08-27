import type { User, UserIdentity } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// Isolation mocks — the SSO module reads env constants and constructs a logger
// at module load; stub them so the pure logic runs alone. `enabled` makes the
// isSsoEnabled() gate controllable per test (CarbonEdition stays Enterprise;
// the AUTH_PROVIDERS half of the gate flips).
const enabled = { sso: true };

vi.mock("@carbon/env", async () => {
  const { Edition } =
    await vi.importActual<typeof import("@carbon/utils")>("@carbon/utils");
  return {
    SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    getAppUrl: () => "http://localhost:3000",
    CarbonEdition: Edition.Enterprise,
    isAuthProviderEnabled: (provider: string) =>
      provider === "sso" && enabled.sso
  };
});

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

// Stub the DNS challenge so no test resolves real TXT records.
const { checkDomainVerificationMock } = vi.hoisted(() => ({
  checkDomainVerificationMock: vi.fn()
}));
vi.mock("./verification.server", () => ({
  generateVerificationToken: () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  checkDomainVerification: checkDomainVerificationMock
}));

const { getSsoProviderIdFromSession, getSsoProviderIdFromUser } = await import(
  "./session.server"
);
const {
  addSsoDomain,
  getSsoAwareInviteLink,
  getSsoConnection,
  isSsoRequiredForEmail,
  upsertSsoConnection,
  verifySsoDomain
} = await import("./connections.server");

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

// Chainable supabase-client stub: every builder method records its args and
// returns the builder; maybeSingle resolves the canned result. Enough surface
// for the ssoConnection lookups without a real PostgREST client.
function makeSsoClient(result: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown[][]> = {};
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  const builder: any = {};
  for (const method of ["from", "select", "contains", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  return { client: builder, calls };
}

describe("getSsoAwareInviteLink", () => {
  it("routes a covered-domain invite to the login page with the email prefilled", async () => {
    const { client } = makeSsoClient({
      data: { id: "sso_1", companyId: "company_1" },
      error: null
    });
    await expect(
      getSsoAwareInviteLink(client, "jane@acme.com", "CODE123", "company_1")
    ).resolves.toBe("http://localhost:3000/login?email=jane%40acme.com");
  });

  it("routes an uncovered-domain invite to the ordinary code link", async () => {
    const { client } = makeSsoClient({ data: null, error: null });
    await expect(
      getSsoAwareInviteLink(client, "jane@other.com", "CODE123", "company_1")
    ).resolves.toBe("http://localhost:3000/invite/CODE123");
  });

  it("uses the code link when ANOTHER company's connection covers the domain", async () => {
    // The SSO callback consumes invites scoped to the connection's own
    // company, so routing this company's invite through the other tenant's
    // SSO login would strand it.
    const { client } = makeSsoClient({
      data: { id: "sso_1", companyId: "company_other" },
      error: null
    });
    await expect(
      getSsoAwareInviteLink(client, "jane@acme.com", "CODE123", "company_1")
    ).resolves.toBe("http://localhost:3000/invite/CODE123");
  });

  it("URL-encodes plus-addressed emails in the login link", async () => {
    const { client } = makeSsoClient({
      data: { id: "sso_1", companyId: "company_1" },
      error: null
    });
    await expect(
      getSsoAwareInviteLink(
        client,
        "jane+test@acme.com",
        "CODE123",
        "company_1"
      )
    ).resolves.toBe("http://localhost:3000/login?email=jane%2Btest%40acme.com");
  });

  it("falls back to the code link without querying when the email has no domain", async () => {
    const { client, calls } = makeSsoClient({
      data: { id: "sso_1", companyId: "company_1" },
      error: null
    });
    await expect(
      getSsoAwareInviteLink(client, "jane", "CODE123", "company_1")
    ).resolves.toBe("http://localhost:3000/invite/CODE123");
    expect(calls.from).toBeUndefined();
  });
});

describe("isSsoRequiredForEmail", () => {
  it("is true only when the covering connection has requireSso on", async () => {
    const { client } = makeSsoClient({
      data: { requireSso: true },
      error: null
    });
    await expect(isSsoRequiredForEmail(client, "jane@acme.com")).resolves.toBe(
      true
    );
  });

  it("is false for a covered connection with requireSso off", async () => {
    const { client } = makeSsoClient({
      data: { requireSso: false },
      error: null
    });
    await expect(isSsoRequiredForEmail(client, "jane@acme.com")).resolves.toBe(
      false
    );
  });

  it("is false when no active connection covers the domain", async () => {
    const { client } = makeSsoClient({ data: null, error: null });
    await expect(isSsoRequiredForEmail(client, "jane@acme.com")).resolves.toBe(
      false
    );
  });

  it("fails open to false on a lookup error (the login refusal must not brick non-SSO tenants)", async () => {
    const { client } = makeSsoClient({
      data: null,
      error: { message: "boom" }
    });
    await expect(isSsoRequiredForEmail(client, "jane@acme.com")).resolves.toBe(
      false
    );
  });

  it("is false without querying when the email has no domain", async () => {
    const { client, calls } = makeSsoClient({
      data: { requireSso: true },
      error: null
    });
    await expect(isSsoRequiredForEmail(client, "jane")).resolves.toBe(false);
    expect(calls.from).toBeUndefined();
  });

  it("matches the domain case-insensitively (lowercased before the lookup)", async () => {
    const { client, calls } = makeSsoClient({
      data: { requireSso: true },
      error: null
    });
    await expect(isSsoRequiredForEmail(client, "Jane@ACME.com")).resolves.toBe(
      true
    );
    expect(calls.eq).toContainEqual(["ssoDomain.domain", "acme.com"]);
  });

  it("only matches VERIFIED domain claims (pending claims must not enforce)", async () => {
    const { client, calls } = makeSsoClient({
      data: { requireSso: true },
      error: null
    });
    await expect(isSsoRequiredForEmail(client, "jane@acme.com")).resolves.toBe(
      true
    );
    expect(calls.eq).toContainEqual(["ssoDomain.status", "verified"]);
  });
});

describe("getSsoConnection domains mapping", () => {
  it("attaches VERIFIED domains only and strips the embed", async () => {
    const { client } = makeSsoClient({
      data: {
        id: "sso_1",
        companyId: "company_1",
        ssoDomain: [
          { domain: "acme.com", status: "verified" },
          { domain: "pending.com", status: "pending" }
        ]
      },
      error: null
    });
    const result = await getSsoConnection(client, "company_1");
    expect(result.data?.domains).toEqual(["acme.com"]);
    expect(result.data).not.toHaveProperty("ssoDomain");
  });

  it("attaches an empty domains array when the connection has no claims", async () => {
    const { client } = makeSsoClient({
      data: { id: "sso_1", companyId: "company_1" },
      error: null
    });
    const result = await getSsoConnection(client, "company_1");
    expect(result.data?.domains).toEqual([]);
  });
});

// Exclusivity attaches to verification, not the claim — pending rows never
// conflict across companies, so squatting is impossible.
describe("ssoDomain claim exclusivity", () => {
  const activeConnection = {
    data: {
      id: "conn_1",
      companyId: "c1",
      providerId: "p1",
      metadataUrl: null,
      metadataXml: null,
      active: true
    },
    error: null
  };

  const chainFor = (result: { data: unknown; error: unknown }) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      maybeSingle: async () => result
    };
    return chain;
  };

  it("refuses the company's OWN duplicate before inserting (pending claims never conflict across companies)", async () => {
    const insertSpy = vi.fn();
    const client = {
      from: (table: string) => {
        if (table === "ssoConnection") return chainFor(activeConnection);
        return {
          ...chainFor({ data: { id: "dom_1" }, error: null }),
          insert: insertSpy
        };
      }
    } as never;

    const result = await addSsoDomain(client, {
      companyId: "c1",
      domain: "Acme.com",
      userId: "user_1"
    });
    expect(result.data).toBeNull();
    expect(result.error).toContain("already been added");
    expect(result.error).not.toContain("another company");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("refuses verification when another company already verified the domain — with a GENERIC message (no oracle) and no DNS lookup", async () => {
    checkDomainVerificationMock.mockClear();
    let ssoDomainCall = 0;
    const client = {
      from: (table: string) => {
        if (table === "ssoConnection") return chainFor(activeConnection);
        ssoDomainCall += 1;
        return chainFor(
          ssoDomainCall === 1
            ? {
                data: {
                  id: "dom_1",
                  companyId: "c1",
                  connectionId: "conn_1",
                  domain: "acme.com",
                  verificationToken: "tok",
                  status: "pending"
                },
                error: null
              }
            : { data: { companyId: "c2" }, error: null }
        );
      }
    } as never;

    const result = await verifySsoDomain(client, {
      companyId: "c1",
      domainId: "dom_1",
      userId: "user_1"
    });
    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to verify domain");
    expect(result.error).not.toContain("another company");
    expect(checkDomainVerificationMock).not.toHaveBeenCalled();
  });
});

describe("isSsoEnabled gate (AUTH_PROVIDERS half toggled off)", () => {
  it("makes the lookups answer 'no connection' WITHOUT querying, and refuses admin mutations", async () => {
    enabled.sso = false;
    try {
      const { client, calls } = makeSsoClient({
        data: { requireSso: true },
        error: null
      });
      await expect(
        isSsoRequiredForEmail(client, "jane@acme.com")
      ).resolves.toBe(false);
      await expect(
        getSsoAwareInviteLink(client, "jane@acme.com", "CODE123", "c1")
      ).resolves.toBe("http://localhost:3000/invite/CODE123");
      expect(calls.from).toBeUndefined();

      const upsert = await upsertSsoConnection(client, {
        companyId: "c1",
        metadataUrl: "https://idp.example.com/metadata",
        userId: "user_1"
      });
      expect(upsert.error).toBe(
        "Single sign-on requires Carbon Enterprise edition"
      );
      expect(calls.from).toBeUndefined();
    } finally {
      enabled.sso = true;
    }
  });
});
