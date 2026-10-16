// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ServerFnError } from "@carbon/api/errors";
import { InvalidInputError, NotFoundError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  type CarbonError,
  ERROR_STATUS,
  type ErrorCategory,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase
} from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  assertPostingStatusUnchanged,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import {
  type LinesideClaim,
  linesideCredit
} from "@carbon/database/picked-consumption";
import { inOrder, many, notNull, single } from "@carbon/database/rows";
import { expandSerialTrackedLines } from "@carbon/database/stock-transfer";
import { consumableInWholeAssemblies } from "@carbon/database/supersession-pick";
import { evaluateLinesForSurface } from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import { type ServerFnInput, serverFns } from "@carbon/server-functions";
import { assertCompanyRecords } from "@carbon/server-functions/company-records";
import { buildOffsetLines } from "@carbon/server-functions/lib/asset-transfer";
import { calculateCOGS } from "@carbon/server-functions/lib/calculate-cogs";
import {
  getAccountingPeriodForDate,
  getCurrentAccountingPeriod
} from "@carbon/server-functions/lib/get-accounting-period";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount
} from "@carbon/server-functions/lib/get-posting-group";
import { getOffsetAccount } from "@carbon/server-functions/lib/offset-account";
import {
  buildCostLedgerRow,
  buildJournalLineDimensions
} from "@carbon/server-functions/lib/plan-adjustment";
import {
  bookAdjustment,
  createAdjustmentJournal
} from "@carbon/server-functions/lib/post-adjustment";
import {
  serialUnitCost,
  type UnitCostChild
} from "@carbon/server-functions/lib/serial-unit-cost";
import { getTrackedEntityOnHandInBin } from "@carbon/server-functions/lib/storage-units";
import {
  type ExpiredEntityPolicy,
  type ExpiryOverride,
  expiredEntities,
  expiryVerdict,
  getExpiredEntityPolicy
} from "@carbon/server-functions/shelf-life";
import { attributesContain } from "@carbon/server-functions/tracked-entity-attributes";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  assertEntityCoversPick,
  async,
  buildBatchSplitRecords,
  datetime,
  getErrorMessage,
  indexByMapped,
  isFullDraw,
  PickGuardError,
  pluckUnique,
  resolvePick,
  round,
  settleQuantity,
  type Violation
} from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Insertable, Transaction } from "kysely";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { upsertDocument } from "~/modules/documents/documents.service";
import { getNextSequence } from "~/modules/settings/settings.service";
import { invokePosting } from "~/modules/shared/shared.service";
import type { StorageItem } from "~/types";
import type { Filter, GenericQueryFilters } from "~/utils/query";
import {
  LIST_COUNT,
  setGenericQueryFilters,
  setSearchFilter
} from "~/utils/query";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import { getItemStorageUnitQuantities } from "../items/items.utils";
import type {
  batchPropertyOrderValidator,
  batchPropertyValidator,
  inventoryAdjustmentValidator,
  inventoryCountLineValidator,
  kanbanValidator,
  pickingListLineValidator,
  pickingListValidator,
  receiptValidator,
  shipmentValidator,
  shippingMethodValidator,
  stockMovementCorrectionValidator,
  stockTransferLineValidator,
  stockTransferValidator,
  storageTypeValidator,
  storageUnitValidator,
  warehouseTransferValidator
} from "./inventory.models";
import {
  isPickingListLocked,
  isWarehouseTransferLocked,
  type receiptFixedAssetLineUpdateValidator,
  reconcileReceiptLineSerials
} from "./inventory.models";
import { renderPackingSlip } from "./packing-slip.pdf";
import {
  effectiveSuccessorId,
  type PickSupersession,
  pickSupersessionItemId,
  resolvePickRule,
  resolvePickTarget,
  splitConsumeFirstPick
} from "./supersession-pick";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  GraphData,
  TrackedEntity
} from "./types";
import { clampDepth } from "./ui/Traceability/constants";
import type {
  IssueContainment,
  IssueContainmentStatus,
  StepRecord
} from "./ui/Traceability/utils";

const logger = getLogger("erp", "inventory");

export async function deleteBatchProperty(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("batchProperty").delete().eq("id", id);
}

export async function deleteKanban(
  client: SupabaseClient<Database>,
  kanbanId: string
) {
  return client.from("kanban").delete().eq("id", kanbanId);
}

export async function deleteReceipt(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receipt").delete().eq("id", receiptId);
}

export async function deleteReceiptLine(
  client: SupabaseClient<Database>,
  receiptLineId: string
) {
  return client.from("receiptLine").delete().eq("id", receiptLineId);
}

/** Not published: `inventory.storageUnit.delete` deletes a unit, or with `cascade` its subtree. */
export async function deleteStorageUnit(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client.from("storageUnit").delete().eq("id", storageUnitId);
}

/**
 * Deletes a storage unit along with every descendant in its subtree.
 *
 * The `storageUnit_parentId_fkey` FK is `ON DELETE RESTRICT`, so you cannot
 * delete a parent while it still has children. Supabase evaluates FK
 * constraints at statement end, so deleting the whole subtree in a single
 * `WHERE id IN (...)` statement is safe - all referencing rows go away in
 * the same transaction.
 *
 * We fetch the subtree via `storageUnits_recursive` (which already returns
 * self + descendants thanks to `ancestorPath @> ARRAY[id]`).
 *
 * Not published: `inventory.storageUnit.delete` with `cascade` does this.
 */
export async function deleteStorageUnitCascade(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  const descendants = await getStorageUnitDescendants(client, storageUnitId);
  if (descendants.error) return descendants;

  // storageUnits_recursive is a view, so every column is nominally nullable
  // in the generated types. Narrow `id` to a concrete string[] for
  // Supabase's `.in()` signature.
  const ids = (descendants.data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => id != null);
  // Safety net: fall back to the single-row delete if the view returned
  // nothing (shouldn't happen — the self row is always in the subtree).
  if (ids.length === 0) {
    return client.from("storageUnit").delete().eq("id", storageUnitId);
  }

  return client.from("storageUnit").delete().in("id", ids);
}

export async function deleteShipment(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client.from("shipment").delete().eq("id", shipmentId);
}

export async function deleteShipmentLine(
  client: SupabaseClient<Database>,
  shipmentLineId: string
) {
  return client.from("shipmentLine").delete().eq("id", shipmentLineId);
}

export async function deleteShippingMethod(
  client: SupabaseClient<Database>,
  shippingMethodId: string
) {
  return client
    .from("shippingMethod")
    .update({ active: false })
    .eq("id", shippingMethodId);
}

export async function deleteStockTransfer(
  client: SupabaseClient<Database>,
  stockTransferId: string
) {
  return client.from("stockTransfer").delete().eq("id", stockTransferId);
}

export async function deleteStockTransferLine(
  client: SupabaseClient<Database>,
  stockTransferLineId: string
) {
  return client
    .from("stockTransferLine")
    .delete()
    .eq("id", stockTransferLineId);
}

export async function deleteWarehouseTransfer(
  client: SupabaseClient<Database>,
  transferId: string
) {
  return client.from("warehouseTransfer").delete().eq("id", transferId);
}

/** Not published: it skips the lock check `inventory.warehouseTransfer.line.delete` makes. */
export async function deleteWarehouseTransferLine(
  client: SupabaseClient<Database>,
  transferLineId: string
) {
  return client.from("warehouseTransferLine").delete().eq("id", transferLineId);
}

export async function getItemLedgerPage(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string,
  sortDescending: boolean = false,
  page: number = 1
) {
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  let query = client
    .from("itemLedger")
    .select("*, storageUnit(name), trackedEntity(readableId)", {
      count: "exact"
    })
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("createdAt", { ascending: !sortDescending })
    .range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    return { error };
  }

  return {
    data,
    count,
    page,
    pageSize,
    hasMore: count !== null && offset + pageSize < count
  };
}

/**
 * Keyset-paginated item-ledger activity for the per-item Activity panel.
 *
 * Pages on `entryNumber` (a NOT NULL, per-company-unique, monotonic insertion
 * sequence that is co-ordered with `createdAt`), which lets us:
 *  - anchor the first load directly on a specific entry (`inclusive` + the
 *    entry's `entryNumber`) instead of paging from newest, and
 *  - load in both directions (`older` below, `newer` above).
 *
 * Returns rows newest→oldest regardless of direction. No `count` — `hasMore` is
 * inferred from a full page, so there's no whole-table count per request.
 */
export async function getItemLedgerActivity(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    locationId: string;
    /** entryNumber to page from; omit to start from the newest entry. */
    entryNumber?: number;
    direction?: "older" | "newer";
    /** include the cursor row itself (used for the anchored first load). */
    inclusive?: boolean;
  }
) {
  const pageSize = 20;
  const direction = args.direction ?? "older";

  let query = client
    .from("itemLedger")
    .select("*, storageUnit(name), trackedEntity(readableId)")
    .eq("itemId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId);

  if (args.entryNumber !== undefined) {
    if (direction === "older") {
      query = args.inclusive
        ? query.lte("entryNumber", args.entryNumber)
        : query.lt("entryNumber", args.entryNumber);
    } else {
      query = args.inclusive
        ? query.gte("entryNumber", args.entryNumber)
        : query.gt("entryNumber", args.entryNumber);
    }
  }

  // Scan toward the requested direction so the page is contiguous with the
  // cursor, then always hand back newest→oldest for rendering/prepending.
  query = query
    .order("entryNumber", { ascending: direction === "newer" })
    .limit(pageSize);

  const { data, error } = await query;

  const rows =
    direction === "newer" ? (data ?? []).slice().reverse() : (data ?? []);
  return { data: rows, hasMore: (data?.length ?? 0) === pageSize, error };
}

/**
 * On-hand quantity of an item at a location right after ledger entry
 * `entryNumber` (omit it for on-hand now), on the same definition as the
 * inventory table's On Hand column. The Activity panel fetches this once for
 * its newest loaded entry and derives every other row's balance from the
 * contiguous pages — see `withRunningBalance`.
 */
export async function getItemLedgerBalance(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    locationId: string;
    entryNumber?: number;
  }
) {
  return client.rpc("get_item_ledger_balance", {
    company_id: args.companyId,
    location_id: args.locationId,
    item_id: args.itemId,
    entry_number: args.entryNumber
  });
}

export async function getBatchProperties(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
) {
  return client
    .from("batchProperty")
    .select("*")
    .in("itemId", itemIds)
    .eq("companyId", companyId)
    .order("sortOrder");
}

export async function getInventoryItems(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc(
    "get_inventory_quantities",
    {
      location_id: locationId,
      company_id: companyId
    },
    {
      count: LIST_COUNT
    }
  );

  query = setSearchFilter(query, args?.search, [
    "name",
    "readableIdWithRevision"
  ]);

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);

  return query;
}

export async function getInventoryItemsCount(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("item")
    .select("id", {
      count: LIST_COUNT
    })
    .neq("itemTrackingType", "Non-Inventory")
    .eq("companyId", companyId);

  query = setSearchFilter(query, args?.search, [
    "name",
    "readableIdWithRevision"
  ]);

  query = setGenericQueryFilters(query, args);

  return query;
}

export async function getInventoryValuation(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { asOfDate?: string | null; locationId?: string | null }
) {
  return client.rpc("get_inventory_valuation", {
    company_id: companyId,
    as_of_date: args.asOfDate ?? undefined,
    location_id: args.locationId ?? undefined
  });
}

export async function getInventoryValuationTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate?: string | null
) {
  return client.rpc("get_inventory_tie_out", {
    company_id: companyId,
    as_of_date: asOfDate ?? undefined
  });
}

// Draft adjusting journal that brings the GL inventory accounts to the
// subledger valuation — the tie-out's Reconcile action (cutover path for
// adjustments posted before GL posting existed). variance = subledger − GL,
// so the inventory line is +variance and the offset −variance: positive on an
// Asset = debit, negative on the (Expense) adjustment account = credit — raw
// amounts sum to zero. The journal stays Draft: a human reviews and posts it
// from the Journals screen, and the tie-out ignores Draft journals.
// Posted on the tie-out's as-of date — the tie-out only counts journals with
// postingDate <= asOfDate, so a today-dated journal could never resolve a
// backdated variance. Posting may still be rejected if that period is Closed.
/**
 * Creates a draft GL journal that clears the inventory valuation variance.
 *
 * Gated on accounting, as the Reconcile screen is: it writes a journal, not
 * inventory.
 */
export async function createInventoryReconciliationJournal(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  args: { asOfDate: string; userId: string }
) {
  const [tieOut, accountDefaults] = await Promise.all([
    getInventoryValuationTieOut(client, companyId, args.asOfDate),
    client
      .from("accountDefault")
      .select("inventoryAdjustmentVarianceAccount")
      .eq("companyId", companyId)
      .single()
  ]);
  if (tieOut.error) return tieOut;
  if (accountDefaults.error) return accountDefaults;

  const rows = (tieOut.data ?? []).filter(
    (row) => Math.abs(Number(row.variance)) > 0.005
  );
  if (rows.length === 0) {
    return {
      data: null,
      error: { message: "Nothing to reconcile — variance is zero" }
    };
  }

  const nextSequence = await getNextSequence(client, "journalEntry", companyId);
  if (nextSequence.error) return nextSequence;
  const journalEntryId = nextSequence.data;

  // Header + lines in one transaction — a partial failure must not leave an
  // orphaned Draft header behind.
  try {
    const journalId = await db.transaction().execute(async (trx) => {
      const journal = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          description: `Inventory subledger reconciliation as of ${args.asOfDate}`,
          postingDate: args.asOfDate,
          sourceType: "Manual" as const,
          status: "Draft" as const,
          companyId,
          createdBy: args.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("journalLine")
        .values(
          rows.flatMap((row) => {
            const variance = Number(row.variance);
            const journalLineReference = crypto.randomUUID();
            return [
              {
                journalId: journal.id,
                accountId: row.accountId,
                description: `Reconcile ${row.accountName} to subledger`,
                amount: variance,
                journalLineReference,
                companyId
              },
              {
                journalId: journal.id,
                accountId:
                  accountDefaults.data.inventoryAdjustmentVarianceAccount,
                description: "Inventory Adjustment",
                amount: -variance,
                journalLineReference,
                companyId
              }
            ];
          })
        )
        .execute();

      return journal.id;
    });
    return { data: { journalId }, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to create reconciliation journal"
      }
    };
  }
}

export async function getKanbans(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("kanbans")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getKanban(
  client: SupabaseClient<Database>,
  kanbanId: string,
  companyId: string
) {
  // Scoped by company, not left to RLS: a user in several companies can read
  // every one of their companies' kanbans, and a scan acts in the ACTIVE one.
  return client
    .from("kanbans")
    .select("*")
    .eq("id", kanbanId)
    .eq("companyId", companyId)
    .single();
}

export async function getKanbanProjectedQuantities(
  client: SupabaseClient<Database>,
  companyId: string,
  kanbanIds: string[]
) {
  // Projected quantity at each armed Transfer kanban's To storage unit:
  // on-hand plus the outstanding quantity of open transfers into it.
  return client.rpc("get_kanban_projected_quantities", {
    company_id: companyId,
    kanban_ids: kanbanIds
  });
}

export async function getStockTransfer(
  client: SupabaseClient<Database>,
  stockTransferId: string
) {
  return client
    .from("stockTransfer")
    .select("*")
    .eq("id", stockTransferId)
    .single();
}

export async function getStockTransferLine(
  client: SupabaseClient<Database>,
  stockTransferLineId: string
) {
  return client
    .from("stockTransferLines")
    .select("*")
    .eq("id", stockTransferLineId)
    .single();
}

export async function getStockTransferLines(
  client: SupabaseClient<Database>,
  stockTransferId: string
) {
  return client
    .from("stockTransferLines")
    .select("*")
    .eq("stockTransferId", stockTransferId)
    .order("itemReadableId", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getStockTransferTracking(
  client: SupabaseClient<Database>,
  stockTransferId: string,
  companyId: string
) {
  return client
    .from("trackedActivity")
    .select("attributes, trackedActivityInput(trackedEntityId)")
    .eq("sourceDocument", "Stock Transfer")
    .eq("sourceDocumentId", stockTransferId)
    .eq("companyId", companyId);
}

export async function getStockTransfers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    locationId: string | null;
  }
) {
  let query = client
    .from("stockTransfer")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("stockTransferId", `%${args.search}%`);
  }

  if (args.locationId) {
    query = query.eq("locationId", args.locationId);
  }

  // "source" is derived: Kanban means the transfer has a kanbanId, Manual
  // means it has none. There is no source column, so translate it into a
  // kanbanId null test and keep it out of the generic column filters.
  const sourceFilters: Filter[] = [];
  const columnFilters: Filter[] = [];
  for (const filter of args.filters ?? []) {
    (filter.column === "source" ? sourceFilters : columnFilters).push(filter);
  }
  for (const filter of sourceFilters) {
    if (filter.value === "Kanban") {
      query = query.not("kanbanId", "is", null);
    } else if (filter.value === "Manual") {
      query = query.is("kanbanId", null);
    }
  }

  query = setGenericQueryFilters(query, { ...args, filters: columnFilters }, [
    { column: "stockTransferId", ascending: false }
  ]);
  return query;
}

export async function getDefaultStorageUnitOrStorageUnitWithHighestQuantity(
  client: SupabaseClient<Database>,
  itemId: string,
  locationId: string,
  companyId: string
) {
  const pickMethod = await client
    .from("pickMethod")
    .select("defaultStorageUnitId")
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (pickMethod.data?.defaultStorageUnitId)
    return pickMethod.data.defaultStorageUnitId;

  const storageUnits = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );

  const storageUnitWithHighestQuantity = storageUnits.data?.reduce(
    (acc, curr) => {
      return acc.quantity > curr.quantity
        ? acc
        : { ...curr, quantity: acc.quantity, storageUnitId: acc.storageUnitId };
    },
    { quantity: 0, storageUnitId: null }
  );

  return storageUnitWithHighestQuantity?.storageUnitId ?? null;
}

