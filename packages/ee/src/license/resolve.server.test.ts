// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredLicence } from "./store.server";
import type { LicenceView, VerifyInput, VerifyOutput } from "./types";
import { EMPTY_STATE } from "./types";

// Imported for its side effect only: the default resolver's store.
vi.mock("@carbon/kv", () => ({ redis: {} }));

import { LicenceResolver } from "./resolve.server";
import { EMPTY_STORED } from "./store.server";

const view = (over: Partial<LicenceView> = {}): LicenceView => ({
  license_id: "lic_1",
  kind: "instance",
  issued_to: "Acme",
  plan_id: "BUSINESS",
  mode: "connected",
  issuer: "licence.example.com",
  issued_at: "2026-11-01T00:00:00Z",
  expires_at: "2026-11-08T00:00:00Z",
  ...over
});
const ok = (status: string, v = view()): VerifyOutput =>
  ({
    ok: true,
    status,
    license: v,
    signed_license: {},
    state: EMPTY_STATE
  }) as VerifyOutput;

/** A resolver over fakes. The fake verifier answers by the sealed body. */
function setup(licence = "crbn.v1.KEY.config") {
  const outputs = new Map<string, VerifyOutput>();
  const calls: VerifyInput[] = [];
  let stored: StoredLicence | null = null;
  let ms = 0;
  const resolver = new LicenceResolver({
    licence: () => licence,
    verify: async (input) => {
      calls.push(input);
      const body = (input.license ?? input.sealed ?? "").split(".").pop() ?? "";
      return (
        outputs.get(body) ?? {
          ok: false,
          error: "ERR_SEAL_AUTH",
          state: EMPTY_STATE
        }
      );
    },
    readStored: async () => stored,
    updateStored: async (patch) => {
      stored = { ...EMPTY_STORED, ...stored, ...patch };
    },
    roots: () => [],
    now: () => "2026-11-03T00:00:00Z",
    ms: () => ms
  });
  return {
    resolver,
    outputs,
    calls,
    store: (patch: Partial<StoredLicence>) => {
      stored = { ...EMPTY_STORED, ...patch };
    },
    stored: () => stored,
    advance: (to: number) => {
      ms = to;
    }
  };
}

describe("LicenceResolver", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("grants the plan of an active licence, keeping only known overrides", async () => {
    t.outputs.set(
      "config",
      ok("active", view({ overrides: { WEBHOOKS: false, BOGUS: true } }))
    );
    const r = await t.resolver.resolve();
    expect(r).toMatchObject({
      kind: "licence",
      status: "active",
      plan: "BUSINESS"
    });
    expect(r.overrides).toEqual({ WEBHOOKS: false });
    expect(t.stored()?.sealed).toBe("crbn.v1.config");
  });

  it("reports an expired licence", async () => {
    t.outputs.set("config", ok("expired"));
    expect((await t.resolver.resolve()).status).toBe("expired");
  });

  it("reports a terminated licence", async () => {
    t.outputs.set("config", ok("terminated"));
    expect((await t.resolver.resolve()).status).toBe("terminated");
  });

  it("gives the floor with no CARBON_LICENSE", async () => {
    t = setup("");
    const r = await t.resolver.resolve();
    expect(r).toMatchObject({ kind: "floor", error: "missing", plan: null });
    expect(t.calls).toHaveLength(0);
  });

  it("uses a newer stored renewal of the same licence", async () => {
    t.outputs.set("config", ok("active"));
    t.outputs.set(
      "renewal",
      ok(
        "active",
        view({ plan_id: "PARTNER", issued_at: "2026-11-02T00:00:00Z" })
      )
    );
    t.store({
      sealed: "crbn.v1.renewal",
      licenseId: "lic_1",
      issuedAt: "2026-11-02T00:00:00Z"
    });
    expect((await t.resolver.resolve()).plan).toBe("PARTNER");
  });

  it("ignores an older stored renewal", async () => {
    t.outputs.set(
      "config",
      ok("active", view({ issued_at: "2026-11-02T00:00:00Z" }))
    );
    t.outputs.set(
      "old",
      ok(
        "active",
        view({ plan_id: "PARTNER", issued_at: "2026-11-01T00:00:00Z" })
      )
    );
    t.store({
      sealed: "crbn.v1.old",
      licenseId: "lic_1",
      issuedAt: "2026-11-01T00:00:00Z"
    });
    expect((await t.resolver.resolve()).plan).toBe("BUSINESS");
    expect(t.stored()?.sealed).toBe("crbn.v1.config");
  });

  it("gives the floor for a revoked licence", async () => {
    t.outputs.set("config", ok("active"));
    t.store({ revokedLicenseId: "lic_1" });
    expect(await t.resolver.resolve()).toMatchObject({
      kind: "floor",
      error: "revoked"
    });
  });

  it("gives the floor when the licence does not verify", async () => {
    expect(await t.resolver.resolve()).toMatchObject({
      kind: "floor",
      error: "ERR_SEAL_AUTH"
    });
  });

  it("keeps the last good resolution when a later check fails", async () => {
    t.outputs.set("config", ok("active"));
    expect((await t.resolver.resolve()).kind).toBe("licence");
    t.outputs.clear();
    t.advance(61_000);
    expect((await t.resolver.resolve()).plan).toBe("BUSINESS");
  });

  it("caches the resolution for 60 s, then resolve-verifies", async () => {
    t.outputs.set("config", ok("active"));
    await t.resolver.resolve();
    t.advance(59_000);
    await t.resolver.resolve();
    expect(t.calls).toHaveLength(1);
    t.advance(61_000);
    await t.resolver.resolve();
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.context).toBe("resolve");
  });

  // A connected licence's original token ends three weeks after issue; the
  // renewals in the store must still win on the next restart.
  it("uses a stored renewal when CARBON_LICENSE no longer verifies", async () => {
    t.outputs.set("config", {
      ok: false,
      error: "ERR_LICENSE_TERMINATED",
      state: EMPTY_STATE
    });
    t.outputs.set(
      "renewal",
      ok("active", view({ issued_at: "2026-11-25T00:00:00Z" }))
    );
    t.store({
      sealed: "crbn.v1.renewal",
      licenseId: "lic_1",
      issuedAt: "2026-11-25T00:00:00Z"
    });
    const r = await t.resolver.resolve();
    expect(r).toMatchObject({ kind: "licence", status: "active" });
    expect(t.calls.map((c) => c.context)).toEqual(["install", "resolve"]);
  });

  it("ignores a stored renewal whose date does not parse", async () => {
    t.outputs.set("config", ok("active"));
    t.outputs.set("renewal", ok("active", view({ plan_id: "PARTNER" })));
    t.store({
      sealed: "crbn.v1.renewal",
      licenseId: "lic_1",
      issuedAt: "not a date"
    });
    expect((await t.resolver.resolve()).plan).toBe("BUSINESS");
  });

  it("shares one resolution between concurrent callers", async () => {
    t.outputs.set("config", ok("active"));
    await Promise.all(Array.from({ length: 16 }, () => t.resolver.resolve()));
    expect(t.calls).toHaveLength(1);
  });
});
