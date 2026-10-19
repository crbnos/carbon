// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  InvalidInputError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  type IssueResult,
  issueInput,
  postInventoryAdjustmentInput,
  postPickingInput
} from "@carbon/api/postings";
import {
  type CarbonError,
  ERROR_STATUS,
  type ErrorCategory,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllFromTable,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  assertPostingStatusUnchanged,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { toJson } from "@carbon/database/json";
import {
  allocateAcrossBudgets,
  getOperationLinesideBin,
  getPickedBudgets,
  type LinesideClaim,
  linesideCredit,
  orderOldFirst,
  recordSharedTakes,
  type SharedTakes,
  splitTakeByBin
} from "@carbon/database/picked-consumption";
import {
  idsWithLiveStockHistory,
  releaseReceiptSerialEntities,
  voidedReceiptIds
} from "@carbon/database/receipt-serials";
import {
  contains,
  deleteRows,
  inOrder,
  insertRows,
  lt,
  many,
  maybeSingle,
  neq,
  notNull,
  rpcRows,
  single,
  type Tables,
  updateRows
} from "@carbon/database/rows";
import {
  resolveFeatureSamplingPlan,
  resolveSamplingPlan,
  type SamplingStandard
} from "@carbon/database/sampling";
import * as sequence from "@carbon/database/sequence";
import {
  expandSerialTrackedLines,
  kanbanReplenishmentNote,
  levelReplenishmentQuantity,
  type StockTransferLineDraft
} from "@carbon/database/stock-transfer";
import { consumableInWholeAssemblies } from "@carbon/database/supersession-pick";
import { evaluateLinesForSurface } from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  assertEntityCoversPick,
  async,
  buildBatchMergeRecords,
  buildBatchSplitRecords,
  buildMergeRecords,
  credit,
  datetime,
  debit,
  EPSILON,
  equals,
  getErrorMessage,
  indexByMapped,
  isFullDraw,
  PickGuardError,
  pluckUnique,
  resolvePick,
  resolveReturnUnitCost,
  resolveTrackedEntityBin,
  round,
  searchFilter,
  settleQuantity,
  splitPickAcrossMembers,
  statusAfterQuantityChange,
  type Violation
} from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Insertable, Transaction } from "kysely";
import { type Selectable, sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { upsertDocument } from "~/modules/documents/documents.service";
import {
  futureDeliveryError,
  futureReturnError,
  insertUnitActivity,
  lockAgreement,
  type RentalUnitReturn,
  receiptReturnError,
  rentalShipmentVoidBlocker,
  returnRentalUnit,
  unitLabel,
  unitReturnValidator
} from "~/modules/sales/sales.service";
import * as settingsService from "~/modules/settings/settings.service";
import {
  assertCompanyRecords,
  assertPostable,
  attributesContain,
  bookAdjustment,
  buildCostLedgerRow,
  buildJournalLineDimensions,
  buildOffsetLines,
  calculateCOGS,
  createAdjustmentJournal,
  documentJournalLines,
  type ExpiredEntityPolicy,
  type ExpiryOverride,
  expiredEntities,
  expiryVerdict,
  FixedAssetWrites,
  getAccountingPeriodForDate,
  getCurrentAccountingPeriod,
  getDefaultPostingGroup,
  getExpiredEntityPolicy,
  getOffsetAccount,
  getStorageUnitWithHighestQuantity,
  getTrackedEntityBins,
  getTrackedEntityOnHandInBin,
  INVENTORY_VOID_BEFORE_CUTOVER_ERROR,
  invokePosting,
  type JournalLineDimensionValues,
  journalLineDimensionRows,
  leavingTrackedEntityIds,
  refuseVoidBeforeCutover,
  resolveAccountingPeriod,
  resolveInventoryAccount,
  STOCK_CORRECTION_BEFORE_CUTOVER_ERROR,
  serialUnitCost,
  type UnitCostChild,
  updatePickMethodDefaultStorageUnitIfNeeded,
  valueMovement
} from "~/modules/shared/shared.service";
import type { StorageItem } from "~/types";
import type { Filter, GenericQueryFilters } from "~/utils/query";
import {
  LIST_COUNT,
  setGenericQueryFilters,
  setSearchFilter
} from "~/utils/query";
import { stripSpecialCharacters } from "~/utils/string";
import { ruleError, sanitize } from "~/utils/supabase";
import { getItemStorageUnitQuantities } from "../items/items.utils";
import { rescheduleJob } from "../production/production.service";
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
  stockTransferLineValidator,
  stockTransferValidator,
  storageTypeValidator,
  storageUnitValidator,
  warehouseTransferValidator
} from "./inventory.models";
import {
  isPickingListLocked,
  isStockTransferLocked,
  isWarehouseTransferLocked,
  planSerialBoxWrite,
  type receiptFixedAssetLineUpdateValidator,
  reconcileReceiptLineSerials,
  shippingCarrierType
} from "./inventory.models";
import { clampDepth } from "./inventory.utils";
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
  IssueContainment,
  IssueContainmentStatus,
  StepRecord,
  TrackedEntity
} from "./types";

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

/** Not published: `removeStorageUnit` deletes a unit, or with `cascade` its subtree. */
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
 * Not published: `removeStorageUnit` with `cascade` does this.
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

/** Not published: it skips the lock check `removeWarehouseTransferLine` makes. */
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
      error: ruleError("Nothing to reconcile — variance is zero")
    };
  }

  const nextSequence = await settingsService.getNextSequence(
    client,
    "journalEntry",
    companyId
  );
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
      searchFilter(["name", "readableIdWithRevision"], args.search)
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
      searchFilter(["receiptId", "sourceDocumentReadableId"], args.search)
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

function selectReceiptSerialBox(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; receiptLineId: string; index: number }
) {
  return db
    .selectFrom("trackedEntity")
    .select("id")
    .where("companyId", "=", args.companyId)
    .where(sql<string>`attributes->>'Receipt Line'`, "=", args.receiptLineId)
    .where(
      sql<string>`attributes->>'Receipt Line Index'`,
      "=",
      String(args.index)
    )
    .execute();
}

/** One serial save of a line at a time: two saves into an empty box would each insert a record. */
async function lockReceiptLine(
  trx: Kysely<KyselyDatabase>,
  companyId: string,
  receiptLineId: string
) {
  await trx
    .selectFrom("receiptLine")
    .select("id")
    .where("id", "=", receiptLineId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .execute();
}

export type ReceiptSerialBoxResult =
  | { ok: true }
  | { ok: false; reason: "notFound" | "locked" | "box" | "unit" };

/**
 * Saves one serial box of a receipt line (`planSerialBoxWrite`) in one
 * transaction: an empty serial clears it, a refused one empties it.
 */
export async function saveReceiptSerialBox(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    receiptId: string;
    receiptLineId: string;
    itemId: string;
    index: number;
    serialNumber: string;
    expiryDate?: string | null;
  }
): Promise<ReceiptSerialBoxResult> {
  const { companyId, receiptId, receiptLineId, itemId, index, serialNumber } =
    args;
  return db.transaction().execute(async (trx) => {
    await lockReceiptLine(trx, companyId, receiptLineId);
    const receipt = await trx
      .selectFrom("receipt")
      .select("status")
      .where("id", "=", receiptId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!receipt) return { ok: false, reason: "notFound" };
    if (receipt.status !== "Draft") return { ok: false, reason: "locked" };

    const box = await selectReceiptSerialBox(trx, {
      companyId,
      receiptLineId,
      index
    });

    const withSerial = serialNumber
      ? await trx
          .selectFrom("trackedEntity")
          .select(["id", "attributes"])
          .where("sourceDocumentId", "=", itemId)
          .where("readableId", "=", serialNumber)
          .where("companyId", "=", companyId)
          .execute()
      : [];

    // A serial from a voided receipt was never received: its movements are
    // the receipt and its void, and the box it names is gone. The new box
    // takes the same entity, so one unit keeps one history.
    const history = await idsWithLiveStockHistory(trx, companyId, [
      ...box.map((entity) => entity.id),
      ...withSerial.map((entity) => entity.id)
    ]);
    const voided = await voidedReceiptIds(
      trx,
      companyId,
      withSerial.flatMap((entity) => {
        const receiptOfEntity = (entity.attributes as Record<string, unknown>)
          ?.Receipt;
        return typeof receiptOfEntity === "string" ? [receiptOfEntity] : [];
      })
    );

    const candidates = withSerial.map((entity) => {
      const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
      return {
        id: entity.id,
        hasHistory: history.has(entity.id),
        attributes,
        onVoidedReceipt:
          typeof attributes.Receipt === "string" &&
          voided.has(attributes.Receipt)
      };
    });
    const plan = planSerialBoxWrite({
      receiptLineId,
      index,
      serialNumber,
      box: box.map((entity) => ({
        id: entity.id,
        hasHistory: history.has(entity.id)
      })),
      withSerial: candidates
    });

    if (plan.kind === "write") {
      await sql`SELECT update_receipt_line_serial_tracking(
        p_receipt_line_id => ${receiptLineId},
        p_receipt_id => ${receiptId},
        p_serial_number => ${serialNumber},
        p_index => ${index}::int,
        p_tracked_entity_id => ${plan.targetId ?? null}::text,
        p_expiry_date => ${args.expiryDate || null}::text
      )`.execute(trx);

      // The void drained the record to 0 / Consumed, and the function's
      // update keeps both: start it again as a new draft serial starts.
      const reusedFromVoid = candidates.some(
        (entity) => entity.id === plan.targetId && entity.onVoidedReceipt
      );
      if (reusedFromVoid && plan.targetId) {
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: 1, status: "On Hold" })
          .where("id", "=", plan.targetId)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    await releaseReceiptSerialEntities(trx, companyId, plan.releaseIds);

    return plan.kind === "taken"
      ? { ok: false, reason: plan.reason }
      : { ok: true };
  });
}

/** Empties one serial box of a receipt line. */
export async function clearReceiptSerialBox(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; receiptLineId: string; index: number }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await lockReceiptLine(trx, args.companyId, args.receiptLineId);
    const box = await selectReceiptSerialBox(trx, args);
    await releaseReceiptSerialEntities(
      trx,
      args.companyId,
      box.map((entity) => entity.id)
    );
  });
}

export async function reconcileReceiptSerialEntities(
  db: Kysely<KyselyDatabase>,
  args: ReconcileReceiptSerialsArgs
): Promise<{ linesMissingSerials: string[] }> {
  return db
    .transaction()
    .execute((trx) => reconcileReceiptSerialsInTransaction(trx, args));
}

type ReconcileReceiptSerialsArgs = {
  receiptId: string;
  companyId: string;
  isSalesReturn: boolean;
  lines: {
    id: string;
    receivedQuantity: number | null;
    requiresSerialTracking?: boolean | null;
  }[];
};

export async function reconcileReceiptSerialsInTransaction(
  trx: Kysely<KyselyDatabase>,
  args: ReconcileReceiptSerialsArgs
): Promise<{ linesMissingSerials: string[] }> {
  const serialLines = args.lines.filter((line) => line.requiresSerialTracking);
  if (serialLines.length === 0) return { linesMissingSerials: [] };

  const entities = await trx
    .selectFrom("trackedEntity")
    .select([
      "id",
      "readableId",
      sql<string | null>`attributes->>'Receipt Line'`.as("receiptLineId"),
      sql<number | null>`(attributes->>'Receipt Line Index')::int`.as("index"),
      sql<string>`"createdAt"::text`.as("createdAt")
    ])
    .where("companyId", "=", args.companyId)
    .where(sql<string>`attributes->>'Receipt'`, "=", args.receiptId)
    .execute();

  const linesMissingSerials: string[] = [];
  const surplusIds = serialLines.flatMap((line) => {
    const { missingIndexes, surplusEntityIds } = reconcileReceiptLineSerials(
      entities
        .filter((e) => e.receiptLineId === line.id)
        .map((e) => ({
          id: e.id,
          index: e.index ?? undefined,
          hasSerial: args.isSalesReturn || !!e.readableId,
          createdAt: e.createdAt
        })),
      Number(line.receivedQuantity ?? 0)
    );
    if (missingIndexes.length > 0) linesMissingSerials.push(line.id);
    return surplusEntityIds;
  });

  await releaseReceiptSerialEntities(trx, args.companyId, surplusIds);
  return { linesMissingSerials };
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
    query = query.or(
      searchFilter(
        [
          "itemReadableId",
          "itemDescription",
          "locationName",
          "storageUnitName",
          "trackedEntityReadableId"
        ],
        args.search
      )
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
      searchFilter(["shipmentId", "sourceDocumentReadableId"], args.search)
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
    // `carrier` is an enum, which ILIKE cannot search, so the term is matched
    // against the carrier names here.
    const term = args.search.toLowerCase();
    const carriers = shippingCarrierType.filter((carrier) =>
      carrier.toLowerCase().includes(term)
    );
    query = query.or(
      [
        searchFilter(["name"], args.search),
        ...(carriers.length > 0 ? [`carrier.in.(${carriers.join(",")})`] : [])
      ].join(",")
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
// quantity, earliest expiry) with genealogy back to every parent. The `issue`
// posting (`issueMaterial`) owns the writes; see `buildBatchMergeRecords`
// (@carbon/utils).
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
  return invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "issue",
    {
      type: "mergeTrackedEntities",
      ...args
    },
    issueMaterial,
    { as: issueMaterialPermission }
  );
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
      searchFilter(
        ["id", "sourceDocumentReadableId", "readableId"],
        args.search
      )
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
      error: ruleError(
        "Cannot edit expiry of a consumed tracked entity"
      ) as unknown as PostgrestError
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
    query = query.or(searchFilter(["transferId", "reference"], args.search));
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
 * Not published: it runs no storage rules; `adjustInventory` runs them
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

  const result = await invokePosting(
    { client, db, companyId, userId: createdBy },
    "post-inventory-adjustment",
    {
      ...adjustment
    },
    postInventoryAdjustment,
    { as: postInventoryAdjustmentPermission }
  );

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
    // Search the item's identity (part number / name); the line's own readableId
    // is only the batch/serial and is null for most rows.
    query = query.or(
      searchFilter(["itemName", "itemReadableIdWithRevision"], args.search)
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
/** Not published: a count with no lines; `createInventoryCount` creates and snapshots it. */
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
 * `setStockTransferStatus` also runs storage rules and the reopen
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
 * `createReceipt` and `updateReceipt` do.
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
 * `createShipment` and `updateShipment` do.
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
 * `setWarehouseTransferStatus` also runs storage rules.
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
 * Not published: it skips the lock check `createWarehouseTransferLine` and
 * `updateWarehouseTransferLine` make.
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

/** Deletes a storage type and takes it off every storage unit that has it, in one transaction. */
export async function deleteStorageTypeWithCascade(
  db: Kysely<KyselyDatabase>,
  id: string,
  companyId: string
) {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("storageUnit")
      .set({
        storageTypeIds: sql<string[]>`array_remove("storageTypeIds", ${id})`
      })
      .where("companyId", "=", companyId)
      .where(sql<boolean>`"storageTypeIds" @> ARRAY[${id}]::text[]`)
      .execute();
    return trx
      .deleteFrom("storageType")
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
  });
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
 * `pickPickingListLineEntity`, which checks the line is on the
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

  const result = await invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "post-picking",
    body as z.input<typeof postPickingInput>,
    postPicking,
    { as: postPickingPermission }
  );
  if (result.error) {
    return {
      data: null,
      error: result.error
    };
  }

  return { data: { id: args.pickingListLineId }, error: null };
}

/** Writes without the Draft lock: `updatePickingList` checks it; lists are created by `generatePickingList`. */
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

/** A bare status write: `setPickingListStatus` applies the completion policy and the reopen permission. */
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
  const sequenceResult = await settingsService.getNextSequence(
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
 * Published as `pickPickingListLineChecked`, which checks the line is on
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

    const result = await invokePosting(
      { client, db, companyId: body.companyId, userId: body.userId },
      "post-picking",
      body as z.input<typeof postPickingInput>,
      postPicking,
      { as: postPickingPermission }
    );

    if (result.error) {
      return {
        data: null,
        error: result.error
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

/** Not published: it runs no storage rules; `createStockTransfer` does. */
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
    const next = await settingsService.getNextSequence(
      client,
      "stockTransfer",
      companyId
    );
    if (next.error || !next.data) {
      return {
        data: null,
        error: next.error ?? { message: "Failed to get sequence" }
      };
    }
    stockTransferId = next.data;
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
    transferDate,
    expectedReceiptDate,
    notes,
    reference,
    customFields
  } = input;

  let transferId = input.transferId;
  if (!transferId) {
    const next = await settingsService.getNextSequence(
      client,
      "warehouseTransfer",
      companyId
    );
    if (next.error || !next.data) {
      return {
        data: null,
        error: next.error ?? { message: "Failed to get sequence" }
      };
    }
    transferId = next.data;
  }

  const createTransfer = await client
    .from("warehouseTransfer")
    .insert({
      transferId,
      fromLocationId,
      toLocationId,
      // The status moves only through setWarehouseTransferStatus, which runs
      // the storage rules.
      status: "Draft",
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

/** The header fields of a Draft transfer: never its status, which only `setWarehouseTransferStatus` moves. */
export async function updateWarehouseTransfer(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    fromLocationId?: string;
    toLocationId?: string;
    transferId?: string;
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
  // A status sent anyway (the type has none) never reaches the row.
  const { status: _status, ...header } = fields as typeof fields & {
    status?: unknown;
  };
  return client
    .from("warehouseTransfer")
    .update(
      sanitize({
        ...header,
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

/**
 * A serial number is one unit: an adjustment of a serial item moves, sets or
 * scraps at most one. Read from the item, not from what the caller says it is.
 */
export async function serialQuantityRefusal(
  ctx: ServiceContext,
  itemId: string,
  quantity: number
) {
  const item = await ctx.asCaller.supabase
    .from("item")
    .select("itemTrackingType")
    .eq("id", itemId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (item.error)
    return ctx.error("internal", "Failed to load item", item.error);
  if (!item.data) return ctx.error("notFound", "Item not found");
  if (item.data.itemTrackingType === "Serial" && Math.abs(quantity) > 1) {
    return ctx.error(
      "validation",
      "Serial items can only have a quantity of 1"
    );
  }
  return null;
}

export const STOCK_TRANSFER_LOCKED =
  "Cannot modify a locked stock transfer. Reopen it first.";

/** A Draft stock transfer of this company: any other is locked. */
export async function unlockedStockTransfer(
  ctx: ServiceContext,
  stockTransferId: string
) {
  const transfer = await ctx.asCaller.supabase
    .from("stockTransfer")
    .select("id, status")
    .eq("id", stockTransferId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (transfer.error) {
    return ctx.error(
      "internal",
      "Failed to load stock transfer",
      transfer.error
    );
  }
  if (!transfer.data) {
    return ctx.error("notFound", "The stock transfer could not be found");
  }
  if (isStockTransferLocked(transfer.data.status)) {
    return ctx.error("rule", STOCK_TRANSFER_LOCKED);
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

/**
 * A pick's failure. A refusal written for the person picking (the building
 * blocks' own strings, and `post-picking`'s 4xx guards such as an over-pick)
 * keeps its message; anything else — a database error, a 5xx — is a failure
 * whose message is not theirs to read, logged as the cause.
 */
export function pickRefusal(ctx: ServiceContext, error: unknown) {
  if (typeof error === "string") return ctx.error("rule", error);
  if (error instanceof ServerFnError && error.status < 500) {
    return ctx.error(
      CATEGORY_BY_STATUS[error.status] ?? "rule",
      error.message,
      error
    );
  }
  return ctx.error("internal", "Failed to pick line", error);
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

  logger.info({
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
// Corrects a posted stock movement by inserting ONE opposite (delta) movement
// linked to the original via itemLedger.correctionOfItemLedgerId. The caller
// supplies the SIGNED quantity the movement should have been; the delta is
// derived against the movement's current effective quantity (original + all
// prior corrections in its group), so repeated corrections converge.
//
// The correction carries the ORIGINAL movement's postingDate and posts its GL
// journal into the accounting period containing that date (fails when that
// period is Locked/Closed). entryNumber is a SERIAL and cannot be
// retro-inserted — "next to the original" is delivered by the postingDate and
// by the stock-movements UI, which nests corrections under their original.
export const correctStockMovementInput = z.object({
  itemLedgerId: z.string(),
  // SIGNED corrected quantity, matching the ledger's sign convention
  // (a shipment of -5 that should have been -3 → correctedQuantity: -3).
  correctedQuantity: z.number(),
  comment: z.string().optional().nullable()
});

const MAX_CORRECTION_CHAIN_DEPTH = 100;

export const postStockMovementCorrectionPermission = {
  update: "inventory"
} satisfies PermissionRule<z.output<typeof correctStockMovementInput>>;

export async function postStockMovementCorrection(
  ctx: ServiceContext,
  raw: z.input<typeof correctStockMovementInput>
) {
  const { itemLedgerId, correctedQuantity, comment } =
    correctStockMovementInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const ledgerColumns = [
    "id",
    "itemId",
    "locationId",
    "storageUnitId",
    "trackedEntityId",
    "quantity",
    "postingDate",
    "entryType",
    "documentType",
    "documentId",
    "correctionOfItemLedgerId"
  ] as const;

  const originalResult = await maybeSingle(
    db,
    "itemLedger",
    { id: itemLedgerId, companyId },
    { columns: ledgerColumns }
  );
  if (originalResult.error) throw new Error("Failed to fetch stock movement");
  if (!originalResult.data) {
    throw new NotFoundError("Stock movement not found");
  }

  // Walk up to the topmost ancestor: corrections always link to the ROOT so
  // the group stays flat and its effective quantity is a simple sum.
  let root = originalResult.data;
  for (
    let depth = 0;
    root.correctionOfItemLedgerId && depth < MAX_CORRECTION_CHAIN_DEPTH;
    depth++
  ) {
    const parent = await maybeSingle(
      db,
      "itemLedger",
      { id: root.correctionOfItemLedgerId, companyId },
      { columns: ledgerColumns }
    );
    if (parent.error) throw new Error("Failed to fetch stock movement");
    // Broken link (no FK on correctionOfItemLedgerId): treat the current row
    // as the root rather than failing the correction.
    if (!parent.data) break;
    root = parent.data;
  }

  // Collect the whole correction group (historical count corrections chained
  // fix→fix, so descendants can be more than one level deep).
  let effectiveQuantity = Number(root.quantity);
  let frontier = [root.id];
  const seen = new Set<string>([root.id]);
  while (frontier.length > 0) {
    const children = await many(
      db,
      "itemLedger",
      { correctionOfItemLedgerId: frontier, companyId },
      { columns: ["id", "quantity"] }
    );
    if (children.error) throw new Error("Failed to fetch corrections");
    frontier = [];
    for (const child of children.data ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      effectiveQuantity += Number(child.quantity);
      frontier.push(child.id);
    }
  }

  // Round the delta ONCE, here: it is persisted twice — into the entity via
  // eb("quantity", "+", delta) and into the correction's own itemLedger row —
  // and both must carry the same value at internal scale. A raw `=== 0` no-op
  // gate also lets float residue (correcting a -5 line back to exactly its
  // effective -4.99999999999999 sum) through as a 1e-14 correction row.
  const delta = round(correctedQuantity - effectiveQuantity);
  if (equals(delta, 0)) {
    throw new InvalidInputError(
      "Corrected quantity matches the current effective quantity — nothing to correct"
    );
  }

  // A correction row shows only its delta (+4), which doesn't tell the reader
  // the from→to intent — so when the user gives no reason, self-document it.
  const resolvedComment =
    comment?.trim() ||
    `Corrected from ${effectiveQuantity} to ${correctedQuantity}`;

  const [itemResult, itemCostResult, trackingQuantities] = await inOrder([
    () =>
      single(
        db,
        "item",
        { id: root.itemId, companyId },
        { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
      ),
    () =>
      single(
        db,
        "itemCost",
        { itemId: root.itemId, companyId },
        {
          columns: [
            "costingMethod",
            "unitCost",
            "standardCost",
            "itemPostingGroupId"
          ]
        }
      ),
    () =>
      root.locationId
        ? rpcRows(db, "get_item_quantities_by_tracking_id", {
            item_id: root.itemId,
            company_id: companyId,
            location_id: root.locationId
          })
        : Promise.resolve({ data: null, error: null })
  ]);

  if (itemResult.error) throw new Error("Failed to fetch item");
  if (itemCostResult.error) throw new Error("Failed to fetch item cost");
  // Fail closed: a failed quantity read must abort, not read as "no stock".
  if (trackingQuantities.error) {
    throw new Error("Failed to fetch current quantities");
  }

  const item = {
    itemTrackingType: itemResult.data.itemTrackingType,
    replenishmentSystem: itemResult.data.replenishmentSystem,
    itemPostingGroupId: itemCostResult.data.itemPostingGroupId
  };

  const isSerial = item.itemTrackingType === "Serial";
  if (isSerial) {
    if (!Number.isInteger(delta)) {
      throw new InvalidInputError(
        "Corrections on serial-tracked items must be whole numbers"
      );
    }
    // A serial number is a single unique unit — the corrected movement can
    // never carry more than one of it (matches inventoryAdjustmentValidator).
    if (Math.abs(correctedQuantity) > 1) {
      throw new InvalidInputError("Serial items can only have a quantity of 1");
    }
  }

  // A negative delta removes stock now — it must not drive the stock target
  // (tracked entity, or untracked stock in the original's bin) below zero.
  if (delta < 0 && root.locationId) {
    type TrackingQuantityRow = {
      trackedEntityId: string | null;
      storageUnitId: string | null;
      quantity: number | null;
    };
    const trackingRows = (trackingQuantities.data ??
      []) as TrackingQuantityRow[];
    // null == undefined — loose equality is deliberate (matches
    // post-inventory-adjustment's storage-unit lookup).
    const stockTarget = root.trackedEntityId
      ? trackingRows.find((q) => q.trackedEntityId == root.trackedEntityId)
      : trackingRows.find(
          (q) =>
            q.trackedEntityId == null && q.storageUnitId == root.storageUnitId
        );
    if ((stockTarget?.quantity ?? 0) < Math.abs(delta)) {
      throw new InvalidInputError(
        "Insufficient quantity for negative adjustment"
      );
    }
  }

  let trackedEntityStatus: string | null = null;
  if (root.trackedEntityId) {
    const entity = await maybeSingle(
      db,
      "trackedEntity",
      { id: root.trackedEntityId, companyId },
      { columns: ["status", "quantity"] }
    );
    if (entity.error || !entity.data) {
      throw new Error("Failed to fetch tracked entity");
    }
    trackedEntityStatus = entity.data.status;
    if (trackedEntityStatus === "Consumed") {
      throw new InvalidInputError(
        "Cannot correct a movement of a consumed tracked entity"
      );
    }
    // Round before comparing: a correction that lands the lot exactly on
    // zero can read as −1e-17 raw and refuse a legitimate full correction.
    if (round(Number(entity.data.quantity) + delta) < 0) {
      throw new InvalidInputError(
        "Correction would make the tracked entity quantity negative"
      );
    }
    if (isSerial && Number(entity.data.quantity) + delta > 1) {
      throw new InvalidInputError("Serial items can only have a quantity of 1");
    }
  }

  // A correction that carries value posts a journal: Provisional before the
  // company's accounting cutover, Posted after it. Read here to decide
  // whether to resolve a period, and again inside the transaction.
  const postingStatus = await journalPostingStatus(db, companyId);
  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  const dimensionMap: Record<string, string> = {};
  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );
  if (companyRecord.error) throw new Error("Failed to fetch company");
  const companyGroupId = companyRecord.data.companyGroupId;
  if (companyGroupId) {
    const dimensions = await many(
      db,
      "dimension",
      {
        companyGroupId,
        active: true,
        entityType: ["Item", "ItemPostingGroup", "Location"]
      },
      { columns: ["id", "entityType"] }
    );
    if (dimensions.error) throw new Error("Failed to fetch dimensions");
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
    }
  }

  // Resolve the accounting period BEFORE opening the Kysely transaction —
  // the REST client mid-transaction parks the (size 1) pool. The period is
  // the one containing the ORIGINAL movement's postingDate; Locked/Closed
  // periods throw here with a user-facing message. A Provisional journal has
  // no accounting period.
  // A movement dated before the cutover sits in the opening balance: a
  // correction would resolve (or create) a period before the cutover and
  // post against value the opening journal already holds.
  await refuseVoidBeforeCutover(
    db,
    companyId,
    root.postingDate ? String(root.postingDate) : null,
    STOCK_CORRECTION_BEFORE_CUTOVER_ERROR
  );
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getAccountingPeriodForDate(companyId, db, root.postingDate)
      : null;
  const accounting = {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      inventoryAdjustmentVarianceAccount:
        accountDefaults.data.inventoryAdjustmentVarianceAccount
    },
    description: `Stock Movement Correction — ${resolvedComment}`,
    userId,
    dimensions: dimensionMap
  };

  let resultLedgerId: string | null = null;

  await db.transaction().execute(async (trx) => {
    await assertPostingStatusUnchanged(trx, companyId, postingStatus);

    if (root.trackedEntityId) {
      const updated = await trx
        .updateTable("trackedEntity")
        .set((eb) => ({ quantity: eb("quantity", "+", delta) }))
        .where("id", "=", root.trackedEntityId!)
        .where("companyId", "=", companyId)
        .where("status", "!=", "Consumed")
        .where((eb) => eb("quantity", ">=", -delta))
        // Serial ceiling re-checked atomically: resulting quantity ≤ 1.
        .$if(isSerial, (qb) =>
          qb.where((eb) => eb("quantity", "<=", 1 - delta))
        )
        .returning(["id", "quantity", "status"])
        .executeTakeFirst();
      if (!updated) {
        throw new InvalidInputError(
          "Tracked entity changed while correcting — try again"
        );
      }
      // If the correction drove the lot to zero, Consume it (a Scrapped lot
      // stays Scrapped). `updated.status` is the unchanged pre-flip status.
      const settledStatus = statusAfterQuantityChange(
        Number(updated.quantity),
        updated.status
      );
      if (settledStatus !== updated.status) {
        await trx
          .updateTable("trackedEntity")
          .set({ status: settledStatus })
          .where("id", "=", root.trackedEntityId!)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    const booked = await bookAdjustment(trx, {
      ledger: {
        postingDate: root.postingDate,
        itemId: root.itemId,
        quantity: delta,
        locationId: root.locationId,
        storageUnitId: root.storageUnitId,
        trackedEntityId: root.trackedEntityId,
        entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
        documentType: root.documentType,
        documentId: root.documentId,
        correctionOfItemLedgerId: root.id,
        comment: resolvedComment,
        companyId,
        createdBy: userId
      },
      item,
      itemCost: itemCostResult.data,
      accounting
    });
    resultLedgerId = booked.itemLedgerId;
  });

  return { itemLedger: resultLedgerId ? { id: resultLedgerId } : null };
}

export const kanbanReplenishInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("scan"), kanbanId: z.string().min(1) }),
  z.object({
    mode: z.literal("level"),
    kanbanIds: z.array(z.string().min(1)).min(1)
  })
]);

// The first three are the scan route's own error strings, kept exact.
export const KANBAN_REPLENISH_REASONS = {
  missingStorageUnit: "Kanban is missing a from or to storage unit",
  foreignStorageUnit: "Storage unit does not belong to the kanban location",
  missingItem: "Failed to get item",
  notTransfer: "Kanban is not a transfer kanban",
  notArmed: "Kanban has no replenishment level"
} as const;

type KanbanReplenishReason =
  (typeof KANBAN_REPLENISH_REASONS)[keyof typeof KANBAN_REPLENISH_REASONS];

export type KanbanReplenishOutcome =
  | {
      kanbanId: string;
      outcome: "created";
      id: string;
      stockTransferId: string;
    }
  | { kanbanId: string; outcome: "at-level"; projectedQuantity: number }
  | { kanbanId: string; outcome: "invalid"; reason: KanbanReplenishReason };

export type KanbanReplenishResult = { results: KanbanReplenishOutcome[] };

export const replenishKanbanPermission = {
  by: "mode",
  rules: { scan: { create: "inventory" }, level: "system" }
} satisfies PermissionRule<z.output<typeof kanbanReplenishInput>>;

/**
 * The only writer of a kanban replenishment: a Released stock transfer from a
 * Transfer kanban's From storage unit to its To storage unit, marked with
 * `kanbanId` and a "Kanban replenishment" note.
 *
 * - `scan` always creates (the operator asked for it).
 * - `level` creates only while the projected quantity at the To storage unit
 *   (on-hand + open inbound transfers) is below `replenishmentLevel`, and then
 *   moves enough whole kanban quantities to reach the level, so a second
 *   signal for the same shortfall writes nothing.
 *
 * The kanban rows are locked `FOR UPDATE` in id order, so two signals for one
 * kanban serialise and the second reads the first one's transfer as supply.
 */
export async function replenishKanban(
  ctx: ServiceContext,
  raw: z.input<typeof kanbanReplenishInput>
) {
  const input = kanbanReplenishInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const { results, created } = await db.transaction().execute(async (trx) => {
    let kanbanQuery = trx
      .selectFrom("kanban")
      .select([
        "id",
        "itemId",
        "locationId",
        "replenishmentSystem",
        "replenishmentLevel",
        "quantity",
        "fromStorageUnitId",
        "storageUnitId"
      ])
      .where("companyId", "=", companyId);

    kanbanQuery =
      input.mode === "scan"
        ? kanbanQuery.where("id", "=", input.kanbanId)
        : kanbanQuery.where("id", "in", input.kanbanIds);

    const kanbans = await kanbanQuery.orderBy("id").forUpdate().execute();

    if (input.mode === "scan" && kanbans.length === 0) {
      throw new NotFoundError("Kanban not found");
    }

    const outcomes = new Map<string, KanbanReplenishOutcome>();
    const invalid = (kanbanId: string, reason: KanbanReplenishReason) =>
      outcomes.set(kanbanId, { kanbanId, outcome: "invalid", reason });

    let candidates = kanbans.filter((kanban) => {
      if (kanban.replenishmentSystem !== "Transfer") {
        invalid(kanban.id, KANBAN_REPLENISH_REASONS.notTransfer);
        return false;
      }
      if (!kanban.fromStorageUnitId || !kanban.storageUnitId) {
        invalid(kanban.id, KANBAN_REPLENISH_REASONS.missingStorageUnit);
        return false;
      }
      if (input.mode === "level" && kanban.replenishmentLevel === null) {
        invalid(kanban.id, KANBAN_REPLENISH_REASONS.notArmed);
        return false;
      }
      return true;
    });

    // CWE-639: both storage units must belong to this company and to the
    // kanban's own location — never trust the stored ids.
    const storageUnitIds = [
      ...new Set(
        candidates.flatMap((kanban) => [
          kanban.fromStorageUnitId!,
          kanban.storageUnitId!
        ])
      )
    ];
    const storageUnits =
      storageUnitIds.length > 0
        ? await trx
            .selectFrom("storageUnit")
            .select(["id", "name", "locationId"])
            .where("companyId", "=", companyId)
            .where("id", "in", storageUnitIds)
            .execute()
        : [];
    const storageUnitById = new Map(storageUnits.map((su) => [su.id, su]));

    candidates = candidates.filter((kanban) => {
      const from = storageUnitById.get(kanban.fromStorageUnitId!);
      const to = storageUnitById.get(kanban.storageUnitId!);
      if (
        !from ||
        !to ||
        from.locationId !== kanban.locationId ||
        to.locationId !== kanban.locationId
      ) {
        invalid(kanban.id, KANBAN_REPLENISH_REASONS.foreignStorageUnit);
        return false;
      }
      return true;
    });

    // Drop a kanban whose item cannot be read before sizing any transfer, so
    // the level loop below never counts supply for a transfer it will not write.
    const itemIds = [...new Set(candidates.map((kanban) => kanban.itemId))];
    const items =
      itemIds.length > 0
        ? await trx
            .selectFrom("item")
            .select([
              "id",
              "readableIdWithRevision",
              "itemTrackingType",
              "unitOfMeasureCode"
            ])
            .where("companyId", "=", companyId)
            .where("id", "in", itemIds)
            .execute()
        : [];
    const itemById = new Map(items.map((item) => [item.id, item]));

    candidates = candidates.filter((kanban) => {
      if (!itemById.has(kanban.itemId)) {
        invalid(kanban.id, KANBAN_REPLENISH_REASONS.missingItem);
        return false;
      }
      return true;
    });

    // Level mode moves enough whole kanban quantities to reach the level in
    // one signal. Two kanbans can watch the same item at the same To storage
    // unit; `addedInbound` carries what this call has already created there,
    // so the second kanban sees the first one's transfer as supply.
    const projectedByKanban = new Map<string, number>();
    const transferQuantityByKanban = new Map<string, number>();
    if (input.mode === "level" && candidates.length > 0) {
      const projected = await sql<{
        kanbanId: string;
        replenishmentLevel: number;
        projectedQuantity: number;
      }>`
            SELECT * FROM get_kanban_projected_quantities(
              ${companyId},
              ${candidates.map((kanban) => kanban.id)}::text[]
            )
          `.execute(trx);
      const baseByKanban = new Map(
        projected.rows.map((row) => [
          row.kanbanId,
          Number(row.projectedQuantity)
        ])
      );

      const addedInbound = new Map<string, number>();
      candidates = candidates.filter((kanban) => {
        const key = `${kanban.itemId}:${kanban.storageUnitId}`;
        const projectedQuantity =
          (baseByKanban.get(kanban.id) ?? 0) + (addedInbound.get(key) ?? 0);
        projectedByKanban.set(kanban.id, projectedQuantity);
        const quantityToMove = levelReplenishmentQuantity(
          projectedQuantity,
          Number(kanban.replenishmentLevel),
          kanban.quantity
        );
        if (quantityToMove <= 0) {
          outcomes.set(kanban.id, {
            kanbanId: kanban.id,
            outcome: "at-level",
            projectedQuantity
          });
          return false;
        }
        transferQuantityByKanban.set(kanban.id, quantityToMove);
        addedInbound.set(key, (addedInbound.get(key) ?? 0) + quantityToMove);
        return true;
      });
    }
    // A scan always moves one kanban quantity.
    const transferQuantity = (kanban: { id: string; quantity: number }) =>
      transferQuantityByKanban.get(kanban.id) ?? kanban.quantity;

    if (candidates.length === 0) {
      return {
        results: kanbans.map((kanban) => outcomes.get(kanban.id)!),
        created: [] as KanbanReplenishOutcome[]
      };
    }

    let scannerName = "unknown user";
    if (input.mode === "scan") {
      const user = await trx
        .selectFrom("user")
        .select("fullName")
        .where("id", "=", userId)
        .executeTakeFirst();
      // A user with no last name has a fullName ending in a space.
      scannerName = user?.fullName?.trim() || scannerName;
    }

    const headers: Insertable<KyselyDatabase["stockTransfer"]>[] = [];
    for (const kanban of candidates) {
      const item = itemById.get(kanban.itemId)!;
      const stockTransferId = await sequence.getNextSequence(
        trx,
        "stockTransfer",
        companyId
      );
      const note = kanbanReplenishmentNote({
        itemReadableId: item.readableIdWithRevision ?? kanban.itemId,
        fromStorageUnitName:
          storageUnitById.get(kanban.fromStorageUnitId!)?.name ?? "",
        toStorageUnitName:
          storageUnitById.get(kanban.storageUnitId!)?.name ?? "",
        quantity: transferQuantity(kanban),
        unitOfMeasureCode: item.unitOfMeasureCode,
        signal:
          input.mode === "scan"
            ? { type: "scan", userName: scannerName }
            : {
                type: "level",
                replenishmentLevel: Number(kanban.replenishmentLevel),
                projectedQuantity: projectedByKanban.get(kanban.id) ?? 0
              }
      });
      headers.push({
        stockTransferId,
        locationId: kanban.locationId,
        status: "Released" as const,
        companyId,
        kanbanId: kanban.id,
        notes: toJson(note),
        createdBy: userId
      });
    }

    const inserted = await trx
      .insertInto("stockTransfer")
      .values(headers)
      .returning(["id", "kanbanId", "stockTransferId"])
      .execute();
    const headerByKanban = new Map(
      inserted.map((header) => [header.kanbanId!, header])
    );

    const lines = candidates.flatMap((kanban) => {
      const item = itemById.get(kanban.itemId)!;
      const header = headerByKanban.get(kanban.id)!;
      const draft: StockTransferLineDraft = {
        itemId: kanban.itemId,
        fromStorageUnitId: kanban.fromStorageUnitId,
        toStorageUnitId: kanban.storageUnitId,
        quantity: transferQuantity(kanban),
        requiresSerialTracking: item.itemTrackingType === "Serial",
        requiresBatchTracking: item.itemTrackingType === "Batch"
      };
      return expandSerialTrackedLines([draft]).map((line) => ({
        itemId: line.itemId,
        fromStorageUnitId: line.fromStorageUnitId ?? null,
        toStorageUnitId: line.toStorageUnitId ?? null,
        quantity: line.quantity ?? 0,
        requiresSerialTracking: line.requiresSerialTracking ?? false,
        requiresBatchTracking: line.requiresBatchTracking ?? false,
        stockTransferId: header.id,
        companyId,
        createdBy: userId
      }));
    });

    if (lines.length > 0) {
      await trx.insertInto("stockTransferLine").values(lines).execute();
    }

    const createdOutcomes: KanbanReplenishOutcome[] = [];
    for (const kanban of candidates) {
      const header = headerByKanban.get(kanban.id)!;
      const outcome: KanbanReplenishOutcome = {
        kanbanId: kanban.id,
        outcome: "created",
        id: header.id,
        stockTransferId: header.stockTransferId
      };
      outcomes.set(kanban.id, outcome);
      createdOutcomes.push(outcome);
    }

    return {
      results: kanbans.map((kanban) => outcomes.get(kanban.id)!),
      created: createdOutcomes
    };
  });

  for (const outcome of created) {
    if (outcome.outcome !== "created") continue;
    logger.info("Kanban replenishment created", {
      companyId,
      kanbanId: outcome.kanbanId,
      stockTransferId: outcome.stockTransferId,
      mode: input.mode
    });
  }

  return { results };
}
type Enums = Database["public"]["Enums"];

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

/** A journal line and its dimension values, by entity type. The caller adds
 *  the journal and the company. */
export type ReceiptJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: JournalLineDimensionValues;
};

/** One purchase order receipt line, as the posting reads it. */
export type PurchaseReceiptLine = {
  purchaseOrderLineId: string | null;
  itemId: string | null;
  /** Signed. Null and NaN are read as 0 by the caller. */
  quantity: number;
  unitPrice: number | null;
  /** No item, or an item with no tracking type, is Inventory. */
  itemTrackingType: Enums["itemTrackingType"] | null | undefined;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null | undefined;
  itemPostingGroupId: string | null;
  locationId: string | null;
  /** The process of an outside processing line's job operation. */
  processId: string | null;
};

/** What a purchase order line was invoiced before it was received. */
export type InvoiceFirstBasis = {
  /** Invoiced and not yet received, in inventory units, per PO line. */
  quantity: Map<string, number>;
  /** The unit cost the invoice accrued on GR/IR, per PO line. */
  unitCost: Map<string, number>;
};

export type PurchaseReceiptLineCost = {
  quantity: number;
  /** The line puts stock on (or takes it off) a cost layer. */
  createsLayers: boolean;
  /** Price × quantity and the line's share of the order's shipping. */
  poCost: number;
  /** The quantity claimed by an invoice posted before the receipt, valued at
   *  the invoice's accrual cost. Positive lines only. */
  invoiceFirstQuantity: number;
  invoiceFirstCost: number;
  /** The rest of the line, at its PO unit cost. */
  normalQuantity: number;
  normalCost: number;
  /** What the line books: the PO cost of a negative line, the invoice-first
   *  and normal portions of a positive one. */
  cost: number;
};

function trackingType(line: Pick<PurchaseReceiptLine, "itemTrackingType">) {
  return line.itemTrackingType ?? "Inventory";
}

/**
 * The cost of each line, in the order given. The shipping is shared by each
 * line's PO value. A positive line first claims the quantity its PO line was
 * invoiced before receipt, at the accrual unit cost; a later line of the same
 * PO line claims what is left. A missing accrual cost claims nothing.
 */
export function purchaseReceiptLineCosts(
  lines: PurchaseReceiptLine[],
  {
    shippingCost,
    isOutsideProcessing,
    invoiceFirst
  }: {
    /** In base currency. */
    shippingCost: number;
    isOutsideProcessing: boolean;
    invoiceFirst?: InvoiceFirstBasis;
  }
): PurchaseReceiptLineCost[] {
  const totalLinesCost = lines.reduce(
    (sum, line) => sum + Math.abs(line.quantity) * (line.unitPrice ?? 0),
    0
  );
  const unclaimed = new Map(invoiceFirst?.quantity);
  return lines.map((line) => {
    const absQuantity = Math.abs(line.quantity);
    const lineCost = absQuantity * (line.unitPrice ?? 0);
    const share = totalLinesCost === 0 ? 0 : lineCost / totalLinesCost;
    const poCost = lineCost + shippingCost * share;
    const poUnitCost = absQuantity > 0 ? poCost / absQuantity : 0;

    let invoiceFirstQuantity = 0;
    let accrualUnitCost = 0;
    const poLineId = line.purchaseOrderLineId;
    if (line.quantity >= 0 && poLineId && unclaimed.has(poLineId)) {
      const remaining = unclaimed.get(poLineId)!;
      const claimed = Math.min(absQuantity, remaining);
      const unitCost = invoiceFirst?.unitCost.get(poLineId);
      // A recorded accrual is claimed even at zero unit cost (a zero-priced
      // invoice); only a missing one leaves the line at PO cost.
      if (claimed > 0 && unitCost !== undefined) {
        invoiceFirstQuantity = claimed;
        accrualUnitCost = unitCost;
        unclaimed.set(poLineId, remaining - claimed);
      }
    }
    const invoiceFirstCost = invoiceFirstQuantity * accrualUnitCost;
    const normalQuantity = absQuantity - invoiceFirstQuantity;
    const normalCost = normalQuantity * poUnitCost;

    return {
      quantity: line.quantity,
      createsLayers:
        trackingType(line) !== "Non-Inventory" &&
        !isOutsideProcessing &&
        Boolean(line.itemId) &&
        absQuantity > 0,
      poCost,
      invoiceFirstQuantity,
      invoiceFirstCost,
      normalQuantity,
      normalCost,
      cost: line.quantity < 0 ? poCost : invoiceFirstCost + normalCost
    };
  });
}

/** A fixed asset purchase order line received on the receipt. */
export type FixedAssetReceiptLine = {
  purchaseOrderLineId: string;
  quantity: number;
  cost: number;
  /** The asset class's asset account. */
  assetAccountId: string;
  fixedAssetClassId: string | null;
  locationId: string | null;
};

/**
 * The journal lines of a purchase order receipt: one pair per receipt line
 * with a quantity, then one pair per fixed asset line. A line books `cost`:
 * the cost its layers relieved or stored when the caller knows it, else its
 * `purchaseReceiptLineCosts` cost.
 */
export function buildPurchaseReceiptJournalLines({
  documentId,
  externalDocumentId,
  isOutsideProcessing,
  supplierId,
  supplierTypeId,
  accounts,
  lines,
  fixedAssets
}: {
  documentId: string;
  /** The supplier's reference on the purchase order. */
  externalDocumentId: string | null;
  isOutsideProcessing: boolean;
  supplierId: string | null;
  supplierTypeId: string | null;
  accounts: Pick<
    AccountDefaults,
    | "goodsReceivedNotInvoicedAccount"
    | "workInProgressAccount"
    | "indirectCostAccount"
    | "rawMaterialsAccount"
    | "finishedGoodsAccount"
  >;
  lines: (PurchaseReceiptLine & { cost: number })[];
  fixedAssets: FixedAssetReceiptLine[];
}): ReceiptJournalLine[] {
  const journalLines: ReceiptJournalLine[] = [];
  const pair = (
    purchaseOrderLineId: string | null,
    quantity: number,
    dimensions: ReceiptJournalLine["dimensions"]
  ) => ({
    quantity: round(quantity),
    documentType: "Receipt" as const,
    documentId,
    externalDocumentId: externalDocumentId ?? undefined,
    documentLineReference: journalReference.to.receipt(
      String(purchaseOrderLineId)
    ),
    journalLineReference: nanoid(),
    dimensions
  });
  const goodsReceived = {
    accountId: accounts.goodsReceivedNotInvoicedAccount,
    description: "Goods Received Not Invoiced"
  };

  for (const line of lines) {
    const absQuantity = Math.abs(line.quantity);
    if (absQuantity <= 0) continue;

    let debitSide: { accountId: string; description: string };
    if (trackingType(line) !== "Non-Inventory" && !isOutsideProcessing) {
      const inventory = resolveInventoryAccount(
        line.replenishmentSystem ?? null,
        accounts
      );
      debitSide = {
        accountId: inventory.account,
        description: inventory.description
      };
    } else if (isOutsideProcessing) {
      debitSide = {
        accountId: accounts.workInProgressAccount,
        description: "WIP Account"
      };
    } else {
      debitSide = {
        accountId: accounts.indirectCostAccount,
        description: "Indirect Cost Account"
      };
    }

    const keys = pair(line.purchaseOrderLineId, absQuantity, {
      SupplierType: supplierTypeId,
      ItemPostingGroup: line.itemPostingGroupId,
      Item: line.itemId,
      Supplier: supplierId,
      Location: line.locationId,
      Process: line.processId
    });
    if (line.quantity < 0) {
      journalLines.push(
        {
          ...goodsReceived,
          ...keys,
          amount: round(debit("liability", line.cost))
        },
        { ...debitSide, ...keys, amount: round(credit("asset", line.cost)) }
      );
    } else {
      journalLines.push(
        { ...debitSide, ...keys, amount: round(debit("asset", line.cost)) },
        {
          ...goodsReceived,
          ...keys,
          amount: round(credit("liability", line.cost))
        }
      );
    }
  }

  for (const asset of fixedAssets) {
    const keys = pair(asset.purchaseOrderLineId, asset.quantity, {
      SupplierType: supplierTypeId,
      ItemPostingGroup: null,
      Item: null,
      Supplier: supplierId,
      Location: asset.locationId,
      Process: null,
      FixedAssetClass: asset.fixedAssetClassId
    });
    journalLines.push(
      {
        accountId: asset.assetAccountId,
        description: "Fixed Asset Acquisition",
        ...keys,
        amount: round(debit("asset", asset.cost))
      },
      {
        ...goodsReceived,
        ...keys,
        amount: round(credit("liability", asset.cost))
      }
    );
  }
  return journalLines;
}

/** One sales return receipt line and the value it re-enters stock at. */
export type SalesReturnReceiptLine = {
  /** The sales return order line. */
  returnLineId: string;
  itemId: string;
  quantity: number;
  cost: number;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null | undefined;
  itemPostingGroupId: string | null;
  locationId: string | null;
};

/** The journal lines of a sales return receipt: inventory against COGS per
 *  line with a value. A zero-value re-entry books nothing. */
export function buildSalesReturnReceiptJournalLines({
  documentId,
  externalDocumentId,
  customerId,
  customerTypeId,
  accounts,
  lines
}: {
  documentId: string;
  /** The receipt's own external document id. */
  externalDocumentId: string | null;
  customerId: string | null;
  customerTypeId: string | null;
  accounts: Pick<
    AccountDefaults,
    "costOfGoodsSoldAccount" | "rawMaterialsAccount" | "finishedGoodsAccount"
  >;
  lines: SalesReturnReceiptLine[];
}): ReceiptJournalLine[] {
  return lines.flatMap((line) => {
    if (!(line.cost > 0)) return [];
    const inventory = resolveInventoryAccount(
      line.replenishmentSystem ?? null,
      accounts
    );
    const keys = {
      quantity: round(line.quantity),
      documentType: "Receipt" as const,
      documentId,
      externalDocumentId: externalDocumentId ?? undefined,
      documentLineReference: journalReference.to.receipt(line.returnLineId),
      journalLineReference: nanoid(),
      dimensions: {
        Item: line.itemId,
        ItemPostingGroup: line.itemPostingGroupId,
        Location: line.locationId,
        Customer: customerId,
        CustomerType: customerTypeId
      }
    };
    return [
      {
        accountId: inventory.account,
        description: inventory.description,
        ...keys,
        amount: round(debit("asset", line.cost))
      },
      {
        accountId: accounts.costOfGoodsSoldAccount,
        description: "Cost of Goods Sold",
        ...keys,
        amount: round(credit("expense", line.cost))
      }
    ];
  });
}
export async function postRentalReceipt(
  db: Kysely<KyselyDatabase>,
  args: {
    receiptId: string;
    companyId: string;
    userId: string;
    today: string;
    postingDate?: string;
  }
): Promise<void> {
  const { receiptId, companyId, userId, today } = args;

  await db.transaction().execute(async (trx) => {
    const returnedAt = args.postingDate ?? today;
    const future = futureReturnError(returnedAt, today);
    if (future) throw new InvalidInputError(future);

    const receipt = await trx
      .selectFrom("receipt")
      .select(["id", "receiptId", "sourceDocumentId", "locationId"])
      .where("id", "=", receiptId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!receipt) throw new NotFoundError("Receipt not found");

    const assetLines = await trx
      .selectFrom("receiptFixedAssetLine")
      .select([
        "id",
        "rentalAgreementLineId",
        "meter",
        "notes",
        "takeOutOfService",
        "outOfServiceReason",
        "residualDestination"
      ])
      .where("receiptId", "=", receiptId)
      .where("companyId", "=", companyId)
      .where("received", "=", true)
      .where("rentalAgreementLineId", "is not", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    if (assetLines.length === 0) {
      throw new InvalidInputError("Select at least one unit to return");
    }

    if (!receipt.sourceDocumentId) {
      throw new NotFoundError("Rental agreement not found");
    }
    const agreement = await lockAgreement(
      trx,
      companyId,
      receipt.sourceDocumentId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are returned from an Active agreement`
      );
    }

    const lineIds = assetLines.map((line) => line.rentalAgreementLineId!);
    const lines = await trx
      .selectFrom("rentalAgreementLine")
      .select([
        "id",
        "rentalAgreementId",
        "status",
        "lessorClassification",
        "fixedAssetId",
        "trackedEntityId"
      ])
      .where("id", "in", lineIds)
      .where("companyId", "=", companyId)
      .execute();
    const linesById = new Map(lines.map((line) => [line.id, line]));
    const assetIds = lines
      .map((line) => line.fixedAssetId)
      .filter((id): id is string => id !== null);
    const assets =
      assetIds.length === 0
        ? []
        : await trx
            .selectFrom("fixedAsset")
            .select(["id", "fixedAssetId", "name"])
            .where("id", "in", assetIds)
            .where("companyId", "=", companyId)
            .execute();
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    const units = assetLines.map((assetLine) => {
      const lineId = assetLine.rentalAgreementLineId!;
      const line = linesById.get(lineId);
      const asset = line?.fixedAssetId
        ? assetsById.get(line.fixedAssetId)
        : undefined;
      const label = unitLabel(asset, lineId);
      if (!line || line.rentalAgreementId !== agreement.id) {
        throw new NotFoundError("Rental agreement line not found");
      }
      const statusProblem = receiptReturnError(label, line.status);
      if (statusProblem) throw new InvalidInputError(statusProblem);

      const parsed = unitReturnValidator.safeParse({
        rentalAgreementLineId: lineId,
        returnedAt,
        meterIn: assetLine.meter === null ? null : Number(assetLine.meter),
        returnNotes: assetLine.notes,
        takeOutOfService: assetLine.takeOutOfService,
        outOfServiceReason: assetLine.outOfServiceReason,
        residualDestination: assetLine.residualDestination
      });
      if (!parsed.success) {
        throw new InvalidInputError(
          `${label}: ${parsed.error.issues[0]?.message ?? "invalid return"}`
        );
      }
      const unit: RentalUnitReturn = parsed.data;
      return { line, unit };
    });

    for (const { line, unit } of units) {
      const { fixedAssetId } = await returnRentalUnit(trx, {
        agreement,
        unit,
        companyId,
        userId,
        today,
        locationId: receipt.locationId ?? undefined
      });

      if (fixedAssetId && receipt.locationId) {
        await trx
          .updateTable("fixedAsset")
          .set({
            locationId: receipt.locationId,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", fixedAssetId)
          .where("companyId", "=", companyId)
          .execute();
      }

      if (line.lessorClassification === "Rental" && line.trackedEntityId) {
        await insertUnitActivity(trx, {
          type: "Rental Return",
          direction: "output",
          sourceDocument: "Receipt",
          sourceDocumentId: receipt.id,
          sourceDocumentReadableId: receipt.receiptId,
          attributes: { Receipt: receipt.id, "Rental Agreement": agreement.id },
          trackedEntityId: line.trackedEntityId,
          companyId,
          userId
        });
      }
    }

    await trx
      .updateTable("receipt")
      .set({
        status: "Posted",
        postingDate: returnedAt,
        postedBy: userId
      })
      .where("id", "=", receiptId)
      .where("companyId", "=", companyId)
      .execute();
  });
}
export type ReceiptCostLedgerRow = {
  id: string;
  itemId: string | null;
  quantity: number;
  remainingQuantity: number;
  cost: number;
  supplierId: string | null;
  trackedEntityId: string | null;
};

export type RestoringLayer = {
  itemId: string | null;
  quantity: number;
  cost: number;
  supplierId: string | null;
  trackedEntityId: string | null;
};

export type ReceiptVoidCostLedgerPlan = {
  consumed: boolean;
  layerIdsToClose: string[];
  restoringLayers: RestoringLayer[];
};

// A positive row is a layer the receipt created: the void closes it, unless
// part of it was already issued or shipped — that stock has moved on, so the
// void is refused (as the sales return void is) and the remainder is an
// inventory adjustment. A negative row is what a negative line relieved from
// older layers: the void puts that stock back as a new layer at the cost that
// was relieved, the cost the reversing journal credits back to inventory.
export function planReceiptVoidCostLedger(
  rows: ReceiptCostLedgerRow[]
): ReceiptVoidCostLedgerPlan {
  const created = rows.filter((row) => row.quantity > 0);
  const relieved = rows.filter((row) => row.quantity < 0);

  return {
    consumed: created.some(
      (row) => row.quantity - row.remainingQuantity > EPSILON
    ),
    layerIdsToClose: created.map((row) => row.id),
    restoringLayers: relieved.map((row) => ({
      itemId: row.itemId,
      quantity: -row.quantity,
      cost: -row.cost,
      supplierId: row.supplierId,
      trackedEntityId: row.trackedEntityId
    }))
  };
}

type VoidGuardDb = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

export type StockPosition = {
  itemId: string;
  locationId: string | null;
  storageUnitId: string | null;
  trackedEntityId: string | null;
};

export type ReversingRow = StockPosition & { quantity: number };

const positionKey = (row: StockPosition) =>
  [
    row.itemId,
    row.locationId ?? "",
    row.storageUnitId ?? "",
    row.trackedEntityId ?? ""
  ].join("|");

/**
 * The positions the reversal would drive below zero. A tracked row is checked
 * per serial or batch, so a unit that left its bin is caught even when the bin
 * holds other stock of the item. Reversal rows that add stock (a negative
 * receipt line) need nothing.
 */
export function findVoidShortfalls(
  reversingRows: ReversingRow[],
  onHand: ReadonlyMap<string, number>
): (StockPosition & { required: number; onHand: number })[] {
  const required = new Map<string, StockPosition & { required: number }>();
  for (const row of reversingRows) {
    if (row.quantity >= 0) continue;
    const key = positionKey(row);
    const entry = required.get(key) ?? { ...row, required: 0 };
    entry.required += -row.quantity;
    required.set(key, entry);
  }

  return [...required.entries()].flatMap(([key, entry]) => {
    const available = onHand.get(key) ?? 0;
    return available + EPSILON < entry.required
      ? [
          {
            itemId: entry.itemId,
            locationId: entry.locationId,
            storageUnitId: entry.storageUnitId,
            trackedEntityId: entry.trackedEntityId,
            required: entry.required,
            onHand: available
          }
        ]
      : [];
  });
}

/** Refuses the void when the received stock is no longer where it was received. */
export async function assertReceivedStockOnHand(
  trx: VoidGuardDb,
  companyId: string,
  reversingRows: ReversingRow[]
): Promise<void> {
  const removing = reversingRows.filter((row) => row.quantity < 0);
  if (removing.length === 0) return;

  const itemIds = [...new Set(removing.map((row) => row.itemId))];
  const locationIds = [
    ...new Set(removing.flatMap((row) => row.locationId ?? []))
  ];
  const withoutLocation = removing.some((row) => row.locationId === null);
  const rows = await trx
    .selectFrom("itemLedger")
    .select([
      "itemId",
      "locationId",
      "storageUnitId",
      "trackedEntityId",
      (eb) => eb.fn.sum<number>("quantity").as("quantity")
    ])
    .where("companyId", "=", companyId)
    .where("itemId", "in", itemIds)
    .where((eb) =>
      eb.or([
        ...(locationIds.length > 0
          ? [eb("locationId", "in", locationIds)]
          : []),
        ...(withoutLocation ? [eb("locationId", "is", null)] : [])
      ])
    )
    .groupBy(["itemId", "locationId", "storageUnitId", "trackedEntityId"])
    .execute();

  // Untracked rows are compared with the bin's untracked stock; tracked rows
  // with that serial or batch alone.
  const onHand = new Map<string, number>();
  for (const row of rows) {
    onHand.set(positionKey(row), Number(row.quantity ?? 0));
  }

  if (findVoidShortfalls(removing, onHand).length > 0) {
    throw new InvalidInputError(
      "Cannot void: stock received on this receipt was moved, picked or shipped since it was received. Correct the remainder with an inventory adjustment instead."
    );
  }
}

/**
 * Locks the receipt and re-reads its status inside the void's transaction, so
 * two voids sent at once cannot both reverse it. Inspection writes read the
 * receipt FOR SHARE, so they also wait for the void to commit.
 */
export async function lockPostedReceipt(
  trx: VoidGuardDb,
  companyId: string,
  receiptId: string
): Promise<void> {
  const receipt = await trx
    .selectFrom("receipt")
    .select("status")
    .where("id", "=", receiptId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (receipt?.status !== "Posted") {
    throw new InvalidInputError("Can only void posted receipts");
  }
}

/**
 * Refuses the void when an inspection of the receipt rejected an untracked
 * lot. The reject route writes that lot off; the void would then take the same
 * stock out a second time.
 */
export async function assertNoRejectedUntrackedLot(
  trx: VoidGuardDb,
  companyId: string,
  receiptId: string
): Promise<void> {
  const rejected = await trx
    .selectFrom("inspection")
    .innerJoin("item", (join) =>
      join
        .onRef("item.id", "=", "inspection.itemId")
        .onRef("item.companyId", "=", "inspection.companyId")
    )
    .select("inspection.inspectionId")
    .where("inspection.companyId", "=", companyId)
    .where("inspection.sourceDocument", "=", "Receipt")
    .where("inspection.sourceDocumentId", "=", receiptId)
    .where("inspection.status", "=", "Failed")
    .where("item.itemTrackingType", "=", "Inventory")
    .executeTakeFirst();
  if (rejected) {
    throw new InvalidInputError(
      `Cannot void: inspection ${rejected.inspectionId} rejected this stock and wrote it off. Correct the remainder with an inventory adjustment instead.`
    );
  }
}

/** An item ledger row the void is about to insert, as a stock position. */
export function toReversingRow(row: {
  itemId: string;
  locationId?: string | null;
  storageUnitId?: string | null;
  trackedEntityId?: string | null;
  quantity: number | string;
}): ReversingRow {
  return {
    itemId: row.itemId,
    locationId: row.locationId ?? null,
    storageUnitId: row.storageUnitId ?? null,
    trackedEntityId: row.trackedEntityId ?? null,
    quantity: Number(row.quantity)
  };
}

export const postReceiptInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  receiptId: z.string(),
  /** The return date of a rental receipt. Other sources ignore it. */
  postingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});

export const postReceiptPermission = {
  update: "inventory"
} satisfies PermissionRule<z.output<typeof postReceiptInput>>;

/** Posts or voids a receipt: stock, tracked entities, cost layers and journal. */
export async function postReceipt(
  ctx: ServiceContext,
  raw: z.input<typeof postReceiptInput>
) {
  const { type, receiptId, postingDate } = postReceiptInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  logger.info({ type, receiptId, userId, companyId });
  const fixedAssetWrites = new FixedAssetWrites();
  if (type === "post")
    await assertPostable(db, "receipt", receiptId, companyId);
  try {
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const companyRecord = await single(
      db,
      "company",
      { id: companyId },
      { columns: ["companyGroupId"] }
    );
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;
    // Every receipt that carries value posts a journal: Provisional before
    // the company's accounting cutover, Posted after it. Read here to decide
    // whether to resolve a period, and again inside each transaction, where
    // FOR SHARE holds the status until commit.
    const postingStatus = await journalPostingStatus(db, companyId);

    const [receipt, receiptLines, receiptLineTracking, dimensions] =
      await inOrder([
        // The client is service-role: authorization proved the caller may
        // act in companyId, not that receiptId belongs to it.
        () => maybeSingle(db, "receipt", { id: receiptId, companyId }),
        () => many(db, "receiptLine", { receiptId, companyId }),
        () =>
          many(db, "trackedEntity", {
            attributes: contains({ Receipt: receiptId }),
            companyId
          }),
        () =>
          many(
            db,
            "dimension",
            {
              companyGroupId: companyGroupId!,
              active: true,
              entityType: [
                "SupplierType",
                "Supplier",
                "CustomerType",
                "Customer",
                "ItemPostingGroup",
                "Item",
                "Location",
                "Process",
                "FixedAssetClass"
              ]
            },
            { columns: ["id", "entityType"] }
          )
      ]);

    if (receipt.error) throw new Error("Failed to fetch receipt");
    if (!receipt.data) throw new NotFoundError("Receipt not found");
    const receiptHeader = receipt.data;
    if (receiptLines.error) throw new Error("Failed to fetch receipt lines");
    if (dimensions.error) {
      logger.error("Failed to fetch dimensions", {
        error: dimensions.error
      });
    }

    const dimensionMap = new Map<string, string>();
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }

    const itemIds = receiptLines.data.reduce<string[]>((acc, receiptLine) => {
      if (receiptLine.itemId && !acc.includes(receiptLine.itemId)) {
        acc.push(receiptLine.itemId);
      }
      return acc;
    }, []);
    const [items, itemCosts, companySettings] = await inOrder([
      () =>
        many(
          db,
          "item",
          { id: itemIds, companyId },
          { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        many(
          db,
          "itemCost",
          { itemId: itemIds },
          { columns: ["itemId", "itemPostingGroupId"] }
        ),
      () =>
        single(
          db,
          "companySettings",
          { id: companyId },
          { columns: ["samplingStandard"] }
        )
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }

    const samplingStandard: SamplingStandard =
      (companySettings.data as any)?.samplingStandard ?? "ANSI_Z1_4";

    // Receipt-usage inspection document assignments drive per-feature
    // measurement plans on the created lots.
    const inspectionDocumentAssignments = await many(
      db,
      "itemInspectionDocumentAssignment",
      { companyId, usage: "Receipt", itemId: itemIds },
      { columns: ["itemId", "inspectionDocumentId"] }
    );
    const assignmentByItemId = new Map<string, string>(
      ((inspectionDocumentAssignments.data as any[]) ?? []).map((a) => [
        a.itemId,
        a.inspectionDocumentId
      ])
    );
    const assignedDocumentIds = [...new Set(assignmentByItemId.values())];
    const inspectionFeaturesByDocumentId = new Map<string, any[]>();
    if (assignedDocumentIds.length > 0) {
      const inspectionFeatures = await many(
        db,
        "inspectionFeature",
        { inspectionDocumentId: assignedDocumentIds, companyId },
        {
          columns: [
            "id",
            "inspectionDocumentId",
            "type",
            "samplingPlanType",
            "samplingSampleSize",
            "samplingPercentage",
            "samplingAql",
            "samplingInspectionLevel",
            "samplingSeverity"
          ]
        }
      );
      for (const feature of (inspectionFeatures.data as any[]) ?? []) {
        const list =
          inspectionFeaturesByDocumentId.get(feature.inspectionDocumentId) ??
          [];
        list.push(feature);
        inspectionFeaturesByDocumentId.set(feature.inspectionDocumentId, list);
      }
    }

    // The document's default sampling rule is the lot-level plan base and the
    // fallback for features without their own rule (feature rule -> document
    // default -> All).
    const documentDefaultByDocumentId = new Map<string, any>();
    if (assignedDocumentIds.length > 0) {
      const assignedDocuments = await many(
        db,
        "inspectionDocument",
        { id: assignedDocumentIds, companyId },
        {
          columns: [
            "id",
            "samplingPlanType",
            "samplingSampleSize",
            "samplingPercentage",
            "samplingAql",
            "samplingInspectionLevel",
            "samplingSeverity"
          ]
        }
      );
      for (const doc of (assignedDocuments.data as any[]) ?? []) {
        if (!doc.samplingPlanType) continue;
        documentDefaultByDocumentId.set(doc.id, {
          type: doc.samplingPlanType,
          sampleSize: doc.samplingSampleSize,
          percentage:
            doc.samplingPercentage == null
              ? null
              : Number(doc.samplingPercentage),
          aql: doc.samplingAql == null ? null : Number(doc.samplingAql),
          inspectionLevel: doc.samplingInspectionLevel,
          severity: doc.samplingSeverity
        });
      }
    }

    if (type === "void") {
      if (receiptHeader.status !== "Posted") {
        throw new InvalidInputError("Can only void posted receipts");
      }

      // The enable reset the cost layers this receipt created.
      await refuseVoidBeforeCutover(
        db,
        companyId,
        receiptHeader.postingDate,
        INVENTORY_VOID_BEFORE_CUTOVER_ERROR
      );

      if (receiptHeader.invoiced) {
        throw new InvalidInputError(
          "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
        );
      }

      if (receiptHeader.sourceDocument === "Rental Agreement") {
        throw new InvalidInputError(
          "A rental return cannot be voided. Correct the unit by hand."
        );
      }

      if (
        receiptHeader.sourceDocument !== "Purchase Order" &&
        receiptHeader.sourceDocument !== "Sales Return Order"
      ) {
        throw new InvalidInputError(
          `Void is only supported for receipts with source document "Purchase Order" or "Sales Return Order"`
        );
      }

      if (!receiptHeader.sourceDocumentId) {
        throw new Error("Receipt has no sourceDocumentId");
      }

      if (receiptHeader.sourceDocument === "Sales Return Order") {
        // Reverse a posted sales-return receipt: sign-flip the ledger +
        // journal, roll back the RMA quantities and status ladder, flip the
        // reactivated entities back to Consumed (their pre-receipt state), and
        // zero this receipt's own cost layers so FIFO can never consume voided
        // return stock.
        const salesReturnOrderId = receiptHeader.sourceDocumentId;

        // The PO void path blocks voiding an invoiced receipt; the analogous
        // hazard here is a credit memo. Voiding after crediting would leave
        // quantityCredited > quantityReceived with no path to reconcile.
        const creditMemos = await many(
          db,
          "memo",
          { salesReturnOrderId, companyId, status: neq("Voided") },
          { columns: ["id", "status"] }
        );
        if (creditMemos.error)
          throw new Error("Failed to check for credit memos");
        if ((creditMemos.data ?? []).length > 0) {
          throw new InvalidInputError(
            "Cannot void: a credit memo exists for this return order. Void it first."
          );
        }

        const [originalItemLedger, originalJournalLines, returnLinesVoid] =
          await inOrder([
            () =>
              many(db, "itemLedger", {
                documentId: receiptId,
                documentType: "Sales Return Receipt",
                companyId
              }),
            () =>
              documentJournalLines(db, companyId, {
                documentId: receiptId,
                documentType: "Receipt"
              }),
            () =>
              many(db, "salesReturnOrderLine", {
                salesReturnOrderId,
                companyId
              })
          ]);
        if (originalItemLedger.error)
          throw new Error("Failed to fetch original item ledger entries");
        if (returnLinesVoid.error)
          throw new Error("Failed to fetch return order lines");

        const reversingItemLedger = (originalItemLedger.data ?? []).map(
          (entry) => ({
            postingDate: today,
            itemId: entry.itemId,
            quantity: -entry.quantity,
            locationId: entry.locationId,
            storageUnitId: entry.storageUnitId,
            entryType:
              entry.entryType === "Positive Adjmt."
                ? ("Negative Adjmt." as const)
                : ("Positive Adjmt." as const),
            documentType: "Sales Return Receipt" as const,
            documentId: entry.documentId,
            externalDocumentId: entry.externalDocumentId,
            trackedEntityId: entry.trackedEntityId,
            createdBy: userId,
            companyId
          })
        );

        const reversingJournalLines = originalJournalLines.map((line) => ({
          accountId: line.accountId,
          description: `VOID: ${line.description ?? ""}`,
          amount: -line.amount,
          quantity: line.quantity == null ? undefined : -line.quantity,
          documentType: line.documentType,
          documentId: line.documentId,
          externalDocumentId: line.externalDocumentId ?? undefined,
          documentLineReference: line.documentLineReference ?? undefined,
          journalLineReference: line.journalLineReference,
          companyId
        }));

        const receivedByLine = new Map<string, number>();
        for (const receiptLine of receiptLines.data ?? []) {
          if (!receiptLine.lineId) continue;
          const qty = Number(receiptLine.receivedQuantity ?? 0);
          receivedByLine.set(
            receiptLine.lineId,
            (receivedByLine.get(receiptLine.lineId) ?? 0) + qty
          );
        }

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted" && reversingJournalLines.length > 0
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await lockPostedReceipt(trx, companyId, receiptId);
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          await assertReceivedStockOnHand(
            trx,
            companyId,
            reversingItemLedger.map(toReversingRow)
          );
          // Refuse to void when this receipt's cost layers were already
          // (partially) consumed — the returned stock moved on (dispositioned,
          // sold, scrapped), so reversing the full receipt would drive stock
          // negative and double-count COGS. The remainder is a manual
          // inventory adjustment, not a void.
          const receiptLayers = await trx
            .selectFrom("costLedger")
            .select(["quantity", "remainingQuantity"])
            .where("documentId", "=", receiptId)
            .where("documentType", "=", "Sales Return Receipt")
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();
          const consumed = receiptLayers.some(
            (layer) =>
              Number(layer.quantity) > 0 &&
              Number(layer.remainingQuantity) < Number(layer.quantity)
          );
          if (consumed) {
            throw new InvalidInputError(
              "Cannot void: stock received on this return was already consumed. Correct the remainder with an inventory adjustment instead."
            );
          }

          if (reversingItemLedger.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(reversingItemLedger)
              .execute();
          }

          if (reversingJournalLines.length > 0) {
            const journalEntryId = await sequence.getNextSequence(
              trx,
              "journalEntry",
              companyId
            );
            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId,
                description: `VOID Sales Return Receipt ${receiptHeader.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Sales Return Receipt",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            await trx
              .insertInto("journalLine")
              .values(
                reversingJournalLines.map((line) => ({
                  ...line,
                  journalId: journalResult.id
                }))
              )
              .execute();
          }

          await trx
            .updateTable("costLedger")
            .set({ remainingQuantity: 0 })
            .where("documentId", "=", receiptId)
            .where("documentType", "=", "Sales Return Receipt")
            .where("companyId", "=", companyId)
            .execute();

          for await (const [lineId, received] of receivedByLine) {
            const line = returnLinesVoid.data?.find((l) => l.id === lineId);
            if (!line) continue;
            await trx
              .updateTable("salesReturnOrderLine")
              .set({
                quantityReceived: Math.max(
                  0,
                  Number(line.quantityReceived ?? 0) - received
                ),
                updatedBy: userId
              })
              .where("id", "=", lineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          const remainingLines = await trx
            .selectFrom("salesReturnOrderLine")
            .select(["quantity", "quantityReceived", "closedComplete"])
            .where("salesReturnOrderId", "=", salesReturnOrderId)
            .execute();
          // Derived status (mirrors getSalesReturnOrderStatus): a void that
          // drops received quantity below the authorized total returns the RMA
          // to To Receive; otherwise it stays Completed.
          const allReceived =
            remainingLines.length > 0 &&
            remainingLines.every(
              (l) =>
                l.closedComplete ||
                Number(l.quantityReceived) >= Number(l.quantity)
            );
          const returnStatus = allReceived
            ? ("Completed" as const)
            : ("To Receive" as const);
          await trx
            .updateTable("salesReturnOrder")
            .set({ status: returnStatus, updatedBy: userId })
            .where("id", "=", salesReturnOrderId)
            .where("companyId", "=", companyId)
            .execute();

          const voidActivity = await trx
            .insertInto("trackedActivity")
            .values({
              type: "Void Receipt",
              sourceDocument: "Receipt",
              sourceDocumentId: receiptId,
              sourceDocumentReadableId: receiptHeader.receiptId,
              attributes: {
                "Sales Return Order": salesReturnOrderId,
                Receipt: receiptId,
                Employee: userId
              },
              companyId,
              createdBy: userId,
              createdAt: today
            })
            .returning(["id"])
            .execute();
          const voidActivityId = voidActivity[0]?.id;

          for await (const entity of receiptLineTracking.data ?? []) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Consumed" })
              .where("id", "=", entity.id)
              .where("companyId", "=", companyId)
              .execute();

            if (voidActivityId) {
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: voidActivityId,
                  trackedEntityId: entity.id,
                  quantity: entity.quantity ?? 0,
                  companyId,
                  createdBy: userId,
                  createdAt: today
                })
                .execute();
            }
          }

          await trx
            .updateTable("receipt")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId
            })
            .where("id", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();
        });

        return { success: true };
      }

      const [originalItemLedger, originalJournalLines, purchaseOrderLinesVoid] =
        await inOrder([
          () =>
            many(db, "itemLedger", {
              documentId: receiptId,
              documentType: "Purchase Receipt",
              companyId
            }),
          () =>
            documentJournalLines(db, companyId, {
              documentId: receiptId,
              documentType: "Receipt"
            }),
          () =>
            many(db, "purchaseOrderLine", {
              purchaseOrderId: receiptHeader.sourceDocumentId
            })
        ]);

      if (originalItemLedger.error)
        throw new Error("Failed to fetch item ledger entries");
      if (purchaseOrderLinesVoid.error)
        throw new Error("Failed to fetch purchase order lines");

      const reversingItemLedger: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
        originalItemLedger.data.map((entry) => ({
          postingDate: today,
          itemId: entry.itemId,
          quantity: -entry.quantity,
          locationId: entry.locationId,
          storageUnitId: entry.storageUnitId,
          trackedEntityId: entry.trackedEntityId,
          entryType:
            entry.entryType === "Positive Adjmt."
              ? "Negative Adjmt."
              : entry.entryType === "Negative Adjmt."
                ? "Positive Adjmt."
                : entry.entryType,
          documentType: entry.documentType,
          documentId: entry.documentId,
          externalDocumentId: entry.externalDocumentId,
          createdBy: userId,
          companyId
        }));

      const reversingJournalLines: Omit<
        Database["public"]["Tables"]["journalLine"]["Insert"],
        "journalId"
      >[] = originalJournalLines.map((entry) => ({
        accountId: entry.accountId,
        accrual: entry.accrual,
        description: `VOID: ${entry.description}`,
        // A reversal is a sign flip of an already-posted value, which is
        // exact — no rounding to do.
        amount: -entry.amount,
        quantity: -entry.quantity,
        documentType: entry.documentType,
        documentId: entry.documentId,
        externalDocumentId: entry.externalDocumentId,
        documentLineReference: entry.documentLineReference,
        journalLineReference: entry.journalLineReference,
        companyId
      }));

      const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
        Record<string, Database["public"]["Tables"]["receiptLine"]["Row"][]>
      >((acc, receiptLine) => {
        if (receiptLine.lineId) {
          acc[receiptLine.lineId] = [
            ...(acc[receiptLine.lineId] ?? []),
            receiptLine
          ];
        }
        return acc;
      }, {});

      const purchaseOrderLineUpdatesVoid = purchaseOrderLinesVoid.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
        >
      >((acc, purchaseOrderLine) => {
        const receiptLinesForPoLine =
          receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
        if (
          receiptLinesForPoLine &&
          receiptLinesForPoLine.length > 0 &&
          purchaseOrderLine.purchaseQuantity &&
          purchaseOrderLine.purchaseQuantity > 0
        ) {
          const receivedQuantityInPurchaseUnit =
            receiptLinesForPoLine.reduce((sum, receiptLine) => {
              const safe =
                isNaN(receiptLine.receivedQuantity) ||
                receiptLine.receivedQuantity == null
                  ? 0
                  : receiptLine.receivedQuantity;
              return sum + safe;
            }, 0) / (receiptLinesForPoLine[0]!.conversionFactor ?? 1);

          const newQuantityReceived = Math.max(
            0,
            (purchaseOrderLine.quantityReceived ?? 0) -
              receivedQuantityInPurchaseUnit
          );

          const receivedComplete =
            newQuantityReceived >= purchaseOrderLine.purchaseQuantity;

          acc[purchaseOrderLine.id] = {
            quantityReceived: newQuantityReceived,
            receivedComplete
          };
        }
        return acc;
      }, {});

      // Reverse FA PO line received status on void
      const faPoLinesForVoid = purchaseOrderLinesVoid.data.filter(
        (pol) =>
          pol.purchaseOrderLineType === "Fixed Asset" &&
          pol.assetId &&
          pol.receivedComplete
      );

      // CIP cost rows this receipt wrote, summed per asset. Their presence is
      // the durable record that the posting went into Construction in
      // Progress, even if the asset has since been capitalized into a
      // depreciating class.
      const cipCostByAssetVoid = new Map<string, number>();
      if (faPoLinesForVoid.length > 0) {
        const cipCostRowsVoid = await many(
          db,
          "fixedAssetCipCost",
          { companyId, sourceDocumentId: receiptId },
          { columns: ["fixedAssetId", "amount"] }
        );
        if (cipCostRowsVoid.error)
          throw new Error("Failed to fetch fixed asset CIP costs");
        for (const row of cipCostRowsVoid.data) {
          cipCostByAssetVoid.set(
            row.fixedAssetId,
            (cipCostByAssetVoid.get(row.fixedAssetId) ?? 0) + Number(row.amount)
          );
        }
      }
      // Reduced acquisition cost per CIP asset, written inside the void transaction
      const cipAssetUpdatesVoid = new Map<string, number>();

      type VoidedAsset = Pick<
        Tables["fixedAsset"]["Row"],
        "id" | "acquisitionCost" | "status"
      > & {
        fixedAssetClass: Pick<
          Tables["fixedAssetClass"]["Row"],
          "isConstructionInProgress"
        > | null;
      };
      const voidedAssets: { data: VoidedAsset[] } =
        faPoLinesForVoid.length > 0
          ? await many<"fixedAsset", VoidedAsset>(
              db,
              "fixedAsset",
              {
                companyId,
                id: faPoLinesForVoid.map((line) => line.assetId!)
              },
              {
                columns: ["id", "acquisitionCost", "status"],
                embed: {
                  fixedAssetClass: {
                    table: "fixedAssetClass",
                    via: "fixedAssetClassId",
                    columns: ["isConstructionInProgress"]
                  }
                }
              }
            )
          : { data: [] };
      const voidedAssetById = new Map(
        voidedAssets.data.map((asset) => [asset.id, asset])
      );

      for (const faPoLine of faPoLinesForVoid) {
        const hasReceiptEntries = originalJournalLines.some(
          (jl) =>
            jl.documentLineReference ===
            journalReference.to.receipt(faPoLine.id)
        );

        if (hasReceiptEntries) {
          purchaseOrderLineUpdatesVoid[faPoLine.id] = {
            quantityReceived: 0,
            receivedComplete: false
          };

          const receiptCost = originalJournalLines
            .filter(
              (jl) =>
                jl.documentLineReference ===
                  journalReference.to.receipt(faPoLine.id) &&
                (jl.amount ?? 0) > 0
            )
            .reduce((sum, jl) => sum + Math.abs(jl.amount ?? 0), 0);

          const asset = voidedAssetById.get(faPoLine.assetId!);
          if (asset) {
            fixedAssetWrites.overlay(faPoLine.assetId!, asset);
            const isConstructionInProgress =
              cipCostByAssetVoid.has(faPoLine.assetId!) ||
              Boolean(asset.fixedAssetClass?.isConstructionInProgress);
            if (isConstructionInProgress) {
              if (asset.status !== "Under Construction") {
                throw new InvalidInputError(
                  "Asset was capitalized; reverse the capitalization first"
                );
              }
              const cipCost = cipCostByAssetVoid.get(faPoLine.assetId!);
              if (cipCost !== undefined) {
                cipAssetUpdatesVoid.set(
                  faPoLine.assetId!,
                  Math.max(0, round(Number(asset.acquisitionCost) - cipCost))
                );
                continue;
              }
              // No CIP cost row for this receipt (posted before the class
              // was a CIP class): the cost still came in through this
              // receipt, so back it out like any other asset below rather
              // than leave it on the asset.
            }

            const newAcquisitionCost = Math.max(
              0,
              Number(asset.acquisitionCost) - receiptCost
            );
            const faUpdate: Database["public"]["Tables"]["fixedAsset"]["Update"] =
              {
                acquisitionCost: newAcquisitionCost,
                updatedBy: userId
              };
            if (newAcquisitionCost === 0 && asset.status === "Active") {
              faUpdate.status = "Draft";
              faUpdate.acquisitionDate = null;
              faUpdate.depreciationStartDate = null;
            }
            fixedAssetWrites.patch(faPoLine.assetId!, faUpdate);
          }
        }
      }

      const projectedPurchaseOrderLines = purchaseOrderLinesVoid.data.map(
        (line) => {
          const update = purchaseOrderLineUpdatesVoid[line.id];
          if (update && update.quantityReceived !== undefined) {
            return {
              ...line,
              quantityReceived: update.quantityReceived
            };
          }
          return line;
        }
      );

      const areAllLinesInvoicedProjected = projectedPurchaseOrderLines.every(
        (line) => {
          if (line.purchaseOrderLineType === "Comment") return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityInvoiced ?? 0) >= target;
        }
      );

      const areAllLinesReceivedProjected = projectedPurchaseOrderLines.every(
        (line) => {
          if (
            line.purchaseOrderLineType === "Comment" ||
            line.purchaseOrderLineType === "G/L Account" ||
            line.purchaseOrderLineType === "Service"
          )
            return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityReceived ?? 0) >= target;
        }
      );

      let purchaseOrderStatusVoid: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
        "To Receive and Invoice";
      if (areAllLinesInvoicedProjected && areAllLinesReceivedProjected) {
        purchaseOrderStatusVoid = "Completed";
      } else if (areAllLinesInvoicedProjected) {
        purchaseOrderStatusVoid = "To Receive";
      } else if (areAllLinesReceivedProjected) {
        purchaseOrderStatusVoid = "To Invoice";
      }

      // The receipt's serials and batches were never received, so the void
      // drains them to zero: they leave every on-hand list and no picker
      // offers them. Leaving them at their received quantity made them
      // Available again (even one On Hold for inspection), pickable on a
      // shipment or job with no stock behind them. Scrapped/Rejected are
      // quality markers, already off on-hand, and survive the void at zero
      // (as update_receipt_line_batch_tracking keeps them); everything else
      // is Consumed. Not settleQuantity: its drain turns Rejected into
      // Consumed.
      const trackedEntitiesVoid = (receiptLineTracking.data ?? []).map(
        (trackedEntity) => ({
          id: trackedEntity.id,
          voidedQuantity: Number(trackedEntity.quantity ?? 0),
          update: {
            quantity: 0,
            status:
              trackedEntity.status === "Scrapped" ||
              trackedEntity.status === "Rejected"
                ? trackedEntity.status
                : ("Consumed" as const)
          }
        })
      );

      // A Provisional journal has no accounting period.
      const accountingPeriodId =
        postingStatus === "Posted"
          ? await getCurrentAccountingPeriod(companyId, db, today)
          : null;

      await db.transaction().execute(async (trx) => {
        await lockPostedReceipt(trx, companyId, receiptId);
        await assertPostingStatusUnchanged(trx, companyId, postingStatus);
        await assertNoRejectedUntrackedLot(trx, companyId, receiptId);
        await assertReceivedStockOnHand(
          trx,
          companyId,
          reversingItemLedger.map(toReversingRow)
        );
        // The cost layers this receipt wrote. Without this, a voided
        // receipt's layer stayed open and later issues consumed stock that
        // was never there.
        const receiptCostLedger = await trx
          .selectFrom("costLedger")
          .select([
            "id",
            "itemId",
            "quantity",
            "remainingQuantity",
            "cost",
            "supplierId",
            "trackedEntityId"
          ])
          .where("documentId", "=", receiptId)
          .where("documentType", "=", "Purchase Receipt")
          .where("adjustment", "=", false)
          .where("companyId", "=", companyId)
          .forUpdate()
          .execute();
        const costLedgerPlan = planReceiptVoidCostLedger(
          receiptCostLedger.map((row) => ({
            ...row,
            quantity: Number(row.quantity),
            remainingQuantity: Number(row.remainingQuantity),
            cost: Number(row.cost)
          }))
        );
        if (costLedgerPlan.consumed) {
          throw new InvalidInputError(
            "Cannot void: stock received on this receipt was already consumed. Correct the remainder with an inventory adjustment instead."
          );
        }
        if (costLedgerPlan.layerIdsToClose.length > 0) {
          await trx
            .updateTable("costLedger")
            .set({ remainingQuantity: 0 })
            .where("id", "in", costLedgerPlan.layerIdsToClose)
            .where("companyId", "=", companyId)
            .execute();
        }
        if (costLedgerPlan.restoringLayers.length > 0) {
          await trx
            .insertInto("costLedger")
            .values(
              costLedgerPlan.restoringLayers.map((layer) => ({
                itemLedgerType: "Purchase" as const,
                costLedgerType: "Direct Cost" as const,
                adjustment: false,
                documentType: "Purchase Receipt" as const,
                documentId: receiptId,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                itemId: layer.itemId,
                trackedEntityId: layer.trackedEntityId,
                quantity: layer.quantity,
                cost: layer.cost,
                remainingQuantity: layer.quantity,
                supplierId: layer.supplierId,
                companyId,
                postingDate: today
              }))
            )
            .execute();
        }

        await fixedAssetWrites.apply(trx, companyId);
        for await (const [purchaseOrderLineId, update] of Object.entries(
          purchaseOrderLineUpdatesVoid
        )) {
          await trx
            .updateTable("purchaseOrderLine")
            .set(update)
            .where("id", "=", purchaseOrderLineId)
            .where("companyId", "=", companyId)
            .execute();
        }

        await trx
          .updateTable("purchaseOrder")
          .set({ status: purchaseOrderStatusVoid })
          .where("id", "=", receiptHeader.sourceDocumentId!)
          .where("companyId", "=", companyId)
          .execute();

        for (const [assetId, acquisitionCost] of cipAssetUpdatesVoid) {
          await trx
            .deleteFrom("fixedAssetCipCost")
            .where("companyId", "=", companyId)
            .where("sourceDocumentId", "=", receiptId)
            .where("fixedAssetId", "=", assetId)
            .execute();
          await trx
            .updateTable("fixedAsset")
            .set({ acquisitionCost, updatedBy: userId })
            .where("id", "=", assetId)
            .where("companyId", "=", companyId)
            .execute();
        }

        if (reversingJournalLines.length > 0) {
          const voidJournalEntryId = await sequence.getNextSequence(
            trx,
            "journalEntry",
            companyId
          );

          const journal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: voidJournalEntryId,
              accountingPeriodId,
              description: `VOID Purchase Receipt ${receiptHeader.receiptId}`,
              postingDate: today,
              companyId,
              sourceType: "Purchase Receipt",
              status: postingStatus,
              postedAt: datetime.timestamp(),
              postedBy: userId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          const journalId = journal[0]!.id;
          if (!journalId) throw new Error("Failed to insert journal");

          await trx
            .insertInto("journalLine")
            .values(
              reversingJournalLines.map((journalLine) => ({
                ...journalLine,
                journalId
              }))
            )
            .execute();
        }

        if (reversingItemLedger.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(reversingItemLedger)
            .execute();
        }

        if (trackedEntitiesVoid.length > 0) {
          const voidActivity = await trx
            .insertInto("trackedActivity")
            .values({
              type: "Void Receipt",
              sourceDocument: "Receipt",
              sourceDocumentId: receiptId,
              sourceDocumentReadableId: receiptHeader.receiptId,
              attributes: {
                "Purchase Order": receiptHeader.sourceDocumentId,
                Receipt: receiptId,
                Employee: userId
              },
              companyId,
              createdBy: userId,
              createdAt: today
            })
            .returning(["id"])
            .execute();

          const voidActivityId = voidActivity[0]!.id;

          for await (const {
            id,
            voidedQuantity,
            update
          } of trackedEntitiesVoid) {
            await trx
              .updateTable("trackedEntity")
              .set(update)
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();

            if (voidActivityId) {
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: voidActivityId,
                  trackedEntityId: id,
                  quantity: voidedQuantity,
                  companyId,
                  createdBy: userId,
                  createdAt: today
                })
                .execute();
            }
          }
        }

        await trx
          .updateTable("receipt")
          .set({
            status: "Voided",
            updatedAt: today,
            updatedBy: userId
          })
          .where("id", "=", receiptId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return { success: true };
    }

    if (receiptHeader.status === "Voided") {
      throw new InvalidInputError("Cannot post a voided receipt");
    }

    switch (receiptHeader.sourceDocument) {
      case "Purchase Order": {
        if (!receiptHeader.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [purchaseOrder, purchaseOrderLines, purchaseOrderDelivery] =
          await inOrder([
            () =>
              single(db, "purchaseOrder", {
                companyId,
                id: receiptHeader.sourceDocumentId
              }),
            () =>
              many(db, "purchaseOrderLine", {
                companyId,
                purchaseOrderId: receiptHeader.sourceDocumentId
              }),
            () =>
              single(
                db,
                "purchaseOrderDelivery",
                { companyId, id: receiptHeader.sourceDocumentId },
                { columns: ["supplierShippingCost"] }
              )
          ]);
        if (purchaseOrder.error)
          throw new Error("Failed to fetch purchase order");
        if (purchaseOrderLines.error)
          throw new Error("Failed to fetch purchase order lines");
        if (purchaseOrderDelivery.error)
          throw new Error("Failed to fetch purchase order delivery");

        // supplierShippingCost is a supplier-currency amount and the order's
        // exchangeRate is foreign-units-per-base, so supplier -> base is
        // DIVIDE. It is mixed into base line costs below and becomes the
        // cost-ledger layer value, so multiplying inflated every foreign
        // receipt's capitalised cost by the rate squared. Matches
        // post-purchase-invoice (supplierShippingCost) and migration
        // 20260702061504, which fixed the same expression in the
        // purchaseOrders/purchaseInvoices views.
        const shippingCost =
          (purchaseOrderDelivery.data?.supplierShippingCost ?? 0) /
          (purchaseOrder.data?.exchangeRate || 1);

        const supplier = await single(db, "supplier", {
          id: purchaseOrder.data.supplierId,
          companyId
        });
        if (supplier.error) throw new Error("Failed to fetch supplier");

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        // Cost layers created by this receipt (the receipt is the sole creator
        // of purchase layers; the invoice adjusts them later). Rows flagged
        // isInvoiceFirst carry their PO line so the flush can exclude quantity
        // already represented by a legacy invoice-created layer (documents
        // posted before receipt-created layers shipped).
        const costLedgerInserts: (Database["public"]["Tables"]["costLedger"]["Insert"] & {
          isInvoiceFirst?: boolean;
          poLineId?: string;
        })[] = [];
        // Negative receipt lines (by index) consume layers at layer cost
        // inside the transaction (calculateCOGS), and book what they
        // relieved. The PO cost is used when no layers yield a cost.
        const negativeReceiptConsumptions: {
          index: number;
          itemId: string;
          quantity: number;
        }[] = [];

        const isOutsideProcessing =
          purchaseOrder.data.purchaseOrderType === "Outside Processing";

        const processIdByJobOperationId = new Map<string, string>();
        if (isOutsideProcessing) {
          const jobOpIds = purchaseOrderLines.data
            .map((pol) => pol.jobOperationId)
            .filter((id): id is string => !!id);
          if (jobOpIds.length > 0) {
            const jobOps = await many(
              db,
              "jobOperation",
              { companyId, id: jobOpIds },
              { columns: ["id", "processId"] }
            );
            for (const op of jobOps.data ?? []) {
              if (op.processId)
                processIdByJobOperationId.set(op.id, op.processId);
            }
          }
        }

        // A line received at 0 must not touch its PO line or outside processing operation.
        const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
          Record<string, Database["public"]["Tables"]["receiptLine"]["Row"][]>
        >((acc, receiptLine) => {
          if (
            receiptLine.lineId &&
            Number(receiptLine.receivedQuantity) !== 0
          ) {
            acc[receiptLine.lineId] = [
              ...(acc[receiptLine.lineId] ?? []),
              receiptLine
            ];
          }
          return acc;
        }, {});

        // Build one inspection lot per receiptLine whose item has a Receipt-usage
        // inspection plan (a document assignment). The assigned document is the
        // plan for the receipt; without one, no lot is created. Compute the
        // sampling plan snapshot from the company's chosen standard and the
        // document's default plan (or "Inspect All" when the document has none).
        const inspectionInserts: Array<Record<string, any>> = [];
        // Per-feature resolved plans, keyed by receiptLineId until the lot ids
        // exist (they are joined after the insert returns ids).
        type InspectionSamplingPlanInsert = {
          inspectionFeatureId: string;
          sampleSize: number;
          acceptanceNumber: number;
          rejectionNumber: number;
          codeLetter: string | null;
          companyId: string;
          createdBy: string;
        };
        const samplingPlanInsertsByReceiptLineId = new Map<
          string,
          Array<InspectionSamplingPlanInsert>
        >();
        for (const receiptLine of receiptLines.data ?? []) {
          if (!receiptLine.itemId) continue;

          // An item is inspected at receipt when it has a Receipt-usage
          // inspection plan (document assignment); without one, no lot.
          const assignedDocumentId =
            assignmentByItemId.get(receiptLine.itemId) ?? null;
          if (!assignedDocumentId) continue;

          const safeReceivedQuantity =
            isNaN(receiptLine.receivedQuantity as any) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          if (safeReceivedQuantity <= 0) continue;

          const documentDefault = assignedDocumentId
            ? (documentDefaultByDocumentId.get(assignedDocumentId) ?? null)
            : null;

          const plan = documentDefault ?? {
            type: "All",
            sampleSize: null,
            percentage: null,
            aql: null,
            inspectionLevel: "II",
            severity: "Normal"
          };

          const snapshot = resolveSamplingPlan(
            plan,
            safeReceivedQuantity,
            samplingStandard
          );

          const documentFeatures = assignedDocumentId
            ? (inspectionFeaturesByDocumentId.get(assignedDocumentId) ?? [])
            : [];
          const featurePlans = documentFeatures.map((feature) => ({
            inspectionFeatureId: feature.id,
            resolved: resolveFeatureSamplingPlan(
              feature,
              documentDefault,
              safeReceivedQuantity,
              samplingStandard
            )
          }));
          if (featurePlans.length > 0) {
            samplingPlanInsertsByReceiptLineId.set(
              receiptLine.id,
              featurePlans.map((p) => ({
                inspectionFeatureId: p.inspectionFeatureId,
                sampleSize: p.resolved.sampleSize,
                acceptanceNumber: p.resolved.acceptance,
                rejectionNumber: p.resolved.rejection,
                codeLetter: p.resolved.codeLetter,
                companyId,
                createdBy: userId
              }))
            );
          }

          inspectionInserts.push({
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            sourceDocumentLineId: receiptLine.id,
            sourceDocumentReadableId: receiptHeader.receiptId ?? null,
            itemId: receiptLine.itemId,
            supplierId: purchaseOrder.data.supplierId ?? null,
            lotSize: safeReceivedQuantity,
            samplingStandard,
            samplingPlanType: plan.type,
            // With a document attached, the lot-level sample size is the max
            // across the per-feature plans (SAP-style); Ac/Re remain the
            // item-plan fallback numbers used by the no-document flow.
            sampleSize:
              featurePlans.length > 0
                ? Math.max(...featurePlans.map((p) => p.resolved.sampleSize))
                : snapshot.sampleSize,
            acceptanceNumber: snapshot.acceptance,
            rejectionNumber: snapshot.rejection,
            aql: plan.aql ?? null,
            inspectionLevel: plan.inspectionLevel ?? null,
            severity: plan.severity ?? null,
            codeLetter: snapshot.codeLetter,
            inspectionDocumentId: assignedDocumentId,
            status: "Pending",
            companyId,
            createdBy: userId
          });
        }

        // Tracked entities for items with a Receipt-usage inspection plan stay
        // On Hold after posting (they are released individually by the sample
        // inspection or en masse by lot disposition). Everything else flips to
        // Available.
        const trackedEntityUpdates =
          receiptLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, itemTracking) => {
            const receiptLine = receiptLines.data?.find(
              (receiptLine) =>
                receiptLine.id ===
                (itemTracking.attributes as TrackedEntityAttributes)?.[
                  "Receipt Line"
                ]?.toString()
            );

            const safeReceivedQuantity =
              // @ts-ignore - chillllllll
              isNaN(receiptLine?.receivedQuantity) ||
              receiptLine?.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            // A line received at 0 writes no ledger row, so its entities stay as they are.
            if (receiptLine && safeReceivedQuantity === 0) return acc;

            const quantity = receiptLine?.requiresSerialTracking
              ? 1
              : safeReceivedQuantity || itemTracking.quantity;

            const requiresInspection = receiptLine?.itemId
              ? assignmentByItemId.has(receiptLine.itemId)
              : false;

            acc[itemTracking.id] = {
              status: requiresInspection ? "On Hold" : "Available",
              quantity: quantity
            };

            return acc;
          }, {}) ?? {};

        const jobOperationUpdates = isOutsideProcessing
          ? purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["jobOperation"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const receiptLines =
                receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                receiptLines &&
                receiptLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0 &&
                purchaseOrderLine.jobOperationId
              ) {
                const recivedQuantityInPurchaseUnit =
                  receiptLines.reduce((acc, receiptLine) => {
                    const safeReceivedQuantity =
                      isNaN(receiptLine.receivedQuantity) ||
                      receiptLine.receivedQuantity == null
                        ? 0
                        : receiptLine.receivedQuantity;
                    return acc + safeReceivedQuantity;
                  }, 0) / (receiptLines[0]!.conversionFactor ?? 1);

                const receivedComplete =
                  purchaseOrderLine.receivedComplete ||
                  recivedQuantityInPurchaseUnit >=
                    (purchaseOrderLine.quantityToReceive ??
                      purchaseOrderLine.purchaseQuantity);

                return {
                  ...acc,
                  [purchaseOrderLine.jobOperationId]: {
                    status: receivedComplete ? "Done" : "In Progress"
                  }
                };
              }

              return acc;
            }, {})
          : {};

        const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
          >
        >((acc, purchaseOrderLine) => {
          const receiptLines =
            receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
          if (
            receiptLines &&
            receiptLines.length > 0 &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const recivedQuantityInPurchaseUnit =
              receiptLines.reduce((acc, receiptLine) => {
                const safeReceivedQuantity =
                  isNaN(receiptLine.receivedQuantity) ||
                  receiptLine.receivedQuantity == null
                    ? 0
                    : receiptLine.receivedQuantity;
                return acc + safeReceivedQuantity;
              }, 0) / (receiptLines[0]!.conversionFactor ?? 1);

            const newQuantityReceived =
              (purchaseOrderLine.quantityReceived ?? 0) +
              recivedQuantityInPurchaseUnit;

            const receivedComplete =
              purchaseOrderLine.receivedComplete ||
              recivedQuantityInPurchaseUnit >=
                (purchaseOrderLine.quantityToReceive ??
                  purchaseOrderLine.purchaseQuantity);

            return {
              ...acc,
              [purchaseOrderLine.id]: {
                quantityReceived: newQuantityReceived,
                receivedComplete,
                receivedDate: today
              }
            };
          }

          return acc;
        }, {});

        // Get account defaults (once for all lines) for the journal entries
        const accountDefaults = await getDefaultPostingGroup(db, companyId);
        if (accountDefaults.error || !accountDefaults.data) {
          throw new Error("Error getting account defaults");
        }

        // Detect invoice-first scenario: PO lines where qty invoiced > qty received
        const invoiceFirstQtyByPoLine = new Map<string, number>();
        const accrualUnitCostByPoLine = new Map<string, number>();
        const receivedBeforeInvUnitsByPoLine = new Map<string, number>();

        for (const pol of purchaseOrderLines.data) {
          const invoicedInInventoryUnit =
            (pol.quantityInvoiced ?? 0) * (pol.conversionFactor ?? 1);
          const receivedInInventoryUnit =
            (pol.quantityReceived ?? 0) * (pol.conversionFactor ?? 1);
          const invoiceFirstQty = Math.max(
            0,
            invoicedInInventoryUnit - receivedInInventoryUnit
          );
          if (invoiceFirstQty > 0) {
            invoiceFirstQtyByPoLine.set(pol.id, invoiceFirstQty);
            receivedBeforeInvUnitsByPoLine.set(pol.id, receivedInInventoryUnit);
          }
        }

        if (invoiceFirstQtyByPoLine.size > 0) {
          const accrualDocRefs = [...invoiceFirstQtyByPoLine.keys()].map((id) =>
            journalReference.to.purchaseInvoice(id)
          );

          const accrualJournalLines = await documentJournalLines(
            db,
            companyId,
            {
              documentLineReference: accrualDocRefs,
              accrual: true
            }
          );

          // GR/IR debit entries have non-positive amounts (debit on a
          // liability; zero-priced invoices accrue at exactly 0). Matching
          // the GR/IR account keeps the paired AP credit lines, which are
          // also 0 on zero-priced invoices, out of the quantity sum.
          const accrualCostByPoLine: Record<
            string,
            { totalCost: number; totalQty: number }
          > = {};
          for (const jl of accrualJournalLines) {
            if (
              (jl.amount ?? 0) <= 0 &&
              (jl.quantity ?? 0) > 0 &&
              jl.accountId ===
                accountDefaults.data.goodsReceivedNotInvoicedAccount
            ) {
              const [, poLineId] = (jl.documentLineReference ?? "").split(
                ":"
              ) as [string, string];
              if (!accrualCostByPoLine[poLineId]) {
                accrualCostByPoLine[poLineId] = {
                  totalCost: 0,
                  totalQty: 0
                };
              }
              accrualCostByPoLine[poLineId].totalCost += Math.abs(
                jl.amount ?? 0
              );
              accrualCostByPoLine[poLineId].totalQty += jl.quantity ?? 0;
            }
          }

          for (const [poLineId, info] of Object.entries(accrualCostByPoLine)) {
            if (info.totalQty > 0) {
              accrualUnitCostByPoLine.set(
                poLineId,
                info.totalCost / info.totalQty
              );
            }
          }

          // Units invoiced before receipt with no accrual to clear stay at
          // PO cost, so GR/IR keeps the difference to the invoice's cost.
          // A service or fixed asset invoice accrues nothing on GR/IR.
          const unaccrued = [...invoiceFirstQtyByPoLine.entries()].filter(
            ([poLineId]) => {
              const lineType = purchaseOrderLines.data.find(
                (pol) => pol.id === poLineId
              )?.purchaseOrderLineType;
              return (
                !accrualUnitCostByPoLine.has(poLineId) &&
                lineType !== "Service" &&
                lineType !== "Fixed Asset" &&
                lineType !== "G/L Account"
              );
            }
          );
          if (unaccrued.length > 0) {
            logger.warn(
              "Units invoiced before receipt have no GR/IR accrual; the receipt costs them at PO cost",
              {
                companyId,
                receiptId,
                purchaseOrderLines: unaccrued.map(
                  ([purchaseOrderLineId, quantity]) => ({
                    purchaseOrderLineId,
                    quantity
                  })
                )
              }
            );
          }
        }

        const itemById = new Map(items.data.map((item) => [item.id, item]));
        const itemPostingGroupByItem = new Map(
          itemCosts.data.map((cost) => [cost.itemId, cost.itemPostingGroupId])
        );
        const purchaseOrderLineById = new Map(
          purchaseOrderLines.data.map((line) => [line.id, line])
        );
        const receiptJournalLines: PurchaseReceiptLine[] =
          receiptLines.data.map((receiptLine) => {
            const item = receiptLine.itemId
              ? itemById.get(receiptLine.itemId)
              : undefined;
            const jobOperationId = receiptLine.lineId
              ? purchaseOrderLineById.get(receiptLine.lineId)?.jobOperationId
              : null;
            return {
              purchaseOrderLineId: receiptLine.lineId,
              itemId: receiptLine.itemId,
              quantity:
                isNaN(receiptLine.receivedQuantity) ||
                receiptLine.receivedQuantity == null
                  ? 0
                  : receiptLine.receivedQuantity,
              unitPrice: receiptLine.unitPrice,
              itemTrackingType: item?.itemTrackingType,
              replenishmentSystem: item?.replenishmentSystem,
              itemPostingGroupId: receiptLine.itemId
                ? (itemPostingGroupByItem.get(receiptLine.itemId) ?? null)
                : null,
              locationId: receiptLine.locationId ?? null,
              processId: jobOperationId
                ? (processIdByJobOperationId.get(jobOperationId) ?? null)
                : null
            };
          });
        // Line cost at PO price + proportional shipping. The portion of a
        // line invoiced before receipt is valued at the accrual (invoice)
        // unit cost, so the invoice's GR/IR accrual clears exactly — no
        // PPV. The remainder stays at PO cost until its invoice adjusts it.
        const receiptLineCosts = purchaseReceiptLineCosts(receiptJournalLines, {
          shippingCost,
          isOutsideProcessing,
          invoiceFirst: {
            quantity: invoiceFirstQtyByPoLine,
            unitCost: accrualUnitCostByPoLine
          }
        });

        for (const [index, receiptLine] of receiptLines.data.entries()) {
          const {
            quantity: receivedQuantity,
            createsLayers,
            invoiceFirstQuantity: invoiceFirstQty,
            invoiceFirstCost: invoiceFirstPortionCost,
            normalQuantity: normalQty,
            normalCost: normalPortionCost
          } = receiptLineCosts[index]!;
          if (receivedQuantity === 0) continue;

          const itemTrackingType =
            receiptJournalLines[index]!.itemTrackingType ?? "Inventory";
          const isNegativeReceipt = receivedQuantity < 0;
          const poLineId = receiptLine.lineId;

          if (createsLayers && isNegativeReceipt) {
            negativeReceiptConsumptions.push({
              index,
              itemId: receiptLine.itemId!,
              quantity: Math.abs(receivedQuantity)
            });
          }

          // Cost layers: the receipt is the sole creator of purchase layers.
          // The invoice later adjusts them via appliesToCostLedgerId children.
          if (createsLayers && !isNegativeReceipt) {
            if (invoiceFirstQty > 0) {
              costLedgerInserts.push({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Purchase Receipt",
                documentId: receiptHeader.id ?? undefined,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                itemId: receiptLine.itemId,
                quantity: round(invoiceFirstQty),
                nominalCost: round(
                  invoiceFirstQty * (receiptLine.unitPrice ?? 0)
                ),
                cost: round(invoiceFirstPortionCost),
                remainingQuantity: round(invoiceFirstQty),
                supplierId: purchaseOrder.data?.supplierId ?? undefined,
                companyId,
                postingDate: today,
                isInvoiceFirst: true,
                poLineId: poLineId ?? undefined
              });
            }
            if (normalQty > 0) {
              costLedgerInserts.push({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Purchase Receipt",
                documentId: receiptHeader.id ?? undefined,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                itemId: receiptLine.itemId,
                quantity: round(normalQty),
                nominalCost: round(normalQty * (receiptLine.unitPrice ?? 0)),
                cost: round(normalPortionCost),
                remainingQuantity: round(normalQty),
                supplierId: purchaseOrder.data?.supplierId ?? undefined,
                companyId,
                postingDate: today
              });
            }
          }

          if (itemTrackingType === "Inventory" && !isOutsideProcessing) {
            // For inventory entries, use the appropriate entry type based on quantity sign
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: round(receivedQuantity),
              locationId: receiptLine.locationId,
              storageUnitId: receiptLine.storageUnitId,
              entryType,
              documentType: "Purchase Receipt",
              documentId: receiptHeader.id ?? undefined,
              externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId
            });
          }

          if (receiptLine.requiresBatchTracking && !isOutsideProcessing) {
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: round(receivedQuantity),
              locationId: receiptLine.locationId,
              storageUnitId: receiptLine.storageUnitId,
              entryType,
              documentType: "Purchase Receipt",
              documentId: receiptHeader.id ?? undefined,
              trackedEntityId: receiptLineTracking.data?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line"] === receiptLine.id
              )?.id,
              externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId
            });
          }

          if (receiptLine.requiresSerialTracking && !isOutsideProcessing) {
            const lineTracking = receiptLineTracking.data?.filter(
              (tracking) =>
                (tracking.attributes as TrackedEntityAttributes | undefined)?.[
                  "Receipt Line"
                ] === receiptLine.id
            );

            const safeReceiptLineQuantity =
              isNaN(receiptLine.receivedQuantity) ||
              receiptLine.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            const absReceivedQuantity = Math.abs(safeReceiptLineQuantity);
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";
            const quantityPerEntry = receivedQuantity < 0 ? -1 : 1;

            for (let i = 0; i < absReceivedQuantity; i++) {
              const trackingWithIndex = lineTracking?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line Index"] === i
              );

              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: round(quantityPerEntry),
                locationId: receiptLine.locationId,
                storageUnitId: receiptLine.storageUnitId,
                entryType,
                documentType: "Purchase Receipt",
                documentId: receiptHeader.id ?? undefined,
                trackedEntityId: trackingWithIndex?.id,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId
              });
            }
          }
        }

        // Process Fixed Asset PO lines (no receipt lines — handled directly from PO)
        const { data: receiptFaLines } = await many(
          db,
          "receiptFixedAssetLine",
          { receiptId, received: true, companyId },
          { columns: ["id", "purchaseOrderLineId", "serialNumber"] }
        );
        const poFaLines = (receiptFaLines ?? []).filter(
          (r): r is typeof r & { purchaseOrderLineId: string } =>
            r.purchaseOrderLineId !== null
        );
        const receivedFaPoLineIds = new Set(
          poFaLines.map((r) => r.purchaseOrderLineId)
        );
        const faSerialNumbers = new Map(
          poFaLines.map((r) => [r.purchaseOrderLineId, r.serialNumber])
        );
        const faReceiptLineIds = new Map<string, string>();
        for (const r of poFaLines) {
          faReceiptLineIds.set(r.purchaseOrderLineId, r.id);
        }
        // A Construction in Progress asset records every posting that adds to
        // its acquisition cost as a CIP cost row. Written inside the
        // transaction, after the journal, so it can carry the journal id.
        const cipCostInserts: Omit<
          Database["public"]["Tables"]["fixedAssetCipCost"]["Insert"],
          "journalId"
        >[] = [];

        const faPurchaseOrderLines = purchaseOrderLines.data.filter(
          (pol) =>
            pol.purchaseOrderLineType === "Fixed Asset" &&
            pol.assetId &&
            !pol.receivedComplete &&
            pol.purchaseQuantity &&
            pol.purchaseQuantity > 0 &&
            receivedFaPoLineIds.has(pol.id)
        );

        const fixedAssetJournalLines: FixedAssetReceiptLine[] = [];
        type ReceivedAsset = Pick<
          Tables["fixedAsset"]["Row"],
          | "id"
          | "status"
          | "acquisitionDate"
          | "depreciationStartDate"
          | "acquisitionCost"
          | "locationId"
          | "fixedAssetClassId"
        > & {
          fixedAssetClass: Pick<
            Tables["fixedAssetClass"]["Row"],
            "assetAccountId" | "isConstructionInProgress"
          > | null;
        };
        const faAssets: { data: ReceivedAsset[] } =
          faPurchaseOrderLines.length > 0
            ? await many<"fixedAsset", ReceivedAsset>(
                db,
                "fixedAsset",
                {
                  companyId,
                  id: faPurchaseOrderLines.map((line) => line.assetId!)
                },
                {
                  columns: [
                    "id",
                    "status",
                    "acquisitionDate",
                    "depreciationStartDate",
                    "acquisitionCost",
                    "locationId",
                    "fixedAssetClassId"
                  ],
                  embed: {
                    fixedAssetClass: {
                      table: "fixedAssetClass",
                      via: "fixedAssetClassId",
                      columns: ["assetAccountId", "isConstructionInProgress"]
                    }
                  }
                }
              )
            : { data: [] };
        const faAssetById = new Map(
          faAssets.data.map((asset) => [asset.id, asset])
        );

        for (const faPoLine of faPurchaseOrderLines) {
          const quantity = faPoLine.purchaseQuantity ?? 1;
          const unitPrice = faPoLine.unitPrice ?? 0;
          const cost = quantity * unitPrice;

          const asset = faAssetById.get(faPoLine.assetId!);
          if (!asset) throw new Error("Failed to fetch fixed asset");
          fixedAssetWrites.overlay(faPoLine.assetId!, asset);

          const isConstructionInProgress = Boolean(
            asset.fixedAssetClass?.isConstructionInProgress
          );

          fixedAssetJournalLines.push({
            purchaseOrderLineId: faPoLine.id,
            quantity,
            cost,
            assetAccountId: asset.fixedAssetClass!.assetAccountId,
            fixedAssetClassId: asset.fixedAssetClassId ?? null,
            locationId:
              faPoLine.locationId ??
              receiptHeader.locationId ??
              asset.locationId ??
              null
          });

          const updateData: Database["public"]["Tables"]["fixedAsset"]["Update"] =
            {
              acquisitionCost: (Number(asset.acquisitionCost) ?? 0) + cost,
              updatedBy: userId
            };
          if (!asset.acquisitionDate) {
            updateData.acquisitionDate = today;
          }
          // A CIP asset does not depreciate until it is capitalized, so its
          // depreciation start date stays null and it goes Under Construction.
          if (!isConstructionInProgress && !asset.depreciationStartDate) {
            updateData.depreciationStartDate = today;
          }
          if (asset.status === "Draft") {
            updateData.status = isConstructionInProgress
              ? "Under Construction"
              : "Active";
          }

          const serialNumber = faSerialNumbers.get(faPoLine.id!);
          if (serialNumber) {
            updateData.serialNumber = serialNumber;
          }

          const faLineLocationId =
            faPoLine.locationId ?? receiptHeader.locationId;
          if (faLineLocationId) {
            updateData.locationId = faLineLocationId;
          }

          fixedAssetWrites.patch(faPoLine.assetId!, updateData);

          if (isConstructionInProgress) {
            cipCostInserts.push({
              fixedAssetId: faPoLine.assetId!,
              sourceType: "Receipt",
              sourceDocumentId: receiptId,
              sourceDocumentLineId: faReceiptLineIds.get(faPoLine.id!) ?? null,
              amount: round(cost),
              costDate: today,
              companyId,
              createdBy: userId
            });
          }

          purchaseOrderLineUpdates[faPoLine.id!] = {
            quantityReceived: faPoLine.purchaseQuantity,
            receivedComplete: true,
            receivedDate: today
          };
        }

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted"
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          await fixedAssetWrites.apply(trx, companyId);
          // Negative receipts: consume layers at layer cost (FIFO/LIFO with
          // adjustment children), and the journal books what was relieved so
          // the GL credit matches what actually left the subledger.
          const relievedCostByLine = new Map<number, number>();
          for (const consumption of negativeReceiptConsumptions) {
            const cogsResult = await calculateCOGS(trx, {
              itemId: consumption.itemId,
              quantity: consumption.quantity,
              companyId
            });
            // A consumed layer's total is authoritative even at zero or
            // negative (free goods, credit-adjusted layers): the GL credit
            // must match the value actually relieved from the subledger. The
            // PO-cost fallback applies only when nothing was consumed and no
            // cost basis was found.
            const consumedCost =
              cogsResult.layersConsumed.length > 0 || cogsResult.totalCost > 0
                ? cogsResult.totalCost
                : receiptLineCosts[consumption.index]!.cost;
            relievedCostByLine.set(consumption.index, consumedCost);
            costLedgerInserts.push({
              itemLedgerType: "Purchase",
              costLedgerType: "Direct Cost",
              adjustment: false,
              documentType: "Purchase Receipt",
              documentId: receiptHeader.id ?? undefined,
              itemId: consumption.itemId,
              quantity: round(-consumption.quantity),
              cost: round(-consumedCost),
              remainingQuantity: 0,
              supplierId: purchaseOrder.data?.supplierId ?? undefined,
              companyId,
              postingDate: today
            });
          }

          // Flush cost layers. Transition guard: invoices posted before
          // receipt-created layers shipped created their own layers, so the
          // invoice-first quantity those legacy layers already represent must
          // not create a second one. Coverage is matched to the receipt's PO
          // lines through the legacy invoices' own lines, net of quantity
          // received before this receipt (which already consumed coverage);
          // only the covered quantity is excluded — any remainder still
          // creates a layer.
          if (costLedgerInserts.length > 0) {
            const invoiceFirstRows = costLedgerInserts.filter(
              (row) => row.isInvoiceFirst && row.itemId && row.poLineId
            );
            const legacyCoverageByPoLine = new Map<string, number>();
            if (invoiceFirstRows.length > 0) {
              const invoiceFirstItemIds = [
                ...new Set(invoiceFirstRows.map((row) => row.itemId!))
              ];
              const legacyLayers = await trx
                .selectFrom("costLedger")
                .select(["documentId"])
                .where("documentType", "=", "Purchase Invoice")
                .where("itemId", "in", invoiceFirstItemIds)
                .where("companyId", "=", companyId)
                .where("remainingQuantity", ">", 0)
                // adjustment children are corrections on receipt layers, not
                // legacy invoice-created layers — must not trip this guard
                .where("adjustment", "=", false)
                .where("appliesToCostLedgerId", "is", null)
                .execute();
              const legacyInvoiceIds = [
                ...new Set(
                  legacyLayers
                    .map((layer) => layer.documentId)
                    .filter((id): id is string => !!id)
                )
              ];
              if (legacyInvoiceIds.length > 0) {
                const invoiceFirstPoLineIds = [
                  ...new Set(invoiceFirstRows.map((row) => row.poLineId!))
                ];
                const legacyInvoiceLines = await trx
                  .selectFrom("purchaseInvoiceLine")
                  .select([
                    "purchaseOrderLineId",
                    "quantity",
                    "conversionFactor"
                  ])
                  .where("invoiceId", "in", legacyInvoiceIds)
                  .where("purchaseOrderLineId", "in", invoiceFirstPoLineIds)
                  .where("companyId", "=", companyId)
                  .execute();
                for (const line of legacyInvoiceLines) {
                  if (!line.purchaseOrderLineId) continue;
                  legacyCoverageByPoLine.set(
                    line.purchaseOrderLineId,
                    (legacyCoverageByPoLine.get(line.purchaseOrderLineId) ??
                      0) +
                      Number(line.quantity ?? 0) *
                        Number(line.conversionFactor ?? 1)
                  );
                }
                // Legacy layers were created for the full invoiced quantity,
                // and units received earlier consumed that coverage first —
                // subtracting received-to-date leaves exactly the coverage
                // this and future receipts may still exclude.
                for (const [linePoId, covered] of legacyCoverageByPoLine) {
                  const receivedBefore =
                    receivedBeforeInvUnitsByPoLine.get(linePoId) ?? 0;
                  legacyCoverageByPoLine.set(
                    linePoId,
                    Math.max(0, covered - receivedBefore)
                  );
                }
              }
            }
            const costLedgerRows: Database["public"]["Tables"]["costLedger"]["Insert"][] =
              [];
            for (const row of costLedgerInserts) {
              const {
                isInvoiceFirst,
                poLineId: rowPoLineId,
                ...insertRow
              } = row;
              if (isInvoiceFirst && rowPoLineId) {
                const coverage = legacyCoverageByPoLine.get(rowPoLineId) ?? 0;
                const rowQty = Number(insertRow.quantity ?? 0);
                const excludedQty = Math.min(rowQty, coverage);
                if (excludedQty > 0) {
                  legacyCoverageByPoLine.set(
                    rowPoLineId,
                    coverage - excludedQty
                  );
                  logger.info(
                    "excluding invoice-first quantity already represented by legacy invoice-created layers",
                    {
                      itemId: insertRow.itemId,
                      purchaseOrderLineId: rowPoLineId,
                      excludedQty
                    }
                  );
                  const layerQty = rowQty - excludedQty;
                  if (layerQty <= 0) continue;
                  const scale = layerQty / rowQty;
                  insertRow.quantity = round(layerQty);
                  insertRow.cost = round(Number(insertRow.cost ?? 0) * scale);
                  insertRow.nominalCost = round(
                    Number(insertRow.nominalCost ?? 0) * scale
                  );
                  insertRow.remainingQuantity = round(layerQty);
                }
              }
              costLedgerRows.push(insertRow);
            }
            if (costLedgerRows.length > 0) {
              await trx
                .insertInto("costLedger")
                .values(costLedgerRows)
                .execute();
            }
          }

          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdates
          )) {
            await trx
              .updateTable("purchaseOrderLine")
              .set(update)
              .where("id", "=", purchaseOrderLineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          for await (const [jobOperationId, update] of Object.entries(
            jobOperationUpdates
          )) {
            await trx
              .updateTable("jobOperation")
              .set(update)
              .where("id", "=", jobOperationId)
              .where("companyId", "=", companyId)
              .execute();
          }

          const purchaseOrderLines = await trx
            .selectFrom("purchaseOrderLine")
            .select([
              "id",
              "purchaseOrderLineType",
              "invoicedComplete",
              "receivedComplete"
            ])
            .where("purchaseOrderId", "=", purchaseOrder.data.id)
            .execute();

          const areAllLinesInvoiced = purchaseOrderLines.every(
            (line) =>
              line.purchaseOrderLineType === "Comment" || line.invoicedComplete
          );

          const areAllLinesReceived = purchaseOrderLines.every(
            (line) =>
              line.purchaseOrderLineType === "Comment" ||
              line.purchaseOrderLineType === "G/L Account" ||
              line.purchaseOrderLineType === "Service" ||
              line.receivedComplete
          );

          let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
            "To Receive and Invoice";
          if (areAllLinesInvoiced && areAllLinesReceived) {
            status = "Completed";
          } else if (areAllLinesInvoiced) {
            status = "To Receive";
          } else if (areAllLinesReceived) {
            status = "To Invoice";
          }

          await trx
            .updateTable("purchaseOrder")
            .set({
              status
            })
            .where("id", "=", purchaseOrder.data.id)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .updateTable("purchaseOrderDelivery")
            .set({
              deliveryDate: today,
              locationId: receiptHeader.locationId
            })
            .where("id", "=", receiptHeader.sourceDocumentId)
            .where("companyId", "=", companyId)
            .execute();

          const journalLines = buildPurchaseReceiptJournalLines({
            documentId: receiptHeader.id,
            externalDocumentId: purchaseOrder.data.supplierReference,
            isOutsideProcessing,
            supplierId: purchaseOrder.data.supplierId,
            supplierTypeId: supplier.data.supplierTypeId ?? null,
            accounts: accountDefaults.data,
            lines: receiptJournalLines.map((line, index) => ({
              ...line,
              cost:
                relievedCostByLine.get(index) ?? receiptLineCosts[index]!.cost
            })),
            fixedAssets: fixedAssetJournalLines
          });
          let receiptJournalId: string | null = null;
          if (journalLines.length > 0) {
            const journalEntryId = await sequence.getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId,
                description: `Purchase Receipt ${receiptHeader.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Purchase Receipt",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();
            receiptJournalId = journalResult.id;

            const journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLines.map(({ dimensions: _, ...line }) => ({
                  ...line,
                  journalId: journalResult.id,
                  companyId
                }))
              )
              .returning(["id"])
              .execute();

            const journalLineDimensionInserts = journalLineDimensionRows({
              journalLineIds: journalLineResults.map((jl) => jl.id),
              lines: journalLines,
              dimensionIdByEntity: dimensionMap,
              companyId
            });
            if (journalLineDimensionInserts.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(journalLineDimensionInserts)
                .execute();
            }
          }

          if (cipCostInserts.length > 0) {
            await trx
              .insertInto("fixedAssetCipCost")
              .values(
                cipCostInserts.map((row) => ({
                  ...row,
                  journalId: receiptJournalId
                }))
              )
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId
            })
            .where("id", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();

          if (Object.keys(trackedEntityUpdates).length > 0) {
            const trackedActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Receive",
                sourceDocument: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentReadableId: receiptHeader.receiptId,
                attributes: {
                  "Purchase Order": receiptHeader.sourceDocumentId,
                  Receipt: receiptId,
                  Employee: userId
                },
                companyId,
                createdBy: userId,
                createdAt: today
              })
              .returning(["id"])
              .execute();

            const trackedActivityId = trackedActivity[0]!.id;

            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .where("companyId", "=", companyId)
                .execute();

              if (trackedActivityId) {
                await trx
                  .insertInto("trackedActivityOutput")
                  .values({
                    trackedActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .execute();
              }
            }
          }

          if (inspectionInserts.length > 0) {
            for (const row of inspectionInserts) {
              row.inspectionId = await sequence.getNextSequence(
                trx,
                "inspection",
                companyId
              );
            }
            const insertedInspections = await trx
              .insertInto("inspection")
              .values(
                inspectionInserts as Insertable<KyselyDatabase["inspection"]>[]
              )
              .returning(["id", "sourceDocumentLineId"])
              .execute();

            const samplingPlanInserts: Array<
              InspectionSamplingPlanInsert & { inspectionId: string }
            > = [];
            for (const inspection of insertedInspections) {
              const featureRows = inspection.sourceDocumentLineId
                ? samplingPlanInsertsByReceiptLineId.get(
                    inspection.sourceDocumentLineId
                  )
                : undefined;
              if (!featureRows) continue;
              for (const featureRow of featureRows) {
                samplingPlanInserts.push({
                  ...featureRow,
                  inspectionId: inspection.id
                });
              }
            }
            if (samplingPlanInserts.length > 0) {
              await trx
                .insertInto("inspectionSamplingPlan")
                .values(samplingPlanInserts)
                .execute();
            }
          }
        });
        break;
      }
      case "Sales Return Order": {
        // Customer RMA receipt: goods re-enter inventory at the ORIGINAL
        // outbound cost when the line links a shipment (exact cost reversing),
        // at current cost for blind returns, and at ZERO when the line's
        // return reason flags inventoryValueZero. Entities re-enter On Hold —
        // disposition is the only path to Available.
        if (!receiptHeader.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");
        const salesReturnOrderId = receiptHeader.sourceDocumentId;

        const [salesReturnOrder, salesReturnOrderLines, itemCostDetails] =
          await inOrder([
            () =>
              single(db, "salesReturnOrder", {
                id: salesReturnOrderId,
                companyId
              }),
            () =>
              many<
                "salesReturnOrderLine",
                Tables["salesReturnOrderLine"]["Row"] & {
                  returnReason: Pick<
                    Tables["returnReason"]["Row"],
                    "inventoryValueZero"
                  > | null;
                }
              >(
                db,
                "salesReturnOrderLine",
                { salesReturnOrderId, companyId },
                {
                  embed: {
                    returnReason: {
                      table: "returnReason",
                      via: "returnReasonId",
                      columns: ["inventoryValueZero"]
                    }
                  }
                }
              ),
            () =>
              many(
                db,
                "itemCost",
                { itemId: itemIds, companyId },
                { columns: ["itemId", "unitCost"] }
              )
          ]);
        if (salesReturnOrder.error)
          throw new Error("Failed to fetch sales return order");
        if (salesReturnOrderLines.error)
          throw new Error("Failed to fetch sales return order lines");
        if (itemCostDetails.error)
          throw new Error("Failed to fetch item costs for cost resolution");
        // Allowlist, matching the create-side gate: a Draft RMA has never had
        // its caps validated, so it must be confirmed (To Receive) before
        // receiving.
        if (salesReturnOrder.data.status !== "To Receive") {
          throw new InvalidInputError(
            `Cannot post a receipt against a return order in ${salesReturnOrder.data.status} status`
          );
        }

        const returnLineById = new Map(
          (salesReturnOrderLines.data ?? []).map((l) => [l.id, l])
        );
        const currentCostByItem = new Map(
          (itemCostDetails.data ?? []).map((c) => [
            c.itemId,
            Number(c.unitCost ?? 0)
          ])
        );

        // Original-outbound-cost resolution: the shipment's consumption rows
        // are per (shipment, item) — post-shipment aggregates across lines —
        // so resolve the shipment ids behind the linked shipment lines, then
        // average that shipment's consumption rows for the item.
        const linkedShipmentLineIds = [
          ...new Set(
            (salesReturnOrderLines.data ?? [])
              .map((l) => l.shipmentLineId)
              .filter(Boolean) as string[]
          )
        ];
        const shipmentIdByShipmentLine = new Map<string, string>();
        if (linkedShipmentLineIds.length > 0) {
          const shipmentLines = await many(
            db,
            "shipmentLine",
            { companyId, id: linkedShipmentLineIds },
            { columns: ["id", "shipmentId"] }
          );
          // A failed read must abort, not fall back: an empty map here would
          // silently book every linked line at CURRENT cost instead of the
          // original outbound cost, defeating exact-cost reversing unnoticed.
          if (shipmentLines.error)
            throw new Error(
              "Failed to resolve shipments for original-cost lookup"
            );
          for (const line of shipmentLines.data ?? []) {
            if (line.shipmentId)
              shipmentIdByShipmentLine.set(line.id, line.shipmentId);
          }
        }
        const shipmentIds = [...new Set(shipmentIdByShipmentLine.values())];
        const consumptionRowsByShipmentItem = new Map<
          string,
          { quantity: number; cost: number }[]
        >();
        if (shipmentIds.length > 0) {
          const consumptionRows = await many(
            db,
            "costLedger",
            {
              documentId: shipmentIds,
              documentType: "Sales Shipment",
              companyId,
              quantity: lt(0)
            },
            { columns: ["documentId", "itemId", "quantity", "cost"] }
          );
          if (consumptionRows.error)
            throw new Error(
              "Failed to fetch shipment cost layers for original-cost lookup"
            );
          for (const row of consumptionRows.data ?? []) {
            const key = `${row.documentId}::${row.itemId}`;
            const list = consumptionRowsByShipmentItem.get(key) ?? [];
            list.push({
              quantity: Number(row.quantity ?? 0),
              cost: Number(row.cost ?? 0)
            });
            consumptionRowsByShipmentItem.set(key, list);
          }
        }

        const accountDefaults = await getDefaultPostingGroup(db, companyId);
        if (accountDefaults.error || !accountDefaults.data) {
          throw new Error("Error getting account defaults");
        }

        // Customer type for the return-receipt journal's GL dimensions.
        const customer = await single(
          db,
          "customer",
          { id: salesReturnOrder.data.customerId, companyId },
          { columns: ["id", "customerTypeId"] }
        );
        const customerTypeId = customer.data?.customerTypeId ?? null;

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
          [];
        const returnJournalLines: SalesReturnReceiptLine[] = [];
        const itemById = new Map(items.data.map((item) => [item.id, item]));
        const itemPostingGroupByItem = new Map(
          itemCosts.data.map((cost) => [cost.itemId, cost.itemPostingGroupId])
        );
        const returnLineUpdates: Record<
          string,
          { quantityReceived: number; updatedBy: string }
        > = {};
        const trackedEntityUpdates: Record<
          string,
          {
            status: Database["public"]["Tables"]["trackedEntity"]["Row"]["status"];
            quantity: number;
          }
        > = {};

        for (const receiptLine of receiptLines.data ?? []) {
          if (!receiptLine.itemId || !receiptLine.lineId) continue;
          const returnLine = returnLineById.get(receiptLine.lineId);
          if (!returnLine) {
            throw new Error(
              `Receipt line ${receiptLine.id} does not map to a return order line`
            );
          }

          const safeReceivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          if (safeReceivedQuantity <= 0) continue;
          const receivedQuantity = safeReceivedQuantity;

          const item = itemById.get(receiptLine.itemId);
          const itemTrackingType = item?.itemTrackingType ?? "Inventory";

          // Cost resolution: zero-value reason -> 0; linked -> original
          // outbound cost from the shipment's consumption rows; else current.
          let unitCost: number;
          if (
            (
              returnLine.returnReason as {
                inventoryValueZero: boolean;
              } | null
            )?.inventoryValueZero
          ) {
            unitCost = 0;
          } else if (
            returnLine.shipmentLineId &&
            shipmentIdByShipmentLine.has(returnLine.shipmentLineId)
          ) {
            const shipmentId = shipmentIdByShipmentLine.get(
              returnLine.shipmentLineId
            )!;
            const rows =
              consumptionRowsByShipmentItem.get(
                `${shipmentId}::${receiptLine.itemId}`
              ) ?? [];
            // Falls back to current cost only when the resolved shipment
            // genuinely has no usable consumption rows for the item (empty,
            // zero-quantity, or NaN — resolveReturnUnitCost returns null).
            // Read failures throw above rather than reaching this fallback.
            unitCost =
              resolveReturnUnitCost(rows) ??
              currentCostByItem.get(receiptLine.itemId) ??
              0;
          } else {
            unitCost = currentCostByItem.get(receiptLine.itemId) ?? 0;
          }

          const cost = receivedQuantity * unitCost;
          const createsLayers =
            itemTrackingType !== "Non-Inventory" &&
            !!receiptLine.itemId &&
            receivedQuantity > 0;

          // itemLedger — mirrors the Purchase Order branch's three sites,
          // with the Sales Return Receipt document identity.
          if (itemTrackingType === "Inventory") {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: round(receivedQuantity),
              locationId: receiptLine.locationId,
              storageUnitId: receiptLine.storageUnitId,
              entryType: "Positive Adjmt.",
              documentType: "Sales Return Receipt",
              documentId: receiptHeader.id ?? undefined,
              externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId
            });
          }

          if (receiptLine.requiresBatchTracking) {
            const entity = receiptLineTracking.data?.find(
              (tracking) =>
                (tracking.attributes as TrackedEntityAttributes | undefined)?.[
                  "Receipt Line"
                ] === receiptLine.id
            );
            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: round(receivedQuantity),
              locationId: receiptLine.locationId,
              storageUnitId: receiptLine.storageUnitId,
              entryType: "Positive Adjmt.",
              documentType: "Sales Return Receipt",
              documentId: receiptHeader.id ?? undefined,
              trackedEntityId: entity?.id,
              externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId
            });
            if (entity) {
              trackedEntityUpdates[entity.id] = {
                status: "On Hold",
                quantity: receivedQuantity
              };
            }
          }

          if (receiptLine.requiresSerialTracking) {
            const lineTracking = receiptLineTracking.data?.filter(
              (tracking) =>
                (tracking.attributes as TrackedEntityAttributes | undefined)?.[
                  "Receipt Line"
                ] === receiptLine.id
            );
            for (let i = 0; i < receivedQuantity; i++) {
              const trackingWithIndex = lineTracking?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line Index"] === i
              );
              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: 1,
                locationId: receiptLine.locationId,
                storageUnitId: receiptLine.storageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Sales Return Receipt",
                documentId: receiptHeader.id ?? undefined,
                trackedEntityId: trackingWithIndex?.id,
                externalDocumentId:
                  receiptHeader.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId
              });
              if (trackingWithIndex) {
                trackedEntityUpdates[trackingWithIndex.id] = {
                  status: "On Hold",
                  quantity: 1
                };
              }
            }
          }

          // Cost layer: consumable re-entry at the resolved cost. A
          // zero-value reason still creates the (0-cost) layer so FIFO
          // consumption stays quantity-consistent.
          if (createsLayers) {
            costLedgerInserts.push({
              itemLedgerType: "Sale",
              costLedgerType: "Direct Cost",
              adjustment: false,
              documentType: "Sales Return Receipt",
              documentId: receiptHeader.id ?? undefined,
              externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
              itemId: receiptLine.itemId,
              quantity: round(receivedQuantity),
              nominalCost: round(cost),
              cost: round(cost),
              remainingQuantity: round(receivedQuantity),
              companyId,
              postingDate: today
            });
          }

          // Journal: Dr Inventory / Cr COGS at the re-entry value. Zero-value
          // re-entries post no journal.
          returnJournalLines.push({
            returnLineId: receiptLine.lineId,
            itemId: receiptLine.itemId,
            quantity: receivedQuantity,
            cost,
            replenishmentSystem: item?.replenishmentSystem,
            itemPostingGroupId:
              itemPostingGroupByItem.get(receiptLine.itemId) ?? null,
            locationId: receiptLine.locationId
          });

          const existingUpdate = returnLineUpdates[returnLine.id];
          returnLineUpdates[returnLine.id] = {
            quantityReceived:
              (existingUpdate?.quantityReceived ??
                Number(returnLine.quantityReceived ?? 0)) + receivedQuantity,
            updatedBy: userId
          };
        }

        const journalLines = buildSalesReturnReceiptJournalLines({
          documentId: receiptHeader.id,
          externalDocumentId: receiptHeader.externalDocumentId,
          customerId: salesReturnOrder.data.customerId,
          customerTypeId,
          accounts: accountDefaults.data,
          lines: returnJournalLines
        });

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted" && journalLines.length > 0
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // Double-post guard: serialize on the receipt row — a second
          // concurrent post waits here, then sees Posted and aborts, so
          // ledger rows, journals, and quantityReceived can never double.
          const lockedReceipt = await trx
            .selectFrom("receipt")
            .select(["status"])
            .where("id", "=", receiptId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          if (
            lockedReceipt.status === "Posted" ||
            lockedReceipt.status === "Voided"
          ) {
            throw new InvalidInputError(
              `Receipt is already ${lockedReceipt.status}`
            );
          }

          // cancelSalesReturnOrder locks this same order row — re-check the
          // status under the lock so a cancel committed after our
          // pre-transaction read cannot be posted over (which would leave a
          // Cancelled order with received stock and a freed cap).
          const lockedOrder = await trx
            .selectFrom("salesReturnOrder")
            .select(["status"])
            .where("id", "=", salesReturnOrderId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          if (lockedOrder.status !== "To Receive") {
            throw new InvalidInputError(
              `Cannot post a receipt against a return order in ${lockedOrder.status} status`
            );
          }

          if (costLedgerInserts.length > 0) {
            await trx
              .insertInto("costLedger")
              .values(costLedgerInserts)
              .execute();
          }

          for await (const [lineId, update] of Object.entries(
            returnLineUpdates
          )) {
            await trx
              .updateTable("salesReturnOrderLine")
              .set(update)
              .where("id", "=", lineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Derived status (mirrors getSalesReturnOrderStatus): the RMA is
          // Completed once every line has received its authorized quantity or
          // been short-closed, otherwise it stays To Receive.
          const allLines = await trx
            .selectFrom("salesReturnOrderLine")
            .select(["quantity", "quantityReceived", "closedComplete"])
            .where("salesReturnOrderId", "=", salesReturnOrderId)
            .execute();
          const allReceived =
            allLines.length > 0 &&
            allLines.every(
              (l) =>
                l.closedComplete ||
                Number(l.quantityReceived) >= Number(l.quantity)
            );
          const returnStatus = allReceived
            ? ("Completed" as const)
            : ("To Receive" as const);
          await trx
            .updateTable("salesReturnOrder")
            .set({ status: returnStatus, updatedBy: userId })
            .where("id", "=", salesReturnOrderId)
            .where("companyId", "=", companyId)
            .execute();

          if (journalLines.length > 0) {
            const journalEntryId = await sequence.getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId,
                description: `Sales Return Receipt ${receiptHeader.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Sales Return Receipt",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLines.map(({ dimensions: _, ...line }) => ({
                  ...line,
                  journalId: journalResult.id,
                  companyId
                }))
              )
              .returning(["id"])
              .execute();

            const journalLineDimensionInserts = journalLineDimensionRows({
              journalLineIds: journalLineResults.map((jl) => jl.id),
              lines: journalLines,
              dimensionIdByEntity: dimensionMap,
              companyId
            });
            if (journalLineDimensionInserts.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(journalLineDimensionInserts)
                .execute();
            }
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId
            })
            .where("id", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();

          if (Object.keys(trackedEntityUpdates).length > 0) {
            const trackedActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Return Receipt",
                sourceDocument: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentReadableId: receiptHeader.receiptId,
                attributes: {
                  "Sales Return Order": salesReturnOrderId,
                  Receipt: receiptId,
                  Employee: userId
                },
                companyId,
                createdBy: userId,
                createdAt: today
              })
              .returning(["id"])
              .execute();

            const trackedActivityId = trackedActivity[0]!.id;

            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .where("companyId", "=", companyId)
                .execute();

              if (trackedActivityId) {
                await trx
                  .insertInto("trackedActivityOutput")
                  .values({
                    trackedActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .execute();
              }
            }
          }
        });
        break;
      }
      case "Inbound Transfer": {
        if (!receiptHeader.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [warehouseTransfer, warehouseTransferLines] = await inOrder([
          () =>
            single(db, "warehouseTransfer", {
              id: receiptHeader.sourceDocumentId,
              companyId
            }),
          () =>
            many(db, "warehouseTransferLine", {
              transferId: receiptHeader.sourceDocumentId,
              companyId
            })
        ]);

        if (warehouseTransfer.error)
          throw new Error("Failed to fetch warehouse transfer");
        if (warehouseTransferLines.error)
          throw new Error("Failed to fetch warehouse transfer lines");

        // Get item costs for valuation
        const transferItemIds = warehouseTransferLines.data
          .map((line) => line.itemId)
          .filter(Boolean) as string[];
        const [itemCosts, transferItems] = await inOrder([
          () =>
            many(
              db,
              "itemCost",
              { itemId: transferItemIds, companyId },
              { columns: ["itemId", "itemPostingGroupId", "unitCost"] }
            ),
          () =>
            many(
              db,
              "item",
              { id: transferItemIds, companyId },
              { columns: ["id", "replenishmentSystem"] }
            )
        ]);

        if (itemCosts.error) {
          throw new Error("Failed to fetch item costs");
        }
        if (transferItems.error) {
          throw new Error("Failed to fetch items");
        }

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const journalLineInserts: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = [];
        const journalLineDimensionsMeta: {
          itemPostingGroupId: string | null;
          itemId: string | null;
          locationId: string | null;
          fixedAssetClassId: string | null;
        }[] = [];
        const warehouseTransferLineUpdates: Record<
          string,
          Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
        > = {};

        // Get account defaults (once for all lines) for the journal entries
        const accountDefaults = await getDefaultPostingGroup(db, companyId);
        if (accountDefaults.error || !accountDefaults.data) {
          throw new Error("Error getting account defaults");
        }

        // Process each receipt line
        for await (const receiptLine of receiptLines.data) {
          const jlStartIdx = journalLineInserts.length;

          const warehouseTransferLine = warehouseTransferLines.data.find(
            (line) => line.id === receiptLine.lineId
          );

          if (!warehouseTransferLine) continue;

          const receivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          if (receivedQuantity === 0) continue;

          // Update warehouse transfer line received quantity
          const newReceivedQuantity =
            (warehouseTransferLine.receivedQuantity ?? 0) + receivedQuantity;

          warehouseTransferLineUpdates[warehouseTransferLine.id] = {
            receivedQuantity: newReceivedQuantity
          };

          // Get item cost for this item
          const itemCost = itemCosts.data?.find(
            (cost) => cost.itemId === receiptLine.itemId
          );
          const unitCost = itemCost?.unitCost ?? 0;
          const totalValue = Math.abs(receivedQuantity) * unitCost;

          // Create item ledger entry for positive adjustment at destination
          itemLedgerInserts.push({
            postingDate: today,
            itemId: receiptLine.itemId,
            quantity: receivedQuantity,
            locationId: receiptLine.locationId,
            storageUnitId: receiptLine.storageUnitId,
            entryType: "Transfer",
            documentType: "Transfer Receipt",
            documentId: warehouseTransfer.data?.transferId,
            externalDocumentId: receiptHeader.externalDocumentId ?? undefined,
            createdBy: userId,
            companyId
          });

          // Create journal entries for inventory movement if there's value
          if (totalValue > 0) {
            const journalLineReference = nanoid();
            // Same account on both sides: a transfer moves stock between
            // locations, not between inventory classes.
            const inventoryAccount = resolveInventoryAccount(
              transferItems.data.find(
                (item: { id: string }) => item.id === receiptLine.itemId
              )?.replenishmentSystem ?? null,
              accountDefaults.data
            );

            journalLineInserts.push({
              accountId: inventoryAccount.account,
              description: `Transfer Out - ${warehouseTransfer.data?.transferId}`,
              amount: round(credit("asset", totalValue)),
              quantity: round(Math.abs(receivedQuantity)),
              documentType: "Receipt",
              documentId: receiptHeader.id,
              externalDocumentId: warehouseTransfer.data?.transferId,
              documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
              journalLineReference,
              companyId
            });

            journalLineInserts.push({
              accountId: inventoryAccount.account,
              description: `Transfer In - ${warehouseTransfer.data?.transferId}`,
              amount: round(debit("asset", totalValue)),
              quantity: round(Math.abs(receivedQuantity)),
              documentType: "Receipt",
              documentId: receiptHeader.id,
              externalDocumentId: warehouseTransfer.data?.transferId,
              documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
              journalLineReference,
              companyId
            });
          }

          // Track dimensions for this receipt line's journal lines
          const jlCount = journalLineInserts.length - jlStartIdx;
          for (let i = 0; i < jlCount; i++) {
            journalLineDimensionsMeta.push({
              itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
              itemId: receiptLine.itemId ?? null,
              locationId: receiptLine.locationId ?? null,
              fixedAssetClassId: null
            });
          }
        }

        // Check if all lines are fully received
        const allLinesFullyReceived = warehouseTransferLines.data.every(
          (line) => {
            const updates = warehouseTransferLineUpdates[line.id];
            const receivedQty =
              updates?.receivedQuantity ?? line.receivedQuantity ?? 0;
            return receivedQty >= (line.quantity ?? 0);
          }
        );

        // Check if all lines are fully shipped
        const allLinesFullyShipped = warehouseTransferLines.data.every(
          (line) => {
            const shippedQty = line.shippedQuantity ?? 0;
            return shippedQty >= (line.quantity ?? 0);
          }
        );

        // Determine new warehouse transfer status
        let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
          warehouseTransfer.data.status;

        if (allLinesFullyReceived && allLinesFullyShipped) {
          newStatus = "Completed";
        } else if (allLinesFullyReceived && !allLinesFullyShipped) {
          newStatus = "To Ship";
        } else if (!allLinesFullyReceived && allLinesFullyShipped) {
          newStatus = "To Receive";
        }

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted"
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // Update warehouse transfer lines
          for await (const [lineId, update] of Object.entries(
            warehouseTransferLineUpdates
          )) {
            await trx
              .updateTable("warehouseTransferLine")
              .set(update)
              .where("id", "=", lineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Update warehouse transfer status
          await trx
            .updateTable("warehouseTransfer")
            .set({
              status: newStatus,
              updatedBy: userId
            })
            .where("id", "=", warehouseTransfer.data.id)
            .where("companyId", "=", companyId)
            .execute();

          // Create journal entries if there are any
          if (journalLineInserts.length > 0) {
            const transferJournalEntryId = await sequence.getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const transferJournalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId: transferJournalEntryId,
                accountingPeriodId,
                description: `Transfer Receipt ${receiptHeader.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Transfer Receipt",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLineInserts.map((line) => ({
                  ...line,
                  journalId: transferJournalResult.id
                }))
              )
              .returning(["id"])
              .execute();

            // Insert automatic dimensions for transfer journal lines
            if (dimensionMap.size > 0) {
              const journalLineDimensionInserts: {
                journalLineId: string;
                dimensionId: string;
                valueId: string;
                companyId: string;
              }[] = [];

              journalLineResults.forEach((jl, index) => {
                const meta = journalLineDimensionsMeta[index];
                if (!meta) return;

                if (
                  meta.itemPostingGroupId &&
                  dimensionMap.has("ItemPostingGroup")
                ) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("ItemPostingGroup")!,
                    valueId: meta.itemPostingGroupId,
                    companyId
                  });
                }
                if (meta.itemId && dimensionMap.has("Item")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Item")!,
                    valueId: meta.itemId,
                    companyId
                  });
                }
                if (meta.locationId && dimensionMap.has("Location")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Location")!,
                    valueId: meta.locationId,
                    companyId
                  });
                }
                if (
                  meta.fixedAssetClassId &&
                  dimensionMap.has("FixedAssetClass")
                ) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("FixedAssetClass")!,
                    valueId: meta.fixedAssetClassId,
                    companyId
                  });
                }
              });

              if (journalLineDimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(journalLineDimensionInserts)
                  .execute();
              }
            }
          }

          // Create item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          // Update receipt status
          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId
            })
            .where("id", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }
      case "Rental Agreement": {
        await postRentalReceipt(db, {
          receiptId,
          companyId,
          userId,
          today,
          postingDate
        });
        break;
      }
      default: {
        break;
      }
    }

    return { success: true };
  } catch (err) {
    // A failed VOID leaves the receipt Posted: its rows still stand.
    if (type !== "void") {
      await updateRows(
        db,
        "receipt",
        { status: "Draft" },
        { id: receiptId, companyId }
      );
    }
    throw err;
  }
}
/** One line before it has a journal, and its dimension values by entity
 *  type, in the order the posting writes them. A null value writes none. */
export type ShipmentJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: JournalLineDimensionValues;
};

export type ShipmentJournal = {
  description: string;
  sourceType: Enums["journalEntrySourceType"];
  lines: ShipmentJournalLine[];
};

export type ShipmentAccountDefaults = Pick<
  Database["public"]["Tables"]["accountDefault"]["Row"],
  | "costOfGoodsSoldAccount"
  | "goodsReceivedNotInvoicedAccount"
  | "rawMaterialsAccount"
  | "finishedGoodsAccount"
>;

/** A sales order shipment line and the facts of its item. */
export type SalesShipmentLine = {
  shipmentLineId: string;
  itemId: string | null;
  /** The shipped quantity, with null and NaN read as 0. */
  shippedQuantity: number;
  itemTrackingType: Enums["itemTrackingType"] | null;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null;
  itemPostingGroupId: string | null;
  /** The line's location, else the shipment's. */
  locationId: string | null;
};

/** A fixed asset sold on the sales order and shipped with this shipment. */
export type FixedAssetSale = {
  salesOrderLineId: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  /** Used as a disposal clearing account: the net book value parks here
   *  until the invoice recognizes the proceeds. */
  writeOffAccountId: string;
  locationId: string | null;
  fixedAssetClassId: string | null;
};

type CostedLine = SalesShipmentLine & { itemId: string; quantity: number };

/** The lines that carry a COGS pair: an item, a positive shipped quantity,
 *  and stock (not Non-Inventory). `quantity` is the rounded shipped quantity
 *  the pair carries. */
function costedLines(lines: SalesShipmentLine[]): CostedLine[] {
  return lines.flatMap((line) =>
    line.itemId &&
    line.shippedQuantity > 0 &&
    line.itemTrackingType !== "Non-Inventory"
      ? [
          {
            ...line,
            itemId: line.itemId,
            quantity: round(line.shippedQuantity)
          }
        ]
      : []
  );
}

/**
 * Each item's shipped quantity across its costed lines, in first-line order:
 * the quantity the posting relieves per item (`calculateCOGS`).
 */
export function shippedQuantityByItem(
  lines: SalesShipmentLine[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of costedLines(lines)) {
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
  }
  return totals;
}

/** The net book value a fixed asset leaves the books at. */
export function netBookValue(
  asset: Pick<FixedAssetSale, "acquisitionCost" | "accumulatedDepreciation">
): number {
  return asset.acquisitionCost - asset.accumulatedDepreciation;
}

/**
 * A sales order shipment: per costed line, COGS against inventory on
 * `shipment:<shipmentLineId>`. An item's relieved cost is shared across its
 * lines by quantity, the last line taking the remainder. Then, per fixed
 * asset sold, the accumulated depreciation cleared, the net book value moved
 * to disposal clearing, and the asset removed at cost.
 */
export function buildSalesShipmentJournal({
  shipmentId,
  shipmentReadableId,
  externalDocumentId,
  customerId,
  customerTypeId,
  defaults,
  lines,
  relievedCostByItem,
  fixedAssetSales
}: {
  shipmentId: string;
  shipmentReadableId: string;
  externalDocumentId: string | null;
  customerId: string | null;
  customerTypeId: string | null;
  defaults: ShipmentAccountDefaults;
  lines: SalesShipmentLine[];
  /** The cost each item's shipment relieved, positive. */
  relievedCostByItem: ReadonlyMap<string, number>;
  fixedAssetSales: FixedAssetSale[];
}): ShipmentJournal {
  const costed = costedLines(lines);
  const totalQuantityByItem = shippedQuantityByItem(lines);

  const costByLine = new Map<string, number>();
  for (const [itemId, group] of Map.groupBy(costed, (line) => line.itemId)) {
    const total = relievedCostByItem.get(itemId) ?? 0;
    const totalQuantity = totalQuantityByItem.get(itemId) ?? 0;
    let assigned = 0;
    group.forEach((line, index) => {
      const lineCost =
        index === group.length - 1
          ? total - assigned
          : (line.quantity / totalQuantity) * total;
      assigned += lineCost;
      costByLine.set(line.shipmentLineId, lineCost);
    });
  }

  const document = {
    documentType: "Sales Shipment" as const,
    documentId: shipmentId,
    externalDocumentId
  };
  const journalLines: ShipmentJournalLine[] = [];

  for (const line of costed) {
    const cost = costByLine.get(line.shipmentLineId) ?? 0;
    const inventory = resolveInventoryAccount(
      line.replenishmentSystem,
      defaults
    );
    const keys = {
      ...document,
      quantity: line.quantity,
      documentLineReference: journalReference.to.shipment(line.shipmentLineId),
      journalLineReference: nanoid(),
      dimensions: {
        Customer: customerId,
        CustomerType: customerTypeId,
        Item: line.itemId,
        ItemPostingGroup: line.itemPostingGroupId,
        Location: line.locationId
      }
    };
    journalLines.push(
      {
        ...keys,
        accountId: defaults.costOfGoodsSoldAccount,
        description: "Cost of Goods Sold",
        amount: round(debit("expense", cost))
      },
      {
        ...keys,
        accountId: inventory.account,
        description: inventory.description,
        amount: round(credit("asset", cost))
      }
    );
  }

  for (const asset of fixedAssetSales) {
    const nbv = netBookValue(asset);
    const keys = {
      ...document,
      quantity: 1,
      documentLineReference: journalReference.to.shipment(
        asset.salesOrderLineId
      ),
      dimensions: {
        Customer: customerId,
        CustomerType: customerTypeId,
        Location: asset.locationId,
        FixedAssetClass: asset.fixedAssetClassId
      }
    };
    if (asset.accumulatedDepreciation > 0) {
      journalLines.push({
        ...keys,
        accountId: asset.accumulatedDepreciationAccountId,
        description: "Clear accumulated depreciation",
        amount: round(debit("asset", asset.accumulatedDepreciation)),
        journalLineReference: nanoid()
      });
    }
    if (nbv > 0) {
      journalLines.push({
        ...keys,
        accountId: asset.writeOffAccountId,
        description: "Transfer net book value to disposal clearing",
        amount: round(debit("expense", nbv)),
        journalLineReference: nanoid()
      });
    }
    journalLines.push({
      ...keys,
      accountId: asset.assetAccountId,
      description: "Remove asset at cost",
      amount: round(credit("asset", asset.acquisitionCost)),
      journalLineReference: nanoid()
    });
  }

  return {
    description: `Sales Shipment ${shipmentReadableId}`,
    sourceType: "Sales Shipment",
    lines: journalLines
  };
}

/** An item a return shipment relieved: its quantity and cost, positive. */
export type ReturnShipmentItem = {
  itemId: string;
  quantity: number;
  cost: number;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null;
  itemPostingGroupId: string | null;
};

/**
 * A return shipment: per item, one pair against inventory on
 * `shipment:<shipmentId>`, at zero cost too. A sales return (back to the
 * customer) debits COGS; a purchase return (back to the supplier) debits
 * GR/IR, reversing the receipt.
 */
export function buildReturnShipmentJournal({
  sourceDocument,
  shipmentId,
  shipmentReadableId,
  locationId,
  partyId,
  partyTypeId,
  defaults,
  items
}: {
  sourceDocument: "Sales Return Order" | "Purchase Return Order";
  shipmentId: string;
  shipmentReadableId: string;
  locationId: string | null;
  /** The customer of a sales return, the supplier of a purchase return. */
  partyId: string | null;
  partyTypeId: string | null;
  defaults: ShipmentAccountDefaults;
  items: ReturnShipmentItem[];
}): ShipmentJournal {
  const isSalesReturn = sourceDocument === "Sales Return Order";
  const party = isSalesReturn
    ? { Customer: partyId, CustomerType: partyTypeId }
    : { Supplier: partyId, SupplierType: partyTypeId };

  const lines = items.flatMap((item): ShipmentJournalLine[] => {
    const inventory = resolveInventoryAccount(
      item.replenishmentSystem,
      defaults
    );
    const keys = {
      quantity: round(item.quantity),
      documentType: "Return Order" as const,
      documentId: shipmentId,
      documentLineReference: journalReference.to.shipment(shipmentId),
      journalLineReference: nanoid(),
      dimensions: {
        Item: item.itemId,
        ItemPostingGroup: item.itemPostingGroupId,
        Location: locationId,
        ...party
      }
    };
    return [
      isSalesReturn
        ? {
            ...keys,
            accountId: defaults.costOfGoodsSoldAccount,
            description: "Cost of Goods Sold",
            amount: round(debit("expense", item.cost))
          }
        : {
            ...keys,
            accountId: defaults.goodsReceivedNotInvoicedAccount,
            description: "Goods Received Not Invoiced",
            amount: round(debit("liability", item.cost))
          },
      {
        ...keys,
        accountId: inventory.account,
        description: inventory.description,
        amount: round(credit("asset", item.cost))
      }
    ];
  });

  return isSalesReturn
    ? {
        description: `Return Shipment ${shipmentReadableId}`,
        sourceType: "Sales Return Shipment",
        lines
      }
    : {
        description: `Purchase Return Shipment ${shipmentReadableId}`,
        sourceType: "Purchase Return Shipment",
        lines
      };
}
export async function postRentalShipment(
  db: Kysely<KyselyDatabase>,
  args: {
    shipmentId: string;
    companyId: string;
    userId: string;
    today: string;
    postingDate?: string;
  }
): Promise<void> {
  const { shipmentId, companyId, userId, today } = args;

  await db.transaction().execute(async (trx) => {
    const deliveredOn = args.postingDate ?? today;
    const future = futureDeliveryError(deliveredOn, today);
    if (future) throw new InvalidInputError(future);

    const shipment = await trx
      .selectFrom("shipment")
      .select(["id", "shipmentId", "sourceDocumentId", "status"])
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!shipment) throw new NotFoundError("Shipment not found");

    const assetLines = await trx
      .selectFrom("shipmentFixedAssetLine")
      .select(["id", "rentalAgreementLineId", "meter"])
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", companyId)
      .where("shipped", "=", true)
      .where("rentalAgreementLineId", "is not", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    if (assetLines.length === 0) {
      throw new InvalidInputError("Select at least one unit to deliver");
    }

    if (!shipment.sourceDocumentId) {
      throw new NotFoundError("Rental agreement not found");
    }
    const agreement = await lockAgreement(
      trx,
      companyId,
      shipment.sourceDocumentId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are delivered from an Active agreement`
      );
    }

    const { linesById, assetsById } = await lockRentalUnits(
      trx,
      companyId,
      assetLines.map((line) => line.rentalAgreementLineId!)
    );

    const units = assetLines.map((assetLine) => {
      const lineId = assetLine.rentalAgreementLineId!;
      const line = linesById.get(lineId);
      const asset = line?.fixedAssetId
        ? assetsById.get(line.fixedAssetId)
        : undefined;
      const label = unitLabel(asset, lineId);
      if (!line || line.rentalAgreementId !== agreement.id) {
        throw new NotFoundError("Rental agreement line not found");
      }
      if (line.status !== "Pending") {
        throw new InvalidInputError(
          `${label} is ${line.status}; only a Pending unit can be delivered`
        );
      }
      if (asset?.outOfServiceSince) {
        throw new InvalidInputError(
          `${label} is out of service: ${asset.outOfServiceReason ?? "no reason given"}`
        );
      }
      return { line, meter: assetLine.meter };
    });

    for (const { line, meter } of units) {
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          status: "On Rent",
          deliveredAt: deliveredOn,
          meterOut: meter,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    for (const { line } of units) {
      if (!line.trackedEntityId) continue;
      await insertUnitActivity(trx, {
        type: "Rental Delivery",
        direction: "input",
        sourceDocument: "Shipment",
        sourceDocumentId: shipment.id,
        sourceDocumentReadableId: shipment.shipmentId,
        attributes: { Shipment: shipment.id, "Rental Agreement": agreement.id },
        trackedEntityId: line.trackedEntityId,
        companyId,
        userId
      });
    }

    await trx
      .updateTable("shipment")
      .set({
        status: "Posted",
        postingDate: deliveredOn,
        postedBy: userId
      })
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** Voids a Posted rental shipment: its units go back to Pending, as if never
 *  delivered. Refused once a unit has moved on or its accrued rent is in a
 *  posted or draft recognition run. */
export async function voidRentalShipment(
  db: Kysely<KyselyDatabase>,
  args: { shipmentId: string; companyId: string; userId: string }
): Promise<void> {
  const { shipmentId, companyId, userId } = args;

  await db.transaction().execute(async (trx) => {
    const shipment = await trx
      .selectFrom("shipment")
      .select(["id", "shipmentId", "sourceDocumentId"])
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!shipment) throw new NotFoundError("Shipment not found");

    const assetLines = await trx
      .selectFrom("shipmentFixedAssetLine")
      .select(["id", "rentalAgreementLineId"])
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", companyId)
      .where("shipped", "=", true)
      .where("rentalAgreementLineId", "is not", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();

    if (!shipment.sourceDocumentId) {
      throw new NotFoundError("Rental agreement not found");
    }
    const agreement = await lockAgreement(
      trx,
      companyId,
      shipment.sourceDocumentId
    );

    const lineIds = assetLines.map((line) => line.rentalAgreementLineId!);
    const { linesById, assetsById } = await lockRentalUnits(
      trx,
      companyId,
      lineIds
    );

    const accruals =
      lineIds.length === 0
        ? []
        : await trx
            .selectFrom("revenueRecognitionSchedule")
            .select(["rentalAgreementLineId", "status", "runLineId"])
            .where("type", "=", "Accrual")
            .where("companyId", "=", companyId)
            .where("rentalAgreementLineId", "in", lineIds)
            .execute();

    const units = assetLines.map((assetLine) => {
      const lineId = assetLine.rentalAgreementLineId!;
      const line = linesById.get(lineId);
      const asset = line?.fixedAssetId
        ? assetsById.get(line.fixedAssetId)
        : undefined;
      if (!line || line.rentalAgreementId !== agreement.id) {
        throw new NotFoundError("Rental agreement line not found");
      }
      const rows = accruals.filter(
        (row) => row.rentalAgreementLineId === lineId
      );
      const accrual: "Posted" | "Draft run" | null = rows.some(
        (row) => row.status === "Posted"
      )
        ? "Posted"
        : rows.some((row) => row.status === "Planned" && row.runLineId)
          ? "Draft run"
          : null;
      return {
        line,
        label: unitLabel(asset, lineId),
        status: line.status,
        accrual
      };
    });

    const blocker = rentalShipmentVoidBlocker(units);
    if (blocker) throw new InvalidInputError(blocker);

    if (lineIds.length > 0) {
      await trx
        .deleteFrom("revenueRecognitionSchedule")
        .where("type", "=", "Accrual")
        .where("status", "=", "Planned")
        .where("runLineId", "is", null)
        .where("companyId", "=", companyId)
        .where("rentalAgreementLineId", "in", lineIds)
        .execute();
    }

    for (const { line } of units) {
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          status: "Pending",
          deliveredAt: null,
          meterOut: null,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    for (const { line } of units) {
      if (!line.trackedEntityId) continue;
      await insertUnitActivity(trx, {
        type: "Void Shipment",
        direction: "input",
        sourceDocument: "Shipment",
        sourceDocumentId: shipment.id,
        sourceDocumentReadableId: shipment.shipmentId,
        attributes: { Shipment: shipment.id, "Rental Agreement": agreement.id },
        trackedEntityId: line.trackedEntityId,
        companyId,
        userId
      });
    }

    await trx
      .updateTable("shipment")
      .set({
        status: "Voided",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// Locks the agreement lines a rental document names and reads their assets,
// whose numbers name the units in a refusal.
async function lockRentalUnits(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  lineIds: string[]
) {
  const lines =
    lineIds.length === 0
      ? []
      : await trx
          .selectFrom("rentalAgreementLine")
          .select([
            "id",
            "rentalAgreementId",
            "status",
            "fixedAssetId",
            "trackedEntityId"
          ])
          .where("id", "in", lineIds)
          .where("companyId", "=", companyId)
          .forUpdate()
          .execute();
  const linesById = new Map(lines.map((line) => [line.id, line]));

  const assetIds = lines
    .map((line) => line.fixedAssetId)
    .filter((id): id is string => id !== null);
  const assets =
    assetIds.length === 0
      ? []
      : await trx
          .selectFrom("fixedAsset")
          .select([
            "id",
            "fixedAssetId",
            "name",
            "outOfServiceSince",
            "outOfServiceReason"
          ])
          .where("id", "in", assetIds)
          .where("companyId", "=", companyId)
          .execute();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return { linesById, assetsById };
}

export const postShipmentInput = z.object({
  type: z.enum(["post", "void"]),
  shipmentId: z.string(),
  /** The delivery date of a rental shipment. Other sources ignore it. */
  postingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});

export const postShipmentPermission = {
  update: "inventory"
} satisfies PermissionRule<z.output<typeof postShipmentInput>>;

/** Posts or voids a shipment: stock, tracked entities, COGS and journal rows. */
export async function postShipment(
  ctx: ServiceContext,
  raw: z.input<typeof postShipmentInput>
) {
  const { type, shipmentId, postingDate } = postShipmentInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  logger.info({ type, shipmentId, userId, companyId });
  const fixedAssetWrites = new FixedAssetWrites();
  if (type === "post")
    await assertPostable(db, "shipment", shipmentId, companyId);
  try {
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const [shipment, shipmentLines, shipmentLineTracking] = await inOrder([
      // The client is service-role: authorization proved the caller may
      // act in companyId, not that shipmentId belongs to it.
      () => maybeSingle(db, "shipment", { id: shipmentId, companyId }),
      () =>
        many<
          "shipmentLine",
          Tables["shipmentLine"]["Row"] & {
            fulfillment: Tables["fulfillment"]["Row"] | null;
          }
        >(
          db,
          "shipmentLine",
          { shipmentId, companyId },
          {
            embed: {
              fulfillment: { table: "fulfillment", via: "fulfillmentId" }
            }
          }
        ),
      () =>
        many(db, "trackedEntity", {
          attributes: contains({ Shipment: shipmentId }),
          companyId
        })
    ]);

    if (shipment.error) throw new Error("Failed to fetch shipment");
    if (!shipment.data) throw new NotFoundError("Shipment not found");
    const shipmentHeader = shipment.data;
    if (shipmentLines.error) throw new Error("Failed to fetch shipment lines");

    const itemIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (shipmentLine.itemId && !acc.includes(shipmentLine.itemId)) {
        acc.push(shipmentLine.itemId);
      }
      return acc;
    }, []);

    const jobIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (
        shipmentLine.fulfillment?.jobId &&
        !acc.includes(shipmentLine.fulfillment?.jobId)
      ) {
        acc.push(shipmentLine.fulfillment?.jobId);
      }
      return acc;
    }, []);

    const [items, itemCosts, jobs] = await inOrder([
      () =>
        many(
          db,
          "item",
          { id: itemIds, companyId },
          { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        many(
          db,
          "itemCost",
          { itemId: itemIds },
          { columns: ["itemId", "itemPostingGroupId"] }
        ),
      () =>
        many(
          db,
          "job",
          { companyId, id: jobIds },
          {
            columns: [
              "id",
              "quantity",
              "quantityComplete",
              "quantityShipped",
              "status"
            ]
          }
        )
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }
    if (jobs.error) {
      throw new Error("Failed to fetch jobs");
    }

    const splitEntityIds: string[] = [];

    switch (type) {
      case "post": {
        switch (shipmentHeader.sourceDocument) {
          case "Sales Order": {
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [salesOrder, salesOrderLines, salesOrderDelivery] =
              await inOrder([
                () =>
                  single(db, "salesOrder", {
                    id: shipmentHeader.sourceDocumentId
                  }),
                () =>
                  many(db, "salesOrderLine", {
                    salesOrderId: shipmentHeader.sourceDocumentId
                  }),
                () =>
                  single(
                    db,
                    "salesOrderShipment",
                    { companyId, id: shipmentHeader.sourceDocumentId },
                    { columns: ["shippingCost"] }
                  )
              ]);
            if (salesOrder.error)
              throw new Error("Failed to fetch purchase order");
            if (salesOrderLines.error)
              throw new Error("Failed to fetch sales order lines");
            if (salesOrderDelivery.error)
              throw new Error("Failed to fetch sales order delivery");

            const customer = await single(db, "customer", {
              id: salesOrder.data.customerId,
              companyId
            });
            if (customer.error) throw new Error("Failed to fetch customer");

            const companyRecord = await single(
              db,
              "company",
              { id: companyId },
              { columns: ["companyGroupId"] }
            );
            if (companyRecord.error) throw new Error("Failed to fetch company");
            const companyGroupId = companyRecord.data.companyGroupId;

            // Every shipment posts its journal: Provisional before the
            // company's accounting cutover, Posted after it. Read here to
            // decide whether to resolve a period, and again inside the
            // transaction.
            const postingStatus = await journalPostingStatus(db, companyId);

            const accountDefaults = await getDefaultPostingGroup(db, companyId);
            if (accountDefaults.error || !accountDefaults.data) {
              throw new Error("Error getting account defaults");
            }

            // Guarded like the return-shipment branches: a company with no
            // group has no dimensions to read.
            const dimensions = companyGroupId
              ? await many(
                  db,
                  "dimension",
                  {
                    companyGroupId,
                    active: true,
                    entityType: [
                      "Customer",
                      "CustomerType",
                      "Item",
                      "ItemPostingGroup",
                      "Location",
                      "CostCenter",
                      "FixedAssetClass"
                    ]
                  },
                  { columns: ["id", "entityType"] }
                )
              : null;

            const dimensionMap = new Map<string, string>();
            if (dimensions?.data) {
              for (const dim of dimensions.data) {
                if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
              }
            }

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];

            // The journal's facts; the lines are built once the
            // transaction has relieved each item's cost.
            const journalShipmentLines: SalesShipmentLine[] = [];
            const fixedAssetSales: FixedAssetSale[] = [];

            const jobUpdates: Record<
              string,
              Database["public"]["Tables"]["job"]["Update"]
            > = {};

            const serialNumbersConsumed: string[] = [];

            const locationId = shipmentHeader.locationId;

            // A serial or batch leaves the bin it actually holds stock in; the
            // line's bin is only a default. A unit whose bin cannot cover the
            // quantity is refused rather than driving that bin negative.
            const trackedEntityBins = await getTrackedEntityBins(db, {
              trackedEntityIds: (shipmentLineTracking.data ?? []).map(
                (tracking) => tracking.id
              ),
              locationIds: [
                ...new Set(
                  shipmentLines.data.flatMap(
                    (line) => line.locationId ?? locationId ?? []
                  )
                )
              ],
              companyId
            });
            const sourceBin = (
              trackedEntityId: string | undefined,
              lineLocationId: string | null,
              quantity: number
            ): string | null => {
              const bin =
                trackedEntityId && lineLocationId
                  ? trackedEntityBins(trackedEntityId, lineLocationId)
                  : undefined;
              if (!bin || round(bin.quantity) < round(quantity)) {
                const readableId =
                  shipmentLineTracking.data?.find(
                    (tracking) => tracking.id === trackedEntityId
                  )?.readableId ??
                  trackedEntityId ??
                  "A tracked item";
                throw new Error(
                  bin
                    ? `${readableId} has only ${round(bin.quantity)} in one storage unit, ${round(quantity)} needed. Move it into one storage unit first`
                    : `${readableId} has no stock to ship at this location`
                );
              }
              return bin.storageUnitId;
            };

            for await (const shipmentLine of shipmentLines.data) {
              if (
                shipmentLine.fulfillment?.type === "Job" &&
                shipmentLine.fulfillment?.jobId
              ) {
                // Update quantity shipped on job, accumulating totals from multiple shipments
                const jobId = shipmentLine.fulfillment.jobId;
                const currentJob = jobs.data.find((j) => j.id === jobId);

                // Log job and shipment line data to debug NaN issues
                logger.info("Processing job update:", {
                  jobId,
                  currentJob: currentJob
                    ? {
                        id: currentJob.id,
                        quantity: currentJob.quantity,
                        quantityShipped: currentJob.quantityShipped,
                        quantityComplete: currentJob.quantityComplete,
                        status: currentJob.status
                      }
                    : null,
                  shipmentLine: {
                    id: shipmentLine.id,
                    shippedQuantity: shipmentLine.shippedQuantity,
                    shippedQuantityType: typeof shipmentLine.shippedQuantity
                  }
                });

                const currentQuantityShipped = currentJob?.quantityShipped ?? 0;

                // Ensure shippedQuantity is a valid number to prevent "100NaN" errors
                const shippedQuantity =
                  typeof shipmentLine.shippedQuantity === "number" &&
                  !isNaN(shipmentLine.shippedQuantity)
                    ? shipmentLine.shippedQuantity
                    : 0;

                logger.info("Calculated values:", {
                  currentQuantityShipped,
                  shippedQuantity,
                  newTotal: currentQuantityShipped + shippedQuantity,
                  jobQuantity: currentJob?.quantity
                });

                // If we've already updated this job in this transaction, use that as the base
                // instead of the current DB value to avoid double counting
                if (jobUpdates[jobId]) {
                  const newQuantityShipped =
                    (jobUpdates[jobId]?.quantityShipped ?? 0) + shippedQuantity;
                  const newQuantityComplete =
                    currentJob?.status === "Completed"
                      ? currentJob?.quantityComplete
                      : Math.max(
                          currentJob?.quantityComplete ?? 0,
                          shippedQuantity
                        );
                  const newStatus =
                    currentQuantityShipped + shippedQuantity >=
                    (currentJob?.quantity ?? 0)
                      ? "Completed"
                      : currentJob?.status;

                  logger.info("Updating existing job update:", {
                    jobId,
                    previousUpdate: jobUpdates[jobId],
                    newUpdate: {
                      status: newStatus,
                      quantityComplete: newQuantityComplete,
                      quantityShipped: newQuantityShipped
                    }
                  });

                  jobUpdates[jobId] = {
                    status: newStatus,
                    quantityComplete: newQuantityComplete,
                    quantityShipped: newQuantityShipped
                  };
                } else {
                  const newQuantityShipped =
                    currentQuantityShipped + shippedQuantity;
                  const newQuantityComplete =
                    currentJob?.status === "Completed"
                      ? currentJob?.quantityComplete
                      : Math.max(
                          currentJob?.quantityComplete ?? 0,
                          shippedQuantity
                        );
                  const newStatus =
                    currentQuantityShipped + shippedQuantity >=
                    (currentJob?.quantity ?? 0)
                      ? "Completed"
                      : currentJob?.status;

                  logger.info("Creating new job update:", {
                    jobId,
                    update: {
                      status: newStatus,
                      quantityComplete: newQuantityComplete,
                      quantityShipped: newQuantityShipped
                    }
                  });

                  jobUpdates[jobId] = {
                    status: newStatus,
                    quantityComplete: newQuantityComplete,
                    quantityShipped: newQuantityShipped
                  };
                }
              }

              const shipmentLineItem = items.data.find(
                (item) => item.id === shipmentLine.itemId
              );
              const itemTrackingType =
                shipmentLineItem?.itemTrackingType ?? "Inventory";

              // Default shippedQuantity to 0 if not defined or NaN
              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              if (itemTrackingType === "Inventory") {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity),
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipmentHeader.id ?? undefined,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId
                });
              }

              if (shipmentLine.requiresBatchTracking) {
                const batchId = shipmentLineTracking.data?.find(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                )?.id;
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity),
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: sourceBin(
                    batchId,
                    shipmentLine.locationId ?? locationId,
                    shippedQuantity
                  ),
                  entryType: "Negative Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipmentHeader.id ?? undefined,
                  trackedEntityId: batchId,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId
                });
              }

              if (shipmentLine.requiresSerialTracking) {
                const lineTracking = shipmentLineTracking.data?.filter(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                );

                lineTracking?.forEach((tracking) => {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: -1,
                    locationId: shipmentLine.locationId ?? locationId,
                    storageUnitId: sourceBin(
                      tracking.id,
                      shipmentLine.locationId ?? locationId,
                      1
                    ),
                    entryType: "Negative Adjmt.",
                    documentType: "Sales Shipment",
                    documentId: shipmentHeader.id ?? undefined,
                    trackedEntityId: tracking.id,
                    externalDocumentId: undefined,
                    createdBy: userId,
                    companyId
                  });

                  if (tracking.id) {
                    serialNumbersConsumed.push(tracking.id);
                  }
                });
              }

              journalShipmentLines.push({
                shipmentLineId: shipmentLine.id,
                itemId: shipmentLine.itemId,
                shippedQuantity,
                itemTrackingType,
                replenishmentSystem:
                  shipmentLineItem?.replenishmentSystem ?? null,
                itemPostingGroupId:
                  itemCosts.data.find(
                    (cost) => cost.itemId === shipmentLine.itemId
                  )?.itemPostingGroupId ?? null,
                locationId: shipmentLine.locationId ?? locationId ?? null
              });
            }

            const shipmentLinesBySalesOrderLineId = shipmentLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["shipmentLine"]["Row"][]
              >
            >((acc, shipmentLine) => {
              if (shipmentLine.lineId) {
                acc[shipmentLine.lineId] = [
                  ...(acc[shipmentLine.lineId] ?? []),
                  shipmentLine
                ];
              }
              return acc;
            }, {});

            const salesOrderLineUpdates = salesOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["salesOrderLine"]["Update"]
              >
            >((acc, salesOrderLine) => {
              const shipmentLines =
                shipmentLinesBySalesOrderLineId[salesOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                salesOrderLine.saleQuantity &&
                salesOrderLine.saleQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                const newQuantitySent =
                  (salesOrderLine.quantitySent ?? 0) + shippedQuantity;

                const sentComplete =
                  salesOrderLine.sentComplete ||
                  newQuantitySent >= salesOrderLine.saleQuantity;

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["salesOrderLine"]["Update"]
                > = {
                  ...acc,
                  [salesOrderLine.id]: {
                    quantitySent: newQuantitySent,
                    sentComplete
                  }
                };

                if (sentComplete && !salesOrderLine.sentDate) {
                  updates[salesOrderLine.id]!.sentDate = today;
                }

                return updates;
              }

              return acc;
            }, {});

            // Process Fixed Asset SO lines (no shipment lines — handled directly from SO)
            const { data: shipmentFaLines } = await many(
              db,
              "shipmentFixedAssetLine",
              { shipmentId, shipped: true, companyId },
              { columns: ["salesOrderLineId", "serialNumber"] }
            );
            const shippedFaSoLineIds = new Set(
              (shipmentFaLines ?? [])
                .filter((r) => r.salesOrderLineId !== null)
                .map((r) => r.salesOrderLineId)
            );

            const faSalesOrderLines = salesOrderLines.data.filter(
              (sol) =>
                sol.salesOrderLineType === "Fixed Asset" &&
                sol.assetId &&
                !sol.sentComplete &&
                sol.saleQuantity &&
                sol.saleQuantity > 0 &&
                shippedFaSoLineIds.has(sol.id)
            );

            for (const faSoLine of faSalesOrderLines) {
              const assetRecord = await single<
                "fixedAsset",
                Pick<
                  Tables["fixedAsset"]["Row"],
                  | "id"
                  | "status"
                  | "acquisitionCost"
                  | "accumulatedDepreciation"
                  | "locationId"
                  | "fixedAssetClassId"
                > & {
                  fixedAssetClass: Pick<
                    Tables["fixedAssetClass"]["Row"],
                    | "assetAccountId"
                    | "accumulatedDepreciationAccountId"
                    | "writeOffAccountId"
                  > | null;
                }
              >(
                db,
                "fixedAsset",
                { companyId, id: faSoLine.assetId! },
                {
                  columns: [
                    "id",
                    "status",
                    "acquisitionCost",
                    "accumulatedDepreciation",
                    "locationId",
                    "fixedAssetClassId"
                  ],
                  embed: {
                    fixedAssetClass: {
                      table: "fixedAssetClass",
                      via: "fixedAssetClassId",
                      columns: [
                        "assetAccountId",
                        "accumulatedDepreciationAccountId",
                        "writeOffAccountId"
                      ]
                    }
                  }
                }
              );

              if (assetRecord.error)
                throw new Error("Failed to fetch fixed asset for disposal");
              fixedAssetWrites.overlay(faSoLine.assetId!, assetRecord.data);

              const assetClass = assetRecord.data.fixedAssetClass!;
              const fixedAssetSale: FixedAssetSale = {
                salesOrderLineId: faSoLine.id,
                acquisitionCost: Number(assetRecord.data.acquisitionCost),
                accumulatedDepreciation: Number(
                  assetRecord.data.accumulatedDepreciation
                ),
                assetAccountId: assetClass.assetAccountId,
                accumulatedDepreciationAccountId:
                  assetClass.accumulatedDepreciationAccountId,
                writeOffAccountId: assetClass.writeOffAccountId,
                locationId: locationId ?? assetRecord.data.locationId ?? null,
                fixedAssetClassId: assetRecord.data.fixedAssetClassId ?? null
              };
              fixedAssetSales.push(fixedAssetSale);
              const nbv = netBookValue(fixedAssetSale);

              fixedAssetWrites.patch(faSoLine.assetId!, {
                status: "Disposed",
                disposalDate: today,
                disposalMethod: "Sale",
                updatedBy: userId
              });

              const disposal: Database["public"]["Tables"]["fixedAssetDisposal"]["Insert"] =
                {
                  fixedAssetId: faSoLine.assetId!,
                  disposalMethod: "Sale",
                  disposalDate: today,
                  saleProceeds: 0,
                  netBookValueAtDisposal: nbv,
                  // Gain/loss is unknown until proceeds are invoiced; the NBV is
                  // held in the disposal clearing account, not expensed, so we
                  // record 0 here (the invoice sets the real gain/loss).
                  gainLoss: 0,
                  companyId,
                  createdBy: userId
                };
              fixedAssetWrites.defer((trx) =>
                insertRows(trx, "fixedAssetDisposal", disposal)
              );

              salesOrderLineUpdates[faSoLine.id] = {
                quantitySent: faSoLine.saleQuantity,
                sentComplete: true,
                sentDate: today
              };
            }

            const trackedEntitySplits: Record<
              string,
              {
                originalEntityId: string;
                originalQuantity: number;
                shippedQuantity: number;
                remainingQuantity: number;
                readableId: string | null;
                attributes: TrackedEntityAttributes;
                sourceDocument: string;
                sourceDocumentId: string;
                sourceDocumentReadableId: string | null;
                companyId: string;
                itemId: string | null;
                expirationDate: string | null;
              }
            > = {};

            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                const shipmentLine = shipmentLines.data?.find(
                  (shipmentLine) =>
                    shipmentLine.id ===
                    (trackedEntity.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                );

                // Round both, then ask isFullDraw first: a residue lot
                // (holding 0.020000000000000018 after an earlier split)
                // shipped in full reads as `shipped < quantity` on a raw
                // compare, and the split loop below then throws the builder's
                // `draw >= parentQty` guard on a legitimate full shipment.
                const entityQuantity = round(Number(trackedEntity.quantity));
                const shippedQuantity = round(
                  Number(shipmentLine?.shippedQuantity)
                );
                if (
                  shipmentLine?.shippedQuantity !== undefined &&
                  trackedEntity.quantity !== undefined &&
                  !isFullDraw(entityQuantity, shippedQuantity) &&
                  shippedQuantity < entityQuantity
                ) {
                  // Partial shipment → split. The shelf entity keeps its id
                  // and is only decremented (split loop below); the SHIPPED
                  // portion departs as a new Consumed child. No Consumed
                  // update on the parent here.
                  trackedEntitySplits[trackedEntity.id] = {
                    originalEntityId: trackedEntity.id,
                    originalQuantity: entityQuantity,
                    shippedQuantity,
                    remainingQuantity: round(entityQuantity - shippedQuantity),
                    readableId: trackedEntity.readableId,
                    attributes:
                      trackedEntity.attributes as TrackedEntityAttributes,
                    sourceDocument: trackedEntity.sourceDocument,
                    sourceDocumentId: trackedEntity.sourceDocumentId,
                    sourceDocumentReadableId:
                      trackedEntity.sourceDocumentReadableId,
                    companyId: trackedEntity.companyId,
                    itemId: trackedEntity.itemId ?? null,
                    expirationDate: trackedEntity.expirationDate ?? null
                  };
                  return acc;
                }

                acc[trackedEntity.id] = {
                  status: "Consumed",
                  // Keep the ?? fallback exactly as it was and just round it:
                  // a null shippedQuantity must still fall through to the
                  // entity's own quantity, which `!== undefined` would not do.
                  quantity: round(
                    Number(
                      shipmentLine?.shippedQuantity ?? trackedEntity.quantity
                    )
                  )
                };

                return acc;
              }, {}) ?? {};

            // Resolve accounting period BEFORE opening the Kysely transaction.
            // getCurrentAccountingPeriod uses the Supabase REST client; calling
            // it mid-transaction parks the pg connection in idle-in-transaction
            // (ClientRead) while the REST hop runs, and any hang there leaves
            // an orphan that exhausts the pool (size 1) for every subsequent
            // post-shipment invocation. A Provisional journal has no
            // accounting period.
            const accountingPeriodId =
              postingStatus === "Posted"
                ? await getCurrentAccountingPeriod(companyId, db, today)
                : null;

            await db.transaction().execute(async (trx) => {
              await assertPostingStatusUnchanged(trx, companyId, postingStatus);
              await fixedAssetWrites.apply(trx, companyId);
              for await (const [salesOrderLineId, update] of Object.entries(
                salesOrderLineUpdates
              )) {
                await trx
                  .updateTable("salesOrderLine")
                  .set(update)
                  .where("id", "=", salesOrderLineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              const salesOrderLines = await trx
                .selectFrom("salesOrderLine")
                .select([
                  "id",
                  "salesOrderLineType",
                  "invoicedComplete",
                  "sentComplete"
                ])
                .where("salesOrderId", "=", salesOrder.data.id)
                .execute();

              const areAllLinesInvoiced = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" || line.invoicedComplete
              );

              const areAllLinesShipped = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" ||
                  line.salesOrderLineType === "Service" ||
                  line.sentComplete
              );

              let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
                "To Ship and Invoice";
              if (areAllLinesInvoiced && areAllLinesShipped) {
                status = "Completed";
              } else if (areAllLinesShipped) {
                status = "To Invoice";
              } else if (areAllLinesInvoiced) {
                status = "To Ship";
              }

              await trx
                .updateTable("salesOrder")
                .set({
                  status
                })
                .where("id", "=", salesOrder.data.id)
                .where("companyId", "=", companyId)
                .execute();

              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();

              if (
                Object.keys(trackedEntityUpdates).length > 0 ||
                Object.keys(trackedEntitySplits).length > 0
              ) {
                const trackedActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Sales Order": salesOrder.data.id
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .returning(["id"])
                  .execute();

                const trackedActivityId = trackedActivity[0]!.id;

                // Handle batch splits first: the shelf entity keeps its id
                // and is decremented; the SHIPPED portion departs as a new
                // Consumed child carrying the shipment attributes.
                for await (const splitInfo of Object.values(
                  trackedEntitySplits
                )) {
                  const shipmentLine = shipmentLines.data.find(
                    (sl) =>
                      sl.id ===
                      (splitInfo.attributes as TrackedEntityAttributes)?.[
                        "Shipment Line"
                      ]
                  );

                  const shippedChildId = nanoid();
                  const parentAttributes = (splitInfo.attributes ??
                    {}) as Record<string, unknown>;

                  const split = buildBatchSplitRecords({
                    parent: {
                      id: splitInfo.originalEntityId,
                      readableId: splitInfo.readableId,
                      quantity: splitInfo.originalQuantity,
                      sourceDocument: splitInfo.sourceDocument,
                      sourceDocumentId: splitInfo.sourceDocumentId,
                      sourceDocumentReadableId:
                        splitInfo.sourceDocumentReadableId,
                      itemId: splitInfo.itemId,
                      expirationDate: splitInfo.expirationDate,
                      attributes: parentAttributes
                    },
                    drawQuantity: splitInfo.shippedQuantity,
                    childId: shippedChildId,
                    splitActivityId: nanoid(),
                    activitySourceDocument: "Shipment",
                    activitySourceDocumentId: shipmentId,
                    // The same bin the shipment's own row draws from.
                    bin: {
                      storageUnitId: sourceBin(
                        splitInfo.originalEntityId,
                        shipmentLine?.locationId ?? locationId,
                        splitInfo.shippedQuantity
                      ),
                      locationId
                    },
                    itemLedgerItemId: shipmentLine?.itemId ?? null,
                    companyId: splitInfo.companyId,
                    userId,
                    postingDate: today,
                    childStatus: "Consumed"
                  });

                  await trx
                    .insertInto("trackedActivity")
                    .values({
                      ...split.activityInsert,
                      attributes: split.activityInsert
                        .attributes as unknown as Json,
                      sourceDocumentReadableId: shipmentHeader.shipmentId,
                      createdAt: today
                    })
                    .execute();

                  await trx
                    .insertInto("trackedEntity")
                    .values({
                      ...split.childEntityInsert,
                      attributes: split.childEntityInsert
                        .attributes as unknown as Json,
                      createdAt: today
                    } as Insertable<KyselyDatabase["trackedEntity"]>)
                    .execute();

                  await trx
                    .insertInto("trackedActivityInput")
                    .values({
                      ...split.activityInputInsert,
                      createdAt: today
                    })
                    .execute();

                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      ...split.activityOutputInsert,
                      createdAt: today
                    })
                    .execute();

                  // The retained parent is only decremented and LOSES the
                  // shipment attributes — they belong to the shipped child.
                  const retainedAttributes = { ...parentAttributes };
                  delete retainedAttributes.Shipment;
                  delete retainedAttributes["Shipment Line"];
                  delete retainedAttributes["Shipment Line Index"];

                  await trx
                    .updateTable("trackedEntity")
                    .set({
                      quantity: split.parentUpdate.quantity,
                      attributes: retainedAttributes as unknown as Json
                    })
                    .where("id", "=", splitInfo.originalEntityId)
                    .where("companyId", "=", companyId)
                    .execute();

                  itemLedgerInserts.push(
                    ...(split.ledgerInserts.map((ledgerRow) => ({
                      ...ledgerRow,
                      quantity: round(ledgerRow.quantity)
                    })) as typeof itemLedgerInserts)
                  );

                  // The shipment's own ledger rows (built per line above)
                  // and its activity input book against the shipped child.
                  for (const ledger of itemLedgerInserts) {
                    if (
                      ledger.documentType === "Sales Shipment" &&
                      ledger.trackedEntityId === splitInfo.originalEntityId
                    ) {
                      ledger.trackedEntityId = shippedChildId;
                    }
                  }

                  if (trackedActivityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId,
                        trackedEntityId: shippedChildId,
                        quantity: splitInfo.shippedQuantity,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }

                  // Auto-print/labels retarget to the RETAINED parent (its
                  // quantity changed); the shipped child needs no label.
                  splitEntityIds.push(splitInfo.originalEntityId);
                }

                // Now handle the shipment consumption (full-quantity lots)
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
                )) {
                  await trx
                    .updateTable("trackedEntity")
                    .set(update)
                    .where("id", "=", id)
                    .where("companyId", "=", companyId)
                    .execute();

                  if (trackedActivityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId,
                        trackedEntityId: id,
                        quantity: update.quantity ?? 0,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
              }

              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              if (Object.keys(jobUpdates).length > 0) {
                logger.info("Final job updates to be applied:", jobUpdates);
                for await (const [jobId, update] of Object.entries(
                  jobUpdates
                )) {
                  logger.info(`Updating job ${jobId} with:`, update);
                  await trx
                    .updateTable("job")
                    .set(update)
                    .where("id", "=", jobId)
                    .where("companyId", "=", companyId)
                    .execute();
                }
              }

              // Relieve each item's cost, then write the journal.
              const relievedCostByItem = new Map<string, number>();
              for (const [itemId, quantity] of shippedQuantityByItem(
                journalShipmentLines
              )) {
                const cogsResult = await calculateCOGS(trx, {
                  itemId,
                  quantity,
                  companyId,
                  trackedEntityIds: leavingTrackedEntityIds(
                    itemLedgerInserts,
                    itemId
                  )
                });
                relievedCostByItem.set(itemId, cogsResult.totalCost);

                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: "Sale",
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Sales Shipment",
                    documentId: shipmentHeader.id ?? "",
                    itemId,
                    quantity: round(-quantity),
                    cost: round(-cogsResult.totalCost),
                    remainingQuantity: 0,
                    companyId,
                    postingDate: today
                  })
                  .execute();
              }

              const journal = buildSalesShipmentJournal({
                shipmentId: shipmentHeader.id,
                shipmentReadableId: shipmentHeader.shipmentId,
                externalDocumentId: salesOrder.data.customerReference,
                customerId: salesOrder.data.customerId,
                customerTypeId: customer.data.customerTypeId ?? null,
                defaults: accountDefaults.data,
                lines: journalShipmentLines,
                relievedCostByItem,
                fixedAssetSales
              });
              if (journal.lines.length > 0) {
                await insertShipmentJournal(trx, {
                  journal,
                  accountingPeriodId,
                  postingDate: today,
                  postingStatus,
                  dimensionIdByEntity: dimensionMap,
                  companyId,
                  userId
                });
              }
            });
            break;
          }
          case "Purchase Order": {
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [purchaseOrder, purchaseOrderLines] = await inOrder([
              () =>
                single(db, "purchaseOrder", {
                  id: shipmentHeader.sourceDocumentId
                }),
              () =>
                many(db, "purchaseOrderLine", {
                  purchaseOrderId: shipmentHeader.sourceDocumentId
                })
            ]);
            if (purchaseOrder.error)
              throw new Error("Failed to fetch purchase order");
            if (purchaseOrderLines.error)
              throw new Error("Failed to fetch purchase order lines");

            const supplier = await single(db, "supplier", {
              id: purchaseOrder.data.supplierId,
              companyId
            });
            if (supplier.error) throw new Error("Failed to fetch supplier");

            const jobOperationsUpdates: Record<
              string,
              Database["public"]["Tables"]["jobOperation"]["Update"]
            > = {};

            for await (const shipmentLine of shipmentLines.data) {
              const purchaseOrderLine = purchaseOrderLines.data.find(
                (pol) => pol.id === shipmentLine.lineId
              );

              if (
                purchaseOrderLine?.jobId &&
                purchaseOrderLine.jobOperationId
              ) {
                // Update quantity shipped on job, accumulating totals from multiple shipments
                const jobOperationId = purchaseOrderLine.jobOperationId;

                jobOperationsUpdates[jobOperationId] = {
                  status: "In Progress"
                };
                continue;
              }
            }

            const shipmentLinesByPurchaseOrderLineId =
              shipmentLines.data.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["shipmentLine"]["Row"][]
                >
              >((acc, shipmentLine) => {
                if (shipmentLine.lineId) {
                  acc[shipmentLine.lineId] = [
                    ...(acc[shipmentLine.lineId] ?? []),
                    shipmentLine
                  ];
                }
                return acc;
              }, {});

            const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const shipmentLines =
                shipmentLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                const newQuantityShipped =
                  (purchaseOrderLine.quantityShipped ?? 0) + shippedQuantity;

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
                > = {
                  ...acc,
                  [purchaseOrderLine.id]: {
                    quantityShipped: newQuantityShipped
                  }
                };

                return updates;
              }

              return acc;
            }, {});

            const trackedEntitySplits: Record<
              string,
              {
                originalEntityId: string;
                originalQuantity: number;
                shippedQuantity: number;
                remainingQuantity: number;
                readableId: string | null;
                attributes: TrackedEntityAttributes;
                sourceDocument: string;
                sourceDocumentId: string;
                sourceDocumentReadableId: string | null;
                companyId: string;
                itemId: string | null;
                expirationDate: string | null;
              }
            > = {};

            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                const shipmentLine = shipmentLines.data?.find(
                  (shipmentLine) =>
                    shipmentLine.id ===
                    (trackedEntity.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                );

                // Round both, then ask isFullDraw first: a residue lot
                // (holding 0.020000000000000018 after an earlier split)
                // shipped in full reads as `shipped < quantity` on a raw
                // compare, and the split loop below then throws the builder's
                // `draw >= parentQty` guard on a legitimate full shipment.
                const entityQuantity = round(Number(trackedEntity.quantity));
                const shippedQuantity = round(
                  Number(shipmentLine?.shippedQuantity)
                );
                if (
                  shipmentLine?.shippedQuantity !== undefined &&
                  trackedEntity.quantity !== undefined &&
                  !isFullDraw(entityQuantity, shippedQuantity) &&
                  shippedQuantity < entityQuantity
                ) {
                  // Partial shipment → split. The shelf entity keeps its id
                  // and is only decremented (split loop below); the SHIPPED
                  // portion departs as a new Consumed child. No update on
                  // the parent here.
                  trackedEntitySplits[trackedEntity.id] = {
                    originalEntityId: trackedEntity.id,
                    originalQuantity: entityQuantity,
                    shippedQuantity,
                    remainingQuantity: round(entityQuantity - shippedQuantity),
                    readableId: trackedEntity.readableId,
                    attributes:
                      trackedEntity.attributes as TrackedEntityAttributes,
                    sourceDocument: trackedEntity.sourceDocument,
                    sourceDocumentId: trackedEntity.sourceDocumentId,
                    sourceDocumentReadableId:
                      trackedEntity.sourceDocumentReadableId,
                    companyId: trackedEntity.companyId,
                    itemId: trackedEntity.itemId ?? null,
                    expirationDate: trackedEntity.expirationDate ?? null
                  };
                  return acc;
                }

                acc[trackedEntity.id] = {
                  // Keep the ?? fallback exactly as it was and just round it:
                  // a null shippedQuantity must still fall through to the
                  // entity's own quantity, which `!== undefined` would not do.
                  quantity: round(
                    Number(
                      shipmentLine?.shippedQuantity ?? trackedEntity.quantity
                    )
                  )
                };

                return acc;
              }, {}) ?? {};

            await db.transaction().execute(async (trx) => {
              for await (const [purchaseOrderLineId, update] of Object.entries(
                purchaseOrderLineUpdates
              )) {
                await trx
                  .updateTable("purchaseOrderLine")
                  .set(update)
                  .where("id", "=", purchaseOrderLineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();

              if (
                Object.keys(trackedEntityUpdates).length > 0 ||
                Object.keys(trackedEntitySplits).length > 0
              ) {
                const trackedActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Purchase Order": purchaseOrder.data.id
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .returning(["id"])
                  .execute();

                const trackedActivityId = trackedActivity[0]!.id;

                // Handle batch splits first: the shelf entity keeps its id
                // and is decremented; the SHIPPED portion departs as a new
                // Consumed child carrying the shipment attributes. This PO-
                // sourced path posts NO itemLedger for the split (matching the
                // pre-flip behavior — a PO/subcontract shipment's inventory
                // movement is not booked here); only genealogy + quantities.
                for await (const splitInfo of Object.values(
                  trackedEntitySplits
                )) {
                  const shipmentLine = shipmentLines.data.find(
                    (sl) =>
                      sl.id ===
                      (splitInfo.attributes as TrackedEntityAttributes)?.[
                        "Shipment Line"
                      ]
                  );

                  const shippedChildId = nanoid();
                  const parentAttributes = (splitInfo.attributes ??
                    {}) as Record<string, unknown>;

                  const split = buildBatchSplitRecords({
                    parent: {
                      id: splitInfo.originalEntityId,
                      readableId: splitInfo.readableId,
                      quantity: splitInfo.originalQuantity,
                      sourceDocument: splitInfo.sourceDocument,
                      sourceDocumentId: splitInfo.sourceDocumentId,
                      sourceDocumentReadableId:
                        splitInfo.sourceDocumentReadableId,
                      itemId: splitInfo.itemId,
                      expirationDate: splitInfo.expirationDate,
                      attributes: parentAttributes
                    },
                    drawQuantity: splitInfo.shippedQuantity,
                    childId: shippedChildId,
                    splitActivityId: nanoid(),
                    activitySourceDocument: "Shipment",
                    activitySourceDocumentId: shipmentId,
                    bin: {
                      storageUnitId: shipmentLine?.storageUnitId ?? null,
                      locationId: shipmentHeader.locationId
                    },
                    itemLedgerItemId: shipmentLine?.itemId ?? null,
                    companyId: splitInfo.companyId,
                    userId,
                    postingDate: today,
                    childStatus: "Consumed"
                  });

                  await trx
                    .insertInto("trackedActivity")
                    .values({
                      ...split.activityInsert,
                      attributes: split.activityInsert
                        .attributes as unknown as Json,
                      sourceDocumentReadableId: shipmentHeader.shipmentId,
                      createdAt: today
                    })
                    .execute();

                  await trx
                    .insertInto("trackedEntity")
                    .values({
                      ...split.childEntityInsert,
                      attributes: split.childEntityInsert
                        .attributes as unknown as Json,
                      createdAt: today
                    } as Insertable<KyselyDatabase["trackedEntity"]>)
                    .execute();

                  await trx
                    .insertInto("trackedActivityInput")
                    .values({
                      ...split.activityInputInsert,
                      createdAt: today
                    })
                    .execute();

                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      ...split.activityOutputInsert,
                      createdAt: today
                    })
                    .execute();

                  // The retained parent is only decremented and LOSES the
                  // shipment attributes — they belong to the shipped child.
                  const retainedAttributes = { ...parentAttributes };
                  delete retainedAttributes.Shipment;
                  delete retainedAttributes["Shipment Line"];
                  delete retainedAttributes["Shipment Line Index"];

                  await trx
                    .updateTable("trackedEntity")
                    .set({
                      quantity: split.parentUpdate.quantity,
                      attributes: retainedAttributes as unknown as Json
                    })
                    .where("id", "=", splitInfo.originalEntityId)
                    .where("companyId", "=", companyId)
                    .execute();

                  if (trackedActivityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId,
                        trackedEntityId: shippedChildId,
                        quantity: splitInfo.shippedQuantity,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }

                  // Auto-print/labels retarget to the RETAINED parent (its
                  // quantity changed); the shipped child needs no label.
                  splitEntityIds.push(splitInfo.originalEntityId);
                }

                // Now handle the shipment consumption (full-quantity lots)
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
                )) {
                  await trx
                    .updateTable("trackedEntity")
                    .set(update)
                    .where("id", "=", id)
                    .where("companyId", "=", companyId)
                    .execute();

                  if (trackedActivityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId,
                        trackedEntityId: id,
                        quantity: update.quantity ?? 0,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
              }

              if (Object.keys(jobOperationsUpdates).length > 0) {
                logger.info(
                  "Final job updates to be applied:",
                  jobOperationsUpdates
                );
                for await (const [jobOperationId, update] of Object.entries(
                  jobOperationsUpdates
                )) {
                  logger.info(
                    `Updating job operation ${jobOperationId} with:`,
                    update
                  );
                  await trx
                    .updateTable("jobOperation")
                    .set(update)
                    .where("id", "=", jobOperationId)
                    .where("companyId", "=", companyId)
                    .execute();
                }
              }
            });
            break;
          }
          case "Outbound Transfer": {
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [warehouseTransfer, warehouseTransferLines] = await inOrder([
              () =>
                single(db, "warehouseTransfer", {
                  id: shipmentHeader.sourceDocumentId
                }),
              () =>
                many(db, "warehouseTransferLine", {
                  transferId: shipmentHeader.sourceDocumentId
                })
            ]);

            if (warehouseTransfer.error)
              throw new Error("Failed to fetch warehouse transfer");
            if (warehouseTransferLines.error)
              throw new Error("Failed to fetch warehouse transfer lines");

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const warehouseTransferLineUpdates: Record<
              string,
              Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
            > = {};

            // Process each shipment line
            for await (const shipmentLine of shipmentLines.data) {
              const warehouseTransferLine = warehouseTransferLines.data.find(
                (line) => line.id === shipmentLine.lineId
              );

              if (!warehouseTransferLine) continue;

              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              // Update warehouse transfer line shipped quantity
              const newShippedQuantity =
                (warehouseTransferLine.shippedQuantity ?? 0) + shippedQuantity;

              warehouseTransferLineUpdates[warehouseTransferLine.id] = {
                shippedQuantity: newShippedQuantity
              };

              // Create item ledger entry for negative adjustment at source
              if (shippedQuantity !== 0) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity), // Negative for outbound transfer
                  locationId: shipmentLine.locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Transfer",
                  documentType: "Transfer Shipment",
                  documentId: warehouseTransfer.data?.transferId,
                  externalDocumentId:
                    shipmentHeader.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId
                });
              }
            }

            // Check if all lines are fully shipped
            const allLinesFullyShipped = warehouseTransferLines.data.every(
              (line) => {
                const updates = warehouseTransferLineUpdates[line.id];
                const shippedQty =
                  updates?.shippedQuantity ?? line.shippedQuantity ?? 0;
                return shippedQty >= (line.quantity ?? 0);
              }
            );

            // Check if all lines are fully received
            const allLinesFullyReceived = warehouseTransferLines.data.every(
              (line) => {
                const receivedQty = line.receivedQuantity ?? 0;
                return receivedQty >= (line.quantity ?? 0);
              }
            );

            // Determine new warehouse transfer status
            let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
              warehouseTransfer.data.status;

            if (allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "Completed";
            } else if (allLinesFullyShipped && !allLinesFullyReceived) {
              newStatus = "To Receive";
            } else if (!allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "To Ship";
            }

            await db.transaction().execute(async (trx) => {
              // Update warehouse transfer lines
              for await (const [lineId, update] of Object.entries(
                warehouseTransferLineUpdates
              )) {
                await trx
                  .updateTable("warehouseTransferLine")
                  .set(update)
                  .where("id", "=", lineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              // Update warehouse transfer status
              await trx
                .updateTable("warehouseTransfer")
                .set({
                  status: newStatus,
                  transferDate: today,
                  updatedBy: userId
                })
                .where("id", "=", warehouseTransfer.data.id)
                .where("companyId", "=", companyId)
                .execute();

              // Create item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update shipment status
              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            });

            break;
          }

          case "Sales Return Order": {
            // Return-to-customer: ships rejected-claim goods back out of the
            // returned (On Hold) stock at carried cost. Dr COGS / Cr Inventory.
            // No RMA quantity bumps — dispositions carry the line state.
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");
            const salesReturnOrderId = shipmentHeader.sourceDocumentId;

            const salesReturnOrder = await single(db, "salesReturnOrder", {
              id: salesReturnOrderId,
              companyId
            });
            if (salesReturnOrder.error)
              throw new Error("Failed to fetch sales return order");
            // Same allowlist as the create server function: goods can only ship
            // back once they came in. A Draft RMA has never had its caps
            // validated; Cancelled cannot ship.
            if (
              !["To Receive", "Completed"].includes(
                salesReturnOrder.data.status
              )
            )
              throw new Error(
                `Cannot ship against a return order in ${salesReturnOrder.data.status} status`
              );

            // Every shipment posts its journal: Provisional before the
            // company's accounting cutover, Posted after it. Read here to
            // decide whether to resolve a period, and again inside the
            // transaction.
            const postingStatus = await journalPostingStatus(db, companyId);

            const accountDefaults = await getDefaultPostingGroup(db, companyId);
            if (accountDefaults.error || !accountDefaults.data) {
              throw new Error("Error getting account defaults");
            }

            // GL dimensions for the return shipment journal (item, item group,
            // customer, customer type, location).
            const [company, customer] = await inOrder([
              () =>
                single(
                  db,
                  "company",
                  { id: companyId },
                  { columns: ["companyGroupId"] }
                ),
              () =>
                single(
                  db,
                  "customer",
                  { id: salesReturnOrder.data.customerId, companyId },
                  { columns: ["id", "customerTypeId"] }
                )
            ]);
            const dimensions = company?.data?.companyGroupId
              ? await many(
                  db,
                  "dimension",
                  {
                    companyGroupId: company.data.companyGroupId,
                    active: true,
                    entityType: [
                      "CustomerType",
                      "Customer",
                      "ItemPostingGroup",
                      "Item",
                      "Location"
                    ]
                  },
                  { columns: ["id", "entityType"] }
                )
              : null;
            const dimensionMap = new Map<string, string>();
            for (const dim of dimensions?.data ?? []) {
              if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
            }
            const customerTypeId = customer?.data?.customerTypeId ?? null;

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const trackedEntityUpdates: Record<
              string,
              {
                status: Database["public"]["Tables"]["trackedEntity"]["Row"]["status"];
                quantity: number;
              }
            > = {};
            const itemShipmentQuantities: Record<string, number> = {};

            for (const shipmentLine of shipmentLines.data) {
              if (!shipmentLine.itemId) continue;
              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;
              if (shippedQuantity <= 0) continue;

              const itemTrackingType =
                items.data.find((i) => i.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              // Non-Inventory lines have no stock and no carried cost —
              // posting them would book COGS/costLedger with zero inventory
              // movement (the Sales Order branch excludes them the same way).
              if (itemTrackingType === "Non-Inventory") continue;

              const lineEntities = (shipmentLineTracking.data ?? []).filter(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Shipment Line"] === shipmentLine.id
              );

              if (itemTrackingType === "Inventory") {
                itemShipmentQuantities[shipmentLine.itemId] =
                  (itemShipmentQuantities[shipmentLine.itemId] ?? 0) +
                  shippedQuantity;
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity),
                  locationId: shipmentLine.locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Sales Return Shipment",
                  documentId: shipmentHeader.id ?? undefined,
                  externalDocumentId:
                    shipmentHeader.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId
                });
              } else {
                // Whole-entity shipping (v1: return shipments do not split
                // partial batches — the picker picks whole entities). The
                // ledger writes one row per entity, so the entities must
                // account for the full shipped quantity — otherwise cost and
                // stock relief would diverge from what the line claims.
                const entitySum = lineEntities.reduce(
                  (sum, entity) => sum + Number(entity.quantity ?? 0),
                  0
                );
                if (Math.abs(entitySum - shippedQuantity) > 0.00001) {
                  throw new Error(
                    `Shipment line ${shipmentLine.id}: tracked entities account for ${entitySum} of ${shippedQuantity} shipped — assign tracking before posting`
                  );
                }
                itemShipmentQuantities[shipmentLine.itemId] =
                  (itemShipmentQuantities[shipmentLine.itemId] ?? 0) +
                  entitySum;
                for (const entity of lineEntities) {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: round(-(entity.quantity ?? 0)),
                    locationId: shipmentLine.locationId,
                    storageUnitId: shipmentLine.storageUnitId,
                    entryType: "Negative Adjmt.",
                    documentType: "Sales Return Shipment",
                    documentId: shipmentHeader.id ?? undefined,
                    trackedEntityId: entity.id,
                    externalDocumentId:
                      shipmentHeader.externalDocumentId ?? undefined,
                    createdBy: userId,
                    companyId
                  });
                  trackedEntityUpdates[entity.id] = {
                    status: "Consumed",
                    quantity: entity.quantity ?? 0
                  };
                }
              }
            }

            // A Provisional journal has no accounting period.
            const accountingPeriodId =
              postingStatus === "Posted"
                ? await getCurrentAccountingPeriod(companyId, db, today)
                : null;

            await db.transaction().execute(async (trx) => {
              // Double-post guard: serialize on the shipment row — a second
              // concurrent post waits here, then sees Posted and aborts, so
              // ledger rows and journals can never double.
              const lockedShipment = await trx
                .selectFrom("shipment")
                .select(["status"])
                .where("id", "=", shipmentId)
                .forUpdate()
                .executeTakeFirstOrThrow();
              if (
                lockedShipment.status === "Posted" ||
                lockedShipment.status === "Voided"
              ) {
                throw new Error(`Shipment is already ${lockedShipment.status}`);
              }

              await assertPostingStatusUnchanged(trx, companyId, postingStatus);

              const returnedItems: ReturnShipmentItem[] = [];
              for (const [itemId, quantity] of Object.entries(
                itemShipmentQuantities
              )) {
                const cogsResult = await calculateCOGS(trx, {
                  itemId,
                  quantity,
                  companyId,
                  trackedEntityIds: leavingTrackedEntityIds(
                    itemLedgerInserts,
                    itemId
                  )
                });

                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: "Sale",
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Sales Return Shipment",
                    documentId: shipmentHeader.id ?? undefined,
                    externalDocumentId:
                      shipmentHeader.externalDocumentId ?? undefined,
                    itemId,
                    quantity: round(-quantity),
                    cost: round(-cogsResult.totalCost),
                    nominalCost: round(-cogsResult.totalCost),
                    remainingQuantity: 0,
                    companyId,
                    postingDate: today
                  })
                  .execute();

                returnedItems.push({
                  itemId,
                  quantity,
                  cost: cogsResult.totalCost,
                  replenishmentSystem:
                    items.data.find((i) => i.id === itemId)
                      ?.replenishmentSystem ?? null,
                  itemPostingGroupId:
                    itemCosts.data.find((c) => c.itemId === itemId)
                      ?.itemPostingGroupId ?? null
                });
              }

              const journal = buildReturnShipmentJournal({
                sourceDocument: "Sales Return Order",
                shipmentId: shipmentHeader.id,
                shipmentReadableId: shipmentHeader.shipmentId,
                locationId: shipmentHeader.locationId,
                partyId: salesReturnOrder.data.customerId,
                partyTypeId: customerTypeId,
                defaults: accountDefaults.data,
                items: returnedItems
              });
              if (journal.lines.length > 0) {
                await insertShipmentJournal(trx, {
                  journal,
                  accountingPeriodId,
                  postingDate: today,
                  postingStatus,
                  dimensionIdByEntity: dimensionMap,
                  companyId,
                  userId
                });
              }

              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .execute();
              }

              if (Object.keys(trackedEntityUpdates).length > 0) {
                const activity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Return Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    attributes: {
                      "Sales Return Order": salesReturnOrderId,
                      Shipment: shipmentId,
                      Employee: userId
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .returning(["id"])
                  .execute();
                const activityId = activity[0]?.id;
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
                )) {
                  await trx
                    .updateTable("trackedEntity")
                    .set(update)
                    .where("id", "=", id)
                    .where("companyId", "=", companyId)
                    .execute();
                  if (activityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId: activityId,
                        trackedEntityId: id,
                        quantity: update.quantity ?? 0,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
              }

              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            });

            break;
          }

          case "Purchase Return Order": {
            // Supplier return: relieves inventory at carried cost against
            // GRNI (reverses the receipt posting). Cr Inventory / Dr GRNI.
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");
            const purchaseReturnOrderId = shipmentHeader.sourceDocumentId;

            const [purchaseReturnOrder, purchaseReturnOrderLines] =
              await inOrder([
                () =>
                  single(db, "purchaseReturnOrder", {
                    id: purchaseReturnOrderId,
                    companyId
                  }),
                () =>
                  many(db, "purchaseReturnOrderLine", {
                    purchaseReturnOrderId,
                    companyId
                  })
              ]);
            if (purchaseReturnOrder.error)
              throw new Error("Failed to fetch purchase return order");
            if (purchaseReturnOrderLines.error)
              throw new Error("Failed to fetch purchase return order lines");
            if (purchaseReturnOrder.data.status !== "To Ship")
              throw new Error(
                `Cannot ship against a return order in ${purchaseReturnOrder.data.status} status`
              );

            // Every shipment posts its journal: Provisional before the
            // company's accounting cutover, Posted after it. Read here to
            // decide whether to resolve a period, and again inside the
            // transaction.
            const postingStatus = await journalPostingStatus(db, companyId);

            const returnLineById = new Map(
              (purchaseReturnOrderLines.data ?? []).map((l) => [l.id, l])
            );

            const accountDefaults = await getDefaultPostingGroup(db, companyId);
            if (accountDefaults.error || !accountDefaults.data) {
              throw new Error("Error getting account defaults");
            }

            // GL dimensions for the return shipment journal (item, item group,
            // supplier, supplier type, location).
            const [company, supplier] = await inOrder([
              () =>
                single(
                  db,
                  "company",
                  { id: companyId },
                  { columns: ["companyGroupId"] }
                ),
              () =>
                single(
                  db,
                  "supplier",
                  { id: purchaseReturnOrder.data.supplierId, companyId },
                  { columns: ["id", "supplierTypeId"] }
                )
            ]);
            const dimensions = company?.data?.companyGroupId
              ? await many(
                  db,
                  "dimension",
                  {
                    companyGroupId: company.data.companyGroupId,
                    active: true,
                    entityType: [
                      "SupplierType",
                      "Supplier",
                      "ItemPostingGroup",
                      "Item",
                      "Location"
                    ]
                  },
                  { columns: ["id", "entityType"] }
                )
              : null;
            const dimensionMap = new Map<string, string>();
            for (const dim of dimensions?.data ?? []) {
              if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
            }
            const supplierTypeId = supplier?.data?.supplierTypeId ?? null;

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const trackedEntityUpdates: Record<
              string,
              {
                status: Database["public"]["Tables"]["trackedEntity"]["Row"]["status"];
                quantity: number;
              }
            > = {};
            const itemShipmentQuantities: Record<string, number> = {};
            const returnLineUpdates: Record<
              string,
              { quantityShipped: number; updatedBy: string }
            > = {};
            // A batch returned in part is split at post: the shelf entity keeps
            // its id and is decremented, the shipped portion departs as a new
            // Consumed child (mirrors the Sales Order path).
            const trackedEntitySplits: {
              entity: NonNullable<typeof shipmentLineTracking.data>[number];
              drawQuantity: number;
              storageUnitId: string | null;
              itemId: string | null;
              ledgerIndex: number;
            }[] = [];
            const splitChildEdges: { childId: string; quantity: number }[] = [];

            for (const shipmentLine of shipmentLines.data) {
              if (!shipmentLine.itemId || !shipmentLine.lineId) continue;
              const returnLine = returnLineById.get(shipmentLine.lineId);
              if (!returnLine)
                throw new Error(
                  `Shipment line ${shipmentLine.id} does not map to a return order line`
                );
              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;
              if (shippedQuantity <= 0) continue;

              const itemTrackingType =
                items.data.find((i) => i.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              const existingUpdate = returnLineUpdates[returnLine.id];
              returnLineUpdates[returnLine.id] = {
                quantityShipped:
                  (existingUpdate?.quantityShipped ??
                    Number(returnLine.quantityShipped ?? 0)) + shippedQuantity,
                updatedBy: userId
              };

              // Non-Inventory lines still advance the return line (so the
              // order can settle) but post no ledger, cost, or GL — there is
              // no stock or carried cost to relieve, and booking GRNI against
              // nothing diverges the books from stock.
              if (itemTrackingType === "Non-Inventory") continue;

              const lineEntities = (shipmentLineTracking.data ?? []).filter(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Shipment Line"] === shipmentLine.id
              );

              if (itemTrackingType === "Inventory") {
                itemShipmentQuantities[shipmentLine.itemId] =
                  (itemShipmentQuantities[shipmentLine.itemId] ?? 0) +
                  shippedQuantity;
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity),
                  locationId: shipmentLine.locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Purchase Return Shipment",
                  documentId: shipmentHeader.id ?? undefined,
                  externalDocumentId:
                    shipmentHeader.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId
                });
              } else {
                // Draw the shipped quantity from the linked entities. A fully
                // drawn entity is Consumed whole; a batch drawn in part is
                // split (below, in the transaction). The linked entities must
                // be able to cover the shipped quantity.
                const entitySum = lineEntities.reduce(
                  (sum, entity) => sum + Number(entity.quantity ?? 0),
                  0
                );
                if (entitySum + 0.00001 < shippedQuantity) {
                  throw new Error(
                    `Shipment line ${shipmentLine.id}: tracked entities account for ${entitySum} of ${shippedQuantity} shipped — assign tracking before posting`
                  );
                }
                let remaining = shippedQuantity;
                for (const entity of lineEntities) {
                  if (remaining <= 0.00001) break;
                  const entityQty = Number(entity.quantity ?? 0);
                  const draw = Math.min(entityQty, remaining);
                  remaining -= draw;
                  itemShipmentQuantities[shipmentLine.itemId] =
                    (itemShipmentQuantities[shipmentLine.itemId] ?? 0) + draw;
                  const ledgerIndex = itemLedgerInserts.length;
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: round(-draw),
                    locationId: shipmentLine.locationId,
                    storageUnitId: shipmentLine.storageUnitId,
                    entryType: "Negative Adjmt.",
                    documentType: "Purchase Return Shipment",
                    documentId: shipmentHeader.id ?? undefined,
                    trackedEntityId: entity.id,
                    externalDocumentId:
                      shipmentHeader.externalDocumentId ?? undefined,
                    createdBy: userId,
                    companyId
                  });
                  if (isFullDraw(entityQty, draw)) {
                    trackedEntityUpdates[entity.id] = {
                      status: "Consumed",
                      quantity: round(entityQty)
                    };
                  } else {
                    // Partial → split at post; the negative ledger row above is
                    // retargeted to the departing child in the transaction.
                    trackedEntitySplits.push({
                      entity,
                      drawQuantity: round(draw),
                      storageUnitId: shipmentLine.storageUnitId,
                      itemId: shipmentLine.itemId,
                      ledgerIndex
                    });
                  }
                }
              }
            }

            // A Provisional journal has no accounting period.
            const accountingPeriodId =
              postingStatus === "Posted"
                ? await getCurrentAccountingPeriod(companyId, db, today)
                : null;

            await db.transaction().execute(async (trx) => {
              // Double-post guard: serialize on the shipment row — a second
              // concurrent post waits here, then sees Posted and aborts, so
              // ledger rows, journals, and quantityShipped can never double.
              const lockedShipment = await trx
                .selectFrom("shipment")
                .select(["status"])
                .where("id", "=", shipmentId)
                .forUpdate()
                .executeTakeFirstOrThrow();
              if (
                lockedShipment.status === "Posted" ||
                lockedShipment.status === "Voided"
              ) {
                throw new Error(`Shipment is already ${lockedShipment.status}`);
              }

              await assertPostingStatusUnchanged(trx, companyId, postingStatus);

              // cancelPurchaseReturnOrder locks this same order row — re-check
              // the status under the lock so a cancel committed after our
              // pre-transaction read cannot be posted over.
              const lockedOrder = await trx
                .selectFrom("purchaseReturnOrder")
                .select(["status"])
                .where("id", "=", purchaseReturnOrderId)
                .forUpdate()
                .executeTakeFirstOrThrow();
              if (lockedOrder.status !== "To Ship") {
                throw new Error(
                  `Cannot ship against a return order in ${lockedOrder.status} status`
                );
              }

              // Split any batch returned in part: keep the shelf entity's id
              // (decremented), depart the shipped portion as a new Consumed
              // child, and retarget the negative Purchase Return Shipment
              // ledger row onto that child.
              for (const split of trackedEntitySplits) {
                const parent = split.entity;
                const parentAttributes =
                  (parent.attributes as TrackedEntityAttributes | null) ?? {};
                const childId = nanoid();
                const built = buildBatchSplitRecords({
                  parent: {
                    id: parent.id,
                    readableId: parent.readableId,
                    quantity: Number(parent.quantity ?? 0),
                    sourceDocument: parent.sourceDocument,
                    sourceDocumentId: parent.sourceDocumentId,
                    sourceDocumentReadableId: parent.sourceDocumentReadableId,
                    itemId: parent.itemId ?? null,
                    expirationDate: parent.expirationDate ?? null,
                    attributes: parentAttributes as Record<string, unknown>
                  },
                  drawQuantity: split.drawQuantity,
                  childId,
                  splitActivityId: nanoid(),
                  activitySourceDocument: "Shipment",
                  activitySourceDocumentId: shipmentId,
                  bin: {
                    storageUnitId: split.storageUnitId,
                    locationId: shipmentHeader.locationId
                  },
                  itemLedgerItemId: split.itemId,
                  companyId,
                  userId,
                  postingDate: today,
                  childStatus: "Consumed"
                });

                await trx
                  .insertInto("trackedActivity")
                  .values({
                    ...built.activityInsert,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    createdAt: today
                  } as Insertable<KyselyDatabase["trackedActivity"]>)
                  .execute();
                await trx
                  .insertInto("trackedEntity")
                  .values(
                    built.childEntityInsert as Insertable<
                      KyselyDatabase["trackedEntity"]
                    >
                  )
                  .execute();
                await trx
                  .insertInto("trackedActivityInput")
                  .values(built.activityInputInsert)
                  .execute();
                await trx
                  .insertInto("trackedActivityOutput")
                  .values(built.activityOutputInsert)
                  .execute();

                const retainedAttributes = {
                  ...parentAttributes
                } as Record<string, unknown>;
                delete retainedAttributes.Shipment;
                delete retainedAttributes["Shipment Line"];
                delete retainedAttributes["Shipment Line Index"];
                await trx
                  .updateTable("trackedEntity")
                  .set({
                    quantity: built.parentUpdate.quantity,
                    attributes: retainedAttributes as Json
                  })
                  .where("id", "=", parent.id)
                  .where("companyId", "=", companyId)
                  .execute();

                itemLedgerInserts.push(
                  ...(built.ledgerInserts.map((ledger) => ({
                    ...ledger,
                    quantity: round(ledger.quantity)
                  })) as typeof itemLedgerInserts)
                );
                itemLedgerInserts[split.ledgerIndex]!.trackedEntityId = childId;
                splitChildEdges.push({
                  childId,
                  quantity: split.drawQuantity
                });
              }

              const returnedItems: ReturnShipmentItem[] = [];
              for (const [itemId, quantity] of Object.entries(
                itemShipmentQuantities
              )) {
                const cogsResult = await calculateCOGS(trx, {
                  itemId,
                  quantity,
                  companyId,
                  trackedEntityIds: leavingTrackedEntityIds(
                    itemLedgerInserts,
                    itemId
                  )
                });

                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: "Purchase",
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Purchase Return Shipment",
                    documentId: shipmentHeader.id ?? undefined,
                    externalDocumentId:
                      shipmentHeader.externalDocumentId ?? undefined,
                    itemId,
                    quantity: round(-quantity),
                    cost: round(-cogsResult.totalCost),
                    nominalCost: round(-cogsResult.totalCost),
                    remainingQuantity: 0,
                    companyId,
                    postingDate: today
                  })
                  .execute();

                returnedItems.push({
                  itemId,
                  quantity,
                  cost: cogsResult.totalCost,
                  replenishmentSystem:
                    items.data.find((i) => i.id === itemId)
                      ?.replenishmentSystem ?? null,
                  itemPostingGroupId:
                    itemCosts.data.find((c) => c.itemId === itemId)
                      ?.itemPostingGroupId ?? null
                });
              }

              const journal = buildReturnShipmentJournal({
                sourceDocument: "Purchase Return Order",
                shipmentId: shipmentHeader.id,
                shipmentReadableId: shipmentHeader.shipmentId,
                locationId: shipmentHeader.locationId,
                partyId: purchaseReturnOrder.data.supplierId,
                partyTypeId: supplierTypeId,
                defaults: accountDefaults.data,
                items: returnedItems
              });
              if (journal.lines.length > 0) {
                await insertShipmentJournal(trx, {
                  journal,
                  accountingPeriodId,
                  postingDate: today,
                  postingStatus,
                  dimensionIdByEntity: dimensionMap,
                  companyId,
                  userId
                });
              }

              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .execute();
              }

              for await (const [lineId, update] of Object.entries(
                returnLineUpdates
              )) {
                await trx
                  .updateTable("purchaseReturnOrderLine")
                  .set(update)
                  .where("id", "=", lineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              // Derived status (mirrors getPurchaseReturnOrderStatus): the
              // return is Completed once every line has shipped its authorized
              // quantity or been short-closed, otherwise it stays To Ship.
              const allLines = await trx
                .selectFrom("purchaseReturnOrderLine")
                .select(["quantity", "quantityShipped", "closedComplete"])
                .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
                .execute();
              const allShipped =
                allLines.length > 0 &&
                allLines.every(
                  (l) =>
                    l.closedComplete ||
                    Number(l.quantityShipped) >= Number(l.quantity)
                );
              const returnStatus = allShipped
                ? ("Completed" as const)
                : ("To Ship" as const);
              await trx
                .updateTable("purchaseReturnOrder")
                .set({ status: returnStatus, updatedBy: userId })
                .where("id", "=", purchaseReturnOrderId)
                .where("companyId", "=", companyId)
                .execute();

              if (
                Object.keys(trackedEntityUpdates).length > 0 ||
                splitChildEdges.length > 0
              ) {
                const activity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Return Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    attributes: {
                      "Purchase Return Order": purchaseReturnOrderId,
                      Shipment: shipmentId,
                      Employee: userId
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .returning(["id"])
                  .execute();
                const activityId = activity[0]?.id;
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
                )) {
                  await trx
                    .updateTable("trackedEntity")
                    .set(update)
                    .where("id", "=", id)
                    .where("companyId", "=", companyId)
                    .execute();
                  if (activityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId: activityId,
                        trackedEntityId: id,
                        quantity: update.quantity ?? 0,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
                // The Consumed children departed by a split relieve on this
                // same Return Shipment activity.
                if (activityId) {
                  for (const edge of splitChildEdges) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId: activityId,
                        trackedEntityId: edge.childId,
                        quantity: edge.quantity,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
              }

              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            });

            break;
          }

          case "Rental Agreement": {
            await postRentalShipment(db, {
              shipmentId,
              companyId,
              userId,
              today,
              postingDate
            });
            break;
          }

          default: {
            throw new Error(
              `Invalid source document type: ${shipmentHeader.sourceDocument}`
            );
          }
        }
        break;
      }
      case "void": {
        // A void replays quantity rollbacks — voiding a shipment that is not
        // Posted (e.g. already Voided) would subtract them a second time.
        if (shipmentHeader.status !== "Posted") {
          throw new Error(
            `Cannot void a shipment in ${shipmentHeader.status} status`
          );
        }
        // The enable reset the cost layers this shipment relieved.
        await refuseVoidBeforeCutover(
          db,
          companyId,
          shipmentHeader.postingDate,
          INVENTORY_VOID_BEFORE_CUTOVER_ERROR
        );
        switch (shipmentHeader.sourceDocument) {
          case "Sales Order": {
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [salesOrder, salesOrderLines, originalJournalLines] =
              await inOrder([
                () =>
                  single(db, "salesOrder", {
                    id: shipmentHeader.sourceDocumentId
                  }),
                () =>
                  many(db, "salesOrderLine", {
                    salesOrderId: shipmentHeader.sourceDocumentId
                  }),
                () =>
                  documentJournalLines(db, companyId, {
                    documentId: shipmentId,
                    documentType: "Sales Shipment"
                  })
              ]);
            if (salesOrder.error)
              throw new Error("Failed to fetch sales order");
            if (salesOrderLines.error)
              throw new Error("Failed to fetch sales order lines");

            // Every void posts its reversal: Provisional before the
            // company's accounting cutover, Posted after it. Read here to
            // decide whether to resolve a period, and again inside the
            // transaction.
            const postingStatus = await journalPostingStatus(db, companyId);

            const reversingJournalLines: Omit<
              Database["public"]["Tables"]["journalLine"]["Insert"],
              "journalId"
            >[] = originalJournalLines.map((entry) => ({
              accountId: entry.accountId,
              accrual: entry.accrual,
              description: `VOID: ${entry.description}`,
              // A reversal is a sign flip of an already-posted value, which
              // is exact — no rounding to do.
              amount: -entry.amount,
              quantity: -entry.quantity,
              documentType: entry.documentType,
              documentId: entry.documentId,
              externalDocumentId: entry.externalDocumentId,
              documentLineReference: entry.documentLineReference,
              journalLineReference: entry.journalLineReference,
              companyId
            }));

            const customer = await single(db, "customer", {
              id: salesOrder.data.customerId,
              companyId
            });
            if (customer.error) throw new Error("Failed to fetch customer");

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];

            const jobUpdates: Record<
              string,
              Database["public"]["Tables"]["job"]["Update"]
            > = {};

            // Put each serial or batch back in the bin its posting took it
            // from, which is not always the line's bin.
            const postedTrackedRows = await db
              .selectFrom("itemLedger")
              .where("documentId", "=", shipmentHeader.id)
              .where("documentType", "=", "Sales Shipment")
              .where("companyId", "=", companyId)
              .where("trackedEntityId", "is not", null)
              .where("quantity", "<", 0)
              .select(["trackedEntityId", "storageUnitId"])
              .execute();
            const postedTrackedBins = new Map<string, string | null>(
              postedTrackedRows.map((row) => [
                row.trackedEntityId as string,
                row.storageUnitId ?? null
              ])
            );
            const restoreBin = (
              trackedEntityId: string | undefined,
              lineStorageUnitId: string | null
            ) =>
              trackedEntityId && postedTrackedBins.has(trackedEntityId)
                ? (postedTrackedBins.get(trackedEntityId) ?? null)
                : lineStorageUnitId;

            const locationId = shipmentHeader.locationId;
            for await (const shipmentLine of shipmentLines.data) {
              if (
                shipmentLine.fulfillment?.type === "Job" &&
                shipmentLine.fulfillment?.jobId
              ) {
                // Reverse job quantities for void shipment
                const jobId = shipmentLine.fulfillment.jobId;
                const currentJob = jobs.data.find((j) => j.id === jobId);

                logger.info("Processing job void:", {
                  jobId,
                  currentJob: currentJob
                    ? {
                        id: currentJob.id,
                        quantity: currentJob.quantity,
                        quantityShipped: currentJob.quantityShipped,
                        quantityComplete: currentJob.quantityComplete,
                        status: currentJob.status
                      }
                    : null,
                  shipmentLine: {
                    id: shipmentLine.id,
                    shippedQuantity: shipmentLine.shippedQuantity,
                    shippedQuantityType: typeof shipmentLine.shippedQuantity
                  }
                });

                const currentQuantityShipped = currentJob?.quantityShipped ?? 0;

                // Ensure shippedQuantity is a valid number
                const shippedQuantity =
                  typeof shipmentLine.shippedQuantity === "number" &&
                  !isNaN(shipmentLine.shippedQuantity)
                    ? shipmentLine.shippedQuantity
                    : 0;

                logger.info("Calculated values for void:", {
                  currentQuantityShipped,
                  shippedQuantity,
                  newTotal: currentQuantityShipped - shippedQuantity,
                  jobQuantity: currentJob?.quantity
                });

                // Reduce shipped quantity (reverse of posting)
                const newQuantityShipped = Math.max(
                  0,
                  currentQuantityShipped - shippedQuantity
                );
                const newQuantityComplete = Math.max(
                  currentJob?.quantityComplete ?? 0,
                  shippedQuantity
                );

                // Update status based on new quantities
                let newStatus = currentJob?.status;
                if (
                  currentJob?.status === "Completed" &&
                  newQuantityShipped < (currentJob?.quantity ?? 0)
                ) {
                  newStatus = "In Progress";
                }

                jobUpdates[jobId] = {
                  status: newStatus,
                  quantityComplete: newQuantityComplete,
                  quantityShipped: newQuantityShipped
                };
              }

              const itemTrackingType =
                items.data.find((item) => item.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              // Default shippedQuantity to 0 if not defined or NaN
              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              if (itemTrackingType === "Inventory") {
                // Create positive adjustment to restore inventory
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(shippedQuantity), // Positive to restore inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Positive Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipmentHeader.id ?? undefined,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId
                });
              }

              if (shipmentLine.requiresBatchTracking) {
                const batchId = shipmentLineTracking.data?.find(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                )?.id;
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(shippedQuantity), // Positive to restore inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: restoreBin(
                    batchId,
                    shipmentLine.storageUnitId
                  ),
                  entryType: "Positive Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipmentHeader.id ?? undefined,
                  trackedEntityId: batchId,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId
                });
              }

              if (shipmentLine.requiresSerialTracking) {
                const lineTracking = shipmentLineTracking.data?.filter(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                );

                lineTracking?.forEach((tracking) => {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: 1, // Positive to restore inventory
                    locationId: shipmentLine.locationId ?? locationId,
                    storageUnitId: restoreBin(
                      tracking.id,
                      shipmentLine.storageUnitId
                    ),
                    entryType: "Positive Adjmt.",
                    documentType: "Sales Shipment",
                    documentId: shipmentHeader.id ?? undefined,
                    trackedEntityId: tracking.id,
                    externalDocumentId: undefined,
                    createdBy: userId,
                    companyId
                  });
                });
              }
            }

            const shipmentLinesBySalesOrderLineId = shipmentLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["shipmentLine"]["Row"][]
              >
            >((acc, shipmentLine) => {
              if (shipmentLine.lineId) {
                acc[shipmentLine.lineId] = [
                  ...(acc[shipmentLine.lineId] ?? []),
                  shipmentLine
                ];
              }
              return acc;
            }, {});

            // Reverse sales order line updates
            const salesOrderLineUpdates = salesOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["salesOrderLine"]["Update"]
              >
            >((acc, salesOrderLine) => {
              const shipmentLines =
                shipmentLinesBySalesOrderLineId[salesOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                salesOrderLine.saleQuantity &&
                salesOrderLine.saleQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                // Reduce shipped quantity (reverse of posting)
                const newQuantitySent = Math.max(
                  0,
                  (salesOrderLine.quantitySent ?? 0) - shippedQuantity
                );

                const sentComplete =
                  newQuantitySent >= salesOrderLine.saleQuantity;

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["salesOrderLine"]["Update"]
                > = {
                  ...acc,
                  [salesOrderLine.id]: {
                    quantitySent: newQuantitySent,
                    sentComplete
                  }
                };

                // Clear sent date if no longer complete
                if (!sentComplete && salesOrderLine.sentDate) {
                  updates[salesOrderLine.id]!.sentDate = null;
                }

                return updates;
              }

              return acc;
            }, {});

            // Reverse FA SO line disposals on void
            const faSoLinesForVoid = salesOrderLines.data.filter(
              (sol) =>
                sol.salesOrderLineType === "Fixed Asset" &&
                sol.assetId &&
                sol.sentComplete
            );

            for (const faSoLine of faSoLinesForVoid) {
              const hasShipmentEntries = originalJournalLines.some(
                (jl) =>
                  jl.documentLineReference ===
                  journalReference.to.shipment(faSoLine.id)
              );

              if (hasShipmentEntries) {
                salesOrderLineUpdates[faSoLine.id] = {
                  quantitySent: 0,
                  sentComplete: false,
                  sentDate: null
                };

                fixedAssetWrites.patch(faSoLine.assetId!, {
                  status: "Active",
                  disposalDate: null,
                  disposalMethod: null,
                  updatedBy: userId
                });

                const assetId = faSoLine.assetId!;
                fixedAssetWrites.defer((trx) =>
                  deleteRows(trx, "fixedAssetDisposal", {
                    fixedAssetId: assetId,
                    companyId
                  })
                );
              }
            }

            // Restore tracked entities to available status
            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                // Restore original quantity and set to available
                acc[trackedEntity.id] = {
                  status: "Available",
                  quantity: trackedEntity.quantity // Restore original quantity
                };

                return acc;
              }, {}) ?? {};

            // A Provisional journal has no accounting period.
            const accountingPeriodId =
              postingStatus === "Posted" && reversingJournalLines.length > 0
                ? await getCurrentAccountingPeriod(companyId, db, today)
                : null;

            await db.transaction().execute(async (trx) => {
              await assertPostingStatusUnchanged(trx, companyId, postingStatus);
              await fixedAssetWrites.apply(trx, companyId);
              // Update sales order lines to reverse shipped quantities
              for await (const [salesOrderLineId, update] of Object.entries(
                salesOrderLineUpdates
              )) {
                await trx
                  .updateTable("salesOrderLine")
                  .set(update)
                  .where("id", "=", salesOrderLineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              const salesOrderLines = await trx
                .selectFrom("salesOrderLine")
                .select([
                  "id",
                  "salesOrderLineType",
                  "invoicedComplete",
                  "sentComplete"
                ])
                .where("salesOrderId", "=", salesOrder.data.id)
                .execute();

              const areAllLinesInvoiced = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" || line.invoicedComplete
              );

              const areAllLinesShipped = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" ||
                  line.salesOrderLineType === "Service" ||
                  line.sentComplete
              );

              let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
                "To Ship and Invoice";
              if (areAllLinesInvoiced && areAllLinesShipped) {
                status = "Completed";
              } else if (areAllLinesShipped) {
                status = "To Invoice";
              } else if (areAllLinesInvoiced) {
                status = "To Ship";
              }

              await trx
                .updateTable("salesOrder")
                .set({
                  status
                })
                .where("id", "=", salesOrder.data.id)
                .where("companyId", "=", companyId)
                .execute();

              // Update shipment status to Voided
              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();

              // Restore tracked entities to available status
              if (Object.keys(trackedEntityUpdates).length > 0) {
                const voidActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Void Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Sales Order": salesOrder.data.id
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .returning(["id"])
                  .execute();

                const voidActivityId = voidActivity[0]!.id;

                // Restore tracked entities
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
                )) {
                  await trx
                    .updateTable("trackedEntity")
                    .set(update)
                    .where("id", "=", id)
                    .where("companyId", "=", companyId)
                    .execute();

                  if (voidActivityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId: voidActivityId,
                        trackedEntityId: id,
                        quantity: update.quantity ?? 0,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
              }

              // Create reversing item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update jobs to reverse shipped quantities
              if (Object.keys(jobUpdates).length > 0) {
                logger.info(
                  "Final job void updates to be applied:",
                  jobUpdates
                );
                for await (const [jobId, update] of Object.entries(
                  jobUpdates
                )) {
                  logger.info(`Voiding job ${jobId} with:`, update);
                  await trx
                    .updateTable("job")
                    .set(update)
                    .where("id", "=", jobId)
                    .where("companyId", "=", companyId)
                    .execute();
                }
              }

              // Create reversing journal entries
              if (reversingJournalLines.length > 0) {
                const voidJournalEntryId = await sequence.getNextSequence(
                  trx,
                  "journalEntry",
                  companyId
                );

                const voidJournalResult = await trx
                  .insertInto("journal")
                  .values({
                    journalEntryId: voidJournalEntryId,
                    accountingPeriodId,
                    description: `VOID: Sales Shipment ${shipmentHeader.shipmentId}`,
                    postingDate: today,
                    companyId,
                    sourceType: "Sales Shipment",
                    status: postingStatus,
                    postedAt: datetime.timestamp(),
                    postedBy: userId,
                    createdBy: userId
                  })
                  .returning(["id"])
                  .executeTakeFirstOrThrow();

                await trx
                  .insertInto("journalLine")
                  .values(
                    reversingJournalLines.map((line) => ({
                      ...line,
                      journalId: voidJournalResult.id
                    }))
                  )
                  .execute();
              }
            });
            break;
          }
          case "Purchase Order": {
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [purchaseOrder, purchaseOrderLines] = await inOrder([
              () =>
                single(db, "purchaseOrder", {
                  id: shipmentHeader.sourceDocumentId
                }),
              () =>
                many(db, "purchaseOrderLine", {
                  purchaseOrderId: shipmentHeader.sourceDocumentId
                })
            ]);
            if (purchaseOrder.error)
              throw new Error("Failed to fetch purchase order");
            if (purchaseOrderLines.error)
              throw new Error("Failed to fetch purchase order lines");

            const supplier = await single(db, "supplier", {
              id: purchaseOrder.data.supplierId,
              companyId
            });
            if (supplier.error) throw new Error("Failed to fetch supplier");

            const jobOperationsUpdates: Record<
              string,
              Database["public"]["Tables"]["jobOperation"]["Update"]
            > = {};

            for await (const shipmentLine of shipmentLines.data) {
              const purchaseOrderLine = purchaseOrderLines.data.find(
                (pol) => pol.id === shipmentLine.lineId
              );

              if (
                purchaseOrderLine?.jobId &&
                purchaseOrderLine.jobOperationId
              ) {
                // Reset job operation status when voiding
                const jobOperationId = purchaseOrderLine.jobOperationId;

                jobOperationsUpdates[jobOperationId] = {
                  status: "Ready"
                };
                continue;
              }
            }

            const shipmentLinesByPurchaseOrderLineId =
              shipmentLines.data.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["shipmentLine"]["Row"][]
                >
              >((acc, shipmentLine) => {
                if (shipmentLine.lineId) {
                  acc[shipmentLine.lineId] = [
                    ...(acc[shipmentLine.lineId] ?? []),
                    shipmentLine
                  ];
                }
                return acc;
              }, {});

            // Reverse purchase order line updates
            const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const shipmentLines =
                shipmentLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                // Reduce shipped quantity (reverse of posting)
                const newQuantityShipped = Math.max(
                  0,
                  (purchaseOrderLine.quantityShipped ?? 0) - shippedQuantity
                );

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
                > = {
                  ...acc,
                  [purchaseOrderLine.id]: {
                    quantityShipped: newQuantityShipped
                  }
                };

                return updates;
              }

              return acc;
            }, {});

            // Restore tracked entities to available status
            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                // Restore original quantity and set to available
                acc[trackedEntity.id] = {
                  status: "Available",
                  quantity: trackedEntity.quantity
                };

                return acc;
              }, {}) ?? {};

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const locationId = shipmentHeader.locationId;

            // Create reversing item ledger entries for purchase order void
            for await (const shipmentLine of shipmentLines.data) {
              const itemTrackingType =
                items.data.find((item) => item.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              if (itemTrackingType === "Inventory" && shippedQuantity !== 0) {
                // Create negative adjustment to remove inventory that was added during posting
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity), // Negative to remove inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: shipmentHeader.id ?? undefined,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId
                });
              }

              if (shipmentLine.requiresBatchTracking) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(-shippedQuantity), // Negative to remove inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: shipmentHeader.id ?? undefined,
                  trackedEntityId: shipmentLineTracking.data?.find(
                    (tracking) =>
                      (
                        tracking.attributes as
                          | TrackedEntityAttributes
                          | undefined
                      )?.["Shipment Line"] === shipmentLine.id
                  )?.id,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId
                });
              }

              if (shipmentLine.requiresSerialTracking) {
                const lineTracking = shipmentLineTracking.data?.filter(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                );

                lineTracking?.forEach((tracking) => {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: -1, // Negative to remove inventory
                    locationId: shipmentLine.locationId ?? locationId,
                    storageUnitId: shipmentLine.storageUnitId,
                    entryType: "Negative Adjmt.",
                    documentType: "Purchase Receipt",
                    documentId: shipmentHeader.id ?? undefined,
                    trackedEntityId: tracking.id,
                    externalDocumentId: undefined,
                    createdBy: userId,
                    companyId
                  });
                });
              }
            }

            await db.transaction().execute(async (trx) => {
              // Update purchase order lines to reverse shipped quantities
              for await (const [purchaseOrderLineId, update] of Object.entries(
                purchaseOrderLineUpdates
              )) {
                await trx
                  .updateTable("purchaseOrderLine")
                  .set(update)
                  .where("id", "=", purchaseOrderLineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              // Create reversing item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update shipment status to Voided
              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();

              // Restore tracked entities
              if (Object.keys(trackedEntityUpdates).length > 0) {
                const voidActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Void Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipmentHeader.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Purchase Order": purchaseOrder.data.id
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today
                  })
                  .returning(["id"])
                  .execute();

                const voidActivityId = voidActivity[0]!.id;

                // Restore tracked entities
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
                )) {
                  await trx
                    .updateTable("trackedEntity")
                    .set(update)
                    .where("id", "=", id)
                    .where("companyId", "=", companyId)
                    .execute();

                  if (voidActivityId) {
                    await trx
                      .insertInto("trackedActivityInput")
                      .values({
                        trackedActivityId: voidActivityId,
                        trackedEntityId: id,
                        quantity: update.quantity ?? 0,
                        companyId,
                        createdBy: userId,
                        createdAt: today
                      })
                      .execute();
                  }
                }
              }

              // Update job operations to reset status
              if (Object.keys(jobOperationsUpdates).length > 0) {
                logger.info(
                  "Final job operation void updates to be applied:",
                  jobOperationsUpdates
                );
                for await (const [jobOperationId, update] of Object.entries(
                  jobOperationsUpdates
                )) {
                  logger.info(
                    `Voiding job operation ${jobOperationId} with:`,
                    update
                  );
                  await trx
                    .updateTable("jobOperation")
                    .set(update)
                    .where("id", "=", jobOperationId)
                    .where("companyId", "=", companyId)
                    .execute();
                }
              }
            });
            break;
          }
          case "Outbound Transfer": {
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [warehouseTransfer, warehouseTransferLines] = await inOrder([
              () =>
                single(db, "warehouseTransfer", {
                  id: shipmentHeader.sourceDocumentId
                }),
              () =>
                many(db, "warehouseTransferLine", {
                  transferId: shipmentHeader.sourceDocumentId
                })
            ]);

            if (warehouseTransfer.error)
              throw new Error("Failed to fetch warehouse transfer");
            if (warehouseTransferLines.error)
              throw new Error("Failed to fetch warehouse transfer lines");

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const warehouseTransferLineUpdates: Record<
              string,
              Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
            > = {};

            // Process each shipment line
            for await (const shipmentLine of shipmentLines.data) {
              const warehouseTransferLine = warehouseTransferLines.data.find(
                (line) => line.id === shipmentLine.lineId
              );

              if (!warehouseTransferLine) continue;

              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              // Reverse warehouse transfer line shipped quantity
              const newShippedQuantity = Math.max(
                0,
                (warehouseTransferLine.shippedQuantity ?? 0) - shippedQuantity
              );

              warehouseTransferLineUpdates[warehouseTransferLine.id] = {
                shippedQuantity: newShippedQuantity
              };

              // Create item ledger entry to restore inventory at source
              if (shippedQuantity !== 0) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: round(shippedQuantity), // Positive to restore inventory
                  locationId: shipmentLine.locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Transfer",
                  documentType: "Transfer Shipment",
                  documentId: warehouseTransfer.data?.transferId,
                  externalDocumentId:
                    shipmentHeader.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId
                });
              }
            }

            // Check if all lines are fully shipped after void
            const allLinesFullyShipped = warehouseTransferLines.data.every(
              (line) => {
                const updates = warehouseTransferLineUpdates[line.id];
                const shippedQty =
                  updates?.shippedQuantity ?? line.shippedQuantity ?? 0;
                return shippedQty >= (line.quantity ?? 0);
              }
            );

            // Check if all lines are fully received
            const allLinesFullyReceived = warehouseTransferLines.data.every(
              (line) => {
                const receivedQty = line.receivedQuantity ?? 0;
                return receivedQty >= (line.quantity ?? 0);
              }
            );

            // Determine new warehouse transfer status
            let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
              warehouseTransfer.data.status;

            if (allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "Completed";
            } else if (allLinesFullyShipped && !allLinesFullyReceived) {
              newStatus = "To Receive";
            } else if (!allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "To Ship";
            } else {
              newStatus = "Draft";
            }

            await db.transaction().execute(async (trx) => {
              // Update warehouse transfer lines
              for await (const [lineId, update] of Object.entries(
                warehouseTransferLineUpdates
              )) {
                await trx
                  .updateTable("warehouseTransferLine")
                  .set(update)
                  .where("id", "=", lineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              // Update warehouse transfer status
              await trx
                .updateTable("warehouseTransfer")
                .set({
                  status: newStatus,
                  updatedBy: userId
                })
                .where("id", "=", warehouseTransfer.data.id)
                .where("companyId", "=", companyId)
                .execute();

              // Create reversing item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update shipment status to Voided
              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            });

            break;
          }

          case "Sales Return Order": {
            // Void a return-to-customer shipment: rebuild positive ledger,
            // sign-flip journal, entities back On Hold (their RMA state).
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            // Every void posts its reversal: Provisional before the
            // company's accounting cutover, Posted after it. Read here to
            // decide whether to resolve a period, and again inside the
            // transaction.
            const postingStatus = await journalPostingStatus(db, companyId);

            const [originalJournalLines, originalItemLedger, originalCostRows] =
              await inOrder([
                () =>
                  documentJournalLines(db, companyId, {
                    documentId: shipmentId,
                    documentType: "Return Order"
                  }),
                () =>
                  many(db, "itemLedger", {
                    documentId: shipmentId,
                    documentType: "Sales Return Shipment",
                    companyId
                  }),
                () =>
                  many(db, "costLedger", {
                    documentId: shipmentId,
                    documentType: "Sales Return Shipment",
                    companyId
                  })
              ]);
            // A failed read here must abort: treating data:null as "nothing
            // to reverse" would mark the shipment Voided while its journal
            // and ledger rows stand.
            if (originalItemLedger.error)
              throw new Error("Failed to fetch item ledger rows to reverse");
            if (originalCostRows.error)
              throw new Error("Failed to fetch cost ledger rows to reverse");

            // A Provisional journal has no accounting period.
            const accountingPeriodId =
              postingStatus === "Posted" && originalJournalLines.length > 0
                ? await getCurrentAccountingPeriod(companyId, db, today)
                : null;

            await db.transaction().execute(async (trx) => {
              await assertPostingStatusUnchanged(trx, companyId, postingStatus);
              const reversingItemLedger = (originalItemLedger.data ?? []).map(
                (entry) => ({
                  postingDate: today,
                  itemId: entry.itemId,
                  quantity: -entry.quantity,
                  locationId: entry.locationId,
                  storageUnitId: entry.storageUnitId,
                  entryType: "Positive Adjmt." as const,
                  documentType: "Sales Return Shipment" as const,
                  documentId: entry.documentId,
                  externalDocumentId: entry.externalDocumentId,
                  trackedEntityId: entry.trackedEntityId,
                  createdBy: userId,
                  companyId
                })
              );
              if (reversingItemLedger.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(reversingItemLedger)
                  .execute();
              }

              // Restore inventory VALUE, not just quantity: posting consumed
              // FIFO layers via calculateCOGS; without an offsetting layer
              // the voided stock re-enters at zero value and inventory is
              // permanently understated.
              for (const row of (originalCostRows.data ?? []).filter(
                (r) => Number(r.quantity) < 0
              )) {
                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: row.itemLedgerType,
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Sales Return Shipment",
                    documentId: row.documentId,
                    externalDocumentId: row.externalDocumentId ?? undefined,
                    itemId: row.itemId,
                    quantity: round(-Number(row.quantity)),
                    cost: round(-Number(row.cost)),
                    nominalCost: round(-Number(row.nominalCost)),
                    remainingQuantity: round(-Number(row.quantity)),
                    companyId,
                    postingDate: today
                  })
                  .execute();
              }

              if (originalJournalLines.length > 0) {
                const originalLines = originalJournalLines;
                // Carry the original lines' GL dimensions onto the reversing
                // lines so the void mirrors the posting.
                const originalDimensions = await many(
                  trx,
                  "journalLineDimension",
                  {
                    journalLineId: originalLines.map((l) => l.id),
                    companyId
                  },
                  { columns: ["journalLineId", "dimensionId", "valueId"] }
                );
                const dimensionsByLine = new Map<
                  string,
                  { dimensionId: string; valueId: string }[]
                >();
                for (const dim of originalDimensions.data ?? []) {
                  const list = dimensionsByLine.get(dim.journalLineId) ?? [];
                  list.push({
                    dimensionId: dim.dimensionId,
                    valueId: dim.valueId
                  });
                  dimensionsByLine.set(dim.journalLineId, list);
                }

                const journalEntryId = await sequence.getNextSequence(
                  trx,
                  "journalEntry",
                  companyId
                );
                const journalResult = await trx
                  .insertInto("journal")
                  .values({
                    journalEntryId,
                    accountingPeriodId,
                    description: `VOID Return Shipment ${shipmentHeader.shipmentId}`,
                    postingDate: today,
                    companyId,
                    sourceType: "Sales Return Shipment",
                    status: postingStatus,
                    postedAt: datetime.timestamp(),
                    postedBy: userId,
                    createdBy: userId
                  })
                  .returning(["id"])
                  .executeTakeFirstOrThrow();
                const journalLineResults = await trx
                  .insertInto("journalLine")
                  .values(
                    originalLines.map((line) => ({
                      accountId: line.accountId,
                      description: `VOID: ${line.description ?? ""}`,
                      amount: -line.amount,
                      quantity:
                        line.quantity == null ? undefined : -line.quantity,
                      documentType: line.documentType,
                      documentId: line.documentId,
                      externalDocumentId: line.externalDocumentId ?? undefined,
                      documentLineReference:
                        line.documentLineReference ?? undefined,
                      journalLineReference: line.journalLineReference,
                      journalId: journalResult.id,
                      companyId
                    }))
                  )
                  .returning(["id"])
                  .execute();

                const voidDimensionInserts: {
                  journalLineId: string;
                  dimensionId: string;
                  valueId: string;
                  companyId: string;
                }[] = [];
                journalLineResults.forEach((jl, index) => {
                  const originalId = originalLines[index]?.id;
                  if (!originalId) return;
                  for (const dim of dimensionsByLine.get(originalId) ?? []) {
                    voidDimensionInserts.push({
                      journalLineId: jl.id,
                      dimensionId: dim.dimensionId,
                      valueId: dim.valueId,
                      companyId
                    });
                  }
                });
                if (voidDimensionInserts.length > 0) {
                  await trx
                    .insertInto("journalLineDimension")
                    .values(voidDimensionInserts)
                    .execute();
                }
              }

              const voidActivity = await trx
                .insertInto("trackedActivity")
                .values({
                  type: "Void Shipment",
                  sourceDocument: "Shipment",
                  sourceDocumentId: shipmentId,
                  sourceDocumentReadableId: shipmentHeader.shipmentId,
                  attributes: {
                    "Sales Return Order": shipmentHeader.sourceDocumentId,
                    Shipment: shipmentId,
                    Employee: userId
                  },
                  companyId,
                  createdBy: userId,
                  createdAt: today
                })
                .returning(["id"])
                .execute();
              const voidActivityId = voidActivity[0]?.id;

              for await (const entity of shipmentLineTracking.data ?? []) {
                await trx
                  .updateTable("trackedEntity")
                  .set({ status: "On Hold" })
                  .where("id", "=", entity.id)
                  .where("companyId", "=", companyId)
                  .execute();
                if (voidActivityId) {
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId: voidActivityId,
                      trackedEntityId: entity.id,
                      quantity: entity.quantity ?? 0,
                      companyId,
                      createdBy: userId,
                      createdAt: today
                    })
                    .execute();
                }
              }

              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            });

            break;
          }

          case "Purchase Return Order": {
            // Void a supplier-return shipment: rebuild positive ledger,
            // sign-flip journal, roll back quantityShipped + ladder,
            // entities back to Available (their pre-shipment state).
            if (!shipmentHeader.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");
            const purchaseReturnOrderId = shipmentHeader.sourceDocumentId;

            // Mirror of the sales-side guard in post-receipt: voiding after a
            // debit memo exists would leave quantityCredited > quantityShipped
            // with no path to reconcile. Worse here than on the sales side —
            // post-memo recovers the GRNI clearing amount from THIS shipment's
            // costLedger rows, so a void afterwards strands that clearing and
            // leaves GRNI permanently out by the carried cost.
            const debitMemos = await many(
              db,
              "memo",
              { purchaseReturnOrderId, companyId, status: neq("Voided") },
              { columns: ["id", "status"] }
            );
            if (debitMemos.error)
              throw new Error("Failed to check for debit memos");
            if ((debitMemos.data ?? []).length > 0) {
              throw new Error(
                "Cannot void: a debit memo exists for this return order. Void it first."
              );
            }

            // Every void posts its reversal: Provisional before the
            // company's accounting cutover, Posted after it. Read here to
            // decide whether to resolve a period, and again inside the
            // transaction.
            const postingStatus = await journalPostingStatus(db, companyId);

            const [
              originalJournalLines,
              originalItemLedger,
              returnLinesVoid,
              originalCostRows
            ] = await inOrder([
              () =>
                documentJournalLines(db, companyId, {
                  documentId: shipmentId,
                  documentType: "Return Order"
                }),
              () =>
                many(db, "itemLedger", {
                  documentId: shipmentId,
                  documentType: "Purchase Return Shipment",
                  companyId
                }),
              () =>
                many(db, "purchaseReturnOrderLine", {
                  purchaseReturnOrderId,
                  companyId
                }),
              () =>
                many(db, "costLedger", {
                  documentId: shipmentId,
                  documentType: "Purchase Return Shipment",
                  companyId
                })
            ]);
            // A failed read here must abort: treating data:null as "nothing
            // to reverse" would mark the shipment Voided while its journal
            // and ledger rows stand.
            if (originalItemLedger.error)
              throw new Error("Failed to fetch item ledger rows to reverse");
            if (returnLinesVoid.error)
              throw new Error("Failed to fetch return order lines");
            if (originalCostRows.error)
              throw new Error("Failed to fetch cost ledger rows to reverse");

            const shippedByLine = new Map<string, number>();
            for (const shipmentLine of shipmentLines.data ?? []) {
              if (!shipmentLine.lineId) continue;
              const qty = Number(shipmentLine.shippedQuantity ?? 0);
              shippedByLine.set(
                shipmentLine.lineId,
                (shippedByLine.get(shipmentLine.lineId) ?? 0) + qty
              );
            }

            // A Provisional journal has no accounting period.
            const accountingPeriodId =
              postingStatus === "Posted" && originalJournalLines.length > 0
                ? await getCurrentAccountingPeriod(companyId, db, today)
                : null;

            await db.transaction().execute(async (trx) => {
              await assertPostingStatusUnchanged(trx, companyId, postingStatus);
              const reversingItemLedger = (originalItemLedger.data ?? []).map(
                (entry) => ({
                  postingDate: today,
                  itemId: entry.itemId,
                  quantity: -entry.quantity,
                  locationId: entry.locationId,
                  storageUnitId: entry.storageUnitId,
                  entryType: "Positive Adjmt." as const,
                  documentType: "Purchase Return Shipment" as const,
                  documentId: entry.documentId,
                  externalDocumentId: entry.externalDocumentId,
                  trackedEntityId: entry.trackedEntityId,
                  createdBy: userId,
                  companyId
                })
              );
              if (reversingItemLedger.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(reversingItemLedger)
                  .execute();
              }

              // Restore inventory VALUE, not just quantity: posting consumed
              // FIFO layers via calculateCOGS; without an offsetting layer
              // the voided stock re-enters at zero value and inventory is
              // permanently understated.
              for (const row of (originalCostRows.data ?? []).filter(
                (r) => Number(r.quantity) < 0
              )) {
                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: row.itemLedgerType,
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Purchase Return Shipment",
                    documentId: row.documentId,
                    externalDocumentId: row.externalDocumentId ?? undefined,
                    itemId: row.itemId,
                    quantity: round(-Number(row.quantity)),
                    cost: round(-Number(row.cost)),
                    nominalCost: round(-Number(row.nominalCost)),
                    remainingQuantity: round(-Number(row.quantity)),
                    companyId,
                    postingDate: today
                  })
                  .execute();
              }

              if (originalJournalLines.length > 0) {
                const originalLines = originalJournalLines;
                // Carry the original lines' GL dimensions onto the reversing
                // lines so the void mirrors the posting.
                const originalDimensions = await many(
                  trx,
                  "journalLineDimension",
                  {
                    journalLineId: originalLines.map((l) => l.id),
                    companyId
                  },
                  { columns: ["journalLineId", "dimensionId", "valueId"] }
                );
                const dimensionsByLine = new Map<
                  string,
                  { dimensionId: string; valueId: string }[]
                >();
                for (const dim of originalDimensions.data ?? []) {
                  const list = dimensionsByLine.get(dim.journalLineId) ?? [];
                  list.push({
                    dimensionId: dim.dimensionId,
                    valueId: dim.valueId
                  });
                  dimensionsByLine.set(dim.journalLineId, list);
                }

                const journalEntryId = await sequence.getNextSequence(
                  trx,
                  "journalEntry",
                  companyId
                );
                const journalResult = await trx
                  .insertInto("journal")
                  .values({
                    journalEntryId,
                    accountingPeriodId,
                    description: `VOID Purchase Return Shipment ${shipmentHeader.shipmentId}`,
                    postingDate: today,
                    companyId,
                    sourceType: "Purchase Return Shipment",
                    status: postingStatus,
                    postedAt: datetime.timestamp(),
                    postedBy: userId,
                    createdBy: userId
                  })
                  .returning(["id"])
                  .executeTakeFirstOrThrow();
                const journalLineResults = await trx
                  .insertInto("journalLine")
                  .values(
                    originalLines.map((line) => ({
                      accountId: line.accountId,
                      description: `VOID: ${line.description ?? ""}`,
                      amount: -line.amount,
                      quantity:
                        line.quantity == null ? undefined : -line.quantity,
                      documentType: line.documentType,
                      documentId: line.documentId,
                      externalDocumentId: line.externalDocumentId ?? undefined,
                      documentLineReference:
                        line.documentLineReference ?? undefined,
                      journalLineReference: line.journalLineReference,
                      journalId: journalResult.id,
                      companyId
                    }))
                  )
                  .returning(["id"])
                  .execute();

                const voidDimensionInserts: {
                  journalLineId: string;
                  dimensionId: string;
                  valueId: string;
                  companyId: string;
                }[] = [];
                journalLineResults.forEach((jl, index) => {
                  const originalId = originalLines[index]?.id;
                  if (!originalId) return;
                  for (const dim of dimensionsByLine.get(originalId) ?? []) {
                    voidDimensionInserts.push({
                      journalLineId: jl.id,
                      dimensionId: dim.dimensionId,
                      valueId: dim.valueId,
                      companyId
                    });
                  }
                });
                if (voidDimensionInserts.length > 0) {
                  await trx
                    .insertInto("journalLineDimension")
                    .values(voidDimensionInserts)
                    .execute();
                }
              }

              for await (const [lineId, shipped] of shippedByLine) {
                const line = (returnLinesVoid.data ?? []).find(
                  (l) => l.id === lineId
                );
                if (!line) continue;
                await trx
                  .updateTable("purchaseReturnOrderLine")
                  .set({
                    quantityShipped: Math.max(
                      0,
                      Number(line.quantityShipped ?? 0) - shipped
                    ),
                    updatedBy: userId
                  })
                  .where("id", "=", lineId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              const remainingLines = await trx
                .selectFrom("purchaseReturnOrderLine")
                .select(["quantity", "quantityShipped", "closedComplete"])
                .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
                .execute();
              // Derived status (mirrors getPurchaseReturnOrderStatus): a void
              // that drops shipped quantity below the authorized total returns
              // the order to To Ship; otherwise it stays Completed.
              const allShipped =
                remainingLines.length > 0 &&
                remainingLines.every(
                  (l) =>
                    l.closedComplete ||
                    Number(l.quantityShipped) >= Number(l.quantity)
                );
              const returnStatus = allShipped
                ? ("Completed" as const)
                : ("To Ship" as const);
              await trx
                .updateTable("purchaseReturnOrder")
                .set({ status: returnStatus, updatedBy: userId })
                .where("id", "=", purchaseReturnOrderId)
                .where("companyId", "=", companyId)
                .execute();

              const voidActivity = await trx
                .insertInto("trackedActivity")
                .values({
                  type: "Void Shipment",
                  sourceDocument: "Shipment",
                  sourceDocumentId: shipmentId,
                  sourceDocumentReadableId: shipmentHeader.shipmentId,
                  attributes: {
                    "Purchase Return Order": purchaseReturnOrderId,
                    Shipment: shipmentId,
                    Employee: userId
                  },
                  companyId,
                  createdBy: userId,
                  createdAt: today
                })
                .returning(["id"])
                .execute();
              const voidActivityId = voidActivity[0]?.id;

              for await (const entity of shipmentLineTracking.data ?? []) {
                await trx
                  .updateTable("trackedEntity")
                  .set({ status: "Available" })
                  .where("id", "=", entity.id)
                  .where("companyId", "=", companyId)
                  .execute();
                if (voidActivityId) {
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId: voidActivityId,
                      trackedEntityId: entity.id,
                      quantity: entity.quantity ?? 0,
                      companyId,
                      createdBy: userId,
                      createdAt: today
                    })
                    .execute();
                }
              }

              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId
                })
                .where("id", "=", shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            });

            break;
          }

          case "Rental Agreement": {
            await voidRentalShipment(db, { shipmentId, companyId, userId });
            break;
          }

          default: {
            throw new Error(
              `Invalid source document type: ${shipmentHeader.sourceDocument}`
            );
          }
        }
        break;
      }
    }

    return {
      success: true,
      splitEntityIds
    };
  } catch (err) {
    // A failed VOID must not touch status: the shipment is still Posted and
    // its ledger/journal rows still stand, so forcing it to Draft would
    // contradict the books and let it be edited and posted a second time.
    if (type !== "void") {
      await updateRows(
        db,
        "shipment",
        { status: "Draft" },
        { id: shipmentId, companyId }
      );
    }
    throw err;
  }
}

/** Writes a shipment's journal, its lines and the lines' dimensions. */
async function insertShipmentJournal(
  trx: KyselyTx,
  {
    journal,
    accountingPeriodId,
    postingDate,
    postingStatus,
    dimensionIdByEntity,
    companyId,
    userId
  }: {
    journal: ShipmentJournal;
    accountingPeriodId: string | null;
    postingDate: string;
    postingStatus: AutomaticJournalStatus;
    dimensionIdByEntity: ReadonlyMap<string, string>;
    companyId: string;
    userId: string;
  }
) {
  const journalEntryId = await sequence.getNextSequence(
    trx,
    "journalEntry",
    companyId
  );
  const journalResult = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId,
      description: journal.description,
      postingDate,
      companyId,
      sourceType: journal.sourceType,
      status: postingStatus,
      postedAt: datetime.timestamp(),
      postedBy: userId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  const journalLineResults = await trx
    .insertInto("journalLine")
    .values(
      journal.lines.map(({ dimensions: _, ...line }) => ({
        ...line,
        journalId: journalResult.id,
        companyId
      }))
    )
    .returning(["id"])
    .execute();

  const dimensionRows = journalLineDimensionRows({
    journalLineIds: journalLineResults.map((line) => line.id),
    lines: journal.lines,
    dimensionIdByEntity,
    companyId
  });
  if (dimensionRows.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionRows)
      .execute();
  }
}

// Pure cost resolver for Unscrap: given the ORIGINAL scrap movement's
// costLedger rows (linked via costLedger.documentId = the scrap itemLedger id),
// return the unit cost the restored layer must book at so a scrap→unscrap
// round trip nets zero P&L (Oracle Return-from-Scrap precedent). Returns null
// when the rows can't yield a cost — the caller then falls back to current
// cost.

export function resolveUnscrapUnitCost(
  rows: Array<{ quantity: number; cost: number }>
): number | null {
  if (rows.length === 0) return null;
  let totalQuantity = 0;
  let totalCost = 0;
  for (const row of rows) {
    totalQuantity += Math.abs(Number(row.quantity) || 0);
    totalCost += Math.abs(Number(row.cost) || 0);
  }
  if (totalQuantity === 0) return null;
  return totalCost / totalQuantity;
}
// settleQuantity needs the lot's CURRENT status to know whether to preserve it
// (a Scrapped lot stays Scrapped at zero). get_item_quantities_by_tracking_id
// doesn't carry status, so read it off the row — one PK lookup inside the open
// transaction, next to the write it informs.
//
// LOCKED: the caller feeds this status straight back through settleQuantity, so
// an unlocked read is a read-modify-write on `status`. Without the lock a
// concurrent transaction that Scraps the lot between our read and our update is
// silently overwritten with the stale `Available` we read.
async function currentEntityStatus(
  trx: Transaction<KyselyDatabase>,
  trackedEntityId: string,
  companyId: string
): Promise<Database["public"]["Enums"]["trackedEntityStatus"]> {
  const row = await trx
    .selectFrom("trackedEntity")
    .select("status")
    .where("id", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return row.status;
}

// The single write path for manual inventory adjustments (ERP quantities page,
// MES shop floor). Ports the former app-side insertManualInventoryAdjustment
// semantics — Set Quantity resolution, storage-unit transfers, serial/batch
// stock-target resolution, tracked-entity creation/updates — and books every
// movement through the shared posting core in ONE transaction: item ledger +
// cost layers + a balanced journal (Provisional before the accounting
// cutover, Posted after it) against the inventory adjustment variance account. Storage-unit transfers
// move value-neutral stock and never post to the GL.
// Business-validation failures are 400s (InvalidInputError) with the exact
// message the app routes string-match on; everything else is a 500 so real
// outages surface in monitoring.

export const postInventoryAdjustmentPermission = {
  update: "inventory"
} satisfies PermissionRule<z.output<typeof postInventoryAdjustmentInput>>;

/** The single write path for manual inventory adjustments; see the note above. */
export async function postInventoryAdjustment(
  ctx: ServiceContext,
  raw: z.input<typeof postInventoryAdjustmentInput>
) {
  const {
    adjustmentType,
    itemId,
    locationId: payloadLocationId,
    storageUnitId,
    trackedEntityId,
    quantity,
    readableId,
    originalStorageUnitId,
    expirationDate: providedExpirationDate,
    comment,
    scrapReasonId,
    unscrapOfItemLedgerId
  } = postInventoryAdjustmentInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  // Unscrap sends no location (resolved from the scrap movement); every
  // other type carries one (app-layer validator enforces it).
  const locationId: string | null = payloadLocationId ?? null;
  // The service-role client proves the caller may act in companyId, not that
  // the ids below belong to it — each lands on this company's ledger rows or
  // journal dimensions, and their single-column FKs accept any company's row.
  await assertCompanyRecords(
    db,
    "location",
    [locationId],
    companyId,
    "Location"
  );
  await assertCompanyRecords(
    db,
    "storageUnit",
    [storageUnitId, originalStorageUnitId],
    companyId,
    "Storage unit"
  );
  await assertCompanyRecords(
    db,
    "scrapReason",
    [scrapReasonId],
    companyId,
    "Scrap reason"
  );
  // A trackedEntityId that exists nowhere is legitimate: the app mints the id
  // (nanoid) for a NEW serial/batch and this function inserts it. One that
  // belongs to another company is not — the paths below would write ledger
  // rows pointing at it (the insert only fails by accident of the id-only PK).
  if (trackedEntityId) {
    const existing = await db
      .selectFrom("trackedEntity")
      .select("companyId")
      .where("id", "=", trackedEntityId)
      .executeTakeFirst();
    if (existing && existing.companyId !== companyId) {
      throw new NotFoundError("Tracked entity not found");
    }
  }

  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  const nowIso = datetime.timestamp();

  const [storageUnitQuantities, itemResult, itemCostResult, shelfLife] =
    await inOrder([
      () =>
        rpcRows(db, "get_item_quantities_by_tracking_id", {
          item_id: itemId,
          company_id: companyId,
          location_id: locationId ?? ""
        }),
      () =>
        single(
          db,
          "item",
          { id: itemId, companyId },
          {
            columns: [
              "id",
              "itemTrackingType",
              "replenishmentSystem",
              "readableIdWithRevision"
            ]
          }
        ),
      () =>
        single(
          db,
          "itemCost",
          { itemId, companyId },
          {
            columns: [
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ]
          }
        ),
      () =>
        maybeSingle(
          db,
          "itemShelfLife",
          { itemId, companyId },
          { columns: ["mode", "days"] }
        )
    ]);

  if (itemResult.error) throw new Error("Failed to fetch item");
  if (itemCostResult.error) throw new Error("Failed to fetch item cost");
  // Fail closed: a failed quantity read must abort, not read as "no stock" —
  // a Set Quantity against an empty snapshot would post the full target as
  // new stock on top of whatever actually exists.
  if (storageUnitQuantities.error) {
    throw new Error("Failed to fetch current quantities");
  }
  if (shelfLife.error) throw new Error("Failed to fetch item shelf life");
  const item = {
    itemTrackingType: itemResult.data.itemTrackingType,
    replenishmentSystem: itemResult.data.replenishmentSystem,
    itemPostingGroupId: itemCostResult.data.itemPostingGroupId
  };
  const itemCost = itemCostResult.data;

  // Every adjustment that carries value posts a journal: Provisional before
  // the company's accounting cutover, Posted after it. Read here to decide
  // whether to resolve a period, and again inside the transaction.
  const postingStatus = await journalPostingStatus(db, companyId);
  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

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
      entityType: [
        "Item",
        "ItemPostingGroup",
        "Location",
        "ScrapReason",
        "WorkCenter",
        "Employee"
      ]
    },
    { columns: ["id", "entityType"] }
  );
  // Fail closed: journal lines must not silently lose dimension tags.
  if (dimensions.error) throw new Error("Failed to fetch dimensions");
  for (const dim of dimensions.data ?? []) {
    if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
  }
  // Resolved before the posting transaction opens: given `db`, it runs and
  // commits its own short transaction. A Provisional journal has no period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, db, today)
      : null;
  const accounting = {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      inventoryAdjustmentVarianceAccount:
        accountDefaults.data.inventoryAdjustmentVarianceAccount
    },
    description: comment?.trim()
      ? `Inventory Adjustment — ${comment.trim()}`
      : "Inventory Adjustment",
    userId,
    dimensions: dimensionMap
  };

  // get_item_quantities_by_tracking_id rows (scoped to item + location);
  // only the fields this function reads.
  type TrackingQuantityRow = {
    trackedEntityId: string | null;
    storageUnitId: string | null;
    quantity: number | null;
    readableId: string | null;
  };
  const trackingRows = (storageUnitQuantities.data ??
    []) as TrackingQuantityRow[];

  const ledgerBase = {
    postingDate: today,
    itemId,
    locationId,
    storageUnitId: storageUnitId ?? null,
    trackedEntityId: trackedEntityId ?? null,
    documentType: null,
    documentId: null,
    comment: comment || null,
    companyId,
    createdBy: userId
  };

  // null == undefined — loose equality is deliberate (ported behavior).
  const currentQuantity = trackedEntityId
    ? trackingRows.find((q) => q.trackedEntityId == trackedEntityId)
    : trackingRows.find((q) => q.storageUnitId == storageUnitId);
  const currentQuantityOnHand = currentQuantity?.quantity ?? 0;

  // Fixed Duration shelf-life fallback for NEW tracked entities when the
  // user did not type an expiry. Other modes stay NULL (resolved at
  // production/receipt time, not on a manual adjustment).
  const resolveExpirationForNewEntity = (): string | null => {
    if (providedExpirationDate) return providedExpirationDate;
    if (
      !shelfLife.error &&
      shelfLife.data?.mode === "Fixed Duration" &&
      shelfLife.data.days
    ) {
      return parseDate(today)
        .add({ days: Number(shelfLife.data.days) })
        .toString();
    }
    return null;
  };

  // Existing-entity expiry override: only when the user supplied a value
  // that differs from the current one. Ports updateTrackedEntityExpiry —
  // appends to attributes.expiryOverrides so the override is traceable.
  const applyExpirationOverride = async (
    trx: Transaction<KyselyDatabase>,
    targetEntityId: string
  ) => {
    if (!providedExpirationDate) return;
    const existing = await trx
      .selectFrom("trackedEntity")
      .select(["expirationDate", "attributes", "status"])
      .where("id", "=", targetEntityId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!existing || existing.expirationDate === providedExpirationDate) return;
    if (existing.status === "Consumed") {
      throw new InvalidInputError(
        "Cannot edit expiry of a consumed tracked entity"
      );
    }
    const prevAttrs =
      (existing.attributes as Record<string, unknown> | null) ?? {};
    const prevHistory = Array.isArray(prevAttrs.expiryOverrides)
      ? (prevAttrs.expiryOverrides as Record<string, unknown>[])
      : [];
    const nextAttrs = {
      ...prevAttrs,
      expiryOverrides: [
        ...prevHistory,
        {
          previous: existing.expirationDate ?? null,
          next: providedExpirationDate,
          reason: comment?.trim() || "Updated via inventory adjustment",
          source: "Inventory Adjustment",
          userId,
          at: nowIso
        }
      ]
    };
    await trx
      .updateTable("trackedEntity")
      .set({
        expirationDate: providedExpirationDate,
        attributes: nextAttrs as unknown as Json
      })
      .where("id", "=", targetEntityId)
      .where("companyId", "=", companyId)
      .execute();
  };

  let resultLedgerId: string | null = null;

  // Storage-unit transfer for a tracked entity: negative at the original
  // unit, positive at the new one. Value does not move — no GL, no layers.
  const isStorageUnitTransfer =
    trackedEntityId &&
    originalStorageUnitId &&
    originalStorageUnitId !== storageUnitId;

  // Scrap/Unscrap offset to the company's scrapAccount so cost of quality is
  // separable on the P&L; analysis slices by dimension (ScrapReason /
  // Employee + the standard trio) instead of by account. Resolved only for a
  // Scrap or Unscrap. An empty scrapAccount falls back to the variance
  // account.
  const scrapAccountingFor = (description: string) => {
    const scrapAccountId = resolveDefaultAccount(
      accountDefaults.data,
      "scrapAccount",
      postingStatus
    ).accountId;
    return {
      ...accounting,
      offsetAccount: scrapAccountId,
      offsetDescription: "Scrap Account",
      description,
      extraDimensions: [
        ...(scrapReasonId
          ? [{ entityType: "ScrapReason", valueId: scrapReasonId }]
          : []),
        { entityType: "Employee", valueId: userId }
      ]
    };
  };

  await db.transaction().execute(async (trx) => {
    await assertPostingStatusUnchanged(trx, companyId, postingStatus);

    if (adjustmentType === "Scrap") {
      const scrapLedgerBase = {
        ...ledgerBase,
        documentType: "Scrap" as const,
        scrapReasonId,
        entryType: "Negative Adjmt." as const
      };
      const accountingForScrap = scrapAccountingFor(
        comment?.trim() ? `Scrap — ${comment.trim()}` : "Scrap"
      );

      if (trackedEntityId) {
        const entity = await trx
          .selectFrom("trackedEntity")
          .select([
            "id",
            "quantity",
            "status",
            "readableId",
            "sourceDocument",
            "sourceDocumentId",
            "sourceDocumentReadableId",
            "itemId",
            "expirationDate",
            "attributes"
          ])
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!entity) throw new InvalidInputError("Tracked entity not found");
        if (entity.status !== "Available") {
          throw new InvalidInputError(
            "Only available tracked entities can be scrapped"
          );
        }
        const entityQuantity = round(Number(entity.quantity) || 0);
        // quantity 0 ⇒ scrap the whole entity (serial UIs don't send a qty)
        const scrapQuantity = quantity > 0 ? round(quantity) : entityQuantity;
        if (scrapQuantity > entityQuantity) {
          throw new InvalidInputError("Insufficient quantity for scrap");
        }
        const bin = currentQuantity?.storageUnitId ?? storageUnitId ?? null;

        let scrappedEntityId = trackedEntityId;
        if (!isFullDraw(entityQuantity, scrapQuantity)) {
          // Partial batch scrap: identity-flip split — the parent keeps its
          // id and is decremented; the departing child is the Scrapped
          // record of what left.
          const split = buildBatchSplitRecords({
            parent: {
              id: entity.id,
              readableId: entity.readableId,
              quantity: entityQuantity,
              sourceDocument: entity.sourceDocument,
              sourceDocumentId: entity.sourceDocumentId,
              sourceDocumentReadableId: entity.sourceDocumentReadableId,
              itemId: entity.itemId,
              expirationDate: entity.expirationDate
                ? String(entity.expirationDate)
                : null,
              attributes:
                (entity.attributes as Record<string, unknown> | null) ?? null
            },
            drawQuantity: scrapQuantity,
            childId: nanoid(),
            splitActivityId: nanoid(),
            activitySourceDocument: "Item",
            activitySourceDocumentId: itemId,
            bin: { storageUnitId: bin, locationId },
            itemLedgerItemId: itemId,
            companyId,
            userId,
            postingDate: today,
            childStatus: "Scrapped"
          });
          await trx
            .insertInto("trackedEntity")
            .values({
              ...split.childEntityInsert,
              sourceDocument: split.childEntityInsert.sourceDocument ?? "Item",
              sourceDocumentId:
                split.childEntityInsert.sourceDocumentId ?? itemId,
              attributes: split.childEntityInsert.attributes as unknown as Json
            })
            .execute();
          await trx
            .updateTable("trackedEntity")
            .set(split.parentUpdate)
            .where("id", "=", entity.id)
            .where("companyId", "=", companyId)
            .execute();
          await trx
            .insertInto("trackedActivity")
            .values({
              ...split.activityInsert,
              attributes: split.activityInsert.attributes as unknown as Json
            })
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
            .insertInto("itemLedger")
            .values(
              split.ledgerInserts.map((ledgerRow) => ({
                ...ledgerRow,
                itemId: ledgerRow.itemId ?? itemId,
                quantity: round(ledgerRow.quantity)
              }))
            )
            .execute();
          scrappedEntityId = split.childEntityInsert.id;
        } else {
          // Full-entity scrap: terminal status flip; the entity KEEPS its
          // quantity as the record of what was scrapped (the negative
          // ledger row below carries the stock decrement).
          await trx
            .updateTable("trackedEntity")
            .set({ status: "Scrapped" })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        const scrapActivityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: scrapActivityId,
            type: "Scrap",
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            attributes: {
              "Scrap Reason": scrapReasonId,
              Employee: userId,
              ...(comment?.trim() ? { Notes: comment.trim() } : {})
            },
            companyId,
            createdBy: userId
          })
          .execute();
        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: scrapActivityId,
            trackedEntityId: scrappedEntityId,
            quantity: scrapQuantity,
            companyId,
            createdBy: userId
          })
          .execute();

        const booked = await bookAdjustment(trx, {
          ledger: {
            ...scrapLedgerBase,
            trackedEntityId: scrappedEntityId,
            storageUnitId: bin,
            quantity: -Math.abs(scrapQuantity)
          },
          item,
          itemCost,
          accounting: accountingForScrap
        });
        resultLedgerId = booked.itemLedgerId;
        return;
      }

      // Untracked scrap: negative movement from the bin's untracked stock.
      if (quantity <= 0) {
        throw new InvalidInputError("Scrap quantity must be greater than zero");
      }
      const untrackedRow = trackingRows.find(
        (q) => q.trackedEntityId == null && q.storageUnitId == storageUnitId
      );
      if ((untrackedRow?.quantity ?? 0) < quantity) {
        throw new InvalidInputError("Insufficient quantity for scrap");
      }
      const booked = await bookAdjustment(trx, {
        ledger: {
          ...scrapLedgerBase,
          trackedEntityId: null,
          quantity: -Math.abs(quantity)
        },
        item,
        itemCost,
        accounting: accountingForScrap
      });
      resultLedgerId = booked.itemLedgerId;
      return;
    }

    if (adjustmentType === "Unscrap") {
      const unscrapLedgerBase = {
        ...ledgerBase,
        documentType: "Scrap" as const,
        scrapReasonId,
        entryType: "Positive Adjmt." as const
      };
      const accountingForUnscrap = scrapAccountingFor(
        comment?.trim() ? `Unscrap — ${comment.trim()}` : "Unscrap"
      );

      if (trackedEntityId) {
        const entity = await trx
          .selectFrom("trackedEntity")
          .select(["id", "quantity", "status"])
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!entity) throw new InvalidInputError("Tracked entity not found");
        if (entity.status !== "Scrapped") {
          throw new InvalidInputError(
            "Only scrapped tracked entities can be unscrapped"
          );
        }
        const entityQuantity = Number(entity.quantity) || 0;
        if (entityQuantity <= 0) {
          throw new InvalidInputError(
            "Tracked entity has no quantity to restore"
          );
        }

        // The original scrap movement: explicit id from the payload, else
        // the entity's newest negative Scrap row.
        let scrapMovement = unscrapOfItemLedgerId
          ? await trx
              .selectFrom("itemLedger")
              .select(["id", "storageUnitId", "locationId", "scrapReasonId"])
              .where("id", "=", unscrapOfItemLedgerId)
              .where("companyId", "=", companyId)
              // Constrain a caller-supplied id to THIS entity's own negative
              // Scrap movements (same filters as the fallback below) — an
              // unrelated ledger id must not drive the restored bin/cost.
              .where("trackedEntityId", "=", trackedEntityId)
              .where("documentType", "=", "Scrap")
              .where("quantity", "<", 0)
              .executeTakeFirst()
          : undefined;
        if (!scrapMovement) {
          scrapMovement = await trx
            .selectFrom("itemLedger")
            .select(["id", "storageUnitId", "locationId", "scrapReasonId"])
            .where("trackedEntityId", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .where("documentType", "=", "Scrap")
            .where("quantity", "<", 0)
            .orderBy("createdAt", "desc")
            .executeTakeFirst();
        }

        // Inherit the reason from the original scrap movement so an unscrap
        // is never mis-classified — the operator no longer re-enters it. Fall
        // back to any payload reason, then null (untracked/legacy rows).
        const resolvedScrapReasonId =
          scrapMovement?.scrapReasonId ?? scrapReasonId ?? null;
        const accountingForTrackedUnscrap = {
          ...accountingForUnscrap,
          extraDimensions: [
            ...(resolvedScrapReasonId
              ? [
                  {
                    entityType: "ScrapReason",
                    valueId: resolvedScrapReasonId
                  }
                ]
              : []),
            { entityType: "Employee", valueId: userId }
          ]
        };

        // Reverse at the ORIGINAL scrapped cost when the scrap movement's
        // cost rows are resolvable (costLedger.documentId = the scrap
        // itemLedger id — bookAdjustment's linkage); else current cost.
        let fixedUnitCost: number | undefined;
        if (scrapMovement) {
          const costRows = await trx
            .selectFrom("costLedger")
            .select(["quantity", "cost"])
            .where("documentId", "=", scrapMovement.id)
            .where("companyId", "=", companyId)
            .execute();
          const resolved = resolveUnscrapUnitCost(
            costRows.map((r) => ({
              quantity: Number(r.quantity),
              cost: Number(r.cost)
            }))
          );
          if (resolved != null) fixedUnitCost = resolved;
        }

        await trx
          .updateTable("trackedEntity")
          .set({ status: "Available" })
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();

        const unscrapActivityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: unscrapActivityId,
            type: "Unscrap",
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            attributes: {
              "Scrap Reason": resolvedScrapReasonId,
              Employee: userId,
              ...(comment?.trim() ? { Notes: comment.trim() } : {})
            },
            companyId,
            createdBy: userId
          })
          .execute();
        await trx
          .insertInto("trackedActivityOutput")
          .values({
            trackedActivityId: unscrapActivityId,
            trackedEntityId,
            quantity: entityQuantity,
            companyId,
            createdBy: userId
          })
          .execute();

        const booked = await bookAdjustment(trx, {
          ledger: {
            ...unscrapLedgerBase,
            scrapReasonId: resolvedScrapReasonId,
            // A Scrapped tracked-entity row carries no location — restore to
            // the bin/location the scrap movement removed it from.
            locationId:
              scrapMovement?.locationId ?? unscrapLedgerBase.locationId,
            storageUnitId:
              scrapMovement?.storageUnitId ?? storageUnitId ?? null,
            correctionOfItemLedgerId: scrapMovement?.id ?? null,
            quantity: entityQuantity
          },
          item,
          itemCost,
          accounting: accountingForTrackedUnscrap,
          fixedUnitCost
        });
        resultLedgerId = booked.itemLedgerId;
        return;
      }

      // Untracked unscrap: positive movement at current cost (no original
      // movement linkage to reverse against — v1).
      if (quantity <= 0) {
        throw new InvalidInputError(
          "Unscrap quantity must be greater than zero"
        );
      }
      // Unscrap makes locationId optional in the validator (the tracked path
      // recovers it from the scrap movement). The untracked path has no such
      // recovery, so require it — a null-location ledger row is invisible to
      // location-scoped inventory queries.
      if (!locationId) {
        throw new InvalidInputError(
          "Location is required to unscrap untracked stock"
        );
      }
      const booked = await bookAdjustment(trx, {
        ledger: {
          ...unscrapLedgerBase,
          trackedEntityId: null,
          quantity
        },
        item,
        itemCost,
        accounting: accountingForUnscrap
      });
      resultLedgerId = booked.itemLedgerId;
      return;
    }

    if (isStorageUnitTransfer) {
      if (readableId !== undefined && readableId !== null) {
        await trx
          .updateTable("trackedEntity")
          .set({ readableId })
          .where("id", "=", trackedEntityId!)
          .where("companyId", "=", companyId)
          .execute();
      }
      await applyExpirationOverride(trx, trackedEntityId!);

      await bookAdjustment(trx, {
        ledger: {
          ...ledgerBase,
          storageUnitId: originalStorageUnitId!,
          entryType: "Negative Adjmt.",
          quantity: -currentQuantityOnHand
        },
        item,
        itemCost,
        accounting,
        skipValuation: true
      });
      const positive = await bookAdjustment(trx, {
        ledger: {
          ...ledgerBase,
          entryType: "Positive Adjmt.",
          quantity: currentQuantityOnHand
        },
        item,
        itemCost,
        accounting,
        skipValuation: true
      });
      resultLedgerId = positive.itemLedgerId;
      return;
    }

    let entryType: "Positive Adjmt." | "Negative Adjmt." =
      adjustmentType === "Set Quantity" ? "Positive Adjmt." : adjustmentType;
    let adjustmentQuantity = quantity;

    if (adjustmentType === "Set Quantity" && currentQuantity) {
      const quantityDifference = quantity - currentQuantityOnHand;
      if (quantityDifference > 0) {
        entryType = "Positive Adjmt.";
        adjustmentQuantity = quantityDifference;
      } else if (quantityDifference < 0) {
        entryType = "Negative Adjmt.";
        adjustmentQuantity = Math.abs(quantityDifference);
      } else {
        // No quantity change — readableId / expirationDate may still change.
        if (
          trackedEntityId &&
          readableId !== undefined &&
          readableId !== null
        ) {
          await trx
            .updateTable("trackedEntity")
            .set({ readableId })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }
        if (trackedEntityId) {
          await applyExpirationOverride(trx, trackedEntityId);
        }
        resultLedgerId = null;
        return;
      }
    }

    // Resolve the stock target for a negative adjustment when a serial
    // number is provided or nothing matched the loose lookup.
    if (entryType === "Negative Adjmt." && (readableId || !currentQuantity)) {
      if (readableId) {
        const resolvedQtyRow = trackingRows.find(
          (q) =>
            q.readableId === readableId &&
            q.trackedEntityId != null &&
            (q.quantity ?? 0) > 0
        );
        if (!resolvedQtyRow) {
          throw new InvalidInputError("Serial number not found");
        }
        const resolvedId = resolvedQtyRow.trackedEntityId as string;
        const resolvedQty = round(resolvedQtyRow.quantity ?? 0);
        if (round(adjustmentQuantity) > resolvedQty) {
          throw new InvalidInputError(
            "Insufficient quantity for negative adjustment"
          );
        }
        // A negative adjustment draws down Available stock; when it lands
        // on zero the lot is Consumed, not a zero-quantity Available husk.
        // settleQuantity is the shared rule, so this path also preserves a
        // Scrapped lot — which the inline flip it replaces did not.
        await trx
          .updateTable("trackedEntity")
          .set({
            ...settleQuantity({
              quantity: resolvedQty - adjustmentQuantity,
              status: await currentEntityStatus(trx, resolvedId, companyId)
            }),
            readableId
          })
          .where("id", "=", resolvedId)
          .where("companyId", "=", companyId)
          .execute();
        const booked = await bookAdjustment(trx, {
          ledger: {
            ...ledgerBase,
            trackedEntityId: resolvedId,
            entryType,
            quantity: -Math.abs(adjustmentQuantity)
          },
          item,
          itemCost,
          accounting
        });
        resultLedgerId = booked.itemLedgerId;
        return;
      }

      // No serial number provided. Prefer untracked (legacy) stock in this bin.
      const legacyRow = trackingRows.find(
        (q) => q.trackedEntityId == null && q.storageUnitId == storageUnitId
      );
      if (legacyRow) {
        const legacyQty = legacyRow.quantity ?? 0;
        if (adjustmentQuantity > legacyQty) {
          throw new InvalidInputError(
            "Insufficient quantity for negative adjustment"
          );
        }
        const booked = await bookAdjustment(trx, {
          ledger: {
            ...ledgerBase,
            trackedEntityId: null,
            entryType,
            quantity: -Math.abs(adjustmentQuantity)
          },
          item,
          itemCost,
          accounting
        });
        resultLedgerId = booked.itemLedgerId;
        return;
      }

      // No untracked stock in the bin — resolve a tracked entity sitting in
      // the same storage unit. Ambiguous when more than one holds stock.
      const trackedRowsInUnit = trackingRows.filter(
        (q) =>
          q.trackedEntityId != null &&
          q.storageUnitId == storageUnitId &&
          (q.quantity ?? 0) > 0
      );
      if (trackedRowsInUnit.length === 0) {
        throw new InvalidInputError(
          "Insufficient quantity for negative adjustment"
        );
      }
      if (trackedRowsInUnit.length > 1) {
        throw new InvalidInputError(
          "Multiple tracked entities in this storage unit — select a specific row to adjust"
        );
      }
      const targetRow = trackedRowsInUnit[0]!;
      const targetQty = round(targetRow.quantity ?? 0);
      if (round(adjustmentQuantity) > targetQty) {
        throw new InvalidInputError(
          "Insufficient quantity for negative adjustment"
        );
      }
      const targetId = targetRow.trackedEntityId as string;
      await trx
        .updateTable("trackedEntity")
        .set(
          settleQuantity({
            quantity: targetQty - adjustmentQuantity,
            status: await currentEntityStatus(trx, targetId, companyId)
          })
        )
        .where("id", "=", targetId)
        .where("companyId", "=", companyId)
        .execute();
      const booked = await bookAdjustment(trx, {
        ledger: {
          ...ledgerBase,
          trackedEntityId: targetId,
          entryType,
          quantity: -Math.abs(adjustmentQuantity)
        },
        item,
        itemCost,
        accounting
      });
      resultLedgerId = booked.itemLedgerId;
      return;
    }

    let signedQuantity = adjustmentQuantity;
    if (entryType === "Negative Adjmt.") {
      if (adjustmentQuantity > currentQuantityOnHand) {
        throw new InvalidInputError(
          "Insufficient quantity for negative adjustment"
        );
      }
      signedQuantity = -Math.abs(adjustmentQuantity);
    }

    if (trackedEntityId) {
      if (currentQuantity) {
        // Draining a lot to zero Consumes it (a Set Quantity to 0 or a full
        // negative adjustment); above zero its status is untouched. This path
        // takes an arbitrary trackedEntityId from the payload, so it is the
        // one that can land on a Scrapped lot — settleQuantity preserves it.
        const entityUpdate: Record<string, unknown> = settleQuantity({
          quantity: signedQuantity + currentQuantityOnHand,
          status: await currentEntityStatus(trx, trackedEntityId, companyId)
        });
        if (readableId !== undefined && readableId !== null) {
          entityUpdate.readableId = readableId;
        }
        await trx
          .updateTable("trackedEntity")
          .set(entityUpdate)
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();
        await applyExpirationOverride(trx, trackedEntityId);
      } else {
        // Nothing to create for a zero-quantity new entity: the physical
        // state is already zero, so skip the insert AND the ledger row and
        // return a success no-op (keeps repeated scanners idempotent).
        if (round(signedQuantity) === 0) {
          return;
        }
        const expirationDate = resolveExpirationForNewEntity();
        // Stamp the trace blob so the popover Source / Override steps can
        // show the entity originated from a manual inventory adjustment.
        const adjustmentStamp = {
          userId,
          at: nowIso,
          reason: comment?.trim() || "Created via inventory adjustment"
        };
        const attributes: Record<string, unknown> = {
          "Inventory Adjustment": adjustmentStamp,
          ...(expirationDate
            ? {
                expiryOverrides: [
                  {
                    previous: null,
                    next: expirationDate,
                    reason: adjustmentStamp.reason,
                    source: "Inventory Adjustment",
                    userId: adjustmentStamp.userId,
                    at: adjustmentStamp.at
                  }
                ]
              }
            : {})
        };
        await trx
          .insertInto("trackedEntity")
          .values({
            id: trackedEntityId,
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            sourceDocumentReadableId:
              itemResult.data.readableIdWithRevision ?? undefined,
            // Every by-item consumer filters on this column (notably the
            // sales-return picker); omitting it made this stock unreturnable.
            itemId,
            readableId: readableId ?? null,
            quantity: round(signedQuantity),
            status: "Available",
            expirationDate,
            attributes: attributes as unknown as Json,
            companyId,
            createdBy: userId
          })
          .execute();
      }
    }

    const booked = await bookAdjustment(trx, {
      ledger: {
        ...ledgerBase,
        entryType,
        quantity: signedQuantity
      },
      item,
      itemCost,
      accounting
    });
    resultLedgerId = booked.itemLedgerId;
  });

  // Set inside the transaction callback, which narrowing does not follow.
  const ledgerId = resultLedgerId as string | null;
  return {
    success: true,
    itemLedger: ledgerId ? { id: ledgerId } : null
  };
}
type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

export const postPickingPermission = {} satisfies PermissionRule<
  z.output<typeof postPickingInput>
>;

/**
 * Picks, un-picks and returns picking-list material, per `type`.
 *
 * A pick is a TRANSFER of material from the warehouse source shelf
 * (pickingListLine.storageUnitId) to the work center's lineside shelf
 * (pickingListLine.toStorageUnitId). Consumption happens later at production,
 * which is why we also point jobMaterial.storageUnitId at the lineside shelf.
 */
export async function postPicking(
  ctx: ServiceContext,
  raw: z.input<typeof postPickingInput>
) {
  const input = postPickingInput.parse(raw);

  const db = ctx.asSystem.pg;
  const validatedPayload = {
    ...input,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  };

  // The permission check proves the caller may act in companyId, not that the
  // body's ids belong to it. Every line-scoped case writes pickingListId as the
  // ledger/activity documentId and locationId / fromStorageUnitId /
  // trackedEntityId onto this company's ledger rows, so all of them are
  // re-read under companyId — and the line must be on the list the body names.
  if ("pickingListLineId" in validatedPayload) {
    const { companyId, pickingListId, pickingListLineId, locationId } =
      validatedPayload;
    const line = await db
      .selectFrom("pickingListLine")
      .select("id")
      .where("id", "=", pickingListLineId)
      .where("pickingListId", "=", pickingListId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!line) throw new NotFoundError("Picking list line not found");
    await assertCompanyRecords(
      db,
      "location",
      [locationId],
      companyId,
      "Location"
    );
    await assertCompanyRecords(
      db,
      "storageUnit",
      [
        "fromStorageUnitId" in validatedPayload
          ? validatedPayload.fromStorageUnitId
          : null
      ],
      companyId,
      "Storage unit"
    );
    await assertCompanyRecords(
      db,
      "trackedEntity",
      [
        "trackedEntityId" in validatedPayload
          ? validatedPayload.trackedEntityId
          : null
      ],
      companyId,
      "Tracked entity"
    );
  }

  const today = datetime
    .today(await getCompanyTimeZone(db, validatedPayload.companyId))
    .toString();
  let splitEntityId: string | undefined;

  switch (validatedPayload.type) {
    case "inventory": {
      const {
        pickingListId,
        pickingListLineId,
        quantity,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const inserts: ItemLedgerInsert[] = [
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(-quantity),
            locationId,
            storageUnitId: line.storageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(quantity),
            locationId,
            storageUnitId: line.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            createdBy: userId,
            companyId
          }
        ];

        await trx.insertInto("itemLedger").values(inserts).execute();

        await trx
          .updateTable("pickingListLine")
          .set({
            quantityPicked: resolvePick({
              lineQuantity: Number(line.quantityToPick ?? 0),
              pickedQuantity: Number(line.quantityPicked ?? 0),
              transferQuantity: quantity
            }),
            status: "Picked",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Production consumes from where the material now physically sits.
        await pointJobMaterialAtLineside(trx, line, userId, companyId);
      });
      break;
    }

    case "unpickInventory": {
      const {
        pickingListId,
        pickingListLineId,
        quantity,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const inserts: ItemLedgerInsert[] = [
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(-quantity),
            locationId,
            storageUnitId: line.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(quantity),
            locationId,
            storageUnitId: line.storageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            createdBy: userId,
            companyId
          }
        ];

        await trx.insertInto("itemLedger").values(inserts).execute();

        await trx
          .updateTable("pickingListLine")
          .set({
            quantityPicked: Math.max(
              0,
              round(round(Number(line.quantityPicked ?? 0)) - round(quantity))
            ),
            status: "Pending",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Restore the warehouse source as the consumption point.
        await restoreJobMaterialSource(trx, line, userId, companyId);
      });
      break;
    }

    case "serial": {
      const {
        pickingListId,
        pickingListLineId,
        trackedEntityId,
        fromStorageUnitId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: "Pick",
            sourceDocument: "Picking List",
            sourceDocumentId: pickingListId,
            attributes: {
              "Picking List": pickingListId,
              "Picking List Line": pickingListLineId,
              "From Shelf": fromStorageUnitId,
              "To Shelf": line.toStorageUnitId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: activityId,
            trackedEntityId,
            quantity: 1,
            companyId,
            createdBy: userId
          })
          .execute();

        const inserts: ItemLedgerInsert[] = [
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: -1,
            locationId,
            storageUnitId: fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: 1,
            locationId,
            storageUnitId: line.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId,
            createdBy: userId,
            companyId
          }
        ];
        await trx.insertInto("itemLedger").values(inserts).execute();

        await trx
          .updateTable("pickingListLine")
          .set({
            quantityPicked: resolvePick({
              lineQuantity: Number(line.quantityToPick ?? 0),
              pickedQuantity: Number(line.quantityPicked ?? 0),
              transferQuantity: 1
            }),
            status: "Picked",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Record which lot this line picked (drives the line's picked-lot
        // display, unpick, and the allocation-dedup in the picker).
        await trx
          .insertInto("pickingListLineTrackedEntity")
          .values({
            pickingListLineId,
            trackedEntityId,
            companyId,
            quantity: 1,
            quantityPicked: 1
          })
          .onConflict((oc) =>
            oc.columns(["pickingListLineId", "trackedEntityId"]).doUpdateSet({
              quantity: (eb) =>
                eb("pickingListLineTrackedEntity.quantity", "+", 1),
              quantityPicked: (eb) =>
                eb("pickingListLineTrackedEntity.quantityPicked", "+", 1)
            })
          )
          .execute();

        await pointJobMaterialAtLineside(trx, line, userId, companyId);
      });
      break;
    }

    case "batch": {
      const {
        pickingListId,
        pickingListLineId,
        trackedEntityId,
        fromStorageUnitId,
        quantity,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Lock the source lot too: the split below draws against this
        // on-hand, and a concurrent pick of the same lot must not spend it.
        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        // Refuse an over-pick before any record is written; resolvePick
        // returns the new running total (the UI caps the picker at the same
        // outstanding figure, so this only fires on a stale page or a
        // double submit — which is exactly when it matters).
        const newQuantityPicked = resolvePick({
          lineQuantity: Number(line.quantityToPick ?? 0),
          pickedQuantity: Number(line.quantityPicked ?? 0),
          transferQuantity: quantity
        });

        // Round BOTH operands once: the split gate, the split records, the
        // Pick activity input, the allocation row and the two ledger rows
        // all derive from these.
        const entityQuantity = round(Number(trackedEntity.quantity));
        const transferQuantity = round(quantity);

        // resolvePick bounds the pick by the LINE's outstanding quantity, not
        // by what this lot holds. A line outstanding larger than the lot would
        // fall through isFullDraw into buildBatchSplitRecords, which throws a
        // plain Error on `draw >= parentQty` — surfaced as a 500. This is the
        // same guard post-stock-transfer's batch case takes, and it makes the
        // refusal a 400 the scan UI can show.
        assertEntityCoversPick({ entityQuantity, transferQuantity });

        const inserts: ItemLedgerInsert[] = [];

        // Split the batch when picking less than the whole entity: the shelf
        // entity keeps its id and is decremented; a NEW child entity departs
        // to the lineside bin carrying the drawn quantity.
        let pickedEntityId = trackedEntityId;
        if (!isFullDraw(entityQuantity, transferQuantity)) {
          const childId = nanoid();
          splitEntityId = childId;
          pickedEntityId = childId;

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
            activitySourceDocument: "Picking List",
            activitySourceDocumentId: pickingListId,
            bin: { storageUnitId: fromStorageUnitId, locationId },
            itemLedgerItemId: line.itemId,
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

          inserts.push(
            ...(split.ledgerInserts.map((ledgerRow) => ({
              ...ledgerRow,
              quantity: round(ledgerRow.quantity)
            })) as typeof inserts)
          );
        }

        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: "Pick",
            sourceDocument: "Picking List",
            sourceDocumentId: pickingListId,
            attributes: {
              "Picking List": pickingListId,
              "Picking List Line": pickingListLineId,
              "From Shelf": fromStorageUnitId,
              "To Shelf": line.toStorageUnitId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: activityId,
            trackedEntityId: pickedEntityId,
            quantity: transferQuantity,
            companyId,
            createdBy: userId
          })
          .execute();

        // A pick MOVES the batch — it stays Available (consumed at production).
        inserts.push(
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(-transferQuantity),
            locationId,
            storageUnitId: fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId: pickedEntityId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(transferQuantity),
            locationId,
            storageUnitId: line.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId: pickedEntityId,
            createdBy: userId,
            companyId
          }
        );

        await trx.insertInto("itemLedger").values(inserts).execute();

        await trx
          .updateTable("pickingListLine")
          .set({
            quantityPicked: newQuantityPicked,
            status: "Picked",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Record which lot this line picked (drives picked-lot display,
        // unpick, and the picker's allocation-dedup). On a split the picked
        // lot is the departing CHILD — the lineside entity the operator
        // consumes — never the shelf survivor.
        await trx
          .insertInto("pickingListLineTrackedEntity")
          .values({
            pickingListLineId,
            trackedEntityId: pickedEntityId,
            companyId,
            quantity: transferQuantity,
            quantityPicked: transferQuantity
          })
          .onConflict((oc) =>
            oc.columns(["pickingListLineId", "trackedEntityId"]).doUpdateSet({
              quantity: (eb) =>
                eb(
                  "pickingListLineTrackedEntity.quantity",
                  "+",
                  transferQuantity
                ),
              quantityPicked: (eb) =>
                eb(
                  "pickingListLineTrackedEntity.quantityPicked",
                  "+",
                  transferQuantity
                )
            })
          )
          .execute();

        await pointJobMaterialAtLineside(trx, line, userId, companyId);
      });
      break;
    }

    case "unpickSerial": {
      const {
        pickingListId,
        pickingListLineId,
        trackedEntityId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        const qty = Number(trackedEntity.quantity);

        const activity = await trx
          .selectFrom("trackedActivity")
          .innerJoin(
            "trackedActivityInput",
            "trackedActivity.id",
            "trackedActivityInput.trackedActivityId"
          )
          .where("trackedActivity.type", "=", "Pick")
          .where("trackedActivity.sourceDocument", "=", "Picking List")
          .where("trackedActivity.sourceDocumentId", "=", pickingListId)
          .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
          .where("trackedActivity.companyId", "=", companyId)
          .selectAll("trackedActivity")
          .executeTakeFirstOrThrow();

        const inserts: ItemLedgerInsert[] = [
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(-qty),
            locationId,
            storageUnitId: line.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(qty),
            locationId,
            storageUnitId: line.storageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId,
            createdBy: userId,
            companyId
          }
        ];
        await trx.insertInto("itemLedger").values(inserts).execute();

        await trx
          .deleteFrom("trackedActivityInput")
          .where("trackedActivityId", "=", activity.id!)
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .deleteFrom("trackedActivity")
          .where("id", "=", activity.id!)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .updateTable("pickingListLine")
          .set({
            quantityPicked: Math.max(
              0,
              round(round(Number(line.quantityPicked ?? 0)) - round(qty))
            ),
            status: "Pending",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Drop the recorded lot so it's pickable again + display clears.
        await trx
          .deleteFrom("pickingListLineTrackedEntity")
          .where("pickingListLineId", "=", pickingListLineId)
          .where("trackedEntityId", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();

        await restoreJobMaterialSource(trx, line, userId, companyId);
      });
      break;
    }

    case "unpickBatch": {
      const {
        pickingListId,
        pickingListLineId,
        trackedEntityId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        // The unpick quantity is what THIS line picked of the entity — from
        // the allocation row, never trackedEntity.quantity: post-flip the
        // allocated entity is the departing child, and once consumption
        // starts its current quantity no longer equals what was picked.
        const allocation = await trx
          .selectFrom("pickingListLineTrackedEntity")
          .where("pickingListLineId", "=", pickingListLineId)
          .where("trackedEntityId", "=", trackedEntityId)
          .selectAll()
          .executeTakeFirst();

        if (!allocation) {
          throw new Error(
            `Cannot unpick batch: no allocation row for picking list line ${pickingListLineId} and tracked entity ${trackedEntityId}`
          );
        }

        const unpickQuantity = Number(allocation.quantityPicked);

        const activity = await trx
          .selectFrom("trackedActivity")
          .innerJoin(
            "trackedActivityInput",
            "trackedActivity.id",
            "trackedActivityInput.trackedActivityId"
          )
          .where("trackedActivity.type", "=", "Pick")
          .where("trackedActivity.sourceDocument", "=", "Picking List")
          .where("trackedActivity.sourceDocumentId", "=", pickingListId)
          .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
          .where("trackedActivity.companyId", "=", companyId)
          .selectAll("trackedActivity")
          .executeTakeFirstOrThrow();

        // Reverse the Transfer pair at the picked magnitude.
        const inserts: ItemLedgerInsert[] = [
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(-unpickQuantity),
            locationId,
            storageUnitId: line.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId,
            createdBy: userId,
            companyId
          },
          {
            postingDate: today,
            itemId: line.itemId,
            quantity: round(unpickQuantity),
            locationId,
            storageUnitId: line.storageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: pickingListId,
            trackedEntityId,
            createdBy: userId,
            companyId
          }
        ];

        // Merge-back undo: post-flip the picked entity is a Split child
        // whose parent stayed on the shelf. Fold the quantity back into the
        // parent and delete the Split so genealogy reads as if the pick
        // never happened. Legacy allocations (no Split From pointer, or a
        // parent that no longer matches) skip this — the entity simply
        // returns to the source bin as its own lot, today's behavior.
        const attrs = (trackedEntity.attributes ?? {}) as Record<
          string,
          unknown
        >;
        const parentId = attrs["Split From Entity ID"];
        if (typeof parentId === "string" && parentId) {
          const parent = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", parentId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirst();

          if (parent && parent.readableId === trackedEntity.readableId) {
            // Round before comparing: a residue child (holding
            // 0.020000000000000018 after an earlier split) giving back its
            // 0.02 lands on −1.7e-17, and a raw `< 0` refuses a legitimate
            // full unpick. settleQuantity rounds, refuses a REAL negative,
            // and Consumes the emptied child in one decision.
            const childSettled = settleQuantity({
              quantity: Number(trackedEntity.quantity) - unpickQuantity,
              status: trackedEntity.status,
              refusal: `Cannot unpick batch: entity ${trackedEntityId} holds ${trackedEntity.quantity} but ${unpickQuantity} was picked — partial consumption must be unconsumed first`
            });

            const splitActivity = await trx
              .selectFrom("trackedActivity")
              .where("type", "=", "Split")
              .where(attributesContain({ "Split Entity ID": trackedEntityId }))
              .where("companyId", "=", companyId)
              .selectAll()
              .executeTakeFirst();

            await trx
              .updateTable("trackedEntity")
              .set({
                quantity: round(
                  round(Number(parent.quantity)) + round(unpickQuantity)
                )
              })
              .where("id", "=", parent.id)
              .where("companyId", "=", companyId)
              .execute();

            await trx
              .updateTable("trackedEntity")
              .set(childSettled)
              .where("id", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();

            // Net out the original split pair at the source bin. Keep the
            // child's entity row — itemLedger.trackedEntityId history stays
            // intact (the FK is ON DELETE SET NULL; deleting would null it).
            inserts.push(
              {
                postingDate: today,
                itemId: line.itemId,
                quantity: round(-unpickQuantity),
                locationId,
                storageUnitId: line.storageUnitId,
                entryType: "Negative Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivity?.id ?? pickingListId,
                trackedEntityId,
                createdBy: userId,
                companyId
              },
              {
                postingDate: today,
                itemId: line.itemId,
                quantity: round(unpickQuantity),
                locationId,
                storageUnitId: line.storageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivity?.id ?? pickingListId,
                trackedEntityId: parent.id,
                createdBy: userId,
                companyId
              }
            );

            // Clean undo: the Split never happened.
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
          }
        }

        await trx.insertInto("itemLedger").values(inserts).execute();

        await trx
          .deleteFrom("trackedActivityInput")
          .where("trackedActivityId", "=", activity.id!)
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .deleteFrom("trackedActivity")
          .where("id", "=", activity.id!)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .updateTable("pickingListLine")
          .set({
            quantityPicked: Math.max(
              0,
              round(
                round(Number(line.quantityPicked ?? 0)) - round(unpickQuantity)
              )
            ),
            status: "Pending",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Drop the recorded lot so it's pickable again + display clears.
        await trx
          .deleteFrom("pickingListLineTrackedEntity")
          .where("pickingListLineId", "=", pickingListLineId)
          .where("trackedEntityId", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();

        await restoreJobMaterialSource(trx, line, userId, companyId);
      });
      break;
    }

    case "returnPickedRemainder": {
      const {
        pickingListLineId,
        trackedEntityId,
        locationId,
        userId,
        companyId
      } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        // Lock the line: every case here read-modify-writes its picked or
        // returned counter, so two concurrent scans of the same line would
        // both add to the same stale total and the ledger would double. Same
        // lock post-stock-transfer takes.
        const line = await trx
          .selectFrom("pickingListLine")
          .where("id", "=", pickingListLineId)
          .where("companyId", "=", companyId)
          .selectAll()
          .forUpdate()
          .executeTakeFirstOrThrow();

        const totalReturned = await returnTrackedAllocationRemainder(trx, {
          today,
          line,
          trackedEntityId,
          locationId,
          userId,
          companyId
        });

        // Legacy single-allocation call: restore the consumption pointer
        // only when something actually returned (matching the original
        // early-return behavior). The sweep cases decide per material.
        if (totalReturned > 0) {
          await restoreJobMaterialSource(trx, line, userId, companyId);
        }
      });
      break;
    }

    case "returnOperationRemainders": {
      const { jobOperationId, userId, companyId } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        const op = await trx
          .selectFrom("jobOperation")
          .where("id", "=", jobOperationId)
          .where("companyId", "=", companyId)
          .select(["id", "jobId", "quantityComplete"])
          .executeTakeFirst();
        if (!op) throw new NotFoundError("Job operation not found");
        if (!op.jobId) return;

        const job = await trx
          .selectFrom("job")
          .where("id", "=", op.jobId)
          .where("companyId", "=", companyId)
          .select(["id", "quantity", "locationId", "status"])
          .executeTakeFirst();
        if (!job) throw new NotFoundError("Job not found");
        if (!job.locationId) return;
        const sweepJob = {
          id: job.id,
          quantity: job.quantity,
          locationId: job.locationId
        };

        // The last operation completed the job (sync_finish_job_operation),
        // so its whole remainder is provably surplus under either policy.
        if (job.status === "Completed") {
          await runReturnSweep(trx, {
            scope: "job",
            job: sweepJob,
            today,
            userId,
            companyId
          });
          return;
        }

        const settings = await trx
          .selectFrom("companySettings")
          .where("id", "=", companyId)
          .select("returnPickedMaterialTiming")
          .executeTakeFirst();
        if (settings?.returnPickedMaterialTiming !== "operation") return;

        await runReturnSweep(trx, {
          scope: "operation",
          job: sweepJob,
          opId: op.id,
          opQuantityComplete: Number(op.quantityComplete ?? 0),
          today,
          userId,
          companyId
        });
      });
      break;
    }

    case "returnJobRemainders": {
      const { jobId, userId, companyId } = validatedPayload;

      await db.transaction().execute(async (trx) => {
        const job = await trx
          .selectFrom("job")
          .where("id", "=", jobId)
          .where("companyId", "=", companyId)
          .select(["id", "quantity", "locationId", "status"])
          .executeTakeFirst();
        if (!job) throw new NotFoundError("Job not found");
        // Job scope is the final catch-all: only a finished job's remainder
        // is provably surplus (completion-time backflush has already run,
        // or the job is being cancelled and will never consume it).
        const sweepable =
          job.status === "Completed" || job.status === "Cancelled";
        if (!sweepable || !job.locationId) return;

        await runReturnSweep(trx, {
          scope: "job",
          job: {
            id: job.id,
            quantity: job.quantity,
            locationId: job.locationId
          },
          today,
          userId,
          companyId
        });
      });
      break;
    }
  }

  return { success: true, splitEntityId };
}

// A balanced Transfer ledger pair moving `quantity` of a tracked entity from one
// storage unit to another (a pick, unpick, or return is all the same shape).
function transferPair(args: {
  today: string;
  itemId: string;
  quantity: number;
  locationId: string;
  fromStorageUnitId: string;
  toStorageUnitId: string;
  documentId: string;
  trackedEntityId: string;
  userId: string;
  companyId: string;
}): ItemLedgerInsert[] {
  const base = {
    postingDate: args.today,
    itemId: args.itemId,
    locationId: args.locationId,
    entryType: "Transfer" as const,
    documentType: "Direct Transfer" as const,
    documentId: args.documentId,
    trackedEntityId: args.trackedEntityId,
    createdBy: args.userId,
    companyId: args.companyId
  };
  return [
    {
      ...base,
      quantity: round(-args.quantity),
      storageUnitId: args.fromStorageUnitId
    },
    {
      ...base,
      quantity: round(args.quantity),
      storageUnitId: args.toStorageUnitId
    }
  ];
}

// Point the job material at the lineside shelf so production (backflush/issue)
// consumes from where the pick just moved the stock.
async function pointJobMaterialAtLineside(
  trx: any,
  line: { jobMaterialId: string; toStorageUnitId: string | null },
  userId: string,
  companyId: string
) {
  if (!line.toStorageUnitId) return;
  await trx
    .updateTable("jobMaterial")
    .set({
      storageUnitId: line.toStorageUnitId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", line.jobMaterialId)
    .where("companyId", "=", companyId)
    .execute();
}

// Restore the warehouse source on unpick.
async function restoreJobMaterialSource(
  trx: any,
  line: { jobMaterialId: string; storageUnitId: string | null },
  userId: string,
  companyId: string
) {
  await trx
    .updateTable("jobMaterial")
    .set({
      storageUnitId: line.storageUnitId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", line.jobMaterialId)
    .where("companyId", "=", companyId)
    .execute();
}

type ReturnSweepLine = {
  id: string;
  pickingListId: string;
  jobMaterialId: string;
  jobOperationId: string | null;
  itemId: string;
  quantityPicked: number | string | null;
  quantityReturned: number | string | null;
  storageUnitId: string | null;
  toStorageUnitId: string | null;
  createdAt: string | Date | null;
};

// Return the un-consumed remainder of ONE tracked (batch/serial) allocation from
// the lineside shelf back to the warehouse source. Walks the picked entity's
// split lineage and moves whatever is still physically on hand at the lineside
// bin (a partial consume splits the remainder into a NEW entity the picking line
// never references). Idempotent: nothing on hand → nothing moves.
//
// Books the return on pickingListLine.quantityReturned instead of decrementing
// quantityPicked — the update_picking_list_status trigger reacts to
// quantityPicked/status changes and would demote a Completed/Partial header back
// to In Progress. quantityPicked stays gross-picked; net staged at lineside is
// quantityPicked - quantityReturned. The allocation row keeps its historical
// decrement/delete-at-0 so the lot becomes re-allocatable (the availability RPCs
// net allocations out of on-hand). Does NOT repoint jobMaterial.storageUnitId —
// callers decide that per material.
async function returnTrackedAllocationRemainder(
  trx: any,
  args: {
    today: string;
    line: {
      id: string;
      pickingListId: string;
      itemId: string;
      storageUnitId: string | null;
      toStorageUnitId: string | null;
    };
    trackedEntityId: string;
    locationId: string;
    userId: string;
    companyId: string;
  }
): Promise<number> {
  const { today, line, trackedEntityId, locationId, userId, companyId } = args;
  const lineside = line.toStorageUnitId;

  // Return target = the bin this lot was actually PICKED from, recorded
  // on its Pick trackedActivity at pick time — not the line's stale
  // generation-time source bin, which can be wrong per-lot and is null
  // for a shortage line that later got picked anyway.
  const pickActivities = await trx
    .selectFrom("trackedActivity as ta")
    .innerJoin("trackedActivityInput as tai", "tai.trackedActivityId", "ta.id")
    .where("ta.type", "=", "Pick")
    .where("ta.sourceDocument", "=", "Picking List")
    .where("ta.sourceDocumentId", "=", line.pickingListId)
    .where("tai.trackedEntityId", "=", trackedEntityId)
    .where("ta.companyId", "=", companyId)
    .where("tai.companyId", "=", companyId)
    .orderBy("ta.createdAt", "desc")
    .select("ta.attributes")
    .execute();

  // Use the LATEST pick for this line (activities are newest-first). Its
  // "From Shelf" is the current truth — even if null (picked from an
  // unassigned bin), fall through to the line bin rather than reusing an
  // older pick's stale shelf.
  const latestPickForLine = pickActivities
    .map(
      (a: { attributes: unknown }) =>
        a.attributes as Record<string, unknown> | null
    )
    // Disambiguate if the same entity was picked on multiple lines.
    .find(
      (a: Record<string, unknown> | null) =>
        a?.["Picking List Line"] === line.id
    );
  const pickedFromShelf = latestPickForLine?.["From Shelf"] as
    | string
    | null
    | undefined;

  const source = pickedFromShelf ?? line.storageUnitId;
  // No lineside stage or no source to return to → nothing to do.
  if (!lineside || !source) return 0;

  // Walk the picked entity's split lineage (picked entity + every split
  // descendant). A partial consume splits the un-consumed remainder into
  // a new entity, so the leftover stock at lineside sits under a
  // descendant, not the originally-picked entity.
  const lineage = new Set<string>([trackedEntityId]);
  let frontier: string[] = [trackedEntityId];
  while (frontier.length > 0) {
    const rows = await trx
      .selectFrom("trackedActivityInput as tai")
      .innerJoin(
        "trackedActivityOutput as tao",
        "tao.trackedActivityId",
        "tai.trackedActivityId"
      )
      .where("tai.trackedEntityId", "in", frontier)
      .where("tai.companyId", "=", companyId)
      .whereRef("tao.trackedEntityId", "<>", "tai.trackedEntityId")
      .select("tao.trackedEntityId as id")
      .distinct()
      .execute();
    const next: string[] = [];
    for (const r of rows) {
      if (r.id && !lineage.has(r.id)) {
        lineage.add(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }

  // Transfer each lineage entity's remaining lineside on-hand back to the
  // warehouse source bin. A split child whose parent still sits Available at
  // the source bin MERGES back into the parent (no standalone fragment);
  // anything ineligible falls back to today's standalone return — never
  // block a return on merge eligibility.
  const inserts: ItemLedgerInsert[] = [];
  let totalReturned = 0;
  for (const entityId of lineage) {
    const onHandRow = await trx
      .selectFrom("itemLedger")
      .where("trackedEntityId", "=", entityId)
      .where("storageUnitId", "=", lineside)
      .where("itemId", "=", line.itemId)
      .where("companyId", "=", companyId)
      .select((eb: any) => eb.fn.sum("quantity").as("qty"))
      .executeTakeFirst();
    const onHand = Number(onHandRow?.qty ?? 0);
    if (onHand <= 0) continue;

    const entity = await trx
      .selectFrom("trackedEntity")
      .where("id", "=", entityId)
      .where("companyId", "=", companyId)
      .selectAll()
      .executeTakeFirst();
    const parentId = ((entity?.attributes ?? {}) as Record<string, unknown>)[
      "Split From Entity ID"
    ];

    let merged = false;
    if (entity && typeof parentId === "string" && parentId) {
      const parent = await trx
        .selectFrom("trackedEntity")
        .where("id", "=", parentId)
        .where("companyId", "=", companyId)
        .selectAll()
        .executeTakeFirst();

      if (
        parent &&
        parent.status === "Available" &&
        parent.readableId === entity.readableId &&
        // Rounded: buildMergeRecords refuses merge > childQty at scale, so a
        // raw compare here could skip a merge the builder would have accepted
        // (0.30000000000000004 of a 0.3 lot) and silently fall back.
        round(onHand) <= round(Number(entity.quantity))
      ) {
        const parentLedgers = await trx
          .selectFrom("itemLedger")
          .where("trackedEntityId", "=", parent.id)
          .where("companyId", "=", companyId)
          .select(["trackedEntityId", "storageUnitId", "quantity"])
          .execute();

        if (resolveTrackedEntityBin(parentLedgers, parent.id) === source) {
          const merge = buildMergeRecords({
            child: { id: entity.id, quantity: Number(entity.quantity) },
            parent: { id: parent.id, quantity: Number(parent.quantity) },
            mergeQuantity: onHand,
            mergeActivityId: nanoid(),
            companyId,
            userId
          });

          // Physical move: −r on the child at lineside, +r on the parent at
          // the source bin — same Transfer shape the sweep books today.
          inserts.push(
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: round(-onHand),
              locationId,
              storageUnitId: lineside,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: line.pickingListId,
              trackedEntityId: entity.id,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: round(onHand),
              locationId,
              storageUnitId: source,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: line.pickingListId,
              trackedEntityId: parent.id,
              createdBy: userId,
              companyId
            }
          );

          await trx
            .insertInto("trackedActivity")
            .values(merge.activityInsert)
            .execute();
          await trx
            .insertInto("trackedActivityInput")
            .values(merge.activityInputInsert)
            .execute();
          await trx
            .insertInto("trackedActivityOutput")
            .values(merge.activityOutputInsert)
            .execute();
          await trx
            .updateTable("trackedEntity")
            .set(merge.parentUpdate)
            .where("id", "=", parent.id)
            .where("companyId", "=", companyId)
            .execute();
          await trx
            .updateTable("trackedEntity")
            .set(merge.childUpdate)
            .where("id", "=", entity.id)
            .where("companyId", "=", companyId)
            .execute();

          merged = true;
        }
      }
    }

    if (!merged) {
      inserts.push(
        ...transferPair({
          today,
          itemId: line.itemId,
          quantity: onHand,
          locationId,
          fromStorageUnitId: lineside,
          toStorageUnitId: source,
          documentId: line.pickingListId,
          trackedEntityId: entityId,
          userId,
          companyId
        })
      );
    }
    totalReturned += onHand;
  }

  if (totalReturned <= 0) return 0;

  await trx.insertInto("itemLedger").values(inserts).execute();

  // Decrement the recorded allocation by what was returned so the lot is
  // re-allocatable.
  const allocation = await trx
    .selectFrom("pickingListLineTrackedEntity")
    .where("pickingListLineId", "=", line.id)
    .where("trackedEntityId", "=", trackedEntityId)
    .selectAll()
    .executeTakeFirst();
  if (allocation) {
    const nextQuantity = Math.max(
      0,
      Number(allocation.quantity ?? 0) - totalReturned
    );
    const nextPicked = Math.max(
      0,
      Number(allocation.quantityPicked ?? 0) - totalReturned
    );
    if (nextPicked <= 0) {
      await trx
        .deleteFrom("pickingListLineTrackedEntity")
        .where("pickingListLineId", "=", line.id)
        .where("trackedEntityId", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      await trx
        .updateTable("pickingListLineTrackedEntity")
        .set({ quantity: nextQuantity, quantityPicked: nextPicked })
        .where("pickingListLineId", "=", line.id)
        .where("trackedEntityId", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
    }
  }

  await trx
    .updateTable("pickingListLine")
    .set((eb: any) => ({
      quantityReturned: eb("quantityReturned", "+", totalReturned),
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    }))
    .where("id", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();

  return totalReturned;
}

// Return the un-consumed remainder of an UNTRACKED job material. There is no
// per-line consumption attribution (jobMaterial.quantityIssued is one counter
// across N lines), so the remainder is computed per material —
//   returnable = max(0, Σ(line.picked − line.returned) − max(issued, owed))
// — and allocated back across the material's lines newest-first. `owed` is what
// completion-time backflush is still entitled to draw from lineside; holding it
// back is what keeps the top-up suppliable (never derived from bin on-hand: the
// lineside bin is shared per work center across jobs).
async function returnUntrackedMaterialRemainder(
  trx: any,
  args: {
    today: string;
    material: {
      id: string;
      itemId: string;
      jobId: string;
      quantityIssued: number | string | null;
    };
    lines: ReturnSweepLine[];
    owed: number;
    locationId: string;
    userId: string;
    companyId: string;
  }
): Promise<number> {
  const { today, material, lines, owed, locationId, userId, companyId } = args;

  const staged = lines
    .map((l) => ({
      ...l,
      stagedNet: Math.max(
        0,
        Number(l.quantityPicked ?? 0) - Number(l.quantityReturned ?? 0)
      )
    }))
    .filter((l) => l.stagedNet > 0 && l.toStorageUnitId);
  if (staged.length === 0) return 0;

  const budgets = orderOldFirst(
    await getPickedBudgets(trx, { material, locationId, companyId }),
    material.itemId
  );
  const returnableByItem = new Map<string, number>();
  let owedRemaining = Math.max(0, owed);
  for (const budget of budgets) {
    const hold =
      budget.factor > 0
        ? Math.min(budget.available, owedRemaining * budget.factor)
        : 0;
    owedRemaining -= budget.factor > 0 ? hold / budget.factor : 0;
    returnableByItem.set(budget.itemId, Math.max(0, budget.available - hold));
  }
  let returnable = [...returnableByItem.values()].reduce((a, b) => a + b, 0);
  if (returnable <= 0) return 0;

  // Newest-first: return the most recently staged stock, deterministic.
  staged.sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() -
      new Date(a.createdAt ?? 0).getTime()
  );

  // Lazy fallback bin for lines picked from an unassigned source.
  let fallbackBin: string | null | undefined;
  const resolveFallbackBin = async () => {
    if (fallbackBin !== undefined) return fallbackBin;
    const pickMethod = await trx
      .selectFrom("pickMethod")
      .where("itemId", "=", material.itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .select("defaultStorageUnitId")
      .executeTakeFirst();
    fallbackBin = pickMethod?.defaultStorageUnitId ?? null;
    return fallbackBin;
  };

  const inserts: ItemLedgerInsert[] = [];
  let totalReturned = 0;
  for (const line of staged) {
    if (returnable <= 0) break;
    const itemReturnable = returnableByItem.get(line.itemId) ?? 0;
    const quantity = Math.min(line.stagedNet, itemReturnable);
    if (quantity <= 0) continue;
    returnableByItem.set(line.itemId, itemReturnable - quantity);
    // Return target: the line's source bin, else the item's default pick bin,
    // else location-level unassigned stock (mirrors picks from unassigned bins;
    // never strands the return).
    const target = line.storageUnitId ?? (await resolveFallbackBin());

    const base = {
      postingDate: today,
      itemId: line.itemId,
      locationId,
      entryType: "Transfer" as const,
      documentType: "Direct Transfer" as const,
      documentId: line.pickingListId,
      createdBy: userId,
      companyId
    };
    inserts.push(
      {
        ...base,
        quantity: round(-quantity),
        storageUnitId: line.toStorageUnitId
      },
      { ...base, quantity: round(quantity), storageUnitId: target }
    );

    await trx
      .updateTable("pickingListLine")
      .set((eb: any) => ({
        quantityReturned: eb("quantityReturned", "+", quantity),
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      }))
      .where("id", "=", line.id)
      .where("companyId", "=", companyId)
      .execute();

    returnable -= quantity;
    totalReturned += quantity;
  }

  if (totalReturned <= 0) return 0;
  await trx.insertInto("itemLedger").values(inserts).execute();
  return totalReturned;
}

// Sweep every live picking-list line of one operation (scope "operation") or of
// one whole job (scope "job"), returning each material's un-consumed remainder
// and repointing jobMaterial.storageUnitId back at the warehouse source when
// nothing staged remains to consume.
async function runReturnSweep(
  trx: any,
  args: {
    scope: "operation" | "job";
    job: { id: string; quantity: number | string | null; locationId: string };
    opId?: string;
    opQuantityComplete?: number;
    today: string;
    userId: string;
    companyId: string;
  }
) {
  const { scope, job, opId, opQuantityComplete, today, userId, companyId } =
    args;

  let lineQuery = trx
    .selectFrom("pickingListLine as pll")
    .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
    .where("pll.companyId", "=", companyId)
    .where("pll.jobId", "=", job.id)
    .where("pll.status", "<>", "Cancelled")
    .where("pl.status", "not in", ["Draft", "Cancelled"])
    .select([
      "pll.id",
      "pll.pickingListId",
      "pll.jobMaterialId",
      "pll.jobOperationId",
      "pll.itemId",
      "pll.quantityPicked",
      "pll.quantityReturned",
      "pll.storageUnitId",
      "pll.toStorageUnitId",
      "pll.createdAt"
    ]);
  if (scope === "operation") {
    lineQuery = lineQuery.where("pll.jobOperationId", "=", opId);
  }
  const lines: ReturnSweepLine[] = await lineQuery.execute();
  if (lines.length === 0) return;

  const materialIds = [...new Set(lines.map((l) => l.jobMaterialId))];
  const materials = await trx
    .selectFrom("jobMaterial")
    .where("id", "in", materialIds)
    .where("companyId", "=", companyId)
    .select([
      "id",
      "itemId",
      "jobId",
      "jobOperationId",
      "quantityIssued",
      "estimatedQuantity",
      "requiresBatchTracking",
      "requiresSerialTracking"
    ])
    .execute();

  const jobQuantity = Number(job.quantity ?? 0);

  for (const material of materials) {
    const materialLines = lines.filter((l) => l.jobMaterialId === material.id);
    const tracked =
      Boolean(material.requiresBatchTracking) ||
      Boolean(material.requiresSerialTracking);

    // What completion-time backflush is still entitled to consume from lineside.
    // Op scope, material owned by the completing op: its completed quantity is
    // final, so owed = (estimatedQuantity ÷ job quantity) × op completed — the
    // estimated ratio keeps the scrap allowance staged. A material owned by a
    // DIFFERENT (possibly not-yet-run) op has no final quantity yet: hold its
    // full estimate. Job scope: backflush already ran inside
    // complete_job_to_inventory, nothing further is owed.
    let owed = 0;
    if (scope === "operation") {
      const estimated = Number(material.estimatedQuantity ?? 0);
      if (material.jobOperationId === opId && jobQuantity > 0) {
        owed = (estimated / jobQuantity) * Number(opQuantityComplete ?? 0);
      } else {
        owed = estimated;
      }
    }

    if (tracked) {
      for (const line of materialLines) {
        const allocations = await trx
          .selectFrom("pickingListLineTrackedEntity")
          .where("pickingListLineId", "=", line.id)
          .select("trackedEntityId")
          .execute();
        for (const allocation of allocations) {
          await returnTrackedAllocationRemainder(trx, {
            today,
            line,
            trackedEntityId: allocation.trackedEntityId,
            locationId: job.locationId,
            userId,
            companyId
          });
        }
      }
    } else {
      await returnUntrackedMaterialRemainder(trx, {
        today,
        material,
        lines: materialLines,
        owed,
        locationId: job.locationId,
        userId,
        companyId
      });
    }

    await maybeRestoreJobMaterialSource(trx, {
      scope,
      material: {
        id: material.id,
        itemId: material.itemId,
        jobId: material.jobId,
        quantityIssued: material.quantityIssued
      },
      locationId: job.locationId,
      userId,
      companyId
    });
  }
}

// Repoint jobMaterial.storageUnitId back at the warehouse source once nothing
// staged remains for it to consume at lineside. Job scope: the job is done —
// always restore. Op scope: restore only when net staged (Σ picked − returned
// across ALL live lines of the material) is covered by what was already issued —
// otherwise the held-back (owed) stock must stay consumable at lineside by the
// completion-time backflush. Skips the restore when no line has a source bin,
// rather than nulling the pointer.
async function maybeRestoreJobMaterialSource(
  trx: any,
  args: {
    scope: "operation" | "job";
    material: {
      id: string;
      itemId: string;
      jobId: string;
      quantityIssued: number | string | null;
    };
    locationId: string;
    userId: string;
    companyId: string;
  }
) {
  const { scope, material, locationId, userId, companyId } = args;

  const liveLines = await trx
    .selectFrom("pickingListLine as pll")
    .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
    .where("pll.jobMaterialId", "=", material.id)
    .where("pll.companyId", "=", companyId)
    .where("pll.status", "<>", "Cancelled")
    .where("pl.status", "not in", ["Draft", "Cancelled"])
    .select([
      "pll.storageUnitId",
      "pll.quantityPicked",
      "pll.quantityReturned",
      "pll.createdAt"
    ])
    .execute();

  if (scope === "operation") {
    const budgets = await getPickedBudgets(trx, {
      material,
      locationId,
      companyId
    });
    if (budgets.some((b) => b.available > 0)) return;
  }

  const sourceLine = liveLines
    .filter((l: ReturnSweepLine) => l.storageUnitId)
    .sort(
      (a: ReturnSweepLine, b: ReturnSweepLine) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime()
    )[0];
  if (!sourceLine) return;

  await restoreJobMaterialSource(
    trx,
    { jobMaterialId: material.id, storageUnitId: sourceLine.storageUnitId },
    userId,
    companyId
  );
}

// Pure resolver for a spare part returned from a maintenance dispatch: how much
// of the return carries value, and at what unit cost.
//
// A return reverses what the dispatch actually expensed, so it reads the
// dispatch's own 'Maintenance Consumption' cost-ledger rows for the item
// (signed: issues negative, earlier returns positive) and books at their
// blended issue cost — a round trip nets zero P&L. Only the quantity still
// expensed (issued minus already returned) is valued: an issue posted before
// maintenance consumption carried value has no cost row, so returning it must
// not credit an expense that was never debited. Returns null when nothing is
// left to reverse — the caller writes the ledger row alone.

export function resolveMaintenanceReturnCost(
  rows: Array<{ quantity: number; cost: number }>,
  returnQuantity: number
): { quantity: number; unitCost: number } | null {
  let issuedQuantity = 0;
  let issuedCost = 0;
  let returnedQuantity = 0;
  for (const row of rows) {
    const quantity = Number(row.quantity) || 0;
    if (quantity < 0) {
      issuedQuantity += -quantity;
      issuedCost += Math.abs(Number(row.cost) || 0);
    } else {
      returnedQuantity += quantity;
    }
  }

  const outstanding = issuedQuantity - returnedQuantity;
  const quantity = Math.min(Math.abs(returnQuantity), outstanding);
  if (issuedQuantity < EPSILON || quantity < EPSILON) return null;

  return { quantity, unitCost: issuedCost / issuedQuantity };
}
// Reopen + capacity top-up after scrapping units of a make method, so the
// replacement units can run the FULL routing (spec
// .ai/specs/2026-08-06-scrap-unscrap-flow.md §1.6).
//
// - Done operations reopen to Ready (never Canceled); the quantity-sync
//   interceptor re-flips them once good quantity reaches targetQuantity —
//   which scrap no longer counts toward (20260807090629).
// - targetQuantity is NEVER written: it is the good quantity to produce.
// - operationQuantity (capacity incl. planned scrap allowance) is topped up
//   only when cumulative actual scrap exceeds the allowance:
//   needed = targetQuantity + totalScrapped; bump = max(0, needed − current).
// - job.scrapQuantity mirrors the same monotonic rule for the ROOT make
//   method so the generated job.productionQuantity stays coherent.
// - jobMaterial estimates grow by their per-parent quantity × the bump so
//   backflush caps (estimatedQuantity − quantityIssued) cover the
//   replacement units. Make-to-Order children are excluded (their capacity
//   is their own make method's).
export async function applyScrapReplacement(
  trx: Transaction<KyselyDatabase>,
  args: {
    jobMakeMethodId: string;
    jobId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ addedQuantity: number }> {
  const { jobMakeMethodId, jobId, companyId, userId } = args;

  const operations = await trx
    .selectFrom("jobOperation")
    .select(["id", "status", "operationQuantity", "targetQuantity"])
    .where("jobMakeMethodId", "=", jobMakeMethodId)
    .where("companyId", "=", companyId)
    .execute();
  if (operations.length === 0) return { addedQuantity: 0 };

  // Cumulative actual scrap for this make method, read from productionQuantity
  // directly so the math is independent of interceptor timing.
  const scrapTotal = await trx
    .selectFrom("productionQuantity")
    .select((eb) => eb.fn.sum("quantity").as("quantity"))
    .where("type", "=", "Scrap")
    .where("companyId", "=", companyId)
    .where(
      "jobOperationId",
      "in",
      operations.map((op) => op.id)
    )
    .executeTakeFirst();
  const totalScrapped = Number(scrapTotal?.quantity ?? 0);

  await trx
    .updateTable("jobOperation")
    .set({
      status: "Ready",
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("jobMakeMethodId", "=", jobMakeMethodId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Done")
    .execute();

  let addedQuantity = 0;
  for (const operation of operations) {
    const target = Number(operation.targetQuantity ?? 0);
    if (target <= 0) continue;
    const current = Number(operation.operationQuantity ?? 0);
    const needed = target + totalScrapped;
    const bump = Math.max(0, needed - current);
    if (bump <= 0) continue;
    addedQuantity = Math.max(addedQuantity, bump);
    await trx
      .updateTable("jobOperation")
      .set({
        operationQuantity: needed,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", operation.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  if (addedQuantity > 0) {
    // Root make method drives the job header's planned-scrap bucket.
    const makeMethod = await trx
      .selectFrom("jobMakeMethod")
      .select(["parentMaterialId"])
      .where("id", "=", jobMakeMethodId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (makeMethod && makeMethod.parentMaterialId === null) {
      const job = await trx
        .selectFrom("job")
        .select(["scrapQuantity"])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const currentScrapQuantity = Number(job?.scrapQuantity ?? 0);
      if (totalScrapped > currentScrapQuantity) {
        await trx
          .updateTable("job")
          .set({
            scrapQuantity: totalScrapped,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", jobId)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    // Grow material requirements for the replacement units (mirrors
    // recalculateJobRequirements' per-parent math).
    const materials = await trx
      .selectFrom("jobMaterial")
      .select(["id", "quantity", "estimatedQuantity"])
      .where("jobMakeMethodId", "=", jobMakeMethodId)
      .where("companyId", "=", companyId)
      .where("methodType", "!=", "Make to Order")
      .execute();
    for (const material of materials) {
      const perParent = Number(material.quantity) || 0;
      if (perParent <= 0) continue;
      await trx
        .updateTable("jobMaterial")
        .set({
          estimatedQuantity:
            Number(material.estimatedQuantity ?? 0) + perParent * addedQuantity
        })
        .where("id", "=", material.id)
        .where("companyId", "=", companyId)
        .execute();
    }
  }

  return { addedQuantity };
}
/**
 * Applies the company's expired-entity policy to entities about to be
 * consumed: `ok` with a warning under `Warn`, `ok: false` with the reason when
 * blocked. An override with a reason passes under `BlockWithOverride`; the
 * caller records it.
 */
function checkExpiredEntities(
  entities: { id: string; expirationDate: string | null }[],
  policy: ExpiredEntityPolicy,
  override: ExpiryOverride,
  today: CalendarDate
): { ok: true; warning?: string } | { ok: false; reason: string } {
  const expired = expiredEntities(entities, today);
  if (expired.length === 0) return { ok: true };

  const ids = expired.map((e) => e.id).join(", ");
  const noun = `entit${expired.length === 1 ? "y" : "ies"}`;
  switch (expiryVerdict(policy, override)) {
    case "warn":
      return {
        ok: true,
        warning: `Consumed ${expired.length} expired tracked ${noun}: ${ids}`
      };
    case "allow":
      return { ok: true };
    case "block":
      return {
        ok: false,
        reason: `Cannot consume expired tracked ${noun}: ${ids}`
      };
  }
}

async function issueJobOperationMaterials(
  trx: Transaction<KyselyDatabase>,
  {
    jobOperationId,
    quantity,
    companyId,
    userId,
    postingStatus,
    accountDefaults,
    dimensionMap,
    db
  }: {
    jobOperationId: string;
    quantity: number;
    companyId: string;
    userId: string;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
    accountDefaults: ConsumeAccountDefaults;
    dimensionMap: Map<string, string>;
    db: Kysely<KyselyDatabase>;
  }
) {
  const materialsToIssue = await trx
    .selectFrom("jobMaterial")
    .where("jobOperationId", "=", jobOperationId)
    .where("companyId", "=", companyId)
    .where("itemType", "in", ["Material", "Part", "Consumable"])
    .where("methodType", "!=", "Make to Order")
    .where("estimatedQuantity", ">", 0)
    .where("requiresBatchTracking", "=", false)
    .where("requiresSerialTracking", "=", false)
    .selectAll()
    .execute();

  const kittedChildren = await trx
    .selectFrom("jobMaterialWithMakeMethodId")
    .where("jobOperationId", "=", jobOperationId)
    .where("companyId", "=", companyId)
    .where("itemType", "in", ["Material", "Part", "Consumable"])
    .where("methodType", "=", "Make to Order")
    .where("kit", "=", true)
    .selectAll()
    .execute();

  const jobMakeMethodIdsOfKittedChildren = kittedChildren.map(
    (kittedChild) => kittedChild.jobMaterialMakeMethodId
  );

  if (jobMakeMethodIdsOfKittedChildren.length > 0) {
    const materialsToIssueFromKittedChildren = await trx
      .selectFrom("jobMaterial")
      .where("jobMakeMethodId", "in", jobMakeMethodIdsOfKittedChildren)
      .where("itemType", "in", ["Material", "Part", "Consumable"])
      .where("methodType", "!=", "Make to Order")
      .where("estimatedQuantity", ">", 0)
      .where("requiresBatchTracking", "=", false)
      .where("requiresSerialTracking", "=", false)
      .selectAll()
      .execute();

    materialsToIssue.push(...materialsToIssueFromKittedChildren);
  }

  if (materialsToIssue.length === 0) return { totalMaterialCost: 0 };

  const jobId = materialsToIssue[0]!.jobId;

  const [job, items] = await Promise.all([
    trx
      .selectFrom("job")
      .where("id", "=", jobId)
      .select(["locationId", "jobId"])
      .executeTakeFirst(),
    trx
      .selectFrom("item")
      .where(
        "id",
        "in",
        materialsToIssue.map((material) => material.itemId)
      )
      .select(["id", "item.itemTrackingType"])
      .execute()
  ]);

  if (!job?.locationId) {
    throw new Error("Job location is required");
  }

  const itemIdIsTracked = new Map(
    items.map((item) => [item.id, item.itemTrackingType === "Inventory"])
  );

  // Company business day — item/cost ledgers and this function's journals must
  // all post on the same day (they previously relied on the CURRENT_DATE default,
  // which is UTC and diverged from the company-TZ journals here).
  const today = datetime
    .today(await getCompanyTimeZone(trx, companyId))
    .toString();

  const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
    [];

  const opStorageUnitId = await getOperationLinesideBin(trx, {
    jobOperationId,
    companyId
  });
  const takenShared: SharedTakes = new Map();
  for await (const material of materialsToIssue) {
    // Cap the backflush at the material's remaining unissued requirement,
    // mirroring backflush_job_materials. Without this, materials already
    // issued manually (e.g. from MES after skipping the operation) get
    // consumed a second time on operation completion — duplicate item/cost
    // ledger entries and duplicate DR WIP / CR Inventory journal lines.
    const demandQuantity = Number(material.quantity) * quantity;
    const remainingQuantity = Math.max(
      Number(material.estimatedQuantity ?? 0) -
        Number(material.quantityIssued ?? 0),
      0
    );
    const quantityToIssue = Math.min(demandQuantity, remainingQuantity);

    if (quantityToIssue <= 0) continue;

    const budgets = orderOldFirst(
      await getPickedBudgets(trx, {
        material,
        locationId: job.locationId,
        companyId,
        opStorageUnitId,
        takenShared
      }),
      material.itemId
    );
    const { takes, remaining } = allocateAcrossBudgets(
      quantityToIssue,
      budgets,
      Number(material.quantity ?? 0)
    );
    recordSharedTakes(takenShared, takes);
    for (const take of takes) {
      if (!take.budget.isInventory) continue;
      for (const row of splitTakeByBin(take)) {
        itemLedgerInserts.push({
          entryType: "Consumption",
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineId: jobOperationId,
          companyId,
          itemId: take.budget.itemId,
          quantity: -row.quantity,
          locationId: job.locationId,
          storageUnitId: row.storageUnitId,
          postingDate: today,
          createdBy: userId
        });
      }
    }

    if (remaining > 0) {
      let proposedStorageUnitId = material.storageUnitId;

      if (!proposedStorageUnitId) {
        if (material.defaultStorageUnit) {
          const pickMethod = await trx
            .selectFrom("pickMethod")
            .where("itemId", "=", material.itemId)
            .where("locationId", "=", job.locationId!)
            .where("companyId", "=", companyId)
            .select("defaultStorageUnitId")
            .executeTakeFirst();

          proposedStorageUnitId = pickMethod?.defaultStorageUnitId ?? null;

          if (!proposedStorageUnitId) {
            proposedStorageUnitId = await getStorageUnitWithHighestQuantity(
              trx,
              material.itemId,
              job.locationId!
            );
          }
        } else {
          proposedStorageUnitId = await getStorageUnitWithHighestQuantity(
            trx,
            material.itemId,
            job.locationId!
          );
        }
      }

      const currentStorageUnitQuantity = await trx
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum("quantity").as("quantity"))
        .where("itemId", "=", material.itemId)
        .where("locationId", "=", job.locationId!)
        .where("storageUnitId", "=", proposedStorageUnitId ?? "")
        .executeTakeFirst();

      const allStorageUnitQuantities = await trx
        .selectFrom("itemLedger")
        .select(["storageUnitId", (eb) => eb.fn.sum("quantity").as("quantity")])
        .where("itemId", "=", material.itemId)
        .where("locationId", "=", job.locationId!)
        .groupBy("storageUnitId")
        .having((eb) => eb.fn.sum("quantity"), ">", 0)
        .execute();

      let finalStorageUnitId = proposedStorageUnitId;
      const currentQuantity = Number(currentStorageUnitQuantity?.quantity ?? 0);

      if (currentQuantity < remaining && allStorageUnitQuantities.length > 0) {
        const bestStorageUnit = allStorageUnitQuantities.reduce(
          (best, current) =>
            Number(current.quantity) > Number(best.quantity) ? current : best
        );
        finalStorageUnitId = bestStorageUnit.storageUnitId ?? null;
      }

      const isTracked = itemIdIsTracked.get(material.itemId);

      if (isTracked) {
        itemLedgerInserts.push({
          entryType: "Consumption",
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineId: jobOperationId,
          companyId,
          itemId: material.itemId,
          quantity: -remaining,
          locationId: job.locationId,
          storageUnitId: finalStorageUnitId,
          postingDate: today,
          createdBy: userId
        });
      }
    }

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued: round(
          round(Number(material.quantityIssued) ?? 0) + round(quantityToIssue)
        )
      })
      .where("id", "=", material.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  // Total material cost this call relieved from inventory into WIP — the
  // jobOperationScrap case posts its WIP→scrap journal from this figure so a
  // second calculateCOGS pass never double-relieves cost layers.
  let totalMaterialCost = 0;

  if (itemLedgerInserts.length > 0) {
    await trx.insertInto("itemLedger").values(itemLedgerInserts).execute();

    for (const ledger of itemLedgerInserts) {
      await updatePickMethodDefaultStorageUnitIfNeeded(
        trx,
        ledger.itemId,
        ledger.locationId,
        ledger.storageUnitId,
        companyId,
        userId
      );
    }
  }

  if (itemLedgerInserts.length > 0) {
    const journalLineInserts: {
      accountId: string;
      description: string;
      amount: number;
      quantity: number;
      documentType: "Job Consumption";
      documentId: string;
      documentLineReference: string;
      journalLineReference: string;
      companyId: string;
    }[] = [];

    const journalLineDimensionsMeta: {
      itemPostingGroupId: string | null;
      itemId: string | null;
      locationId: string | null;
    }[] = [];

    const jobForLocation = await trx
      .selectFrom("job")
      .where("id", "=", jobId)
      .select(["locationId"])
      .executeTakeFirst();

    const consumedItemIds = [
      ...new Set(itemLedgerInserts.map((l) => l.itemId))
    ];
    const [consumedItemCosts, consumedItems] =
      consumedItemIds.length > 0
        ? await Promise.all([
            trx
              .selectFrom("itemCost")
              .where("itemId", "in", consumedItemIds)
              .where("companyId", "=", companyId)
              .select(["itemId", "itemPostingGroupId"])
              .execute(),
            trx
              .selectFrom("item")
              .where("id", "in", consumedItemIds)
              .where("companyId", "=", companyId)
              .select(["id", "replenishmentSystem"])
              .execute()
          ])
        : [[], []];
    const consumedPostingGroupMap = new Map(
      consumedItemCosts.map((ic) => [ic.itemId, ic.itemPostingGroupId])
    );
    const consumedReplenishmentMap = new Map(
      consumedItems.map((i) => [i.id, i.replenishmentSystem])
    );

    for (const ledger of itemLedgerInserts) {
      const materialQuantity = Math.abs(Number(ledger.quantity));
      if (materialQuantity === 0) continue;

      const cogsResult = await calculateCOGS(trx, {
        itemId: ledger.itemId,
        quantity: materialQuantity,
        companyId
      });
      totalMaterialCost += cogsResult.totalCost;

      const journalLineReference = nanoid();

      journalLineInserts.push({
        accountId: accountDefaults.workInProgressAccount,
        description: "WIP Account",
        amount: debit("asset", cogsResult.totalCost),
        quantity: materialQuantity,
        documentType: "Job Consumption",
        documentId: jobId,
        documentLineReference:
          journalReference.to.materialIssue(jobOperationId),
        journalLineReference,
        companyId
      });

      const inventoryAccount = resolveInventoryAccount(
        consumedReplenishmentMap.get(ledger.itemId) ?? null,
        accountDefaults
      );
      journalLineInserts.push({
        accountId: inventoryAccount.account,
        description: inventoryAccount.description,
        amount: credit("asset", cogsResult.totalCost),
        quantity: materialQuantity,
        documentType: "Job Consumption",
        documentId: jobId,
        documentLineReference:
          journalReference.to.materialIssue(jobOperationId),
        journalLineReference,
        companyId
      });

      await trx
        .insertInto("costLedger")
        .values({
          itemLedgerType: "Consumption",
          costLedgerType: "Direct Cost",
          adjustment: false,
          documentType: "Job Consumption",
          documentId: jobId,
          itemId: ledger.itemId,
          quantity: -materialQuantity,
          cost: -cogsResult.totalCost,
          remainingQuantity: 0,
          postingDate: today,
          companyId
        })
        .execute();

      for (let i = 0; i < 2; i++) {
        journalLineDimensionsMeta.push({
          itemPostingGroupId:
            consumedPostingGroupMap.get(ledger.itemId) ?? null,
          itemId: ledger.itemId ?? null,
          locationId: jobForLocation?.locationId ?? null
        });
      }
    }

    if (journalLineInserts.length > 0) {
      // Resolve the period from the SAME hoisted `today` the ledger rows used —
      // a midnight rollover mid-transaction must not split journal and ledger.
      // A Provisional journal has no accounting period.
      const accountingPeriodId =
        postingStatus === "Posted"
          ? await getCurrentAccountingPeriod(companyId, trx, today)
          : null;
      const journalEntryId = await sequence.getNextSequence(
        trx,
        "journalEntry",
        companyId
      );

      const journalResult = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          accountingPeriodId,
          description: `Material Issue to Job ${job?.jobId ?? jobId}`,
          postingDate: today,
          companyId,
          sourceType: "Job Consumption",
          status: postingStatus,
          postedAt: datetime.timestamp(),
          postedBy: userId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values(
          journalLineInserts.map((line) => ({
            ...line,
            journalId: journalResult.id
          }))
        )
        .returning(["id"])
        .execute();

      if (dimensionMap.size > 0) {
        const dimensionInserts: {
          journalLineId: string;
          dimensionId: string;
          valueId: string;
          companyId: string;
        }[] = [];

        journalLineResults.forEach((jl, index) => {
          const meta = journalLineDimensionsMeta[index];
          if (!meta) return;

          if (meta.itemPostingGroupId && dimensionMap.has("ItemPostingGroup")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("ItemPostingGroup")!,
              valueId: meta.itemPostingGroupId,
              companyId
            });
          }
          if (meta.itemId && dimensionMap.has("Item")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Item")!,
              valueId: meta.itemId,
              companyId
            });
          }
          if (meta.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: meta.locationId,
              companyId
            });
          }
        });

        if (dimensionInserts.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionInserts)
            .execute();
        }
      }
    }
  }

  return { totalMaterialCost };
}

async function createMaterialWipEntries(
  trx: Transaction<KyselyDatabase>,
  args: {
    // trackedEntityId: the serial consumed, relieved from its own cost layer
    // first (specific identification, lib/cost-layer-order.ts).
    consumptionLedgers: Array<{
      itemId: string;
      quantity: number;
      trackedEntityId?: string | null;
    }>;
    jobId: string;
    operationId: string;
    description: string;
    wipAccount: string;
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    dimensionMap: Map<string, string>;
    jobLocationId: string | null;
    db: Kysely<KyselyDatabase>;
    companyId: string;
    userId: string;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
  }
) {
  const {
    consumptionLedgers,
    jobId,
    operationId,
    description,
    wipAccount,
    rawMaterialsAccount,
    finishedGoodsAccount,
    dimensionMap,
    jobLocationId,
    companyId,
    userId,
    postingStatus
  } = args;

  // Cost layer posts on the company business day, matching the caller's
  // itemLedger movement (was defaulting to CURRENT_DATE = UTC).
  const today = datetime
    .today(await getCompanyTimeZone(trx, companyId))
    .toString();

  const journalLineInserts: {
    accountId: string;
    description: string;
    amount: number;
    quantity: number;
    documentType: "Job Consumption";
    documentId: string;
    documentLineReference: string;
    journalLineReference: string;
    companyId: string;
  }[] = [];

  const journalLineDimensionsMeta: {
    itemPostingGroupId: string | null;
    itemId: string | null;
    locationId: string | null;
  }[] = [];

  const uniqueItemIds = [...new Set(consumptionLedgers.map((l) => l.itemId))];
  const [consumedItemCosts, consumedItems] =
    uniqueItemIds.length > 0
      ? await Promise.all([
          trx
            .selectFrom("itemCost")
            .where("itemId", "in", uniqueItemIds)
            .where("companyId", "=", companyId)
            .select(["itemId", "itemPostingGroupId"])
            .execute(),
          trx
            .selectFrom("item")
            .where("id", "in", uniqueItemIds)
            .where("companyId", "=", companyId)
            .select(["id", "replenishmentSystem"])
            .execute()
        ])
      : [[], []];
  const consumedPostingGroupMap = new Map(
    consumedItemCosts.map((ic) => [ic.itemId, ic.itemPostingGroupId])
  );
  const consumedReplenishmentMap = new Map(
    consumedItems.map((i) => [i.id, i.replenishmentSystem])
  );

  for (const ledger of consumptionLedgers) {
    const ledgerQty = Number(ledger.quantity);
    if (ledgerQty === 0) continue;

    const absQty = Math.abs(ledgerQty);
    const isConsumption = ledgerQty < 0;

    let cost: number;
    if (isConsumption) {
      const cogsResult = await calculateCOGS(trx, {
        itemId: ledger.itemId,
        quantity: absQty,
        companyId,
        trackedEntityIds: ledger.trackedEntityId ? [ledger.trackedEntityId] : []
      });
      cost = cogsResult.totalCost;
    } else {
      const itemCost = await trx
        .selectFrom("itemCost")
        .where("itemId", "=", ledger.itemId)
        .where("companyId", "=", companyId)
        .select("unitCost")
        .executeTakeFirst();
      cost = absQty * Number(itemCost?.unitCost ?? 0);
    }

    if (cost <= 0) continue;

    const jlRef = nanoid();
    const inventoryAccount = resolveInventoryAccount(
      consumedReplenishmentMap.get(ledger.itemId) ?? null,
      { rawMaterialsAccount, finishedGoodsAccount }
    );

    if (isConsumption) {
      journalLineInserts.push(
        {
          accountId: wipAccount,
          description: "WIP Account",
          amount: debit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        },
        {
          accountId: inventoryAccount.account,
          description: inventoryAccount.description,
          amount: credit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        }
      );
    } else {
      journalLineInserts.push(
        {
          accountId: inventoryAccount.account,
          description: inventoryAccount.description,
          amount: debit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        },
        {
          accountId: wipAccount,
          description: "WIP Account",
          amount: credit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        }
      );
    }

    await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: "Consumption",
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: "Job Consumption",
        documentId: jobId,
        itemId: ledger.itemId,
        quantity: isConsumption ? -absQty : absQty,
        cost: isConsumption ? -cost : cost,
        remainingQuantity: 0,
        postingDate: today,
        companyId
      })
      .execute();

    for (let i = 0; i < 2; i++) {
      journalLineDimensionsMeta.push({
        itemPostingGroupId: consumedPostingGroupMap.get(ledger.itemId) ?? null,
        itemId: ledger.itemId ?? null,
        locationId: jobLocationId
      });
    }
  }

  if (journalLineInserts.length === 0) return;

  // Same hoisted `today` as this function's ledger rows (see above). A
  // Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, trx, today)
      : null;
  const journalEntryId = await sequence.getNextSequence(
    trx,
    "journalEntry",
    companyId
  );

  const journalResult = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId,
      description,
      postingDate: today,
      companyId,
      sourceType: "Job Consumption",
      status: postingStatus,
      postedAt: datetime.timestamp(),
      postedBy: userId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  const journalLineResults = await trx
    .insertInto("journalLine")
    .values(
      journalLineInserts.map((line) => ({
        ...line,
        journalId: journalResult.id
      }))
    )
    .returning(["id"])
    .execute();

  if (dimensionMap.size > 0) {
    const dimensionInserts: {
      journalLineId: string;
      dimensionId: string;
      valueId: string;
      companyId: string;
    }[] = [];

    journalLineResults.forEach((jl, index) => {
      const meta = journalLineDimensionsMeta[index];
      if (!meta) return;
      if (meta.itemPostingGroupId && dimensionMap.has("ItemPostingGroup")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("ItemPostingGroup")!,
          valueId: meta.itemPostingGroupId,
          companyId
        });
      }
      if (meta.itemId && dimensionMap.has("Item")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("Item")!,
          valueId: meta.itemId,
          companyId
        });
      }
      if (meta.locationId && dimensionMap.has("Location")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("Location")!,
          valueId: meta.locationId,
          companyId
        });
      }
    });

    if (dimensionInserts.length > 0) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionInserts)
        .execute();
    }
  }
}

// Each child's quantity is its own persist boundary — it becomes one
// Consumption ledger row — so round PER CHILD and then round the sum. That is
// what makes jobMaterial.quantityIssued net exactly against those rows; a
// single round of the raw sum can differ from them by a minor unit.
function roundedChildTotal(children: { quantity: number | string }[]): number {
  return round(
    children.reduce((sum, child) => sum + round(Number(child.quantity)), 0)
  );
}

// The production-event and inspection links a completion/scrap payload carries
// are written verbatim into productionQuantity, whose single-column FKs accept
// any company's row — re-read them under companyId first (one query per table).
async function assertProductionQuantityLinks(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  links: {
    laborProductionEventId?: string;
    machineProductionEventId?: string;
    setupProductionEventId?: string;
    inspectionId?: string;
    inspectionSampleId?: string;
  }
) {
  await assertCompanyRecords(
    db,
    "productionEvent",
    [
      links.laborProductionEventId,
      links.machineProductionEventId,
      links.setupProductionEventId
    ],
    companyId,
    "Production event"
  );
  await assertCompanyRecords(
    db,
    "inspection",
    [links.inspectionId],
    companyId,
    "Inspection"
  );
  await assertCompanyRecords(
    db,
    "inspectionSample",
    [links.inspectionSampleId],
    companyId,
    "Inspection sample"
  );
}

// Shared accounting context for the job consumption paths: the posting-group
// defaults and the active dimension map. Every company posts these journals
// (Provisional before its accounting cutover), so both always load.
async function loadConsumeAccountingContext(
  db: Kysely<KyselyDatabase>,
  companyId: string
) {
  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );
  if (companyRecord.error) throw new Error("Failed to fetch company");

  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  const dimensions = await many(
    db,
    "dimension",
    {
      companyGroupId: companyRecord.data.companyGroupId!,
      active: true,
      entityType: ["ItemPostingGroup", "Item", "Location"]
    },
    { columns: ["id", "entityType"] }
  );

  const dimensionMap = new Map<string, string>();
  if (dimensions.data) {
    for (const dim of dimensions.data) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }
  }

  return { accountDefaults: accountDefaults.data, dimensionMap };
}

type ConsumeAccountDefaults = Awaited<
  ReturnType<typeof loadConsumeAccountingContext>
>["accountDefaults"];

// Spare parts issued to a maintenance dispatch are an expense the moment they
// leave stock. The caller writes the item ledger rows; this values them: each
// movement relieves (or, on a return, restores) the item's cost layers and
// posts Dr maintenanceAccount / Cr inventory through
// the shared adjustment core — one journal per call, tagged with the dispatch's
// work center. A return reverses at what the dispatch actually booked
// (`resolveMaintenanceReturnCost`), so a part issued before maintenance
// consumption carried value comes back with no value either.
async function valueMaintenanceMovements(
  trx: Transaction<KyselyDatabase>,
  args: {
    dispatch: {
      id: string;
      maintenanceDispatchId: string;
      workCenterId: string | null;
      locationId: string | null;
    };
    // SIGNED: < 0 issued to the dispatch, > 0 returned from it
    movements: Array<{ itemId: string; quantity: number }>;
    postingDate: string;
    companyId: string;
    userId: string;
  }
) {
  const { dispatch, postingDate, companyId, userId } = args;
  const movements = args.movements.filter((m) => Number(m.quantity) !== 0);
  if (movements.length === 0) return;

  const itemIds = [...new Set(movements.map((m) => m.itemId))];
  const hasReturns = movements.some((m) => Number(m.quantity) > 0);

  // Provisional before the company's accounting cutover, Posted after it.
  const postingStatus = await journalPostingStatus(trx, companyId);
  const [items, itemCosts, bookedRows] = await Promise.all([
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType", "replenishmentSystem"])
      .where("id", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("itemCost")
      .select([
        "itemId",
        "costingMethod",
        "unitCost",
        "standardCost",
        "itemPostingGroupId"
      ])
      .where("itemId", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute(),
    hasReturns
      ? trx
          .selectFrom("costLedger")
          .select(["itemId", "quantity", "cost"])
          .where("documentId", "=", dispatch.id)
          .where("documentType", "=", "Maintenance Consumption")
          .where("itemId", "in", itemIds)
          .where("companyId", "=", companyId)
          .execute()
      : Promise.resolve([])
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemCostById = new Map(itemCosts.map((cost) => [cost.itemId, cost]));
  const bookedByItem = new Map<
    string,
    Array<{ quantity: number; cost: number }>
  >();
  for (const row of bookedRows) {
    const list = bookedByItem.get(row.itemId as string) ?? [];
    list.push({ quantity: Number(row.quantity), cost: Number(row.cost) });
    bookedByItem.set(row.itemId as string, list);
  }

  const accountDefaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!accountDefaults) throw new Error("Error getting account defaults");

  const dimensions = await trx
    .selectFrom("dimension")
    .innerJoin("company", "company.companyGroupId", "dimension.companyGroupId")
    .select(["dimension.id", "dimension.entityType"])
    .where("company.id", "=", companyId)
    .where("dimension.active", "=", true)
    .where("dimension.entityType", "in", [
      "Item",
      "ItemPostingGroup",
      "Location",
      "WorkCenter"
    ])
    .execute();

  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? (await resolveAccountingPeriod(trx, companyId, postingDate, "current"))
          .id
      : null;
  const description = `Maintenance Consumption ${dispatch.maintenanceDispatchId}`;
  let journalId: string | null = null;

  const accounting: Parameters<typeof valueMovement>[1]["accounting"] = {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.finishedGoodsAccount,
      inventoryAdjustmentVarianceAccount:
        accountDefaults.inventoryAdjustmentVarianceAccount
    },
    offsetAccount: accountDefaults.maintenanceAccount,
    offsetDescription: "Maintenance Expense",
    description,
    userId,
    dimensions: Object.fromEntries(
      dimensions
        .filter((dim) => dim.entityType)
        .map((dim) => [dim.entityType as string, dim.id])
    ),
    extraDimensions: dispatch.workCenterId
      ? [{ entityType: "WorkCenter", valueId: dispatch.workCenterId }]
      : [],
    getJournalId: async () => {
      journalId ??= await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId,
        status: postingStatus,
        description,
        postingDate,
        userId
      });
      return journalId;
    }
  };

  for (const movement of movements) {
    let quantity = Number(movement.quantity);
    let fixedUnitCost: number | undefined;

    if (quantity > 0) {
      const booked = bookedByItem.get(movement.itemId) ?? [];
      const reversal = resolveMaintenanceReturnCost(booked, quantity);
      if (!reversal) continue;
      quantity = reversal.quantity;
      fixedUnitCost = reversal.unitCost;
      // A later return of the same item in this call sees this one.
      booked.push({ quantity, cost: quantity * fixedUnitCost });
      bookedByItem.set(movement.itemId, booked);
    }

    const item = itemById.get(movement.itemId);
    const itemCost = itemCostById.get(movement.itemId);
    await valueMovement(trx, {
      movement: {
        postingDate,
        itemId: movement.itemId,
        quantity,
        locationId: dispatch.locationId,
        entryType: "Consumption",
        documentType: "Maintenance Consumption",
        documentId: dispatch.id,
        companyId
      },
      item: {
        itemTrackingType: item?.itemTrackingType ?? null,
        replenishmentSystem: item?.replenishmentSystem ?? null,
        itemPostingGroupId: itemCost?.itemPostingGroupId ?? null
      },
      itemCost: {
        costingMethod: itemCost?.costingMethod ?? "Average",
        unitCost: Number(itemCost?.unitCost ?? 0),
        standardCost: Number(itemCost?.standardCost ?? 0)
      },
      accounting,
      fixedUnitCost
    });
  }
}

// The per-operation tracked-consumption write sequence, extracted verbatim from
// the trackedEntitiesToOperation case so trackedEntitiesToBatch can run it once
// per member inside ONE transaction. Reads run against `trx`, so sequential
// member calls drawing from the same lot see each other's decrements.
async function consumeTrackedEntitiesIntoOperation(
  trx: Transaction<KyselyDatabase>,
  {
    materialId,
    jobOperationId,
    itemId,
    parentTrackedEntityId,
    children,
    jobOperationStepId,
    unitNumber,
    overrideExpired,
    overrideReason,
    companyId,
    userId,
    companyToday,
    db,
    postingStatus,
    accountDefaults: accountDefaultsTracked,
    dimensionMap: dimensionMapTracked
  }: {
    materialId?: string;
    jobOperationId?: string;
    itemId?: string;
    parentTrackedEntityId: string;
    children: { trackedEntityId: string; quantity: number }[];
    jobOperationStepId?: string;
    unitNumber?: number;
    overrideExpired?: boolean;
    overrideReason?: string | null;
    companyId: string;
    userId: string;
    companyToday: CalendarDate;
    db: Kysely<KyselyDatabase>;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
    accountDefaults: ConsumeAccountDefaults;
    dimensionMap: Map<string, string>;
  }
): Promise<{
  splitEntities: Array<{
    originalId: string;
    newId: string;
    readableId: string;
    quantity: number;
    remainingQuantity: number;
  }>;
  warning: string | undefined;
}> {
  let expiredWarning: string | undefined;

  const trackedEntities = await trx
    .selectFrom("trackedEntity")
    .where(
      "id",
      "in",
      children.map((child) => child.trackedEntityId)
    )
    .where("companyId", "=", companyId)
    .selectAll()
    .execute();

  const itemLedgers = await trx
    .selectFrom("itemLedger")
    .where("trackedEntityId", "in", [
      ...children.map((child) => child.trackedEntityId)
    ])
    .orderBy("createdBy", "desc")
    .selectAll()
    .execute();

  if (trackedEntities.length !== children.length) {
    throw new NotFoundError("Tracked entities not found");
  }

  if (trackedEntities.some((entity) => entity.status !== "Available")) {
    throw new Error("Tracked entities are not available");
  }

  // Expiry policy gate. Reads companySettings.inventoryShelfLife.
  const expiredPolicy = await getExpiredEntityPolicy(trx, companyId);
  const expiredCheck = checkExpiredEntities(
    trackedEntities.map((e) => ({
      id: e.id,
      expirationDate: e.expirationDate
    })),
    expiredPolicy,
    { allowed: !!overrideExpired, reason: overrideReason ?? null },
    companyToday
  );
  if (!expiredCheck.ok) {
    throw new Error(expiredCheck.reason);
  }
  if (expiredCheck.warning) {
    expiredWarning = expiredCheck.warning;
  }

  let jobMaterial: Selectable<KyselyDatabase["jobMaterial"]> | undefined;
  let actualMaterialId: string | undefined = materialId;
  const firstTrackedEntity = trackedEntities[0];

  if (materialId) {
    // Existing behavior: fetch the jobMaterial
    jobMaterial = await trx
      .selectFrom("jobMaterial")
      .where("id", "=", materialId)
      .where("companyId", "=", companyId)
      .selectAll()
      .executeTakeFirst();

    // Check if any tracked entity has a different sourceDocumentId than the material's itemId
    if (
      firstTrackedEntity &&
      jobMaterial &&
      firstTrackedEntity.sourceDocumentId !== jobMaterial.itemId
    ) {
      // Create a new jobMaterial for the tracked entity's item
      const totalChildQuantity = roundedChildTotal(children);

      const itemCost = await trx
        .selectFrom("itemCost")
        .where("itemId", "=", firstTrackedEntity.sourceDocumentId!)
        .select("unitCost")
        .executeTakeFirst();

      const newJobMaterial = await trx
        .insertInto("jobMaterial")
        .values({
          companyId,
          createdBy: userId,
          description: firstTrackedEntity.sourceDocumentReadableId ?? "",
          estimatedQuantity: 0,
          itemId: firstTrackedEntity.sourceDocumentId!,
          jobId: jobMaterial.jobId!,
          jobMakeMethodId: jobMaterial.jobMakeMethodId,
          jobOperationId: jobMaterial.jobOperationId,
          itemType: jobMaterial.itemType,
          methodType: jobMaterial.methodType,
          quantity: 0,
          quantityIssued: totalChildQuantity,
          requiresBatchTracking: jobMaterial.requiresBatchTracking,
          requiresSerialTracking: jobMaterial.requiresSerialTracking,
          unitCost: itemCost?.unitCost ?? 0
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      actualMaterialId = newJobMaterial.id!;

      // Fetch the newly created jobMaterial
      jobMaterial = await trx
        .selectFrom("jobMaterial")
        .where("id", "=", actualMaterialId)
        .selectAll()
        .executeTakeFirstOrThrow();
    }
  } else if (jobOperationId && itemId) {
    // New behavior: create a jobMaterial on the fly
    const jobOperation = await trx
      .selectFrom("jobOperation")
      .where("id", "=", jobOperationId)
      .where("companyId", "=", companyId)
      .select(["jobId", "jobMakeMethodId"])
      .executeTakeFirst();

    if (!jobOperation) {
      throw new NotFoundError("Job operation not found");
    }

    const item = await trx
      .selectFrom("item")
      .where("id", "=", itemId)
      .where("companyId", "=", companyId)
      .select(["name", "type", "itemTrackingType", "defaultMethodType"])
      .executeTakeFirst();

    if (!item) {
      throw new NotFoundError("Item not found");
    }

    const totalChildQuantity = roundedChildTotal(children);

    const itemCost = await trx
      .selectFrom("itemCost")
      .where("itemId", "=", itemId)
      .select("unitCost")
      .executeTakeFirst();

    const newJobMaterial = await trx
      .insertInto("jobMaterial")
      .values({
        companyId,
        createdBy: userId,
        description: item.name ?? "",
        estimatedQuantity: 0,
        itemId: itemId,
        jobId: jobOperation.jobId!,
        jobMakeMethodId: jobOperation.jobMakeMethodId!,
        jobOperationId: jobOperationId,
        itemType: item.type ?? "Part",
        methodType: item.defaultMethodType ?? "Pull from Inventory",
        quantity: 0,
        quantityIssued: totalChildQuantity,
        requiresBatchTracking: item.itemTrackingType === "Batch",
        requiresSerialTracking: item.itemTrackingType === "Serial",
        unitCost: itemCost?.unitCost ?? 0
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    actualMaterialId = newJobMaterial.id!;

    // Scope this unplanned tracked part to the step it was issued on
    // (assembly view), so it shows on that step rather than as General.
    if (jobOperationStepId) {
      await trx
        .insertInto("jobMaterialStep")
        .values({
          jobMaterialId: actualMaterialId,
          jobOperationStepId
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    // Fetch the newly created jobMaterial
    jobMaterial = await trx
      .selectFrom("jobMaterial")
      .where("id", "=", actualMaterialId)
      .selectAll()
      .executeTakeFirstOrThrow();
  }

  if (!jobMaterial) {
    throw new NotFoundError("Job material not found");
  }

  // Get item details
  const item = await trx
    .selectFrom("item")
    .where("id", "=", jobMaterial?.itemId!)
    .select(["readableIdWithRevision"])
    .executeTakeFirst();

  // Get job location
  const job = await trx
    .selectFrom("job")
    .select(["id", "locationId"])
    .where("id", "=", jobMaterial?.jobId!)
    .executeTakeFirst();

  // Get parent tracked entity details
  const parentTrackedEntity = await trx
    .selectFrom("trackedEntity")
    .where("id", "=", parentTrackedEntityId)
    .where("companyId", "=", companyId)
    .select(["id", "sourceDocumentId", "quantity", "attributes", "status"])
    .executeTakeFirst();

  if (!parentTrackedEntity) {
    throw new NotFoundError("Parent tracked entity not found");
  }

  // Create tracked activity
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: "Consume",
      sourceDocument: "Job Material",
      sourceDocumentId: actualMaterialId,
      sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
      attributes: {
        Job: job?.id!,
        "Job Make Method": jobMaterial?.jobMakeMethodId!,
        "Job Material": jobMaterial?.id!,
        Employee: userId,
        // Assembly view: which step + 1-based unit this consume was for, so
        // the MES can attribute issued quantities per-unit even for a batch
        // parent (where all units share one lot entity).
        ...(jobOperationStepId
          ? { "Job Operation Step": jobOperationStepId }
          : {}),
        ...(unitNumber !== undefined ? { Unit: unitNumber } : {})
      },
      companyId,
      createdBy: userId
    })
    .execute();

  await trx
    .insertInto("trackedActivityOutput")
    .values({
      trackedActivityId: activityId,
      trackedEntityId: parentTrackedEntityId,
      quantity: parentTrackedEntity.quantity,
      companyId,
      createdBy: userId
    })
    .execute();

  const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
    [];
  const trackedActivityInputs: Database["public"]["Tables"]["trackedActivityInput"]["Insert"][] =
    [];

  const splitEntities: Array<{
    originalId: string;
    newId: string;
    readableId: string;
    quantity: number;
    remainingQuantity: number;
  }> = [];

  // Process each child tracked entity
  for (const child of children) {
    const trackedEntity = trackedEntities.find(
      (entity) => entity.id === child.trackedEntityId
    );
    if (!trackedEntity) {
      throw new NotFoundError("Tracked entity not found");
    }
    const { trackedEntityId } = child;

    // ONE canonical quantity for this child, rounded at the persist
    // boundary. On a FULL draw it is the lot's own on-hand: the entity
    // is flipped Consumed without its quantity being rewritten, so
    // booking the requested figure instead would leave the Consumption
    // ledger row disagreeing with the lot it just emptied.
    const entityQuantity = round(Number(trackedEntity.quantity));
    const fullDraw = isFullDraw(entityQuantity, child.quantity);
    const quantity = fullDraw ? entityQuantity : round(child.quantity);

    // Partial consume → split: the lineside entity keeps its id and
    // is decremented; a NEW child entity carries the consumed
    // quantity. EVERYTHING below (Consumed status, Consume input,
    // Consumption ledger) books against the child — flipping the
    // entity half without the ledger half would double-count on-hand.
    let consumedEntityId = trackedEntityId;
    if (!fullDraw) {
      const consumedChildId = nanoid();
      consumedEntityId = consumedChildId;

      const split = buildBatchSplitRecords({
        parent: {
          id: trackedEntity.id!,
          readableId: trackedEntity.readableId,
          quantity: entityQuantity,
          sourceDocument: trackedEntity.sourceDocument,
          sourceDocumentId: trackedEntity.sourceDocumentId,
          sourceDocumentReadableId: trackedEntity.sourceDocumentReadableId,
          itemId: trackedEntity.itemId ?? trackedEntity.sourceDocumentId,
          expirationDate: trackedEntity.expirationDate ?? null,
          attributes: trackedEntity.attributes as Record<string, unknown> | null
        },
        drawQuantity: quantity,
        childId: consumedChildId,
        splitActivityId: nanoid(),
        activitySourceDocument: "Job Material",
        activitySourceDocumentId: actualMaterialId!,
        bin: {
          storageUnitId: resolveTrackedEntityBin(itemLedgers, trackedEntityId),
          locationId: job?.locationId ?? null
        },
        itemLedgerItemId: trackedEntity.sourceDocumentId,
        companyId,
        userId,
        postingDate: companyToday.toString(),
        // Created Available; the shared status update below flips the
        // child to Consumed in the same transaction.
        childStatus: "Available",
        extraChildAttributes: {
          ...(jobOperationStepId
            ? { "Job Operation Step": jobOperationStepId }
            : {}),
          ...(unitNumber !== undefined ? { Unit: unitNumber } : {})
        }
      });

      // Track split entity for the MES confirmation: quantity = what
      // was consumed (the child), remainingQuantity = what the
      // surviving lineside entity still holds.
      splitEntities.push({
        originalId: trackedEntityId,
        newId: consumedChildId,
        readableId: trackedEntity.sourceDocumentReadableId ?? "",
        quantity,
        remainingQuantity: split.parentUpdate.quantity
      });

      await trx
        .insertInto("trackedActivity")
        .values(
          split.activityInsert as Insertable<KyselyDatabase["trackedActivity"]>
        )
        .execute();

      await trx
        .insertInto("trackedEntity")
        .values(
          split.childEntityInsert as Insertable<KyselyDatabase["trackedEntity"]>
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

      // MTO skips ONLY the ledger inserts; entity/activity writes
      // above still happen.
      if (jobMaterial?.methodType !== "Make to Order") {
        itemLedgerInserts.push(...(split.ledgerInserts as ItemLedgerInsert[]));
      }
    }

    // Consume the drawn entity — the split child, or the whole
    // entity on a full draw.
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Consumed"
      })
      .where("id", "=", consumedEntityId)
      .where("companyId", "=", companyId)
      .execute();

    trackedActivityInputs.push({
      trackedActivityId: activityId,
      trackedEntityId: consumedEntityId,
      quantity,
      companyId,
      createdBy: userId
    });

    if (jobMaterial?.methodType !== "Make to Order") {
      itemLedgerInserts.push({
        entryType: "Consumption",
        documentType: "Job Consumption",
        documentId: job?.id!,
        companyId,
        itemId: trackedEntity.sourceDocumentId,
        quantity: -quantity,
        locationId: job?.locationId,
        // The split child has no rows in the pre-transaction ledger
        // snapshot — it sits at the parent's resolved bin.
        storageUnitId: resolveTrackedEntityBin(itemLedgers, trackedEntityId),
        trackedEntityId: consumedEntityId,
        createdBy: userId
      });
    }
  }

  if (trackedActivityInputs.length > 0) {
    await trx
      .insertInto("trackedActivityInput")
      .values(trackedActivityInputs)
      .execute();
  }

  if (itemLedgerInserts.length > 0) {
    await trx.insertInto("itemLedger").values(itemLedgerInserts).execute();

    // Update pickMethod defaultStorageUnitId if needed for each inserted ledger
    for (const ledger of itemLedgerInserts) {
      await updatePickMethodDefaultStorageUnitIfNeeded(
        trx,
        ledger.itemId,
        ledger.locationId,
        ledger.storageUnitId,
        companyId,
        userId
      );
    }
  }

  if (itemLedgerInserts.length > 0) {
    const consumptionEntries = itemLedgerInserts
      .filter((l) => l.entryType === "Consumption")
      .map((l) => ({
        itemId: l.itemId as string,
        quantity: Number(l.quantity),
        trackedEntityId: l.trackedEntityId
      }));

    if (consumptionEntries.length > 0) {
      await createMaterialWipEntries(trx, {
        consumptionLedgers: consumptionEntries,
        jobId: job?.id!,
        operationId: jobMaterial?.jobOperationId ?? actualMaterialId!,
        description: "Tracked Entity Material Issue",
        wipAccount: accountDefaultsTracked.workInProgressAccount,
        rawMaterialsAccount: accountDefaultsTracked.rawMaterialsAccount,
        finishedGoodsAccount: accountDefaultsTracked.finishedGoodsAccount,
        dimensionMap: dimensionMapTracked,

        jobLocationId: job?.locationId ?? null,
        db,
        companyId,
        userId,
        postingStatus
      });
    }
  }

  const totalChildQuantity = roundedChildTotal(children);

  // Only update if we didn't create a new jobMaterial (in which case it's already set)
  if (actualMaterialId === materialId) {
    const currentQuantityIssued = round(
      Number(jobMaterial?.quantityIssued) || 0
    );
    const newQuantityIssued = round(currentQuantityIssued + totalChildQuantity);

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued: newQuantityIssued
      })
      .where("id", "=", actualMaterialId!)
      .where("companyId", "=", companyId)
      .execute();

    logger.info("Job material quantity updated", {
      materialId: actualMaterialId,
      newQuantityIssued
    });
  }

  return { splitEntities, warning: expiredWarning };
}

// The Produce half of a batch-tracked operation completion — the activity +
// entity flip EXTRACTED from jobOperationBatchComplete, so the batch-operations
// Phase 2 (jobOperationBatchOutput) can finalize a member's output WITHOUT that
// case's productionQuantity insert (batch Phase 1 already recorded it) and
// WITHOUT its backflush (the batch's own issue step already ran).
async function produceBatchOutput(
  trx: Transaction<KyselyDatabase>,
  {
    jobOperationId,
    trackedEntityId,
    producedQuantity,
    totalQuantity,
    companyId,
    userId
  }: {
    jobOperationId: string;
    trackedEntityId: string;
    producedQuantity: number;
    totalQuantity: number;
    companyId: string;
    userId: string;
  }
) {
  const trackedEntity = await trx
    .selectFrom("trackedEntity")
    .where("id", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .selectAll()
    .executeTakeFirst();

  if (!trackedEntity) {
    throw new NotFoundError("Tracked entity not found");
  }

  if (trackedEntity.status !== "Consumed") {
    const activityId = nanoid();
    await trx
      .insertInto("trackedActivity")
      .values({
        id: activityId,
        type: "Produce",
        sourceDocument: "Job Operation",
        sourceDocumentId: jobOperationId,
        attributes: {
          "Job Operation": jobOperationId,
          Employee: userId,
          Quantity: producedQuantity
        },
        companyId,
        createdBy: userId
      })
      .execute();

    await trx
      .insertInto("trackedActivityOutput")
      .values({
        trackedActivityId: activityId,
        trackedEntityId: trackedEntityId,
        quantity: producedQuantity,
        companyId,
        createdBy: userId
      })
      .execute();

    // Update the current trackedEntity to Complete
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Available",
        quantity: totalQuantity
      })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

export const issueMaterialPermission = {
  by: "type",
  rules: {
    convertEntity: { update: "inventory" },
    jobCompleteMakeToOrder: {},
    jobOperation: { update: "production" },
    jobOperationBatchComplete: { update: "production" },
    jobOperationBatchOutput: { update: "production" },
    jobOperationSerialComplete: { update: "production" },
    jobOperationScrap: { update: "production" },
    partToOperation: { update: "production" },
    scrapTrackedEntity: { update: "production" },
    mergeTrackedEntities: { update: "inventory" },
    trackedEntitiesToBatch: { update: "production" },
    trackedEntitiesToOperation: { update: "production" },
    unconsumeTrackedEntities: { update: "production" },
    maintenanceDispatchInventory: { update: "resources" },
    maintenanceDispatchTrackedEntities: { update: "resources" },
    maintenanceDispatchUnconsume: { update: "resources" },
    maintenanceDispatchUnissue: { update: "resources" }
  }
} satisfies PermissionRule<z.output<typeof issueInput>>;

/**
 * Issues material and records production against jobs, operations, tracked
 * entities and maintenance dispatches, per `type`.
 */
export async function issueMaterial(
  ctx: ServiceContext,
  raw: z.input<typeof issueInput>
): Promise<IssueResult> {
  const input = issueInput.parse(raw);

  const db = ctx.asSystem.pg;
  const validatedPayload = {
    ...input,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  };

  logger.info(validatedPayload);

  const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
    [];

  switch (validatedPayload.type) {
    case "jobOperation": {
      const { id, companyId, quantity, userId } = validatedPayload;

      const { accountDefaults, dimensionMap } =
        await loadConsumeAccountingContext(db, companyId);

      await db.transaction().execute(async (trx) => {
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatus = await journalPostingStatus(trx, companyId);
        await issueJobOperationMaterials(trx, {
          jobOperationId: id,
          quantity,
          companyId,
          userId,
          postingStatus,
          accountDefaults,
          dimensionMap,
          db
        });
      });

      break;
    }
    case "jobOperationBatchComplete": {
      const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
      await assertProductionQuantityLinks(db, companyId, row);

      const [jobOperation, productionQuantities] = await inOrder([
        () => single(db, "jobOperation", { id: row.jobOperationId, companyId }),
        () =>
          many(db, "productionQuantity", {
            jobOperationId: row.jobOperationId,
            companyId,
            type: "Production"
          })
      ]);

      if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
        throw new NotFoundError("Job operation not found");
      }

      const accountingBatch = await loadConsumeAccountingContext(db, companyId);

      await db.transaction().execute(async (trx) => {
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatus = await journalPostingStatus(trx, companyId);
        await trx
          .insertInto("productionQuantity")
          .values({
            ...row,
            type: "Production",
            companyId,
            createdBy: userId
          })
          .executeTakeFirst();

        const previousProductionQuantities =
          productionQuantities?.data?.reduce((acc, curr) => {
            const quantity = Number(curr.quantity);
            return acc + quantity;
          }, 0) ?? 0;

        await produceBatchOutput(trx, {
          jobOperationId: row.jobOperationId,
          trackedEntityId,
          producedQuantity: row.quantity,
          totalQuantity: previousProductionQuantities + row.quantity,
          companyId,
          userId
        });

        await issueJobOperationMaterials(trx, {
          jobOperationId: row.jobOperationId,
          quantity: row.quantity,
          companyId,
          userId,
          postingStatus,
          accountDefaults: accountingBatch.accountDefaults,
          dimensionMap: accountingBatch.dimensionMap,
          db
        });
      });

      return {
        success: true
      };
    }
    case "jobOperationBatchOutput": {
      const {
        jobOperationId,
        trackedEntityId,
        quantity,
        readableId,
        companyId,
        userId
      } = validatedPayload;

      const [entity, productionQuantities] = await inOrder([
        () =>
          single(
            db,
            "trackedEntity",
            { id: trackedEntityId, companyId },
            { columns: ["id", "status", "readableId"] }
          ),
        () =>
          many(
            db,
            "productionQuantity",
            { jobOperationId, companyId, type: "Production" },
            { columns: ["quantity"] }
          )
      ]);
      if (entity.error || !entity.data) {
        throw new NotFoundError("Tracked entity not found");
      }

      // Resume no-op: a prior attempt already produced this member's output.
      if (entity.data.status === "Available") {
        return { success: true, created: false };
      }

      // An Available lot must carry a number. Batch creation plans it (the
      // entity's readableId, or the merged lot passed as readableId); this is
      // the backstop for direct calls and for batches planned before that.
      if (!readableId && !entity.data.readableId) {
        throw new Error(
          `Operation ${jobOperationId} produces a batch-tracked item — its batch number is required`
        );
      }

      const totalQuantity =
        productionQuantities.data?.reduce(
          (acc: number, curr: { quantity: number | string | null }) =>
            acc + Number(curr.quantity),
          0
        ) ?? 0;
      if (totalQuantity <= 0) {
        throw new Error(
          "No recorded production quantity for this operation — complete the batch first"
        );
      }

      await db.transaction().execute(async (trx) => {
        if (readableId) {
          await trx
            .updateTable("trackedEntity")
            .set({ readableId })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }
        await produceBatchOutput(trx, {
          jobOperationId,
          trackedEntityId,
          producedQuantity: quantity,
          totalQuantity,
          companyId,
          userId
        });
      });

      return { success: true, created: true };
    }
    case "jobOperationSerialComplete": {
      const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
      await assertProductionQuantityLinks(db, companyId, row);

      const jobOperation = await single(db, "jobOperation", {
        id: row.jobOperationId,
        companyId
      });
      if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
        throw new NotFoundError("Job operation not found");
      }

      // UNIT-AXIS order, identical to the apps' getTrackedEntitiesByMakeMethodId:
      // position here is the `index` step records are stored under, so the
      // tiebreakers are not optional — `createdAt` ties for bulk-minted serials
      // and Postgres breaks a tie by physical row order, which any UPDATE moves.
      const trackedEntities = await many(
        db,
        "trackedEntity",
        {
          attributes: contains({
            "Job Make Method": jobOperation.data.jobMakeMethodId
          }),
          companyId
        },
        { orderBy: ["createdAt", "readableId", "id"] }
      );

      if (!trackedEntities.data || trackedEntities.data.length === 0) {
        throw new NotFoundError("Tracked entities not found");
      }

      // The unit this completion is for, as the 0-based axis index its step
      // records are keyed by. Derived HERE rather than taken from the caller:
      // three routes post this payload and none of them should be trusted, or
      // required, to know the axis.
      const completedUnitIndex = trackedEntities.data.findIndex(
        (entity: { id: string }) => entity.id === trackedEntityId
      );

      const relatedTrackedEntities = trackedEntities.data.filter(
        (trackedEntity) =>
          `Operation ${row.jobOperationId}` in
          (trackedEntity.attributes as TrackedEntityAttributes)
      );

      const {
        accountDefaults: accountDefaultsSerial,
        dimensionMap: dimensionMapSerial
      } = await loadConsumeAccountingContext(db, companyId);

      let newEntityId: string | undefined;
      await db.transaction().execute(async (trx) => {
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatus = await journalPostingStatus(trx, companyId);
        await trx
          .insertInto("productionQuantity")
          .values({
            ...row,
            type: "Production",
            companyId,
            createdBy: userId
          })
          .executeTakeFirst();

        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirst();

        if (!trackedEntity) {
          throw new NotFoundError("Tracked entity not found");
        }

        if (trackedEntity.status !== "Consumed") {
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Complete",
              sourceDocument: "Job Operation",
              sourceDocumentId: row.jobOperationId,
              // `Job` is what the traceability sidebar loads step records by,
              // and `Unit` is what scopes them to THIS serial. Without `Job`
              // the sidebar showed none; without `Unit` it would show every
              // unit's values under one serial. Same two keys the production
              // event activity already writes (MES startProductionEvent).
              attributes: {
                Job: jobOperation.data.jobId,
                "Job Operation": row.jobOperationId,
                Employee: userId,
                ...(completedUnitIndex >= 0 ? { Unit: completedUnitIndex } : {})
              },
              companyId,
              createdBy: userId
            })
            .execute();

          await trx
            .insertInto("trackedActivityOutput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: trackedEntityId,
              quantity: 1,
              companyId,
              createdBy: userId
            })
            .execute();
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Available",
              quantity: 1,
              attributes: {
                ...(trackedEntity.attributes as TrackedEntityAttributes),
                [`Operation ${row.jobOperationId}`]:
                  relatedTrackedEntities.length + 1
              }
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        if (
          trackedEntities.data.length <
          (jobOperation.data.operationQuantity ?? 0)
        ) {
          // Number this lazily-spawned unit from the item's serial sequence, if
          // one is configured. This unit wasn't part of the initial pre-split at
          // job creation (e.g. the job quantity was increased afterwards, or the
          // sequence was configured later), so it would otherwise be created with
          // a null readableId. Resolve the job's location for the %{location}
          // token; the reservation runs in this transaction, atomic with the spawn.
          let spawnReadableId: string | null = null;
          if (trackedEntity.itemId) {
            let locationCode: string | null = null;
            let locationName: string | null = null;
            const jobIdForLocation = (
              trackedEntity.attributes as Record<string, unknown>
            ).Job;
            if (typeof jobIdForLocation === "string") {
              const jobRow = await single(
                trx,
                "job",
                { id: jobIdForLocation, companyId },
                { columns: ["locationId"] }
              );
              if (jobRow.data?.locationId) {
                const loc = await single(
                  trx,
                  "location",
                  { id: jobRow.data.locationId, companyId },
                  { columns: ["code", "name"] }
                );
                locationCode = loc.data?.code ?? null;
                locationName = loc.data?.name ?? null;
              }
            }
            const spawnSerials = await sequence.getNextSerialNumbers(trx, {
              itemId: trackedEntity.itemId,
              companyId,
              count: 1,
              locationCode,
              locationName
            });
            spawnReadableId = spawnSerials[0] ?? null;
          }

          // Create a new trackedEntity with the same attributes but status = Reserved
          const newTrackedEntityResult = await trx
            .insertInto("trackedEntity")
            .values({
              sourceDocument: trackedEntity.sourceDocument,
              sourceDocumentId: trackedEntity.sourceDocumentId,
              sourceDocumentReadableId: trackedEntity.sourceDocumentReadableId,
              quantity: 1,
              status: "Reserved",
              attributes: trackedEntity.attributes,
              itemId: trackedEntity.itemId ?? null,
              expirationDate: trackedEntity.expirationDate ?? null,
              readableId: spawnReadableId,
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .executeTakeFirst();

          newEntityId = newTrackedEntityResult?.id;
        }

        await issueJobOperationMaterials(trx, {
          jobOperationId: row.jobOperationId,
          quantity: row.quantity,
          companyId,
          userId,
          postingStatus,
          accountDefaults: accountDefaultsSerial,
          dimensionMap: dimensionMapSerial,
          db
        });
      });

      return {
        success: true,
        newTrackedEntityId: newEntityId
      };
    }
    case "jobOperationScrap": {
      const {
        jobOperationId,
        quantity,
        scrapReasonId,
        trackedEntityId: scrapEntityId,
        notes,
        laborProductionEventId,
        machineProductionEventId,
        setupProductionEventId,
        companyId,
        userId
      } = validatedPayload;
      // Lands on productionQuantity, the Scrap activity and the journal's
      // ScrapReason dimension — all this company's rows.
      await assertCompanyRecords(
        db,
        "scrapReason",
        [scrapReasonId],
        companyId,
        "Scrap reason"
      );
      await assertProductionQuantityLinks(db, companyId, {
        laborProductionEventId,
        machineProductionEventId,
        setupProductionEventId
      });

      const operationRes = await single(db, "jobOperation", {
        id: jobOperationId,
        companyId
      });
      const operation = operationRes.data;
      if (!operation || !operation.jobMakeMethodId) {
        throw new NotFoundError("Job operation not found");
      }

      const [makeMethodRes, jobRes, trackedEntitiesRes, companyRecordScrapOp] =
        await inOrder([
          () =>
            single(
              db,
              "jobMakeMethod",
              { id: operation.jobMakeMethodId, companyId },
              {
                columns: [
                  "id",
                  "itemId",
                  "requiresSerialTracking",
                  "requiresBatchTracking",
                  "parentMaterialId"
                ]
              }
            ),
          () =>
            single(
              db,
              "job",
              { id: operation.jobId, companyId },
              { columns: ["id", "jobId", "locationId"] }
            ),
          () =>
            many(
              db,
              "trackedEntity",
              {
                attributes: contains({
                  "Job Make Method": operation.jobMakeMethodId
                }),
                companyId
              },
              { columns: ["id"] }
            ),
          () =>
            single(
              db,
              "company",
              { id: companyId },
              { columns: ["companyGroupId"] }
            )
        ]);
      if (makeMethodRes.error || !makeMethodRes.data) {
        throw new NotFoundError("Job make method not found");
      }
      if (jobRes.error || !jobRes.data)
        throw new NotFoundError("Job not found");
      if (companyRecordScrapOp.error) {
        throw new Error("Failed to fetch company");
      }
      const makeMethod = makeMethodRes.data;
      const job = jobRes.data;
      const existingEntityCount = trackedEntitiesRes.data?.length ?? 0;

      const accountDefaultsScrapOp = await getDefaultPostingGroup(
        db,
        companyId
      );
      if (accountDefaultsScrapOp.error || !accountDefaultsScrapOp.data) {
        throw new Error("Error getting account defaults");
      }

      const dimensionsScrapOp = await many(
        db,
        "dimension",
        {
          companyGroupId: companyRecordScrapOp.data.companyGroupId!,
          active: true,
          entityType: [
            "ItemPostingGroup",
            "Item",
            "Location",
            "ScrapReason",
            "WorkCenter",
            "Employee"
          ]
        },
        { columns: ["id", "entityType"] }
      );
      const dimensionMapScrapOp = new Map<string, string>();
      if (dimensionsScrapOp.data) {
        for (const dim of dimensionsScrapOp.data) {
          if (dim.entityType) dimensionMapScrapOp.set(dim.entityType, dim.id);
        }
      }

      const isSerial = makeMethod.requiresSerialTracking === true;
      if (isSerial && !scrapEntityId) {
        throw new Error("trackedEntityId is required to scrap a serial unit");
      }
      if (isSerial && quantity !== 1) {
        throw new Error("Serial units are scrapped one at a time");
      }

      const todayScrapOp = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      let newEntityId: string | undefined;
      await db.transaction().execute(async (trx) => {
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatus = await journalPostingStatus(trx, companyId);

        // 1. Scrap quantity record. The quantity-sync interceptor aggregates
        //    quantityScrapped; scrap no longer counts toward the auto-Done
        //    target (20260807090629), so the operation stays open until the
        //    good quantity is actually made.
        await trx
          .insertInto("productionQuantity")
          .values({
            jobOperationId,
            quantity,
            type: "Scrap",
            scrapReasonId,
            notes,
            laborProductionEventId,
            machineProductionEventId,
            setupProductionEventId,
            companyId,
            createdBy: userId
          })
          .executeTakeFirst();

        // 2. Backflush the scrapped units\' BOM for this operation — material
        //    cost enters WIP exactly as a completion would (NetSuite "Issue
        //    for Scrap"); the WIP→scrap journal below relieves it.
        const backflush = await issueJobOperationMaterials(trx, {
          jobOperationId,
          quantity,
          companyId,
          userId,
          postingStatus,
          accountDefaults: accountDefaultsScrapOp.data,
          dimensionMap: dimensionMapScrapOp,
          db
        });

        // 3. Serial: terminal status + Scrap genealogy on the selected unit.
        //    The entity keeps its consumed-material input tree.
        let scrappedEntityAttributes: TrackedEntityAttributes | null = null;
        if (isSerial && scrapEntityId) {
          const entity = await trx
            .selectFrom("trackedEntity")
            .selectAll()
            .where("id", "=", scrapEntityId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (!entity) throw new NotFoundError("Tracked entity not found");
          if (entity.status === "Consumed" || entity.status === "Scrapped") {
            throw new Error("Tracked entity is not in progress");
          }
          scrappedEntityAttributes =
            entity.attributes as TrackedEntityAttributes;

          const scrapActivityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: scrapActivityId,
              type: "Scrap",
              sourceDocument: "Job Operation",
              sourceDocumentId: jobOperationId,
              attributes: {
                "Job Operation": jobOperationId,
                "Scrap Reason": scrapReasonId,
                Employee: userId,
                ...(notes?.trim() ? { Notes: notes.trim() } : {})
              },
              companyId,
              createdBy: userId
            })
            .execute();
          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: scrapActivityId,
              trackedEntityId: scrapEntityId,
              quantity: 1,
              companyId,
              createdBy: userId
            })
            .execute();
          // No `Operation ...` completion stamp — the unit did NOT complete
          // this operation; status is the terminal marker.
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Scrapped",
              attributes: {
                ...(entity.attributes as TrackedEntityAttributes),
                "Scrap Reason": scrapReasonId
              }
            })
            .where("id", "=", scrapEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        // 4. Reopen Done ops + capacity top-up beyond the planned allowance
        //    so replacement units can run the FULL routing.
        await applyScrapReplacement(trx, {
          jobMakeMethodId: operation.jobMakeMethodId!,
          jobId: job.id,
          companyId,
          userId
        });

        // 5. Serial: spawn the replacement Reserved unit. Same convention as
        //    jobOperationSerialComplete — spawn while total entities <
        //    operationQuantity; the top-up above grew operationQuantity by
        //    the beyond-allowance scrap, and pre-created allowance units
        //    (job.scrapQuantity at release) already cover in-allowance scrap.
        if (isSerial && scrapEntityId && scrappedEntityAttributes) {
          const updatedOperation = await trx
            .selectFrom("jobOperation")
            .select(["operationQuantity"])
            .where("id", "=", jobOperationId)
            .executeTakeFirst();
          const capacity = Number(updatedOperation?.operationQuantity ?? 0);
          if (existingEntityCount < capacity) {
            let spawnReadableId: string | null = null;
            if (makeMethod.itemId) {
              let locationCode: string | null = null;
              let locationName: string | null = null;
              if (job.locationId) {
                const loc = await single(
                  trx,
                  "location",
                  { id: job.locationId, companyId },
                  { columns: ["code", "name"] }
                );
                locationCode = loc.data?.code ?? null;
                locationName = loc.data?.name ?? null;
              }
              const spawnSerials = await sequence.getNextSerialNumbers(trx, {
                itemId: makeMethod.itemId,
                companyId,
                count: 1,
                locationCode,
                locationName
              });
              spawnReadableId = spawnSerials[0] ?? null;
            }

            const scrappedEntity = await trx
              .selectFrom("trackedEntity")
              .selectAll()
              .where("id", "=", scrapEntityId)
              .executeTakeFirst();
            const newTrackedEntityResult = await trx
              .insertInto("trackedEntity")
              .values({
                sourceDocument: scrappedEntity?.sourceDocument ?? "Item",
                sourceDocumentId:
                  scrappedEntity?.sourceDocumentId ?? makeMethod.itemId ?? "",
                sourceDocumentReadableId:
                  scrappedEntity?.sourceDocumentReadableId,
                quantity: 1,
                status: "Reserved",
                attributes: scrappedEntityAttributes as unknown as Json,
                itemId: makeMethod.itemId ?? null,
                expirationDate: scrappedEntity?.expirationDate ?? null,
                readableId: spawnReadableId,
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirst();
            newEntityId = newTrackedEntityResult?.id;
          }
        }

        // 6. GL: relieve the scrapped units\' accumulated material cost from
        //    WIP into the scrap account. Valuation = this operation\'s actual
        //    backflush cost + prior operations\' estimated material cost
        //    (jobMaterial per-unit quantity × itemCost.unitCost). Labor and
        //    overhead already absorbed stay in WIP and settle via close-job
        //    variance (spec decision 6).
        let priorUnitMaterialCost = 0;
        const priorOperations = await trx
          .selectFrom("jobOperation")
          .select(["id"])
          .where("jobMakeMethodId", "=", operation.jobMakeMethodId!)
          .where("order", "<", operation.order)
          .execute();
        if (priorOperations.length > 0) {
          const priorMaterials = await trx
            .selectFrom("jobMaterial")
            .select(["itemId", "quantity"])
            .where(
              "jobOperationId",
              "in",
              priorOperations.map((op) => op.id)
            )
            .where("methodType", "!=", "Make to Order")
            .execute();
          if (priorMaterials.length > 0) {
            const priorCosts = await trx
              .selectFrom("itemCost")
              .select(["itemId", "unitCost"])
              .where(
                "itemId",
                "in",
                priorMaterials.map((m) => m.itemId)
              )
              .where("companyId", "=", companyId)
              .execute();
            const unitCostByItem = new Map(
              priorCosts.map((c) => [c.itemId, Number(c.unitCost) || 0])
            );
            for (const material of priorMaterials) {
              priorUnitMaterialCost +=
                (Number(material.quantity) || 0) *
                (unitCostByItem.get(material.itemId) ?? 0);
            }
          }
        }

        const scrapCost =
          backflush.totalMaterialCost + priorUnitMaterialCost * quantity;
        if (scrapCost > 0) {
          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted"
              ? await getCurrentAccountingPeriod(companyId, trx, todayScrapOp)
              : null;
          const journalEntryId = await sequence.getNextSequence(
            trx,
            "journalEntry",
            companyId
          );
          const journalResult = await trx
            .insertInto("journal")
            .values({
              journalEntryId,
              accountingPeriodId,
              description: `Scrap — Job ${job.jobId ?? job.id}`,
              postingDate: todayScrapOp,
              companyId,
              sourceType: "Job Consumption",
              status: postingStatus,
              postedAt: datetime.timestamp(),
              postedBy: userId,
              createdBy: userId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          // An empty scrapAccount falls back to the variance account.
          const scrapAccountId = resolveDefaultAccount(
            accountDefaultsScrapOp.data,
            "scrapAccount",
            postingStatus
          ).accountId;
          const journalLineReference = nanoid();
          const journalLineResults = await trx
            .insertInto("journalLine")
            .values([
              {
                journalId: journalResult.id,
                accountId: scrapAccountId,
                description: "Scrap Account",
                amount: debit("expense", scrapCost),
                quantity,
                documentType: "Scrap",
                documentId: job.id,
                documentLineReference: `jobOperationScrap:${jobOperationId}`,
                journalLineReference,
                companyId
              },
              {
                journalId: journalResult.id,
                accountId: accountDefaultsScrapOp.data.workInProgressAccount,
                description: "WIP Account",
                amount: credit("asset", scrapCost),
                quantity,
                documentType: "Scrap",
                documentId: job.id,
                documentLineReference: `jobOperationScrap:${jobOperationId}`,
                journalLineReference,
                companyId
              }
            ])
            .returning(["id"])
            .execute();

          const itemCostRow = makeMethod.itemId
            ? await trx
                .selectFrom("itemCost")
                .select(["itemPostingGroupId"])
                .where("itemId", "=", makeMethod.itemId)
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            : null;
          const scrapDimensionValues: Array<[string, string | null]> = [
            ["Item", makeMethod.itemId ?? null],
            ["ItemPostingGroup", itemCostRow?.itemPostingGroupId ?? null],
            ["Location", job.locationId ?? null],
            ["ScrapReason", scrapReasonId],
            ["WorkCenter", operation.workCenterId ?? null],
            ["Employee", userId]
          ];
          const dimensionInserts = journalLineResults.flatMap((line) =>
            scrapDimensionValues
              .filter(
                ([entityType, valueId]) =>
                  dimensionMapScrapOp.has(entityType) && valueId
              )
              .map(([entityType, valueId]) => ({
                journalLineId: line.id,
                dimensionId: dimensionMapScrapOp.get(entityType)!,
                valueId: valueId as string,
                companyId
              }))
          );
          if (dimensionInserts.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(dimensionInserts)
              .execute();
          }
        }
      });

      // Reschedule outside the transaction (trigger-rework precedent):
      // reopened/topped-up operations need fresh dates and priorities.
      // The scrap transaction already committed; a failed reschedule is logged, not raised.
      const rescheduled = await invokePosting(
        { db, companyId, userId },
        "reschedule",
        { jobId: job.id },
        rescheduleJob
      );
      if (rescheduled.error) {
        logger.error("Failed to trigger reschedule after scrap", {
          error: rescheduled.error
        });
      }

      return {
        success: true,
        newTrackedEntityId: newEntityId
      };
    }
    case "partToOperation": {
      const {
        id,
        companyId,
        userId,
        itemId,
        quantity,
        materialId,
        jobOperationStepId,
        adjustmentType
      } = validatedPayload;

      // Written into jobMaterialStep for an unplanned part (no companyId there).
      await assertCompanyRecords(
        db,
        "jobOperationStep",
        [jobOperationStepId],
        companyId,
        "Job operation step"
      );

      const { accountDefaults, dimensionMap } =
        await loadConsumeAccountingContext(db, companyId);

      await db.transaction().execute(async (trx) => {
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatus = await journalPostingStatus(trx, companyId);
        const jobOperation = await trx
          .selectFrom("jobOperation")
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .select(["jobId", "jobMakeMethodId"])
          .executeTakeFirst();
        if (!jobOperation) throw new NotFoundError("Job operation not found");

        const [job, item] = await Promise.all([
          trx
            .selectFrom("job")
            .where("id", "=", jobOperation?.jobId!)
            .select("locationId")
            .executeTakeFirst(),
          trx
            .selectFrom("item")
            .where("id", "=", itemId)
            .where("companyId", "=", companyId)
            .select([
              "id",
              "itemTrackingType",
              "name",
              "readableIdWithRevision",
              "type"
            ])
            .executeTakeFirst()
        ]);

        if (materialId) {
          const material = await trx
            .selectFrom("jobMaterial")
            .where("id", "=", materialId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirst();
          if (!material) throw new NotFoundError("Job material not found");

          let storageUnitId: string | null | undefined;
          // Prioritize material.storageUnitId if available
          if (material?.storageUnitId) {
            storageUnitId = material.storageUnitId;
          } else if (material?.defaultStorageUnit) {
            const pickMethod = await trx
              .selectFrom("pickMethod")
              .where("itemId", "=", itemId)
              .where("locationId", "=", job?.locationId!)
              .select("defaultStorageUnitId")
              .executeTakeFirst();
            storageUnitId = pickMethod?.defaultStorageUnitId;
          } else {
            storageUnitId = await getStorageUnitWithHighestQuantity(
              trx,
              itemId,
              job?.locationId!
            );
          }

          // Rounded once here: it drives the ledger rows, the budget
          // allocation and the quantityIssued write below.
          const quantityToIssue = round(
            adjustmentType === "Positive Adjmt."
              ? Number(quantity)
              : adjustmentType === "Negative Adjmt."
                ? Number(quantity)
                : round(Number(quantity)) -
                  round(Number(material?.quantityIssued)) // set quantity
          );

          if (material && material.methodType !== "Make to Order") {
            let remaining = Number(quantityToIssue);
            if (adjustmentType !== "Positive Adjmt." && remaining > 0) {
              const budgets = orderOldFirst(
                await getPickedBudgets(trx, {
                  material,
                  locationId: job?.locationId!,
                  companyId,
                  opStorageUnitId: await getOperationLinesideBin(trx, {
                    jobOperationId: material.jobOperationId,
                    companyId
                  })
                }),
                material.itemId
              );
              const allocation = allocateAcrossBudgets(
                remaining,
                budgets,
                Number(material.quantity ?? 0)
              );
              remaining = allocation.remaining;
              for (const take of allocation.takes) {
                if (!take.budget.isInventory) continue;
                for (const row of splitTakeByBin(take)) {
                  itemLedgerInserts.push({
                    entryType: "Consumption",
                    documentType: "Job Consumption",
                    documentId: material.jobId,
                    documentLineId: id,
                    companyId,
                    itemId: take.budget.itemId,
                    locationId: job?.locationId,
                    storageUnitId: row.storageUnitId,
                    quantity: -row.quantity,
                    createdBy: userId
                  });
                }
              }
            }
            if (item?.itemTrackingType === "Inventory" && remaining !== 0) {
              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: material.jobId,
                documentLineId: id,
                companyId,
                itemId: material.itemId,
                locationId: job?.locationId,
                storageUnitId,
                quantity:
                  adjustmentType === "Positive Adjmt."
                    ? Number(remaining)
                    : -Number(remaining),
                createdBy: userId
              });
            }
          }

          await trx
            .updateTable("jobMaterial")
            .set({
              // A positive adjustment returns material to inventory, so it
              // reduces quantityIssued — otherwise the backflush cap sees
              // returned material as still issued.
              quantityIssued: round(
                round(Number(material?.quantityIssued) ?? 0) +
                  (adjustmentType === "Positive Adjmt."
                    ? -quantityToIssue
                    : quantityToIssue)
              )
            })
            .where("id", "=", materialId)
            .where("companyId", "=", companyId)
            .execute();

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();

            // Update pickMethod defaultStorageUnitId if needed for each inserted ledger
            for (const ledger of itemLedgerInserts) {
              await updatePickMethodDefaultStorageUnitIfNeeded(
                trx,
                ledger.itemId,
                ledger.locationId,
                ledger.storageUnitId,
                companyId,
                userId
              );
            }
          }
        } else {
          let storageUnitId: string | null | undefined;
          if (item?.itemTrackingType === "Inventory") {
            const pickMethod = await trx
              .selectFrom("pickMethod")
              .where("itemId", "=", itemId)
              .where("locationId", "=", job?.locationId!)
              .select("defaultStorageUnitId")
              .executeTakeFirst();

            storageUnitId =
              pickMethod?.defaultStorageUnitId ??
              (await getStorageUnitWithHighestQuantity(
                trx,
                itemId,
                job?.locationId!
              ));

            itemLedgerInserts.push({
              entryType: "Consumption",
              documentType: "Job Consumption",
              documentId: jobOperation?.jobId,
              documentLineId: id,
              companyId,
              itemId: itemId!,
              quantity:
                adjustmentType === "Positive Adjmt."
                  ? Number(quantity)
                  : -Number(quantity),
              locationId: job?.locationId,
              storageUnitId,
              createdBy: userId
            });
          }

          const itemCost = await trx
            .selectFrom("itemCost")
            .where("itemId", "=", itemId!)
            .select("unitCost")
            .executeTakeFirst();

          const newJobMaterial = await trx
            .insertInto("jobMaterial")
            .values({
              companyId,
              createdBy: userId,
              description: item?.name ?? "",
              estimatedQuantity: 0,
              itemId: itemId!,
              itemType: item?.type ?? "Part",
              jobId: jobOperation?.jobId!,
              jobMakeMethodId: jobOperation?.jobMakeMethodId!,
              jobOperationId: id,
              storageUnitId: storageUnitId ?? undefined,
              methodType: "Pull from Inventory",
              quantity: 0,
              quantityIssued: round(Number(quantity ?? 0)),
              unitCost: itemCost?.unitCost ?? 0
            })
            .returning("id")
            .executeTakeFirst();

          // Scope this unplanned part to the step it was issued on (assembly
          // view), so it shows on that step rather than as a General material.
          if (jobOperationStepId && newJobMaterial?.id) {
            await trx
              .insertInto("jobMaterialStep")
              .values({
                jobMaterialId: newJobMaterial.id,
                jobOperationStepId
              })
              .onConflict((oc) => oc.doNothing())
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();

            // Update pickMethod defaultStorageUnitId if needed for each inserted ledger
            for (const ledger of itemLedgerInserts) {
              await updatePickMethodDefaultStorageUnitIfNeeded(
                trx,
                ledger.itemId,
                ledger.locationId,
                ledger.storageUnitId,
                companyId,
                userId
              );
            }
          }
        }

        if (itemLedgerInserts.length > 0) {
          const jobOperation = await trx
            .selectFrom("jobOperation")
            .where("id", "=", id)
            .select(["jobId"])
            .executeTakeFirst();

          const jobRecord = jobOperation?.jobId
            ? await trx
                .selectFrom("job")
                .where("id", "=", jobOperation.jobId)
                .select(["itemId", "locationId"])
                .executeTakeFirst()
            : null;

          await createMaterialWipEntries(trx, {
            consumptionLedgers: itemLedgerInserts.map((l) => ({
              itemId: l.itemId as string,
              quantity: Number(l.quantity),
              trackedEntityId: l.trackedEntityId
            })),
            jobId: jobOperation?.jobId!,
            operationId: id,
            description: "Manual Material Issue",
            wipAccount: accountDefaults.workInProgressAccount,
            rawMaterialsAccount: accountDefaults.rawMaterialsAccount,
            finishedGoodsAccount: accountDefaults.finishedGoodsAccount,
            dimensionMap,

            jobLocationId: jobRecord?.locationId ?? null,
            db,
            companyId,
            userId,
            postingStatus
          });
        }
      });
      break;
    }
    case "scrapTrackedEntity": {
      const {
        trackedEntityId,
        materialId,
        parentTrackedEntityId,
        scrapReasonId,
        makeReplacement,
        companyId,
        userId
      } = validatedPayload;
      // The parent lands in trackedActivityOutput and the reason on the ledger,
      // the activity and the journal dimension — both must be this company's.
      await assertCompanyRecords(
        db,
        "trackedEntity",
        [parentTrackedEntityId],
        companyId,
        "Parent tracked entity"
      );
      await assertCompanyRecords(
        db,
        "scrapReason",
        [scrapReasonId],
        companyId,
        "Scrap reason"
      );

      const [trackedEntity, jobMaterial] = await inOrder([
        () => single(db, "trackedEntity", { id: trackedEntityId, companyId }),
        () => single(db, "jobMaterial", { id: materialId, companyId })
      ]);

      if (!trackedEntity.data) {
        throw new NotFoundError("Tracked entity not found");
      }

      if (!jobMaterial.data) {
        throw new NotFoundError("Job material not found");
      }
      if (trackedEntity.data.status === "Scrapped") {
        throw new Error("Tracked entity has already been scrapped");
      }

      const companyRecordScrap = await single(
        db,
        "company",
        { id: companyId },
        { columns: ["companyGroupId"] }
      );
      if (companyRecordScrap.error) throw new Error("Failed to fetch company");
      // Provisional before the company's accounting cutover, Posted after it.
      const postingStatusScrap = await journalPostingStatus(db, companyId);

      const accountDefaultsScrap = await getDefaultPostingGroup(db, companyId);
      if (accountDefaultsScrap.error || !accountDefaultsScrap.data) {
        throw new Error("Error getting account defaults");
      }

      const dimensionsScrap = await many(
        db,
        "dimension",
        {
          companyGroupId: companyRecordScrap.data.companyGroupId!,
          active: true,
          entityType: [
            "ItemPostingGroup",
            "Item",
            "Location",
            "ScrapReason",
            "WorkCenter",
            "Employee"
          ]
        },
        { columns: ["id", "entityType"] }
      );

      const dimensionMapScrap = new Map<string, string>();
      if (dimensionsScrap.data) {
        for (const dim of dimensionsScrap.data) {
          if (dim.entityType) dimensionMapScrap.set(dim.entityType, dim.id);
        }
      }

      const todayScrap = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();
      // Resolve the period BEFORE the transaction parks the (size 1) pool.
      // A Provisional journal has no accounting period.
      const accountingPeriodIdScrap =
        postingStatusScrap === "Posted"
          ? await getCurrentAccountingPeriod(companyId, db, todayScrap)
          : null;
      // An empty scrapAccount falls back to the variance account.
      const scrapAccountIdScrap = resolveDefaultAccount(
        accountDefaultsScrap.data,
        "scrapAccount",
        postingStatusScrap
      ).accountId;

      let didReplace = false;
      await db.transaction().execute(async (trx) => {
        // Re-read inside the transaction: its FOR SHARE lock holds the
        // status until commit, and the period above was resolved for it.
        await assertPostingStatusUnchanged(trx, companyId, postingStatusScrap);
        const entity = trackedEntity.data!;
        const material = jobMaterial.data!;
        const quantity = Number(entity.quantity);

        const job = await trx
          .selectFrom("job")
          .select(["id", "jobId", "locationId", "itemId"])
          .where("id", "=", material.jobId!)
          .executeTakeFirst();

        const item = await trx
          .selectFrom("item")
          .where("id", "=", material.itemId!)
          .select(["readableIdWithRevision"])
          .executeTakeFirst();

        // Scrap genealogy (was: Consume + attributes.Scrapped). The entity
        // keeps its full input tree; status is the terminal marker.
        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: "Scrap",
            sourceDocument: "Job Material",
            sourceDocumentId: materialId,
            sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
            attributes: {
              Job: job?.id!,
              "Job Make Method": material.jobMakeMethodId!,
              "Job Material": material.id!,
              "Scrap Reason": scrapReasonId,
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: activityId,
            trackedEntityId,
            quantity,
            companyId,
            createdBy: userId
          })
          .execute();

        if (parentTrackedEntityId) {
          await trx
            .insertInto("trackedActivityOutput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: parentTrackedEntityId,
              quantity,
              companyId,
              createdBy: userId
            })
            .execute();
        }

        await trx
          .updateTable("trackedEntity")
          .set({
            status: "Scrapped"
          })
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();

        const consumedItemId = entity.sourceDocumentId ?? material.itemId!;
        const [itemRow, itemCostRow] = await Promise.all([
          trx
            .selectFrom("item")
            .select(["itemTrackingType", "replenishmentSystem"])
            .where("id", "=", consumedItemId)
            .executeTakeFirst(),
          trx
            .selectFrom("itemCost")
            .select([
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ])
            .where("itemId", "=", consumedItemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        ]);
        // A missing itemCost must not fail the scrap — fall back to zero
        // cost (no journal value) so the physical/traceability scrap still
        // records; accounting can be reconciled later.
        const resolvedItemCost = {
          costingMethod: itemCostRow?.costingMethod ?? "Average",
          unitCost: Number(itemCostRow?.unitCost ?? 0),
          standardCost: Number(itemCostRow?.standardCost ?? 0),
          itemPostingGroupId: itemCostRow?.itemPostingGroupId ?? null
        };

        // Entity STATE drives the accounting side, not methodType:
        //  - Available (picked / in stock) → scrap FROM STOCK (Cr inventory)
        //  - Consumed (already issued into the parent) → relieve WIP (Cr WIP)
        const isConsumed = entity.status === "Consumed";

        const scrapWorkCenterId = material.jobOperationId
          ? ((
              await trx
                .selectFrom("jobOperation")
                .select(["workCenterId"])
                .where("id", "=", material.jobOperationId)
                .executeTakeFirst()
            )?.workCenterId ?? null)
          : null;
        const scrapExtraDimensions = [
          { entityType: "ScrapReason", valueId: scrapReasonId },
          ...(scrapWorkCenterId
            ? [{ entityType: "WorkCenter", valueId: scrapWorkCenterId }]
            : []),
          { entityType: "Employee", valueId: userId }
        ];

        if (!isConsumed) {
          // AVAILABLE → scrap from stock (Dr scrapAccount / Cr inventory via
          // the shared adjustment core) at the entity's actual on-hand bin.
          // quantityIssued is untouched — it was never consumed.
          const ledgerRows = await trx
            .selectFrom("itemLedger")
            .select(["trackedEntityId", "storageUnitId", "quantity"])
            .where("trackedEntityId", "=", trackedEntityId)
            .execute();
          const bin = resolveTrackedEntityBin(ledgerRows, trackedEntityId);

          await bookAdjustment(trx, {
            ledger: {
              postingDate: todayScrap,
              itemId: consumedItemId,
              quantity: -Math.abs(quantity),
              locationId: job?.locationId ?? null,
              storageUnitId: bin,
              trackedEntityId,
              entryType: "Negative Adjmt.",
              documentType: "Scrap",
              documentId: job?.id ?? null,
              scrapReasonId,
              companyId,
              createdBy: userId
            },
            item: {
              itemTrackingType: itemRow?.itemTrackingType ?? null,
              replenishmentSystem: itemRow?.replenishmentSystem ?? null,
              itemPostingGroupId: resolvedItemCost.itemPostingGroupId
            },
            itemCost: {
              costingMethod: resolvedItemCost.costingMethod,
              unitCost: resolvedItemCost.unitCost,
              standardCost: resolvedItemCost.standardCost
            },
            accounting: {
              postingStatus: postingStatusScrap,
              accountingPeriodId: accountingPeriodIdScrap,
              accountDefaults: {
                rawMaterialsAccount:
                  accountDefaultsScrap.data.rawMaterialsAccount,
                finishedGoodsAccount:
                  accountDefaultsScrap.data.finishedGoodsAccount,
                inventoryAdjustmentVarianceAccount:
                  accountDefaultsScrap.data.inventoryAdjustmentVarianceAccount
              },
              offsetAccount: scrapAccountIdScrap,
              offsetDescription: "Scrap Account",
              description: `Scrap — ${item?.readableIdWithRevision ?? ""}`,
              userId,
              dimensions: Object.fromEntries(dimensionMapScrap),
              extraDimensions: scrapExtraDimensions
            }
          });
        } else {
          // CONSUMED → the material cost was moved into WIP at consumption.
          // Relieve it to scrap (Dr scrapAccount / Cr WIP at the item's unit
          // cost — materials-only, spec decision 6) and reopen the material
          // requirement so a replacement can be issued.
          const scrapCost = resolvedItemCost.unitCost * quantity;
          if (scrapCost > 0) {
            const journalEntryId = await sequence.getNextSequence(
              trx,
              "journalEntry",
              companyId
            );
            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId: accountingPeriodIdScrap,
                description: `Scrap — ${item?.readableIdWithRevision ?? ""}`,
                postingDate: todayScrap,
                companyId,
                sourceType: "Job Consumption",
                status: postingStatusScrap,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const journalLineReference = nanoid();
            const journalLineResults = await trx
              .insertInto("journalLine")
              .values([
                {
                  journalId: journalResult.id,
                  accountId: scrapAccountIdScrap,
                  description: "Scrap Account",
                  amount: debit("expense", scrapCost),
                  quantity,
                  documentType: "Scrap",
                  documentId: job?.id ?? null,
                  documentLineReference: `scrapTrackedEntity:${materialId}`,
                  journalLineReference,
                  companyId
                },
                {
                  journalId: journalResult.id,
                  accountId: accountDefaultsScrap.data.workInProgressAccount,
                  description: "WIP Account",
                  amount: credit("asset", scrapCost),
                  quantity,
                  documentType: "Scrap",
                  documentId: job?.id ?? null,
                  documentLineReference: `scrapTrackedEntity:${materialId}`,
                  journalLineReference,
                  companyId
                }
              ])
              .returning(["id"])
              .execute();

            const scrapDimensionValues: Array<[string, string | null]> = [
              ["Item", consumedItemId],
              ["ItemPostingGroup", resolvedItemCost.itemPostingGroupId],
              ["Location", job?.locationId ?? null],
              ["ScrapReason", scrapReasonId],
              ["WorkCenter", scrapWorkCenterId],
              ["Employee", userId]
            ];
            const dimensionInserts = journalLineResults.flatMap((line) =>
              scrapDimensionValues
                .filter(
                  ([entityType, valueId]) =>
                    dimensionMapScrap.has(entityType) && valueId
                )
                .map(([entityType, valueId]) => ({
                  journalLineId: line.id,
                  dimensionId: dimensionMapScrap.get(entityType)!,
                  valueId: valueId as string,
                  companyId
                }))
            );
            if (dimensionInserts.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(dimensionInserts)
                .execute();
            }
          }

          // Reopen the requirement — the consumed part is gone, so the
          // assembly needs a replacement issued.
          const currentQuantityIssued = round(
            Number(material.quantityIssued) || 0
          );
          await trx
            .updateTable("jobMaterial")
            .set({
              quantityIssued: Math.max(
                0,
                round(currentQuantityIssued - round(quantity))
              )
            })
            .where("id", "=", materialId)
            .where("companyId", "=", companyId)
            .execute();
        }

        // Replacement flow ("made 3, scrapped 1 → make 1 more"): only a
        // Make-to-Order subassembly can be re-made in place. Reopen its
        // routing, spawn the replacement serial, and record a rework row.
        if (makeReplacement && job) {
          const subMakeMethod = await trx
            .selectFrom("jobMakeMethod")
            .select(["id", "itemId", "requiresSerialTracking"])
            .where("parentMaterialId", "=", material.id!)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (subMakeMethod) {
            didReplace = true;
            await applyScrapReplacement(trx, {
              jobMakeMethodId: subMakeMethod.id,
              jobId: job.id,
              companyId,
              userId
            });

            if (subMakeMethod.requiresSerialTracking && subMakeMethod.itemId) {
              let locationCode: string | null = null;
              let locationName: string | null = null;
              if (job.locationId) {
                const loc = await single(
                  trx,
                  "location",
                  { id: job.locationId, companyId },
                  { columns: ["code", "name"] }
                );
                locationCode = loc.data?.code ?? null;
                locationName = loc.data?.name ?? null;
              }
              const spawnSerials = await sequence.getNextSerialNumbers(trx, {
                itemId: subMakeMethod.itemId,
                companyId,
                count: 1,
                locationCode,
                locationName
              });
              await trx
                .insertInto("trackedEntity")
                .values({
                  sourceDocument: entity.sourceDocument,
                  sourceDocumentId: entity.sourceDocumentId,
                  sourceDocumentReadableId: entity.sourceDocumentReadableId,
                  quantity: 1,
                  status: "Reserved",
                  attributes: entity.attributes,
                  itemId: subMakeMethod.itemId,
                  expirationDate: entity.expirationDate ?? null,
                  readableId: spawnSerials[0] ?? null,
                  companyId,
                  createdBy: userId
                })
                .execute();
            }

            const firstSubOperation = await trx
              .selectFrom("jobOperation")
              .select(["id"])
              .where("jobMakeMethodId", "=", subMakeMethod.id)
              .orderBy("order", "asc")
              .executeTakeFirst();
            const scrapReason = await trx
              .selectFrom("scrapReason")
              .select(["name"])
              .where("id", "=", scrapReasonId)
              .where("companyId", "=", companyId)
              .executeTakeFirst();
            if (firstSubOperation && material.jobOperationId) {
              await trx
                .insertInto("rework")
                .values({
                  jobId: job.id,
                  triggeredAtJobOperationId: material.jobOperationId,
                  targetJobOperationId: firstSubOperation.id,
                  reason: scrapReason?.name ?? "Scrap",
                  quantity,
                  requestedById: userId,
                  companyId
                })
                .execute();
            }
          }
        }
      });

      // Reschedule outside the transaction when the routing was reopened.
      if (didReplace) {
        // The scrap transaction already committed; a failed reschedule is logged, not raised.
        const rescheduled = await invokePosting(
          { db, companyId, userId },
          "reschedule",
          { jobId: jobMaterial.data.jobId },
          rescheduleJob
        );
        if (rescheduled.error) {
          logger.error("Failed to trigger reschedule after scrap", {
            error: rescheduled.error
          });
        }
      }

      return {
        success: true
      };
    }
    case "trackedEntitiesToOperation": {
      const {
        materialId,
        jobOperationId,
        itemId,
        parentTrackedEntityId,
        children,
        jobOperationStepId,
        unitNumber,
        overrideExpired,
        overrideReason,
        companyId,
        userId
      } = validatedPayload;

      if (!parentTrackedEntityId) {
        throw new Error("Parent ID is required");
      }

      if (children.length === 0) {
        throw new Error("Children are required");
      }

      // Either materialId or (jobOperationId + itemId) must be provided
      if (!materialId && (!jobOperationId || !itemId)) {
        throw new Error(
          "Either materialId or both jobOperationId and itemId must be provided"
        );
      }

      // Stamped on the Consume activity and written into jobMaterialStep.
      await assertCompanyRecords(
        db,
        "jobOperationStep",
        [jobOperationStepId],
        companyId,
        "Job operation step"
      );
      const companyToday = datetime.today(
        await getCompanyTimeZone(db, companyId)
      );
      const accounting = await loadConsumeAccountingContext(db, companyId);

      const result = await db.transaction().execute(async (trx) =>
        consumeTrackedEntitiesIntoOperation(trx, {
          db,
          materialId,
          jobOperationId,
          itemId,
          parentTrackedEntityId,
          children,
          jobOperationStepId,
          unitNumber,
          overrideExpired,
          overrideReason,
          companyId,
          userId,
          companyToday,
          // Provisional before the company's accounting cutover, Posted after it.
          postingStatus: await journalPostingStatus(trx, companyId),
          ...accounting
        })
      );

      return {
        success: true,
        splitEntities: result.splitEntities,
        warning: result.warning
      };
    }
    case "trackedEntitiesToBatch": {
      const {
        batchId,
        itemId,
        children,
        overrideExpired,
        overrideReason,
        companyId,
        userId
      } = validatedPayload;

      if (children.length === 0) {
        throw new Error("Children are required");
      }

      const companyToday = datetime.today(
        await getCompanyTimeZone(db, companyId)
      );
      const accounting = await loadConsumeAccountingContext(db, companyId);

      // Resolve (and lazily create) the accounting period BEFORE the member
      // transaction opens. getCurrentAccountingPeriod reads over HTTP but
      // writes in-transaction, so two members inside ONE transaction would
      // each try to create a missing period — the second cannot see the
      // first's uncommitted insert and the unique index rolls the whole pick
      // back. Committed here, every member's read finds it. A Provisional
      // journal has no accounting period, so none is created before the
      // company's accounting cutover.
      const postingStatus = await journalPostingStatus(db, companyId);
      if (postingStatus === "Posted") {
        await getCurrentAccountingPeriod(
          companyId,
          db,
          companyToday.toString()
        );
      }

      const batchResult = await db.transaction().execute(async (trx) => {
        // Re-read inside the transaction: its FOR SHARE lock holds the
        // status until commit, and the period above was resolved for it.
        await assertPostingStatusUnchanged(trx, companyId, postingStatus);
        const batch = await trx
          .selectFrom("jobOperationBatch")
          .select(["id", "status"])
          .where("id", "=", batchId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!batch) {
          throw new NotFoundError("Batch not found");
        }
        if (batch.status === "Completed") {
          throw new Error("Batch is already completed");
        }

        const members = await trx
          .selectFrom("jobOperation")
          .select(["id", "jobId", "jobMakeMethodId"])
          .where("jobOperationBatchId", "=", batchId)
          .where("companyId", "=", companyId)
          .execute();
        if (members.length === 0) {
          throw new Error("Batch has no member operations");
        }
        const memberIds = members.map((m) => m.id);
        const memberIdSet = new Set(memberIds);
        // A member's materials are what its operation view lists: the
        // operation's make method BOM. A row linked straight to a member
        // operation stays with it; the rest belong to the member on its make
        // method (BOMs are usually not assigned per operation, and jobs built
        // from an item never carry the link).
        const memberByMakeMethod = new Map(
          members
            .filter((m) => m.jobMakeMethodId)
            .map((m) => [m.jobMakeMethodId as string, m.id])
        );

        // Lock the member material rows so a concurrent batch pick (or a
        // member-level manual issue) cannot double-allocate the remaining
        // requirement.
        const materialRows = await trx
          .selectFrom("jobMaterial")
          .select([
            "id",
            "jobOperationId",
            "jobMakeMethodId",
            "estimatedQuantity",
            "quantityIssued"
          ])
          .where("companyId", "=", companyId)
          .where("itemId", "=", itemId)
          .where((eb) =>
            eb.or([
              eb("jobOperationId", "in", memberIds),
              ...(memberByMakeMethod.size
                ? [eb("jobMakeMethodId", "in", [...memberByMakeMethod.keys()])]
                : [])
            ])
          )
          .forUpdate()
          .execute();

        const rowByOp = new Map<string, string>();
        const remainingByOp = new Map<string, number>();
        for (const row of materialRows) {
          const opId =
            row.jobOperationId && memberIdSet.has(row.jobOperationId)
              ? row.jobOperationId
              : memberByMakeMethod.get(row.jobMakeMethodId as string);
          if (!opId) continue;
          const remaining = Math.max(
            0,
            Number(row.estimatedQuantity ?? 0) - Number(row.quantityIssued ?? 0)
          );
          remainingByOp.set(opId, (remainingByOp.get(opId) ?? 0) + remaining);
          // The write target: an OPEN row for this member/item when one
          // exists, else any row (which one is arbitrary either way).
          if (!rowByOp.has(opId) || remaining > 0) {
            rowByOp.set(opId, row.id as string);
          }
        }

        // Per picked lot, split pro-rata by each member's CURRENT remaining —
        // every member links to every lot it physically drew from, and a
        // multi-lot pick converges on exact per-member BOM totals.
        const drawsByOp = new Map<
          string,
          { trackedEntityId: string; quantity: number }[]
        >();
        for (const child of children) {
          const open = members
            .map((m) => ({
              jobOperationId: m.id,
              remaining: remainingByOp.get(m.id) ?? 0
            }))
            .filter((m) => m.remaining > 0);
          const shares = splitPickAcrossMembers(open, Number(child.quantity));
          for (const share of shares) {
            if (share.quantity <= 0) continue;
            remainingByOp.set(
              share.jobOperationId,
              (remainingByOp.get(share.jobOperationId) ?? 0) - share.quantity
            );
            const draws = drawsByOp.get(share.jobOperationId) ?? [];
            draws.push({
              trackedEntityId: child.trackedEntityId,
              quantity: share.quantity
            });
            drawsByOp.set(share.jobOperationId, draws);
          }
        }

        const splitEntities: Array<{
          originalId: string;
          newId: string;
          readableId: string;
          quantity: number;
          remainingQuantity: number;
        }> = [];
        let warning: string | undefined;

        for (const member of members) {
          const draws = drawsByOp.get(member.id);
          if (!draws || draws.length === 0) continue;
          if (!member.jobMakeMethodId) {
            throw new Error(`Job operation ${member.id} has no make method`);
          }
          // The member's WIP entity — what its consumption books into (the
          // same entity the single-operation page passes as the parent).
          const parent = await trx
            .selectFrom("trackedEntity")
            .select(["id"])
            .where(
              sql`"attributes"->>'Job Make Method'`,
              "=",
              member.jobMakeMethodId
            )
            .where("companyId", "=", companyId)
            // Scrap and split children inherit the attribute, so an earlier
            // run's dead entity can be the oldest match — it must not absorb
            // this member's consumption.
            .where("status", "not in", ["Consumed", "Scrapped", "Rejected"])
            // Deterministic among tied `createdAt` (bulk-minted serials).
            .orderBy("createdAt", "asc")
            .orderBy("readableId", "asc")
            .orderBy("id", "asc")
            .executeTakeFirst();
          if (!parent) {
            throw new Error(
              `No tracked entity found for job operation ${member.id} — release the member job before picking to the batch`
            );
          }

          const memberResult = await consumeTrackedEntitiesIntoOperation(trx, {
            db,
            materialId: rowByOp.get(member.id),
            jobOperationId: member.id,
            itemId,
            parentTrackedEntityId: parent.id as string,
            children: draws,
            overrideExpired,
            overrideReason,
            companyId,
            userId,
            companyToday,
            postingStatus,
            ...accounting
          });
          splitEntities.push(...memberResult.splitEntities);
          warning = warning ?? memberResult.warning;
        }

        return { splitEntities, warning };
      });

      return {
        success: true,
        ...batchResult
      };
    }
    case "mergeTrackedEntities": {
      const { trackedEntityIds, readableId, companyId, userId } =
        validatedPayload;

      const companyToday = datetime.today(
        await getCompanyTimeZone(db, companyId)
      );

      const mergeResult = await db.transaction().execute(async (trx) => {
        const parents = await trx
          .selectFrom("trackedEntity")
          .selectAll()
          .where("id", "in", trackedEntityIds)
          .where("companyId", "=", companyId)
          .forUpdate()
          .execute();

        if (parents.length !== trackedEntityIds.length) {
          throw new NotFoundError("Tracked entities not found");
        }

        // Order by the caller's list, not the DB's row order: the builder
        // reads the FIRST parent for the merged lot's number, bin, and
        // attribute base, so an unordered read makes those non-deterministic.
        const parentById = new Map(parents.map((p) => [p.id, p]));
        const orderedParents = trackedEntityIds.map((id) => {
          const row = parentById.get(id);
          if (!row) throw new NotFoundError("Tracked entities not found");
          return row;
        });

        const parentLedgers = await trx
          .selectFrom("itemLedger")
          .select([
            "trackedEntityId",
            "storageUnitId",
            "locationId",
            "quantity",
            "createdAt"
          ])
          .where("trackedEntityId", "in", trackedEntityIds)
          .where("companyId", "=", companyId)
          .orderBy("createdAt", "desc")
          .execute();

        // The parent's on-ledger balance: what its job receipt has put into
        // stock so far. The merge only moves this — unreceived quantity
        // reaches inventory later, through the member job's own receipt.
        const receivedOf = (entityId: string) =>
          (parentLedgers as any[])
            .filter((l) => l.trackedEntityId === entityId)
            .reduce((acc, l) => acc + Number(l.quantity), 0);

        const locationOf = (entityId: string) =>
          (parentLedgers as any[]).find(
            (l) => l.trackedEntityId === entityId && l.locationId
          )?.locationId ?? null;

        const mergedId = nanoid();
        const mergeActivityId = nanoid();

        const records = buildBatchMergeRecords({
          parents: orderedParents.map((p) => ({
            id: p.id,
            readableId: p.readableId,
            quantity: Number(p.quantity),
            receivedQuantity: receivedOf(p.id),
            status: p.status as string,
            sourceDocument: p.sourceDocument,
            sourceDocumentId: p.sourceDocumentId,
            sourceDocumentReadableId: p.sourceDocumentReadableId,
            itemId: p.itemId ?? null,
            expirationDate: (p.expirationDate as string | null) ?? null,
            attributes: p.attributes as Record<string, unknown> | null,
            bin: {
              storageUnitId: resolveTrackedEntityBin(
                parentLedgers as any[],
                p.id
              ),
              locationId: locationOf(p.id)
            }
          })),
          mergedId,
          mergeActivityId,
          readableId: readableId ?? null,
          activitySourceDocument: "Tracked Entity",
          activitySourceDocumentId: mergedId,
          companyId,
          userId,
          postingDate: companyToday.toString()
        });

        await trx
          .insertInto("trackedEntity")
          .values({
            ...records.mergedEntityInsert,
            // TEXT NOT NULL columns; the builder sources them from the first
            // parent, which the schema guarantees is non-null.
            sourceDocument: records.mergedEntityInsert.sourceDocument as string,
            sourceDocumentId: records.mergedEntityInsert
              .sourceDocumentId as string,
            attributes: records.mergedEntityInsert.attributes as Json
          })
          .execute();

        await trx
          .insertInto("trackedActivity")
          .values({
            ...records.activityInsert,
            attributes: records.activityInsert.attributes as Json
          })
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values(records.activityInputInserts)
          .execute();

        await trx
          .insertInto("trackedActivityOutput")
          .values(records.activityOutputInsert)
          .execute();

        await trx
          .insertInto("itemLedger")
          .values(
            records.ledgerInserts.map((l) => ({
              ...l,
              itemId: l.itemId as string
            }))
          )
          .execute();

        for (const update of records.parentUpdates) {
          await trx
            .updateTable("trackedEntity")
            .set({ status: update.status })
            .where("id", "=", update.id)
            .where("companyId", "=", companyId)
            .execute();
        }

        return {
          trackedEntityId: mergedId,
          readableId: records.mergedEntityInsert.readableId,
          quantity: records.mergedEntityInsert.quantity
        };
      });

      return {
        success: true,
        ...mergeResult
      };
    }
    case "unconsumeTrackedEntities": {
      const { materialId, parentTrackedEntityId, children, companyId, userId } =
        validatedPayload;

      if (!parentTrackedEntityId) {
        throw new Error("Parent ID is required");
      }

      if (children.length === 0) {
        throw new Error("Children are required");
      }

      const {
        accountDefaults: accountDefaultsUnconsume,
        dimensionMap: dimensionMapUnconsume
      } = await loadConsumeAccountingContext(db, companyId);

      await db.transaction().execute(async (trx) => {
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatus = await journalPostingStatus(trx, companyId);
        const trackedEntities = await trx
          .selectFrom("trackedEntity")
          .where(
            "id",
            "in",
            children.map((child) => child.trackedEntityId)
          )
          .where("companyId", "=", companyId)
          .selectAll()
          .execute();

        const itemLedgers = await trx
          .selectFrom("itemLedger")
          .where("trackedEntityId", "in", [
            ...children.map((child) => child.trackedEntityId)
          ])
          .orderBy("createdBy", "desc")
          .selectAll()
          .execute();

        if (trackedEntities.length !== children.length) {
          throw new NotFoundError("Tracked entities not found");
        }

        if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
          throw new Error(
            "Tracked entities must be in Consumed status to unconsume"
          );
        }

        const jobMaterial = await trx
          .selectFrom("jobMaterial")
          .where("id", "=", materialId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirst();
        if (!jobMaterial) throw new NotFoundError("Job material not found");

        // Get item details
        const item = await trx
          .selectFrom("item")
          .where("id", "=", jobMaterial?.itemId!)
          .select(["readableIdWithRevision"])
          .executeTakeFirst();

        // Get job location
        const job = await trx
          .selectFrom("job")
          .select(["id", "locationId"])
          .where("id", "=", jobMaterial?.jobId!)
          .executeTakeFirst();

        // Get parent tracked entity details
        const parentTrackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", parentTrackedEntityId)
          .where("companyId", "=", companyId)
          .select([
            "id",
            "sourceDocumentId",
            "quantity",
            "attributes",
            "status"
          ])
          .executeTakeFirst();

        if (!parentTrackedEntity) {
          throw new NotFoundError("Parent tracked entity not found");
        }

        // Create tracked activity for unconsume
        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: "Unconsume",
            sourceDocument: "Job Material",
            sourceDocumentId: materialId,
            sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
            attributes: {
              Job: job?.id!,
              "Job Make Method": jobMaterial?.jobMakeMethodId!,
              "Job Material": jobMaterial?.id!,
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: activityId,
            trackedEntityId: parentTrackedEntityId,
            quantity: parentTrackedEntity.quantity,
            companyId,
            createdBy: userId
          })
          .execute();

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
          [];

        // Process each child tracked entity
        for (const child of children) {
          const trackedEntity = trackedEntities.find(
            (entity) => entity.id === child.trackedEntityId
          );
          if (!trackedEntity) {
            throw new NotFoundError("Tracked entity not found");
          }
          const { trackedEntityId, quantity } = child;
          // Update tracked entity status back to Available
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Available"
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          trackedActivityOutputs.push({
            trackedActivityId: activityId,
            trackedEntityId,
            quantity,
            companyId,
            createdBy: userId
          });

          if (jobMaterial?.methodType !== "Make to Order") {
            itemLedgerInserts.push({
              entryType: "Consumption",
              documentType: "Job Consumption",
              documentId: job?.id!,
              companyId,
              itemId: trackedEntity.sourceDocumentId,
              quantity: quantity,
              locationId: job?.locationId,
              // NOTE: unconsume path left on its original bin-selection until
              // it can be verified; the resolveTrackedEntityBin fix is scoped
              // to the consumption path (trackedEntitiesToOperation).
              storageUnitId: itemLedgers.find(
                (itemLedger) => itemLedger.trackedEntityId === trackedEntityId
              )?.storageUnitId,
              trackedEntityId,
              createdBy: userId
            });
          }
        }

        if (trackedActivityOutputs.length > 0) {
          await trx
            .insertInto("trackedActivityOutput")
            .values(trackedActivityOutputs)
            .execute();
        }

        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();

          for (const ledger of itemLedgerInserts) {
            await updatePickMethodDefaultStorageUnitIfNeeded(
              trx,
              ledger.itemId,
              ledger.locationId,
              ledger.storageUnitId,
              companyId,
              userId
            );
          }

          const returnEntries = itemLedgerInserts.map((l) => ({
            itemId: l.itemId as string,
            quantity: Number(l.quantity)
          }));

          await createMaterialWipEntries(trx, {
            consumptionLedgers: returnEntries,
            jobId: job?.id!,
            operationId: jobMaterial?.jobOperationId ?? materialId,
            description: "Unconsume Material Return",
            wipAccount: accountDefaultsUnconsume.workInProgressAccount,
            rawMaterialsAccount: accountDefaultsUnconsume.rawMaterialsAccount,
            finishedGoodsAccount: accountDefaultsUnconsume.finishedGoodsAccount,
            dimensionMap: dimensionMapUnconsume,

            jobLocationId: job?.locationId ?? null,
            db,
            companyId,
            userId,
            postingStatus
          });
        }

        const totalChildQuantity = roundedChildTotal(children);

        const currentQuantityIssued = round(
          Number(jobMaterial?.quantityIssued) || 0
        );
        const newQuantityIssued = round(
          currentQuantityIssued - totalChildQuantity
        );

        await trx
          .updateTable("jobMaterial")
          .set({
            quantityIssued: newQuantityIssued
          })
          .where("id", "=", materialId)
          .where("companyId", "=", companyId)
          .execute();
      });

      break;
    }
    case "convertEntity": {
      const { trackedEntityId, newRevision, quantity, companyId, userId } =
        validatedPayload;

      const convertedEntity = await db.transaction().execute(async (trx) => {
        const trackedEntity = await trx
          .selectFrom("trackedEntity")
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        if (!trackedEntity.sourceDocumentId) {
          throw new Error("Tracked entity has no source document");
        }

        // Get the old item revision
        const oldItem = await trx
          .selectFrom("item")
          .where("id", "=", trackedEntity.sourceDocumentId)
          .select(["id", "readableId", "revision"])
          .executeTakeFirstOrThrow();

        // Check if new revision exists, create if not
        let newItem = await trx
          .selectFrom("item")
          .where("readableId", "=", oldItem.readableId)
          .where("revision", "=", newRevision)
          .where("companyId", "=", companyId)
          .select(["id", "readableId", "revision", "readableIdWithRevision"])
          .executeTakeFirst();

        if (!newItem) {
          // Get the part/material/tool/consumable record
          const baseItem = await trx
            .selectFrom("item")
            .where("id", "=", oldItem.id)
            .selectAll()
            .executeTakeFirstOrThrow();

          // Create new item revision
          const insertedItem = await trx
            .insertInto("item")
            .values({
              readableId: oldItem.readableId,
              revision: newRevision,
              type: baseItem.type,
              active: baseItem.active,
              name: baseItem.name,
              description: baseItem.description,
              itemTrackingType: baseItem.itemTrackingType,
              replenishmentSystem: baseItem.replenishmentSystem,
              defaultMethodType: baseItem.defaultMethodType,
              unitOfMeasureCode: baseItem.unitOfMeasureCode,
              modelUploadId: baseItem.modelUploadId,
              companyId,
              createdBy: userId
            })
            .returning([
              "id",
              "readableId",
              "revision",
              "readableIdWithRevision"
            ])
            .executeTakeFirstOrThrow();

          newItem = insertedItem;

          // Create the part/material/tool/consumable record if it doesn't exist
          if (baseItem.type === "Part") {
            await trx
              .insertInto("part")
              .values({
                id: oldItem.readableId,
                companyId,
                createdBy: userId
              })
              .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
              .execute();
          }
        }

        if (oldItem.id) {
          const oldItemCost = await trx
            .selectFrom("itemCost")
            .where("itemId", "=", oldItem.id)
            .select(["unitCost"])
            .executeTakeFirst();

          // Calculate new unit cost based on quantity conversion
          // Total value = oldQuantity * oldUnitCost
          // New unit cost = Total value / newQuantity
          const oldQuantity = Number(trackedEntity.quantity);
          const oldUnitCost = Number(oldItemCost?.unitCost ?? 0);

          const totalValue = oldQuantity * oldUnitCost;
          const newUnitCost = totalValue / quantity;

          // Update new revision's cost
          if (newItem?.id) {
            await trx
              .updateTable("itemCost")
              .set({
                unitCost: newUnitCost,
                costIsAdjusted: true
              })
              .where("itemId", "=", newItem.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        // Create conversion activity
        const conversionActivityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: conversionActivityId,
            type: "Convert",
            sourceDocument: "Revision Conversion",
            attributes: {
              "Old Revision": oldItem.revision,
              "New Revision": newRevision,
              "Old Item ID": oldItem.id,
              "New Item ID": newItem.id
            },
            companyId,
            createdBy: userId
          })
          .execute();

        // Record input (old revision entity)
        if (trackedEntity.id) {
          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: conversionActivityId,
              trackedEntityId: trackedEntity.id,
              quantity: trackedEntity.quantity,
              companyId,
              createdBy: userId
            })
            .execute();
        }

        // Update tracked entity to new revision
        await trx
          .updateTable("trackedEntity")
          .set({
            sourceDocumentId: newItem.id,
            sourceDocumentReadableId: newItem.readableIdWithRevision,
            quantity: quantity
          })
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();

        // Record output (new revision entity)
        if (trackedEntity.id) {
          await trx
            .insertInto("trackedActivityOutput")
            .values({
              trackedActivityId: conversionActivityId,
              trackedEntityId: trackedEntity.id,
              quantity: quantity,
              companyId,
              createdBy: userId
            })
            .execute();
        }

        // Get the location from existing ledger entries
        const existingLedger = await trx
          .selectFrom("itemLedger")
          .where("trackedEntityId", "=", trackedEntityId)
          .select(["locationId", "storageUnitId"])
          .orderBy("createdAt", "desc")
          .executeTakeFirst();

        // Create item ledger entries
        if (oldItem.id && newItem?.id) {
          const oldQuantity = Number(trackedEntity.quantity);
          const ledgerEntries: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [
              // Remove old revision quantity
              {
                entryType: "Negative Adjmt.",
                documentType: "Batch Split",
                documentId: conversionActivityId,
                companyId,
                itemId: oldItem.id,
                quantity: -oldQuantity,
                locationId: existingLedger?.locationId,
                storageUnitId: existingLedger?.storageUnitId,
                trackedEntityId,
                createdBy: userId
              },
              // Add new revision quantity
              {
                entryType: "Positive Adjmt.",
                documentType: "Batch Split",
                documentId: conversionActivityId,
                companyId,
                itemId: newItem.id,
                quantity: quantity,
                locationId: existingLedger?.locationId,
                storageUnitId: existingLedger?.storageUnitId,
                trackedEntityId,
                createdBy: userId
              }
            ];

          await trx.insertInto("itemLedger").values(ledgerEntries).execute();
        }

        logger.info("Entity converted", {
          trackedEntityId,
          oldRevision: oldItem.revision,
          newRevision,
          oldItemId: oldItem.id,
          newItemId: newItem.id
        });

        // Get the updated readable ID with revision
        const updatedItem = await trx
          .selectFrom("item")
          .where("id", "=", newItem.id)
          .select(["readableIdWithRevision"])
          .executeTakeFirst();

        return {
          trackedEntityId,
          readableId: updatedItem?.readableIdWithRevision ?? oldItem.readableId,
          quantity: quantity
        };
      });

      return {
        success: true,
        message: "Entity converted successfully",
        convertedEntity
      };
    }
    case "maintenanceDispatchInventory": {
      const {
        maintenanceDispatchId,
        itemId,
        unitOfMeasureCode,
        quantity,
        companyId,
        userId
      } = validatedPayload;

      const postingDate = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      await db.transaction().execute(async (trx) => {
        // Get the maintenance dispatch to find the location
        const dispatch = await trx
          .selectFrom("maintenanceDispatch")
          .where("id", "=", maintenanceDispatchId)
          .where("companyId", "=", companyId)
          .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
          .executeTakeFirstOrThrow();

        const locationId = dispatch.locationId;

        // Get item details
        const item = await trx
          .selectFrom("item")
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .select(["id", "itemTrackingType"])
          .executeTakeFirstOrThrow();

        // Create the dispatch item
        const dispatchItem = await trx
          .insertInto("maintenanceDispatchItem")
          .values({
            maintenanceDispatchId,
            itemId,
            unitOfMeasureCode,
            quantity,
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        // Only create item ledger entry for non-tracked items (not Serial or Batch)
        if (
          item.itemTrackingType !== "Serial" &&
          item.itemTrackingType !== "Batch"
        ) {
          // Get storage unit with highest quantity for this item at this location
          const storageUnitId = locationId
            ? await getStorageUnitWithHighestQuantity(trx, itemId, locationId)
            : null;

          await trx
            .insertInto("itemLedger")
            .values({
              entryType: "Consumption",
              documentType: "Maintenance Consumption",
              documentId: dispatch.id,
              documentLineId: dispatchItem.id,
              companyId,
              itemId,
              quantity: -quantity,
              locationId,
              storageUnitId,
              createdBy: userId
            })
            .execute();

          await valueMaintenanceMovements(trx, {
            dispatch,
            movements: [{ itemId, quantity: -quantity }],
            postingDate,
            companyId,
            userId
          });

          // Update pickMethod defaultStorageUnitId if needed
          if (locationId) {
            await updatePickMethodDefaultStorageUnitIfNeeded(
              trx,
              itemId,
              locationId,
              storageUnitId,
              companyId,
              userId
            );
          }
        }
      });

      return {
        success: true,
        message: "Material issued successfully"
      };
    }
    case "maintenanceDispatchTrackedEntities": {
      const {
        maintenanceDispatchId,
        itemId,
        unitOfMeasureCode,
        children,
        overrideExpired,
        overrideReason,
        companyId,
        userId
      } = validatedPayload;

      if (children.length === 0) {
        throw new Error("At least one tracked entity is required");
      }

      let expiredWarning: string | undefined;
      const companyToday = datetime.today(
        await getCompanyTimeZone(db, companyId)
      );

      const splitEntities = await db.transaction().execute(async (trx) => {
        // Get the maintenance dispatch to find the location
        const dispatch = await trx
          .selectFrom("maintenanceDispatch")
          .where("id", "=", maintenanceDispatchId)
          .where("companyId", "=", companyId)
          .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
          .executeTakeFirstOrThrow();

        const locationId = dispatch.locationId;

        // The company's item: the dispatch item and every entity name it.
        const item = await trx
          .selectFrom("item")
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .select(["id", "readableIdWithRevision"])
          .executeTakeFirst();
        if (!item) {
          throw new NotFoundError("Item not found");
        }

        // Calculate total quantity from children
        const totalQuantity = children.reduce(
          (sum, child) => sum + Number(child.quantity),
          0
        );

        // Create the dispatch item
        const dispatchItem = await trx
          .insertInto("maintenanceDispatchItem")
          .values({
            maintenanceDispatchId,
            itemId,
            unitOfMeasureCode,
            quantity: totalQuantity,
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        // Get tracked entities
        const trackedEntities = await trx
          .selectFrom("trackedEntity")
          .where(
            "id",
            "in",
            children.map((child) => child.trackedEntityId)
          )
          .where("companyId", "=", companyId)
          .selectAll()
          .execute();

        // Get item ledgers for these tracked entities
        const itemLedgers = await trx
          .selectFrom("itemLedger")
          .where(
            "trackedEntityId",
            "in",
            children.map((child) => child.trackedEntityId)
          )
          .where("companyId", "=", companyId)
          .orderBy("createdAt", "desc")
          .selectAll()
          .execute();

        if (trackedEntities.length !== children.length) {
          throw new NotFoundError("Some tracked entities not found");
        }

        if (
          trackedEntities.some(
            (entity) => (entity.itemId ?? entity.sourceDocumentId) !== itemId
          )
        ) {
          throw new InvalidInputError(
            "Some tracked entities are not of the dispatched item"
          );
        }

        if (trackedEntities.some((entity) => entity.status !== "Available")) {
          throw new Error("Some tracked entities are not available");
        }

        // Expiry policy gate.
        const expiredPolicy = await getExpiredEntityPolicy(trx, companyId);
        const expiredCheck = checkExpiredEntities(
          trackedEntities.map((e) => ({
            id: e.id,
            expirationDate: e.expirationDate
          })),
          expiredPolicy,
          { allowed: !!overrideExpired, reason: overrideReason ?? null },
          companyToday
        );
        if (!expiredCheck.ok) {
          throw new Error(expiredCheck.reason);
        }
        if (expiredCheck.warning) {
          expiredWarning = expiredCheck.warning;
        }

        const maintenanceDispatchItemId = dispatchItem.id;

        // Create tracked activity
        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: "Consume",
            sourceDocument: "Maintenance Dispatch Item",
            sourceDocumentId: maintenanceDispatchItemId,
            sourceDocumentReadableId: item.readableIdWithRevision ?? "",
            attributes: {
              "Maintenance Dispatch": dispatch.maintenanceDispatchId,
              "Maintenance Dispatch Item": dispatchItem.id,
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const trackedActivityInputs: Database["public"]["Tables"]["trackedActivityInput"]["Insert"][] =
          [];
        const junctionInserts: {
          maintenanceDispatchItemId: string;
          trackedEntityId: string;
          quantity: number;
          companyId: string;
          createdBy: string;
        }[] = [];

        const splitEntities: Array<{
          originalId: string;
          newId: string;
          readableId: string;
          quantity: number;
          remainingQuantity: number;
        }> = [];

        // Process each child tracked entity
        for (const child of children) {
          const trackedEntity = trackedEntities.find(
            (entity) => entity.id === child.trackedEntityId
          );
          if (!trackedEntity) {
            throw new NotFoundError("Tracked entity not found");
          }
          const { trackedEntityId } = child;

          // Same canonical quantity as the job-consumption loop above: a
          // full draw books the lot's own rounded on-hand.
          const entityQuantity = round(Number(trackedEntity.quantity));
          const fullDraw = isFullDraw(entityQuantity, child.quantity);
          const quantity = fullDraw ? entityQuantity : round(child.quantity);

          // Book against the entity's ACTUAL bin (net on-hand), not an
          // arbitrary first ledger row — aligns with the job-consumption
          // path above.
          const entityBin = resolveTrackedEntityBin(
            itemLedgers,
            trackedEntityId
          );

          // Partial consume → split: the lineside entity keeps its id and
          // is decremented; a NEW child entity carries the consumed
          // quantity. EVERYTHING below (Consumed status, Consume input,
          // Maintenance Consumption ledger, junction row) books against
          // the child.
          let consumedEntityId = trackedEntityId;
          if (!fullDraw) {
            const consumedChildId = nanoid();
            consumedEntityId = consumedChildId;

            const split = buildBatchSplitRecords({
              parent: {
                id: trackedEntity.id!,
                readableId: trackedEntity.readableId,
                quantity: entityQuantity,
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId:
                  trackedEntity.sourceDocumentReadableId,
                itemId: trackedEntity.itemId ?? trackedEntity.sourceDocumentId,
                expirationDate: trackedEntity.expirationDate ?? null,
                attributes: trackedEntity.attributes as Record<
                  string,
                  unknown
                > | null
              },
              drawQuantity: quantity,
              childId: consumedChildId,
              splitActivityId: nanoid(),
              activitySourceDocument: "Maintenance Dispatch Item",
              activitySourceDocumentId: maintenanceDispatchItemId,
              bin: {
                storageUnitId: entityBin,
                locationId
              },
              itemLedgerItemId: trackedEntity.sourceDocumentId,
              companyId,
              userId,
              postingDate: companyToday.toString(),
              // Created Available; the shared status update below flips the
              // child to Consumed in the same transaction.
              childStatus: "Available"
            });

            splitEntities.push({
              originalId: trackedEntityId,
              newId: consumedChildId,
              readableId: trackedEntity.sourceDocumentReadableId ?? "",
              quantity,
              remainingQuantity: split.parentUpdate.quantity
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
              ...(split.ledgerInserts as ItemLedgerInsert[])
            );
          }

          // Consume the drawn entity — the split child, or the whole
          // entity on a full draw.
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Consumed"
            })
            .where("id", "=", consumedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          trackedActivityInputs.push({
            trackedActivityId: activityId,
            trackedEntityId: consumedEntityId,
            quantity,
            companyId,
            createdBy: userId
          });

          // Add junction table entry
          junctionInserts.push({
            maintenanceDispatchItemId,
            trackedEntityId: consumedEntityId,
            quantity,
            companyId,
            createdBy: userId
          });

          itemLedgerInserts.push({
            entryType: "Consumption",
            documentType: "Maintenance Consumption",
            documentId: dispatch.id,
            documentLineId: maintenanceDispatchItemId,
            companyId,
            itemId: trackedEntity.sourceDocumentId,
            quantity: -quantity,
            locationId,
            // The split child has no rows in the pre-transaction ledger
            // snapshot — it sits at the parent's resolved bin.
            storageUnitId: entityBin,
            trackedEntityId: consumedEntityId,
            createdBy: userId
          });
        }

        if (trackedActivityInputs.length > 0) {
          await trx
            .insertInto("trackedActivityInput")
            .values(trackedActivityInputs)
            .execute();
        }

        if (junctionInserts.length > 0) {
          await trx
            .insertInto("maintenanceDispatchItemTrackedEntity")
            .values(junctionInserts)
            .execute();
        }

        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();

          // Only the consumption rows carry value; batch-split legs move
          // stock between entities at the same bin.
          await valueMaintenanceMovements(trx, {
            dispatch,
            movements: itemLedgerInserts
              .filter((l) => l.documentType === "Maintenance Consumption")
              .map((l) => ({
                itemId: l.itemId,
                quantity: Number(l.quantity)
              })),
            postingDate: companyToday.toString(),
            companyId,
            userId
          });

          // Update pickMethod defaultStorageUnitId if needed
          for (const ledger of itemLedgerInserts) {
            await updatePickMethodDefaultStorageUnitIfNeeded(
              trx,
              ledger.itemId,
              ledger.locationId,
              ledger.storageUnitId,
              companyId,
              userId
            );
          }
        }

        return splitEntities;
      });

      return {
        success: true,
        message: "Material issued successfully",
        splitEntities,
        warning: expiredWarning
      };
    }
    case "maintenanceDispatchUnconsume": {
      const { maintenanceDispatchItemId, children, companyId, userId } =
        validatedPayload;

      if (children.length === 0) {
        throw new Error("At least one tracked entity is required");
      }

      const postingDate = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      await db.transaction().execute(async (trx) => {
        // Get the maintenance dispatch item with related data
        const dispatchItem = await trx
          .selectFrom("maintenanceDispatchItem")
          .where("id", "=", maintenanceDispatchItemId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        // Get the maintenance dispatch to find the location
        const dispatch = await trx
          .selectFrom("maintenanceDispatch")
          .where("id", "=", dispatchItem.maintenanceDispatchId)
          .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
          .executeTakeFirstOrThrow();

        const locationId = dispatch.locationId;

        // Get tracked entities
        const trackedEntities = await trx
          .selectFrom("trackedEntity")
          .where(
            "id",
            "in",
            children.map((child) => child.trackedEntityId)
          )
          .where("companyId", "=", companyId)
          .selectAll()
          .execute();

        // Get item ledgers for these tracked entities
        const itemLedgers = await trx
          .selectFrom("itemLedger")
          .where(
            "trackedEntityId",
            "in",
            children.map((child) => child.trackedEntityId)
          )
          .orderBy("createdAt", "desc")
          .selectAll()
          .execute();

        if (trackedEntities.length !== children.length) {
          throw new NotFoundError("Some tracked entities not found");
        }

        if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
          throw new Error("Some tracked entities are not in consumed status");
        }

        // Get item details
        const item = await trx
          .selectFrom("item")
          .where("id", "=", dispatchItem.itemId)
          .select(["id", "readableIdWithRevision"])
          .executeTakeFirstOrThrow();

        // Create tracked activity for unconsume
        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: "Unconsume",
            sourceDocument: "Maintenance Dispatch Item",
            sourceDocumentId: maintenanceDispatchItemId,
            sourceDocumentReadableId: item.readableIdWithRevision ?? "",
            attributes: {
              "Maintenance Dispatch": dispatch.maintenanceDispatchId,
              "Maintenance Dispatch Item": dispatchItem.id,
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .execute();

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
          [];

        // Process each child tracked entity
        for (const child of children) {
          const trackedEntity = trackedEntities.find(
            (entity) => entity.id === child.trackedEntityId
          );
          if (!trackedEntity) {
            throw new NotFoundError("Tracked entity not found");
          }
          const { trackedEntityId, quantity } = child;

          // Update tracked entity status back to Available
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Available"
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          trackedActivityOutputs.push({
            trackedActivityId: activityId,
            trackedEntityId,
            quantity,
            companyId,
            createdBy: userId
          });

          // Remove from junction table
          await trx
            .deleteFrom("maintenanceDispatchItemTrackedEntity")
            .where("maintenanceDispatchItemId", "=", maintenanceDispatchItemId)
            .where("trackedEntityId", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          // Create reverse item ledger entry (positive to return to inventory)
          const existingLedger = itemLedgers.find(
            (l) => l.trackedEntityId === trackedEntityId
          );

          itemLedgerInserts.push({
            entryType: "Consumption",
            documentType: "Maintenance Consumption",
            documentId: dispatch.id,
            documentLineId: maintenanceDispatchItemId,
            companyId,
            itemId: trackedEntity.sourceDocumentId,
            quantity: quantity, // Positive to return to inventory
            locationId,
            storageUnitId: existingLedger?.storageUnitId,
            trackedEntityId,
            createdBy: userId
          });
        }

        if (trackedActivityOutputs.length > 0) {
          await trx
            .insertInto("trackedActivityOutput")
            .values(trackedActivityOutputs)
            .execute();
        }

        if (itemLedgerInserts.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(itemLedgerInserts)
            .execute();

          await valueMaintenanceMovements(trx, {
            dispatch,
            movements: itemLedgerInserts.map((l) => ({
              itemId: l.itemId,
              quantity: Number(l.quantity)
            })),
            postingDate,
            companyId,
            userId
          });

          // Update pickMethod defaultStorageUnitId if needed
          for (const ledger of itemLedgerInserts) {
            await updatePickMethodDefaultStorageUnitIfNeeded(
              trx,
              ledger.itemId,
              ledger.locationId,
              ledger.storageUnitId,
              companyId,
              userId
            );
          }
        }

        // Update the dispatch item quantity
        const totalChildQuantity = roundedChildTotal(children);

        const currentQuantity = round(Number(dispatchItem.quantity) || 0);
        const newQuantity = Math.max(
          0,
          round(currentQuantity - totalChildQuantity)
        );

        await trx
          .updateTable("maintenanceDispatchItem")
          .set({
            quantity: newQuantity,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", maintenanceDispatchItemId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return {
        success: true,
        message: "Material unconsumed successfully"
      };
    }
    case "maintenanceDispatchUnissue": {
      const { maintenanceDispatchItemId, companyId, userId } = validatedPayload;

      const postingDate = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      await db.transaction().execute(async (trx) => {
        // Get the maintenance dispatch item
        const dispatchItem = await trx
          .selectFrom("maintenanceDispatchItem")
          .where("id", "=", maintenanceDispatchItemId)
          .where("companyId", "=", companyId)
          .selectAll()
          .executeTakeFirstOrThrow();

        // Get the maintenance dispatch to find the location
        const dispatch = await trx
          .selectFrom("maintenanceDispatch")
          .where("id", "=", dispatchItem.maintenanceDispatchId)
          .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
          .executeTakeFirstOrThrow();

        const locationId = dispatch.locationId;

        // Get item details
        const item = await trx
          .selectFrom("item")
          .where("id", "=", dispatchItem.itemId)
          .select(["id", "itemTrackingType", "readableIdWithRevision"])
          .executeTakeFirstOrThrow();

        // Check if this has tracked entities
        const trackedEntityJunctions = await trx
          .selectFrom("maintenanceDispatchItemTrackedEntity")
          .where("maintenanceDispatchItemId", "=", maintenanceDispatchItemId)
          .selectAll()
          .execute();

        if (trackedEntityJunctions.length > 0) {
          // Handle tracked entities - unconsume them
          const trackedEntityIds = trackedEntityJunctions.map(
            (j) => j.trackedEntityId
          );

          // Get tracked entities
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where("id", "in", trackedEntityIds)
            .selectAll()
            .execute();

          // Get item ledgers for these tracked entities
          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "in", trackedEntityIds)
            .orderBy("createdAt", "desc")
            .selectAll()
            .execute();

          // Create tracked activity for unconsume
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Unconsume",
              sourceDocument: "Maintenance Dispatch Item",
              sourceDocumentId: maintenanceDispatchItemId,
              sourceDocumentReadableId: item.readableIdWithRevision ?? "",
              attributes: {
                "Maintenance Dispatch": dispatch.maintenanceDispatchId,
                "Maintenance Dispatch Item": dispatchItem.id,
                Employee: userId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
            [];

          // Process each tracked entity
          for (const junction of trackedEntityJunctions) {
            const trackedEntity = trackedEntities.find(
              (e) => e.id === junction.trackedEntityId
            );
            if (!trackedEntity) continue;

            const quantity = Number(junction.quantity);

            // Update tracked entity status back to Available
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Available" })
              .where("id", "=", junction.trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();

            trackedActivityOutputs.push({
              trackedActivityId: activityId,
              trackedEntityId: junction.trackedEntityId,
              quantity,
              companyId,
              createdBy: userId
            });

            // Create reverse item ledger entry (positive to return to inventory)
            const existingLedger = itemLedgers.find(
              (l) => l.trackedEntityId === junction.trackedEntityId
            );

            itemLedgerInserts.push({
              entryType: "Consumption",
              documentType: "Maintenance Consumption",
              documentId: dispatch.id,
              documentLineId: maintenanceDispatchItemId,
              companyId,
              itemId: trackedEntity.sourceDocumentId,
              quantity: quantity, // Positive to return to inventory
              locationId,
              storageUnitId: existingLedger?.storageUnitId,
              trackedEntityId: junction.trackedEntityId,
              createdBy: userId
            });
          }

          // Delete junction entries
          await trx
            .deleteFrom("maintenanceDispatchItemTrackedEntity")
            .where("maintenanceDispatchItemId", "=", maintenanceDispatchItemId)
            .where("companyId", "=", companyId)
            .execute();

          if (trackedActivityOutputs.length > 0) {
            await trx
              .insertInto("trackedActivityOutput")
              .values(trackedActivityOutputs)
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();

            await valueMaintenanceMovements(trx, {
              dispatch,
              movements: itemLedgerInserts.map((l) => ({
                itemId: l.itemId,
                quantity: Number(l.quantity)
              })),
              postingDate,
              companyId,
              userId
            });
          }
        } else if (
          item.itemTrackingType !== "Serial" &&
          item.itemTrackingType !== "Batch"
        ) {
          // Handle inventory items - create positive ledger entry to return to inventory
          const quantity = Number(dispatchItem.quantity);

          if (quantity > 0) {
            // Find the storage unit from the original consumption ledger entry
            const originalLedger = await trx
              .selectFrom("itemLedger")
              .where("documentLineId", "=", maintenanceDispatchItemId)
              .where("documentType", "=", "Maintenance Consumption")
              .orderBy("createdAt", "desc")
              .selectAll()
              .executeTakeFirst();

            await trx
              .insertInto("itemLedger")
              .values({
                entryType: "Consumption",
                documentType: "Maintenance Consumption",
                documentId: dispatch.id,
                documentLineId: maintenanceDispatchItemId,
                companyId,
                itemId: dispatchItem.itemId,
                quantity: quantity, // Positive to return to inventory
                locationId,
                storageUnitId: originalLedger?.storageUnitId,
                createdBy: userId
              })
              .execute();

            await valueMaintenanceMovements(trx, {
              dispatch,
              movements: [{ itemId: dispatchItem.itemId, quantity }],
              postingDate,
              companyId,
              userId
            });
          }
        }

        // Delete the dispatch item
        await trx
          .deleteFrom("maintenanceDispatchItem")
          .where("id", "=", maintenanceDispatchItemId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return {
        success: true,
        message: "Item unissued and removed successfully"
      };
    }
  }

  return {
    success: true,
    message: "x"
  };
}