export async function getReceipts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("receipt")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId)
    .neq("sourceDocumentId", "");

  if (args.search) {
    query = query.or(
      `receiptId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "receiptId", ascending: false }
  ]);
  return query;
}

export async function getReceipt(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receipt").select("*").eq("id", receiptId).single();
}

export async function getReceiptLines(
  client: SupabaseClient<Database>,
  receiptId: string
) {
  return client.from("receiptLines").select("*").eq("receiptId", receiptId);
}

/**
 * The documents around a receipt that its own row doesn't name: the purchase
 * invoices raised against its supplier interaction (the PO's, so every
 * receipt of that order shares them), and — for a customer return — the
 * customer it came back from.
 */
export async function getReceiptRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierInteractionId: string | null,
  salesReturnOrderId: string | null
) {
  const [invoices, salesReturnOrder] = await Promise.all([
    supplierInteractionId
      ? client
          .from("purchaseInvoice")
          .select("id, invoiceId, status")
          .eq("supplierInteractionId", supplierInteractionId)
          .eq("companyId", companyId)
          .order("createdAt")
      : null,
    salesReturnOrderId
      ? client
          .from("salesReturnOrder")
          .select("customerId")
          .eq("id", salesReturnOrderId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);

  if (invoices?.error) {
    logger.error("Failed to get receipt purchase invoices", {
      companyId,
      supplierInteractionId,
      error: invoices.error
    });
  }
  if (salesReturnOrder?.error) {
    logger.error("Failed to get receipt sales return order", {
      companyId,
      salesReturnOrderId,
      error: salesReturnOrder.error
    });
  }

  return {
    invoices: invoices?.data ?? [],
    customerId: salesReturnOrder?.data?.customerId ?? null
  };
}

export async function getReceiptLineTracking(
  client: SupabaseClient<Database>,
  receiptLineId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Receipt Line", receiptLineId)
    .eq("companyId", companyId);
}

/**
 * Deletes stale serial tracked entities for a receipt's serial-tracked lines
 * before posting. Post-receipt flips one serial per index in
 * [0, receivedQuantity) to Available; orphaned (reduced quantity) or duplicate
 * (edited serial) entities would otherwise become phantom Available serials.
 * The keep/delete decision is owned by `reconcileReceiptLineSerials` so it
 * stays in lockstep with the post-time validation in ReceiptPostModal.
 */
export async function reconcileReceiptSerialEntities(
  client: SupabaseClient<Database>,
  args: {
    receiptId: string;
    companyId: string;
    lines: {
      id: string;
      receivedQuantity: number | null;
      requiresSerialTracking?: boolean | null;
    }[];
  }
) {
  const serialLines = args.lines.filter((line) => line.requiresSerialTracking);
  if (serialLines.length === 0) return;

  const { data: serialEntities } = await client
    .from("trackedEntity")
    .select("id, attributes, createdAt, readableId")
    .eq("attributes ->> Receipt", args.receiptId)
    .eq("companyId", args.companyId);

  const idsToDelete = serialLines.flatMap((line) => {
    const entities = (serialEntities ?? [])
      .filter(
        (e) =>
          (e.attributes as TrackedEntityAttributes)?.["Receipt Line"] ===
          line.id
      )
      .map((e) => ({
        id: e.id,
        index: (e.attributes as TrackedEntityAttributes)?.[
          "Receipt Line Index"
        ],
        hasSerial: !!e.readableId,
        createdAt: e.createdAt
      }));
    return reconcileReceiptLineSerials(
      entities,
      Number(line.receivedQuantity ?? 0)
    ).surplusEntityIds;
  });

  if (idsToDelete.length > 0) {
    await client
      .from("trackedEntity")
      .delete()
      .in("id", idsToDelete)
      .eq("companyId", args.companyId);
  }
}

export async function getReceiptFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  lineIds: string[]
): Promise<{ data: StorageItem[]; error: string | null }> {
  const promises = lineIds.map((lineId) =>
    storage(client)
      .company(companyId)
      .list(`${companyId}/inventory/${lineId}`)
      .then((result) => ({
        ...result,
        lineId
      }))
  );

  const results = await Promise.all(promises);

  const firstError = results.find((result) => result.error)?.error;
  if (firstError) {
    return { data: [], error: firstError.message || "Failed to fetch files" };
  }

  // Merge data arrays and add lineId as bucketName
  return {
    data: results.flatMap((result) =>
      (result.data ?? []).map((file) => ({
        ...file,
        bucket: result.lineId
      }))
    ),
    error: null
  };
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  // Smart default order: expiring soonest first (FEFO, nulls last), then oldest
  // first (FIFO). Surfaces that don't use the TrackedEntityPicker still get a
  // sensible pick order; the picker re-sorts client-side when the user switches.
  let query = client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .eq("quantity", 1)
    .order("expirationDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });

  return query;
}

/**
 * Available tracked entities for an item at a location, one row per entity, with
 * its bin, on-hand, and FEFO/FIFO order keys — for the shared TrackedEntityPicker.
 * `excludeLineside` drops lineside (work-center) bins (picking sources from the
 * warehouse). `excludeAllocated` nets out quantities already allocated to other
 * non-cancelled picking lines so the same lot is never recommended twice;
 * `excludeLineId` keeps the current line's own allocation visible.
 */
export async function getAvailableTrackedEntities(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    locationId: string;
    excludeLineside?: boolean;
    excludeAllocated?: boolean;
    excludeLineId?: string | null;
    /** Only lots in this bin; `id: null` is the unassigned bin. */
    inStorageUnit?: { id: string | null };
  }
) {
  return client.rpc("get_available_tracked_entities", {
    p_item_id: args.itemId,
    p_company_id: args.companyId,
    p_location_id: args.locationId,
    p_exclude_lineside: args.excludeLineside ?? false,
    p_exclude_allocated: args.excludeAllocated ?? false,
    p_exclude_line_id: args.excludeLineId ?? undefined,
    p_filter_storage_unit: args.inStorageUnit !== undefined,
    p_storage_unit_id: args.inStorageUnit?.id ?? undefined
  });
}

/**
 * The configured tracked-entity pick order for an item at a location, used as
 * the picker's default sort. Falls back to "Default" (smart) when unset.
 */
export async function getPickOrder(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<Database["public"]["Enums"]["pickMethodSortMethod"]> {
  const { data } = await client
    .from("pickMethod")
    .select("sortMethod")
    .eq("itemId", args.itemId)
    .eq("locationId", args.locationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  return data?.sortMethod ?? "Default";
}

export async function getBatchNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    isReadOnly?: boolean;
  }
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .eq("sourceDocumentId", args.itemId)
    .eq("companyId", args.companyId)
    .gte("quantity", 1)
    .order("expirationDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });
}

export async function getStorageUnitsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageUnit", "id, name", (query) =>
    query.eq("active", true).eq("companyId", companyId).order("name")
  );
}

export async function getStorageUnitsListForLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageUnit", "id, name", (query) =>
    query
      .eq("active", true)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .order("name")
  );
}

// Tree shape from storageUnits_recursive view: each row has its 1-based depth
// and the full ancestorPath (root → node ids). Sort by ancestorPath so the
// caller can render a flat list that visually nests by depth.
export async function getStorageUnitsTreeForLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    parentId: string | null;
    depth: number;
    ancestorPath: string[];
  }>(
    client,
    "storageUnits_recursive",
    "id, name, parentId, depth, ancestorPath",
    (query) =>
      query
        .eq("active", true)
        .eq("companyId", companyId)
        .eq("locationId", locationId)
  );
}

export async function getStorageUnits(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  // Query the recursive view so the table gets depth + ancestorPath + parentId
  // for tree rendering (indentation, hierarchy filters, subtree rollups).
  let query = client
    .from("storageUnits_recursive")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  // Default ordering: breadth-first by ancestorPath so parents render before
  // children in the table. Caller-supplied sorts override when provided.
  query = setGenericQueryFilters(query, args, [
    { column: "ancestorPath", ascending: true }
  ]);

  return query;
}

export async function getStorageUnit(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client
    .from("storageUnit")
    .select("*")
    .eq("id", storageUnitId)
    .single();
}

export async function getEffectiveWorkCenterId(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client.rpc("get_effective_work_center_id", {
    p_storage_unit_id: storageUnitId
  });
}

// Roots only (depth = 1). Honors search/filter/pagination so the table can
// paginate top-level storage units while children load lazily on demand.
export async function getStorageUnitRoots(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("storageUnits_recursive")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .eq("depth", 1);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);

  return query;
}

// Immediate children of a single parent (one level deep). Used by the lazy
// expand handler in the StorageUnits table.
export async function getStorageUnitChildren(
  client: SupabaseClient<Database>,
  parentId: string
) {
  return client
    .from("storageUnits_recursive")
    .select("*")
    .eq("parentId", parentId)
    .order("name");
}

// Descendants of the given root ids, from just below the roots (depth > 1) down
// to `maxDepth` inclusive. A node is a descendant of a root when that root
// appears in its ancestorPath, so a single `overlaps` query returns the
// subtrees in one round trip. Used to render the tree expanded by default;
// the depth cap keeps very deep trees from loading their entire subtree
// eagerly — anything below `maxDepth` still lazy-loads on demand.
export async function getStorageUnitSubtrees(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  rootIds: string[],
  maxDepth: number
) {
  if (rootIds.length === 0) {
    return { data: [] as any[], error: null };
  }
  return client
    .from("storageUnits_recursive")
    .select("*")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .gt("depth", 1)
    .lte("depth", maxDepth)
    .overlaps("ancestorPath", rootIds)
    .order("name");
}

// Set of storageUnit ids that have at least one child in the given location.
// Drives whether the table renders an expand chevron on a row.
export async function getStorageUnitParentIdsWithChildren(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  const { data, error } = await client
    .from("storageUnit")
    .select("parentId")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .not("parentId", "is", null);

  if (error) return { data: [] as string[], error };

  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.parentId) ids.add(row.parentId);
  }
  return { data: Array.from(ids), error: null };
}

// Search-mode payload: every storage unit whose name matches `search` PLUS
// every ancestor of each match, so the tree path renders intact. Returns the
// flat ordered row set + the parentIds that should be pre-expanded so that
// matches are visible to the user.
export async function searchStorageUnitsWithAncestors(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  search: string
) {
  const matches = await client
    .from("storageUnits_recursive")
    .select("id, parentId, ancestorPath")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .ilike("name", `%${search}%`);

  if (matches.error)
    return { rows: [], expandedParentIds: [], error: matches.error };

  const idsToFetch = new Set<string>();
  const expanded = new Set<string>();
  for (const row of matches.data ?? []) {
    for (const ancestorId of row.ancestorPath ?? []) {
      idsToFetch.add(ancestorId);
    }
    // Pre-expand every node on the chain except the match itself, so the
    // match becomes visible. ancestorPath includes the node itself at the end.
    for (const ancestorId of (row.ancestorPath ?? []).slice(0, -1)) {
      expanded.add(ancestorId);
    }
  }

  if (idsToFetch.size === 0) {
    return { rows: [], expandedParentIds: [], error: null };
  }

  const rows = await client
    .from("storageUnits_recursive")
    .select("*")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .in("id", Array.from(idsToFetch))
    .order("ancestorPath");

  if (rows.error) return { rows: [], expandedParentIds: [], error: rows.error };

  return {
    rows: rows.data ?? [],
    expandedParentIds: Array.from(expanded),
    error: null
  };
}

export async function getStockMovements(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("itemLedgers")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    // Strip characters that are structural in a PostgREST `.or(...)` filter
    // (comma separates conditions, parens group them) so the search value can't
    // alter the filter shape.
    const search = args.search.replace(/[,()\\]/g, " ");
    query = query.or(
      `itemReadableId.ilike.%${search}%,itemDescription.ilike.%${search}%,locationName.ilike.%${search}%,storageUnitName.ilike.%${search}%,trackedEntityReadableId.ilike.%${search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false },
    { column: "entryNumber", ascending: false }
  ]);
  return query;
}

export async function getShipments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("shipment")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId)
    .neq("sourceDocumentId", "");

  if (args.search) {
    query = query.or(
      `shipmentId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "shipmentId", ascending: false }
  ]);
  return query;
}

export async function getShipment(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client.from("shipment").select("*").eq("id", shipmentId).single();
}

export async function getShipmentLines(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client
    .from("shipmentLines")
    .select("*, fulfillment(*, job(*))")
    .eq("shipmentId", shipmentId);
}

export async function getShipmentLinesWithDetails(
  client: SupabaseClient<Database>,
  shipmentId: string
) {
  return client.from("shipmentLines").select("*").eq("shipmentId", shipmentId);
}

export async function getShipmentFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  lineIds: string[]
): Promise<{ data: StorageItem[]; error: string | null }> {
  const promises = lineIds.map((lineId) =>
    storage(client)
      .company(companyId)
      .list(`${companyId}/inventory/${lineId}`)
      .then((result) => ({
        ...result,
        lineId
      }))
  );

  const results = await Promise.all(promises);

  const firstError = results.find((result) => result.error)?.error;
  if (firstError) {
    return { data: [], error: firstError.message || "Failed to fetch files" };
  }

  // Merge data arrays and add lineId as bucketName
  return {
    data: results.flatMap((result) =>
      (result.data ?? []).map((file) => ({
        ...file,
        bucket: result.lineId
      }))
    ),
    error: null
  };
}

export async function getShipmentRelatedItems(
  client: SupabaseClient<Database>,
  shipmentId: string,
  sourceDocumentId: string
) {
  const salesOrder = await client
    .from("salesOrder")
    .select("*")
    .eq("id", sourceDocumentId)
    .maybeSingle();

  if (salesOrder.error) {
    logger.error("Failed to get shipment sales order", {
      shipmentId,
      sourceDocumentId,
      error: salesOrder.error
    });
  }

  const invoices = await client
    .from("salesInvoice")
    .select("*")
    .or(
      `shipmentId.eq.${shipmentId},opportunityId.eq.${
        salesOrder.data?.opportunityId ?? ""
      }`
    );

  if (invoices.error) {
    logger.error("Failed to get shipment sales invoices", {
      shipmentId,
      error: invoices.error
    });
  }

  return {
    invoices: invoices.data ?? []
  };
}

export async function getRentalShipmentLines(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string
) {
  return (
    client
      .from("shipmentFixedAssetLine")
      .select(
        "id, shipped, meter, rentalAgreementLineId, rentalAgreementLine!shipmentFixedAssetLine_rentalAgreementLineId_fkey(id, status, lessorClassification, fixedAsset(id, fixedAssetId, name, serialNumber), item(name, readableIdWithRevision, thumbnailPath, type), trackedEntity(readableId))"
      )
      .eq("shipmentId", shipmentId)
      .eq("companyId", companyId)
      .not("rentalAgreementLineId", "is", null)
      // A document's units are inserted in one statement and share a createdAt;
      // without a tie-breaker an update reorders them.
      .order("createdAt")
      .order("id")
  );
}

export async function getRentalReceiptLines(
  client: SupabaseClient<Database>,
  receiptId: string,
  companyId: string
) {
  return (
    client
      .from("receiptFixedAssetLine")
      .select(
        "id, received, meter, notes, takeOutOfService, outOfServiceReason, residualDestination, rentalAgreementLineId, rentalAgreementLine!receiptFixedAssetLine_rentalAgreementLineId_fkey(id, status, lessorClassification, fixedAsset(id, fixedAssetId, name, serialNumber), item(name, readableIdWithRevision, thumbnailPath, type), trackedEntity(readableId))"
      )
      .eq("receiptId", receiptId)
      .eq("companyId", companyId)
      .not("rentalAgreementLineId", "is", null)
      // A document's units are inserted in one statement and share a createdAt;
      // without a tie-breaker an update reorders them.
      .order("createdAt")
      .order("id")
  );
}

export async function getShipmentLineTracking(
  client: SupabaseClient<Database>,
  shipmentLineId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Shipment Line", shipmentLineId)
    .eq("companyId", companyId);
}

export async function getShippingMethod(
  client: SupabaseClient<Database>,
  shippingMethodId: string
) {
  return client
    .from("shippingMethod")
    .select("*")
    .eq("id", shippingMethodId)
    .single();
}

export async function getShippingMethods(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("shippingMethod")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,carrier.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getShippingMethodsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("shippingMethod")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getShippingTermsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("shippingTerm")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

// Merge >=2 same-item Available lots into ONE new entity (fresh id, summed
// quantity, earliest expiry) with genealogy back to every parent. The issue
// server fn owns the writes; see `buildBatchMergeRecords` (@carbon/utils).
export async function mergeTrackedEntities(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    trackedEntityIds: string[];
    readableId?: string | null;
    companyId: string;
    userId: string;
  }
) {
  return serverFns
    .as({ client, db, companyId: args.companyId, userId: args.userId })
    .invoke("issue", {
      type: "mergeTrackedEntities",
      ...args
    });
}

export async function getTrackedEntities(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("trackedEntity")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId)
    .neq("status", "Reserved");

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "sourceDocumentReadableId", ascending: true }
  ]);
  return query;
}

export async function getTrackedEntitiesByMakeMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string,
  companyId: string
) {
  // Unit-axis order: position here is the `index` step records are stored
  // under, so it must be a pure function of immutable columns. `createdAt`
  // alone ties for bulk-minted serials and Postgres breaks the tie by physical
  // row order, which any UPDATE changes. Full reasoning on the MES copy
  // (`apps/mes/app/services/operations.service.ts`); keep the two identical.
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true })
    .order("readableId", { ascending: true })
    .order("id", { ascending: true });
}

export async function getTrackedEntity(
  client: SupabaseClient<Database>,
  trackedEntityId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("id", trackedEntityId)
    .single();
}

/**
 * Manual override of a tracked entity's expirationDate. Records the prior
 * value, the new value, and a reason on the entity's `attributes` JSONB
 * under the "expiryOverrides" array so the trace popover can show the
 * provenance later.
 *
 *   attributes.expiryOverrides = [
 *     {
 *       previous: "2026-04-25" | null,
 *       next:     "2026-05-10",
 *       reason:   "Re-tested and re-certified by QC",
 *       userId,
 *       at:       "2026-04-26T10:11:12Z"
 *     },
 *     ...
 *   ]
 */
export async function updateTrackedEntityExpiry(
  client: SupabaseClient<Database>,
  args: {
    trackedEntityId: string;
    expirationDate: string | null;
    reason: string;
    userId: string;
    source?: string;
  }
) {
  const existing = await client
    .from("trackedEntity")
    .select("expirationDate, attributes, status")
    .eq("id", args.trackedEntityId)
    .single();
  if (existing.error) return existing;

  if (existing.data?.status === "Consumed") {
    return {
      data: null,
      error: {
        message: "Cannot edit expiry of a consumed tracked entity"
      } as unknown as PostgrestError
    };
  }

  const prevAttrs =
    (existing.data?.attributes as Record<string, unknown> | null) ?? {};
  const prevHistory = Array.isArray(prevAttrs.expiryOverrides)
    ? (prevAttrs.expiryOverrides as Record<string, unknown>[])
    : [];

  const nextAttrs = {
    ...prevAttrs,
    expiryOverrides: [
      ...prevHistory,
      {
        previous: existing.data?.expirationDate ?? null,
        next: args.expirationDate,
        reason: args.reason,
        source: args.source ?? null,
        userId: args.userId,
        at: datetime.timestamp()
      }
    ]
  };

  return client
    .from("trackedEntity")
    .update({
      expirationDate: args.expirationDate,
      attributes: nextAttrs as unknown as Json
    })
    .eq("id", args.trackedEntityId);
}

export async function getTrackedEntitiesByOperationId(
  client: SupabaseClient<Database>,
  operationId: string,
  companyId: string
) {
  const jobOperation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", operationId)
    .eq("companyId", companyId)
    .single();

  if (jobOperation.error || !jobOperation.data.jobMakeMethodId)
    return {
      data: null,
      error: jobOperation.error
    };

  return getTrackedEntitiesByMakeMethodId(
    client,
    jobOperation.data.jobMakeMethodId,
    companyId
  );
}

export async function getWarehouseTransfers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("warehouseTransfer")
    .select(
      "*, fromLocation:location!fromLocationId(name), toLocation:location!toLocationId(name)",
      {
        count: LIST_COUNT
      }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `transferId.ilike.%${args.search}%,reference.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "transferId", ascending: false }
  ]);
  return query;
}

export async function getWarehouseTransfer(
  client: SupabaseClient<Database>,
  transferId: string
) {
  return client
    .from("warehouseTransfer")
    .select(
      "*, fromLocation:location!fromLocationId(*), toLocation:location!toLocationId(*)"
    )
    .eq("id", transferId)
    .single();
}

/**
 * The documents a warehouse transfer has raised: the shipments that send it
 * out of the source location and the receipts that take it in at the
 * destination.
 */
export async function getWarehouseTransferRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  transferId: string
) {
  const [shipments, receipts] = await Promise.all([
    client
      .from("shipment")
      .select("id, shipmentId, status")
      .eq("sourceDocument", "Outbound Transfer")
      .eq("sourceDocumentId", transferId)
      .eq("companyId", companyId)
      .order("createdAt"),
    client
      .from("receipt")
      .select("id, receiptId, status")
      .eq("sourceDocument", "Inbound Transfer")
      .eq("sourceDocumentId", transferId)
      .eq("companyId", companyId)
      .order("createdAt")
  ]);

  if (shipments.error) {
    logger.error("Failed to get warehouse transfer shipments", {
      companyId,
      transferId,
      error: shipments.error
    });
  }
  if (receipts.error) {
    logger.error("Failed to get warehouse transfer receipts", {
      companyId,
      transferId,
      error: receipts.error
    });
  }

  return {
    shipments: shipments.data ?? [],
    receipts: receipts.data ?? []
  };
}

export async function getWarehouseTransferLine(
  client: SupabaseClient<Database>,
  transferId: string,
  lineId: string
) {
  return client
    .from("warehouseTransferLine")
    .select(
      "*, warehouseTransfer(*, fromLocation:location!fromLocationId(name), toLocation:location!toLocationId(name))"
    )
    .eq("id", lineId)
    .eq("transferId", transferId)
    .single();
}

export async function getWarehouseTransferLines(
  client: SupabaseClient<Database>,
  transferId: string
) {
  return client
    .from("warehouseTransferLine")
    .select(
      "*, item(*), fromStorageUnit:storageUnit!fromStorageUnitId(name), toStorageUnit:storageUnit!toStorageUnitId(name)"
    )
    .eq("transferId", transferId);
}

// Thin wrapper over the post-inventory-adjustment server function — the single
// write path for manual adjustments (shared with MES). The server function owns
// Set Quantity resolution, storage-unit transfers, serial/batch stock-target
// resolution, tracked-entity updates, cost layers, and GL posting (Provisional
// before the accounting cutover) in one transaction.
/**
 * Not published: it runs no storage rules; `inventory.item.adjust` runs them
 * and then this.
 */
export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  // `requiresSerialTracking` is a form-only flag for the validator's serial
  // quantity guard — the route strips it before calling this.
  inventoryAdjustment: Omit<
    z.infer<typeof inventoryAdjustmentValidator>,
    "requiresSerialTracking"
  > & {
    companyId: string;
    createdBy: string;
  }
) {
  const { companyId, createdBy, ...adjustment } = inventoryAdjustment;

  const result = await serverFns
    .as({ client, db, companyId, userId: createdBy })
    .invoke("post-inventory-adjustment", {
      ...adjustment
    });

  if (result.error) {
    // Bare-string error, matching the old service's validation-branch
    // contract — the adjustment route compares `error === "<message>"`.
    return {
      data: null,
      error: getErrorMessage(
        result.error,
        "Failed to create manual inventory adjustment"
      )
    };
  }

  return { data: result.data?.itemLedger ?? null, error: null };
}

// Authoritative effective quantity for a movement's correction group: resolve
// the ultimate root by walking correctionOfItemLedgerId, then sum the root and
// every correction in the group (BFS — historical count corrections chained
// fix→fix). Mirrors the walk inside the correct-stock-movement server function;
// the modal pre-fills from this so the user never submits a value derived from
// an incomplete page of movements.
export async function getStockMovementEffectiveQuantity(
  client: SupabaseClient<Database>,
  companyId: string,
  itemLedgerId: string
) {
  const original = await client
    .from("itemLedger")
    .select("id, quantity, correctionOfItemLedgerId")
    .eq("id", itemLedgerId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (original.error || !original.data) {
    return { data: null, error: original.error ?? "Stock movement not found" };
  }

  let root = original.data;
  for (let depth = 0; root.correctionOfItemLedgerId && depth < 100; depth++) {
    const parent = await client
      .from("itemLedger")
      .select("id, quantity, correctionOfItemLedgerId")
      .eq("id", root.correctionOfItemLedgerId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (parent.error) return { data: null, error: parent.error };
    if (!parent.data) break;
    root = parent.data;
  }

  let effectiveQuantity = Number(root.quantity);
  let frontier = [root.id];
  const seen = new Set<string>([root.id]);
  while (frontier.length > 0) {
    const children = await client
      .from("itemLedger")
      .select("id, quantity")
      .in("correctionOfItemLedgerId", frontier)
      .eq("companyId", companyId);
    if (children.error) return { data: null, error: children.error };
    frontier = [];
    for (const child of children.data ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      effectiveQuantity += Number(child.quantity);
      frontier.push(child.id);
    }
  }

  return { data: { rootId: root.id, effectiveQuantity }, error: null };
}

// Books ONE opposite (delta) movement linked to the corrected movement via
// correctionOfItemLedgerId, dated with the original's postingDate and posted
// into the original's accounting period (the correct-stock-movement operation).
export async function correctStockMovement(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  correction: z.infer<typeof stockMovementCorrectionValidator> & {
    itemLedgerId: string;
    companyId: string;
    createdBy: string;
  }
) {
  const { companyId, createdBy, ...rest } = correction;

  const result = await serverFns
    .as({ client, db, companyId, userId: createdBy })
    .invoke("correct-stock-movement", {
      ...rest
    });

  if (result.error) {
    return {
      data: null,
      error: getErrorMessage(result.error, "Failed to correct stock movement")
    };
  }

  return { data: result.data.itemLedger, error: null };
}

// ===========================================================================
// Inventory Count / Cycle Count
// ===========================================================================

export async function getInventoryCounts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("inventoryCount")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("inventoryCountId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "inventoryCountId", ascending: false }
  ]);
  return query;
}

