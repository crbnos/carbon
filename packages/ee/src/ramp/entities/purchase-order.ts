// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Carbon purchase order → Ramp purchase order.
 *
 * Only the WIRE lives here. What to load and which orders are eligible is
 * Carbon-side and shared — `spend/purchase-order-source.ts` and `spend/gates.ts`
 * — so a second spend platform reimplements this file and nothing else.
 *
 * Three field choices were live-verified (2026-09-11 and 2026-09-25) and are NOT
 * free to change:
 *
 * - `external_id: po.id` — NOT `remote_id`. Ramp's bill-matching flow finds the
 *   Carbon PO by this, and `remote_id` belongs to whoever holds Ramp's
 *   accounting-connection seat.
 * - `currency` + `entity_id` are required on create.
 * - `three_way_match_enabled: false` — Carbon owns receiving, not Ramp.
 * - `purchase_order_number` is SUFFIXED — see `toRampPurchaseOrderNumber`.
 */

import {
  isPushablePurchaseOrderStatus,
  isSettledPurchaseOrderStatus
} from "../../spend/gates";
import {
  loadPurchaseOrderPushSource,
  type SpendPurchaseOrderSource
} from "../../spend/purchase-order-source";
import { buildRampIdempotencyKey, RampApiError } from "../lib/client";
import {
  prepareRampPurchaseOrderBatch,
  prepareRampVendorResolution,
  type RampPurchaseOrderBatch,
  resolveOrCreateRampSpendVendor
} from "../lib/spend";
import { RampPushOnlyEntitySyncer } from "./shared";

/**
 * The purchase-order number to send Ramp.
 *
 * Ramp does NOT store this field verbatim. A bare `<prefix><digits>` is reduced
 * to its digits — `PO000002` is stored as `2`, `PO999999` as `999999`, and
 * `PO-000004` as `4` (a separator does not help) — and uniqueness is enforced on
 * that reduced value. Carbon's readable ids therefore collide with purchase
 * orders that already exist in the customer's Ramp account: any account holding
 * POs numbered 1..N silently refuses the first N of Carbon's with
 * `400 DEVELOPER_7063`, permanently, on a FIRST push.
 *
 * A number with content AFTER the digits is kept whole instead, so appending a
 * numeric suffix both preserves the Carbon id in what a human sees AND makes the
 * value unique by construction (it inherits the uniqueness of `readableId`).
 * `PO000004-1` was accepted and stored verbatim against a business where `4` was
 * already taken; `PO000004-A` came back `PO000004-A-1`, so the suffix must be
 * numeric to survive unchanged.
 *
 * All of the above was mapped live against the Ramp sandbox on 2026-09-26; none of
 * it is documented. The transform could NOT be reduced to a rule — `PO-2026-003`
 * came back `2026-3` while `PO000004-1` came back untouched, which no single
 * predicate explains. So this is verified for the format Carbon's sequence emits
 * by default (`PO` + six digits) and is not a general guarantee: a customer using
 * a customized purchase-order sequence may still see the number altered, though
 * never worse than without the suffix. Re-verify before changing either.
 *
 * This is deliberately UNCONDITIONAL rather than a retry after a collision: a
 * conditional suffix would make the number a customer sees depend on what else
 * happens to be in their Ramp account, so the same Carbon document would appear
 * as `4` for one customer and `PO000004-1` for another.
 */
export const RAMP_PURCHASE_ORDER_NUMBER_SUFFIX = "-1";

export function toRampPurchaseOrderNumber(readableId: string): string {
  return `${readableId}${RAMP_PURCHASE_ORDER_NUMBER_SUFFIX}`;
}

export type RampPurchaseOrderRemote = {
  /**
   * A settled PO archives instead of upserting. Carried on the mapped payload
   * rather than re-read in `upsertRemote`, because `mapToRemote` is where a
   * local state becomes a remote intent — and re-reading would cost a query per
   * PO inside a batch.
   */
  archive: boolean;
  purchase_order_number: string;
  external_id: string;
  three_way_match_enabled: false;
  currency?: string;
  entity_id?: string;
  vendor_id?: string;
  line_items: Array<{
    description: string;
    unit_quantity: number;
    unit_price: number;
    external_id: string;
  }>;
};

export class RampPurchaseOrderSyncer extends RampPushOnlyEntitySyncer<
  SpendPurchaseOrderSource,
  RampPurchaseOrderRemote,
  never
