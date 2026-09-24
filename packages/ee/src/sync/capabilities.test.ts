import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFAULTS,
  resolveCapabilities,
  type SyncProviderCapabilities
} from "./capabilities";

describe("resolveCapabilities", () => {
  it("resolves an undeclared provider to the documented defaults", () => {
    // XeroProvider deliberately declares no capabilities object at all. Every
    // read must therefore go through here — reading `provider.capabilities?.x`
    // gives undefined for Xero on every single question.
    expect(resolveCapabilities(undefined)).toEqual(CAPABILITY_DEFAULTS);
  });

  it("does not hand back the shared defaults object", () => {
    const a = resolveCapabilities(undefined);
    const b = resolveCapabilities(undefined);
    expect(a).not.toBe(CAPABILITY_DEFAULTS);
    expect(a).not.toBe(b);
  });

  it("defaults account addressing to code — right for Xero and Rillet", () => {
    // Xero addresses by AccountCode and Rillet by account_code; QBO is the one
    // that must declare "id" explicitly.
    expect(resolveCapabilities(undefined).externalAddressing.account).toBe(
      "code"
    );
  });

  it("merges a declared addressing over the default rather than replacing it", () => {
    const declared: SyncProviderCapabilities = {
      role: "accounting",
      transport: "rest",
      supportsWebhooks: false,
      supportsJournalPush: true,
      externalAddressing: { vendor: "id" }
    };
    const resolved = resolveCapabilities(declared);
    expect(resolved.externalAddressing.vendor).toBe("id");
    expect(resolved.externalAddressing.account).toBe("code");
  });

  it("keeps a declared account addressing", () => {
    const resolved = resolveCapabilities({
      role: "accounting",
      transport: "rest",
      supportsWebhooks: false,
      supportsJournalPush: true,
      externalAddressing: { account: "id" }
    });
    expect(resolved.externalAddressing.account).toBe("id");
  });

  it("omits maxJournalDimensionSlots when the provider declares none", () => {
    // Absent must stay absent: "no cap" and "a cap of undefined" read the same
    // at a call site, but Rillet genuinely has no cap and must not acquire one.
    const resolved = resolveCapabilities({
      role: "accounting",
      transport: "rest",
      supportsWebhooks: true,
      supportsJournalPush: true
    });
    expect(resolved.maxJournalDimensionSlots).toBeUndefined();
    expect("maxJournalDimensionSlots" in resolved).toBe(false);
  });

  it("carries a declared dimension cap through", () => {
    const resolved = resolveCapabilities({
      role: "accounting",
      transport: "rest",
      supportsWebhooks: false,
      supportsJournalPush: true,
      maxJournalDimensionSlots: 2
    });
    expect(resolved.maxJournalDimensionSlots).toBe(2);
  });

  it("resolves a spend provider's own members and denies journal push", () => {
    const resolved = resolveCapabilities({
      role: "spend",
      transport: "rest",
      supportsWebhooks: true,
      ownsRemoteCodingSurface: false,
      ownsLedgerFamilies: ["ap"]
    });
    expect(resolved.role).toBe("spend");
    expect(resolved.ownsRemoteCodingSurface).toBe(false);
    expect(resolved.ownsLedgerFamilies).toEqual(["ap"]);
    // A spend platform never pushes Carbon's journals; only the GL owner does.
    expect(resolved.supportsJournalPush).toBe(false);
  });

  it("gives an accounting provider the carbon-owned coding defaults", () => {
    const resolved = resolveCapabilities({
      role: "accounting",
      transport: "rest",
      supportsWebhooks: false,
      supportsJournalPush: true
    });
    expect(resolved.ownsRemoteCodingSurface).toBe(true);
    expect(resolved.ownsLedgerFamilies).toEqual([]);
  });
});
