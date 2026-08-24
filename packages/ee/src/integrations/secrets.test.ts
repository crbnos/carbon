import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  deletePath,
  getPath,
  IntegrationSecretUnavailableError,
  persistIntegrationSecrets,
  resolveIntegrationSecrets,
  SECRET_KEYS,
  setPath,
  splitSecrets
} from "./secrets";

describe("dot-path helpers", () => {
  it("gets, sets, and deletes nested paths", () => {
    const obj: Record<string, unknown> = { a: { b: { c: 1 } } };
    expect(getPath(obj, "a.b.c")).toBe(1);
    expect(getPath(obj, "a.x.y")).toBeUndefined();
    setPath(obj, "a.b.d", 2);
    expect(getPath(obj, "a.b.d")).toBe(2);
    setPath(obj, "p.q", 3); // creates intermediates
    expect(getPath(obj, "p.q")).toBe(3);
    deletePath(obj, "a.b.c");
    expect(getPath(obj, "a.b.c")).toBeUndefined();
    expect(getPath(obj, "a.b.d")).toBe(2); // sibling untouched
  });
});

describe("splitSecrets", () => {
  it("splits nested accounting credentials, keeping non-secret providerMetadata", () => {
    const metadata = {
      credentials: {
        type: "oauth2",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: "2026-01-01",
        providerMetadata: { tenantId: "T1", tenantName: "Acme" }
      },
      syncConfig: { direction: "two-way" }
    };
    const { config, secrets } = splitSecrets("xero", metadata);
    // secrets extracted
    expect(secrets).toEqual({
      "credentials.accessToken": "at",
      "credentials.refreshToken": "rt"
    });
    // config keeps everything non-secret, incl. the tenant mirror
    expect(getPath(config, "credentials.accessToken")).toBeUndefined();
    expect(getPath(config, "credentials.refreshToken")).toBeUndefined();
    expect(getPath(config, "credentials.providerMetadata.tenantId")).toBe("T1");
    expect(getPath(config, "credentials.expiresAt")).toBe("2026-01-01");
    expect(getPath(config, "syncConfig.direction")).toBe("two-way");
    // original not mutated
    expect(metadata.credentials.accessToken).toBe("at");
  });

  it("splits a flat linear apiKey", () => {
    const { config, secrets } = splitSecrets("linear", {
      apiKey: "lin_123",
      teamId: "team"
    });
    expect(secrets).toEqual({ apiKey: "lin_123" });
    expect(config).toEqual({ teamId: "team" });
  });

  it("handles email's two variants (Resend apiKey / SMTP password), omitting the absent one", () => {
    // Resend variant: only apiKey present
    expect(
      splitSecrets("email", { provider: "resend", apiKey: "re_1" })
    ).toEqual({
      config: { provider: "resend" },
      secrets: { apiKey: "re_1" }
    });
    // SMTP variant: only password present
    expect(
      splitSecrets("email", {
        provider: "smtp",
        host: "mail.example.com",
        username: "u",
        password: "p"
      })
    ).toEqual({
      config: { provider: "smtp", host: "mail.example.com", username: "u" },
      secrets: { password: "p" }
    });
  });

  it("anti-overwrite: an empty secret value is not persisted (D4a)", () => {
    // An untouched masked field submits "" — it must not clobber the vault.
    const { config, secrets } = splitSecrets("linear", {
      apiKey: "",
      teamId: "team"
    });
    expect(secrets).toEqual({}); // nothing to write -> vault unchanged
    expect(config).toEqual({ teamId: "team" }); // and no empty secret in the column
  });

  it("omits absent secret paths and passes through unknown integrations", () => {
    expect(splitSecrets("linear", { teamId: "team" })).toEqual({
      config: { teamId: "team" },
      secrets: {}
    });
    expect(splitSecrets("unknown-x", { a: 1 })).toEqual({
      config: { a: 1 },
      secrets: {}
    });
  });
});

// Minimal service-client mock: rpc + from().update()/select() chains.
function mockClient(opts: {
  rpc?: (fn: string, args: unknown) => { data: unknown; error: unknown };
  secretRef?: string | null;
}) {
  const rpc = vi.fn((fn: string, args: unknown) =>
    Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: null, error: null })
  );
  const update = vi.fn(() => {
    const chain = { eq: vi.fn(() => chain), then: undefined } as never;
    // Support .update().eq().eq() resolving to { error: null }
    const eqable = {
      eq: vi.fn(() => eqable)
    } as unknown as { eq: unknown } & Promise<{ error: null }>;
    (eqable as unknown as Promise<{ error: null }>).then = (res: never) =>
      Promise.resolve({ error: null }).then(res);
    return eqable;
  });
  const select = vi.fn(() => {
    const chain = {
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: { secretRef: opts.secretRef ?? null },
          error: null
        })
      )
    };
    return chain;
  });
  const from = vi.fn(() => ({ update, select }));
  return { rpc, from } as never;
}