> {
  protected get pushOnlyEntityLabel(): string {
    return "Purchase orders";
  }

  /**
   * Set by `fetchLocalBatch`: the mapping snapshot plus one paginated Ramp
   * vendor list for the whole page, so a batch costs one mapping read and at
   * most one vendor scan rather than a pair per PO.
   */
  private batch: RampPurchaseOrderBatch | undefined;

  protected async fetchLocal(
    id: string
  ): Promise<SpendPurchaseOrderSource | null> {
    return (await this.fetchLocalBatch([id])).get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, SpendPurchaseOrderSource>> {
    const orders = await loadPurchaseOrderPushSource(
      this.database,
      this.companyId,
      ids
    );
    if (orders.size === 0) return orders;

    // Preload mappings + the Ramp vendor snapshot for everything that will
    // actually be pushed. A settled PO only archives, so it needs no vendor.
    this.batch = await prepareRampPurchaseOrderBatch(
      this.mappingService,
      this.ramp,
      [...orders.keys()],
      [...orders.values()]
        .filter((order) => !isSettledPurchaseOrderStatus(order.status))
        .map((order) => order.supplier),
      // When another system holds Ramp's accounting seat, link each vendor to
      // that system's accounting vendor — see `linkAccountingVendor`.
      {
        accountingIntegration: this.rampProvider.codingIdentityIntegrationId
      }
    );

    return orders;
  }

  protected async shouldSync(context: {
    localEntity?: SpendPurchaseOrderSource;
  }): Promise<boolean | string> {
    const order = context.localEntity;
    if (!order) return "purchase order not found";

    if (!isPushablePurchaseOrderStatus(order.status)) {
      return `purchase order is ${order.status} — only released orders push to Ramp`;
    }

    if (isSettledPurchaseOrderStatus(order.status)) {
      // Archiving is only meaningful for a PO Ramp already knows about. One
      // that settled before it was ever pushed has nothing to archive, and
      // creating it now just to archive it would be worse than doing nothing.
      const mapped =
        this.batch?.purchaseOrderIds.get(order.id) ??
        (await this.getRemoteId(order.id));
      if (!mapped) {
        return `purchase order is ${order.status} and was never pushed to Ramp`;
      }
    }

    return true;
  }

  protected async mapToRemote(
    local: SpendPurchaseOrderSource
  ): Promise<RampPurchaseOrderRemote> {
    const archive = isSettledPurchaseOrderStatus(local.status);

    // Best-effort: `vendor_id` is OPTIONAL on a Ramp PO (it still matches its
    // bill by `external_id`), so a supplier we cannot resolve or create must
    // not block the push.
    const vendorId = archive
      ? undefined
      : ((await resolveOrCreateRampSpendVendor(
          this.mappingService,
          this.ramp,
          local.supplier,
          this.companyId,
          this.batch ??
            (await prepareRampVendorResolution(
              this.mappingService,
              this.ramp,
              [local.supplier],
              {
                accountingIntegration:
                  this.rampProvider.codingIdentityIntegrationId
              }
            ))
        )) ?? undefined);

    return {
      archive,
      purchase_order_number: toRampPurchaseOrderNumber(local.readableId),
      external_id: local.id,
      three_way_match_enabled: false,
      ...(local.currencyCode ? { currency: local.currencyCode } : {}),
      ...(archive
        ? {}
        : { entity_id: await this.rampProvider.resolveEntityId() }),
      ...(vendorId ? { vendor_id: vendorId } : {}),
      line_items: local.lines.map((line) => ({
        description: line.description ?? "",
        unit_quantity: line.quantity ?? 0,
        unit_price: line.unitPrice ?? 0,
        external_id: line.id
      }))
    };
  }

  protected async upsertRemote(
    data: RampPurchaseOrderRemote,
    localId: string
  ): Promise<string> {
    let existing =
      this.batch?.purchaseOrderIds.get(localId) ??
      (await this.getRemoteId(localId));

    /**
     * Carbon may have created this purchase order at Ramp already and lost the
     * mapping (a failure between the create and the mapping write, a restore, a
     * re-seeded database). Creating it again is not merely wasteful — it is
     * PERMANENTLY fatal: Ramp refuses the duplicate with
     * `400 DEVELOPER_7063 "Purchase order number already exists"`, and since the
     * mapping is still missing every later attempt repeats it forever.
     *
     * So ask Ramp before creating. `external_id` is the Carbon purchase-order id
     * stamped at creation, and is the only reliable way to recognise our own row —
     * `purchase_order_number` is normalized by Ramp and cannot be matched on.
     *
     * Skipped for an archive: `shouldSync` already refuses an unmapped settled
     * purchase order, so a lookup there would be a request that can only confirm
     * what the caller established. A known mapping needs no lookup either.
     */
    if (!existing && !data.archive) {
      const found = await this.ramp.findPurchaseOrderByExternalId(localId);
      if (found) existing = found.id;
    }

    if (data.archive) {
      // `shouldSync` already refused an unmapped settled PO, so this is
      // defensive rather than reachable.
      if (!existing) {
        throw new Error(
          `Cannot archive purchase order ${data.purchase_order_number}: it has no Ramp counterpart`
        );
      }
      await this.ramp.archivePurchaseOrder(existing);
      return existing;
    }

    const { archive: _archive, ...payload } = data;

    /**
     * The Ramp id a 404 PATCH proved is gone, when this create is a RECREATE.
     * It discriminates the idempotency key below — see there for why.
     */
    let recreateOf: string | null = null;

    if (existing) {
      // `vendor_id` is CREATE-only: Ramp answers a PATCH carrying it with
      // `422 DEVELOPER_7001 {"vendor_id": ["Unknown field."]}` and applies
      // nothing (verified live 2026-09-26). Sending it rejected the whole
      // update, so the line items never reached Ramp either.
      //
      // This went unnoticed because the PATCH branch was effectively
      // unreachable: it needs a mapped purchase order, and until
      // search-before-create above, a purchase order Carbon had already pushed
      // but lost the mapping for could only ever take the create path — and fail
      // there on the duplicate number.
      try {
        await this.ramp.patchPurchaseOrder(existing, {
          line_items: payload.line_items
        });
        return existing;
      } catch (err) {
        /**
         * The mapping points at a purchase order Ramp no longer has, so fall
         * through and create it again — returning a new id, which rewrites the
         * mapping.
         *
         * Every company that ran the earlier build is in exactly this state:
         * it archived a purchase order the moment it reached `Completed`, and
         * an archived Ramp purchase order is GONE — `PATCH` answers
         * `404 DEVELOPER_7002` and it appears in no list. Without this, the
         * first push after that change would fail permanently on a document
         * whose mapping nothing will ever repair.
         *
         * Recreating is safe because archiving RELEASES the purchase-order
         * number: re-creating `PO000018-1` while the archived original still
         * held it returned `201`, not the `400 DEVELOPER_7063` duplicate
         * (verified live 2026-09-27). Were that not true this branch could only
         * trade one permanent failure for another.
         */
        if (!(err instanceof RampApiError) || err.status !== 404) throw err;
        recreateOf = existing;
        existing = null;
      }
    }

    const created = (await this.ramp.createPurchaseOrder(
      payload,
      /**
       * Entity-scoped idempotency key (the Carbon purchase-order id), so a
       * retried push cannot create a duplicate Ramp PO.
       *
       * A RECREATE must not reuse the key the original create used, or the
       * recovery above cannot work: an idempotency key that is still retained
       * makes Ramp replay the ORIGINAL response, so the "new" purchase order is
       * the archived one the PATCH just 404'd on — the mapping is rewritten to
       * the same dead id, the next push 404s again, and the document never
       * recovers. If instead Ramp refuses the reuse, the push fails outright
       * (`DEVELOPER_7005`). Ramp documents no replay window at all — Rillet's,
       * for comparison, is 24 h — so neither outcome can be ruled out by the
       * age of the original create.
       *
       * The stale remote id is the discriminator rather than a timestamp or a
       * nonce, because it keeps the key DETERMINISTIC: a transient retry of the
       * same recreate reuses the same key and still cannot double-create, while
       * a later recreate of a different Ramp purchase order gets a different
       * one.
       */
      buildRampIdempotencyKey({
        companyId: this.companyId,
        operation: "createPurchaseOrder",
        scope: recreateOf ? `${localId}:recreate:${recreateOf}` : localId
      })
    )) as { id?: string } | null;

    const rampId = created?.id ?? null;
    if (!rampId) {
      throw new Error(
        `Ramp did not return a purchase order id for ${data.purchase_order_number}`
      );
    }

    this.batch?.purchaseOrderIds.set(localId, rampId);
    return rampId;
  }
}
