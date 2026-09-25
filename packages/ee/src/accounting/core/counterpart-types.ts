/**
 * Counterpart search — the types behind "does this record already exist on the
 * provider under a different id?".
 *
 * Carbon writes master data (customers, vendors, items) to the provider, and a
 * record it has never mapped may STILL exist remotely: a human typed it in, or
 * a prior system imported it. Creating a second one pollutes the customer's
 * vendor master and, for AP, posts bills against the wrong counterparty.
 *
 * Xero, QuickBooks and Ramp each guarded against this independently, with three
 * different answers to "what counts as a match?" and to "what do we do when two
 * records answer?"; Rillet did not guard at all. These types are the shared
 * vocabulary they collapse onto, and the ladder itself lives in
 * `./counterpart.ts`. All three accounting providers route through it today;
 * Ramp's spend-vendor search (`ramp/lib/spend.ts`) is still its own copy.
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
