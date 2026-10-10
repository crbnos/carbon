// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Reads and simple writes of field service: customer assets, their
// components and history, service orders, visits and billable items.
// Transactional writes (create an order, register an asset) live in
// `service.server.ts`.

import type { Database, Json } from "@carbon/database";
import { datetime, round } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
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
 * subjects a field visit takes), the Active coverage contracts of their
 * customers, and the service templates. The asset list stops at the
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

/** The fields of an order that change only while it is Draft. */
const DRAFT_ONLY_FIELDS = [
  "customerContactId",
  "customerLocationId",
  "customerContractId"
] as const;

/** The fields only a Refurbishment has; they decide its completion. */
const REFURBISHMENT_FIELDS = [
  "expectedSellingPrice",
  "abnormalRework"
] as const;

/**
 * Saves an order's fields. Contact, site and coverage contract change only
 * while the order is Draft; priority, assignee, invoice detail, problem and
 * resolution change until it is Closed or Cancelled. The expected selling
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
  if (abnormalRework !== undefined) {
    changes.abnormalRework = abnormalRework === "true";
  }
  if (current.data.status !== "Draft") {
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
