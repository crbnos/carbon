/**
 * Counterpart search — the types behind "does this record already exist on the
 * provider under a different id?".
 *
 * Carbon writes master data (customers, vendors, items) to the provider, and a
 * record it has never mapped may STILL exist remotely: a human typed it in, or
 * a prior system imported it. Creating a second one pollutes the customer's
 * vendor master and, for AP, posts bills against the wrong counterparty.
 *
 * Two of the three accounting providers already guard against this on the push
 * path — Xero searches contacts by name before creating
 * (`providers/xero/entities/contact.ts`), QuickBooks queries `DisplayName`
 * (`providers/quickbooks-online/entities/vendor.ts`) — and Ramp does the same
 * for spend vendors (`ramp/lib/spend.ts`). Rillet does not. These types are the
 * shared vocabulary those four implementations collapse onto; the ladder itself
 * lives in `./counterpart.ts`.
 *
 * Pure types — no client, no env, browser-safe.
 */

/**
 * The entity kinds a counterpart search can be run for. Deliberately narrower
 * than `AccountingEntityType`: only master data has a meaningful "does this
 * already exist by name/tax id?" question. A transaction is identified by its
 * own mapping row or not at all.
 */
export type ExternalIdentityKind = "account" | "vendor" | "customer" | "item";

/**
 * What Carbon knows about a local record that could identify its remote twin,
 * strongest key first. Every field is optional because providers differ in what
 * they expose, and a local record may carry none of them.
 */
export type CounterpartSearchKeys = {
  name?: string | null;
  taxId?: string | null;
  email?: string | null;
  /**
   * The provider-side reference Carbon stamps on records it created (Rillet's
   * `external_reference`, Ramp's `external_vendor_id`). A match here is
   * Carbon recognising its own earlier write whose mapping row was lost.
   */
  carbonReference?: string | null;
};

/** One remote record a provider offers as a possible match. */
export type RemoteCandidate = {
  remoteId: string;
  name?: string | null;
  taxId?: string | null;
  email?: string | null;
  carbonReference?: string | null;
};