export async function getInventoryCount(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("inventoryCount")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getInventoryCountLines(
  client: SupabaseClient<Database>,
  inventoryCountId: string,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  // Read from the `inventoryCountLines` view: it flattens item + material +
  // storage-unit attributes as top-level columns so the count detail table can
  // apply the same generic column filters the quantities screen does.
  let query = client
    .from("inventoryCountLines")
    .select("*", { count: LIST_COUNT })
    .eq("inventoryCountId", inventoryCountId)
    .eq("companyId", companyId);

  if (args.search) {
    // Strip characters that are structural in a PostgREST `.or(...)` filter so
    // the search value can't alter the filter shape.
    const search = args.search.replace(/[,()\\]/g, " ");
    // Search the item's identity (part number / name); the line's own readableId
    // is only the batch/serial and is null for most rows.
    query = query.or(
      `itemName.ilike.%${search}%,itemReadableIdWithRevision.ilike.%${search}%`
    );
  }

  // Snapshot lines all share one insert timestamp, so order by the item's part
  // number for a readable count sheet and fall back to the line id for a stable,
  // deterministic order.
  query = setGenericQueryFilters(query, args, [
    { column: "itemReadableIdWithRevision", ascending: true },
    { column: "id", ascending: true }
  ]);
  return query;
}

// Aggregate counts for the confirm dialog. Computed server-side so the warnings
// stay accurate regardless of which page of lines is currently loaded.
export async function getInventoryCountLineSummary(
  client: SupabaseClient<Database>,
  inventoryCountId: string,
  companyId: string
) {
  const base = () =>
    client
      .from("inventoryCountLine")
      .select("id", { count: "exact", head: true })
      .eq("inventoryCountId", inventoryCountId)
      .eq("companyId", companyId);

  const [uncounted, variances] = await Promise.all([
    base().is("countedQuantity", null),
    base().not("countedQuantity", "is", null).not("variance", "eq", 0)
  ]);

  return {
    uncounted: uncounted.count ?? 0,
    variances: variances.count ?? 0
  };
}

// Every item-ledger adjustment a count posted (including stock-movement
// corrections, which copy the count's documentType/documentId), found via the
// movement's `documentType`/`documentId` back-reference. Used to show a posted
// count what it actually did to inventory. Chronological.
export async function getInventoryCountMovements(
  client: SupabaseClient<Database>,
  companyId: string,
  inventoryCountId: string
) {
  return client
    .from("itemLedgers")
    .select("*")
    .eq("companyId", companyId)
    .eq("documentType", "Inventory Count")
    .eq("documentId", inventoryCountId)
    .order("createdAt", { ascending: true })
    .order("entryNumber", { ascending: true });
}

// Counts are created once and never edited as a header (only their lines and
// status change), so this is insert-only — no upsert/update branch.
/** Not published: a count with no lines; `inventory.inventoryCount.create` creates and snapshots it. */
export async function insertInventoryCount(
  client: SupabaseClient<Database>,
  inventoryCount: {
    inventoryCountId: string;
    locationId: string;
    isBlind: boolean;
    notes?: string | null;
    scope?: Json;
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("inventoryCount")
    .insert([inventoryCount])
    .select("id")
    .single();
}

export async function deleteInventoryCount(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("inventoryCount")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// Snapshot the current on-hand into count lines: one line per
// (item, storage unit, tracked entity) bucket that has any ledger history in
// scope — positive, negative, or net-zero — so the counter can verify expected-
// empty bins and correct discrepancies. On-hand is summed from `itemLedger`
// (status-aware: excludes Rejected, matching `get_inventory_quantities`).
// Idempotent: safe to re-run to re-snapshot while the count is Draft.
export async function generateInventoryCountLines(
  db: Kysely<KyselyDatabase>,
  args: {
    inventoryCountId: string;
    companyId: string;
    locationId: string;
    createdBy: string;
    storageUnitIds?: string[];
    itemType?: string;
  }
) {
  const {
    inventoryCountId,
    companyId,
    locationId,
    createdBy,
    storageUnitIds,
    itemType
  } = args;

  return db.transaction().execute(async (trx) => {
    let aggregate = trx
      .selectFrom("itemLedger")
      .innerJoin("item", "item.id", "itemLedger.itemId")
      .select([
        "itemLedger.itemId as itemId",
        "itemLedger.storageUnitId as storageUnitId",
        "itemLedger.trackedEntityId as trackedEntityId"
      ])
      .select((eb) => eb.fn.sum<number>("itemLedger.quantity").as("quantity"))
      .where("itemLedger.companyId", "=", companyId)
      .where("itemLedger.locationId", "=", locationId)
      // Status-aware on-hand: exclude Rejected and Consumed lots so a count
      // never lists stock that's been used up or scrapped. Non-tracked rows
      // have a NULL status and are always included.
      .where((eb) =>
        eb.or([
          eb("itemLedger.trackedEntityStatus", "is", null),
          eb("itemLedger.trackedEntityStatus", "not in", [
            "Rejected",
            "Consumed"
          ])
        ])
      )
      .groupBy([
        "itemLedger.itemId",
        "itemLedger.storageUnitId",
        "itemLedger.trackedEntityId"
      ]);
    // Drop blank entries — an unselected storage-unit field submits [""], which
    // would otherwise filter to `storageUnitId IN ('')` and match no stock.
    const scopedStorageUnitIds = storageUnitIds?.filter(Boolean) ?? [];
    if (scopedStorageUnitIds.length > 0) {
      aggregate = aggregate.where(
        "itemLedger.storageUnitId",
        "in",
        scopedStorageUnitIds
      );
    }

    if (itemType) {
      aggregate = aggregate.where(
        "item.type",
        "=",
        itemType as Database["public"]["Enums"]["itemType"]
      );
    }

    const buckets = await aggregate.execute();

    // Resolve denormalized tracked-entity labels for the snapshot lines.
    const trackedEntityIds = buckets
      .map((b) => b.trackedEntityId)
      .filter((id): id is string => Boolean(id));

    const trackedEntities = trackedEntityIds.length
      ? await trx
          .selectFrom("trackedEntity")
          .select(["id", "readableId"])
          .where("id", "in", trackedEntityIds)
          .where("companyId", "=", companyId)
          .execute()
      : [];

    const readableIdByEntity = new Map(
      trackedEntities.map((te) => [te.id, te.readableId])
    );

    // Regenerate from scratch (only valid while Draft).
    await trx
      .deleteFrom("inventoryCountLine")
      .where("inventoryCountId", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .execute();

    if (buckets.length > 0) {
      await trx
        .insertInto("inventoryCountLine")
        .values(
          buckets.map((bucket) => ({
            inventoryCountId,
            companyId,
            itemId: bucket.itemId,
            locationId,
            storageUnitId: bucket.storageUnitId,
            trackedEntityId: bucket.trackedEntityId,
            readableId: bucket.trackedEntityId
              ? (readableIdByEntity.get(bucket.trackedEntityId) ?? null)
              : null,
            systemQuantity: Number(bucket.quantity ?? 0),
            createdBy
          }))
        )
        .execute();
    }

    await trx
      .updateTable("inventoryCount")
      .set({ snapshotAt: new Date().toISOString() })
      .where("id", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .execute();

    return buckets.length;
  });
}

// Persist a single line's counted quantity. Uses Kysely so the Draft-only guard
// is part of the same statement: the EXISTS subquery checks the parent count is
// still Draft *atomically* with the write, closing the TOCTOU window a separate
// read-then-update would leave open (a concurrent Confirm can't slip in between).
// Returns the updated row id, or undefined when the line doesn't exist or the
// count is no longer Draft. Kysely bypasses RLS — authorize at the route first.
export async function updateInventoryCountLine(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof inventoryCountLineValidator> & {
    companyId: string;
    countedBy: string;
  }
) {
  const { id, countedQuantity, companyId, countedBy } = args;
  const now = new Date().toISOString();
  // Clearing a count (null) un-counts the line, so the count audit fields are
  // cleared too; only an actual count stamps countedBy/countedAt.
  const isCounted = countedQuantity !== undefined && countedQuantity !== null;
  return db
    .updateTable("inventoryCountLine")
    .set({
      countedQuantity: countedQuantity ?? null,
      countedBy: isCounted ? countedBy : null,
      countedAt: isCounted ? now : null,
      updatedBy: countedBy,
      updatedAt: now
    })
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("inventoryCount")
          .select("inventoryCount.id")
          .whereRef(
            "inventoryCount.id",
            "=",
            "inventoryCountLine.inventoryCountId"
          )
          .where("inventoryCount.companyId", "=", companyId)
          // Counted quantities are entered while the count is Draft; once it
          // moves on (Pending/Posted) the lines are no longer writable.
          .where("inventoryCount.status", "=", "Draft")
      )
    )
    .returning("id")
    .executeTakeFirst();
}

export async function updateInventoryCountStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    status: Database["public"]["Enums"]["inventoryCountStatus"];
    updatedBy: string;
    // When set, the transition only applies if the row is still in this status.
    // The `.eq("status", expectedStatus)` makes the read-then-write atomic, so a
    // concurrent transition can't be clobbered (0 rows matched → `.single()`
    // errors and the caller surfaces a failure).
    expectedStatus?: Database["public"]["Enums"]["inventoryCountStatus"];
  }
) {
  const { id, companyId, status, updatedBy, expectedStatus } = args;
  let query = client
    .from("inventoryCount")
    .update({ status, updatedBy, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .eq("companyId", companyId);
  if (expectedStatus) query = query.eq("status", expectedStatus);
  return query.select("id").single();
}

export async function updateBatchPropertyOrder(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof batchPropertyOrderValidator>,
    "batchPropertyGroupId"
  > & {
    batchPropertyGroupId?: string | null;
    updatedBy: string;
  }
) {
  // batchProperty has no group column; the group is not stored.
  const { batchPropertyGroupId: _group, ...order } = data;
  return client.from("batchProperty").update(sanitize(order)).eq("id", data.id);
}

/**
 * Set a stock transfer's status, and nothing else. Not published:
 * `inventory.stockTransfer.setStatus` also runs storage rules and the reopen
 * permission check.
 */
export async function updateStockTransferStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: Database["public"]["Enums"]["stockTransferStatus"];
    assignee?: string | null;
    completedAt: string | null;
    updatedBy: string;
  }
) {
  const { id, status, assignee, completedAt, updatedBy } = args;
  return client
    .from("stockTransfer")
    .update({
      status,
      assignee,
      completedAt,
      updatedBy
    })
    .eq("id", id);
}

export async function upsertBatchProperty(
  client: SupabaseClient<Database>,
  batchProperty: z.infer<typeof batchPropertyValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const {
    userId,
    configurationParameterGroupId: _group,
    ...data
  } = batchProperty;
  if (batchProperty.id) {
    return client
      .from("batchProperty")
      .update(
        sanitize({
          ...data,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
      )
      .eq("id", batchProperty.id);
  }

  return client.from("batchProperty").insert({
    ...data,
    createdBy: userId
  });
}

export async function upsertKanban(
  client: SupabaseClient<Database>,
  kanban:
    | (Omit<z.infer<typeof kanbanValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof kanbanValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // kanban has no customFields column.
  const { customFields: _customFields, ...row } = kanban;
  // zod omits a blank optional field, so a plain spread would keep the old
  // level on update. Write null when the field is blank or the kanban is not
  // a Transfer kanban.
  // The same goes for the From storage unit, which only a Transfer kanban uses:
  // switching a kanban to Buy or Make must not keep a stale source bin.
  const isTransfer = row.replenishmentSystem === "Transfer";
  const replenishmentLevel = isTransfer
    ? (row.replenishmentLevel ?? null)
    : null;
  const fromStorageUnitId = isTransfer ? (row.fromStorageUnitId ?? null) : null;
  if ("createdBy" in row) {
    return client
      .from("kanban")
      .insert({ ...row, replenishmentLevel, fromStorageUnitId })
      .select("id")
      .single();
  }
  // Scoped by company, not left to RLS: the update names its row by id, and a
  // user can belong to several companies.
  const { companyId, ...update } = row;
  return client
    .from("kanban")
    .update({
      ...sanitize(update),
      replenishmentLevel,
      fromStorageUnitId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", row.id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/**
 * Not published: a changed source document does not rebuild the lines;
 * `inventory.receipt.create` and `inventory.receipt.update` do.
 */
export async function upsertReceipt(
  client: SupabaseClient<Database>,
  receipt:
    | (Omit<z.infer<typeof receiptValidator>, "id" | "receiptId"> & {
        receiptId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof receiptValidator>, "id" | "receiptId"> & {
        id: string;
        receiptId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in receipt) {
    return client.from("receipt").insert([receipt]).select("*").single();
  }
  return client
    .from("receipt")
    .update({
      ...sanitize(receipt),
      updatedAt: datetime.timestamp()
    })
    .eq("id", receipt.id)
    .select("id")
    .single();
}

export async function upsertStorageUnit(
  client: SupabaseClient<Database>,
  storageUnit:
    | (Omit<z.infer<typeof storageUnitValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof storageUnitValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in storageUnit) {
    return client
      .from("storageUnit")
      .insert({
        ...storageUnit,
        id: nanoid()
      })
      .select("id")
      .single();
  }
  return client
    .from("storageUnit")
    .update({
      ...sanitize(storageUnit),
      updatedAt: datetime.timestamp()
    })
    .eq("id", storageUnit.id)
    .select("id")
    .single();
}

export async function upsertShippingMethod(
  client: SupabaseClient<Database>,
  shippingMethod:
    | (Omit<z.infer<typeof shippingMethodValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof shippingMethodValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in shippingMethod) {
    return client
      .from("shippingMethod")
      .insert([shippingMethod])
      .select("id")
      .single();
  }
  return client
    .from("shippingMethod")
    .update(sanitize(shippingMethod))
    .eq("id", shippingMethod.id)
    .select("id")
    .single();
}

/**
 * Not published: a changed source document does not rebuild the lines;
 * `inventory.shipment.create` and `inventory.shipment.update` do.
 */
export async function upsertShipment(
  client: SupabaseClient<Database>,
  shipment:
    | (Omit<z.infer<typeof shipmentValidator>, "id" | "shipmentId"> & {
        shipmentId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof shipmentValidator>, "id" | "shipmentId"> & {
        id: string;
        shipmentId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in shipment) {
    return client.from("shipment").insert([shipment]).select("*").single();
  }
  return client
    .from("shipment")
    .update({
      ...sanitize(shipment),
      updatedAt: datetime.timestamp()
    })
    .eq("id", shipment.id)
    .select("id")
    .single();
}

export async function upsertStockTransfer(
  client: SupabaseClient<Database>,
  stockTransfer:
    | {
        locationId: string;
        stockTransferId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        locationId: string;
        stockTransferId: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("createdBy" in stockTransfer) {
    return client
      .from("stockTransfer")
      .insert({
        ...stockTransfer,
        status: "Released"
      })
      .select("id")
      .single();
  }
  return client
    .from("stockTransfer")
    .update(sanitize(stockTransfer))
    .eq("id", stockTransfer.id)
    .select("id")
    .single();
}

export async function upsertStockTransferLine(
  client: SupabaseClient<Database>,
  stockTransferLine:
    | (Omit<z.infer<typeof stockTransferLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof stockTransferLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in stockTransferLine) {
    return client
      .from("stockTransferLine")
      .insert(stockTransferLine)
      .select("id")
      .single();
  }
  return client
    .from("stockTransferLine")
    .update(sanitize(stockTransferLine))
    .eq("id", stockTransferLine.id)
    .select("id")
    .single();
}

export async function upsertStockTransferLines(
  client: SupabaseClient<Database>,
  args: {
    lines: z.infer<typeof stockTransferValidator>["lines"];
    stockTransferId: string;
    companyId: string;
    createdBy: string;
  }
) {
  const { lines, stockTransferId, companyId, createdBy } = args;
  return client.from("stockTransferLine").insert(
    lines.map((line) => ({
      ...line,
      stockTransferId,
      companyId,
      createdBy
    }))
  );
}

export async function upsertWarehouseTransfer(
  client: SupabaseClient<Database>,
  transfer:
    | (Omit<z.infer<typeof warehouseTransferValidator>, "id" | "transferId"> & {
        transferId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof warehouseTransferValidator>, "id" | "transferId"> & {
        id: string;
        transferId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in transfer) {
    return client
      .from("warehouseTransfer")
      .insert([transfer])
      .select("*")
      .single();
  }
  return client
    .from("warehouseTransfer")
    .update({
      ...sanitize(transfer),
      updatedAt: datetime.timestamp()
    })
    .eq("id", transfer.id)
    .select("id")
    .single();
}

/**
 * Set a warehouse transfer's status, and nothing else. Not published:
 * `inventory.warehouseTransfer.setStatus` also runs storage rules.
 */
export async function updateWarehouseTransferStatus(
  client: SupabaseClient<Database>,
  transferId: string,
  status: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"],
  updatedBy: string
) {
  return client
    .from("warehouseTransfer")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", transferId);
}

/**
 * Not published: it skips the lock check `inventory.warehouseTransfer.line.create`
 * and `.update` make.
 */
export async function upsertWarehouseTransferLine(
  client: SupabaseClient<Database>,
  line:
    | Database["public"]["Tables"]["warehouseTransferLine"]["Insert"]
    | (Database["public"]["Tables"]["warehouseTransferLine"]["Update"] & {
        id: string;
      })
) {
  if ("id" in line && line.id) {
    const { id, ...updateData } = line;
    return client
      .from("warehouseTransferLine")
      .update({
        ...updateData,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();
  } else {
    return client
      .from("warehouseTransferLine")
      .insert({
        ...line,
        createdAt: new Date().toISOString()
      } as Database["public"]["Tables"]["warehouseTransferLine"]["Insert"])
      .select()
      .single();
  }
}

// ----------------------------------------------------------------------------
// storageUnit hierarchy helpers (backed by the storageUnits_recursive view
// defined in 20260417000200_storage-unit-nesting-and-type.sql)
// ----------------------------------------------------------------------------

export async function getStorageUnitTree(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return client
    .from("storageUnits_recursive")
    .select(
      "id, parentId, locationId, warehouseId, name, active, storageTypeIds, companyId, depth, ancestorPath"
    )
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("ancestorPath");
}

export async function getStorageUnitDescendants(
  client: SupabaseClient<Database>,
  storageUnitId: string
) {
  return client
    .from("storageUnits_recursive")
    .select(
      "id, parentId, locationId, warehouseId, name, active, storageTypeIds, companyId, depth, ancestorPath"
    )
    .contains("ancestorPath", [storageUnitId]);
}

export async function expandStorageUnitIdsWithDescendants(
  client: SupabaseClient<Database>,
  storageUnitIds: string[]
): Promise<string[]> {
  if (storageUnitIds.length === 0) return [];
  const { data } = await client
    .from("storageUnits_recursive")
    .select("id")
    .overlaps("ancestorPath", storageUnitIds);
  const expanded = new Set<string>(storageUnitIds);
  (data ?? []).forEach((row) => {
    if (row.id) expanded.add(row.id);
  });
  return Array.from(expanded);
}

// ----------------------------------------------------------------------------
// storageType CRUD (mirrors materialType in items.service.ts)
// ----------------------------------------------------------------------------

export async function getStorageTypeUsage(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("storageUnit")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .contains("storageTypeIds", [id])
    .limit(5);
}

export async function deleteStorageTypeWithCascade(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const { data: units, error: fetchError } = await client
    .from("storageUnit")
    .select("id, storageTypeIds")
    .eq("companyId", companyId)
    .contains("storageTypeIds", [id]);

  if (fetchError) return { error: fetchError };

  for (const unit of units ?? []) {
    const next = (unit.storageTypeIds ?? []).filter((x) => x !== id);
    const { error: updateError } = await client
      .from("storageUnit")
      .update({ storageTypeIds: next })
      .eq("id", unit.id);
    if (updateError) return { error: updateError };
  }

  return client.from("storageType").delete().eq("id", id);
}

export async function getStorageTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("storageType")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args ?? {}, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getStorageType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("storageType").select("*").eq("id", id).single();
}

export async function getStorageTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "storageType", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function upsertStorageType(
  client: SupabaseClient<Database>,
  storageType:
    | (Omit<z.infer<typeof storageTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof storageTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in storageType) {
    return client
      .from("storageType")
      .insert({ ...storageType })
      .select("id")
      .single();
  }
  return client
    .from("storageType")
    .update({
      ...sanitize(storageType),
      updatedAt: datetime.timestamp()
    })
    .eq("id", storageType.id)
    .select("id")
    .single();
}

export async function getShelfLifeForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
) {
  if (itemIds.length === 0) return { data: [], error: null };
  return client
    .from("itemShelfLife")
    .select("itemId, mode, days")
    .in("itemId", itemIds);
}

/**
 * Map of trackedEntityId → expirationDate (or null) for a set of ids.
 * Used by the inventory adjustment modal to prefill the date picker when
 * editing an existing batch / serial.
 */
export async function getTrackedEntityExpirations(
  client: SupabaseClient<Database>,
  trackedEntityIds: string[]
): Promise<Record<string, string | null>> {
  if (trackedEntityIds.length === 0) return {};
  const result = await client
    .from("trackedEntity")
    .select("id, expirationDate")
    .in("id", trackedEntityIds);
  return (result.data ?? []).reduce<Record<string, string | null>>(
    (acc, row) => {
      acc[row.id] = row.expirationDate ?? null;
      return acc;
    },
    {}
  );
}

// ----------------------------------------------------------------------------
// Picking List CRUD
// ----------------------------------------------------------------------------

export async function getPickingLists(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    assignee: string | null;
    locationId: string | null;
  }
) {
  let query = client
    .from("pickingLists")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("pickingListId", `%${args.search}%`);
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as "Draft" | "In Progress" | "Completed" | "Cancelled"
    );
  }

  if (args.assignee) {
    query = query.eq("assignee", args.assignee);
  }

  if (args.locationId) {
    query = query.eq("locationId", args.locationId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "pickingListId", ascending: false }
  ]);
  return query;
}

export async function getPickingList(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  return client
    .from("pickingList")
    .select(
      "*, location:location(name), assigneeUser:user!pickingList_assignee_fkey(fullName, avatarUrl)"
    )
    .eq("id", pickingListId)
    .single();
}

export async function getPicksByJobMaterial(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  const lines = await client
    .from("pickingListLine")
    .select(
      "jobMaterialId, itemId, quantityToPick, quantityPicked, quantityReturned, status, jobMaterial(itemId), pickingList!inner(id, pickingListId, status), item(readableIdWithRevision)"
    )
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .neq("status", "Cancelled")
    .neq("pickingList.status", "Cancelled");

  const byMaterial: Record<string, JobMaterialPick[]> = {};
  for (const line of lines.data ?? []) {
    if (!line.jobMaterialId || !line.itemId) continue;
    const picks = (byMaterial[line.jobMaterialId] ??= []);
    const key = `${line.itemId}:${line.pickingList.id}`;
    let pick = picks.find((p) => `${p.itemId}:${p.pickingListId}` === key);
    if (!pick) {
      pick = {
        itemId: line.itemId,
        itemReadableId: line.item?.readableIdWithRevision ?? line.itemId,
        isSubstitute: line.jobMaterial?.itemId !== line.itemId,
        quantityToPick: 0,
        quantityPicked: 0,
        pickingListId: line.pickingList.id,
        pickingListReadableId: line.pickingList.pickingListId,
        pickingListStatus: line.pickingList.status
      };
      picks.push(pick);
    }
    pick.quantityToPick += Number(line.quantityToPick ?? 0);
    pick.quantityPicked += Math.max(
      0,
      Number(line.quantityPicked ?? 0) - Number(line.quantityReturned ?? 0)
    );
  }
  return { data: byMaterial, error: lines.error };
}

export type JobMaterialPick = {
  itemId: string;
  itemReadableId: string;
  isSubstitute: boolean;
  quantityToPick: number;
  quantityPicked: number;
  pickingListId: string;
  pickingListReadableId: string;
  pickingListStatus: string;
};

export async function getPickingListLines(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  return client
    .from("pickingListLine")
    .select(
      "*, item(name, readableId, itemTrackingType, unitOfMeasureCode), jobMaterial(itemId, quantity, substitutionFactor, item(readableId, itemSupersession!itemSupersession_itemId_fkey(conversionFactor))), job(jobId), jobOperation(order, processId, workCenterId, process:process(name), workCenter:workCenter(name)), storageUnit:storageUnit!pickingListLine_storageUnitId_fkey(name, locationId), toStorageUnit:storageUnit!pickingListLine_toStorageUnitId_fkey(name, locationId), trackedEntities:pickingListLineTrackedEntity(trackedEntityId, quantity, quantityPicked, trackedEntity(readableId))"
    )
    .eq("pickingListId", pickingListId)
    .order("jobOperationId")
    .order("itemId");
}

/**
 * The documents around a picking list that its own row doesn't name: the
 * jobs its lines pick for, with their status.
 */
export async function getPickingListRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  pickingListId: string
) {
  const jobs = await client
    .from("job")
    .select("id, jobId, status, itemId, pickingListLine!inner(pickingListId)")
    .eq("pickingListLine.pickingListId", pickingListId)
    .eq("companyId", companyId)
    .order("jobId");

  if (jobs.error) {
    logger.error("Failed to get picking list jobs", {
      companyId,
      pickingListId,
      error: jobs.error
    });
  }

  return {
    jobs: (jobs.data ?? []).map(({ id, jobId, status, itemId }) => ({
      id,
      jobId,
      status,
      itemId
    }))
  };
}

/**
 * Per-line WAREHOUSE (non-lineside, incl. the unassigned/null bin) on-hand for
 * a picking list's items — drives the "No Stock" warning. Returns a map of
 * pickingListLineId → availableQuantity.
 */
export async function getPickingListAvailability(
  client: SupabaseClient<Database>,
  pickingListId: string
): Promise<Map<string, number>> {
  const result = await client.rpc("get_picking_list_availability", {
    p_picking_list_id: pickingListId
  });
  const map = new Map<string, number>();
  for (const row of result.data ?? []) {
    map.set(
      (row as { pickingListLineId: string }).pickingListLineId,
      Number(
        (row as { availableQuantity?: number | null }).availableQuantity ?? 0
      )
    );
  }
  return map;
}

export type PickingListRecommendation = {
  trackedEntityId: string;
  readableId: string | null;
};

/**
 * The recommended tracked entities (serial/batch lots) for each tracked picking
 * line, in pick order — surfaced as at-a-glance subtext before the picker opens.
 * One batched RPC fetches every available lot for every item on the list; we then
 * greedily assign distinct lots to lines in pick order so the same serial is never
 * recommended to two lines, and a batch lot is split across lines by remaining qty.
 * Returns a map of pickingListLineId → recommended lots (empty/partial if short).
 */
export async function getPickingListRecommendations(
  client: SupabaseClient<Database>,
  pickingListId: string
): Promise<Record<string, PickingListRecommendation[]>> {
  const [linesResult, availableResult] = await Promise.all([
    client
      .from("pickingListLine")
      .select(
        "id, itemId, quantityToPick, quantityPicked, status, item(itemTrackingType)"
      )
      .eq("pickingListId", pickingListId)
      .order("jobOperationId")
      .order("itemId"),
    client.rpc("get_picking_list_tracked_available", {
      p_picking_list_id: pickingListId
    })
  ]);

  const recommendations: Record<string, PickingListRecommendation[]> = {};
  if (linesResult.error || availableResult.error) return recommendations;

  // Ordered, mutable pool of available lots per item (the RPC already orders each
  // item's rows by its configured pick method).
  const poolByItem = new Map<
    string,
    Array<{ trackedEntityId: string; readableId: string | null; qty: number }>
  >();
  for (const row of availableResult.data ?? []) {
    const list = poolByItem.get(row.itemId) ?? [];
    list.push({
      trackedEntityId: row.trackedEntityId,
      readableId: row.readableId,
      qty: Number(row.availableQuantity ?? 0)
    });
    poolByItem.set(row.itemId, list);
  }

  for (const line of linesResult.data ?? []) {
    const trackingType = (line.item as { itemTrackingType?: string } | null)
      ?.itemTrackingType;
    if (trackingType !== "Serial" && trackingType !== "Batch") continue;

    let remaining =
      Number(line.quantityToPick ?? 0) - Number(line.quantityPicked ?? 0);
    if (remaining <= 0) continue;

    const pool = poolByItem.get(line.itemId);
    if (!pool?.length) continue;

    const picks: PickingListRecommendation[] = [];
    while (remaining > 0 && pool.length > 0) {
      const lot = pool[0];
      picks.push({
        trackedEntityId: lot.trackedEntityId,
        readableId: lot.readableId
      });
      const take = Math.min(lot.qty, remaining);
      remaining -= take;
      lot.qty -= take;
      if (lot.qty <= 0) pool.shift();
    }
    recommendations[line.id] = picks;
  }

  return recommendations;
}

export async function getPickingListLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("pickingListLine")
    .select(
      "*, item(name, readableId), job(jobId), jobOperation(order, processId, workCenterId, process:process(name), workCenter:workCenter(name)), storageUnit:storageUnit!pickingListLine_storageUnitId_fkey(name, locationId), toStorageUnit:storageUnit!pickingListLine_toStorageUnitId_fkey(name, locationId), pickingList(pickingListId, status)"
    )
    .eq("id", lineId)
    .single();
}

export async function getPickingListLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("pickingListLineTrackedEntity")
    .select("*, trackedEntity(readableId, quantity, expirationDate)")
    .eq("pickingListLineId", lineId);
}

/**
 * Pick (or unpick) a tracked (serial/batch) lot for a picking line. A pick
 * MOVES the chosen lot from its warehouse bin to the line's lineside shelf via
 * the `post-picking` server function (serial/batch), records it on the line, and
 * points the job material at lineside. `unpick` reverses it. Published as
 * `inventory.pickingList.line.pickEntity`, which checks the line is on the
 * list first.
 */
export async function setPickingListLineTrackedEntity(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    pickingListLineId: string;
    trackedEntityId: string;
    fromStorageUnitId?: string | null;
    quantity?: number;
    unpick?: boolean;
    userId: string;
    companyId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, pickingList(locationId, companyId, status), item(itemTrackingType)"
    )
    .eq("id", args.pickingListLineId)
    // Callers pass the service role: the company scope is the tenant boundary,
    // and the server function below acts in args.companyId, never the row's.
    .eq("companyId", args.companyId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const pickingList = line.pickingList as {
    locationId: string;
    companyId: string;
    status: string;
  } | null;
  const item = line.item as { itemTrackingType: string } | null;

  if (!pickingList) {
    return { data: null, error: "Missing related data" };
  }
  if (isPickingListLocked(pickingList.status)) {
    return {
      data: null,
      error: "This picking list is closed. Reopen it to make changes."
    };
  }

  const isSerial = item?.itemTrackingType === "Serial";
  const isBatch = item?.itemTrackingType === "Batch";
  if (!isSerial && !isBatch) {
    return { data: null, error: "This line is not a tracked item" };
  }
  if (!args.unpick && !line.toStorageUnitId) {
    return {
      data: null,
      error: "No lineside destination is set for this line"
    };
  }

  const type = args.unpick
    ? isSerial
      ? "unpickSerial"
      : "unpickBatch"
    : isSerial
      ? "serial"
      : "batch";

  const body: Record<string, unknown> = {
    type,
    pickingListId: line.pickingListId,
    pickingListLineId: line.id,
    trackedEntityId: args.trackedEntityId,
    locationId: pickingList.locationId,
    userId: args.userId,
    companyId: args.companyId
  };
  if (!args.unpick) {
    body.fromStorageUnitId = args.fromStorageUnitId ?? null;
    // A batch pick may be fractional (0.5 kg): send the requested quantity as
    // is and fall back to 1 only when none was given. Flooring at 1 turned
    // every sub-1 remainder into an over-pick post-picking refused.
    if (isBatch) {
      body.quantity =
        args.quantity !== undefined && args.quantity > 0 ? args.quantity : 1;
    }
  }

  const result = await serverFns
    .as({ client, db, companyId: args.companyId, userId: args.userId })
    .invoke("post-picking", body as ServerFnInput<"post-picking">);
  if (result.error) {
    return {
      data: null,
      error: getErrorMessage(result.error, "Failed to pick material")
    };
  }

  return { data: { id: args.pickingListLineId }, error: null };
}

/** Writes without the Draft lock: `inventory.pickingList.update` checks it; lists are created by `generatePickingList`. */
export async function upsertPickingList(
  client: SupabaseClient<Database>,
  pickingList:
    | (Omit<z.infer<typeof pickingListValidator>, "id" | "pickingListId"> & {
        pickingListId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof pickingListValidator>, "id" | "pickingListId"> & {
        id: string;
        pickingListId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in pickingList) {
    return client
      .from("pickingList")
      .insert([pickingList])
      .select("id")
      .single();
  }
  return client
    .from("pickingList")
    .update({
      ...sanitize(pickingList),
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingList.id)
    .select("id")
    .single();
}

export type UnresolvedPickingListLine = {
  itemName: string;
  outstanding: number;
};

// Lines still owing material when Finish is pressed. "Unresolved" = a line the
// operator neither fully picked, cancelled, nor explicitly marked Short — i.e.
// silently left behind. `hasShort` reports whether any acknowledged shortfall
// exists, which forces the final header status to Partial rather than Completed.
export async function getUnresolvedPickingListLines(
  client: SupabaseClient<Database>,
  pickingListId: string,
  companyId: string
): Promise<{
  unresolved: UnresolvedPickingListLine[];
  hasShort: boolean;
  error: unknown;
}> {
  const { data, error } = await client
    .from("pickingListLine")
    .select(
      "status, quantityToPick, quantityPicked, item:item(name, readableId)"
    )
    .eq("pickingListId", pickingListId)
    .eq("companyId", companyId);

  if (error) return { unresolved: [], hasShort: false, error };

  const lines = data ?? [];
  const hasShort = lines.some((line) => line.status === "Short");

  const unresolved = lines
    .filter(
      (line) =>
        line.status !== "Cancelled" &&
        line.status !== "Short" &&
        Number(line.quantityPicked ?? 0) < Number(line.quantityToPick ?? 0)
    )
    .map((line) => {
      const item = line.item as
        | { name?: string | null; readableId?: string | null }
        | { name?: string | null; readableId?: string | null }[]
        | null;
      const itemRecord = Array.isArray(item) ? item[0] : item;
      return {
        itemName: itemRecord?.name ?? itemRecord?.readableId ?? "Material",
        outstanding:
          Number(line.quantityToPick ?? 0) - Number(line.quantityPicked ?? 0)
      };
    });

  return { unresolved, hasShort, error: null };
}

export async function cancelOpenPickingListsForJob(
  db: Kysely<KyselyDatabase>,
  args: { jobId: string; companyId: string; userId: string }
): Promise<{ error: Error | null }> {
  try {
    await db.transaction().execute(async (trx) => {
      const lines = await trx
        .selectFrom("pickingListLine as pll")
        .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
        .select(["pll.id", "pll.pickingListId"])
        .where("pll.jobId", "=", args.jobId)
        .where("pll.companyId", "=", args.companyId)
        .where("pll.status", "<>", "Cancelled")
        .where("pl.status", "in", ["Draft", "In Progress"])
        .execute();
      if (lines.length === 0) return;

      const now = new Date().toISOString();
      await trx
        .updateTable("pickingListLine")
        .set({ status: "Cancelled", updatedBy: args.userId, updatedAt: now })
        .where(
          "id",
          "in",
          lines.map((line) => line.id)
        )
        .where("companyId", "=", args.companyId)
        .execute();

      const pickingListIds = Array.from(
        new Set(lines.map((line) => line.pickingListId))
      );
      const remaining = await trx
        .selectFrom("pickingListLine")
        .select("pickingListId")
        .where("pickingListId", "in", pickingListIds)
        .where("companyId", "=", args.companyId)
        .where("status", "<>", "Cancelled")
        .execute();
      const stillLive = new Set(remaining.map((line) => line.pickingListId));
      const emptied = pickingListIds.filter((id) => !stillLive.has(id));
      if (emptied.length === 0) return;

      await trx
        .updateTable("pickingList")
        .set({ status: "Cancelled", updatedBy: args.userId, updatedAt: now })
        .where("id", "in", emptied)
        .where("companyId", "=", args.companyId)
        .execute();
    });
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/** A bare status write: `inventory.pickingList.setStatus` applies the completion policy and the reopen permission. */
export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  updatedBy: string
) {
  return client
    .from("pickingList")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingListId);
}

export async function upsertPickingListLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<z.infer<typeof pickingListLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof pickingListLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in line) {
    return client.from("pickingListLine").insert([line]).select("id").single();
  }
  return client
    .from("pickingListLine")
    .update({
      ...sanitize(line),
      updatedAt: new Date().toISOString()
    })
    .eq("id", line.id)
    .select("id")
    .single();
}

export async function deletePickingList(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  return client.from("pickingList").delete().eq("id", pickingListId);
}

export async function deletePickingListLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("pickingListLine").delete().eq("id", lineId);
}

// ----------------------------------------------------------------------------
// Picking List Business Logic
// ----------------------------------------------------------------------------

export async function getPickingSchedule(
  client: SupabaseClient<Database>,
  args: {
    locationId: string;
    companyId: string;
    search?: string | null;
  }
) {
  return client.rpc("get_picking_schedule", {
    p_location_id: args.locationId,
    p_company_id: args.companyId,
    p_search: args.search ?? undefined
  });
}

/**
 * On-hand of an item at a location, aggregated per storage unit (bin).
 *
 * `getItemStorageUnitQuantities` can return a row per tracked entity, so we sum
 * to one figure per bin. Computed once per material and reused to (a) decide
 * whether the op's lineside bin is already stocked and (b) resolve a warehouse
 * source by on-hand.
 */
async function getItemOnHandByStorageUnit(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<Map<string, number>> {
  const quantities = await getItemStorageUnitQuantities(
    client,
    args.itemId,
    args.companyId,
    args.locationId
  );

  const byUnit = new Map<string, number>();
  for (const row of quantities.data ?? []) {
    const unitId = (row as { storageUnitId?: string | null }).storageUnitId;
    if (!unitId) continue;
    const qty = Number((row as { quantity?: number | null }).quantity ?? 0);
    byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + qty);
  }
  return byUnit;
}

/**
 * Resolve a WAREHOUSE (non-lineside) source storage unit for a pick by on-hand.
 *
 * Returns the non-lineside storage unit holding the most on-hand of the item at
 * the location, or null when no warehouse stock exists (a shortage — we never
 * source a pick from another work center's lineside bin). A storage unit is
 * "lineside" when it resolves to a work center via `get_effective_work_center_id`.
 */
async function resolveWarehouseSource(
  client: SupabaseClient<Database>,
  onHandByUnit: Map<string, number>
): Promise<string | null> {
  // Consider candidates highest-on-hand first.
  const candidates = Array.from(onHandByUnit.entries())
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [storageUnitId] of candidates) {
    const effectiveWc = await client.rpc("get_effective_work_center_id", {
      p_storage_unit_id: storageUnitId
    });
    // First non-lineside bin (no work center) with the most on-hand wins.
    if (!effectiveWc.data) return storageUnitId;
  }

  return null;
}

function toPickFactor(value: number | string | null | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function getWarehouseOnHand(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<number> {
  const quantities = await getItemStorageUnitQuantities(
    client,
    args.itemId,
    args.companyId,
    args.locationId
  );

  const perUnit = new Map<string, number>();
  let total = 0;
  for (const row of quantities.data ?? []) {
    const unitId = (row as { storageUnitId?: string | null }).storageUnitId;
    const qty = Number((row as { quantity?: number | null }).quantity ?? 0);
    if (!unitId) {
      total += qty;
    } else {
      perUnit.set(unitId, (perUnit.get(unitId) ?? 0) + qty);
    }
  }
  total = Math.max(0, total);

  const stocked = Array.from(perUnit).filter(([, qty]) => qty > 0);
  const workCenters = await async.map(
    stocked,
    async ([storageUnitId]) =>
      await client.rpc("get_effective_work_center_id", {
        p_storage_unit_id: storageUnitId
      })
  );
  stocked.forEach(([, qty], index) => {
    if (!workCenters[index]?.data) total += qty;
  });

  return total;
}

/**
 * Whether an item has any WAREHOUSE (non-lineside) on-hand at a location,
 * INCLUDING the unassigned (null storage unit) bin.
 *
 * This is the stock *test*, deliberately decoupled from `resolveWarehouseSource`
 * (which selects a concrete source shelf and so cannot see null-bin stock). The
 * picking UI (`PickingListLines`) likewise treats unassigned-bin on-hand as real
 * stock, so a `Consume First` predecessor must not be judged "out of stock"
 * merely because all of its on-hand sits in the unassigned bin — that would
 * spuriously redirect the pick to the successor and leave predecessor stock
 * unused.
 */
async function hasWarehouseStock(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<boolean> {
  const quantities = await getItemStorageUnitQuantities(
    client,
    args.itemId,
    args.companyId,
    args.locationId
  );

  const perUnit = new Map<string, number>();
  let unassignedQty = 0;
  for (const row of quantities.data ?? []) {
    const unitId = (row as { storageUnitId?: string | null }).storageUnitId;
    const qty = Number((row as { quantity?: number | null }).quantity ?? 0);
    // The unassigned (null) bin is warehouse stock — it has no work center.
    if (!unitId) {
      unassignedQty += qty;
    } else {
      perUnit.set(unitId, (perUnit.get(unitId) ?? 0) + qty);
    }
  }
  if (unassignedQty > 0) return true;

  for (const [storageUnitId, qty] of perUnit) {
    if (qty <= 0) continue;
    const effectiveWc = await client.rpc("get_effective_work_center_id", {
      p_storage_unit_id: storageUnitId
    });
    // Any non-lineside bin with on-hand counts as available warehouse stock.
    if (!effectiveWc.data) return true;
  }

  return false;
}

class PickingReadError extends Error {
  constructor(readonly postgrestError: PostgrestError) {
    super(postgrestError.message);
  }
}

export async function generatePickingList(
  client: SupabaseClient<Database>,
  args: {
    jobOperationIds: string[];
    locationId: string;
    companyId: string;
    createdBy: string;
    assignee?: string | null;
    dueDate?: string | null;
  }
) {
  // 1. Get the next sequence number
  const sequenceResult = await getNextSequence(
    client,
    "pickingList",
    args.companyId
  );
  if (sequenceResult.error || !sequenceResult.data) {
    return {
      data: null,
      error: sequenceResult.error ?? "Failed to get sequence"
    };
  }
  const pickingListId = sequenceResult.data as string;

  // 2. Create the picking list header
  const headerInsert = await client
    .from("pickingList")
    .insert([
      {
        pickingListId,
        status: "Draft" as const,
        locationId: args.locationId,
        assignee: args.assignee ?? null,
        dueDate: args.dueDate ?? null,
        companyId: args.companyId,
        createdBy: args.createdBy
      }
    ])
    .select("id, pickingListId")
    .single();

  if (headerInsert.error) {
    return { data: null, error: headerInsert.error };
  }

  const plId = headerInsert.data.id;

  // 3. Map each operation to its work center (for the lineside destination)
  // and find the earliest selected operation of each make method (lowest
  // "order", id tie-break) — materials with no operation assignment attach to
  // it, mirroring get_picking_schedule's first-operation attribution.
  const operations = await client
    .from("jobOperation")
    .select("id, workCenterId, jobMakeMethodId, order")
    .in("id", args.jobOperationIds);

  if (operations.error) {
    await client.from("pickingList").delete().eq("id", plId);
    return { data: null, error: operations.error };
  }

  const workCenterByOperation = new Map<string, string | null>();
  const firstSelectedOpByMakeMethod = new Map<
    string,
    { id: string; order: number }
  >();
  for (const op of operations.data ?? []) {
    workCenterByOperation.set(op.id, op.workCenterId ?? null);
    if (op.jobMakeMethodId) {
      const order = Number(op.order ?? 0);
      const current = firstSelectedOpByMakeMethod.get(op.jobMakeMethodId);
      if (
        !current ||
        order < current.order ||
        (order === current.order && op.id < current.id)
      ) {
        firstSelectedOpByMakeMethod.set(op.jobMakeMethodId, {
          id: op.id,
          order
        });
      }
    }
  }
  const makeMethodIds = Array.from(firstSelectedOpByMakeMethod.keys());

  // 4. Get jobMaterial records with quantityToIssue > 0: those assigned to the
  // selected operations, plus unassigned ones (jobOperationId NULL — demanded
  // at every operation of their method in MES) on the selected make methods.
  const quoted = (ids: string[]) => ids.map((id) => `"${id}"`).join(",");
  let materialsQuery = client
    .from("jobMaterial")
    .select(
      "id, jobId, jobOperationId, jobMakeMethodId, itemId, substitutedFromItemId, substitutionFactor, quantity, quantityToIssue, storageUnitId, requiresSerialTracking, requiresBatchTracking"
    )
    .eq("companyId", args.companyId)
    .gt("quantityToIssue", 0)
    .neq("methodType", "Make to Order");
  materialsQuery =
    makeMethodIds.length > 0
      ? materialsQuery.or(
          `jobOperationId.in.(${quoted(args.jobOperationIds)}),and(jobOperationId.is.null,jobMakeMethodId.in.(${quoted(makeMethodIds)}))`
        )
      : materialsQuery.in("jobOperationId", args.jobOperationIds);
  const materials = await materialsQuery;

  if (materials.error) {
    await client.from("pickingList").delete().eq("id", plId);
    return { data: null, error: materials.error };
  }

  // Supersession config for every demanded material, so a pick can honor an
  // item's supersession: redirect to an effective successor (Prefer New /
  // Stock Only) or, for Consume First, when the predecessor is out of stock.
  // Mirrors get_picking_schedule's SQL resolution.
  const materialItemIds = Array.from(
    new Set(
      (materials.data ?? []).flatMap((m) => [
        pickSupersessionItemId(m),
        m.itemId
      ])
    )
  );
  const supersessionByItem = new Map<string, PickSupersession>();
  if (materialItemIds.length > 0) {
    const supersessions = await client
      .from("itemSupersession")
      .select(
        "itemId, supersessionMode, successorItemId, successorEffectivityDate, conversionFactor"
      )
      .eq("companyId", args.companyId)
      .in("itemId", materialItemIds);
    if (supersessions.error) {
      await client.from("pickingList").delete().eq("id", plId);
      return { data: null, error: supersessions.error };
    }
    for (const row of supersessions.data ?? []) {
      supersessionByItem.set(row.itemId, row);
    }
  }
  // Business date for supersession effectivity. Uses UTC to match the SQL
  // schedule/availability path — get_picking_schedule and
  // get_picking_list_availability compare successorEffectivityDate against the
  // UTC calendar date ((now() AT TIME ZONE 'UTC')::date) — so generation and
  // those RPCs never resolve a different effective successor at a timezone
  // boundary.
  const asOfDate = datetime.today("UTC").toString();

  const warehouseStockCache = new Map<string, boolean>();
  const inWarehouseStock = async (itemId: string): Promise<boolean> => {
    const cached = warehouseStockCache.get(itemId);
    if (cached !== undefined) return cached;
    const result = await hasWarehouseStock(client, {
      itemId,
      locationId: args.locationId,
      companyId: args.companyId
    });
    warehouseStockCache.set(itemId, result);
    return result;
  };
  const warehouseRemaining = new Map<string, number>();
  const remainingWarehouseStock = async (itemId: string): Promise<number> => {
    const cached = warehouseRemaining.get(itemId);
    if (cached !== undefined) return cached;
    const result = await getWarehouseOnHand(client, {
      itemId,
      locationId: args.locationId,
      companyId: args.companyId
    });
    warehouseRemaining.set(itemId, result);
    return result;
  };

  // Cache per-item on-hand-by-bin so a supersession redirect doesn't refetch.
  const onHandCache = new Map<string, Map<string, number>>();
  const claimsByItem = new Map<string, LinesideClaim[]>();
  const claimsFor = async (
    itemId: string,
    storageUnitId: string
  ): Promise<LinesideClaim[]> => {
    const key = `${itemId}|${storageUnitId}`;
    const cached = claimsByItem.get(key);
    if (cached) return cached;
    const { data, error } = await client
      .from("pickingListLine")
      .select(
        "jobId, jobMaterialId, quantityPicked, quantityReturned, pickingList!inner(status), job!inner(status)"
      )
      .eq("companyId", args.companyId)
      .eq("itemId", itemId)
      .eq("toStorageUnitId", storageUnitId)
      .neq("status", "Cancelled")
      .neq("pickingList.status", "Cancelled")
      .in("job.status", ["Planned", "Ready", "In Progress", "Paused"]);
    if (error) throw new PickingReadError(error);
    const claims = (data ?? []).map((line) => ({
      jobId: line.jobId,
      jobMaterialId: line.jobMaterialId,
      staged:
        Number(line.quantityPicked ?? 0) - Number(line.quantityReturned ?? 0)
    }));
    claimsByItem.set(key, claims);
    return claims;
  };
  const consumedByItem = new Map<string, Map<string, number>>();
  const consumedFor = async (
    itemId: string,
    storageUnitId: string
  ): Promise<Map<string, number>> => {
    const key = `${itemId}|${storageUnitId}`;
    const cached = consumedByItem.get(key);
    if (cached) return cached;
    const { data, error } = await client
      .from("itemLedger")
      .select("documentId, quantity")
      .eq("companyId", args.companyId)
      .eq("locationId", args.locationId)
      .eq("itemId", itemId)
      .eq("storageUnitId", storageUnitId)
      .eq("documentType", "Job Consumption");
    if (error) throw new PickingReadError(error);
    const byJob = new Map<string, number>();
    for (const row of data ?? []) {
      if (!row.documentId) continue;
      byJob.set(
        row.documentId,
        (byJob.get(row.documentId) ?? 0) +
          Math.max(0, -Number(row.quantity ?? 0))
      );
    }
    consumedByItem.set(key, byJob);
    return byJob;
  };
  const unclaimedRemaining = new Map<string, number>();
  const linesideCreditFor = async (
    itemId: string,
    storageUnitId: string,
    jobId: string,
    jobMaterialId: string
  ): Promise<{ own: number; unclaimed: number; key: string }> => {
    const key = `${itemId}|${storageUnitId}`;
    const credit = linesideCredit({
      onHand: (await onHandFor(itemId)).get(storageUnitId) ?? 0,
      claims: await claimsFor(itemId, storageUnitId),
      consumedByJob: await consumedFor(itemId, storageUnitId),
      jobId,
      jobMaterialId
    });
    if (!unclaimedRemaining.has(key)) {
      unclaimedRemaining.set(key, credit.unclaimed);
    }
    return {
      own: credit.own,
      unclaimed: unclaimedRemaining.get(key) ?? 0,
      key
    };
  };
  const chargeUnclaimed = (key: string, used: number, own: number) => {
    const current = unclaimedRemaining.get(key) ?? 0;
    unclaimedRemaining.set(key, Math.max(0, current - Math.max(0, used - own)));
  };

  const onHandFor = async (itemId: string): Promise<Map<string, number>> => {
    const cached = onHandCache.get(itemId);
    if (cached) return cached;
    const map = await getItemOnHandByStorageUnit(client, {
      itemId,
      locationId: args.locationId,
      companyId: args.companyId
    });
    onHandCache.set(itemId, map);
    return map;
  };

  // Lazily resolve (and cache) the lineside destination per work center. A
  // pick is a transfer from the warehouse source to this lineside shelf;
  // production later consumes from it.

  const linesideByWorkCenter = new Map<string, string | null>();
  const resolveLineside = async (
    workCenterId: string | null
  ): Promise<string | null> => {
    if (!workCenterId) return null;
    if (linesideByWorkCenter.has(workCenterId)) {
      return linesideByWorkCenter.get(workCenterId) ?? null;
    }
    const result = await client.rpc("get_or_create_work_center_lineside", {
      p_work_center_id: workCenterId,
      p_company_id: args.companyId,
      p_user_id: args.createdBy
    });
    const linesideId = (result.data as string | null) ?? null;
    linesideByWorkCenter.set(workCenterId, linesideId);
    return linesideId;
  };

  // Accumulate all line rows and per-material FIFO allocations first, then write
  // them in atomic batch inserts. On any insert error we delete the header,
  // which cascades to lines and tracked-entity allocations (ON DELETE CASCADE),
  // so a partially-built picking list can never survive.
  const lineRows: Array<{
    pickingListId: string;
    jobId: string;
    jobMaterialId: string;
    jobOperationId: string | null;
    itemId: string;
    quantityToPick: number;
    storageUnitId: string | null;
    toStorageUnitId: string | null;
    companyId: string;
    createdBy: string;
  }> = [];
  try {
    for (const mat of materials.data ?? []) {
      const quantityToIssue = Number(mat.quantityToIssue ?? 0);
      if (quantityToIssue <= 0) continue;

      // Unassigned materials attach to the earliest selected operation of their
      // make method; its work center drives the lineside destination.
      const effectiveOperationId =
        mat.jobOperationId ??
        firstSelectedOpByMakeMethod.get(mat.jobMakeMethodId)?.id ??
        null;

      const opWorkCenterId = effectiveOperationId
        ? (workCenterByOperation.get(effectiveOperationId) ?? null)
        : null;

      // 5. Resolve the destination: the operation's work-center lineside shelf.
      const toStorageUnitId = await resolveLineside(opWorkCenterId);

      // The stock TEST uses total non-lineside on-hand (including the unassigned
      // bin) rather than a resolvable concrete source, so predecessor stock sitting
      // only in the unassigned bin still blocks a spurious successor redirect.
      const { rule: supersession, swappedFromItemId } = resolvePickRule(
        mat,
        supersessionByItem
      );
      const predecessorItemId = swappedFromItemId ?? mat.itemId;
      const perAssemblyOld =
        Number(mat.quantity ?? 0) *
        (swappedFromItemId ? 1 / toPickFactor(mat.substitutionFactor) : 1);
      let predecessorInStock = true;
      let successorInStock = true;
      let successorId: string | null = null;
      if (
        supersession?.supersessionMode === "Consume First" ||
        supersession?.supersessionMode === "Prefer New"
      ) {
        successorId = swappedFromItemId
          ? mat.itemId
          : effectiveSuccessorId(supersession, asOfDate);
        if (successorId) {
          const available = await remainingWarehouseStock(predecessorItemId);
          predecessorInStock =
            supersession.supersessionMode === "Consume First"
              ? consumableInWholeAssemblies(available, perAssemblyOld) > 0
              : available > 0;
          successorInStock = await inWarehouseStock(successorId);
        }
      }

      const target = resolvePickTarget({
        itemId: mat.itemId,
        substitutedFromItemId: swappedFromItemId,
        substitutionFactor: mat.substitutionFactor,
        supersession,
        predecessorInStock,
        successorInStock,
        asOfDate
      });
      // Nothing valid to pick for production (No Stock, or Stock Only without an
      // effective successor) — drop it, matching get_picking_schedule.
      if (target.kind === "skip") continue;

      let targets: { itemId: string; quantity: number }[];
      if (supersession?.supersessionMode === "Consume First" && successorId) {
        const oldPerLine = swappedFromItemId
          ? 1 / toPickFactor(mat.substitutionFactor)
          : 1;
        const newPerOld = swappedFromItemId
          ? toPickFactor(mat.substitutionFactor)
          : toPickFactor(supersession.conversionFactor);
        const oldCredit = toStorageUnitId
          ? await linesideCreditFor(
              predecessorItemId,
              toStorageUnitId,
              mat.jobId,
              mat.id
            )
          : null;
        const newCredit = toStorageUnitId
          ? await linesideCreditFor(
              successorId,
              toStorageUnitId,
              mat.jobId,
              mat.id
            )
          : null;
        const warehouseOld = await remainingWarehouseStock(predecessorItemId);
        const split = splitConsumeFirstPick({
          needOld: quantityToIssue * oldPerLine,
          perAssemblyOld,
          newPerOld,
          stagedOld: oldCredit ? oldCredit.own + oldCredit.unclaimed : 0,
          stagedNew: newCredit ? newCredit.own + newCredit.unclaimed : 0,
          warehouseOld,
          successorInStock
        });
        warehouseRemaining.set(
          predecessorItemId,
          Math.max(0, warehouseOld - split.warehouseOldUsed)
        );
        if (oldCredit) {
          chargeUnclaimed(oldCredit.key, split.stagedOldUsed, oldCredit.own);
        }
        if (newCredit) {
          chargeUnclaimed(newCredit.key, split.stagedNewUsed, newCredit.own);
        }
        if (split.picks.length === 0) continue;
        targets = split.picks.map((pick) => ({
          itemId: pick.item === "predecessor" ? predecessorItemId : successorId,
          quantity: pick.quantity
        }));
      } else {
        const need = quantityToIssue * target.factor;
        if (toStorageUnitId) {
          const credit = await linesideCreditFor(
            target.itemId,
            toStorageUnitId,
            mat.jobId,
            mat.id
          );
          const credited = Math.min(need, credit.own + credit.unclaimed);
          chargeUnclaimed(credit.key, credited, credit.own);
          if (credited >= need) continue;
          targets = [{ itemId: target.itemId, quantity: need - credited }];
        } else {
          targets = [{ itemId: target.itemId, quantity: need }];
        }
      }

      for (const { itemId: pickItemId, quantity: quantityToPick } of targets) {
        const onHandByUnit = await onHandFor(pickItemId);

        let sourceStorageUnitId: string | null;
        if (pickItemId === mat.itemId && mat.storageUnitId) {
          const effectiveWc = await client.rpc("get_effective_work_center_id", {
            p_storage_unit_id: mat.storageUnitId
          });
          const materialEffectiveWc =
            (effectiveWc.data as string | null) ?? null;
          sourceStorageUnitId = materialEffectiveWc
            ? await resolveWarehouseSource(client, onHandByUnit)
            : mat.storageUnitId;
        } else {
          sourceStorageUnitId = await resolveWarehouseSource(
            client,
            onHandByUnit
          );
        }

        lineRows.push({
          pickingListId: plId,
          jobId: mat.jobId,
          jobMaterialId: mat.id,
          jobOperationId: effectiveOperationId,
          itemId: pickItemId,
          quantityToPick,
          storageUnitId: sourceStorageUnitId,
          toStorageUnitId,
          companyId: args.companyId,
          createdBy: args.createdBy
        });
      }
      // Tracked (serial/batch) lots are intentionally NOT pre-allocated here — the
      // kitter selects them at pick time via the TrackedEntityPicker (smart-ordered,
      // deduped), and the pick records pickingListLineTrackedEntity. Pre-allocating
      // would show un-picked lots as if already picked.
    }
  } catch (err) {
    if (err instanceof PickingReadError) {
      await client.from("pickingList").delete().eq("id", plId);
      return { data: null, error: err.postgrestError };
    }
    throw err;
  }

  // 7. If no lines to pick, delete the empty header and report.
  if (lineRows.length === 0) {
    await client.from("pickingList").delete().eq("id", plId);
    return {
      data: null,
      error: "No materials require picking for the selected operations"
    };
  }

  // 8. Atomic batch insert of all lines. Tracked lots are not pre-allocated;
  // they're chosen at pick time via the TrackedEntityPicker.
  const linesInsert = await client
    .from("pickingListLine")
    .insert(lineRows)
    .select("id");

  if (linesInsert.error || !linesInsert.data) {
    await client.from("pickingList").delete().eq("id", plId); // cascade cleanup
    return { data: null, error: linesInsert.error ?? "Failed to create lines" };
  }

  // 9. Return the created picking list
  return {
    data: {
      id: plId,
      pickingListId
    },
    error: null
  };
}

/**
 * Pick, partial-pick (short), or unpick a picking line. A pick TRANSFERS the
 * material from its warehouse source shelf to the work center's lineside shelf
 * via the `post-picking` server function (consumption happens later at
 * production). The DELTA between the desired picked quantity and what's already
 * picked is what moves: positive transfers in, negative reverses.
 *   - Pick (full):  quantity = quantityToPick
 *   - Unpick:       quantity = 0
 *   - Short:        quantity = whatever was actually picked, markShort = true
 * Tracked items go through the scan flow and are rejected here.
 * Published as `inventory.pickingList.line.pick`, which checks the line is on
 * the list first.
 */
export async function pickPickingListLine(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    pickingListLineId: string;
    quantity: number;
    markShort?: boolean;
    userId: string;
    companyId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, pickingList(locationId, companyId, status), item(itemTrackingType)"
    )
    .eq("id", args.pickingListLineId)
    // Callers pass the service role: the company scope is the tenant boundary,
    // and the server function below acts in args.companyId, never the row's.
    .eq("companyId", args.companyId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const pickingList = line.pickingList as {
    locationId: string;
    companyId: string;
    status: string;
  } | null;
  const item = line.item as { itemTrackingType: string } | null;

  if (!pickingList) {
    return { data: null, error: "Missing related data" };
  }

  if (isPickingListLocked(pickingList.status)) {
    return {
      data: null,
      error: "This picking list is closed. Reopen it to make changes."
    };
  }

  if (
    item?.itemTrackingType === "Serial" ||
    item?.itemTrackingType === "Batch"
  ) {
    return {
      data: null,
      error: "Tracked items must be picked via the scan flow"
    };
  }

  const previouslyPicked = Number(line.quantityPicked ?? 0);
  const target = Math.max(0, args.quantity);
  const delta = target - previouslyPicked;

  if (delta !== 0) {
    // A null source is allowed: the kitter can pick material the system shows no
    // stock for (counts are often wrong) — on-hand simply goes negative at the
    // source until it's reconciled. Only the lineside destination is required.
    if (delta > 0 && !line.toStorageUnitId) {
      return {
        data: null,
        error: "No lineside destination is set for this line"
      };
    }

    const body =
      delta > 0
        ? {
            type: "inventory",
            pickingListId: line.pickingListId,
            pickingListLineId: line.id,
            quantity: delta,
            locationId: pickingList.locationId,
            userId: args.userId,
            companyId: args.companyId
          }
        : {
            type: "unpickInventory",
            pickingListId: line.pickingListId,
            pickingListLineId: line.id,
            quantity: -delta,
            locationId: pickingList.locationId,
            userId: args.userId,
            companyId: args.companyId
          };

    const result = await serverFns
      .as({ client, db, companyId: body.companyId, userId: body.userId })
      .invoke("post-picking", body as ServerFnInput<"post-picking">);

    if (result.error) {
      return {
        data: null,
        error: getErrorMessage(result.error, "Failed to pick material")
      };
    }
  }

  // Short overrides the status the server function derived from quantities.
  if (args.markShort) {
    const update = await client
      .from("pickingListLine")
      .update({
        status: "Short",
        quantityPicked: target,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", line.id)
      .eq("companyId", args.companyId);
    if (update.error) {
      return { data: null, error: update.error };
    }
  }

  return { data: { id: line.id }, error: null };
}

/** Not published: it runs no storage rules; `inventory.stockTransfer.create` does. */
export async function insertStockTransfer(
  client: SupabaseClient<Database>,
  input: {
    locationId: string;
    lines: Array<{
      itemId: string;
      fromStorageUnitId?: string | null;
      toStorageUnitId?: string | null;
      quantity?: number;
      requiresSerialTracking?: boolean;
      requiresBatchTracking?: boolean;
    }>;
    companyId: string;
    createdBy: string;
    stockTransferId?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; stockTransferId: string } | null;
  error: PostgrestError | { message: string } | null;
}> {
  const { locationId, lines, companyId, createdBy, customFields } = input;

  // Before the sequence, so a refused line does not use up a transfer number.
  let linesWithExpandedSerialTracking: typeof lines;
  try {
    linesWithExpandedSerialTracking = expandSerialTrackedLines(lines);
  } catch (err) {
    return {
      data: null,
      error: {
        message: getErrorMessage(err, "Failed to prepare stock transfer lines")
      }
    };
  }

  let stockTransferId = input.stockTransferId;
  if (!stockTransferId) {
    const sequence = await client.rpc("get_next_sequence", {
      sequence_name: "stockTransfer",
      company_id: companyId
    });
    if (sequence.error || !sequence.data) {
      return {
        data: null,
        error: sequence.error ?? { message: "Failed to get sequence" }
      };
    }
    stockTransferId = sequence.data;
  }

  const createTransfer = await client
    .from("stockTransfer")
    .insert({
      stockTransferId,
      locationId,
      status: "Released",
      companyId,
      createdBy,
      customFields
    })
    .select("id")
    .single();

  if (createTransfer.error || !createTransfer.data) {
    return { data: null, error: createTransfer.error };
  }

  const createLines = await client.from("stockTransferLine").insert(
    linesWithExpandedSerialTracking.map((line) => ({
      ...line,
      stockTransferId: createTransfer.data.id,
      companyId,
      createdBy
    }))
  );

  if (createLines.error) {
    await client
      .from("stockTransfer")
      .delete()
      .eq("id", createTransfer.data.id);
    return { data: null, error: createLines.error };
  }

  return {
    data: { id: createTransfer.data.id, stockTransferId: stockTransferId! },
    error: null
  };
}

export async function insertWarehouseTransfer(
  client: SupabaseClient<Database>,
  input: {
    fromLocationId: string;
    toLocationId: string;
    companyId: string;
    createdBy: string;
    transferId?: string;
    status?: Database["public"]["Enums"]["warehouseTransferStatus"];
    transferDate?: string;
    expectedReceiptDate?: string;
    notes?: string;
    reference?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; transferId: string } | null;
  error: PostgrestError | { message: string } | null;
}> {
  const {
    fromLocationId,
    toLocationId,
    companyId,
    createdBy,
    status = "Draft",
    transferDate,
    expectedReceiptDate,
    notes,
    reference,
    customFields
  } = input;

  let transferId = input.transferId;
  if (!transferId) {
    const sequence = await client.rpc("get_next_sequence", {
      sequence_name: "warehouseTransfer",
      company_id: companyId
    });
    if (sequence.error || !sequence.data) {
      return {
        data: null,
        error: sequence.error ?? { message: "Failed to get sequence" }
      };
    }
    transferId = sequence.data;
  }

  const createTransfer = await client
    .from("warehouseTransfer")
    .insert({
      transferId,
      fromLocationId,
      toLocationId,
      status,
      transferDate: transferDate || null,
      expectedReceiptDate: expectedReceiptDate || null,
      notes: notes || null,
      reference: reference || null,
      companyId,
      createdBy,
      customFields
    })
    .select("id")
    .single();

  if (createTransfer.error || !createTransfer.data) {
    return { data: null, error: createTransfer.error };
  }

  return {
    data: { id: createTransfer.data.id, transferId: transferId! },
    error: null
  };
}

export async function updateStockTransfer(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    locationId?: string;
    stockTransferId?: string;
    updatedBy: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, customFields, ...fields } = input;
  return client
    .from("stockTransfer")
    .update(
      sanitize({
        ...fields,
        customFields,
        updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function updateWarehouseTransfer(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    fromLocationId?: string;
    toLocationId?: string;
    transferId?: string;
    status?: Database["public"]["Enums"]["warehouseTransferStatus"];
    transferDate?: string;
    expectedReceiptDate?: string;
    notes?: string;
    reference?: string;
    updatedBy: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, customFields, ...fields } = input;
  return client
    .from("warehouseTransfer")
    .update(
      sanitize({
        ...fields,
        customFields,
        updatedBy,
        updatedAt: datetime.timestamp()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}
// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

type RuleLines = Parameters<typeof evaluateLinesForSurface>[0]["lines"];

type RuleSurface = Parameters<typeof evaluateLinesForSurface>[0]["surface"];

/** A post a blocking rule refused: what the user must see, or acknowledge. */
export type Blocked = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

/**
 * Every storage rule the lines break, on each surface in turn. Read as the
 * system: a user with `inventory` rights may not see the items or bins.
 */
export async function storageRuleViolations(
  ctx: ServiceContext,
  surfaces: RuleSurface[],
  lines: RuleLines
): Promise<Blocked> {
  const violations: Violation[] = [];
  const ruleNames: Record<string, string> = {};
  for (const surface of surfaces) {
    const result = await evaluateLinesForSurface({
      client: ctx.asSystem.supabase,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      targetType: "item",
      surface,
      lines
    });
    violations.push(...result.violations);
    Object.assign(ruleNames, result.ruleNames);
  }
  return { violations, ruleNames };
}

/** The server functions, run as the system for this call's company and user. */
export function system(ctx: ServiceContext) {
  return serverFns.system({
    db: ctx.asSystem.pg,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  });
}

const CATEGORY_BY_STATUS = Object.fromEntries(
  Object.entries(ERROR_STATUS).map(([category, status]) => [status, category])
) as Record<number, ErrorCategory>;

/**
 * A server function's failure as this operation's error, its category from
 * the function's own status. A call that returned no data and no error is
 * `internal`.
 */
export function serverFnFailure(
  ctx: ServiceContext,
  error: ServerFnError | null,
  message: string
): CarbonError {
  return ctx.error(
    (error && CATEGORY_BY_STATUS[error.status]) || "internal",
    message,
    error
  );
}

/** The caller's default location, from their user defaults. */
export async function defaultLocationOf(ctx: ServiceContext) {
  const defaults = await ctx.asCaller.supabase
    .from("userDefaults")
    .select("locationId")
    .eq("userId", ctx.auditUserId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  return defaults.data?.locationId ?? undefined;
}

/** Print a document's labels when its location's printer auto-prints. */
export async function autoPrint(
  ctx: ServiceContext,
  {
    sourceDocument,
    sourceDocumentId,
    locationId,
    context
  }: {
    sourceDocument: "Receipt" | "Shipment";
    sourceDocumentId: string;
    locationId: string | null;
    context: "receiving" | "shipping";
  }
) {
  if (!locationId) return;
  try {
    const config = await getCachedPrinterConfig(
      ctx.asSystem.supabase,
      ctx.company.id,
      locationId,
      context
    );
    if (config?.autoPrint ?? true) {
      await trigger("print-job", {
        sourceDocument,
        sourceDocumentId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        locationId
      });
    }
  } catch (error) {
    logger.error("Auto-print failed", { error });
  }
}

/** Print a fresh label for each tracked entity a post or pick split. */
export async function printEntityLabels(
  ctx: ServiceContext,
  entityIds: string[],
  locationId?: string
) {
  try {
    for (const entityId of entityIds) {
      await trigger("print-job", {
        sourceDocument: "Entity",
        sourceDocumentId: entityId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        ...(locationId ? { locationId } : {})
      });
    }
  } catch (error) {
    logger.error("Auto-print for split entities failed", { error });
  }
}

export function receiptFixedAssetLineChange(
  change: Omit<z.output<typeof receiptFixedAssetLineUpdateValidator>, "id">
) {
  switch (change.field) {
    case "received":
      return { received: change.value === "true" };
    case "serialNumber":
      return { serialNumber: change.value || null };
    case "meter":
      return { meter: change.value === "" ? null : Number(change.value) };
    case "notes":
      return { notes: change.value.trim() || null };
    case "outOfService":
      return change.value.trim() === ""
        ? { takeOutOfService: false, outOfServiceReason: null }
        : { takeOutOfService: true, outOfServiceReason: change.value.trim() };
    case "residualDestination":
      return {
        residualDestination: (change.value || null) as
          | "Fleet"
          | "Inventory"
          | null
      };
  }
}

/** The receipt line, read as the system: the tracking RPCs key on its ids alone. */
export async function receiptLineOf(
  ctx: ServiceContext,
  { receiptId, receiptLineId }: { receiptId: string; receiptLineId: string }
) {
  const line = await ctx.asSystem.supabase
    .from("receiptLine")
    .select("id, itemId")
    .eq("id", receiptLineId)
    .eq("receiptId", receiptId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (line.error) {
    return ctx.error(
      "internal",
      "Failed to verify the receipt line",
      line.error
    );
  }
  if (!line.data) {
    return ctx.error(
      "notFound",
      "The receipt line could not be found. It may have been deleted, or it belongs to another company."
    );
  }
  return line.data;
}

/** A sales-return receipt line, and the receipt's return order. */
export async function returnReceiptLineOf(
  ctx: ServiceContext,
  { receiptId, receiptLineId }: { receiptId: string; receiptLineId: string }
) {
  const client = ctx.asCaller.supabase;
  const [receipt, line] = await Promise.all([
    client
      .from("receipt")
      .select("id, sourceDocument, sourceDocumentId")
      .eq("id", receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle(),
    client
      .from("receiptLine")
      .select("id, lineId")
      .eq("id", receiptLineId)
      // Scoped to the receipt too: without it, a line of another receipt of
      // the same return order would tag the entity with a mismatched pair.
      .eq("receiptId", receiptId)
      .eq("companyId", ctx.company.id)
      .maybeSingle()
  ]);
  if (!receipt.data || receipt.data.sourceDocument !== "Sales Return Order") {
    return ctx.error(
      "validation",
      "Return tracking requires a sales-return receipt"
    );
  }
  if (!line.data?.lineId) {
    return ctx.error("validation", "Receipt line not found");
  }
  return {
    returnOrderId: receipt.data.sourceDocumentId,
    returnLineId: line.data.lineId
  };
}

export function withoutReceiptTracking(attributes: Record<string, unknown>) {
  const {
    Receipt: _receipt,
    "Receipt Line": _line,
    "Receipt Line Index": _index,
    ...rest
  } = attributes;
  return rest;
}

/**
 * Save a sales order shipment's packing slip on the order's opportunity.
 * Best effort: a failure is logged and never stops the post.
 */
export async function savePackingSlip(
  ctx: ServiceContext,
  { shipmentId, locale }: { shipmentId: string; locale: string }
) {
  const companyId = ctx.company.id;
  const serviceRole = ctx.asSystem.supabase;
  try {
    const shipment = await serviceRole
      .from("shipment")
      .select("sourceDocument, sourceDocumentId, shipmentId")
      .eq("id", shipmentId)
      .eq("companyId", companyId)
      .single();
    if (
      shipment.data?.sourceDocument !== "Sales Order" ||
      !shipment.data.sourceDocumentId
    ) {
      return;
    }

    const salesOrder = await serviceRole
      .from("salesOrder")
      .select("opportunityId")
      .eq("id", shipment.data.sourceDocumentId)
      .eq("companyId", companyId)
      .single();
    if (!salesOrder.data?.opportunityId) return;

    const pdf = await renderPackingSlip({
      client: ctx.asCaller.supabase,
      serviceRole,
      companyId,
      shipmentId,
      locale
    });
    if (pdf.headers.get("content-type") !== "application/pdf") return;

    const file = await pdf.arrayBuffer();
    const fileName = stripSpecialCharacters(
      `${shipment.data.shipmentId} - ${datetime.timestamp().slice(0, -5)}.pdf`
    );
    const documentFilePath = `${companyId}/opportunity/${salesOrder.data.opportunityId}/${fileName}`;
    const upload = await storage(serviceRole)
      .company(companyId)
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true
      });
    if (upload.error) return;

    await upsertDocument(serviceRole, {
      path: documentFilePath,
      name: fileName,
      size: round(file.byteLength / 1024, 0),
      sourceDocument: "Shipment",
      sourceDocumentId: shipmentId,
      readGroups: [ctx.auditUserId],
      writeGroups: [ctx.auditUserId],
      createdBy: ctx.auditUserId,
      companyId
    });
  } catch (error) {
    logger.error("Failed to generate packing slip PDF", { error });
  }
}

/** A stock transfer line of this company, with its transfer's status. */
export async function stockTransferLineOf(ctx: ServiceContext, lineId: string) {
  const line = await ctx.asCaller.supabase
    .from("stockTransferLine")
    .select(
      "id, stockTransferId, quantity, pickedQuantity, requiresSerialTracking, requiresBatchTracking, stockTransfer(status)"
    )
    .eq("id", lineId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (line.error) {
    return ctx.error(
      "internal",
      "Failed to load stock transfer line",
      line.error
    );
  }
  if (!line.data) {
    return ctx.error("notFound", "Stock transfer line not found");
  }
  if (line.data.stockTransfer?.status === "Completed") {
    return ctx.error("rule", "Cannot pick from a completed stock transfer.");
  }
  return line.data;
}

/** Move a line's stock (or put it back), and label any batch it split. */
export async function postStockTransferLine(
  ctx: ServiceContext,
  input: {
    type:
      | "inventory"
      | "unpickSerial"
      | "unpickBatch"
      | "unpickInventory"
      | "batch"
      | "serial";
    stockTransferId: string;
    stockTransferLineId: string;
    quantity: number;
    locationId: string;
    trackedEntityId?: string;
  },
  failure: (error: ServerFnError) => string
) {
  const moved = await invokePosting(
    ctx,
    "post-stock-transfer",
    // One body for every `type`; the function validates it per type.
    input as z.input<typeof postStockTransferInput>,
    postStockTransfer
  );
  if (moved.error)
    return serverFnFailure(ctx, moved.error, failure(moved.error));

  // The split child that arrives at the destination gets a fresh label; the
  // shelf parent whose quantity changed is reprinted.
  const splitEntityId = moved.data?.splitEntityId;
  if (splitEntityId) {
    await printEntityLabels(
      ctx,
      [
        splitEntityId,
        ...(input.trackedEntityId ? [input.trackedEntityId] : [])
      ],
      input.locationId || undefined
    );
  }
  return {
    stockTransferId: input.stockTransferId,
    stockTransferLineId: input.stockTransferLineId,
    quantity: input.quantity
  };
}

// ---------------------------------------------------------------------------
// Warehouse transfers
// ---------------------------------------------------------------------------

export const WAREHOUSE_TRANSFER_NOT_FOUND =
  "The warehouse transfer could not be found";

const WAREHOUSE_TRANSFER_LOCKED =
  "Cannot modify a locked warehouse transfer. Reopen it first.";

/** A Draft warehouse transfer of this company: any other is locked. */
export async function unlockedWarehouseTransfer(
  ctx: ServiceContext,
  transferId: string
) {
  const transfer = await ctx.asCaller.supabase
    .from("warehouseTransfer")
    .select("id, status, fromLocationId, toLocationId")
    .eq("id", transferId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (transfer.error) {
    return ctx.error(
      "internal",
      "Failed to load warehouse transfer",
      transfer.error
    );
  }
  if (!transfer.data) {
    return ctx.error("notFound", WAREHOUSE_TRANSFER_NOT_FOUND);
  }
  if (isWarehouseTransferLocked(transfer.data.status)) {
    return ctx.error("rule", WAREHOUSE_TRANSFER_LOCKED);
  }
  return transfer.data;
}

/** The line, when it is on this transfer. */
export async function warehouseTransferLineOf(
  ctx: ServiceContext,
  { transferId, id }: { transferId: string; id: string }
) {
  const line = await ctx.asCaller.supabase
    .from("warehouseTransferLine")
    .select("id")
    .eq("id", id)
    .eq("transferId", transferId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (line.error) {
    return ctx.error(
      "internal",
      "Failed to load warehouse transfer line",
      line.error
    );
  }
  if (!line.data) {
    return ctx.error(
      "notFound",
      "The warehouse transfer line could not be found"
    );
  }
  return line.data;
}

/** A pick's refusal: its message is written for the person picking. */
export function pickRefusal(
  ctx: ServiceContext,
  error: string | { message?: string }
) {
  return ctx.error(
    "rule",
    typeof error === "string" ? error : (error.message ?? "Failed to pick line")
  );
}
export type LineageDirection = "up" | "down" | "both";

export type LineagePayload = {
  entities: TrackedEntity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
  activities: Activity[];
  stepRecords?: StepRecord[];
  containments?: IssueContainment[];
};

// The graph collapses identical serial siblings into group nodes, so a large
// serial fan no longer costs a node each — the ceiling can afford whole jobs.
// The BFS must stay COMPLETE up to it: cluster signatures are computed from
// the full edge set, and a truncated frontier would split a group in two.
const MAX_ENTITIES = 500;

type LineageState = {
  companyId: string;
  entities: Map<string, TrackedEntity>;
  activities: Map<string, Activity>;
  inputs: Map<string, ActivityInput>;
  outputs: Map<string, ActivityOutput>;
  visited: Set<string>;
};

function newLineageState(companyId: string): LineageState {
  return {
    companyId,
    entities: new Map(),
    activities: new Map(),
    inputs: new Map(),
    outputs: new Map(),
    visited: new Set()
  };
}

async function expandActivitySiblings(
  client: SupabaseClient<Database>,
  state: LineageState,
  activityIds: string[]
): Promise<void> {
  const { companyId, entities, activities, inputs, outputs } = state;
  const newActivityIds = activityIds.filter((id) => !activities.has(id));
  if (newActivityIds.length > 0) {
    const fetched = await client
      .from("trackedActivity")
      .select("*")
      .in("id", newActivityIds)
      .eq("companyId", companyId);
    for (const row of fetched.data ?? []) {
      activities.set(row.id, row as unknown as Activity);
    }
  }

  // Pull sibling inputs/outputs for every activity so by-products (e.g. SCRAP)
  // appear even when not on the direct upstream/downstream path.
  const [siblingInputs, siblingOutputs] = await Promise.all([
    client
      .from("trackedActivityInput")
      .select("*")
      .in("trackedActivityId", activityIds)
      .eq("companyId", companyId),
    client
      .from("trackedActivityOutput")
      .select("*")
      .in("trackedActivityId", activityIds)
      .eq("companyId", companyId)
  ]);

  // These rows are the AUTHORITATIVE edge quantities — how much actually flowed
  // through this activity. Always overwrite: the BFS seeds edges from the
  // traversal RPCs, whose `quantity` column is the neighbour ENTITY's current
  // quantity (`te."quantity"`), not the edge's. Left as-is, a lot that was later
  // drawn down paints its post-hoc quantity onto a historical edge (a 6-unit
  // split reading "4" after 2 were consumed).
  const siblingEntityIds = new Set<string>();
  for (const row of siblingInputs.data ?? []) {
    const key = `${row.trackedActivityId}:${row.trackedEntityId}`;
    inputs.set(key, {
      trackedActivityId: row.trackedActivityId,
      trackedEntityId: row.trackedEntityId,
      quantity: row.quantity
    });
    if (!entities.has(row.trackedEntityId)) {
      siblingEntityIds.add(row.trackedEntityId);
    }
  }
  for (const row of siblingOutputs.data ?? []) {
    const key = `${row.trackedActivityId}:${row.trackedEntityId}`;
    outputs.set(key, {
      trackedActivityId: row.trackedActivityId,
      trackedEntityId: row.trackedEntityId,
      quantity: row.quantity
    });
    if (!entities.has(row.trackedEntityId)) {
      siblingEntityIds.add(row.trackedEntityId);
    }
  }

  if (siblingEntityIds.size > 0) {
    const remainingCapacity = MAX_ENTITIES - entities.size;
    const idsToFetch = Array.from(siblingEntityIds).slice(0, remainingCapacity);
    if (idsToFetch.length > 0) {
      const fetched = await client
        .from("trackedEntity")
        .select("*")
        .in("id", idsToFetch);
      for (const row of fetched.data ?? []) {
        entities.set(row.id, row as TrackedEntity);
      }
    }
  }
}

/**
 * Surface "event" activities (e.g. Pick, Transfer) that reference entities
 * already in the graph. The genealogy BFS only follows input→output
 * transformations (consume/produce/split), so input-only or output-only events
 * — a pick relocating a lot, say — would otherwise be invisible. These render as
 * activity nodes attached to their entity (no new genealogy edges).
 */
async function expandEntityActivities(
  client: SupabaseClient<Database>,
  state: LineageState
): Promise<void> {
  const entityIds = Array.from(state.entities.keys());
  if (entityIds.length === 0) return;

  const [ins, outs] = await Promise.all([
    client
      .from("trackedActivityInput")
      .select("trackedActivityId")
      .in("trackedEntityId", entityIds)
      .eq("companyId", state.companyId),
    client
      .from("trackedActivityOutput")
      .select("trackedActivityId")
      .in("trackedEntityId", entityIds)
      .eq("companyId", state.companyId)
  ]);

  const activityIds = new Set<string>();
  for (const row of ins.data ?? []) {
    if (!state.activities.has(row.trackedActivityId))
      activityIds.add(row.trackedActivityId);
  }
  for (const row of outs.data ?? []) {
    if (!state.activities.has(row.trackedActivityId))
      activityIds.add(row.trackedActivityId);
  }

  if (activityIds.size > 0) {
    await expandActivitySiblings(client, state, Array.from(activityIds));
  }
}

async function runLineageBfs(
  client: SupabaseClient<Database>,
  state: LineageState,
  initialFrontier: string[],
  direction: LineageDirection,
  safeDepth: number
): Promise<void> {
  const { companyId, entities, inputs, outputs, visited } = state;
  let frontier = initialFrontier.filter((id) => {
    if (visited.has(id)) return true;
    visited.add(id);
    return true;
  });

  for (let hop = 0; hop < safeDepth; hop++) {
    if (frontier.length === 0) break;
    if (entities.size >= MAX_ENTITIES) break;

    type BatchRow = {
      sourceEntityId: string;
      trackedActivityId: string;
      id: string;
      quantity: number;
    };

    const calls: Promise<void>[] = [];
    let descendantsBatch: BatchRow[] = [];
    let ancestorsBatch: BatchRow[] = [];

    if (direction === "down" || direction === "both") {
      calls.push(
        (async () => {
          const res = await client.rpc(
            "get_direct_descendants_of_tracked_entities_strict",
            { p_tracked_entity_ids: frontier, p_company_id: companyId }
          );
          descendantsBatch = (res.data ?? []) as BatchRow[];
        })()
      );
    }
    if (direction === "up" || direction === "both") {
      calls.push(
        (async () => {
          const res = await client.rpc(
            "get_direct_ancestors_of_tracked_entities_strict",
            { p_tracked_entity_ids: frontier, p_company_id: companyId }
          );
          ancestorsBatch = (res.data ?? []) as BatchRow[];
        })()
      );
    }

    await Promise.all(calls);

    const nextFrontier = new Set<string>();
    const newEntityIds = new Set<string>();
    const activityIds = new Set<string>();

    for (let i = 0; i < descendantsBatch.length; i++) {
      const row = descendantsBatch[i];
      if (!row?.id) continue;
      activityIds.add(row.trackedActivityId);
      const outputKey = `${row.trackedActivityId}:${row.sourceEntityId}`;
      if (!outputs.has(outputKey)) {
        outputs.set(outputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.sourceEntityId,
          quantity: row.quantity
        });
      }
      if (!visited.has(row.id)) {
        visited.add(row.id);
        newEntityIds.add(row.id);
        nextFrontier.add(row.id);
      }
      const inputKey = `${row.trackedActivityId}:${row.id}`;
      if (!inputs.has(inputKey)) {
        inputs.set(inputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.id,
          quantity: row.quantity
        });
      }
    }

    for (let i = 0; i < ancestorsBatch.length; i++) {
      const row = ancestorsBatch[i];
      if (!row?.id) continue;
      activityIds.add(row.trackedActivityId);
      const inputKey = `${row.trackedActivityId}:${row.sourceEntityId}`;
      if (!inputs.has(inputKey)) {
        inputs.set(inputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.sourceEntityId,
          quantity: row.quantity
        });
      }
      if (!visited.has(row.id)) {
        visited.add(row.id);
        newEntityIds.add(row.id);
        nextFrontier.add(row.id);
      }
      const outputKey = `${row.trackedActivityId}:${row.id}`;
      if (!outputs.has(outputKey)) {
        outputs.set(outputKey, {
          trackedActivityId: row.trackedActivityId,
          trackedEntityId: row.id,
          quantity: row.quantity
        });
      }
    }

    if (newEntityIds.size > 0) {
      const remainingCapacity = MAX_ENTITIES - entities.size;
      const idsToFetch = Array.from(newEntityIds).slice(0, remainingCapacity);
      const fetched = await client
        .from("trackedEntity")
        .select("*")
        .in("id", idsToFetch)
        .eq("companyId", companyId);
      for (const row of fetched.data ?? []) {
        entities.set(row.id, row as TrackedEntity);
      }
    }

    if (activityIds.size > 0) {
      await expandActivitySiblings(client, state, Array.from(activityIds));
    }

    frontier = Array.from(nextFrontier);
  }
}

export async function fetchLineageSubgraph(
  client: SupabaseClient<Database>,
  rootEntityId: string,
  companyId: string,
  depth: number,
  direction: LineageDirection = "both"
): Promise<LineagePayload> {
  const safeDepth = clampDepth(depth);

  const rootEntity = await client
    .from("trackedEntity")
    .select("*")
    .eq("id", rootEntityId)
    .eq("companyId", companyId)
    .maybeSingle();

  const state = newLineageState(companyId);
  if (rootEntity.data)
    state.entities.set(rootEntity.data.id, rootEntity.data as TrackedEntity);

  await runLineageBfs(client, state, [rootEntityId], direction, safeDepth);

  // Attach event activities (Pick/Transfer/etc.) for the entities in the graph
  // so location moves like picking show up, not just genealogy transformations.
  await expandEntityActivities(client, state);

  return {
    entities: Array.from(state.entities.values()),
    inputs: Array.from(state.inputs.values()),
    outputs: Array.from(state.outputs.values()),
    activities: Array.from(state.activities.values())
  };
}

export async function fetchJobStepRecords(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
): Promise<StepRecord[]> {
  const res = await client.rpc("get_job_operation_step_records", {
    p_job_id: jobId,
    p_company_id: companyId
  });
  if (!res.data) return [];
  return (res.data as any[]).map((r) => ({
    id: r.id,
    jobOperationStepId: r.jobOperationStepId,
    index: r.index,
    type: r.type,
    name: r.name,
    value: r.value,
    numericValue: r.numericValue,
    booleanValue: r.booleanValue,
    userValue: r.userValue,
    unitOfMeasureCode: r.unitOfMeasureCode,
    minValue: r.minValue,
    maxValue: r.maxValue,
    operationId: r.operationId,
    operationDescription: r.operationDescription,
    itemId: r.itemId,
    itemReadableId: r.itemReadableId,
    createdAt: r.createdAt,
    createdBy: r.createdBy
  }));
}

export async function fetchContainmentsForEntities(
  client: SupabaseClient<Database>,
  entityIds: string[],
  companyId: string
): Promise<IssueContainment[]> {
  if (entityIds.length === 0) return [];

  // Single round-trip: PostgREST embed pulls the linked issue inline and
  // filters server-side to only Contained/Uncontained statuses.
  const res = await client
    .from("nonConformanceTrackedEntity")
    .select(
      `trackedEntityId,
       nonConformanceId,
       issue:issues!inner(id, status, priority, containmentStatus)`
    )
    .in("trackedEntityId", entityIds)
    .eq("companyId", companyId)
    .in("issue.containmentStatus", ["Contained", "Uncontained"]);

  const containments: IssueContainment[] = [];
  for (const row of res.data ?? []) {
    const issue = row.issue as {
      id: string | null;
      status: string | null;
      priority: string | null;
      containmentStatus: string | null;
    } | null;
    if (!issue) continue;
    const status = issue.containmentStatus;
    if (status !== "Contained" && status !== "Uncontained") continue;
    containments.push({
      id: issue.id ?? row.nonConformanceId,
      readableId: row.nonConformanceId,
      containmentStatus: status as IssueContainmentStatus,
      status: issue.status ?? "",
      priority: issue.priority ?? null,
      trackedEntityId: row.trackedEntityId
    });
  }
  return containments;
}

export async function fetchJobScopedLineage(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string,
  depth: number
): Promise<LineagePayload> {
  const safeDepth = clampDepth(depth);

  const [seedEntitiesRes, seedActivitiesRes] = await Promise.all([
    client
      .from("trackedEntity")
      .select("*")
      .eq("attributes->>Job", jobId)
      .eq("companyId", companyId),
    client
      .from("trackedActivity")
      .select("*")
      .eq("attributes->>Job", jobId)
      .eq("companyId", companyId)
  ]);

  const state = newLineageState(companyId);
  for (const row of (seedEntitiesRes.data ?? []) as TrackedEntity[]) {
    state.entities.set(row.id, row);
  }
  for (const row of (seedActivitiesRes.data ?? []) as unknown as Activity[]) {
    state.activities.set(row.id, row);
  }

  if (state.activities.size > 0) {
    await expandActivitySiblings(
      client,
      state,
      Array.from(state.activities.keys())
    );
  }

  if (state.entities.size > 0) {
    await runLineageBfs(
      client,
      state,
      Array.from(state.entities.keys()),
      "both",
      safeDepth
    );
  }

  const containments = await fetchContainmentsForEntities(
    client,
    Array.from(state.entities.keys()),
    companyId
  );

  return {
    entities: Array.from(state.entities.values()),
    inputs: Array.from(state.inputs.values()),
    outputs: Array.from(state.outputs.values()),
    activities: Array.from(state.activities.values()),
    containments
  };
}

export function toGraphData(payload: LineagePayload): GraphData {
  const nodes = [
    ...payload.entities.map((entity) => ({
      id: entity.id,
      type: "entity" as const,
      data: entity,
      parentId: null
    })),
    ...payload.activities.map((activity) => ({
      id: activity.id,
      type: "activity" as const,
      data: activity,
      parentId: null
    }))
  ];

  // Historical split survivors are recorded as both input and output of their
  // own Split activity. Drop the output half of that self-loop so the graph
  // doesn't render the survivor as produced by its own split; the input edge
  // stays (it carries the drawn quantity).
  const splitActivityIds = new Set(
    payload.activities.filter((a) => a?.type === "Split").map((a) => a.id)
  );
  const inputPairs = new Set(
    pluckUnique(
      payload.inputs.filter((input) =>
        splitActivityIds.has(input.trackedActivityId)
      ),
      (input) => `${input.trackedActivityId}::${input.trackedEntityId}`
    )
  );

  const links = [
    ...payload.inputs.map((input) => ({
      source: input.trackedEntityId,
      target: input.trackedActivityId,
      type: "input" as const,
      quantity: input.quantity
    })),
    ...payload.outputs
      .filter(
        (output) =>
          !inputPairs.has(
            `${output.trackedActivityId}::${output.trackedEntityId}`
          )
      )
      .map((output) => ({
        source: output.trackedActivityId,
        target: output.trackedEntityId,
        type: "output" as const,
        quantity: output.quantity
      }))
  ];

  return { nodes, links };
}

/**
 * Resolve the storage-unit ids that movement activities carry in their
 * attributes ("From Shelf" / "To Shelf") into names, written back as
 * "From Storage Unit Name" / "To Storage Unit Name".
 *
 * The graph renders a lot as a chain of states; a movement produces two states
 * with the SAME quantity, so the bin is the only thing that distinguishes
 * them. Without this they render identically and a Pick looks like a no-op.
 * Enriching here keeps the ids server-side and needs no extra plumbing — the
 * activities already flow through the payload to the layout worker.
 */
export async function enrichActivityBinNames(
  client: SupabaseClient<Database>,
  payload: LineagePayload,
  companyId: string
): Promise<LineagePayload> {
  const binIds = new Set<string>();
  for (const activity of payload.activities) {
    const attrs = activity.attributes as Record<string, unknown> | null;
    for (const key of ["From Shelf", "To Shelf"]) {
      const id = attrs?.[key];
      if (typeof id === "string" && id) binIds.add(id);
    }
  }
  if (binIds.size === 0) return payload;

  const storageUnits = await client
    .from("storageUnit")
    .select("id, name")
    .in("id", Array.from(binIds))
    .eq("companyId", companyId);
  if (storageUnits.error || !storageUnits.data?.length) return payload;

  const nameById = indexByMapped(
    storageUnits.data,
    (row) => row.id,
    (row) => row.name
  );

  return {
    ...payload,
    activities: payload.activities.map((activity) => {
      const attrs = activity.attributes as Record<string, unknown> | null;
      const from = attrs?.["From Shelf"];
      const to = attrs?.["To Shelf"];
      const fromName =
        typeof from === "string" ? nameById.get(from) : undefined;
      const toName = typeof to === "string" ? nameById.get(to) : undefined;
      if (!fromName && !toName) return activity;
      return {
        ...activity,
        attributes: {
          ...(attrs ?? {}),
          ...(fromName ? { "From Storage Unit Name": fromName } : {}),
          ...(toName ? { "To Storage Unit Name": toName } : {})
        }
      };
    })
  };
}
export const previewSerialUnitCostsInput = z.object({
  itemId: z.string().min(1),
  // Only the units on hand at this location; every location when absent.
  locationId: z.string().optional().nullable()
});

export type SerialUnitCosts = {
  costs: Record<string, number>;
  // Only a FIFO / LIFO item's unit can be recosted on its own.
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"] | null;
};

export const previewSerialUnitCostsPermission = {
  view: "accounting"
} satisfies PermissionRule<z.output<typeof previewSerialUnitCostsInput>>;

export async function previewSerialUnitCosts(
  ctx: ServiceContext,
  raw: z.input<typeof previewSerialUnitCostsInput>
) {
  const { itemId, locationId } = previewSerialUnitCostsInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const item = await db
    .selectFrom("item")
    .select("itemTrackingType")
    .where("id", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!item) throw new NotFoundError("Item not found");
  if (item.itemTrackingType !== "Serial") {
    return { costs: {}, costingMethod: null };
  }

  let onHandQuery = db
    .selectFrom("itemLedger")
    .select("trackedEntityId")
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("trackedEntityId", "is not", null)
    .groupBy("trackedEntityId")
    .having(sql<number>`SUM("quantity")`, ">", 0);
  if (locationId)
    onHandQuery = onHandQuery.where("locationId", "=", locationId);

  const [onHand, itemCost] = await inOrder([
    () => onHandQuery.execute(),
    () =>
      db
        .selectFrom("itemCost")
        .select(["costingMethod", "unitCost", "standardCost"])
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);
  if (!itemCost) throw new NotFoundError("Item cost not found");
  const units = onHand.flatMap((row) =>
    row.trackedEntityId ? [row.trackedEntityId] : []
  );
  if (units.length === 0) {
    return { costs: {}, costingMethod: itemCost.costingMethod };
  }

  const isLayered =
    itemCost.costingMethod === "FIFO" || itemCost.costingMethod === "LIFO";
  const direction = itemCost.costingMethod === "LIFO" ? "desc" : "asc";
  // The layers calculateCOGS would consume from, in its order.
  const layers = isLayered
    ? await db
        .selectFrom("costLedger")
        .select([
          "id",
          "trackedEntityId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
        .where((eb) =>
          eb.or([
            eb("documentType", "is", null),
            eb("documentType", "!=", "Purchase Order")
          ])
        )
        .orderBy("postingDate", direction)
        .orderBy("createdAt", direction)
        .execute()
    : [];

  const childrenByLayer = new Map<string, UnitCostChild[]>();
  if (layers.length > 0) {
    const children = await db
      .selectFrom("costLedger")
      .select([
        "appliesToCostLedgerId",
        "quantity",
        "cost",
        "remainingQuantity"
      ])
      .where(
        "appliesToCostLedgerId",
        "in",
        layers.map((layer) => layer.id)
      )
      .where("companyId", "=", companyId)
      .where("remainingQuantity", ">", 0)
      .orderBy("createdAt", "asc")
      .execute();
    for (const child of children) {
      if (!child.appliesToCostLedgerId) continue;
      const list = childrenByLayer.get(child.appliesToCostLedgerId) ?? [];
      list.push({
        quantity: Number(child.quantity),
        cost: Number(child.cost),
        remainingQuantity: Number(child.remainingQuantity)
      });
      childrenByLayer.set(child.appliesToCostLedgerId, list);
    }
  }

  const basis = {
    costingMethod: itemCost.costingMethod,
    unitCost: itemCost.unitCost == null ? null : Number(itemCost.unitCost),
    standardCost:
      itemCost.standardCost == null ? null : Number(itemCost.standardCost)
  };
  const valuedLayers = layers.map((layer) => ({
    id: layer.id,
    trackedEntityId: layer.trackedEntityId,
    quantity: Number(layer.quantity),
    cost: Number(layer.cost),
    remainingQuantity: Number(layer.remainingQuantity)
  }));

  const costs: Record<string, number> = {};
  for (const trackedEntityId of units) {
    costs[trackedEntityId] = round(
      serialUnitCost({
        itemCost: basis,
        layers: valuedLayers,
        childrenByLayer,
        trackedEntityId
      })
    );
  }
  return { costs, costingMethod: itemCost.costingMethod };
}
export const recostSerialUnitInput = z.object({
  trackedEntityId: z.string().min(1),
  // The unit's new carrying cost, in base currency.
  unitCost: z.number().min(0),
  offsetAccountId: z.string().optional().nullable(),
  postingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
});

export type RecostResult = {
  previousCost: number;
  unitCost: number;
  journalId: string | null;
};

export const recostSerialUnitPermission = {
  update: "accounting"
} satisfies PermissionRule<z.output<typeof recostSerialUnitInput>>;

export async function recostSerialUnit(
  ctx: ServiceContext,
  raw: z.input<typeof recostSerialUnitInput>
) {
  const input = recostSerialUnitInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const unitCost = round(input.unitCost);

  return db.transaction().execute(async (trx): Promise<RecostResult> => {
    // Lock the unit before reading where it is: a second recost, or an
    // issue, pick, transfer or adjustment of it (they lock it too), waits,
    // so the on-hand check below still holds when calculateCOGS relieves
    // its layer (which locks the layers it reads).
    const entity = await trx
      .selectFrom("trackedEntity")
      .select(["id", "itemId", "readableId", "status"])
      .where("id", "=", input.trackedEntityId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!entity?.itemId) throw new NotFoundError("Tracked entity not found");
    const itemId = entity.itemId;
    const serial = entity.readableId ?? entity.id;

    const [item, itemCost] = await inOrder([
      () =>
        trx
          .selectFrom("item")
          .select(["readableId", "itemTrackingType", "replenishmentSystem"])
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst(),
      () =>
        trx
          .selectFrom("itemCost")
          .select(["costingMethod", "itemPostingGroupId"])
          .where("itemId", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
    ]);
    if (!item || !itemCost) throw new NotFoundError("Item not found");
    if (item.itemTrackingType !== "Serial") {
      throw new InvalidInputError("Only a serialized unit can be recosted");
    }
    if (
      itemCost.costingMethod !== "FIFO" &&
      itemCost.costingMethod !== "LIFO"
    ) {
      throw new InvalidInputError(
        `${item.readableId} uses ${itemCost.costingMethod} costing, so every unit carries the item's cost; one unit cannot have its own`
      );
    }

    // Where the unit is: exactly one on hand, at one location.
    const stock = await trx
      .selectFrom("itemLedger")
      .select([
        "locationId",
        (eb) => eb.fn.sum<number>("quantity").as("onHand")
      ])
      .where("trackedEntityId", "=", entity.id)
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId)
      .groupBy("locationId")
      .having(sql<number>`SUM("quantity")`, ">", 0)
      .execute();
    const onHand = stock.reduce((sum, row) => sum + Number(row.onHand), 0);
    if (round(onHand) !== 1 || stock.length !== 1) {
      throw new InvalidInputError(
        `${serial} must have exactly one unit on hand to be recosted`
      );
    }
    const locationId = stock[0]?.locationId ?? null;

    // Provisional before the company's accounting cutover, Posted after it.
    const postingStatus = await journalPostingStatus(trx, companyId);
    const accounting = await loadAccounting(
      trx,
      companyId,
      input,
      postingStatus
    );

    // Relieve what the unit carries today, exactly as a shipment would.
    const relieved = await calculateCOGS(trx, {
      itemId,
      quantity: 1,
      companyId,
      trackedEntityIds: [entity.id]
    });
    const previousCost = round(relieved.totalCost);
    const delta = round(unitCost - previousCost);
    if (delta === 0) {
      throw new InvalidInputError(`${serial} is already carried at that cost`);
    }

    const ledger = {
      documentType: null,
      documentId: entity.id,
      itemId,
      postingDate: input.postingDate,
      trackedEntityId: entity.id,
      companyId
    };
    await trx
      .insertInto("costLedger")
      .values([
        {
          ...buildCostLedgerRow({
            ...ledger,
            entryType: "Negative Adjmt.",
            quantity: -1,
            cost: -previousCost
          }),
          costLedgerType: "Revaluation"
        },
        {
          // The unit's own layer: it is relieved first when it leaves.
          ...buildCostLedgerRow({
            ...ledger,
            entryType: "Positive Adjmt.",
            quantity: 1,
            cost: unitCost
          }),
          costLedgerType: "Revaluation"
        }
      ])
      .execute();

    const inventoryAccount = resolveInventoryAccount(
      item.replenishmentSystem,
      accounting.accountDefaults
    );
    const journalId = await createAdjustmentJournal(trx, {
      companyId,
      accountingPeriodId: accounting.accountingPeriodId,
      status: postingStatus,
      description: `Recost ${item.readableId} ${serial}`,
      postingDate: input.postingDate,
      userId,
      sourceType: "Inventory Adjustment"
    });
    const journalLineReference = nanoid();
    const lines = await trx
      .insertInto("journalLine")
      .values(
        buildOffsetLines({
          amount: delta,
          accountId: inventoryAccount.account,
          description: inventoryAccount.description,
          offsetAccountId: accounting.offsetAccount.id,
          offsetDescription: "Inventory Recost",
          offsetAccountType: accounting.offsetAccount.type,
          label: "Inventory recost journal"
        }).map((line) => ({
          journalId,
          accountId: line.accountId,
          description: line.description,
          amount: line.amount,
          quantity: 1,
          documentType: "Inventory Adjustment" as const,
          documentId: entity.id,
          journalLineReference,
          companyId
        }))
      )
      .returning(["id"])
      .execute();
    const dimensions = buildJournalLineDimensions({
      journalLineIds: lines.map((line) => line.id),
      dimensions: accounting.dimensions,
      itemId,
      itemPostingGroupId: itemCost.itemPostingGroupId,
      locationId,
      companyId
    });
    if (dimensions.length > 0) {
      await trx.insertInto("journalLineDimension").values(dimensions).execute();
    }

    return { previousCost, unitCost, journalId };
  });
}

// Everything the journal needs, read on the recost's transaction.
async function loadAccounting(
  db: Kysely<DB>,
  companyId: string,
  input: z.output<typeof recostSerialUnitInput>,
  postingStatus: AutomaticJournalStatus
) {
  const [defaults, offsetAccount, company] = await inOrder([
    () => getDefaultPostingGroup(db, companyId),
    () => getOffsetAccount(db, companyId, input.offsetAccountId),
    () =>
      db
        .selectFrom("company")
        .select("companyGroupId")
        .where("id", "=", companyId)
        .executeTakeFirst()
  ]);
  if (defaults.error || !defaults.data) {
    throw new Error("Error getting account defaults");
  }
  if (!company) throw new Error("Failed to fetch company");
  // Fail closed: journal lines must not silently lose dimension tags.
  const dimensionRows = await db
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["Item", "ItemPostingGroup", "Location"])
    .execute();
  const dimensions: Record<string, string> = {};
  for (const row of dimensionRows) {
    if (row.entityType) dimensions[row.entityType] = row.id;
  }
  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getAccountingPeriodForDate(companyId, db, input.postingDate)
      : null;
  return {
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: defaults.data.rawMaterialsAccount,
      finishedGoodsAccount: defaults.data.finishedGoodsAccount
    },
    offsetAccount,
    dimensions
  };
}
// Pure decision for how a counted tracked entity's quantity and status settle.
// A count books its ledger delta from the SNAPSHOT taken when the count was
// generated; the entity's live quantity may have moved since. Applying the same
// delta to the live quantity keeps entity and ledger in step — but if that lands
// below zero the two have genuinely diverged, so we refuse (recount) rather than
// clamp, which would desync the entity from the already-booked ledger delta.

export function resolveCountedEntity<S extends string>(input: {
  currentQuantity: number;
  delta: number;
  currentStatus: S;
}): { quantity: number; status: S | "Consumed" } {
  return settleQuantity({
    quantity: input.currentQuantity + input.delta,
    status: input.currentStatus,
    refusal:
      "Stock moved since the count was taken; recount this line before posting"
  });
}
// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure planning core for posting an inventory count, extracted so the delta math
// can be unit-tested without a database.
//
// Reconciliation model: post the variance the counter reviewed against the
// FROZEN snapshot — `delta = counted - systemQuantity` — NOT against live on-hand.
// This preserves any stock movements that posted between the snapshot and the
// post (a receipt/shipment isn't clobbered; the count's correction is applied on
// top of it). A line whose delta is 0 is still returned; the caller skips writing
// it.

export type PlannableLine = {
  id: string;
  itemId: string;
  systemQuantity: number | string | null;
  // Callers pass only counted lines; null is tolerated for the row type and
  // coerces to 0 (delta = −systemQuantity), never actually reached.
  countedQuantity: number | string | null;
};

export type PlanResult<L extends PlannableLine> = {
  planned: { line: L; delta: number }[];
};

export function planInventoryCountPost<L extends PlannableLine>(
  lines: L[]
): PlanResult<L> {
  const planned = lines.map((line) => ({
    line,
    delta: Number(line.countedQuantity) - Number(line.systemQuantity)
  }));
  return { planned };
}
// Base for post-blocking validation errors. Carries the offending line ids so
// the response can hand them to the UI to highlight the rows.
// A 400 whose `body.invalidLineIds` the caller reads to highlight the rows.
class InvalidLinesError extends InvalidInputError {
  constructor(message: string, lineIds: string[]) {
    super(message, { invalidLineIds: lineIds });
    this.name = "InvalidLinesError";
  }
}

// Thrown when a serial-tracked line is counted as anything other than 0 or 1
// (a serial entity is a single unique unit).
class SerialQuantityError extends InvalidLinesError {
  constructor(lineIds: string[]) {
    super(
      `${lineIds.length} serial line(s) must be counted as 0 or 1 — a serial number is a single unit.`,
      lineIds
    );
    this.name = "SerialQuantityError";
  }
}

// Inventory Count posting uses snapshot-delta reconciliation: for each counted
// line we post a single Positive/Negative adjustment for the variance the counter
// reviewed — `counted - systemQuantity` (the FROZEN snapshot on the line), NOT
// `counted - live on-hand`. This preserves any stock movements that posted between
// the snapshot and the post (a receipt/shipment isn't clobbered; the correction is
// applied on top of it). Each variance books through the shared posting core:
// item ledger + cost layers + a GL journal (Provisional before the accounting
// cutover, Posted after it) against the inventory adjustment variance account.
// A count posts exactly once (Posted is terminal). Fixing a posted movement
// happens per-movement via the correct-stock-movement server function, which
// links the fix through itemLedger.correctionOfItemLedgerId.
export const postInventoryCountInput = z.object({
  inventoryCountId: z.string()
});

export const postInventoryCountPermission = {
  update: "inventory"
} satisfies PermissionRule<z.output<typeof postInventoryCountInput>>;

/** Posts a Pending inventory count: one adjustment per counted variance, atomically. */
export async function postInventoryCount(
  ctx: ServiceContext,
  raw: z.input<typeof postInventoryCountInput>
) {
  const { inventoryCountId } = postInventoryCountInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  const nowIso = datetime.timestamp();

  const inventoryCount = await single(db, "inventoryCount", {
    id: inventoryCountId,
    companyId
  });

  if (inventoryCount.error)
    throw new NotFoundError("Inventory count not found");

  const lines = await many(db, "inventoryCountLine", {
    inventoryCountId,
    companyId,
    countedQuantity: notNull
  });

  if (lines.error) throw new Error(lines.error.message);

  const comment = `Inventory Count ${inventoryCount.data.inventoryCountId}`;
  const countedLines = (lines.data ?? []).filter(
    (line) => line.countedQuantity !== null
  );

  // Serial validation: a serial-tracked item is a single unique unit, so each
  // serial line can only be counted 0 or 1. Block the post (before any write)
  // and return the offending line ids so the UI can highlight them.
  const itemIds = [...new Set(countedLines.map((line) => line.itemId))];
  const items = itemIds.length
    ? await many(
        db,
        "item",
        { id: itemIds, companyId },
        { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
      )
    : null;
  if (items?.error) throw new Error(items.error.message);

  const trackingTypeByItem = new Map<string, string | null>(
    (items?.data ?? []).map((item) => [item.id, item.itemTrackingType])
  );
  // Explicit row types for these selects.
  type CountItemRow = {
    id: string;
    replenishmentSystem:
      | Database["public"]["Enums"]["itemReplenishmentSystem"]
      | null;
  };
  type CountItemCostRow = {
    itemId: string;
    costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
    unitCost: number | null;
    standardCost: number | null;
    itemPostingGroupId: string | null;
  };
  const replenishmentByItem = new Map(
    ((items?.data ?? []) as CountItemRow[]).map((item) => [
      item.id,
      item.replenishmentSystem
    ])
  );

  const itemCosts = itemIds.length
    ? await many(
        db,
        "itemCost",
        { itemId: itemIds, companyId },
        {
          columns: [
            "itemId",
            "costingMethod",
            "unitCost",
            "standardCost",
            "itemPostingGroupId"
          ]
        }
      )
    : null;
  if (itemCosts?.error) throw new Error(itemCosts.error.message);
  const itemCostByItem = new Map(
    ((itemCosts?.data ?? []) as CountItemCostRow[]).map((cost) => [
      cost.itemId,
      cost
    ])
  );
  const serialInvalidLineIds = countedLines
    .filter((line) => {
      if (trackingTypeByItem.get(line.itemId) !== "Serial") return false;
      const counted = Number(line.countedQuantity);
      return counted !== 0 && counted !== 1;
    })
    .map((line) => line.id);
  if (serialInvalidLineIds.length > 0) {
    throw new SerialQuantityError(serialInvalidLineIds);
  }

  // Reconcile against the frozen snapshot — no live on-hand read needed.
  const { planned } = planInventoryCountPost(countedLines);

  // Every variance that carries value posts to ONE journal: Provisional
  // before the company's accounting cutover, Posted after it. Resolve the
  // status + period BEFORE the transaction (REST hops mid-transaction park
  // the size-1 pool in idle-in-transaction); the status is read again inside.
  const postingStatus = await journalPostingStatus(db, companyId);
  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }
  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, db, today)
      : null;

  // Active dimensions for the company group (post-shipment precedent) —
  // journal lines get Item / ItemPostingGroup / Location tags.
  const dimensionMap: Record<string, string> = {};
  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );
  if (companyRecord.error) throw new Error("Failed to fetch company");
  const dimensions = await many(
    db,
    "dimension",
    {
      companyGroupId: companyRecord.data.companyGroupId!,
      active: true,
      entityType: ["Item", "ItemPostingGroup", "Location"]
    },
    { columns: ["id", "entityType"] }
  );
  // Fail closed: journal lines must not silently lose dimension tags.
  if (dimensions.error) throw new Error("Failed to fetch dimensions");
  for (const dim of dimensions.data ?? []) {
    if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
  }

  const accounting = {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      inventoryAdjustmentVarianceAccount:
        accountDefaults.data.inventoryAdjustmentVarianceAccount
    },
    description: comment,
    userId,
    dimensions: dimensionMap
  };

  await db.transaction().execute(async (trx) => {
    // Concurrency guard: lock the header and re-assert it is still Pending so
    // two concurrent posts can't both apply the delta (double-post). Mirrors
    // the FOR UPDATE guard in post-payment / post-memo; the end-of-transaction
    // guarded UPDATE below is the backstop.
    const locked = await trx
      .selectFrom("inventoryCount")
      .select(["id", "status"])
      .where("id", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!locked) throw new NotFoundError("Inventory count not found");
    if (locked.status !== "Pending") {
      throw new Error("Inventory count is no longer pending");
    }
    await assertPostingStatusUnchanged(trx, companyId, postingStatus);

    // ONE journal per count post: created lazily on the first variance that
    // carries value, then shared by every line's journal-line pair.
    let sharedJournalId: string | null = null;
    const accountingForLines = {
      ...accounting,
      getJournalId: async () => {
        if (!sharedJournalId) {
          sharedJournalId = await createAdjustmentJournal(trx, {
            companyId,
            accountingPeriodId: accounting.accountingPeriodId,
            status: postingStatus,
            description: accounting.description,
            postingDate: today,
            userId
          });
        }
        return sharedJournalId;
      }
    };

    // Post the reviewed variance for each line as an inventory adjustment,
    // booked through the shared core (ledger + cost layers + journal).
    for (const { line, delta } of planned) {
      if (delta === 0) continue;

      const itemCost = itemCostByItem.get(line.itemId);
      if (!itemCost) {
        throw new Error(`Missing item cost for item ${line.itemId}`);
      }

      const booked = await bookAdjustment(trx, {
        ledger: {
          postingDate: today,
          itemId: line.itemId,
          quantity: delta,
          locationId: line.locationId,
          storageUnitId: line.storageUnitId,
          trackedEntityId: line.trackedEntityId,
          entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
          documentType: "Inventory Count",
          documentId: inventoryCountId,
          comment,
          companyId,
          createdBy: userId
        },
        item: {
          itemTrackingType: trackingTypeByItem.get(line.itemId) ?? null,
          replenishmentSystem: replenishmentByItem.get(line.itemId) ?? null,
          itemPostingGroupId: itemCost.itemPostingGroupId
        },
        itemCost,
        accounting: accountingForLines
      });

      // Tracked lines: apply the same delta to the entity's quantity (not a
      // set-to-counted) so movements since the snapshot aren't overwritten.
      // Lock and read the live row so the guard sees the current quantity;
      // a delta that would drive it negative means stock moved since the
      // count, so we throw to roll back rather than clamp (which would desync
      // the entity from the ledger delta already booked above). Landing on
      // zero flips the lot Consumed.
      if (line.trackedEntityId) {
        const entity = await trx
          .selectFrom("trackedEntity")
          .select(["quantity", "status"])
          .where("id", "=", line.trackedEntityId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        const settled = resolveCountedEntity({
          currentQuantity: Number(entity?.quantity ?? 0),
          delta,
          currentStatus: entity?.status ?? "Available"
        });
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: settled.quantity, status: settled.status })
          .where("id", "=", line.trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();
      }

      await trx
        .updateTable("inventoryCountLine")
        .set({ postedItemLedgerId: booked.itemLedgerId })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    // Guard the transition inside the transaction: only a still-Pending count
    // can be posted. If a concurrent post already moved it to Posted, this
    // matches 0 rows and we throw to roll back this transaction's ledger
    // writes — preventing a double-post.
    const posted = await trx
      .updateTable("inventoryCount")
      .set({
        status: "Posted",
        postedBy: userId,
        postedAt: nowIso,
        updatedBy: userId,
        updatedAt: nowIso
      })
      .where("id", "=", inventoryCountId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Pending")
      .returning(["id"])
      .executeTakeFirst();

    if (!posted) {
      throw new Error("Inventory count is no longer pending");
    }
  });

  return { success: true };
}
const postStockTransferLogger = getLogger(
  "server-functions",
  "post-stock-transfer"
);

/**
 * A line moves stock out of the bin it names, and only that bin (`null` is the
 * unassigned bin). Picking a unit held elsewhere would book its -1 against a
 * bin that does not hold it.
 */
async function assertInSourceBin(
  trx: Transaction<KyselyDatabase>,
  args: {
    trackedEntityId: string;
    readableId: string | null;
    quantity: number;
    locationId: string;
    storageUnitId: string | null;
    companyId: string;
  }
) {
  const onHand = await getTrackedEntityOnHandInBin(trx, args);
  if (round(onHand) < round(args.quantity)) {
    throw new PickGuardError(
      "over-pick",
      `${args.readableId ?? args.trackedEntityId} is not in this line's source storage unit`
    );
  }
}

/**
 * Applies the company's expired-entity policy to one entity about to be
 * transferred: a warning under `Warn`, a throw when blocked. An override with
 * a reason passes under `BlockWithOverride`.
 */
function checkExpiredEntity(
  entity: { id: string; expirationDate: string | null },
  policy: ExpiredEntityPolicy,
  override: ExpiryOverride,
  today: CalendarDate
): { warning?: string } {
  if (expiredEntities([entity], today).length === 0) return {};
  switch (expiryVerdict(policy, override)) {
    case "warn":
      return { warning: `Transferred expired tracked entity: ${entity.id}` };
    case "allow":
      return {};
    case "block":
      throw new Error(`Cannot transfer expired tracked entity: ${entity.id}`);
  }
}

export const postStockTransferInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inventory"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("unpickInventory"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("serial"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("batch"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    quantity: z.number().positive(),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("unpickSerial"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("unpickBatch"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string()
  })
]);

export const postStockTransferPermission = {} satisfies PermissionRule<
  z.output<typeof postStockTransferInput>
>;

/** Picks or un-picks stock-transfer lines (untracked, serial or batch), per `type`. */
export async function postStockTransfer(
  ctx: ServiceContext,
  raw: z.input<typeof postStockTransferInput>
) {
  const input = postStockTransferInput.parse(raw);

  const db = ctx.asSystem.pg;
  const validatedPayload = {
    ...input,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  };

  // The permission check proves the caller may act in companyId, not that the
  // body's ids belong to it. Every case writes stockTransferId as the
  // ledger/activity documentId and locationId onto this company's ledger
  // rows, so they are re-read under companyId — and the line must be on the
  // transfer the body names.
  {
    const { companyId, stockTransferId, stockTransferLineId, locationId } =
      validatedPayload;
    const line = await db
      .selectFrom("stockTransferLine")
      .select("id")
      .where("id", "=", stockTransferLineId)
      .where("stockTransferId", "=", stockTransferId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!line) throw new NotFoundError("Stock transfer line not found");
    await assertCompanyRecords(
      db,
      "location",
      [locationId],
      companyId,
      "Location"
    );
  }

  const companyToday = datetime.today(
    await getCompanyTimeZone(db, validatedPayload.companyId)
  );
  const today = companyToday.toString();
  let expiredWarning: string | undefined;
  let splitEntityId: string | undefined;

  postStockTransferLogger.info({
    function: "post-stock-transfer",
    ...validatedPayload
  });

  switch (validatedPayload.type) {
    case "inventory": {
      const {
        stockTransferId,
        stockTransferLineId,
        quantity,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Get stock transfer line details
        const stockTransferLine = await trx
          .selectFrom("stockTransferLine")
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        // Create item ledger entries for inventory transfer
        itemLedgerInserts.push({
          postingDate: today,
          itemId: stockTransferLine.itemId,
          quantity: round(-quantity),
          locationId: locationId,
          storageUnitId: stockTransferLine.fromStorageUnitId,
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stockTransferId,
          createdBy: userId,
          companyId
        });

        itemLedgerInserts.push({
          postingDate: today,
          itemId: stockTransferLine.itemId,
          quantity: round(quantity),
          locationId: locationId,
          storageUnitId: stockTransferLine.toStorageUnitId,
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stockTransferId,
          createdBy: userId,
          companyId
        });

        // Insert item ledger entries
        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();
        }

        // Update stock transfer line with picked quantity
        await trx
          .updateTable("stockTransferLine")
          .set({
            pickedQuantity: (stockTransferLine.pickedQuantity ?? 0) + quantity,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }

    case "unpickInventory": {
      const {
        stockTransferId,
        stockTransferLineId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Get stock transfer line details
        const stockTransferLine = await trx
          .selectFrom("stockTransferLine")
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        const currentPickedQuantity = stockTransferLine.pickedQuantity ?? 0;

        if (currentPickedQuantity > 0) {
          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          // Create reverse item ledger entries to undo the transfer
          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(currentPickedQuantity), // Positive to restore inventory at from shelf
            locationId: locationId,
            storageUnitId: stockTransferLine.fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            createdBy: userId,
            companyId
          });

          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(-currentPickedQuantity), // Negative to remove inventory from to shelf
            locationId: locationId,
            storageUnitId: stockTransferLine.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            createdBy: userId,
            companyId
          });

          // Insert reverse item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }
        }

        // Reset picked quantity to 0
        await trx
          .updateTable("stockTransferLine")
          .set({
            trackedEntityId: null,
            pickedQuantity: 0,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }

    case "serial": {
      const {
        stockTransferId,
        stockTransferLineId,
        trackedEntityId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Get stock transfer line details. Lock the row so concurrent scans
        // of the same line cannot both write a +1 over a stale read.
        const stockTransferLine = await trx
          .selectFrom("stockTransferLine")
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Refuse a scan that would exceed the line's serial count.
        const newPickedQuantity = resolvePick({
          lineQuantity: Number(stockTransferLine.quantity ?? 0),
          pickedQuantity: Number(stockTransferLine.pickedQuantity ?? 0),
          transferQuantity: 1
        });

        // Lock the serial itself BEFORE the repeat-scan query: the guard
        // below reads trackedActivityInput, and two concurrent scans of the
        // same serial would both read "not on this transfer" and both post a
        // Transfer activity + ledger pair. The batch case takes the same
        // lock; here it serializes the guard rather than an on-hand draw.
        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .select(["id", "readableId"])
          .forUpdate()
          .executeTakeFirstOrThrow();

        const fromStorageUnitId = stockTransferLine.fromStorageUnitId;
        await assertInSourceBin(trx, {
          trackedEntityId,
          readableId: trackedEntity.readableId,
          quantity: 1,
          locationId,
          storageUnitId: fromStorageUnitId,
          companyId
        });

        // Refuse a REPEAT scan of the same serial on this transfer. Each scan
        // posts a Transfer activity + a −1/+1 ledger pair, so a silent no-op
        // would let the ledger double; the guard is an explicit 400.
        const alreadyOnTransfer = await trx
          .selectFrom("trackedActivityInput as tai")
          .innerJoin("trackedActivity as ta", "ta.id", "tai.trackedActivityId")
          .where("tai.trackedEntityId", "=", trackedEntityId)
          .where("tai.companyId", "=", companyId)
          .where("ta.type", "=", "Transfer")
          .where("ta.sourceDocument", "=", "Stock Transfer")
          .where("ta.sourceDocumentId", "=", stockTransferId)
          .select("tai.trackedEntityId")
          .executeTakeFirst();
        if (alreadyOnTransfer) {
          throw new PickGuardError(
            "already-picked",
            `Serial ${trackedEntity.readableId ?? trackedEntityId} is already picked on this transfer`
          );
        }

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        // Create transfer activity
        const transferActivityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: transferActivityId,
            type: "Transfer",
            sourceDocument: "Stock Transfer",
            sourceDocumentId: stockTransferId,
            attributes: {
              "Stock Transfer": stockTransferId,
              "Stock Transfer Line": stockTransferLineId,
              "From Location": locationId,
              "To Location": locationId,
              "From Shelf": fromStorageUnitId,
              "To Shelf": stockTransferLine.toStorageUnitId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        // Record tracked entity as input to transfer
        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: transferActivityId,
            trackedEntityId: trackedEntityId,
            quantity: 1,
            companyId,
            createdBy: userId
          })
          .execute();

        // Create item ledger entries for transfer
        itemLedgerInserts.push({
          postingDate: today,
          itemId: stockTransferLine.itemId,
          quantity: -1,
          locationId: locationId,
          storageUnitId: fromStorageUnitId,
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stockTransferId,
          trackedEntityId: trackedEntityId,
          createdBy: userId,
          companyId
        });

        itemLedgerInserts.push({
          postingDate: today,
          itemId: stockTransferLine.itemId,
          quantity: 1,
          locationId: locationId,
          storageUnitId: stockTransferLine.toStorageUnitId,
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stockTransferId,
          trackedEntityId: trackedEntityId,
          createdBy: userId,
          companyId
        });

        // Insert item ledger entries
        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();
        }

        // Update stock transfer line with the accumulated picked quantity.
        await trx
          .updateTable("stockTransferLine")
          .set({
            trackedEntityId,
            pickedQuantity: newPickedQuantity,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }

    case "batch": {
      const {
        stockTransferId,
        stockTransferLineId,
        trackedEntityId,
        quantity,
        overrideExpired,
        overrideReason,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      const policy = await getExpiredEntityPolicy(db, companyId);

      await db.transaction().execute(async (trx) => {
        // Get stock transfer line details. Lock the row so two concurrent
        // scans of the same line accumulate instead of racing to overwrite
        // pickedQuantity (the ledger would double otherwise).
        const stockTransferLine = await trx
          .selectFrom("stockTransferLine")
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Get tracked entity details. Lock it too so the on-hand this pick
        // draws against cannot be spent by a concurrent transaction.
        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Refuse a pick that over-draws the line or the source lot before any
        // record is written; resolvePick returns the new running total.
        const newPickedQuantity = resolvePick({
          lineQuantity: Number(stockTransferLine.quantity ?? 0),
          pickedQuantity: Number(stockTransferLine.pickedQuantity ?? 0),
          transferQuantity: quantity
        });
        assertEntityCoversPick({
          entityQuantity: Number(trackedEntity.quantity),
          transferQuantity: quantity
        });
        const fromStorageUnitId = stockTransferLine.fromStorageUnitId;
        await assertInSourceBin(trx, {
          trackedEntityId,
          readableId: trackedEntity.readableId,
          quantity,
          locationId,
          storageUnitId: fromStorageUnitId,
          companyId
        });

        // Expiry policy gate (throws on hard reject; returns warning for 'Warn').
        const expiredCheck = checkExpiredEntity(
          {
            id: trackedEntity.id,
            expirationDate: trackedEntity.expirationDate
          },
          policy,
          { allowed: !!overrideExpired, reason: overrideReason ?? null },
          companyToday
        );
        if (expiredCheck.warning) {
          expiredWarning = expiredCheck.warning;
        }

        // Round BOTH operands once, here: everything downstream — the split
        // gate, the split records, the Transfer activity input and the two
        // ledger rows — derives from these, so a residue draw can never book
        // an unrounded quantity against a lot the gate treated as whole.
        const entityQuantity = round(Number(trackedEntity.quantity));
        const transferQuantity = round(quantity);
        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        // Split the batch when transferring less than the whole entity: the
        // source entity keeps its id and is decremented; a NEW child entity
        // departs to the destination bin with the transfer quantity.
        let transferredEntityId = trackedEntityId;
        if (!isFullDraw(entityQuantity, transferQuantity)) {
          const childId = nanoid();
          splitEntityId = childId;
          transferredEntityId = childId;

          const split = buildBatchSplitRecords({
            parent: {
              id: trackedEntity.id,
              readableId: trackedEntity.readableId,
              quantity: entityQuantity,
              sourceDocument: trackedEntity.sourceDocument,
              sourceDocumentId: trackedEntity.sourceDocumentId,
              sourceDocumentReadableId: trackedEntity.sourceDocumentReadableId,
              itemId: trackedEntity.itemId ?? null,
              expirationDate: trackedEntity.expirationDate ?? null,
              attributes: trackedEntity.attributes as Record<
                string,
                unknown
              > | null
            },
            drawQuantity: transferQuantity,
            childId,
            splitActivityId: nanoid(),
            activitySourceDocument: "Stock Transfer",
            activitySourceDocumentId: stockTransferId,
            bin: { storageUnitId: fromStorageUnitId, locationId },
            itemLedgerItemId: stockTransferLine.itemId,
            companyId,
            userId,
            postingDate: today,
            childStatus: "Available"
          });

          await trx
            .insertInto("trackedActivity")
            .values(
              split.activityInsert as Insertable<
                KyselyDatabase["trackedActivity"]
              >
            )
            .execute();

          await trx
            .insertInto("trackedEntity")
            .values(
              split.childEntityInsert as Insertable<
                KyselyDatabase["trackedEntity"]
              >
            )
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values(split.activityInputInsert)
            .execute();

          await trx
            .insertInto("trackedActivityOutput")
            .values(split.activityOutputInsert)
            .execute();

          await trx
            .updateTable("trackedEntity")
            .set(split.parentUpdate)
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          itemLedgerInserts.push(
            ...(split.ledgerInserts.map((ledgerRow) => ({
              ...ledgerRow,
              quantity: round(ledgerRow.quantity)
            })) as typeof itemLedgerInserts)
          );
        }

        // Create transfer activity
        const transferActivityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: transferActivityId,
            type: "Transfer",
            sourceDocument: "Stock Transfer",
            sourceDocumentId: stockTransferId,
            attributes: {
              "Stock Transfer": stockTransferId,
              "Stock Transfer Line": stockTransferLineId,
              "From Location": locationId,
              "To Location": locationId,
              "From Shelf": fromStorageUnitId,
              "To Shelf": stockTransferLine.toStorageUnitId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        // Record the DEPARTING entity (split child, or the whole entity on
        // a full-quantity transfer) as input to the transfer.
        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: transferActivityId,
            trackedEntityId: transferredEntityId,
            quantity: transferQuantity,
            companyId,
            createdBy: userId
          })
          .execute();

        // A transfer MOVES the batch between bins — it stays Available
        // (consumed at production). Matches the serial case and post-picking.

        // Create item ledger entries for transfer
        itemLedgerInserts.push(
          {
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(-transferQuantity),
            locationId: locationId,
            storageUnitId: fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: transferredEntityId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(transferQuantity),
            locationId: locationId,
            storageUnitId: stockTransferLine.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: transferredEntityId,
            createdBy: userId,
            companyId
          }
        );

        // Insert item ledger entries
        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();
        }

        // Update stock transfer line with the accumulated picked quantity.
        // trackedEntityId is keep-last: each partial pick mints a fresh child
        // entity, so the line points at the newest departing lot (matching
        // serial). Unpick reverses only the last activity on such a line.
        await trx
          .updateTable("stockTransferLine")
          .set({
            trackedEntityId: transferredEntityId,
            pickedQuantity: newPickedQuantity,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }

    case "unpickSerial": {
      const {
        stockTransferId,
        stockTransferLineId,
        trackedEntityId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line AND the entity: an unpick read-modify-writes the
        // entity's quantity/status and the line's pickedQuantity, so two
        // concurrent unpicks of the same child would both credit the parent
        // and both decrement the line off the same stale read. Same locks the
        // pick paths take.
        const stockTransferLine = await trx
          .selectFrom("stockTransferLine")
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Find the transfer activity for this tracked entity
        const transferActivity = await trx
          .selectFrom("trackedActivity")
          .innerJoin(
            "trackedActivityInput",
            "trackedActivity.id",
            "trackedActivityInput.trackedActivityId"
          )
          .where("trackedActivity.type", "=", "Transfer")
          .where("trackedActivity.sourceDocument", "=", "Stock Transfer")
          .where("trackedActivity.sourceDocumentId", "=", stockTransferId)
          .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
          .where("trackedActivity.companyId", "=", companyId)
          .selectAll("trackedActivity")
          .executeTakeFirstOrThrow();

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        // Create reverse item ledger entries to undo the transfer
        // First, remove the entity from the destination shelf (toStorageUnitId)
        itemLedgerInserts.push({
          postingDate: today,
          itemId: stockTransferLine.itemId,
          quantity: -1, // Negative to remove inventory from to shelf
          locationId: locationId,
          storageUnitId: stockTransferLine.toStorageUnitId,
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stockTransferId,
          trackedEntityId: trackedEntityId,
          createdBy: userId,
          companyId
        });

        // Then, restore the entity to the source shelf (fromStorageUnitId)
        itemLedgerInserts.push({
          postingDate: today,
          itemId: stockTransferLine.itemId,
          quantity: 1, // Positive to restore inventory at from shelf
          locationId: locationId,
          storageUnitId: stockTransferLine.fromStorageUnitId,
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stockTransferId,
          trackedEntityId: trackedEntityId,
          createdBy: userId,
          companyId
        });

        // Insert reverse item ledger entries
        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();
        }

        // Delete the tracked activity and its related records
        await trx
          .deleteFrom("trackedActivityInput")
          .where("trackedActivityId", "=", transferActivity.id!)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .deleteFrom("trackedActivity")
          .where("id", "=", transferActivity.id!)
          .where("companyId", "=", companyId)
          .execute();

        // Update tracked entity status back to available and restore shelf location
        await trx
          .updateTable("trackedEntity")
          .set({
            status: "Available",
            attributes: {
              ...(trackedEntity.attributes as Record<string, unknown>),
              Shelf: stockTransferLine.fromStorageUnitId
            }
          })
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();

        // Update stock transfer line with reduced picked quantity
        await trx
          .updateTable("stockTransferLine")
          .set({
            trackedEntityId: null,
            pickedQuantity: Math.max(
              0,
              (stockTransferLine.pickedQuantity ?? 0) - 1
            ),
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }

    case "unpickBatch": {
      const {
        stockTransferId,
        stockTransferLineId,
        trackedEntityId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line AND the entity: an unpick read-modify-writes the
        // entity's quantity/status and the line's pickedQuantity, so two
        // concurrent unpicks of the same child would both credit the parent
        // and both decrement the line off the same stale read. Same locks the
        // pick paths take.
        const stockTransferLine = await trx
          .selectFrom("stockTransferLine")
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Find the transfer activity for this tracked entity
        const transferActivity = await trx
          .selectFrom("trackedActivity")
          .innerJoin(
            "trackedActivityInput",
            "trackedActivity.id",
            "trackedActivityInput.trackedActivityId"
          )
          .where("trackedActivity.type", "=", "Transfer")
          .where("trackedActivity.sourceDocument", "=", "Stock Transfer")
          .where("trackedActivity.sourceDocumentId", "=", stockTransferId)
          .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
          .where("trackedActivity.companyId", "=", companyId)
          .selectAll("trackedActivity")
          .executeTakeFirstOrThrow();

        // The whole child returns to its parent, so round once here and let
        // the parent increase, the ledger pair and the pickedQuantity
        // decrement all derive from the same value.
        const transferQuantity = round(Number(trackedEntity.quantity));

        // Re-checked UNDER the lock: a lot holding nothing has either already
        // been unpicked or been consumed at production. Either way there is
        // nothing to return, and proceeding would delete the transfer
        // activity and reset pickedQuantity for a no-op.
        if (transferQuantity <= 0) {
          throw new PickGuardError(
            "already-picked",
            `Lot ${trackedEntity.readableId ?? trackedEntityId} has no quantity left to unpick`
          );
        }
        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        const entityAttributes = (trackedEntity.attributes ?? {}) as Record<
          string,
          unknown
        >;
        // New convention: the line's entity is a split CHILD carrying a
        // back-pointer to the parent that stayed at the source bin.
        const splitFromParentId = entityAttributes["Split From Entity ID"] as
          | string
          | undefined;
        // Legacy convention (pre-flip rows): the departed ORIGINAL carries a
        // forward pointer to the remainder entity it left behind.
        const legacyRemainderId = entityAttributes["Split Entity ID"] as
          | string
          | undefined;

        if (splitFromParentId) {
          // Merge the child fully back into its parent and delete the Split
          // — a clean undo, as if the partial transfer never happened.
          // Locked too — its quantity is incremented from this read.
          const parent = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", splitFromParentId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          await trx
            .updateTable("trackedEntity")
            .set({
              quantity: round(round(Number(parent.quantity)) + transferQuantity)
            })
            .where("id", "=", parent.id)
            .where("companyId", "=", companyId)
            .execute();

          // Drain the child (don't delete it — ledger history keeps the FK).
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Consumed",
              quantity: 0
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          itemLedgerInserts.push(
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(-transferQuantity), // drain the child at the destination
              locationId: locationId,
              storageUnitId: stockTransferLine.toStorageUnitId,
              entryType: "Negative Adjmt.",
              documentType: "Direct Transfer",
              documentId: stockTransferId!,
              trackedEntityId: trackedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(transferQuantity), // restore the parent at the source
              locationId: locationId,
              storageUnitId: stockTransferLine.fromStorageUnitId,
              entryType: "Positive Adjmt.",
              documentType: "Direct Transfer",
              documentId: stockTransferId!,
              trackedEntityId: parent.id,
              createdBy: userId,
              companyId
            }
          );

          // Delete the Split activity that minted the child — scoped to the
          // entity AND this transfer (a bare sourceDocumentId lookup grabs
          // a sibling line's split on multi-line transfers).
          const splitActivity = await trx
            .selectFrom("trackedActivity")
            .where("type", "=", "Split")
            .where("sourceDocument", "=", "Stock Transfer")
            .where("sourceDocumentId", "=", stockTransferId)
            .where(attributesContain({ "Split Entity ID": trackedEntityId }))
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirst();

          if (splitActivity) {
            await trx
              .deleteFrom("trackedActivityOutput")
              .where("trackedActivityId", "=", splitActivity.id!)
              .where("companyId", "=", companyId)
              .execute();

            await trx
              .deleteFrom("trackedActivityInput")
              .where("trackedActivityId", "=", splitActivity.id!)
              .where("companyId", "=", companyId)
              .execute();

            await trx
              .deleteFrom("trackedActivity")
              .where("id", "=", splitActivity.id!)
              .where("companyId", "=", companyId)
              .execute();
          }
        } else if (legacyRemainderId) {
          // This entity was created from a split, need to merge it back
          const originalEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", legacyRemainderId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const originalQuantity = round(
            round(Number(originalEntity.quantity)) + transferQuantity
          );

          // Find the split activity — scoped to the remainder entity this
          // pointer names, not just the transfer (multi-line safety).
          const splitActivity = await trx
            .selectFrom("trackedActivity")
            .where("type", "=", "Split")
            .where("sourceDocument", "=", "Stock Transfer")
            .where("sourceDocumentId", "=", stockTransferId)
            .where(attributesContain({ "Split Entity ID": legacyRemainderId }))
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          // Update original entity with merged quantity and restore shelf location
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Consumed",
              quantity: 0
            })
            .where("id", "=", legacyRemainderId)
            .where("companyId", "=", companyId)
            .execute();

          // Mark the split entity as consumed (don't delete it)
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Available",
              quantity: originalQuantity
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          // Create item ledger entries for merge
          // Both entities are on the fromStorageUnitId during the merge operation
          itemLedgerInserts.push(
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(originalQuantity), // zero out the split entity
              locationId: locationId,
              storageUnitId: stockTransferLine.fromStorageUnitId,
              entryType: "Positive Adjmt.",
              documentType: "Direct Transfer",
              documentId: stockTransferId!,
              trackedEntityId: trackedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(-transferQuantity), // Positive to restore to original entity
              locationId: locationId,
              storageUnitId: stockTransferLine.toStorageUnitId, // Both entities are on the source shelf
              entryType: "Negative Adjmt.",
              documentType: "Direct Transfer",
              documentId: stockTransferId!,
              trackedEntityId: trackedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(-(originalQuantity - transferQuantity)), // Positive to restore to original entity
              locationId: locationId,
              storageUnitId: stockTransferLine.fromStorageUnitId, // Both entities are on the source shelf
              entryType: "Negative Adjmt.",
              documentType: "Direct Transfer",
              documentId: stockTransferId!,
              trackedEntityId: legacyRemainderId,
              createdBy: userId,
              companyId
            }
          );

          // Delete split activity records
          await trx
            .deleteFrom("trackedActivityOutput")
            .where("trackedActivityId", "=", splitActivity.id!)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("trackedActivityInput")
            .where("trackedActivityId", "=", splitActivity.id!)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("trackedActivity")
            .where("id", "=", splitActivity.id!)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          // This was a direct transfer, just restore the entity and shelf location
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Available",
              attributes: {
                ...(trackedEntity.attributes as Record<string, unknown>),
                Shelf: stockTransferLine.fromStorageUnitId
              }
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          // Create reverse item ledger entries to undo the transfer
          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(transferQuantity), // Positive to restore inventory at from shelf
            locationId: locationId,
            storageUnitId: stockTransferLine.fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: trackedEntityId,
            createdBy: userId,
            companyId
          });

          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(-transferQuantity), // Negative to remove inventory from to shelf
            locationId: locationId,
            storageUnitId: stockTransferLine.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: trackedEntityId,
            createdBy: userId,
            companyId
          });
        }

        // Insert item ledger entries
        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();
        }

        // Delete the transfer activity and its related records
        await trx
          .deleteFrom("trackedActivityInput")
          .where("trackedActivityId", "=", transferActivity.id!)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .deleteFrom("trackedActivity")
          .where("id", "=", transferActivity.id!)
          .where("companyId", "=", companyId)
          .execute();

        // Update stock transfer line with reduced picked quantity
        await trx
          .updateTable("stockTransferLine")
          .set({
            trackedEntityId: null,
            pickedQuantity: Math.max(
              0,
              round(
                round(stockTransferLine.pickedQuantity ?? 0) - transferQuantity
              )
            ),
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", stockTransferLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }
  }

  return {
    success: true,
    warning: expiredWarning,
    splitEntityId
  };
}
