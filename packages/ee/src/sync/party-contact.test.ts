import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./capabilities";
import {
  PARTY_CONTACT_SETTING_COLUMN,
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

  it("names the real companySettings columns", () => {
    // These are column names in a live UPDATE — a typo is a runtime failure the
    // type system cannot see.
    expect(PARTY_CONTACT_SETTING_COLUMN.supplier).toBe(
      "requireSupplierContactAndLocation"
    );
    expect(PARTY_CONTACT_SETTING_COLUMN.customer).toBe(
      "requireCustomerContactAndLocation"
    );
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
