import { describe, expect, it } from "vitest";
import type { SyncProviderCapabilities } from "./capabilities";
import {
  buildIntegrationTopology,
  hasDelegatedLedgerFamily,
  type ProviderDescriptor
} from "./topology";

const RILLET: ProviderDescriptor = {
  integrationId: "rillet",
  role: "accounting",
  capabilities: {
    role: "accounting",
    transport: "rest",
    supportsWebhooks: true,
    supportsJournalPush: true
  }
};

/** Xero declares NO capabilities at all — the default path must handle it. */
const XERO: ProviderDescriptor = { integrationId: "xero", role: "accounting" };

function spend(
  overrides: Partial<Extract<SyncProviderCapabilities, { role: "spend" }>> = {}
): ProviderDescriptor {
  return {
    integrationId: "ramp",
    role: "spend",
    capabilities: {
      role: "spend",
      transport: "rest",
      supportsWebhooks: true,
      ownsRemoteCodingSurface: true,
      ownsLedgerFamilies: [],
      ...overrides
    }
  };
}

const DESCRIPTORS = [RILLET, XERO, spend()];

describe("buildIntegrationTopology", () => {
  it("resolves nothing installed to carbon-owned everything", () => {
    const t = buildIntegrationTopology([], DESCRIPTORS);
    expect(t.accounting).toBeNull();
    expect(t.spend).toBeNull();
    expect(t.ledgerOwnership.ap).toEqual({ kind: "carbon" });
    expect(t.ledgerOwnership.ar).toEqual({ kind: "carbon" });
    expect(hasDelegatedLedgerFamily(t)).toBe(false);
  });

  it("ignores inactive rows", () => {
    const t = buildIntegrationTopology(
      [{ id: "rillet", active: false }],
      DESCRIPTORS
    );
    expect(t.accounting).toBeNull();
  });

  it("ignores an integration with no declared role", () => {
    const t = buildIntegrationTopology(
      [{ id: "slack", active: true }],
      DESCRIPTORS
    );
    expect(t.accounting).toBeNull();
    expect(t.spend).toBeNull();
  });

  it("resolves an undeclared provider through the capability defaults", () => {
    const t = buildIntegrationTopology(
      [{ id: "xero", active: true }],
      DESCRIPTORS
    );
    expect(t.accounting?.integrationId).toBe("xero");
    expect(t.accounting?.capabilities.transport).toBe("rest");
    expect(t.accounting?.capabilities.externalAddressing.account).toBe("code");
  });

  it("leaves every family carbon-owned while nothing declares ownership", () => {
    // This is the whole no-behaviour-change property of this slice.
    const t = buildIntegrationTopology(
      [
        { id: "rillet", active: true },
        { id: "ramp", active: true }
      ],
      DESCRIPTORS
    );
    expect(hasDelegatedLedgerFamily(t)).toBe(false);
  });

  describe("ledger ownership", () => {
    it("moves only the declared family to the spend provider", () => {
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [RILLET, spend({ ownsLedgerFamilies: ["ap"] })]
      );
      expect(t.ledgerOwnership.ap).toEqual({
        kind: "external",
        integrationId: "ramp"
      });
      expect(t.ledgerOwnership.ar).toEqual({ kind: "carbon" });
      expect(t.ledgerOwnership.creditMemo).toEqual({ kind: "carbon" });
    });

    it("is not AP-shaped — a billing platform owning AR works identically", () => {
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [RILLET, spend({ ownsLedgerFamilies: ["ar"] })]
      );
      expect(t.ledgerOwnership.ar).toEqual({
        kind: "external",
        integrationId: "ramp"
      });
      expect(t.ledgerOwnership.ap).toEqual({ kind: "carbon" });
    });

    it("can delegate a memo family on its own", () => {
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [RILLET, spend({ ownsLedgerFamilies: ["vendorCredit"] })]
      );
      expect(t.ledgerOwnership.vendorCredit).toEqual({
        kind: "external",
        integrationId: "ramp"
      });
      expect(t.ledgerOwnership.ap).toEqual({ kind: "carbon" });
    });
  });

  describe("identity scope", () => {
    it("stays carbon while the spend provider owns its coding surface", () => {
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [RILLET, spend({ ownsRemoteCodingSurface: true })]
      );
      expect(t.identityScope("ramp")).toEqual({ kind: "carbon" });
    });

    it("delegates to the accounting provider when it does not", () => {
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [RILLET, spend({ ownsRemoteCodingSurface: false })]
      );
      expect(t.identityScope("ramp")).toEqual({
        kind: "delegated",
        toIntegrationId: "rillet"
      });
    });

    it("stays carbon when there is no accounting provider to delegate to", () => {
      const t = buildIntegrationTopology(
        [{ id: "ramp", active: true }],
        [RILLET, spend({ ownsRemoteCodingSurface: false })]
      );
      expect(t.identityScope("ramp")).toEqual({ kind: "carbon" });
    });

    it("never delegates for a target that is not the spend provider", () => {
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [RILLET, spend({ ownsRemoteCodingSurface: false })]
      );
      expect(t.identityScope("rillet")).toEqual({ kind: "carbon" });
    });

    it("is independent of ledger ownership — they answer different questions", () => {
      // The Brex/Coupa shape: a partner pushes coding while the GL still posts
      // AP externally. Conflating the two would swap identifiers here, which is
      // wrong — the spend platform still owns its own coding surface.
      const t = buildIntegrationTopology(
        [
          { id: "rillet", active: true },
          { id: "ramp", active: true }
        ],
        [
          RILLET,
          spend({ ownsRemoteCodingSurface: true, ownsLedgerFamilies: ["ap"] })
        ]
      );
      expect(t.ledgerOwnership.ap).toEqual({
        kind: "external",
        integrationId: "ramp"
      });
      expect(t.identityScope("ramp")).toEqual({ kind: "carbon" });
    });
  });
});
