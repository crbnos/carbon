// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The building blocks of field service: reads and simple writes of customer
// assets, their components and history, service orders, visits and billable
// items; the postings `complete-service-order` and
// `create-service-order-invoice`; and the transactional writes (create an
// order, register an asset, roll an order's status up, charge it). The
// operations that run them are in `service.server.ts`.

import {
  isDataLayerError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import type {
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone, journalReference } from "@carbon/database";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { inOrder, maybeSingle, rpcValue } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import { credit, datetime, debit, openChargeIds, round } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  allocateJournalLineIds,
  createAdjustmentJournal,
  invokePosting,
  resolveAccountingPeriod,
  resolveInventoryAccount
} from "~/modules/shared/shared.service";
import { path } from "~/utils/path";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import {
  BUILD_FROM_PART_MAX_DEPTH,
  type buildFromPartValidator
} from "../projects/projects.models";
import {
  type BuildFromPartArgs,
  createTimesheetCorrection,
  insertElementsFromPart,
  postProjectExpense,
  postTimesheetEntries,
  reclassProjectCoverage
} from "../projects/projects.service";
import {
  loadRefurbishmentCompletion,
  type RefurbishmentCompletionContext
} from "./refurbishment-completion-load";
import {
  planRefurbishmentCompletion,
  type RefurbishmentAccount,
  RefurbishmentCompletionError,
  type RefurbishmentCompletionPlan
} from "./refurbishment-completion-plan";
import type {
  coverageOverrideValidator,
  customerAssetUpdateValidator,
  customerAssetValidator,
  ServiceOrderStatus,
  ServicePlanTable,
  ServiceVisitStatus,
  serviceBillableItemValidator,
  serviceChargeReversalValidator,
  serviceExpenseValidator,
  serviceOrderUpdateValidator,
  serviceOrderValidator,
  serviceTemplateValidator,
  serviceVisitValidator,
  WarrantyStatus
} from "./service.models";
import {
  buildExpenseReversal,
  canMoveVisit,
  canReverseCharge,
  closedServiceOrderStatuses,
  rollUpOrderStatus,
  serviceTemplateIdentifier
} from "./service.models";
import { planServiceInvoiceLines } from "./service-invoice-plan";
import { insertServiceOrder } from "./service-orders";
import type { RefurbishmentCompletionPreview } from "./types";

type Client = SupabaseClient<Database>;

/** A refusal in the `{ data, error }` shape the routes already read. */
function refusal(message: string) {
  return {
    data: null,
    error: { message } as unknown as PostgrestError
  };
}

const CLOSED_ORDER_FILTER = `(${closedServiceOrderStatuses
  .map((status) => `"${status}"`)
  .join(",")})`;

// --- Customer assets ---------------------------------------------------------

const CUSTOMER_ASSET_COLUMNS =
  "id, trackedEntityId, itemId, customerId, customerLocationId, status, shippedDate, laborWarrantyEndDate, partsWarrantyEndDate, shipmentId, source, notes, createdAt, updatedAt, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey!inner(id, readableId), item:item!customerAsset_itemId_fkey(id, readableIdWithRevision, name), customer:customer!customerAsset_customerId_fkey(id, name), customerLocation:customerLocation!customerAsset_customerLocationId_fkey(id, name), openOrders:serviceOrder!serviceOrder_asset_fkey(count)" as const;

/**
 * Lists the company's customer assets. Filters: customer, item, the
 * warranty status on `today` (the company's day, `YYYY-MM-DD`) and a serial
 * search. `openOrders` counts the asset's orders that are not Closed or
 * Cancelled.
 */
