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
    .select(columns, { count: LIST_COUNT })
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
      "*, trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(id, readableId), item:item!serviceOrder_itemId_fkey(id, readableIdWithRevision, name), customerAsset:customerAsset!serviceOrder_asset_fkey(id, status, shippedDate, laborWarrantyEndDate, partsWarrantyEndDate), customer:customer!serviceOrder_customerId_fkey(id, name), customerLocation:customerLocation!serviceOrder_customerLocationId_fkey(id, name), customerContact:customerContact!serviceOrder_customerContactId_fkey(id), customerContract:customerContract!serviceOrder_contract_fkey(id, customerContractId, name, status, projectId), location:location!serviceOrder_locationId_fkey(id, name), project:project!serviceOrder_project_fkey(id, identifier, name, status)"
    )
    .eq("id", serviceOrderId)
    .eq("companyId", companyId)
    .single();
}

/** The fields of an order that change only while it is Draft. */
const DRAFT_ONLY_FIELDS = [
  "customerContactId",
  "customerLocationId",
  "customerContractId"
] as const;

/**
 * Saves an order's fields. Contact, site and coverage contract change only
 * while the order is Draft; priority, assignee, invoice detail, problem and
 * resolution change until it is Closed or Cancelled.
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
    .select("status")
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

  const { id, companyId, updatedBy, ...fields } = order;
  const changes: Record<string, unknown> = { ...fields };
  if (current.data.status !== "Draft") {
    for (const field of DRAFT_ONLY_FIELDS) delete changes[field];
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
 * Lists visits, with their order, customer, site and subject. Filters: a
 * technician, a planned-start window (`from` inclusive, `to` exclusive;
 * timestamps) and statuses.
 */
export async function getServiceVisits(
  client: Client,
  companyId: string,
  args: {
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

  if (args.technicianId) query = query.eq("technicianId", args.technicianId);
  if (args.from) query = query.gte("plannedStart", args.from);
  if (args.to) query = query.lt("plannedStart", args.to);
  if (args.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }

  return query.order("plannedStart", { ascending: true, nullsFirst: false });
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
