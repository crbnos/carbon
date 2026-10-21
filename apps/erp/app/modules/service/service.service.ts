// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Reads and simple writes of field service: customer assets, their
// components and history, service orders, visits and billable items.
// Transactional writes (create an order, register an asset) live in
// `service.server.ts`.

import { NotFoundError, ServerFnError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone, journalReference } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { inOrder, maybeSingle, rpcValue } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { credit, datetime, debit, round } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  allocateJournalLineIds,
  createAdjustmentJournal,
  resolveAccountingPeriod,
  resolveInventoryAccount
} from "~/modules/shared/shared.service";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
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
  customerAssetUpdateValidator,
  ServiceOrderStatus,
  ServiceVisitStatus,
  serviceBillableItemValidator,
  serviceOrderUpdateValidator,
  serviceVisitValidator,
  WarrantyStatus
} from "./service.models";
import { closedServiceOrderStatuses } from "./service.models";
import { planServiceInvoiceLines } from "./service-invoice-plan";

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
