// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./capabilities";
import {
  applyPartyContactRequirements,
  partyContactSettingsToEnable
} from "./party-contact";

/**
 * The bug this exists to stop coming back: `requireSupplierContactAndLocation` shipped OFF
 * and nothing turned it on, so a company with Ramp connected still issued
 * purchase orders against suppliers with no contact — and every bill for them
 * failed at push time with "needs a contact email", far too late for the person
 * who raised the order to fix it.
 */
describe("partyContactSettingsToEnable", () => {
  it("enables the supplier setting for a provider that cannot create a vendor without a contact and location", () => {
    expect(
      partyContactSettingsToEnable({
        requiresPartyContactAndLocation: ["supplier"]
      })
    ).toEqual(["requireSupplierContactAndLocation"]);
  });

  it("enables nothing for a provider that declares no such requirement", () => {
    // The default, and it must stay the default: connecting an accounting
    // provider that treats a vendor email and address as optional (Rillet,
    // Xero, QBO) must NOT impose a company-wide data-entry policy.
    expect(
      partyContactSettingsToEnable({ requiresPartyContactAndLocation: [] })
    ).toEqual([]);
    expect(
      partyContactSettingsToEnable(resolveCapabilities(undefined))
    ).toEqual([]);
  });

  it("maps each party kind to its own setting, independently", () => {
    expect(
      partyContactSettingsToEnable({
        requiresPartyContactAndLocation: ["customer"]
      })
    ).toEqual(["requireCustomerContactAndLocation"]);

    expect(
      partyContactSettingsToEnable({
        requiresPartyContactAndLocation: ["supplier", "customer"]
      })
    ).toEqual([
      "requireSupplierContactAndLocation",
      "requireCustomerContactAndLocation"
    ]);
  });

  it("reads the requirement through resolveCapabilities, so an undeclared provider is safe", () => {
    // `capabilities.requiresPartyContactAndLocation` is optional on the
    // declaration. Reading it raw would answer `undefined` and crash the map for
    // every provider that has not declared one.
    const resolved = resolveCapabilities({
      role: "spend",
      transport: "rest",
      supportsWebhooks: true,
      ownsRemoteCodingSurface: false,
      ownsLedgerFamilies: ["ap"]
    });

    expect(resolved.requiresPartyContactAndLocation).toEqual([]);
    expect(partyContactSettingsToEnable(resolved)).toEqual([]);
  });
});

describe("Ramp declares the requirement in BOTH install modes", () => {
  it("requires a supplier contact whether or not Carbon holds the accounting seat", async () => {
    // Push-only pushes vendors and bills exactly as provider mode does, so a
    // requirement declared on only one mode would leave half the installs
    // failing at push time.
    const { RAMP_MODE_PROFILES } = await import("../ramp/lib/modes");

    for (const mode of ["provider", "push-only"] as const) {
      expect(
        resolveCapabilities(RAMP_MODE_PROFILES[mode].capabilities)
          .requiresPartyContactAndLocation
      ).toEqual(["supplier"]);
    }
  });
});

/**
 * Minimal chainable supabase-query mock — the same pattern
 * `accounting/core/payment-tombstone.test.ts` uses. Only the HTTP boundary is
 * faked; `applyPartyContactRequirements` itself runs real.
 *
 * `from("companySettings").select(...).eq(...).maybeSingle()` resolves the READ,
 * and `from("companySettings").update(...).eq(...).select("id")` the WRITE.
 */
function makeClient(opts: {
  read?: { data: Record<string, boolean | null> | null; error?: unknown };
  write?: { data: Array<{ id: string }> | null; error?: unknown };
}) {
  const captured: { patch?: Record<string, unknown> } = {};
  const client = {
    from: () => {
      const builder: any = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          captured.patch = patch;
          return writeBuilder;
        },
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: opts.read?.data ?? null,
            error: opts.read?.error ?? null
          })
      };
      const writeBuilder: any = {
        eq: () => writeBuilder,
        select: () =>
          Promise.resolve({
            data: opts.write?.data ?? [{ id: "comp_1" }],
            error: opts.write?.error ?? null
          })
      };
      return builder;
    }
  };
  return { client: client as never, captured };
}

const needsSupplier = {
  requiresPartyContactAndLocation: ["supplier" as const]
};

describe("applyPartyContactRequirements", () => {
  /**
   * The bug: the pre-read destructured only `{ data }`. A failed read (or a
   * missing row) left it undefined, every column then read as "missing", the
   * `UPDATE ... .eq("id", companyId)` matched zero rows and returned no error —
   * so this returned both column names and the install hook logged "enabled
   * requireSupplierContactAndLocation for company X" with nothing written. That
   * log is the ONLY observable signal this gate has.
   */
  it("throws instead of reporting a write it could not verify, when the read fails", async () => {
    const { client } = makeClient({
      read: { data: null, error: { message: "permission denied" } }
    });

    await expect(
      applyPartyContactRequirements(client, "comp_1", needsSupplier)
    ).rejects.toThrow(/permission denied/);
  });

  it("throws when there is no companySettings row at all", async () => {
    const { client } = makeClient({ read: { data: null } });

    await expect(
      applyPartyContactRequirements(client, "comp_1", needsSupplier)
    ).rejects.toThrow(/No companySettings row/);
  });

  it("throws when the update matches no rows", async () => {
    const { client } = makeClient({
      read: { data: { requireSupplierContactAndLocation: false } },
      write: { data: [] }
    });

    await expect(
      applyPartyContactRequirements(client, "comp_1", needsSupplier)
    ).rejects.toThrow(/matched no rows/);
  });

  it("enables the column and reports it when the write lands", async () => {
    const { client, captured } = makeClient({
      read: { data: { requireSupplierContactAndLocation: false } }
    });

    expect(
      await applyPartyContactRequirements(client, "comp_1", needsSupplier)
    ).toEqual(["requireSupplierContactAndLocation"]);
    expect(captured.patch).toEqual({
      requireSupplierContactAndLocation: true
    });
  });

  it("reports nothing — and writes nothing — when it is already on", async () => {
    // An install that re-converges must not claim it enabled something a human
    // turned on months ago.
    const { client, captured } = makeClient({
      read: { data: { requireSupplierContactAndLocation: true } }
    });

    expect(
      await applyPartyContactRequirements(client, "comp_1", needsSupplier)
    ).toEqual([]);
    expect(captured.patch).toBeUndefined();
  });

  it("never reads or writes for a provider that declares no requirement", async () => {
    const { client, captured } = makeClient({
      read: { data: null, error: { message: "should not be reached" } }
    });

    expect(
      await applyPartyContactRequirements(client, "comp_1", {
        requiresPartyContactAndLocation: []
      })
    ).toEqual([]);
    expect(captured.patch).toBeUndefined();
  });
});
