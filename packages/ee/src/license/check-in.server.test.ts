// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { parseAbsolute } from "@internationalized/date";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredLicence } from "./store.server";
import type { LicenceView, VerifyInput, VerifyOutput } from "./types";
import { EMPTY_STATE } from "./types";

vi.mock("@carbon/kv", () => ({
  redis: {},
  acquireLease: vi.fn(),
  releaseLease: vi.fn()
}));
vi.mock("@carbon/auth", () => ({ CarbonEdition: "enterprise" }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

import { backoffHours, LicenceCheckIn } from "./check-in.server";
import { EMPTY_STORED } from "./store.server";

const NOW = "2026-11-03T00:00:00Z";
const view: LicenceView = {
  license_id: "lic_1",
  kind: "instance",
  issued_to: "Acme",
  plan_id: "BUSINESS",
  mode: "connected",
  issuer: "licence.example.com",
  issued_at: "2026-11-01T00:00:00Z"
};

function setup() {
  let stored: StoredLicence = { ...EMPTY_STORED };
  let sentNonce = "";
  const t = {
    lease: "acquired" as "acquired" | "held",
    respond: async (): Promise<Response> =>
      Response.json({ v: 1, status: "ok", envelope: "crbn.v1.renewed" }),
    verifyOut: (nonce: string): VerifyOutput => ({
      ok: true,
      status: "active",
      license: { ...view, nonce, issued_at: "2026-11-03T00:00:00Z" },
      signed_license: {},
      state: EMPTY_STATE
    }),
    clearCache: vi.fn(),
    installId: async () => "00000000-0000-0000-0000-000000000000",
    stored: () => stored,
    setStored: (patch: Partial<StoredLicence>) => {
      stored = { ...stored, ...patch };
    }
  };
  const checkIn = new LicenceCheckIn({
    edition: () => "enterprise",
    resolver: {
      resolve: vi.fn(),
      clearCache: t.clearCache,
      licenceInUse: () => ({
        key: "KEY",
        sealed: "crbn.v1.config",
        signedLicense: { p: "…" },
        checkInUrl: "https://licence.example.com/v1/check-in",
        view
      })
    } as never,
    verify: async (_: VerifyInput) => t.verifyOut(sentNonce),
    readStored: async () => stored,
    updateStored: async (patch) => {
      stored = { ...stored, ...patch };
    },
    acquireLease: async () =>
      t.lease === "held"
        ? { status: "held" }
        : { status: "acquired", owner: "me" },
    releaseLease: async () => undefined,
    fetch: async (_url, init) => {
      sentNonce = JSON.parse(String(init?.body)).nonce;
      return t.respond();
    },
    installId: () => t.installId(),
    appVersion: () => "test",
    roots: () => [],
    now: () => parseAbsolute(NOW, "UTC")
  });
  const run = () => checkIn.run({ seatsUsed: 3, companiesCount: 1 });
  return { t, run };
}

describe("LicenceCheckIn", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it("stores a verified renewal and checks in again in 24 h", async () => {
    expect(await s.run()).toEqual({ status: "ok", error: null });
    expect(s.t.stored()).toMatchObject({
      sealed: "crbn.v1.renewed",
      issuedAt: "2026-11-03T00:00:00Z",
      lastCheckInStatus: "ok",
      checkInFailures: 0,
      nextCheckInAt: "2026-11-04T00:00:00.000Z"
    });
    expect(s.t.clearCache).toHaveBeenCalled();
  });

  it("refuses a renewal whose nonce is not the one sent", async () => {
    s.t.verifyOut = () => ({
      ok: true,
      status: "active",
      license: { ...view, nonce: "other" },
      signed_license: {},
      state: EMPTY_STATE
    });
    expect(await s.run()).toEqual({
      status: "failed",
      error: "ERR_NONCE_MISMATCH"
    });
    expect(s.t.stored().sealed).toBeNull();
  });

  it("marks a revoked licence and drops the stored renewal", async () => {
    s.t.setStored({ sealed: "crbn.v1.old" });
    s.t.respond = async () => Response.json({ v: 1, status: "revoked" });
    expect(await s.run()).toEqual({ status: "revoked", error: null });
    expect(s.t.stored()).toMatchObject({
      revokedLicenseId: "lic_1",
      sealed: null
    });
  });

  it("keeps the licence when the issuer answers invalid", async () => {
    s.t.setStored({ sealed: "crbn.v1.old" });
    s.t.respond = async () => Response.json({ v: 1, status: "invalid" });
    expect(await s.run()).toEqual({ status: "failed", error: "invalid" });
    expect(s.t.stored().sealed).toBe("crbn.v1.old");
  });

  it("backs off for an hour after HTTP 429", async () => {
    s.t.respond = async () => new Response("slow down", { status: 429 });
    expect(await s.run()).toEqual({ status: "failed", error: "HTTP 429" });
    expect(s.t.stored().nextCheckInAt).toBe("2026-11-03T01:00:00.000Z");
  });

  it("records a network error", async () => {
    s.t.respond = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await s.run()).toEqual({ status: "failed", error: "ECONNREFUSED" });
    expect(s.t.stored().lastCheckInError).toBe("ECONNREFUSED");
  });

  it("fails, and backs off, when the install id cannot be derived", async () => {
    s.t.installId = async () => {
      throw new Error("licence: cannot derive the install id");
    };
    expect(await s.run()).toEqual({
      status: "failed",
      error: "licence: cannot derive the install id"
    });
    expect(s.t.stored().nextCheckInAt).toBe("2026-11-03T01:00:00.000Z");
  });

  it("skips while another process holds the lease", async () => {
    s.t.lease = "held";
    expect(await s.run()).toEqual({ skipped: "held" });
  });

  it("backs off 1, 2, 4, 8, 16 h, then holds at 24 h", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffHours)).toEqual([
      1, 2, 4, 8, 16, 24, 24
    ]);
  });
});
