// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  API_PREFIX,
  API_VERSION,
  authCodeResponse,
  authMfaRequest,
  authVerifyRequest,
  compareAppVersion,
  HEADERS,
  meResponse,
  operationsQuery,
  serverSpeaksApiVersion
} from "./contract";

describe("compareAppVersion", () => {
  it("compares numerically, not lexicographically", () => {
    expect(compareAppVersion("1.2.0", "1.10.0")).toBe(-1);
    expect(compareAppVersion("1.10.0", "1.2.0")).toBe(1);
  });

  it("treats missing parts as zero", () => {
    expect(compareAppVersion("1.0", "1.0.0")).toBe(0);
    expect(compareAppVersion("2", "1.9.9")).toBe(1);
  });

  it("treats a non-numeric part as zero rather than NaN", () => {
    expect(compareAppVersion("1.0.0-beta", "1.0.0")).toBe(0);
  });
});

describe("serverSpeaksApiVersion", () => {
  it("accepts a header listing this version", () => {
    expect(serverSpeaksApiVersion("1")).toBe(true);
    expect(serverSpeaksApiVersion("1, 2")).toBe(true);
  });

  it("refuses a missing header or one without this version", () => {
    expect(serverSpeaksApiVersion(null)).toBe(false);
    expect(serverSpeaksApiVersion("2")).toBe(false);
  });
});

describe("constants", () => {
  it("pins the prefix and the header names the server sets", () => {
    expect(API_PREFIX).toBe("/api/v1");
    expect(API_VERSION).toBe(1);
    expect(HEADERS.company).toBe("x-carbon-company");
    expect(HEADERS.idempotencyKey).toBe("idempotency-key");
    expect(HEADERS.apiVersions).toBe("carbon-api");
  });
});

describe("auth schemas", () => {
  it("requires exactly six digits for a code", () => {
    expect(
      authVerifyRequest.safeParse({ email: "a@b.co", code: "123456" }).success
    ).toBe(true);
    expect(
      authVerifyRequest.safeParse({ email: "a@b.co", code: "12345" }).success
    ).toBe(false);
    expect(
      authVerifyRequest.safeParse({ email: "not-an-email", code: "123456" })
        .success
    ).toBe(false);
  });

  it("requires BOTH tokens for the TOTP challenge", () => {
    const ok = authMfaRequest.safeParse({
      accessToken: "a",
      refreshToken: "r",
      code: "123456"
    });
    expect(ok.success).toBe(true);
    expect(
      authMfaRequest.safeParse({ accessToken: "a", code: "123456" }).success
    ).toBe(false);
  });

  it("allows the review-account password hint but nothing else", () => {
    expect(authCodeResponse.safeParse({ ok: true }).success).toBe(true);
    expect(
      authCodeResponse.safeParse({ ok: true, method: "password" }).success
    ).toBe(true);
    expect(
      authCodeResponse.safeParse({ ok: true, method: "magic-link" }).success
    ).toBe(false);
  });
});

describe("meResponse", () => {
  const valid = {
    instance: {
      name: "localhost",
      supabaseUrl: "http://localhost:54321",
      supabaseAnonKey: "anon",
      mode: "connected",
      controlledEnvironment: false,
      idleLockMs: 900000,
      minAppVersion: "1.0.0",
      analytics: null
    },
    user: { id: "u1", email: "a@b.co", name: "Op", avatarUrl: null },
    companies: [{ id: "c1", name: "Acme" }],
    locations: [{ id: "l1", name: "Plant", companyId: "c1" }],
    defaultLocationId: "l1",
    workCenters: [{ id: "w1", name: "Assembly 2", locationId: "l1" }],
    consoleAvailable: true,
    permissions: {
      production: { view: true, create: true, update: true },
      inventory: { view: true, update: true },
      quality: { create: false },
      settings: { update: false }
    }
  };

  it("parses a complete payload", () => {
    expect(meResponse.safeParse(valid).success).toBe(true);
  });

  it("refuses a deployment mode it does not know", () => {
    const bad = {
      ...valid,
      instance: { ...valid.instance, mode: "cloud" }
    };
    expect(meResponse.safeParse(bad).success).toBe(false);
  });

  it("refuses a non-URL supabaseUrl", () => {
    const bad = {
      ...valid,
      instance: { ...valid.instance, supabaseUrl: "localhost:54321" }
    };
    expect(meResponse.safeParse(bad).success).toBe(false);
  });
});

describe("operationsQuery", () => {
  it("defaults both lists to empty", () => {
    expect(operationsQuery.parse({})).toEqual({
      workCenterIds: [],
      filter: []
    });
  });
});