export async function getCustomerAssets(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    customerId?: string | null;
    itemId?: string | null;
    warrantyStatus?: WarrantyStatus | null;
    today: string;
  }
) {
  let query = client
    .from("customerAsset")
    .select(CUSTOMER_ASSET_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId)
    .not("openOrders.status", "in", CLOSED_ORDER_FILTER);

  if (args.search) {
    query = query.ilike("trackedEntity.readableId", `%${args.search}%`);
  }
  if (args.customerId) query = query.eq("customerId", args.customerId);
  if (args.itemId) query = query.eq("itemId", args.itemId);

  const today = args.today;
  switch (args.warrantyStatus) {
    case "In warranty":
      query = query.gte("laborWarrantyEndDate", today);
      break;
    case "Labor ended":
      query = query
        .or(`laborWarrantyEndDate.is.null,laborWarrantyEndDate.lt.${today}`)
        .gte("partsWarrantyEndDate", today);
      break;
    case "Expired":
      query = query.or(
        `and(or(laborWarrantyEndDate.is.null,laborWarrantyEndDate.lt.${today}),or(partsWarrantyEndDate.is.null,partsWarrantyEndDate.lt.${today}))`
      );
      break;
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

/** One customer asset with its serial, item, customer, site and shipment. */
export async function getCustomerAsset(
  client: Client,
  customerAssetId: string,
  companyId: string
) {
  return client
    .from("customerAsset")
    .select(
      `${CUSTOMER_ASSET_COLUMNS}, shipment:shipment!customerAsset_shipmentId_fkey(id, shipmentId)`
    )
    .eq("id", customerAssetId)
    .eq("companyId", companyId)
    .not("openOrders.status", "in", CLOSED_ORDER_FILTER)
    .single();
}

/**
 * Saves the fields a service manager edits on an asset: the site, the two
 * warranty end dates and the notes. A unit is registered with
 * `registerCustomerAsset` (`service.server.ts`); shipments create the rest.
 */
export async function upsertCustomerAsset(
  client: Client,
  asset: z.infer<typeof customerAssetUpdateValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("customerAsset")
    .update({
      customerLocationId: asset.customerLocationId ?? null,
      laborWarrantyEndDate: asset.laborWarrantyEndDate ?? null,
      partsWarrantyEndDate: asset.partsWarrantyEndDate ?? null,
      ...(asset.notes !== undefined ? { notes: asset.notes as Json } : {}),
      updatedBy: asset.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", asset.id)
    .eq("companyId", asset.companyId)
    .select("id")
    .single();
}

/** Saves an asset's notes, from the autosaved editor on its page. */
export async function updateCustomerAssetNotes(
  client: Client,
  asset: { id: string; notes: Json; companyId: string; updatedBy: string }
) {
  return client
    .from("customerAsset")
    .update({
      notes: asset.notes,
      updatedBy: asset.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", asset.id)
    .eq("companyId", asset.companyId)
    .select("id")
    .single();
}

/** The parts installed in an asset, current first, then the removed ones. */
export async function getCustomerAssetComponents(
  client: Client,
  customerAssetId: string,
  companyId: string
) {
  return client
    .from("customerAssetComponent")
    .select(
      "id, itemId, trackedEntityId, quantity, installedDate, partsWarrantyEndDate, removedDate, serviceOrderId, removedByServiceOrderId, projectElementId, item:item!customerAssetComponent_itemId_fkey(id, readableIdWithRevision, name), trackedEntity:trackedEntity!customerAssetComponent_trackedEntityId_fkey(id, readableId), serviceOrder:serviceOrder!customerAssetComponent_order_fkey(id, serviceOrderId)"
    )
    .eq("customerAssetId", customerAssetId)
    .eq("companyId", companyId)
    .order("removedDate", { ascending: false, nullsFirst: true })
    .order("installedDate", { ascending: false });
}

export type ComponentHistoryRow = {
  /** The node's serial, else its item, else its name. */
  key: string;
  trackedEntityId: string | null;
  itemId: string | null;
  /** The serial ("TR-200"), or null when the nodes link only an item. */
  serial: string | null;
  /** The item's readable id and name, else the node's name. */
  name: string;
  hours: number;
  partCost: number;
  cost: number;
  orderCount: number;
  lastPostingDate: string | null;
};

/**
 * The service history of an asset by component, across its orders: one
 * query over the ledger rows of its orders' work trees, grouped by the
 * node's linked serial, else its linked item, else its name. Hours are the
 * Labor quantities, part cost the Material amounts, cost every amount. A
 * reversal's negative row nets its original out.
 */
export async function getCustomerAssetHistoryByComponent(
  client: Client,
  customerAssetId: string,
  companyId: string
): Promise<{
  data: ComponentHistoryRow[] | null;
  error: PostgrestError | null;
}> {
  const ledger = await client
    .from("projectLedger")
    .select(
      "costType, quantity, amount, postingDate, projectId, element:projectElement!projectLedger_element_fkey!inner(id, name, itemId, trackedEntityId, item:item!projectElement_item_fkey(readableIdWithRevision, name), trackedEntity:trackedEntity!projectElement_trackedEntityId_fkey(readableId)), project:project!projectLedger_project_fkey!inner(serviceOrder:serviceOrder!serviceOrder_project_fkey!inner(customerAssetId))"
    )
    .eq("companyId", companyId)
    .eq("project.serviceOrder.customerAssetId", customerAssetId);
  if (ledger.error) return { data: null, error: ledger.error };

  const rows = new Map<string, ComponentHistoryRow & { orders: Set<string> }>();
  for (const entry of ledger.data ?? []) {
    const element = entry.element;
    if (!element) continue;
    const key = element.trackedEntityId
      ? `serial:${element.trackedEntityId}`
      : element.itemId
        ? `item:${element.itemId}`
        : `name:${element.name}`;
    let row = rows.get(key);
    if (!row) {
      const itemName = element.item
        ? [element.item.readableIdWithRevision, element.item.name]
            .filter(Boolean)
            .join(" ")
        : "";
      row = {
        key,
        trackedEntityId: element.trackedEntityId,
        itemId: element.itemId,
        serial: element.trackedEntity?.readableId ?? null,
        name: itemName || element.name,
        hours: 0,
        partCost: 0,
        cost: 0,
        orderCount: 0,
        lastPostingDate: null,
        orders: new Set()
      };
      rows.set(key, row);
    }
    const amount = Number(entry.amount);
    if (entry.costType === "Labor") row.hours += Number(entry.quantity ?? 0);
    if (entry.costType === "Material") row.partCost += amount;
    row.cost += amount;
    row.orders.add(entry.projectId);
    if (!row.lastPostingDate || entry.postingDate > row.lastPostingDate) {
      row.lastPostingDate = entry.postingDate;
    }
  }

  return {
    data: [...rows.values()]
      .map(({ orders, ...row }) => ({
        ...row,
        hours: round(row.hours),
        partCost: round(row.partCost),
        cost: round(row.cost),
        orderCount: orders.size
      }))
      .sort((a, b) =>
        (b.lastPostingDate ?? "").localeCompare(a.lastPostingDate ?? "")
      ),
    error: null
  };
}

// --- Service orders ----------------------------------------------------------

const SERVICE_ORDER_LIST_COLUMNS =
  "id, serviceOrderId, type, status, priority, trackedEntityId, itemId, customerAssetId, customerId, customerLocationId, customerContractId, locationId, projectId, assignee, completedAt, createdAt, updatedAt, trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(id, readableId), item:item!serviceOrder_itemId_fkey(id, readableIdWithRevision, name), customer:customer!serviceOrder_customerId_fkey(id, name), customerLocation:customerLocation!serviceOrder_customerLocationId_fkey(id, name), customerContract:customerContract!serviceOrder_contract_fkey(id, customerContractId, name), visits:serviceVisit!serviceVisit_order_fkey(id, status, technicianId, plannedStart)";

/**
 * Lists the company's service orders. Filters: status, a technician with a
 * visit on the order, customer, asset, and a search on the order id.
 */
export async function getServiceOrders(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status?: ServiceOrderStatus[] | null;
    technicianId?: string | null;
    customerId?: string | null;
    customerAssetId?: string | null;
  }
) {
  const columns = args.technicianId
    ? `${SERVICE_ORDER_LIST_COLUMNS}, technicianVisits:serviceVisit!serviceVisit_order_fkey!inner(technicianId)`
    : SERVICE_ORDER_LIST_COLUMNS;

  let query = client
    .from("serviceOrder")
    // The technician filter adds an inner-joined embed; the row type stays
    // the list columns, which is all the list reads.
    .select(columns as typeof SERVICE_ORDER_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("serviceOrderId", `%${args.search}%`);
  }
  if (args.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }
  if (args.technicianId) {
    query = query.eq("technicianVisits.technicianId", args.technicianId);
  }
  if (args.customerId) query = query.eq("customerId", args.customerId);
  if (args.customerAssetId) {
    query = query.eq("customerAssetId", args.customerAssetId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "serviceOrderId", ascending: false }
  ]);
  return query;
}

/**
 * One service order with its subject asset, item, customer, site, contact
 * and coverage contract.
 */
export async function getServiceOrder(
  client: Client,
  serviceOrderId: string,
  companyId: string
) {
  return client
    .from("serviceOrder")
    .select(
      "*, trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(id, readableId), item:item!serviceOrder_itemId_fkey(id, readableIdWithRevision, name), customerAsset:customerAsset!serviceOrder_asset_fkey(id, status, shippedDate, laborWarrantyEndDate, partsWarrantyEndDate), customer:customer!serviceOrder_customerId_fkey(id, name), customerLocation:customerLocation!serviceOrder_customerLocationId_fkey(id, name), customerContact:customerContact!serviceOrder_customerContactId_fkey(id), customerContract:customerContract!serviceOrder_contract_fkey(id, customerContractId, name, status, projectId), location:location!serviceOrder_locationId_fkey(id, name), project:project!serviceOrder_project_fkey(id, identifier, name, status), salesReturnOrderLine:salesReturnOrderLine!serviceOrder_rmaLine_fkey(id, salesReturnOrder:salesReturnOrder!salesReturnOrderLine_salesReturnOrderId_fkey(id, salesReturnOrderId))"
    )
    .eq("id", serviceOrderId)
    .eq("companyId", companyId)
    .single();
}

/**
 * The Depot Repair orders of an RMA, one per serial its Repair lines brought
 * in, with their unit's status. A unit ships back once its order is Completed
 * (or Closed) and it is still At Depot.
 */
export async function getDepotRepairOrdersByReturnOrder(
  client: Client,
  salesReturnOrderId: string,
  companyId: string
) {
  return client
    .from("serviceOrder")
    .select(
      "id, serviceOrderId, status, salesReturnOrderLineId, trackedEntityId, customerAsset:customerAsset!serviceOrder_asset_fkey(status), salesReturnOrderLine:salesReturnOrderLine!serviceOrder_rmaLine_fkey!inner(salesReturnOrderId)"
    )
    .eq("type", "Depot Repair")
    .eq("companyId", companyId)
    .eq("salesReturnOrderLine.salesReturnOrderId", salesReturnOrderId)
    .order("serviceOrderId");
}

/**
 * What the new order form offers: the In Service customer assets (the only
 * subjects a field visit takes), the Active service contracts of their
 * customers (a project contract never covers an order), and the service
 * templates. The asset list stops at the
 * PostgREST page (1000 rows).
 */
export async function getServiceOrderFormOptions(
  client: Client,
  companyId: string
) {
  const [assets, contracts, templates] = await Promise.all([
    client
      .from("customerAsset")
      .select(
        "id, customerId, customerLocationId, laborWarrantyEndDate, partsWarrantyEndDate, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey!inner(readableId), item:item!customerAsset_itemId_fkey(readableIdWithRevision, name), customer:customer!customerAsset_customerId_fkey(name)"
      )
      .eq("companyId", companyId)
      .eq("status", "In Service")
      .order("createdAt", { ascending: false }),
    client
      .from("customerContract")
      .select("id, customerContractId, name, customerId")
      .eq("companyId", companyId)
      .eq("status", "Active")
      .eq("billingBasis", "Schedule")
      .order("customerContractId"),
    client
      .from("project")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("projectType", "Service")
      .eq("isTemplate", true)
      .order("name")
  ]);

  return {
    assets: assets.data ?? [],
    contracts: contracts.data ?? [],
    templates: templates.data ?? [],
    error: assets.error ?? contracts.error ?? templates.error
  };
}

/**
 * The service orders a customer contract covers (`customerContractId`), newest
 * first: status, subject serial, site and dates. The contract page lists them.
 */
export async function getContractServiceOrders(
  client: Client,
  customerContractId: string,
  companyId: string
) {
  return client
    .from("serviceOrder")
    .select(
      "id, serviceOrderId, type, status, projectId, customerAssetId, createdAt, completedAt, trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(readableId), customerLocation:customerLocation!serviceOrder_customerLocationId_fkey(name), visits:serviceVisit!serviceVisit_order_fkey(status, plannedStart)"
    )
    .eq("customerContractId", customerContractId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

/**
 * The posted cost of each order's work, keyed by project id: the sum of its
 * project's ledger amounts (a reversal nets its original out). One query
 * for every project.
 */
export async function getServiceOrderCosts(
  client: Client,
  projectIds: string[],
  companyId: string
): Promise<{
  data: Record<string, number> | null;
  error: PostgrestError | null;
}> {
  if (projectIds.length === 0) return { data: {}, error: null };
  const ledger = await client
    .from("projectLedger")
    .select("projectId, amount")
    .eq("companyId", companyId)
    .in("projectId", projectIds);
  if (ledger.error) return { data: null, error: ledger.error };

  const costs: Record<string, number> = {};
  for (const row of ledger.data ?? []) {
    costs[row.projectId] = (costs[row.projectId] ?? 0) + Number(row.amount);
  }
  for (const projectId of Object.keys(costs)) {
    costs[projectId] = round(costs[projectId]!);
  }
  return { data: costs, error: null };
}

/** The fields of an order that change only while it is Draft or Planned. */
const DRAFT_ONLY_FIELDS = ["customerContactId", "customerLocationId"] as const;

/** The fields only a Refurbishment has; they decide its completion. */
const REFURBISHMENT_FIELDS = [
  "expectedSellingPrice",
  "abnormalRework"
] as const;

/**
 * Saves an order's fields. Contact and site change only while the order is
 * Draft. The coverage contract never changes here: it also moves the Service
 * project's parent (`updateServiceOrderCoverageContract`). Priority, assignee,
 * invoice detail, problem and resolution change until it is Closed or
 * Cancelled. The expected selling
 * price and abnormal rework belong to a Refurbishment and change until it is
 * completed: after that its cost is in the serial.
 */
export async function updateServiceOrder(
  client: Client,
  order: z.infer<typeof serviceOrderUpdateValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  const current = await client
    .from("serviceOrder")
    .select("status, type")
    .eq("id", order.id)
    .eq("companyId", order.companyId)
    .single();
  if (current.error) return { data: null, error: current.error };
  if (
    (closedServiceOrderStatuses as readonly string[]).includes(
      current.data.status
    )
  ) {
    return refusal("A closed or cancelled service order cannot change");
  }

  const { id, companyId, updatedBy, abnormalRework, ...fields } = order;
  const changes: Record<string, unknown> = { ...fields };
  delete changes.customerContractId;
  if (abnormalRework !== undefined) {
    changes.abnormalRework = abnormalRework === "true";
  }
  if (current.data.status !== "Draft" && current.data.status !== "Planned") {
    for (const field of DRAFT_ONLY_FIELDS) delete changes[field];
  }
  if (REFURBISHMENT_FIELDS.some((field) => field in changes)) {
    if (current.data.type !== "Refurbishment") {
      return refusal("Only a refurbishment has this field");
    }
    if (current.data.status === "Completed") {
      return refusal(
        "A completed refurbishment cannot change: its cost is already in the serial"
      );
    }
  }

  return client
    .from("serviceOrder")
    .update({
      ...sanitize(changes),
      updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

// --- Visits ------------------------------------------------------------------

/**
 * Lists visits, with their order, customer, site and subject. Filters: an
 * order, a technician, a planned-start window (`from` inclusive, `to` exclusive;
 * timestamps) and statuses.
 */
export async function getServiceVisits(
  client: Client,
  companyId: string,
  args: {
    serviceOrderId?: string | null;
    technicianId?: string | null;
    from?: string | null;
    to?: string | null;
    status?: ServiceVisitStatus[] | null;
  }
) {
  let query = client
    .from("serviceVisit")
    .select(
      "id, serviceOrderId, technicianId, status, plannedStart, plannedEnd, travelStartedAt, arrivedAt, completedAt, signedByName, serviceOrder:serviceOrder!serviceVisit_order_fkey!inner(id, serviceOrderId, status, customer:customer!serviceOrder_customerId_fkey(id, name), customerLocation:customerLocation!serviceOrder_customerLocationId_fkey(id, name, address:address!customerLocation_addressId_fkey(addressLine1, city, stateProvince, postalCode)), trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(id, readableId), item:item!serviceOrder_itemId_fkey(id, readableIdWithRevision, name))"
    )
    .eq("companyId", companyId);

  if (args.serviceOrderId) {
    query = query.eq("serviceOrderId", args.serviceOrderId);
  }
  if (args.technicianId) query = query.eq("technicianId", args.technicianId);
  if (args.from) query = query.gte("plannedStart", args.from);
  if (args.to) query = query.lt("plannedStart", args.to);
  if (args.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }

  return query.order("plannedStart", { ascending: true, nullsFirst: false });
}

/**
 * One visit for the visit page: its order with the customer, site address,
 * subject and warranty dates, plus the notes and the signature.
 */
export async function getServiceVisit(
  client: Client,
  serviceVisitId: string,
  companyId: string
) {
  return client
    .from("serviceVisit")
    .select(
      "id, serviceOrderId, technicianId, status, plannedStart, plannedEnd, travelStartedAt, arrivedAt, completedAt, notes, signaturePath, signedByName, serviceOrder:serviceOrder!serviceVisit_order_fkey!inner(id, serviceOrderId, status, projectId, customerAssetId, trackedEntityId, itemId, customer:customer!serviceOrder_customerId_fkey(id, name), customerLocation:customerLocation!serviceOrder_customerLocationId_fkey(id, name, address:address!customerLocation_addressId_fkey(addressLine1, city, stateProvince, postalCode)), trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(id, readableId), item:item!serviceOrder_itemId_fkey(id, readableIdWithRevision, name), customerAsset:customerAsset!serviceOrder_asset_fkey(id, laborWarrantyEndDate, partsWarrantyEndDate))"
    )
    .eq("id", serviceVisitId)
    .eq("companyId", companyId)
    .single();
}

/** Saves a visit's notes or its signature. RLS lets the technician do it. */
export async function updateServiceVisit(
  client: Client,
  visit: {
    id: string;
    serviceOrderId: string;
    companyId: string;
    updatedBy: string;
    notes?: Json;
    signaturePath?: string;
    signedByName?: string;
  }
) {
  const { id, serviceOrderId, companyId, updatedBy, ...fields } = visit;
  return client
    .from("serviceVisit")
    .update({
      ...fields,
      updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("serviceOrderId", serviceOrderId)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/** The latest orders of an asset, newest first, without the given order. */
export async function getCustomerAssetRecentOrders(
  client: Client,
  args: {
    customerAssetId: string;
    companyId: string;
    excludeServiceOrderId?: string;
    limit: number;
  }
) {
  let query = client
    .from("serviceOrder")
    .select("id, serviceOrderId, status, createdAt, completedAt")
    .eq("customerAssetId", args.customerAssetId)
    .eq("companyId", args.companyId);
  if (args.excludeServiceOrderId) {
    query = query.neq("id", args.excludeServiceOrderId);
  }
  return query.order("createdAt", { ascending: false }).limit(args.limit);
}

/** Schedules a visit, or moves its technician and window. */
export async function upsertServiceVisit(
  client: Client,
  visit:
    | (Omit<z.infer<typeof serviceVisitValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof serviceVisitValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in visit) {
    return client
      .from("serviceVisit")
      .insert([
        {
          serviceOrderId: visit.serviceOrderId,
          technicianId: visit.technicianId,
          plannedStart: visit.plannedStart ?? null,
          plannedEnd: visit.plannedEnd ?? null,
          companyId: visit.companyId,
          createdBy: visit.createdBy
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("serviceVisit")
    .update({
      technicianId: visit.technicianId,
      plannedStart: visit.plannedStart ?? null,
      plannedEnd: visit.plannedEnd ?? null,
      updatedBy: visit.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", visit.id)
    .eq("serviceOrderId", visit.serviceOrderId)
    .eq("companyId", visit.companyId)
    .select("id")
    .single();
}

// --- Work --------------------------------------------------------------------

const WORK_NODE_COLUMNS =
  "id, parentId, readableId, name, type, sortOrder, itemId, trackedEntityId, fixedPrice, item:item!projectElement_item_fkey(id, readableIdWithRevision, name), trackedEntity:trackedEntity!projectElement_trackedEntityId_fkey(id, readableId)" as const;

/** The nodes of a work tree (an order's or a template's), by sort order. */
export async function getServiceWorkNodes(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectElement")
    .select(WORK_NODE_COLUMNS)
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
}

/**
 * An order's work tree with what feeds its totals: the nodes, every ledger
 * row of the order's project, and its billable items. Three queries;
 * `summarizeWork` (`service.models.ts`) turns them into totals per node.
 */
export async function getServiceWork(
  client: Client,
  projectId: string,
  companyId: string
) {
  const [elements, ledger, billable] = await Promise.all([
    getServiceWorkNodes(client, projectId, companyId),
    client
      .from("projectLedger")
      .select("projectElementId, costType, quantity, amount, coverage")
      .eq("projectId", projectId)
      .eq("companyId", companyId),
    client
      .from("projectBillableItem")
      .select("projectElementId, amount, status")
      .eq("projectId", projectId)
      .eq("companyId", companyId)
  ]);

  return {
    elements: elements.data ?? [],
    ledger: ledger.data ?? [],
    billable: billable.data ?? [],
    error: elements.error ?? ledger.error ?? billable.error
  };
}

/**
 * One node of an order's work tree with its charges: each ledger row with
 * its billable item, newest first. With a linked serial or item, the last
 * day any order of the company charged a node naming it.
 */
export async function getServiceNode(
  client: Client,
  args: { projectId: string; elementId: string; companyId: string }
) {
  const element = await client
    .from("projectElement")
    .select(WORK_NODE_COLUMNS)
    .eq("id", args.elementId)
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .single();
  if (element.error) return { data: null, error: element.error };

  const charges = await client
    .from("projectLedger")
    .select(
      "id, postingDate, costType, documentType, documentId, quantity, unitOfMeasureCode, amount, coverage, coverageReason, reversalOfId, employeeId, itemId, billableItems:projectBillableItem!projectBillableItem_ledger_fkey(id, status, amount)"
    )
    .eq("projectElementId", args.elementId)
    .eq("companyId", args.companyId)
    .order("postingDate", { ascending: false })
    .order("createdAt", { ascending: false });
  if (charges.error) return { data: null, error: charges.error };

  // The last service of the linked component, on any order.
  const linkColumn = element.data.trackedEntityId
    ? "trackedEntityId"
    : element.data.itemId
      ? "itemId"
      : null;
  const linkValue = element.data.trackedEntityId ?? element.data.itemId;
  const lastService =
    linkColumn && linkValue
      ? await client
          .from("projectLedger")
          .select(
            "postingDate, element:projectElement!projectLedger_element_fkey!inner(id)"
          )
          .eq("companyId", args.companyId)
          .eq(`element.${linkColumn}`, linkValue)
          .order("postingDate", { ascending: false })
          .limit(1)
          .maybeSingle()
      : null;
  if (lastService?.error) return { data: null, error: lastService.error };

  return {
    data: {
      element: element.data,
      charges: charges.data ?? [],
      lastServiceDate: lastService?.data?.postingDate ?? null
    },
    error: null
  };
}

/**
 * The last day any order of the company charged a node naming the same
 * serial, else the same item, for each node of a tree. Two queries, one per
 * link; a node with neither link has no date.
 */
export async function getServiceNodeLastServiceDates(
  client: Client,
  nodes: {
    id: string;
    itemId: string | null;
    trackedEntityId: string | null;
  }[],
  companyId: string
): Promise<{
  data: Record<string, string | null> | null;
  error: PostgrestError | null;
}> {
  const serialIds = [
    ...new Set(
      nodes.map((n) => n.trackedEntityId).filter((id): id is string => !!id)
    )
  ];
  const itemIds = [
    ...new Set(
      nodes
        .filter((n) => !n.trackedEntityId)
        .map((n) => n.itemId)
        .filter((id): id is string => !!id)
    )
  ];

  const [bySerial, byItem] = await Promise.all([
    serialIds.length > 0
      ? client
          .from("projectLedger")
          .select(
            "postingDate, element:projectElement!projectLedger_element_fkey!inner(trackedEntityId)"
          )
          .eq("companyId", companyId)
          .in("element.trackedEntityId", serialIds)
      : null,
    itemIds.length > 0
      ? client
          .from("projectLedger")
          .select(
            "postingDate, element:projectElement!projectLedger_element_fkey!inner(itemId)"
          )
          .eq("companyId", companyId)
          .in("element.itemId", itemIds)
      : null
  ]);
  const error = bySerial?.error ?? byItem?.error ?? null;
  if (error) return { data: null, error };

  const latest = new Map<string, string>();
  const keep = (key: string, date: string) => {
    const current = latest.get(key);
    if (!current || date > current) latest.set(key, date);
  };
  for (const row of bySerial?.data ?? []) {
    if (row.element?.trackedEntityId) {
      keep(`serial:${row.element.trackedEntityId}`, row.postingDate);
    }
  }
  for (const row of byItem?.data ?? []) {
    if (row.element?.itemId)
      keep(`item:${row.element.itemId}`, row.postingDate);
  }

  const dates: Record<string, string | null> = {};
  for (const node of nodes) {
    const key = node.trackedEntityId
      ? `serial:${node.trackedEntityId}`
      : node.itemId
        ? `item:${node.itemId}`
        : null;
    dates[node.id] = key ? (latest.get(key) ?? null) : null;
  }
  return { data: dates, error: null };
}

/**
 * Sets or removes a node's fixed price. The invoice bills a fixed-price node
 * as one line at its price instead of its items (`create-service-order-invoice`).
 */
export async function updateServiceNodeFixedPrice(
  client: Client,
  node: {
    projectId: string;
    elementId: string;
    fixedPrice: number | null;
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("projectElement")
    .update({
      fixedPrice: node.fixedPrice,
      updatedBy: node.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", node.elementId)
    .eq("projectId", node.projectId)
    .eq("companyId", node.companyId)
    .select("id")
    .single();
}

/**
 * What an estimate prices: the tree's nodes, their plan lines (materials,
 * labor, other costs) and the sale prices of the materials' items and the
 * service labor item (`companySettings.serviceLaborItemId`). An item with
 * several sale price rows takes the oldest. Two rounds of queries.
 */
export async function getServiceEstimateInputs(
  client: Client,
  projectId: string,
  companyId: string
) {
  const [nodes, materials, labor, costs, settings] = await Promise.all([
    client
      .from("projectElement")
      .select("id, parentId, sortOrder, readableId, name, fixedPrice")
      .eq("projectId", projectId)
      .eq("companyId", companyId),
    client
      .from("projectElementMaterial")
      .select(
        "projectElementId, itemId, quantity, unitOfMeasureCode, item:item!projectElementMaterial_itemId_fkey(readableIdWithRevision, name)"
      )
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("createdAt"),
    client
      .from("projectElementLabor")
      .select(
        "projectElementId, hours, laborCategory:laborCategory!projectElementLabor_category_fkey(name)"
      )
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("createdAt"),
    client
      .from("projectElementCost")
      .select("projectElementId, description, amount")
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("createdAt"),
    client
      .from("companySettings")
      .select("serviceLaborItemId")
      .eq("id", companyId)
      .maybeSingle()
  ]);
  const error =
    nodes.error ??
    materials.error ??
    labor.error ??
    costs.error ??
    settings.error;
  if (error) return { data: null, error };

  const laborItemId = settings.data?.serviceLaborItemId ?? null;
  const itemIds = [
    ...new Set([
      ...(materials.data ?? []).map((row) => row.itemId),
      ...(laborItemId ? [laborItemId] : [])
    ])
  ];
  const prices =
    itemIds.length > 0
      ? await client
          .from("itemUnitSalePrice")
          .select("itemId, unitSalePrice")
          .in("itemId", itemIds)
          .eq("companyId", companyId)
          .order("createdAt", { ascending: true })
      : { data: [], error: null };
  if (prices.error) return { data: null, error: prices.error };

  const priceOf = new Map<string, number>();
  for (const row of prices.data ?? []) {
    if (!priceOf.has(row.itemId)) {
      priceOf.set(row.itemId, Number(row.unitSalePrice));
    }
  }

  return {
    data: {
      nodes: nodes.data ?? [],
      materials: (materials.data ?? []).map((row) => ({
        projectElementId: row.projectElementId,
        description: [row.item?.readableIdWithRevision, row.item?.name]
          .filter(Boolean)
          .join(" "),
        quantity: Number(row.quantity),
        unitOfMeasure: row.unitOfMeasureCode,
        unitPrice: priceOf.get(row.itemId) ?? null
      })),
      labor: (labor.data ?? []).map((row) => ({
        projectElementId: row.projectElementId,
        description: row.laborCategory?.name ?? "Labor",
        hours: Number(row.hours)
      })),
      costs: (costs.data ?? []).map((row) => ({
        projectElementId: row.projectElementId,
        description: row.description,
        amount: Number(row.amount)
      })),
      laborPrice: laborItemId ? (priceOf.get(laborItemId) ?? null) : null
    },
    error: null
  };
}

// --- Service templates ---------------------------------------------------------

/**
 * Lists the company's service templates (Service projects that are
 * templates) with their node count and how many orders started from each.
 */
export async function getServiceTemplates(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("project")
    .select(
      "id, name, identifier, createdAt, updatedAt, nodes:projectElement!projectElement_project_fkey(count), uses:serviceOrder!serviceOrder_template_fkey(count)",
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId)
    .eq("projectType", "Service")
    .eq("isTemplate", true);
  if (args.search) query = query.ilike("name", `%${args.search}%`);
  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

/** One service template. */
export async function getServiceTemplate(
  client: Client,
  templateId: string,
  companyId: string
) {
  return client
    .from("project")
    .select("id, name, identifier, createdAt")
    .eq("id", templateId)
    .eq("companyId", companyId)
    .eq("projectType", "Service")
    .eq("isTemplate", true)
    .single();
}

// --- Billable items ----------------------------------------------------------

/** An order's billable items, with the node they sit on. */
export async function getServiceBillableItems(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectBillableItem")
    .select(
      "id, projectElementId, projectLedgerId, itemId, description, quantity, unitPrice, amount, coverage, status, statusReason, reversalOfId, salesInvoiceLineId, createdAt, element:projectElement!projectBillableItem_element_fkey(id, readableId, name)"
    )
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

/**
 * Reviews one billable item before it is billed: its unit price (the
 * amount follows), a hold, or a write-off with a reason. A Billed or
 * Written Off item is refused.
 */
export async function updateServiceBillableItem(
  client: Client,
  item: z.infer<typeof serviceBillableItemValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  const current = await client
    .from("projectBillableItem")
    .select("quantity, unitPrice, status, reversalOfId")
    .eq("id", item.id)
    .eq("companyId", item.companyId)
    .single();
  if (current.error) return { data: null, error: current.error };
  if (current.data.status !== "Unbilled" && current.data.status !== "On Hold") {
    return refusal("Only an unbilled item can change");
  }
  if (current.data.reversalOfId) {
    return refusal("A reversal cannot change");
  }

  const unitPrice = item.unitPrice ?? Number(current.data.unitPrice);
  const status = item.status ?? current.data.status;
  return client
    .from("projectBillableItem")
    .update({
      unitPrice,
      amount: round(Number(current.data.quantity) * unitPrice),
      status,
      statusReason: status === "Unbilled" ? null : (item.statusReason ?? null),
      updatedBy: item.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", item.id)
    .eq("companyId", item.companyId)
    .in("status", ["Unbilled", "On Hold"])
    .select("id")
    .single();
}

// ---------------------------------------------------------------------------
// complete-service-order
//
// Completes a service order. A Field Visit or Depot Repair order is only
// stamped Completed. A Refurbishment moves its WIP into the serial's cost
// (`planRefurbishmentCompletion`) and releases the serial.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Accounting → Refurbishment
// completion); plan .ai/plans/2026-10-09-field-service-phase-c.md, Task 4.

export const completeServiceOrderInput = z.object({
  serviceOrderId: z.string()
});

export type CompleteServiceOrderResult = {
  success: true;
  serviceOrderId: string;
  /** Refurbishment only, else null. */
  capitalizedAmount: number | null;
  writeDownAmount: number | null;
  journalId: string | null;
  warnings: string[];
};

type Enums = Database["public"]["Enums"];

/** The open statuses an order completes from (`canMoveServiceOrder`). */
const COMPLETABLE = new Set(["Draft", "Planned", "Scheduled", "In Progress"]);

export const completeServiceOrderPermission = {
  update: "service"
} satisfies PermissionRule<z.output<typeof completeServiceOrderInput>>;

/**
 * Completes one service order, in one transaction.
 *
 * A Field Visit or Depot Repair order is stamped `completedAt` /
 * `completedBy` and set Completed, its project Technically Complete — what
 * the ERP's Complete did before.
 *
 * A Refurbishment also:
 * 1. sums its Capitalized ledger rows (the WIP), loads the item's cost and its
 *    open layers and children under row locks, and the sale price cap;
 * 2. plans the completion (`planRefurbishmentCompletion`);
 * 3. writes the layer split, the child moves, the revaluation and the
 *    write-down child rows, and the Average unit cost;
 * 4. posts one journal (`sourceType 'Service Order'`) when accounting is on:
 *    Dr inventory / Cr WIP, the WIP lines by node with the Project and
 *    Project Element dimensions;
 * 5. sets the serial Available and writes a `Service` activity;
 * 6. saves the amounts, the journal and the costing method on the order.
 */
export async function completeServiceOrder(
  ctx: ServiceContext,
  raw: z.input<typeof completeServiceOrderInput>
): Promise<CompleteServiceOrderResult> {
  const { serviceOrderId } = completeServiceOrderInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  return db.transaction().execute(async (trx) => {
    // Row lock: two completions of one order must not both capitalize it.
    const order = await trx
      .selectFrom("serviceOrder")
      .select([
        "id",
        "serviceOrderId",
        "type",
        "status",
        "projectId",
        "trackedEntityId",
        "itemId",
        "expectedSellingPrice",
        "abnormalRework"
      ])
      .where("id", "=", serviceOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new NotFoundError("Service order not found");
    if (!COMPLETABLE.has(order.status)) {
      throw new ServerFnError(
        `Service order ${order.serviceOrderId} is ${order.status}. Only an open order is completed.`,
        422
      );
    }

    const now = datetime.timestamp();
    const finish = async (
      columns: Partial<{
        capitalizedAmount: number;
        writeDownAmount: number;
        completionJournalId: string | null;
        completionCostingMethod: Enums["itemCostingMethod"];
      }> = {}
    ) => {
      await trx
        .updateTable("serviceOrder")
        .set({
          ...columns,
          status: "Completed",
          completedAt: now,
          completedBy: userId,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", order.id)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .updateTable("project")
        .set({
          status: "Technically Complete",
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", order.projectId)
        .where("companyId", "=", companyId)
        .execute();
    };

    if (order.type !== "Refurbishment") {
      await finish();
      return {
        success: true,
        serviceOrderId: order.id,
        capitalizedAmount: null,
        writeDownAmount: null,
        journalId: null,
        warnings: []
      };
    }

    const serial = await trx
      .selectFrom("trackedEntity")
      .select(["id", "readableId", "status"])
      .where("id", "=", order.trackedEntityId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!serial) throw new NotFoundError("Serial not found");
    if (serial.status !== "On Hold" && serial.status !== "Available") {
      throw new ServerFnError(
        `Serial ${serial.readableId ?? serial.id} is ${serial.status}. Only a serial in stock completes a refurbishment.`,
        422
      );
    }

    const context = await loadRefurbishmentCompletion(trx, {
      companyId,
      order: {
        ...order,
        expectedSellingPrice:
          order.expectedSellingPrice === null
            ? null
            : Number(order.expectedSellingPrice)
      },
      lock: true
    });

    let plan: RefurbishmentCompletionPlan;
    try {
      plan = planRefurbishmentCompletion(context.input);
    } catch (err) {
      if (err instanceof RefurbishmentCompletionError) {
        throw new ServerFnError(err.message, 422);
      }
      throw err;
    }

    await writeCostLedger(trx, {
      companyId,
      orderId: order.id,
      itemId: order.itemId,
      serialId: order.trackedEntityId,
      today,
      plan,
      context
    });

    if (plan.averageUnitCost !== null) {
      await trx
        .updateTable("itemCost")
        .set({
          unitCost: plan.averageUnitCost,
          updatedBy: userId,
          updatedAt: now
        })
        .where("itemId", "=", order.itemId)
        .where("companyId", "=", companyId)
        .execute();
    }

    const journalId =
      plan.journal.length > 0
        ? await postCompletionJournal(trx, {
            companyId,
            userId,
            today,
            order,
            plan,
            context
          })
        : null;

    await trx
      .updateTable("trackedEntity")
      .set({ status: "Available", updatedBy: userId })
      .where("id", "=", order.trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
    const activity = await trx
      .insertInto("trackedActivity")
      .values({
        type: "Service",
        sourceDocument: "Service Order",
        sourceDocumentId: order.id,
        sourceDocumentReadableId: order.serviceOrderId,
        attributes: {
          "Service Order": order.id,
          Refurbished: true,
          Employee: userId
        },
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("trackedActivityOutput")
      .values({
        trackedActivityId: activity.id,
        trackedEntityId: order.trackedEntityId,
        quantity: 1,
        companyId,
        createdBy: userId
      })
      .execute();

    await finish({
      capitalizedAmount: plan.capitalizedAmount,
      writeDownAmount: plan.writeDown,
      completionJournalId: journalId,
      completionCostingMethod: context.input.costingMethod
    });

    return {
      success: true,
      serviceOrderId: order.id,
      capitalizedAmount: plan.capitalizedAmount,
      writeDownAmount: plan.writeDown,
      journalId,
      warnings: [...context.warnings, ...plan.warnings]
    };
  });
}

/**
 * The plan's cost ledger writes: the split (the source layer gives up one
 * unit's quantity and cost; a stamped layer of one unit copies its document),
 * the child moves onto the serial's layer, the revaluation child and the
 * write-down child.
 */
async function writeCostLedger(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    orderId: string;
    itemId: string;
    serialId: string;
    today: string;
    plan: RefurbishmentCompletionPlan;
    context: RefurbishmentCompletionContext;
  }
): Promise<void> {
  const { companyId, plan, context } = args;
  let serialLayerId = plan.serialLayerId;

  if (plan.split) {
    const source = context.layerRows.get(plan.split.sourceLayerId);
    if (!source) throw new Error("The source cost layer was not loaded");
    const unitNominal = round(
      Number(source.nominalCost) / Number(source.quantity)
    );
    await trx
      .updateTable("costLedger")
      .set({
        quantity: plan.split.sourceQuantity,
        remainingQuantity: plan.split.sourceRemainingQuantity,
        cost: plan.split.sourceCost,
        nominalCost: round(Number(source.nominalCost) - unitNominal)
      })
      .where("id", "=", source.id)
      .where("companyId", "=", companyId)
      .execute();
    const inserted = await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: source.itemLedgerType,
        costLedgerType: source.costLedgerType,
        adjustment: false,
        documentType: source.documentType,
        documentId: source.documentId,
        externalDocumentId: source.externalDocumentId,
        itemId: source.itemId,
        quantity: 1,
        remainingQuantity: 1,
        cost: plan.split.cost,
        nominalCost: unitNominal,
        supplierId: source.supplierId,
        trackedEntityId: args.serialId,
        postingDate: source.postingDate,
        companyId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    serialLayerId = inserted.id;
  }

  const children: {
    itemLedgerType: Enums["itemLedgerType"];
    costLedgerType: Enums["costLedgerType"];
    documentType: Enums["itemLedgerDocumentType"] | null;
    documentId: string | null;
    externalDocumentId: string | null;
    supplierId: string | null;
    postingDate: string;
    appliesToCostLedgerId: string | null;
    quantity: number;
    remainingQuantity: number;
    cost: number;
  }[] = [];

  for (const move of plan.childMoves) {
    const child = context.childRows.get(move.childId);
    if (!child) throw new Error("A moved cost child was not loaded");
    await trx
      .updateTable("costLedger")
      .set({
        quantity: move.quantity,
        remainingQuantity: move.remainingQuantity,
        cost: move.cost,
        nominalCost: move.cost
      })
      .where("id", "=", child.id)
      .where("companyId", "=", companyId)
      .execute();
    children.push({
      itemLedgerType: child.itemLedgerType,
      costLedgerType: child.costLedgerType,
      documentType: child.documentType,
      documentId: child.documentId,
      externalDocumentId: child.externalDocumentId,
      supplierId: child.supplierId,
      postingDate: child.postingDate,
      appliesToCostLedgerId: serialLayerId,
      quantity: move.movedQuantity,
      remainingQuantity: move.movedQuantity,
      cost: move.movedCost
    });
  }

  if (plan.revaluation) {
    const attachedTo = plan.revaluation.attached ? serialLayerId : null;
    children.push({
      itemLedgerType: "Positive Adjmt.",
      costLedgerType: "Revaluation",
      documentType: null,
      documentId: args.orderId,
      externalDocumentId: null,
      supplierId: null,
      postingDate: args.today,
      appliesToCostLedgerId: attachedTo,
      quantity: 1,
      // An unattached child (Average) is cost history only: nothing relieves it.
      remainingQuantity: attachedTo ? 1 : 0,
      cost: plan.revaluation.cost
    });
  }

  if (plan.writeDown > 0) {
    children.push({
      itemLedgerType: "Negative Adjmt.",
      costLedgerType: "Revaluation",
      documentType: null,
      documentId: args.orderId,
      externalDocumentId: null,
      supplierId: null,
      postingDate: args.today,
      appliesToCostLedgerId: serialLayerId,
      quantity: 1,
      remainingQuantity: 1,
      cost: -plan.writeDown
    });
  }

  if (children.length > 0) {
    await trx
      .insertInto("costLedger")
      .values(
        children.map((child) => ({
          ...child,
          adjustment: true,
          itemId: args.itemId,
          nominalCost: child.cost,
          trackedEntityId: args.serialId,
          companyId
        }))
      )
      .execute();
  }
}

/**
 * One posted journal for the completion, in today's period. The inventory
 * account follows the item's replenishment (`resolveInventoryAccount`); every
 * line carries the Project dimension, and the WIP lines are split by node
 * with the Project Element dimension, so each node's WIP nets to zero.
 */
async function postCompletionJournal(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    today: string;
    order: { id: string; serviceOrderId: string; projectId: string };
    plan: RefurbishmentCompletionPlan;
    context: RefurbishmentCompletionContext;
  }
): Promise<string> {
  const { companyId, order, plan, context } = args;
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([
      "rawMaterialsAccount",
      "finishedGoodsAccount",
      "workInProgressAccount",
      "materialVarianceAccount",
      "inventoryAdjustmentVarianceAccount"
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Account defaults are not configured");
  const required = (value: string | null, name: string): string => {
    if (!value) {
      throw new ServerFnError(
        `Set ${name} in Account Defaults before you complete a refurbishment`,
        422
      );
    }
    return value;
  };
  const inventory = resolveInventoryAccount(context.item.replenishmentSystem, {
    rawMaterialsAccount: required(
      defaults.rawMaterialsAccount,
      "Raw Materials"
    ),
    finishedGoodsAccount: required(
      defaults.finishedGoodsAccount,
      "Finished Goods"
    )
  });
  const accounts: Record<
    RefurbishmentAccount,
    { id: string; type: "asset" | "expense" }
  > = {
    inventory: { id: inventory.account, type: "asset" },
    workInProgress: {
      id: required(defaults.workInProgressAccount, "Work in Progress"),
      type: "asset"
    },
    materialVariance: {
      id: required(defaults.materialVarianceAccount, "Material Variance"),
      type: "expense"
    },
    inventoryAdjustmentVariance: {
      id: required(
        defaults.inventoryAdjustmentVarianceAccount,
        "Inventory Adjustment Variance"
      ),
      type: "expense"
    }
  };

  // The WIP credit by node: each node's Capitalized charges, the last node
  // taking any rounding residual so the lines sum to the planned amount.
  const lines: {
    accountId: string;
    description: string;
    amount: number;
    projectElementId: string | null;
  }[] = [];
  for (const line of plan.journal) {
    const account = accounts[line.account];
    const signed = (amount: number) =>
      round(
        line.side === "debit"
          ? debit(account.type, amount)
          : credit(account.type, amount)
      );
    if (line.account === "workInProgress" && context.wipByElement.length > 1) {
      let left = line.amount;
      context.wipByElement.forEach((share, index) => {
        const amount =
          index === context.wipByElement.length - 1
            ? round(left)
            : share.amount;
        left -= amount;
        lines.push({
          accountId: account.id,
          description: line.description,
          amount: signed(amount),
          projectElementId: share.projectElementId
        });
      });
    } else {
      lines.push({
        accountId: account.id,
        description: line.description,
        amount: signed(line.amount),
        projectElementId:
          line.account === "workInProgress"
            ? (context.wipByElement[0]?.projectElementId ?? null)
            : null
      });
    }
  }

  // Every completion writes its journal: Provisional before the company's
  // accounting cutover, Posted after it. FOR SHARE holds the status until
  // commit. A Provisional journal has no accounting period.
  const status = await journalPostingStatus(trx, companyId);
  const accountingPeriodId =
    status === "Posted"
      ? (await resolveAccountingPeriod(trx, companyId, args.today, "current"))
          .id
      : null;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId,
    status,
    description: `Refurbishment ${order.serviceOrderId}`,
    postingDate: args.today,
    userId: args.userId,
    sourceType: "Service Order"
  });
  const lineIds = await allocateJournalLineIds(trx, lines.length);
  const journalLineReference = nanoid();
  await trx
    .insertInto("journalLine")
    .values(
      lines.map((line, index) => ({
        id: lineIds[index]!,
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: line.amount,
        quantity: 1,
        documentType: "Service Order" as const,
        documentId: order.id,
        documentLineReference: journalReference.to.serviceOrder(order.id),
        journalLineReference,
        companyId
      }))
    )
    .execute();

  const dimensions = await trx
    .selectFrom("dimension")
    .innerJoin("company", "company.companyGroupId", "dimension.companyGroupId")
    .select(["dimension.id", "dimension.entityType"])
    .where("company.id", "=", companyId)
    .where("dimension.active", "=", true)
    .where("dimension.entityType", "in", ["Project", "ProjectElement"])
    .execute();
  const dimensionId = (entityType: string) =>
    dimensions.find((dimension) => dimension.entityType === entityType)?.id;
  const projectDimension = dimensionId("Project");
  const elementDimension = dimensionId("ProjectElement");
  const tags = lines.flatMap((line, index) => [
    ...(projectDimension
      ? [
          {
            journalLineId: lineIds[index]!,
            dimensionId: projectDimension,
            valueId: order.projectId,
            companyId
          }
        ]
      : []),
    ...(elementDimension && line.projectElementId
      ? [
          {
            journalLineId: lineIds[index]!,
            dimensionId: elementDimension,
            valueId: line.projectElementId,
            companyId
          }
        ]
      : [])
  ]);
  if (tags.length > 0) {
    await trx.insertInto("journalLineDimension").values(tags).execute();
  }

  return journalId;
}

// ---------------------------------------------------------------------------
// create-service-order-invoice
//
// Invoices a Completed service order: one Draft sales invoice of its Unbilled
// billable items, laid out by the work tree (`planServiceInvoiceLines`). It
// follows create-contract-invoices (sequence, opportunity, header,
// salesInvoiceShipment, then lines). Posting stays with post-sales-invoice,
// which posts revenue only for these lines: their parts already left stock.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Invoicing).

export const createServiceOrderInvoiceInput = z.object({
  serviceOrderId: z.string()
});

export type CreateServiceOrderInvoiceResult = {
  success: true;
  salesInvoiceId: string;
  /** The readable invoice id. */
  invoiceId: string;
};

const CONTRACT_NOTE = "(Covered by contract)";

export const createServiceOrderInvoicePermission = {
  update: "service",
  create: "invoicing"
} satisfies PermissionRule<z.output<typeof createServiceOrderInvoiceInput>>;

/**
 * Drafts the invoice of one Completed service order, in one transaction:
 * 1. locks the order and refuses unless it is Completed with an Unbilled item;
 * 2. inserts the opportunity, the header (`serviceOrderId`, the customer and
 *    site, the order's location, the customer's payment term and currency)
 *    and `salesInvoiceShipment`;
 * 3. inserts the lines from the plan, in order;
 * 4. stamps each billable item with its line and sets it Billed;
 * 5. closes the order and stamps it with the invoice.
 * Tax stays at 0: the customer has no default rate (as create-contract-invoices
 * takes only what its source names).
 */
export async function createServiceOrderInvoice(
  ctx: ServiceContext,
  raw: z.input<typeof createServiceOrderInvoiceInput>
): Promise<CreateServiceOrderInvoiceResult> {
  const { serviceOrderId } = createServiceOrderInvoiceInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  return db.transaction().execute(async (trx) => {
    // Row lock: two invoices of one order must not both bill it.
    const order = await trx
      .selectFrom("serviceOrder")
      .select([
        "id",
        "serviceOrderId",
        "status",
        "type",
        "projectId",
        "customerId",
        "customerLocationId",
        "customerContractId",
        "locationId",
        "invoiceDetail"
      ])
      .where("id", "=", serviceOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new NotFoundError("Service order not found");
    if (order.status !== "Completed") {
      throw new ServerFnError(
        `Service order ${order.serviceOrderId} is ${order.status}. Only a Completed order is invoiced.`,
        422
      );
    }
    if (!order.customerId) {
      throw new ServerFnError(
        "A refurbishment has no customer to invoice",
        422
      );
    }
    const customerId = order.customerId;

    const [items, elements, customerPayment, customer, company, contract] =
      await inOrder([
        () =>
          trx
            .selectFrom("projectBillableItem")
            .leftJoin("projectLedger", (join) =>
              join
                .onRef(
                  "projectLedger.id",
                  "=",
                  "projectBillableItem.projectLedgerId"
                )
                .onRef(
                  "projectLedger.companyId",
                  "=",
                  "projectBillableItem.companyId"
                )
            )
            .select([
              "projectBillableItem.id",
              "projectBillableItem.projectElementId",
              "projectBillableItem.itemId",
              "projectBillableItem.description",
              "projectBillableItem.quantity",
              "projectBillableItem.unitPrice",
              "projectBillableItem.amount",
              "projectLedger.unitOfMeasureCode"
            ])
            .where("projectBillableItem.projectId", "=", order.projectId)
            .where("projectBillableItem.companyId", "=", companyId)
            .where("projectBillableItem.status", "=", "Unbilled")
            .orderBy("projectBillableItem.createdAt")
            .orderBy("projectBillableItem.id")
            // OF the item: the ledger is the nullable side of the join.
            .forUpdate("projectBillableItem")
            .execute(),
        () =>
          trx
            .selectFrom("projectElement")
            .select([
              "id",
              "parentId",
              "name",
              "sortOrder",
              "sequence",
              "fixedPrice"
            ])
            .where("projectId", "=", order.projectId)
            .where("companyId", "=", companyId)
            .execute(),
        () => maybeSingle(trx, "customerPayment", { customerId, companyId }),
        () => maybeSingle(trx, "customer", { id: customerId, companyId }),
        () =>
          maybeSingle(
            trx,
            "company",
            { id: companyId },
            { columns: ["baseCurrencyCode"] }
          ),
        async () =>
          order.customerContractId
            ? trx
                .selectFrom("customerContract")
                .select("customerContractId")
                .where("id", "=", order.customerContractId)
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            : undefined
      ]);
    if (customerPayment.error) throw customerPayment.error;
    if (customer.error) throw customer.error;
    if (company.error) throw company.error;
    if (items.length === 0) {
      throw new ServerFnError(
        `Service order ${order.serviceOrderId} has no unbilled charge. Close it instead.`,
        422
      );
    }

    const lines = planServiceInvoiceLines({
      elements: elements.map((element) => ({
        id: element.id,
        parentId: element.parentId,
        name: element.name,
        sortOrder: Number(element.sortOrder ?? 0),
        sequence: Number(element.sequence ?? 0),
        fixedPrice:
          element.fixedPrice === null ? null : Number(element.fixedPrice)
      })),
      items: items.map((item) => ({
        id: item.id,
        projectElementId: item.projectElementId,
        itemId: item.itemId,
        // A covered item names its contract on the invoice.
        description: contract?.customerContractId
          ? item.description.replace(
              CONTRACT_NOTE,
              `(Covered by contract ${contract.customerContractId})`
            )
          : item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
        unitOfMeasureCode: item.unitOfMeasureCode ?? "EA"
      })),
      invoiceDetail: order.invoiceDetail
    });

    const currencyCode =
      customer.data?.currencyCode ?? company.data?.baseCurrencyCode ?? "USD";
    // 1 for the base currency; raises on a missing rate.
    const rate = await rpcValue(trx, "get_exchange_rate", {
      p_company_id: companyId,
      p_currency_code: currencyCode
    });
    if (rate.error) throw new Error(rate.error.message);
    const exchangeRate = Number(rate.data);

    const subtotal = round(
      lines.reduce(
        (sum, line) =>
          line.invoiceLineType === "Service"
            ? sum + line.quantity * line.unitPrice
            : sum,
        0
      )
    );

    const readableInvoiceId = await getNextSequence(
      trx,
      "salesInvoice",
      companyId
    );
    // Every sales invoice has an opportunity: its documents live under the
    // opportunity's storage folder.
    const opportunity = await trx
      .insertInto("opportunity")
      .values({ companyId, customerId })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    const invoice = await trx
      .insertInto("salesInvoice")
      .values({
        invoiceId: readableInvoiceId,
        status: "Draft",
        customerId,
        invoiceCustomerId:
          customerPayment.data?.invoiceCustomerId ?? customerId,
        invoiceCustomerContactId:
          customerPayment.data?.invoiceCustomerContactId ?? null,
        invoiceCustomerLocationId:
          customerPayment.data?.invoiceCustomerLocationId ?? null,
        locationId: order.locationId,
        paymentTermId: customerPayment.data?.paymentTermId ?? null,
        currencyCode,
        exchangeRate,
        customerReference: order.serviceOrderId,
        serviceOrderId: order.id,
        dateIssued: today,
        subtotal,
        totalDiscount: 0,
        totalTax: 0,
        totalAmount: subtotal,
        opportunityId: opportunity.id,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoice.id,
        locationId: order.locationId,
        customerLocationId: order.customerLocationId,
        shippingCost: 0,
        companyId,
        createdBy: userId
      })
      .execute();

    // Multi-row RETURNING does not promise order: match on sortOrder.
    const inserted = await trx
      .insertInto("salesInvoiceLine")
      .values(
        lines.map((line, index) => ({
          invoiceId: invoice.id,
          invoiceLineType: line.invoiceLineType,
          description: line.description,
          itemId: line.itemId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitOfMeasureCode: line.unitOfMeasureCode,
          taxPercent: 0,
          exchangeRate,
          locationId: order.locationId,
          sortOrder: index + 1,
          companyId,
          createdBy: userId
        }))
      )
      .returning(["id", "sortOrder"])
      .execute();
    const lineIdBySortOrder = new Map(
      inserted.map((row) => [Number(row.sortOrder), row.id])
    );

    const stamps = lines.flatMap((line, index) =>
      line.billableItemIds.map((billableItemId) => ({
        billableItemId,
        lineId: lineIdBySortOrder.get(index + 1)!
      }))
    );
    if (stamps.length > 0) {
      await sql`
          UPDATE "projectBillableItem" b
          SET "salesInvoiceLineId" = v."lineId",
              "status" = 'Billed',
              "updatedBy" = ${userId},
              "updatedAt" = NOW()
          FROM (VALUES ${sql.join(
            stamps.map(
              (stamp) => sql`(${stamp.billableItemId}, ${stamp.lineId})`
            )
          )}) AS v("id", "lineId")
          WHERE b."id" = v."id" AND b."companyId" = ${companyId}
        `.execute(trx);
    }

    await trx
      .updateTable("serviceOrder")
      .set({
        status: "Closed",
        salesInvoiceId: invoice.id,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", order.id)
      .where("companyId", "=", companyId)
      .execute();

    return {
      success: true,
      salesInvoiceId: invoice.id,
      invoiceId: readableInvoiceId
    };
  });
}

// --- Refusals ----------------------------------------------------------------

/**
 * A refusal the operation returns as its own message: the order's state, its
 * subject, a charge that stands.
 */
export class ServiceOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceOrderError";
  }
}

/**
 * What a building block threw, as the operation's result: a
 * `ServiceOrderError` is a `rule` refusal with its message; anything else is
 * `internal` with `fallback` (logged by the service function).
 */
export function serviceOrderRefusal(
  ctx: ServiceContext,
  err: unknown,
  fallback: string
): CarbonError {
  return err instanceof ServiceOrderError
    ? ctx.error("rule", err.message, err)
    : ctx.error("internal", fallback, err);
}

/**
 * {@link serviceOrderRefusal} for a work-tree change: any thrown message that
 * did not come from the data layer is the person's to read (a project
 * element's own refusal, such as a move under its own child), as the work
 * routes showed it.
 */
export function serviceWorkRefusal(
  ctx: ServiceContext,
  err: unknown,
  fallback: string
): CarbonError {
  if (err instanceof ServiceOrderError)
    return ctx.error("rule", err.message, err);
  return err instanceof Error && err.message && !isDataLayerError(err)
    ? ctx.error("rule", err.message, err)
    : ctx.error("internal", fallback, err);
}

/** Runs `body` and returns its value, or what it threw as {@link serviceOrderRefusal}. */
export async function attemptServiceOrder<R>(
  ctx: ServiceContext,
  fallback: string,
  body: () => Promise<R>,
  refuse: typeof serviceOrderRefusal = serviceOrderRefusal
): Promise<R | CarbonError> {
  try {
    return await body();
  } catch (err) {
    return refuse(ctx, err, fallback);
  }
}

/**
 * The order's project and status, refusing an order that is Closed or
 * Cancelled: the billing review, Build Tree and a node's fixed price change
 * only an open order.
 */
export async function requireOpenServiceOrder(
  client: Client,
  args: { companyId: string; serviceOrderId: string }
): Promise<{ projectId: string; status: ServiceOrderStatus }> {
  const order = await client
    .from("serviceOrder")
    .select("projectId, status")
    .eq("id", args.serviceOrderId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (order.error || !order.data) {
    throw new ServiceOrderError("The service order was not found");
  }
  if (order.data.status === "Closed" || order.data.status === "Cancelled") {
    throw new ServiceOrderError(
      "A closed or cancelled service order cannot change"
    );
  }
  return order.data;
}

/** That a billable item is on the order's project. */
export async function requireServiceBillableItem(
  client: Client,
  args: { companyId: string; projectId: string; projectBillableItemId: string }
): Promise<void> {
  const item = await client
    .from("projectBillableItem")
    .select("id")
    .eq("id", args.projectBillableItemId)
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (!item.data) {
    throw new ServiceOrderError("The item is not on this service order");
  }
}

/** That an edited or deleted plan line belongs to the element. */
export async function requireServicePlanLine(
  client: Client,
  args: {
    companyId: string;
    table: ServicePlanTable;
    lineId: string;
    projectElementId: string;
  }
): Promise<void> {
  const line = await client
    .from(args.table)
    .select("id")
    .eq("id", args.lineId)
    .eq("projectElementId", args.projectElementId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (!line.data) {
    throw new ServiceOrderError("The line is not on this element");
  }
}

/**
 * That a plan line can change: its element is in the Service project's work
 * (`requireServiceWork`) and, when `lineId` names a saved line, the line is
 * on the element.
 */
export async function requireServicePlanLineAccess(
  client: Client,
  args: {
    companyId: string;
    projectId: string;
    projectElementId: string;
    table: ServicePlanTable;
    lineId?: string;
  }
): Promise<void> {
  await requireServiceWork(client, {
    companyId: args.companyId,
    projectId: args.projectId,
    elementIds: [args.projectElementId]
  });
  if (args.lineId) {
    await requireServicePlanLine(client, {
      companyId: args.companyId,
      table: args.table,
      lineId: args.lineId,
      projectElementId: args.projectElementId
    });
  }
}

/** The sort order after the last child of `parentId` (null: the top level). */
export async function nextServiceElementSortOrder(
  client: Client,
  args: { companyId: string; projectId: string; parentId: string | null }
): Promise<number> {
  const siblings = client
    .from("projectElement")
    .select("sortOrder")
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .order("sortOrder", { ascending: false })
    .limit(1);
  const last = await (args.parentId
    ? siblings.eq("parentId", args.parentId)
    : siblings.is("parentId", null)
  ).maybeSingle();
  if (last.error) throw last.error;
  return Number(last.data?.sortOrder ?? 0) + 1;
}

/**
 * Build Tree's form as the projects builder takes it: the chosen source
 * under `parentId` of the order's work tree.
 */
export function serviceBuildArgs(
  data: z.infer<typeof buildFromPartValidator>,
  companyId: string,
  projectId: string
): BuildFromPartArgs {
  return {
    companyId,
    projectId,
    parentId: data.parentId ?? null,
    depth: data.depth,
    includeBought: data.includeBought,
    source:
      data.source === "Serial"
        ? { trackedEntityId: data.trackedEntityId! }
        : data.source === "Item"
          ? { itemId: data.itemId! }
          : { templateProjectId: data.templateProjectId! }
  };
}

/**
 * Whether the caller may change any visit of the order. A technician without
 * `update: "service"` charges and edits only their own open visit: the
 * Kysely writes do not pass through RLS, so this checks it
 * (`requireOwnServiceVisit`).
 */
export async function requireServiceVisitAccess(
  ctx: ServiceContext,
  args: { serviceOrderId: string; serviceVisitId: string | null }
): Promise<{ canUpdateAny: boolean }> {
  const canUpdateAny = ctx.can({ update: "service" });
  if (!canUpdateAny) {
    await requireOwnServiceVisit(ctx.asSystem.pg, {
      companyId: ctx.company.id,
      serviceOrderId: args.serviceOrderId,
      serviceVisitId: args.serviceVisitId,
      userId: ctx.auditUserId
    });
  }
  return { canUpdateAny };
}

// --- Transactional writes ----------------------------------------------------
// Creating an order with its work tree, registering a unit sold before
// Carbon, rolling an order's status up from its visits, cancelling an order,
// charging it and scheduling its visits.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Lifecycle, Customer assets)

const logger = getLogger("erp", "service");

type ProjectStatus = Database["public"]["Enums"]["projectStatus"];

/** The levels a build from the serial or the bill of materials walks. */
const SERVICE_BUILD_DEPTH = 2;

/**
 * Creates a Draft service order in one transaction: reads the next
 * `serviceOrder` id, checks the subject, creates the order's Service project
 * (the work tree), inserts the order, and, when asked, builds the tree from a
 * service template, the unit's build history or the item's bill of
 * materials. Returns the order's id.
 *
 * A Field Visit's subject is an In Service customer asset; the customer's
 * only Active contract is proposed when none was chosen. A Refurbishment's
 * subject is a serial in stock (Available or On Hold) with no open order; it
 * has no customer, site or contract, and its serial goes On Hold until the
 * order completes or is cancelled.
 */
export async function createServiceOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceOrderValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string; serviceOrderId: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    if (args.type === "Refurbishment") {
      const serial = await trx
        .selectFrom("trackedEntity as te")
        .innerJoin("item as i", (join) =>
          join.onRef("i.id", "=", "te.itemId").on("i.companyId", "=", companyId)
        )
        .select([
          "te.id",
          "te.readableId",
          "te.status",
          "te.itemId",
          "i.itemTrackingType"
        ])
        .where("te.id", "=", args.trackedEntityId ?? "")
        .where("te.companyId", "=", companyId)
        .forUpdate("te")
        .executeTakeFirst();
      if (!serial?.itemId) {
        throw new ServiceOrderError("The serial was not found");
      }
      const serialName = serial.readableId ?? serial.id;
      if (serial.itemTrackingType !== "Serial") {
        throw new ServiceOrderError(
          "A refurbishment needs a serial-tracked item"
        );
      }
      if (serial.status !== "Available" && serial.status !== "On Hold") {
        throw new ServiceOrderError(
          `A refurbishment needs a serial in stock. Serial ${serialName} is ${serial.status}.`
        );
      }
      await assertNoOpenServiceOrder(trx, companyId, serial.id, serialName);

      const order = await insertServiceOrder(trx, {
        companyId,
        userId,
        type: "Refurbishment",
        trackedEntityId: serial.id,
        serial: serialName,
        itemId: serial.itemId,
        customerAssetId: null,
        customerId: null,
        customerName: null,
        customerLocationId: null,
        locationId: args.locationId,
        customerContractId: null,
        contractProjectId: null,
        serviceTemplateId:
          args.startFrom === "Template"
            ? (args.serviceTemplateId ?? null)
            : null,
        priority: args.priority ?? "None",
        problem: args.problem ?? null
      });
      // On Hold keeps the serial out of picking and shipping while the work
      // runs (complete-service-order sets it Available again).
      await trx
        .updateTable("trackedEntity")
        .set({ status: "On Hold", updatedBy: userId })
        .where("id", "=", serial.id)
        .where("companyId", "=", companyId)
        .execute();

      await buildServiceOrderTree(client, trx, {
        companyId,
        userId,
        projectId: order.projectId,
        startFrom: args.startFrom,
        serviceTemplateId: args.serviceTemplateId,
        trackedEntityId: serial.id,
        itemId: serial.itemId
      });
      return { id: order.id, serviceOrderId: order.serviceOrderId };
    }

    const asset = await trx
      .selectFrom("customerAsset as ca")
      .innerJoin("trackedEntity as te", (join) =>
        join
          .onRef("te.id", "=", "ca.trackedEntityId")
          .on("te.companyId", "=", companyId)
      )
      .innerJoin("customer as c", "c.id", "ca.customerId")
      .select([
        "ca.id",
        "ca.status",
        "ca.itemId",
        "ca.trackedEntityId",
        "ca.customerId",
        "ca.customerLocationId",
        "te.readableId as serial",
        "c.name as customerName"
      ])
      .where("ca.id", "=", args.customerAssetId ?? "")
      .where("ca.companyId", "=", companyId)
      .executeTakeFirst();
    if (!asset) throw new ServiceOrderError("The customer asset was not found");
    if (asset.status !== "In Service") {
      throw new ServiceOrderError(
        `A field visit needs a unit in service. This unit is ${asset.status}.`
      );
    }
    await assertNoOpenServiceOrder(
      trx,
      companyId,
      asset.trackedEntityId,
      asset.serial ?? asset.trackedEntityId
    );

    const contracts = await trx
      .selectFrom("customerContract")
      .select(["id", "projectId", "status", "billingBasis"])
      .where("companyId", "=", companyId)
      .where("customerId", "=", asset.customerId)
      .where((eb) =>
        args.customerContractId
          ? eb("id", "=", args.customerContractId)
          : eb.and([
              eb("status", "=", "Active"),
              // A project contract never covers a service order.
              eb("billingBasis", "=", "Schedule")
            ])
      )
      .execute();
    let contract: { id: string; projectId: string | null } | null = null;
    if (args.customerContractId) {
      contract = contracts[0] ?? null;
      if (!contract) {
        throw new ServiceOrderError(
          "The coverage contract is not one of this customer's contracts"
        );
      }
      if (contracts[0]?.billingBasis === "Project") {
        throw new ServiceOrderError(
          "A project contract cannot cover a service order."
        );
      }
    } else if (contracts.length === 1) {
      contract = contracts[0]!;
    }

    const order = await insertServiceOrder(trx, {
      companyId,
      userId,
      type: args.type,
      trackedEntityId: asset.trackedEntityId,
      serial: asset.serial ?? "",
      itemId: asset.itemId,
      customerAssetId: asset.id,
      customerId: asset.customerId,
      customerName: asset.customerName,
      customerLocationId: asset.customerLocationId,
      customerContactId: args.customerContactId ?? null,
      locationId: args.locationId,
      customerContractId: contract?.id ?? null,
      contractProjectId: contract?.projectId ?? null,
      serviceTemplateId:
        args.startFrom === "Template" ? (args.serviceTemplateId ?? null) : null,
      priority: args.priority ?? "None",
      problem: args.problem ?? null
    });
    const { projectId, serviceOrderId } = order;

    await buildServiceOrderTree(client, trx, {
      companyId,
      userId,
      projectId,
      startFrom: args.startFrom,
      serviceTemplateId: args.serviceTemplateId,
      trackedEntityId: asset.trackedEntityId,
      itemId: asset.itemId
    });

    return { id: order.id, serviceOrderId };
  });
}

/**
 * Refuses a serial that already has an open order, so the user reads which
 * order holds it instead of the `serviceOrder_open_subject_key` violation.
 */
async function assertNoOpenServiceOrder(
  trx: KyselyTx,
  companyId: string,
  trackedEntityId: string,
  serialName: string
): Promise<void> {
  const open = await trx
    .selectFrom("serviceOrder")
    .select("serviceOrderId")
    .where("trackedEntityId", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .where("status", "not in", ["Closed", "Cancelled"])
    .executeTakeFirst();
  if (open) {
    throw new ServiceOrderError(
      `Serial ${serialName} already has an open service order, ${open.serviceOrderId}`
    );
  }
}

/**
 * Builds a new order's work tree from a service template, the unit's build
 * history (its serial) or the item's bill of materials. Nothing for Empty.
 */
async function buildServiceOrderTree(
  client: SupabaseClient<Database>,
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    startFrom: z.infer<typeof serviceOrderValidator>["startFrom"];
    serviceTemplateId?: string;
    trackedEntityId: string;
    itemId: string;
  }
): Promise<void> {
  const source =
    args.startFrom === "Template" && args.serviceTemplateId
      ? { templateProjectId: args.serviceTemplateId }
      : args.startFrom === "Serial"
        ? { trackedEntityId: args.trackedEntityId }
        : args.startFrom === "Item"
          ? { itemId: args.itemId }
          : null;
  if (!source) return;
  await insertElementsFromPart(client, trx, {
    companyId: args.companyId,
    projectId: args.projectId,
    parentId: null,
    source,
    depth:
      "templateProjectId" in source
        ? BUILD_FROM_PART_MAX_DEPTH
        : SERVICE_BUILD_DEPTH,
    // A unit's tracked components are what a service replaces, bought or
    // made; a bill of materials lists every bought screw, so it keeps only
    // the made lines.
    includeBought: "trackedEntityId" in source,
    // A template's plan lines come with its nodes, so the estimate has
    // prices.
    includePlanLines: true,
    userId: args.userId
  });
}

/**
 * Registers a unit sold before Carbon, in one transaction: a `trackedEntity`
 * for the typed serial (Consumed, quantity 1, sourced from the item) and the
 * customer asset (source Manual). A serial Carbon already tracks for the
 * item is refused: it becomes an asset when it ships.
 */
export async function registerCustomerAsset(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof customerAssetValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const item = await trx
      .selectFrom("item")
      .select(["id", "itemTrackingType"])
      .where("id", "=", args.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!item) throw new ServiceOrderError("The item was not found");
    if (item.itemTrackingType !== "Serial") {
      throw new ServiceOrderError("Only a serialized item can be an asset");
    }

    const existing = await trx
      .selectFrom("trackedEntity")
      .select("id")
      .where("companyId", "=", companyId)
      .where("itemId", "=", args.itemId)
      .where("readableId", "=", args.serialNumber)
      .executeTakeFirst();
    if (existing) {
      throw new ServiceOrderError(
        `Serial ${args.serialNumber} already exists for this item`
      );
    }

    const entity = await trx
      .insertInto("trackedEntity")
      .values({
        itemId: args.itemId,
        readableId: args.serialNumber,
        quantity: 1,
        status: "Consumed",
        sourceDocument: "Item",
        sourceDocumentId: args.itemId,
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return trx
      .insertInto("customerAsset")
      .values({
        trackedEntityId: entity.id,
        itemId: args.itemId,
        customerId: args.customerId,
        customerLocationId: args.customerLocationId ?? null,
        shippedDate: args.shippedDate ?? null,
        laborWarrantyEndDate: args.laborWarrantyEndDate ?? null,
        partsWarrantyEndDate: args.partsWarrantyEndDate ?? null,
        notes: args.notes ?? null,
        source: "Manual",
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
}

/**
 * Creates a service template in one transaction: a Draft Service project
 * marked as a template (By Coverage, as every Service project), with the
 * default states, and its identifier set from its id
 * (`serviceTemplateIdentifier`). Returns its id.
 */
export async function createServiceTemplate(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceTemplateValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .insertInto("project")
      .values({
        name: args.name,
        projectType: "Service",
        isTemplate: true,
        status: "Draft",
        costTreatment: "By Coverage",
        priority: "None",
        active: true,
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .updateTable("project")
      .set({ identifier: serviceTemplateIdentifier(project.id) })
      .where("id", "=", project.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: project.id };
  });
}

/**
 * The project status an order's status gives its work tree. A Draft order's
 * tree is Draft: its parts are not MRP demand (`openProjectMaterialLines`)
 * and it takes no charge.
 */
export function projectStatusOfOrder(
  status: ServiceOrderStatus
): ProjectStatus {
  switch (status) {
    case "Draft":
      return "Draft";
    case "On Hold":
      return "On Hold";
    case "Completed":
      return "Technically Complete";
    case "Closed":
    case "Cancelled":
      return "Closed";
    default:
      return "Released";
  }
}

/**
 * Rolls an order's status up from its visits (`rollUpOrderStatus`) and
 * saves it, then sets its project's status to match. `status` starts the
 * roll-up from a status the user chose (Mark as Planned, Put on hold,
 * Complete, Close; a Resume passes Planned so the visits decide again); `workComplete` is the
 * **Work complete?** answer of a completing visit. Call it after every visit
 * change and every order status change. Runs in `trx` when given.
 */
export async function syncServiceOrderStatus(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: {
    companyId: string;
    serviceOrderId: string;
    userId: string;
    status?: ServiceOrderStatus;
    workComplete?: boolean;
  }
): Promise<ServiceOrderStatus> {
  const run = async (trx: KyselyTx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "type", "status", "projectId"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");

    // A refurbishment completes only through `completeServiceOrder`, which
    // moves its cost into the serial; a visit's Work complete? leaves it
    // open. Once completed, its cost is in the serial, so it never reopens.
    const isRefurbishment = order.type === "Refurbishment";
    if (
      isRefurbishment &&
      args.status === "Completed" &&
      order.status !== "Completed"
    ) {
      throw new ServiceOrderError(
        "Complete a refurbishment from its order, so its cost moves to the serial"
      );
    }
    if (
      isRefurbishment &&
      order.status === "Completed" &&
      args.status !== undefined &&
      args.status !== "Completed" &&
      args.status !== "Closed"
    ) {
      throw new ServiceOrderError(
        "A completed refurbishment cannot be reopened: its cost is already in the serial"
      );
    }

    const visits = await trx
      .selectFrom("serviceVisit")
      .select("status")
      .where("serviceOrderId", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();

    const status = rollUpOrderStatus(
      {
        status: args.status ?? order.status,
        workComplete: isRefurbishment ? false : args.workComplete
      },
      visits
    );
    const now = datetime.timestamp();
    await trx
      .updateTable("serviceOrder")
      .set({
        status,
        ...(status === "Completed" && order.status !== "Completed"
          ? { completedAt: now, completedBy: args.userId }
          : {}),
        ...(status !== "Completed" &&
        status !== "Closed" &&
        order.status === "Completed"
          ? { completedAt: null, completedBy: null }
          : {}),
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();
    await trx
      .updateTable("project")
      .set({
        status: projectStatusOfOrder(status),
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .execute();
    return status;
  };

  return db.isTransaction
    ? run(db as KyselyTx)
    : (db as Kysely<KyselyDatabase>).transaction().execute(run);
}

/**
 * What completing a Refurbishment would do, written nowhere: the same reads
 * as `complete-service-order` (`loadRefurbishmentCompletion`, without row
 * locks) and the same planner. Returns the planner's refusal as `error`.
 */
export async function previewRefurbishmentCompletion(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; serviceOrderId: string }
): Promise<
  | { preview: RefurbishmentCompletionPreview; error: null }
  | { preview: null; error: string }
> {
  const order = await db
    .selectFrom("serviceOrder")
    .select([
      "id",
      "serviceOrderId",
      "type",
      "status",
      "projectId",
      "trackedEntityId",
      "itemId",
      "expectedSellingPrice",
      "abnormalRework"
    ])
    .where("id", "=", args.serviceOrderId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!order)
    return { preview: null, error: "The service order was not found" };
  if (order.type !== "Refurbishment") {
    return { preview: null, error: "Only a refurbishment has a cost preview" };
  }

  try {
    const context = await loadRefurbishmentCompletion(db, {
      companyId: args.companyId,
      order: {
        ...order,
        expectedSellingPrice:
          order.expectedSellingPrice === null
            ? null
            : Number(order.expectedSellingPrice)
      },
      lock: false
    });
    const plan = planRefurbishmentCompletion(context.input);
    const { input } = context;
    const currentUnitCost =
      plan.currentSerialUnitCost ?? round(input.currentUnitCost);
    return {
      preview: {
        costingMethod: input.costingMethod,
        treatment: plan.treatment,
        abnormalRework: input.abnormalRework,
        wipTotal: input.wipTotal,
        currentUnitCost,
        newUnitCost:
          plan.newSerialUnitCost ?? plan.averageUnitCost ?? currentUnitCost,
        cap: input.cap,
        writeDown: plan.writeDown,
        warnings: [...context.warnings, ...plan.warnings]
      },
      error: null
    };
  } catch (err) {
    if (err instanceof RefurbishmentCompletionError) {
      return { preview: null, error: err.message };
    }
    logger.error("Failed to preview a refurbishment completion", {
      companyId: args.companyId,
      serviceOrderId: args.serviceOrderId,
      error: err
    });
    return {
      preview: null,
      error:
        err instanceof Error ? err.message : "Failed to preview the completion"
    };
  }
}

/**
 * Cancels an order with no charge that stands: the order goes to Cancelled,
 * its open visits to Cancelled and its project to Closed. An order is refused
 * while one of its ledger rows is not reversed (`openChargeIds`); an order
 * whose every charge is reversed (a timesheet correction, a part return, an
 * expense reversal) can be cancelled. A cancelled Refurbishment releases its
 * serial: On Hold goes back to Available.
 */
export async function cancelServiceOrder(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; serviceOrderId: string; userId: string }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "type", "status", "projectId", "trackedEntityId"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");
    if (order.status === "Closed" || order.status === "Cancelled") {
      throw new ServiceOrderError(
        `A ${order.status.toLowerCase()} service order cannot be cancelled`
      );
    }

    const ledger = await trx
      .selectFrom("projectLedger")
      .select(["id", "reversalOfId"])
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .execute();
    const open = openChargeIds(ledger).length;
    if (open > 0) {
      throw new ServiceOrderError(
        `${
          open === 1
            ? "This service order has 1 charge that is not reversed."
            : `This service order has ${open} charges that are not reversed.`
        } Reverse every charge before you cancel the order, or complete the order and write off its billable items.`
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("serviceVisit")
      .set({ status: "Cancelled", updatedBy: args.userId, updatedAt: now })
      .where("serviceOrderId", "=", order.id)
      .where("companyId", "=", args.companyId)
      .where("status", "in", ["Scheduled", "Traveling", "On Site"])
      .execute();
    await syncServiceOrderStatus(trx, {
      companyId: args.companyId,
      serviceOrderId: order.id,
      userId: args.userId,
      status: "Cancelled"
    });
    // A refurbishment held its serial out of stock; it goes back.
    if (order.type === "Refurbishment") {
      await trx
        .updateTable("trackedEntity")
        .set({ status: "Available", updatedBy: args.userId })
        .where("id", "=", order.trackedEntityId)
        .where("companyId", "=", args.companyId)
        .where("status", "=", "On Hold")
        .execute();
    }
  });
}

/**
 * Changes an open order's coverage contract and keeps its Service project's
 * parent in step: the parent is the new contract's project, or none. A Contract
 * charge that stands (`openChargeIds` over the order's Contract rows) has
 * already posted to the old contract project's account, so the change is
 * refused until the charge is reclassed to another coverage. The contract must
 * be one of the order's customer's contracts; a Refurbishment has none.
 */
export async function updateServiceOrderCoverageContract(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    serviceOrderId: string;
    customerContractId: string | null;
  }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select([
        "id",
        "type",
        "status",
        "projectId",
        "customerId",
        "customerContractId"
      ])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");
    if (order.status === "Closed" || order.status === "Cancelled") {
      throw new ServiceOrderError(
        "A closed or cancelled service order cannot change"
      );
    }
    if (order.type === "Refurbishment") {
      throw new ServiceOrderError("A refurbishment has no coverage contract");
    }
    if ((order.customerContractId ?? null) === args.customerContractId) return;

    let contractProjectId: string | null = null;
    if (args.customerContractId) {
      const contract = await trx
        .selectFrom("customerContract")
        .select(["id", "projectId", "billingBasis"])
        .where("id", "=", args.customerContractId)
        .where("companyId", "=", args.companyId)
        .where("customerId", "=", order.customerId ?? "")
        .executeTakeFirst();
      if (!contract) {
        throw new ServiceOrderError(
          "The coverage contract is not one of this customer's contracts"
        );
      }
      if (contract.billingBasis === "Project") {
        throw new ServiceOrderError(
          "A project contract cannot cover a service order."
        );
      }
      contractProjectId = contract.projectId;
    }

    const contractCharges = await trx
      .selectFrom("projectLedger")
      .select(["id", "reversalOfId"])
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .where("coverage", "=", "Contract")
      .execute();
    const open = openChargeIds(contractCharges).length;
    if (open > 0) {
      throw new ServiceOrderError(
        `${
          open === 1
            ? "1 charge of this order is covered by the contract and has posted to its account."
            : `${open} charges of this order are covered by the contract and have posted to its account.`
        } Override the coverage of each Contract charge to Billable or Warranty first, then change the contract.`
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("serviceOrder")
      .set({
        customerContractId: args.customerContractId,
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();
    await trx
      .updateTable("project")
      .set({
        parentProjectId: contractProjectId,
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .execute();
  });
}

// --- Charges -------------------------------------------------------------------

/**
 * The order's project, and that its work tree holds the node. A charge on a
 * node of another order is refused.
 */
export async function requireServiceOrderNode(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    serviceOrderId: string;
    projectElementId?: string | null;
  }
): Promise<{ projectId: string; status: ServiceOrderStatus }> {
  const order = await db
    .selectFrom("serviceOrder")
    .select(["projectId", "status"])
    .where("id", "=", args.serviceOrderId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!order) throw new ServiceOrderError("The service order was not found");
  if (order.status === "Closed" || order.status === "Cancelled") {
    throw new ServiceOrderError(
      `A ${order.status.toLowerCase()} service order takes no charges`
    );
  }
  // Its Service project is Draft, so post-* would refuse with a project
  // message the Service user never sees the word for.
  if (order.status === "Draft") {
    throw new ServiceOrderError(
      "Mark the service order as Planned before you charge it"
    );
  }
  if (args.projectElementId) {
    const node = await db
      .selectFrom("projectElement")
      .select("id")
      .where("id", "=", args.projectElementId)
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!node) {
      throw new ServiceOrderError(
        "The element is not part of this service order"
      );
    }
  }
  return order;
}

/**
 * The Service project a work route changes, a service order's or a service
 * template's, and the page its work lives on. Refuses another project type
 * (the Projects routes own those), a Closed one (its order is Closed or
 * Cancelled), and any of `elementIds` that is not in the project.
 */
export async function requireServiceWork(
  client: SupabaseClient<Database>,
  args: { companyId: string; projectId: string; elementIds?: string[] }
): Promise<{ workPath: string; isTemplate: boolean }> {
  const project = await client
    .from("project")
    .select("id, projectType, status, isTemplate")
    .eq("id", args.projectId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (project.error || project.data?.projectType !== "Service") {
    throw new ServiceOrderError("The service order was not found");
  }
  if (project.data.status === "Closed") {
    throw new ServiceOrderError(
      "A closed or cancelled service order cannot change"
    );
  }

  const ids = [...new Set(args.elementIds ?? [])];
  if (ids.length > 0) {
    const elements = await client
      .from("projectElement")
      .select("id")
      .in("id", ids)
      .eq("projectId", args.projectId)
      .eq("companyId", args.companyId);
    if (elements.error || (elements.data ?? []).length !== ids.length) {
      throw new ServiceOrderError(
        "The element is not part of this service order"
      );
    }
  }

  if (project.data.isTemplate) {
    return {
      workPath: path.to.serviceTemplate(args.projectId),
      isTemplate: true
    };
  }
  const order = await client
    .from("serviceOrder")
    .select("id")
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  return {
    workPath: order.data
      ? path.to.serviceOrderWork(order.data.id)
      : path.to.serviceOrders,
    isTemplate: false
  };
}

/**
 * That the visit is on the order, belongs to the technician and is not done.
 * A technician without `update: "service"` charges and edits only their own
 * open visit; the Kysely writes do not pass through RLS, so the route checks.
 */
export async function requireOwnServiceVisit(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    serviceOrderId: string;
    serviceVisitId: string | null;
    userId: string;
  }
): Promise<void> {
  if (!args.serviceVisitId) {
    throw new ServiceOrderError("You can charge only your own visits");
  }
  const visit = await db
    .selectFrom("serviceVisit")
    .select(["technicianId", "status"])
    .where("id", "=", args.serviceVisitId)
    .where("serviceOrderId", "=", args.serviceOrderId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!visit) throw new ServiceOrderError("The visit was not found");
  if (visit.technicianId !== args.userId) {
    throw new ServiceOrderError("This visit belongs to another technician");
  }
  if (visit.status === "Completed" || visit.status === "Cancelled") {
    throw new ServiceOrderError(
      `A ${visit.status.toLowerCase()} visit takes no changes`
    );
  }
}

/**
 * Adds an expense to a service order's node and posts it through
 * `post-project-expense`. Returns an error message, or null. The entry stays
 * when the posting fails, so the message says it did not post.
 */
export async function addServiceExpense(
  ctx: ServiceContext,
  input: z.infer<typeof serviceExpenseValidator> & { projectId: string }
): Promise<string | null> {
  const args = {
    ...input,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  };
  const entry = await ctx.asSystem.pg
    .insertInto("projectExpenseEntry")
    .values({
      companyId: args.companyId,
      projectId: args.projectId,
      projectElementId: args.projectElementId ?? null,
      serviceVisitId: args.serviceVisitId ?? null,
      employeeId: args.userId,
      entryDate: args.entryDate,
      description: args.description,
      amount: args.amount,
      createdBy: args.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const posting = await invokePosting(
    ctx,
    "post-project-expense",
    { projectExpenseEntryId: entry.id },
    postProjectExpense
  );
  if (posting.error) {
    logger.error("Failed to post a service expense", {
      companyId: args.companyId,
      projectExpenseEntryId: entry.id,
      error: posting.error
    });
    return `The expense is saved but did not post: ${
      posting.error.message || "the posting failed"
    }`;
  }
  return null;
}

/**
 * Moves one charge of the order's project to another coverage through
 * `reclass-project-coverage`. A charge of another order is refused. Returns
 * an error message, or null.
 */
export async function reclassServiceCharge(
  ctx: ServiceContext,
  args: z.infer<typeof coverageOverrideValidator> & {
    projectId: string;
    projectLedgerId: string;
  }
): Promise<string | null> {
  const charge = await ctx.asSystem.pg
    .selectFrom("projectLedger")
    .select("id")
    .where("id", "=", args.projectLedgerId)
    .where("projectId", "=", args.projectId)
    .where("companyId", "=", ctx.company.id)
    .executeTakeFirst();
  if (!charge) {
    throw new ServiceOrderError("The charge is not on this service order");
  }
  const posting = await invokePosting(
    ctx,
    "reclass-project-coverage",
    {
      projectLedgerId: args.projectLedgerId,
      coverage: args.coverage,
      reason: args.reason
    },
    reclassProjectCoverage
  );
  if (posting.error) {
    logger.error("Failed to reclass a service charge", {
      companyId: ctx.company.id,
      projectLedgerId: args.projectLedgerId,
      error: posting.error
    });
    return posting.error.message || "Failed to change the coverage";
  }
  return null;
}

/**
 * Reverses one posted time or expense charge of a service order, with a
 * reason:
 * - time: a timesheet correction to 0 hours (`createTimesheetCorrection`),
 *   posted at once by `post-timesheet`;
 * - an expense: a `projectExpenseEntry` with `reversalOfId`, posted by
 *   `post-project-expense`.
 * Both post at the original's coverage and reverse its billable item. When
 * `onlyVisitId` is set (a technician without `update: "service"`), the charge
 * must belong to that visit. A reversal that exists but did not post is
 * posted again, not written twice. Throws `ServiceOrderError` on a refusal;
 * returns a posting error message, or null.
 */
export async function reverseServiceCharge(
  ctx: ServiceContext,
  input: z.infer<typeof serviceChargeReversalValidator> & {
    projectId: string;
    onlyVisitId: string | null;
  }
): Promise<string | null> {
  const db = ctx.asSystem.pg;
  const args = {
    ...input,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  };
  const charge = await db
    .selectFrom("projectLedger")
    .select(["id", "documentType", "documentId", "reversalOfId"])
    .where("id", "=", args.projectLedgerId)
    .where("projectId", "=", args.projectId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!charge) {
    throw new ServiceOrderError("The charge is not on this service order");
  }
  const reversedBy = await db
    .selectFrom("projectLedger")
    .select("id")
    .where("reversalOfId", "=", charge.id)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (
    !canReverseCharge(charge, new Set(reversedBy ? [charge.id] : [])) ||
    !charge.documentId
  ) {
    throw new ServiceOrderError(
      charge.reversalOfId || reversedBy
        ? "This charge is already reversed"
        : "Only time and expenses are reversed here. Return a part with Issue Part."
    );
  }
  const documentId = charge.documentId;
  const requireVisit = (serviceVisitId: string | null) => {
    if (args.onlyVisitId && serviceVisitId !== args.onlyVisitId) {
      throw new ServiceOrderError(
        "You can reverse only the charges of your own visit"
      );
    }
  };

  if (charge.documentType === "Timesheet") {
    const entry = await db
      .selectFrom("timesheetEntry")
      .select(["id", "serviceVisitId"])
      .where("id", "=", documentId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!entry) throw new ServiceOrderError("The time entry was not found");
    requireVisit(entry.serviceVisitId);

    // A reversal left unposted by a failed posting is posted again.
    const pending = await db
      .selectFrom("timesheetEntry")
      .select("id")
      .where("reversalOfId", "=", entry.id)
      .where("companyId", "=", args.companyId)
      .where("status", "!=", "Posted")
      .executeTakeFirst();
    let reversalId = pending?.id ?? null;
    if (!reversalId) {
      try {
        const correction = await createTimesheetCorrection(db, {
          companyId: args.companyId,
          userId: args.userId,
          timesheetEntryId: entry.id,
          hours: 0,
          correctionReason: args.reason
        });
        reversalId = correction.reversalId;
      } catch (err) {
        throw new ServiceOrderError(
          err instanceof Error ? err.message : "Failed to reverse the time"
        );
      }
    }
    const postingError = await postTimesheetEntries(ctx, {
      timesheetEntryIds: [reversalId]
    });
    return postingError
      ? `The reversal is saved but did not post: ${postingError}`
      : null;
  }

  const reversalId = await db.transaction().execute(async (trx) => {
    // Row lock: two reversals of one expense must not both write.
    const original = await trx
      .selectFrom("projectExpenseEntry")
      .selectAll()
      .where("id", "=", documentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!original) throw new ServiceOrderError("The expense was not found");
    requireVisit(original.serviceVisitId);
    if (original.reversalOfId) {
      throw new ServiceOrderError("This charge is already reversed");
    }

    // A reversal left unposted by a failed posting is posted again.
    const existing = await trx
      .selectFrom("projectExpenseEntry")
      .select(["id", "journalId"])
      .where("reversalOfId", "=", original.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (existing) {
      const posted = await trx
        .selectFrom("projectLedger")
        .select("id")
        .where("documentType", "=", "Project Expense")
        .where("documentId", "=", existing.id)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (existing.journalId || posted) {
        throw new ServiceOrderError("This charge is already reversed");
      }
      return existing.id;
    }

    const row = await trx
      .insertInto("projectExpenseEntry")
      .values(
        buildExpenseReversal(original, {
          reason: args.reason,
          userId: args.userId
        })
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });

  const posting = await invokePosting(
    ctx,
    "post-project-expense",
    { projectExpenseEntryId: reversalId },
    postProjectExpense
  );
  if (posting.error) {
    logger.error("Failed to post a service expense reversal", {
      companyId: args.companyId,
      projectExpenseEntryId: reversalId,
      error: posting.error
    });
    return `The reversal is saved but did not post: ${
      posting.error.message || "the posting failed"
    }`;
  }
  return null;
}

// --- Visits ----------------------------------------------------------------------

/**
 * Schedules a visit, or moves a scheduled visit's technician and window, in
 * one transaction with the order's status roll-up. A closed or cancelled
 * order takes no visit; only a Scheduled visit can be moved.
 */
export async function scheduleServiceVisit(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceVisitValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "status"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");
    if (order.status === "Closed" || order.status === "Cancelled") {
      throw new ServiceOrderError(
        `A ${order.status.toLowerCase()} service order takes no visits`
      );
    }

    const now = datetime.timestamp();
    let id: string;
    if (args.id) {
      const visit = await trx
        .updateTable("serviceVisit")
        .set({
          technicianId: args.technicianId,
          plannedStart: args.plannedStart ?? null,
          plannedEnd: args.plannedEnd ?? null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", args.id)
        .where("serviceOrderId", "=", order.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Scheduled")
        .returning("id")
        .executeTakeFirst();
      if (!visit) {
        throw new ServiceOrderError("Only a scheduled visit can be moved");
      }
      id = visit.id;
    } else {
      const visit = await trx
        .insertInto("serviceVisit")
        .values({
          serviceOrderId: order.id,
          technicianId: args.technicianId,
          plannedStart: args.plannedStart ?? null,
          plannedEnd: args.plannedEnd ?? null,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      id = visit.id;
    }

    await syncServiceOrderStatus(trx, {
      companyId,
      serviceOrderId: order.id,
      userId
    });
    return { id };
  });
}

/**
 * Moves a visit to its next status and stamps when it happened: travel
 * started, arrived, completed. A completing visit answers **Work complete?**:
 * yes completes the order, no leaves it In Progress. Then the order's status
 * rolls up, in the same transaction. `technicianId`, when given, limits the
 * change to that technician's own visit.
 */
export async function setServiceVisitStatus(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    serviceOrderId: string;
    serviceVisitId: string;
    status: ServiceVisitStatus;
    workComplete: boolean;
    technicianId?: string;
  }
): Promise<void> {
  const { companyId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const visit = await trx
      .selectFrom("serviceVisit")
      .select(["id", "status", "technicianId"])
      .where("id", "=", args.serviceVisitId)
      .where("serviceOrderId", "=", args.serviceOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!visit) throw new ServiceOrderError("The visit was not found");
    if (args.technicianId && visit.technicianId !== args.technicianId) {
      throw new ServiceOrderError("This visit belongs to another technician");
    }
    if (!canMoveVisit(visit.status, args.status)) {
      throw new ServiceOrderError(
        `A ${visit.status.toLowerCase()} visit cannot move to ${args.status.toLowerCase()}`
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("serviceVisit")
      .set({
        status: args.status,
        ...(args.status === "Traveling" ? { travelStartedAt: now } : {}),
        ...(args.status === "On Site" ? { arrivedAt: now } : {}),
        ...(args.status === "Completed" ? { completedAt: now } : {}),
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", visit.id)
      .where("companyId", "=", companyId)
      .execute();

    await syncServiceOrderStatus(trx, {
      companyId,
      serviceOrderId: args.serviceOrderId,
      userId,
      workComplete: args.status === "Completed" && args.workComplete
    });
  });
}
