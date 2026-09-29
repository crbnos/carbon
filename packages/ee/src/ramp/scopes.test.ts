import { describe, expect, it } from "vitest";
import {
  RAMP_ALL_CONFIGURED_SCOPES,
  RAMP_OAUTH_SCOPES,
  RAMP_PROVIDER_SCOPES,
  RAMP_PUSH_ONLY_OAUTH_SCOPES,
  RAMP_PUSH_ONLY_SCOPES
} from "./scopes";

/**
 * A wrong scope set fails QUIETLY: Ramp answers `403 DEVELOPER_7100`, the family
 * logs a drain failure and returns nothing — every run, with no failed sync.
 * That is how `repayments:read` stayed missing until it was caught live. These
 * assertions are the loud version.
 */
describe("Ramp scope sets", () => {
  it("never requests accounting:write in push-only mode", () => {
    // The whole point of the mode: Ramp permits exactly ONE connected accounting
    // provider, and requesting the write scope is what takes that seat.
    expect(RAMP_PUSH_ONLY_SCOPES).not.toContain("accounting:write");
    expect(RAMP_PUSH_ONLY_OAUTH_SCOPES).not.toContain("accounting:write");
  });

  it("keeps accounting:read in push-only mode", () => {
    // Still needed to enumerate the ACTIVE provider's coding surface and to see
    // which system holds the connection.
    expect(RAMP_PUSH_ONLY_SCOPES).toContain("accounting:read");
  });

  it("requests what push-only actually pushes", () => {
    for (const scope of [
      "purchase_orders:read",
      "purchase_orders:write",
      "bills:read",
      "bills:write",
      "vendors:read",
      "vendors:write"
    ]) {
      expect(RAMP_PUSH_ONLY_SCOPES).toContain(scope);
    }
  });

  it("drops every inbound family push-only does not pull", () => {
    // Bill payments are the ONE inbound family push-only keeps (bills:read), so
    // a Carbon invoice can learn it was paid. The rest belong to the system that
    // holds the accounting connection.
    for (const scope of [
      "transactions:read",
      "transfers:read",
      "cashbacks:read",
      "statements:read",
      "receipts:read",
      "reimbursements:read",
      "repayments:read"
    ]) {
      expect(RAMP_PUSH_ONLY_SCOPES).not.toContain(scope);
    }
  });

  it("keeps repayments:read in provider mode", () => {
    // Regression guard: its absence produced a silent per-run drain failure.
    expect(RAMP_PROVIDER_SCOPES).toContain("repayments:read");
  });

  it("requests offline_access in both modes", () => {
    // Without it Ramp returns no refresh token and the install dies in ~1h.
    expect(RAMP_OAUTH_SCOPES).toContain("offline_access");
    expect(RAMP_PUSH_ONLY_OAUTH_SCOPES).toContain("offline_access");
  });

  it("exposes a console superset covering both modes", () => {
    // The Ramp Developer Console app must list every scope EITHER mode can ask
    // for, or Ramp rejects the authorize with `invalid_scope`.
    for (const scope of [
      ...RAMP_OAUTH_SCOPES,
      ...RAMP_PUSH_ONLY_OAUTH_SCOPES
    ]) {
      expect(RAMP_ALL_CONFIGURED_SCOPES).toContain(scope);
    }
    expect(new Set(RAMP_ALL_CONFIGURED_SCOPES).size).toBe(
      RAMP_ALL_CONFIGURED_SCOPES.length
    );
  });

  it("keeps push-only a strict SUBSET of provider mode", () => {
    // Not a console requirement — Carbon's Ramp app is registered for more than
    // either mode asks for. This is the weaker but still useful property: the two
    // modes differ only by REMOVAL, so push-only can never request something
    // provider mode has not already exercised in production.
    for (const scope of RAMP_PUSH_ONLY_OAUTH_SCOPES) {
      expect(RAMP_OAUTH_SCOPES).toContain(scope);
    }
  });

  it("asks for no scope it does not use", () => {
    // `item_receipts:write` is configured on the app but deliberately unrequested
    // — item receipts were dropped (spec §7). Requesting an unused write scope
    // would be asking a customer to consent to something Carbon never does.
    expect(RAMP_ALL_CONFIGURED_SCOPES).not.toContain("item_receipts:write");
  });
});
