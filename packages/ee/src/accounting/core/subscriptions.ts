import type { Database } from "@carbon/database";
import type { CreateSubscriptionParams } from "@carbon/database/event";
import {
  createEventSystemSubscription,
  deleteEventSystemSubscription
} from "@carbon/database/event";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProviderID, SpendProviderID, type SyncProviderID } from "./models";

/**
 * The event-system subscriptions each sync provider's OUTBOUND sync
 * requires (subscription name `${providerId}-sync`, handlerType SYNC).
 *
 * Single source of truth (v4 spec, Pillar A): install hooks, integration
 * settings saves, and the outbound reconciliation sweep all converge a
 * company's subscription rows onto this list via
 * `ensureProviderSubscriptions` — the subscription set is never a
 * write-once install artifact. Existing installs converge at runtime; no
 * migration ever backfills subscription rows (migrations only attach table
 * triggers).
 *
 * A table belongs here only if the SYNC event handler's TABLE_TO_ENTITY_MAP
 * (packages/jobs/src/inngest/functions/events/sync.ts) routes it to an
 * entity type the provider registers a syncer for — that pairing is pinned
 * by a test in @carbon/jobs. `address` is deliberately absent everywhere:
 * address edits reach sync through the parent-row `updatedAt` bump
 * interceptor, and a direct address subscription is a dead letter.
 */

type RequiredSyncSubscription = {
  table: CreateSubscriptionParams["table"];
  operations: CreateSubscriptionParams["operations"];
};

/** Master + document tables every provider pushes. DELETE stays subscribed
 * for parity with historical rows (the handler logs-and-skips it). */
const COMMON_PUSH_TABLES: RequiredSyncSubscription[] = [
  { table: "customer", operations: ["INSERT", "UPDATE", "DELETE"] },
  { table: "supplier", operations: ["INSERT", "UPDATE", "DELETE"] },
  // `item` is deliberately NOT here. Carbon is a manufacturing ERP: its item
  // master is parts, materials, tools, consumables and fixtures — tens of
  // thousands of rows that mean nothing to an accounting system. Subscribing the
  // table pushed EVERY one of them, on every insert and every edit, into Xero /
  // QuickBooks Products & Services and Rillet Products, with no filter (none of
  // the three item syncers overrides `shouldSync`). That is catalog pollution,
  // not integration: it buries the handful of real sellable goods, and it churns
  // the provider on routine engineering edits.
  //
  // Nothing is lost, because no INVOICE references a Carbon item any more: an AR
  // line carries a synthetic per-revenue-account product (Rillet / QBO) or is
  // account-coded outright (Xero), and a bill replays its posting journal. The
  // documents that DO reference items — sales orders, purchase orders, inventory
  // adjustments — still push exactly the ones they name, JIT via
  // `ensureDependencySynced("item", …)`. That path is load-bearing and must stay.
  //
  // Removing a table from this list is self-healing: `ensureProviderSubscriptions`
  // deletes any subscription whose table is no longer required, so existing
  // installs stop pushing their catalog at the next converge.
  { table: "salesInvoice", operations: ["INSERT", "UPDATE", "DELETE"] },
  { table: "purchaseInvoice", operations: ["INSERT", "UPDATE", "DELETE"] },
  // Card charges push on the transition to Posted/Voided; the row is never
  // deleted once posted (Draft-only DELETE), so only INSERT/UPDATE.
  { table: "charge", operations: ["INSERT", "UPDATE"] },
  // Credit memos / supplier credits push on the transition to Posted/Voided.
  // One table, TWO entity types — the memo's PARTY decides which (see
  // getEntityTypeFromTable). Draft-only DELETE, so INSERT/UPDATE only.
  { table: "memo", operations: ["INSERT", "UPDATE"] },
  // Reimbursements push on the transition to Posted/Voided; the row is never
  // deleted once posted (Draft-only DELETE), so only INSERT/UPDATE.
  { table: "reimbursement", operations: ["INSERT", "UPDATE"] }
];

/** Posting sync: journals are INSERTed born Posted or UPDATEd to
 * Posted/Reversed; they are immutable once posted and DELETE sync does not
 * exist, so only INSERT/UPDATE are subscribed. */
const JOURNAL_SUBSCRIPTION: RequiredSyncSubscription = {
  table: "journal",
  operations: ["INSERT", "UPDATE"]
};