describe("resolveIntegrationSecrets", () => {
  it("returns metadata as-is for an integration with no secret keys", async () => {
    const client = mockClient({});
    const metadata = { active: true, someConfig: "x" };
    // exchange-rates-v1 has no SECRET_KEYS entry — nothing to resolve.
    const merged = await resolveIntegrationSecrets(
      client,
      "co",
      "exchange-rates-v1",
      metadata,
      null
    );
    expect(merged).toEqual(metadata);
  });

  it("fails closed when a secret-bearing integration has no secretRef", async () => {
    const client = mockClient({});
    await expect(
      resolveIntegrationSecrets(client, "co", "xero", {}, null)
    ).rejects.toBeInstanceOf(IntegrationSecretUnavailableError);
  });

  it("merges the vaulted bag back into metadata when secretRef is set", async () => {
    const client = mockClient({
      rpc: () => ({
        data: {
          "credentials.accessToken": "vaulted-at",
          "credentials.refreshToken": "vaulted-rt"
        },
        error: null
      })
    });
    const metadata = {
      credentials: { type: "oauth2", providerMetadata: { tenantId: "T1" } }
    };
    const merged = await resolveIntegrationSecrets(
      client,
      "co",
      "xero",
      metadata,
      "vault-ref-1"
    );
    expect(getPath(merged, "credentials.accessToken")).toBe("vaulted-at");
    expect(getPath(merged, "credentials.refreshToken")).toBe("vaulted-rt");
    expect(getPath(merged, "credentials.providerMetadata.tenantId")).toBe("T1");
  });

  it("throws (fail-closed) when secretRef is set but the vault returns null", async () => {
    const client = mockClient({ rpc: () => ({ data: null, error: null }) });
    await expect(
      resolveIntegrationSecrets(client, "co", "xero", {}, "vault-ref-1")
    ).rejects.toBeInstanceOf(IntegrationSecretUnavailableError);
  });
});

describe("persistIntegrationSecrets", () => {
  it("upserts the secret bag and writes stripped config to the column", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: "vault-id", error: null }));
    // The .update().eq().eq() chain is thenable and resolves to { error: null }.
    const awaitableEq: never = Object.assign(Promise.resolve({ error: null }), {
      eq: vi.fn(() => awaitableEq)
    }) as never;
    const from = vi.fn(() => ({ update: vi.fn(() => awaitableEq) }));
    const client = { rpc, from } as never;

    const config = await persistIntegrationSecrets(client, "co", "linear", {
      apiKey: "secret",
      teamId: "team"
    });
    expect(rpc).toHaveBeenCalledWith(
      "upsert_integration_secret",
      expect.objectContaining({
        p_company_id: "co",
        p_integration_id: "linear",
        p_secret: { apiKey: "secret" }
      })
    );
    expect(config).toEqual({ teamId: "team" });
  });
});

describe("SECRET_KEYS covers every integration that stores a credential", () => {
  // The failure this guards is silent and total: splitSecrets iterates
  // `SECRET_KEYS[integrationId] ?? []`, so an id missing from the map has its
  // secrets written to the plaintext `metadata` column — and
  // resolveIntegrationSecrets reads them straight back, so the integration works
  // perfectly while leaking. Nothing throws and no other test fails.
  //
  // The registry itself cannot be imported here (packages/ee/src/index.ts pulls
  // in modules that require INNGEST_SIGNING_KEY and the rest of the server env),
  // so the ids are read from the config sources instead.
  const configDir = join(__dirname, "..");
  const ids = readdirSync(configDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const config = join(configDir, entry.name, "config.tsx");
      if (!existsSync(config)) return [];
      // Top-level `id:` only — two-space indent. Action ids inside `actions: []`
      // are nested deeper and must not be picked up.
      return [
        ...readFileSync(config, "utf8").matchAll(/^ {2}id: "([a-z0-9-]+)"/gm)
      ].map((match) => match[1]!);
    });

  /**
   * Integrations that genuinely hold no secret in `metadata`. Each needs a
   * reason, so adding one here is a deliberate act rather than a way to silence
   * the test.
   */
  const NO_SECRETS: Record<string, string> = {
    "exchange-rates-v1": "apiKey is env-based, never in metadata",
    "stripe-connect":
      "holds only a Stripe account id; Stripe owns the credential",
    radan: "file-drop integration, no credential",
    sage: "not yet implemented — no credential stored"
  };

  it("finds the integration configs", () => {
    // Guards the scan itself: if the layout changes and this returns nothing,
    // every assertion below would pass vacuously.
    expect(ids.length).toBeGreaterThanOrEqual(13);
    expect(ids).toContain("onshape");
  });

  it("classifies every integration as secret-bearing or explicitly not", () => {
    const unclassified = ids.filter(
      (id) => !(id in SECRET_KEYS) && !(id in NO_SECRETS)
    );
    expect(unclassified).toEqual([]);
  });

  it("classifies the Onshape webhook signing secret, not just its OAuth grant", () => {
    // The signing secret is a shared HMAC key: possession lets anyone forge a
    // delivery the receiver accepts. It is easy to leave in plaintext because
    // nothing fails if you do, so pin it.
    expect(SECRET_KEYS.onshape).toEqual([
      "credentials.accessToken",
      "credentials.refreshToken",
      "webhookSigningSecret"
    ]);
  });

  it("never lists a refresh token without its access token", () => {
    for (const [id, paths] of Object.entries(SECRET_KEYS)) {
      if (paths.includes("credentials.refreshToken")) {
        expect(paths, id).toContain("credentials.accessToken");
      }
    }
  });

  it("actually strips all three Onshape secrets from the column", () => {
    const { config, secrets } = splitSecrets("onshape", {
      baseUrl: "https://cad.onshape.com",
      credentials: {
        type: "oauth2",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: "2026-08-24T00:00:00.000Z"
      },
      webhookSigningSecret: "shhh",
      attachAssetsOnRelease: true
    });

    expect(secrets).toEqual({
      "credentials.accessToken": "at",
      "credentials.refreshToken": "rt",
      webhookSigningSecret: "shhh"
    });
    expect(config).toEqual({
      baseUrl: "https://cad.onshape.com",
      credentials: { type: "oauth2", expiresAt: "2026-08-24T00:00:00.000Z" },
      attachAssetsOnRelease: true
    });
  });
});
