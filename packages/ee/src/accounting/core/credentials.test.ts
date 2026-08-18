import { describe, expect, it } from "vitest";
import {
  ProviderIntegrationMetadataSchema,
  parseStoredCredentials
} from "./models";

describe("parseStoredCredentials", () => {
  it("maps the legacy flat oauth2 shape into providerMetadata", () => {
    const legacy = {
      type: "oauth2",
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: "2026-07-09T00:00:00.000Z",
      tenantId: "tenant-1",
      tenantName: "Acme Inc"
    };

    const parsed = parseStoredCredentials(legacy);

    expect(parsed).toEqual({
      type: "oauth2",
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: "2026-07-09T00:00:00.000Z",
      providerMetadata: {
        tenantId: "tenant-1",
        tenantName: "Acme Inc"
      }
    });
  });

  it("maps a legacy shape with only tenantId", () => {
    const parsed = parseStoredCredentials({
      type: "oauth2",
      accessToken: "at-123",
      tenantId: "tenant-1"
    });

    expect(parsed).toEqual({
      type: "oauth2",
      accessToken: "at-123",
      providerMetadata: { tenantId: "tenant-1" }
    });
  });

  it("round-trips the new oauth2 shape unchanged", () => {
    const credentials = {
      type: "oauth2",
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: "2026-07-09T00:00:00.000Z",
      scope: ["accounting.transactions"],
      providerMetadata: {
        tenantId: "tenant-1",
        tenantName: "Acme Inc"
      }
    };

    const parsed = parseStoredCredentials(credentials);

    expect(parsed).toEqual(credentials);
    // Parsing its own output is stable
    expect(parseStoredCredentials(parsed)).toEqual(credentials);
  });

  it("parses apiKey credentials", () => {
    const credentials = {
      type: "apiKey",
      apiKey: "rk_live_abc123",
      environment: "sandbox",
      providerMetadata: { subsidiaryId: "11111111-1111-1111-1111-111111111111" }
    };

    expect(parseStoredCredentials(credentials)).toEqual(credentials);
  });

  it("defaults apiKey environment to production", () => {
    const parsed = parseStoredCredentials({
      type: "apiKey",
      apiKey: "rk_live_abc123"
    });

    expect(parsed).toEqual({
      type: "apiKey",
      apiKey: "rk_live_abc123",
      environment: "production"
    });
  });

  it("rejects an apiKey credential with an empty key", () => {
    expect(() =>
      parseStoredCredentials({ type: "apiKey", apiKey: "" })
    ).toThrow();
  });

  it("parses bridge credentials", () => {
    const credentials = {
      type: "bridge",
      vendor: "conductor",
      externalConnectionId: "end-user-1"
    };

    expect(parseStoredCredentials(credentials)).toEqual(credentials);
  });

  it("throws on garbage input", () => {
    expect(() => parseStoredCredentials(null)).toThrow();
    expect(() => parseStoredCredentials("nope")).toThrow();
    expect(() => parseStoredCredentials({})).toThrow();
    expect(() => parseStoredCredentials({ type: "oauth2" })).toThrow();
    expect(() => parseStoredCredentials({ type: "carrier-pigeon" })).toThrow();
  });
});

describe("ProviderIntegrationMetadataSchema", () => {
  it("upgrades legacy credentials stored on integration metadata", () => {
    const metadata = {
      syncConfig: { entities: { customer: { enabled: true } } },
      credentials: {
        type: "oauth2",
        accessToken: "at-123",
        refreshToken: "rt-456",
        tenantId: "tenant-1",
        tenantName: "Acme Inc"
      }
    };

    const parsed = ProviderIntegrationMetadataSchema.parse(metadata);

    expect(parsed.credentials).toEqual({
      type: "oauth2",
      accessToken: "at-123",
      refreshToken: "rt-456",
      providerMetadata: {
        tenantId: "tenant-1",
        tenantName: "Acme Inc"
      }
    });
  });
});