export const REQUIRED_SYNC_SUBSCRIPTIONS: Record<
  SyncProviderID,
  RequiredSyncSubscription[]
> = {
  [ProviderID.RILLET]: [
    ...COMMON_PUSH_TABLES,
    JOURNAL_SUBSCRIPTION,
    // Phase G outbound payment write-back (Rillet only): push on the
    // transition to Posted/Voided.
    { table: "payment", operations: ["INSERT", "UPDATE"] }
  ],
  [ProviderID.XERO]: [
    ...COMMON_PUSH_TABLES,
    JOURNAL_SUBSCRIPTION,
    { table: "purchaseOrder", operations: ["INSERT", "UPDATE", "DELETE"] },
    { table: "salesOrder", operations: ["INSERT", "UPDATE", "DELETE"] },
    // Phase G outbound payment write-back: push on the transition to
    // Posted/Voided. Inbound payments still ride the pull sweep.
    { table: "payment", operations: ["INSERT", "UPDATE"] }
  ],
  [ProviderID.QUICKBOOKS]: [
    ...COMMON_PUSH_TABLES,
    JOURNAL_SUBSCRIPTION,
    { table: "purchaseOrder", operations: ["INSERT", "UPDATE", "DELETE"] },
    // No `salesOrder` (no QBO salesOrder syncer registered). Phase G outbound
    // payment write-back: push on the transition to Posted/Voided. Inbound
    // payments still ride the CDC pull sweep + webhook.
    { table: "payment", operations: ["INSERT", "UPDATE"] }
  ],
  /**
   * Ramp is a SPEND provider: it mirrors Carbon's purchase orders and its open
   * payables, and nothing else. No `customer`/`item`/`journal` — Ramp is not a
   * ledger — and no DELETE, because a spend platform's document lifecycle is
   * not Carbon's to retract (a handed-off draft bill has no delete endpoint at
   * all).
   *
   * Ramp's INBOUND families (card charges, reimbursements, bill payments) are
   * deliberately absent: they key off Ramp's own `SYNC_READY` status feed and
   * batched confirm protocol, which has no Carbon row event to subscribe to.
   * They stay on the `ramp-sync` cron, the same outbound-events /
   * inbound-sweep split the accounting providers already run.
   */
  [SpendProviderID.RAMP]: [
    { table: "purchaseOrder", operations: ["INSERT", "UPDATE"] },
    { table: "purchaseInvoice", operations: ["INSERT", "UPDATE"] }
  ]
};

export function getSyncSubscriptionName(providerId: SyncProviderID): string {
  return `${providerId}-sync`;
}

export type EnsureSubscriptionsResult = {
  /** Tables upserted (created or refreshed to the required shape). */
  ensured: string[];
  /** Subscription rows removed because their table is no longer required. */
  removed: string[];
};

/**
 * Converge a company's `${providerId}-sync` subscription rows onto
 * REQUIRED_SYNC_SUBSCRIPTIONS. Idempotent: the create RPC upserts on
 * (companyId, name, table) — re-running refreshes operations/config/active
 * without churning rows — and rows for tables no longer in the required
 * list are deleted. Safe to call from the install hook, every settings
 * save, and the reconciliation sweep.
 */
export async function ensureProviderSubscriptions(
  client: SupabaseClient<Database>,
  companyId: string,
  providerId: SyncProviderID
): Promise<EnsureSubscriptionsResult> {
  const required = REQUIRED_SYNC_SUBSCRIPTIONS[providerId];
  const name = getSyncSubscriptionName(providerId);

  for (const subscription of required) {
    await createEventSystemSubscription(client, {
      table: subscription.table,
      companyId,
      name,
      operations: subscription.operations,
      type: "SYNC",
      config: { provider: providerId },
      active: true
    });
  }

  const requiredTables = new Set(
    required.map((subscription) => subscription.table)
  );

  const existing = await client
    .from("eventSystemSubscription")
    .select("id, table")
    .eq("companyId", companyId)
    .eq("name", name);

  if (existing.error) {
    throw new Error(
      `Failed to list ${name} subscriptions: ${existing.error.message}`
    );
  }

  const removed: string[] = [];
  for (const row of existing.data ?? []) {
    if (!requiredTables.has(row.table as CreateSubscriptionParams["table"])) {
      await deleteEventSystemSubscription(client, row.id);
      removed.push(row.table);
    }
  }

  return {
    ensured: required.map((subscription) => subscription.table),
    removed
  };
}
