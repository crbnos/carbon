// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The building blocks of the service module: reads and writes of customer
// assets and service jobs. The operations that run them are in
// `service.server.ts`.

import { InvalidInputError, NotFoundError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  type PostServiceJobResult,
  postServiceJobInput
} from "@carbon/api/postings";
import type {
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { inOrder, maybeSingle, rpcValue } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import {
  canComplete,
  datetime,
  isServiceJobLocked,
  round
} from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { refreshSalesReturnOrderStatus } from "../sales/sales.service";
import {
  allocateJournalLineIds,
  createAdjustmentJournal,
  insertNegatedJournal,
  isActiveCompanyEmployee,
  refuseUnlessOwned,
  resolveAccountingPeriod
} from "../shared/shared.service";
import type {
  customerAssetUpdateValidator,
  customerAssetValidator,
  ServiceBillingMethod,
  ServiceCoverage,
  ServiceJobPriority,
  ServiceJobStatus,
  ServiceWorkSite,
  serviceJobAssignmentValidator,
  serviceJobEstimateLineValidator,
  serviceJobItemValidator,
  serviceJobTimeValidator,
  WarrantyStatus
} from "./service.models";
import {
  serviceBillingMethods,
  serviceJobPriorities,
  type serviceJobUpdateFields,
  serviceWorkSites
} from "./service.models";
import { planServiceJobInvoiceLines } from "./service-job-invoice-plan";
import {
  buildCoverageReclassLines,
  buildServiceJobCompletionLines,
  serviceCoverageAccount
} from "./service-job-plan";

type Client = SupabaseClient<Database>;

/**
 * A refusal the operation returns as its own message: the item is not
 * serialized, or the serial already exists.
 */
export class CustomerAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerAssetError";
  }
}

// --- Customer assets ---------------------------------------------------------

const CUSTOMER_ASSET_COLUMNS =
  "id, trackedEntityId, itemId, customerId, customerLocationId, status, shippedDate, laborWarrantyEndDate, partsWarrantyEndDate, shipmentId, source, notes, createdAt, updatedAt, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey!inner(id, readableId), item:item!customerAsset_itemId_fkey(id, readableIdWithRevision, name), customer:customer!customerAsset_customerId_fkey(id, name), customerLocation:customerLocation!customerAsset_customerLocationId_fkey(id, name), openServiceJobs:serviceJob!serviceJob_customerAssetId_fkey(count)" as const;

/**
 * The statuses a service job is closed in. A read that selects
 * `CUSTOMER_ASSET_COLUMNS` filters `openServiceJobs` on them, so the embedded
 * count is the asset's open jobs only.
 */
const CLOSED_SERVICE_JOB_STATUSES = '("Completed","Invoiced","Cancelled")';

/**
 * Lists the company's customer assets. Filters: customer, item, the
 * warranty status on `today` (the company's day, `YYYY-MM-DD`) and a serial
 * search.
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
    .not("openServiceJobs.status", "in", CLOSED_SERVICE_JOB_STATUSES);

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
    .not("openServiceJobs.status", "in", CLOSED_SERVICE_JOB_STATUSES)
    .single();
}

/**
 * The RMA lines that returned one customer asset, newest first, with the
 * RMA's number and status.
 */
export async function getSalesReturnLinesByAsset(
  client: Client,
  customerAssetId: string,
  companyId: string
) {
  return client
    .from("salesReturnOrderLine")
    .select(
      "id, returnType, problem, createdAt, salesReturnOrder:salesReturnOrder!salesReturnOrderLine_salesReturnOrderId_fkey(id, salesReturnOrderId, status)"
    )
    .eq("customerAssetId", customerAssetId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

/**
 * Every customer asset of the company, for a picker: its serial, item,
 * owner and warranty end dates.
 */
export async function getCustomerAssetsList(client: Client, companyId: string) {
  return client
    .from("customerAsset")
    .select(
      "id, customerId, customerLocationId, laborWarrantyEndDate, partsWarrantyEndDate, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey!inner(id, readableId), item:item!customerAsset_itemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
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
    if (!item) throw new CustomerAssetError("The item was not found");
    if (item.itemTrackingType !== "Serial") {
      throw new CustomerAssetError("Only a serialized item can be an asset");
    }

    const existing = await trx
      .selectFrom("trackedEntity")
      .select("id")
      .where("companyId", "=", companyId)
      .where("itemId", "=", args.itemId)
      .where("readableId", "=", args.serialNumber)
      .executeTakeFirst();
    if (existing) {
      throw new CustomerAssetError(
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

// --- Service jobs: reads -----------------------------------------------------

const SERVICE_JOB_LIST_COLUMNS =
  "*, customer:customer!serviceJob_customerId_fkey(id, name), customerAsset:customerAsset!serviceJob_customerAssetId_fkey(id, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey(id, readableId)), item:item!serviceJob_itemId_fkey(id, readableIdWithRevision, name), assigneeUser:user!serviceJob_assignee_fkey(id, fullName, avatarUrl)" as const;

/** Lists the company's service jobs, with a search on the job number. */
export async function getServiceJobs(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("serviceJob")
    .select(SERVICE_JOB_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("serviceJobId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

/**
 * One service job with its customer, asset (and warranty), item, assignee, and
 * the RMA line it came from.
 */
export async function getServiceJob(client: Client, id: string) {
  return client
    .from("serviceJob")
    .select(
      "*, customer:customer!serviceJob_customerId_fkey(id, name), customerAsset:customerAsset!serviceJob_customerAssetId_fkey(id, status, laborWarrantyEndDate, partsWarrantyEndDate, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey(id, readableId)), item:item!serviceJob_itemId_fkey(id, readableIdWithRevision, name), serviceItem:item!serviceJob_serviceItemId_fkey(id, readableIdWithRevision, name), assigneeUser:user!serviceJob_assignee_fkey(id, fullName, avatarUrl), salesReturnOrderLine:salesReturnOrderLine!serviceJob_salesReturnOrderLineId_fkey(id, returnType, salesReturnOrder:salesReturnOrder!salesReturnOrderLine_salesReturnOrderId_fkey(id, salesReturnOrderId))"
    )
    .eq("id", id)
    .single();
}

/** A job's time entries, newest day first. */
export async function getServiceJobTime(client: Client, serviceJobId: string) {
  return client
    .from("serviceJobTime")
    .select(
      "*, employee:user!serviceJobTime_employeeId_fkey(id, fullName, avatarUrl), laborItem:item!serviceJobTime_laborItemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("serviceJobId", serviceJobId)
    .order("entryDate", { ascending: false })
    .order("createdAt", { ascending: false });
}

/** A job's parts and charges, in the order they were added. */
export async function getServiceJobItems(client: Client, serviceJobId: string) {
  return client
    .from("serviceJobItem")
    .select(
      "*, item:item!serviceJobItem_itemId_fkey(id, readableIdWithRevision, name, itemTrackingType)"
    )
    .eq("serviceJobId", serviceJobId)
    .order("createdAt", { ascending: true });
}

/** A job's estimate lines, in sort order. */
export async function getServiceJobEstimateLines(
  client: Client,
  serviceJobId: string
) {
  return client
    .from("serviceJobEstimateLine")
    .select(
      "*, item:item!serviceJobEstimateLine_itemId_fkey(id, readableIdWithRevision, name, type)"
    )
    .eq("serviceJobId", serviceJobId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

/**
 * The assignments scheduled from `startDate` to `endDate` (`YYYY-MM-DD`,
 * inclusive), with each job's number, status and customer. With a location,
 * only that location's jobs.
 */
export async function getServiceJobAssignmentsRange(
  client: Client,
  companyId: string,
  args: { startDate: string; endDate: string; locationId?: string | null }
) {
  let query = client
    .from("serviceJobAssignment")
    .select(
      "*, serviceJob:serviceJob!serviceJobAssignment_serviceJobId_fkey!inner(id, serviceJobId, status, priority, locationId, customer:customer!serviceJob_customerId_fkey(id, name))"
    )
    .eq("companyId", companyId)
    .gte("scheduledDate", args.startDate)
    .lte("scheduledDate", args.endDate);

  if (args.locationId) {
    query = query.eq("serviceJob.locationId", args.locationId);
  }

  return query
    .order("scheduledDate", { ascending: true })
    .order("createdAt", { ascending: true });
}

/**
 * The location's open jobs (not Completed, Invoiced or Cancelled) that no one
 * is assigned to: the dispatch grid's backlog.
 */
export async function getServiceBacklog(
  client: Client,
  companyId: string,
  locationId: string
) {
  return client
    .from("serviceJob")
    .select(
      "id, serviceJobId, status, priority, coverage, workSite, dueDate, problem, customer:customer!serviceJob_customerId_fkey(id, name), serviceJobAssignment!serviceJobAssignment_serviceJobId_fkey(id)"
    )
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .not("status", "in", '("Completed","Invoiced","Cancelled")')
    .is("serviceJobAssignment", null)
    .order("dueDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });
}

/** The service jobs of one customer asset, newest first. */
export async function getServiceJobsByAsset(
  client: Client,
  customerAssetId: string
) {
  return client
    .from("serviceJob")
    .select(
      "id, serviceJobId, status, coverage, workSite, problem, createdAt, completedAt"
    )
    .eq("customerAssetId", customerAssetId)
    .order("createdAt", { ascending: false });
}

// --- Service jobs: writes ----------------------------------------------------

export const SERVICE_JOB_LOCKED =
  "This job is closed. A Completed, Invoiced or Cancelled job cannot change.";

/**
 * The job, when it is this company's and not Completed, Invoiced or
 * Cancelled; else the refusal to return.
 */
export async function editableServiceJob(ctx: ServiceContext, jobId: string) {
  const job = await ctx.asCaller.supabase
    .from("serviceJob")
    .select(
      "id, status, coverage, billingMethod, estimateStatus, salesReturnOrderLineId, repairable"
    )
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (job.error) {
    return ctx.error("internal", "Failed to load the service job", job.error);
  }
  if (!job.data) return ctx.error("notFound", "Service job not found");
  if (isServiceJobLocked(job.data.status)) {
    return ctx.error("rule", SERVICE_JOB_LOCKED);
  }
  return job.data;
}

/**
 * The job, locked FOR UPDATE inside a posting's transaction. Throws when the
 * job is not the company's and, with `open`, when it is Completed, Invoiced
 * or Cancelled.
 */
export async function lockServiceJob(
  trx: Transaction<KyselyDatabase>,
  args: { serviceJobId: string; companyId: string; open?: boolean }
) {
  const job = await trx
    .selectFrom("serviceJob")
    .select([
      "id",
      "serviceJobId",
      "status",
      "coverage",
      "billingMethod",
      "estimateStatus",
      "salesReturnOrderLineId",
      "repairable",
      "completionJournalId",
      "locationId",
      "customerId",
      "customerLocationId",
      "serviceItemId",
      "fixedPrice"
    ])
    .where("id", "=", args.serviceJobId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!job) throw new NotFoundError("Service job not found");
  if (args.open && isServiceJobLocked(job.status)) {
    throw new InvalidInputError(SERVICE_JOB_LOCKED);
  }
  return job;
}

/**
 * Inserts a job with the next `serviceJob` number, unless one is given. The
 * operation (`createServiceJob`) checks the ids and chooses the coverage.
 */
export async function insertServiceJob(
  client: Client,
  input: {
    companyId: string;
    createdBy: string;
    serviceJobId?: string;
    status?: ServiceJobStatus;
    customerId: string;
    customerLocationId?: string | null;
    customerContactId?: string | null;
    customerAssetId?: string | null;
    itemId?: string | null;
    trackedEntityId?: string | null;
    locationId: string;
    salesReturnOrderLineId?: string | null;
    workSite: ServiceWorkSite;
    coverage: ServiceCoverage;
    billingMethod: ServiceBillingMethod;
    priority: ServiceJobPriority;
    serviceItemId?: string | null;
    assignee?: string | null;
    dueDate?: string | null;
    problem?: string | null;
  }
): Promise<{
  data: { id: string; serviceJobId: string } | null;
  error: PostgrestError | null;
}> {
  let serviceJobId: string;
  if (input.serviceJobId) {
    serviceJobId = input.serviceJobId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "serviceJob",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate serviceJob sequence"
          } as PostgrestError)
      };
    }
    serviceJobId = seq.data;
  }

  return client
    .from("serviceJob")
    .insert({
      serviceJobId,
      status: input.status ?? "Open",
      customerId: input.customerId,
      customerLocationId: input.customerLocationId ?? null,
      customerContactId: input.customerContactId ?? null,
      customerAssetId: input.customerAssetId ?? null,
      itemId: input.itemId ?? null,
      trackedEntityId: input.trackedEntityId ?? null,
      locationId: input.locationId,
      salesReturnOrderLineId: input.salesReturnOrderLineId ?? null,
      workSite: input.workSite,
      coverage: input.coverage,
      billingMethod: input.billingMethod,
      priority: input.priority,
      serviceItemId: input.serviceItemId ?? null,
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      problem: input.problem ?? null,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, serviceJobId")
    .single();
}

/** Refuses unless `employeeId` is an active employee of the company. */
export async function refuseUnlessEmployee(
  ctx: ServiceContext,
  employeeId: string
) {
  const active = await isActiveCompanyEmployee(
    ctx.asSystem.supabase,
    ctx.company.id,
    employeeId
  );
  return active
    ? null
    : ctx.error("rule", "Choose an employee of this company");
}

/**
 * Refuses unless `itemId` is a Service item of the company: a labor item, a
 * charge or the item a Fixed Price job bills. `what` names it in the message.
 */
export async function refuseUnlessServiceItem(
  ctx: ServiceContext,
  itemId: string,
  what: string
) {
  const item = await ctx.asSystem.supabase
    .from("item")
    .select("id, type")
    .eq("id", itemId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (item.error) {
    return ctx.error("internal", "Failed to load the item", item.error);
  }
  if (!item.data) return ctx.error("notFound", "Item not found");
  if (item.data.type !== "Service") {
    return ctx.error("rule", `${what} must be a Service item`);
  }
  return null;
}

/**
 * The customer asset a job is about, when it is the company's: its unit (item
 * and serial), its owner and its warranty dates.
 */
export async function companyCustomerAsset(
  ctx: ServiceContext,
  customerAssetId: string
) {
  const asset = await ctx.asSystem.supabase
    .from("customerAsset")
    .select(
      "id, customerId, itemId, trackedEntityId, laborWarrantyEndDate, partsWarrantyEndDate"
    )
    .eq("id", customerAssetId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (asset.error) {
    return ctx.error("internal", "Failed to load the asset", asset.error);
  }
  if (!asset.data) return ctx.error("notFound", "Customer asset not found");
  return asset.data;
}

/** The header columns `updateServiceJob` may write. */
export type ServiceJobHeaderUpdate = Partial<
  Pick<
    Database["public"]["Tables"]["serviceJob"]["Update"],
    | "customerId"
    | "customerLocationId"
    | "customerContactId"
    | "customerAssetId"
    | "itemId"
    | "trackedEntityId"
    | "locationId"
    | "workSite"
    | "billingMethod"
    | "priority"
    | "serviceItemId"
    | "assignee"
    | "dueDate"
    | "problem"
    | "findings"
    | "resolution"
    | "repairable"
  >
>;

/**
 * Writes header fields on one or more jobs. Not the status, the coverage or
 * the posting columns: those have their own operations.
 */
export async function updateServiceJob(
  client: Client,
  args: {
    ids: string[];
    companyId: string;
    updatedBy: string;
    values: ServiceJobHeaderUpdate;
  }
) {
  return client
    .from("serviceJob")
    .update({
      ...args.values,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .in("id", args.ids)
    .eq("companyId", args.companyId)
    .select("id");
}

const REQUIRED_FIELD_LABELS: Partial<
  Record<(typeof serviceJobUpdateFields)[number], string>
> = {
  customerId: "Customer",
  locationId: "Location",
  workSite: "Work site",
  billingMethod: "Billing method",
  priority: "Priority"
};

/**
 * The columns one header field sets, from the text a form sent, after the
 * checks that field needs: an id must be the company's, an enum one of its
 * values, a date `YYYY-MM-DD`. An empty value clears the field, except a
 * required one. An asset also sets the job's item and serial.
 */
export async function serviceJobFieldValues(
  ctx: ServiceContext,
  field: (typeof serviceJobUpdateFields)[number],
  value: string | null | undefined
): Promise<ServiceJobHeaderUpdate | CarbonError> {
  const text = value?.trim() ? value : null;
  const required = REQUIRED_FIELD_LABELS[field];
  if (required && !text) {
    return ctx.error("validation", `${required} is required`);
  }
  const refuseUnlessOneOf = (values: readonly string[]) =>
    text && !values.includes(text)
      ? ctx.error("validation", `${required ?? field} is not valid`)
      : null;

  switch (field) {
    case "customerId": {
      const refused = await refuseUnlessOwned(ctx, "customer", { id: text! });
      return refused ?? { customerId: text! };
    }
    case "locationId": {
      const refused = await refuseUnlessOwned(ctx, "location", { id: text! });
      return refused ?? { locationId: text! };
    }
    case "customerLocationId": {
      const refused = text
        ? await refuseUnlessOwned(ctx, "customerLocation", { id: text })
        : null;
      return refused ?? { customerLocationId: text };
    }
    case "customerContactId": {
      const refused = text
        ? await refuseUnlessOwned(ctx, "customerContact", { id: text })
        : null;
      return refused ?? { customerContactId: text };
    }
    case "customerAssetId": {
      if (!text) {
        return { customerAssetId: null, itemId: null, trackedEntityId: null };
      }
      const asset = await companyCustomerAsset(ctx, text);
      if (asset instanceof Error) return asset;
      return {
        customerAssetId: asset.id,
        itemId: asset.itemId,
        trackedEntityId: asset.trackedEntityId
      };
    }
    case "serviceItemId": {
      const refused = text
        ? await refuseUnlessServiceItem(ctx, text, "The billed item")
        : null;
      return refused ?? { serviceItemId: text };
    }
    case "assignee": {
      const refused = text ? await refuseUnlessEmployee(ctx, text) : null;
      return refused ?? { assignee: text };
    }
    case "workSite":
      return (
        refuseUnlessOneOf(serviceWorkSites) ?? {
          workSite: text as ServiceWorkSite
        }
      );
    case "billingMethod":
      return (
        refuseUnlessOneOf(serviceBillingMethods) ?? {
          billingMethod: text as ServiceBillingMethod
        }
      );
    case "priority":
      return (
        refuseUnlessOneOf(serviceJobPriorities) ?? {
          priority: text as ServiceJobPriority
        }
      );
    case "dueDate":
      return text && !/^\d{4}-\d{2}-\d{2}$/.test(text)
        ? ctx.error("validation", "Enter a date")
        : { dueDate: text };
    case "problem":
      return { problem: text };
    case "findings":
    case "resolution": {
      let document: Json = null;
      if (text) {
        try {
          document = JSON.parse(text) as Json;
        } catch {
          return ctx.error("validation", "The notes are not valid");
        }
      }
      return field === "findings"
        ? { findings: document }
        : { resolution: document };
    }
    case "repairable":
      if (text === null) return { repairable: null };
      if (text === "true" || text === "false") {
        return { repairable: text === "true" };
      }
      return ctx.error("validation", "Repairable must be true or false");
  }
}

type EstimateLineInput = Omit<
  z.infer<typeof serviceJobEstimateLineValidator>,
  "id"
>;

/** Adds an estimate line (`createdBy`) or saves one (`id`). */
export async function upsertServiceJobEstimateLine(
  client: Client,
  line:
    | (EstimateLineInput & { companyId: string; createdBy: string })
    | (EstimateLineInput & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const values = {
    itemId: line.itemId,
    description: line.description ?? null,
    quantity: line.quantity,
    unitPrice: line.unitPrice
  };
  if ("createdBy" in line) {
    return client
      .from("serviceJobEstimateLine")
      .insert({
        ...values,
        serviceJobId: line.serviceJobId,
        companyId: line.companyId,
        createdBy: line.createdBy
      })
      .select("id")
      .single();
  }
  return client
    .from("serviceJobEstimateLine")
    .update({
      ...values,
      updatedBy: line.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", line.id)
    .eq("serviceJobId", line.serviceJobId)
    .eq("companyId", line.companyId)
    .select("id")
    .single();
}

export async function deleteServiceJobEstimateLine(
  client: Client,
  args: { id: string; serviceJobId: string; companyId: string }
) {
  return client
    .from("serviceJobEstimateLine")
    .delete()
    .eq("id", args.id)
    .eq("serviceJobId", args.serviceJobId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

type TimeInput = Omit<z.infer<typeof serviceJobTimeValidator>, "id">;

/** Adds a time entry (`createdBy`) or saves one (`id`). */
export async function upsertServiceJobTime(
  client: Client,
  time:
    | (TimeInput & { companyId: string; createdBy: string })
    | (TimeInput & { id: string; companyId: string; updatedBy: string })
) {
  const values = {
    employeeId: time.employeeId,
    laborItemId: time.laborItemId,
    entryDate: time.entryDate,
    hours: time.hours,
    billable: time.billable,
    note: time.note ?? null
  };
  if ("createdBy" in time) {
    return client
      .from("serviceJobTime")
      .insert({
        ...values,
        serviceJobId: time.serviceJobId,
        companyId: time.companyId,
        createdBy: time.createdBy
      })
      .select("id")
      .single();
  }
  return client
    .from("serviceJobTime")
    .update({
      ...values,
      updatedBy: time.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", time.id)
    .eq("serviceJobId", time.serviceJobId)
    .eq("companyId", time.companyId)
    .select("id")
    .single();
}

export async function deleteServiceJobTime(
  client: Client,
  args: { id: string; serviceJobId: string; companyId: string }
) {
  return client
    .from("serviceJobTime")
    .delete()
    .eq("id", args.id)
    .eq("serviceJobId", args.serviceJobId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

type ChargeInput = Omit<z.infer<typeof serviceJobItemValidator>, "id">;

/**
 * Adds a Charge line (`createdBy`) or saves one (`id`). A Part line is
 * written by the `issue` posting, never here, so an update matches Charge
 * lines only.
 */
export async function upsertServiceJobItem(
  client: Client,
  charge:
    | (ChargeInput & { companyId: string; createdBy: string })
    | (ChargeInput & { id: string; companyId: string; updatedBy: string })
) {
  const values = {
    itemId: charge.itemId,
    description: charge.description ?? null,
    quantity: charge.quantity,
    unitOfMeasureCode: charge.unitOfMeasureCode ?? null,
    unitPrice: charge.unitPrice,
    billable: charge.billable
  };
  if ("createdBy" in charge) {
    return client
      .from("serviceJobItem")
      .insert({
        ...values,
        lineType: "Charge",
        serviceJobId: charge.serviceJobId,
        companyId: charge.companyId,
        createdBy: charge.createdBy
      })
      .select("id")
      .single();
  }
  return client
    .from("serviceJobItem")
    .update({
      ...values,
      updatedBy: charge.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", charge.id)
    .eq("serviceJobId", charge.serviceJobId)
    .eq("companyId", charge.companyId)
    .eq("lineType", "Charge")
    .select("id")
    .single();
}

/** Deletes a Charge line. A Part goes back to stock through `issue`. */
export async function deleteServiceJobItem(
  client: Client,
  args: { id: string; serviceJobId: string; companyId: string }
) {
  return client
    .from("serviceJobItem")
    .delete()
    .eq("id", args.id)
    .eq("serviceJobId", args.serviceJobId)
    .eq("companyId", args.companyId)
    .eq("lineType", "Charge")
    .select("id")
    .single();
}

type AssignmentInput = Omit<
  z.infer<typeof serviceJobAssignmentValidator>,
  "id"
>;

/** Schedules a technician on a job for a day (`createdBy`), or saves it (`id`). */
export async function upsertServiceJobAssignment(
  client: Client,
  assignment:
    | (AssignmentInput & { companyId: string; createdBy: string })
    | (AssignmentInput & { id: string; companyId: string; updatedBy: string })
) {
  const values = {
    employeeId: assignment.employeeId,
    scheduledDate: assignment.scheduledDate,
    plannedHours: assignment.plannedHours ?? null,
    note: assignment.note ?? null
  };
  if ("createdBy" in assignment) {
    return client
      .from("serviceJobAssignment")
      .insert({
        ...values,
        serviceJobId: assignment.serviceJobId,
        companyId: assignment.companyId,
        createdBy: assignment.createdBy
      })
      .select("id")
      .single();
  }
  return client
    .from("serviceJobAssignment")
    .update({
      ...values,
      updatedBy: assignment.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", assignment.id)
    .eq("serviceJobId", assignment.serviceJobId)
    .eq("companyId", assignment.companyId)
    .select("id")
    .single();
}

/**
 * Moves an assignment to another technician or day, in one transaction. When
 * the job is already scheduled for that technician on that day, the two merge:
 * the planned hours add (no planned hours on either side leaves none).
 */
export async function moveServiceJobAssignment(
  db: Kysely<KyselyDatabase>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    employeeId: string;
    scheduledDate: string;
  }
): Promise<{ id: string; serviceJobId: string }> {
  return db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom("serviceJobAssignment")
      .select(["id", "serviceJobId", "plannedHours", "note"])
      .where("id", "=", args.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirstOrThrow();

    const target = await trx
      .selectFrom("serviceJobAssignment")
      .select(["id", "plannedHours", "note"])
      .where("companyId", "=", args.companyId)
      .where("serviceJobId", "=", source.serviceJobId)
      .where("employeeId", "=", args.employeeId)
      .where("scheduledDate", "=", args.scheduledDate)
      .where("id", "!=", source.id)
      .executeTakeFirst();

    const now = datetime.timestamp();
    if (target) {
      const plannedHours =
        source.plannedHours === null || target.plannedHours === null
          ? null
          : Number(source.plannedHours) + Number(target.plannedHours);
      await trx
        .updateTable("serviceJobAssignment")
        .set({
          plannedHours,
          note: target.note ?? source.note,
          updatedBy: args.userId,
          updatedAt: now
        })
        .where("id", "=", target.id)
        .where("companyId", "=", args.companyId)
        .execute();
      await trx
        .deleteFrom("serviceJobAssignment")
        .where("id", "=", source.id)
        .where("companyId", "=", args.companyId)
        .execute();
      return { id: target.id, serviceJobId: source.serviceJobId };
    }

    await trx
      .updateTable("serviceJobAssignment")
      .set({
        employeeId: args.employeeId,
        scheduledDate: args.scheduledDate,
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", source.id)
      .where("companyId", "=", args.companyId)
      .execute();
    return { id: source.id, serviceJobId: source.serviceJobId };
  });
}

export async function deleteServiceJobAssignment(
  client: Client,
  args: { id: string; companyId: string }
) {
  return client
    .from("serviceJobAssignment")
    .delete()
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

// --- Service jobs: postings ---------------------------------------------------

export const postServiceJobPermission = {
  update: "service"
} satisfies PermissionRule<z.output<typeof postServiceJobInput>>;

type ServiceJobPostingLine = ReturnType<
  typeof buildServiceJobCompletionLines
>["lines"][number];

/**
 * One 'Service Job' journal of a job's lines, each tagged with the job's
 * location when a Location dimension is active. Returns the journal's id.
 */
async function writeServiceJobJournal(
  trx: Transaction<KyselyDatabase>,
  args: {
    job: { id: string; locationId: string };
    lines: ServiceJobPostingLine[];
    description: string;
    postingStatus: AutomaticJournalStatus;
    postingDate: string;
    companyId: string;
    userId: string;
  }
): Promise<string> {
  const { job, lines, postingStatus, postingDate, companyId, userId } = args;
  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? (await resolveAccountingPeriod(trx, companyId, postingDate, "current"))
          .id
      : null;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId,
    status: postingStatus,
    description: args.description,
    postingDate,
    userId,
    sourceType: "Service Job"
  });

  const lineIds = await allocateJournalLineIds(trx, lines.length);
  const journalLineReference = nanoid();
  await trx
    .insertInto("journalLine")
    .values(
      lines.map((line, index) => ({
        id: lineIds[index],
        journalId,
        accountId: line.accountId,
        description: line.description,
        accountDefaultRole: line.accountDefaultRole,
        amount: line.amount,
        quantity: 1,
        documentType: "Service Job" as const,
        documentId: job.id,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  const location = await trx
    .selectFrom("dimension")
    .innerJoin("company", "company.companyGroupId", "dimension.companyGroupId")
    .select(["dimension.id"])
    .where("company.id", "=", companyId)
    .where("dimension.active", "=", true)
    .where("dimension.entityType", "=", "Location")
    .executeTakeFirst();
  if (location && lineIds.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(
        lineIds.map((journalLineId) => ({
          journalLineId,
          dimensionId: location.id,
          valueId: job.locationId,
          companyId
        }))
      )
      .execute();
  }
  return journalId;
}

/** The account defaults a service job posting reads. */
async function serviceJobAccountDefaults(
  trx: Transaction<KyselyDatabase>,
  companyId: string
) {
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([
      "costOfServiceAccount",
      "costOfGoodsSoldAccount",
      "warrantyExpenseAccount",
      "laborAbsorptionAccount",
      "retainedEarningsAccount"
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Error getting account defaults");
  return defaults;
}

/** Re-derives the RMA status of the line a job was created for. */
async function refreshJobReturnOrder(
  trx: Transaction<KyselyDatabase>,
  salesReturnOrderLineId: string | null,
  companyId: string,
  userId: string
) {
  if (!salesReturnOrderLineId) return;
  const line = await trx
    .selectFrom("salesReturnOrderLine")
    .select(["salesReturnOrderId"])
    .where("id", "=", salesReturnOrderLineId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!line) return;
  await refreshSalesReturnOrderStatus(
    trx,
    line.salesReturnOrderId,
    companyId,
    userId
  );
}

const COMPLETABLE_STATUSES: ReadonlySet<string> = new Set([
  "Open",
  "In Progress",
  "On Hold"
]);

/**
 * Completes, reopens or changes the coverage of a service job, in one
 * transaction with the job row locked.
 *
 * - `complete` posts the job's time: one journal, a pair per labor item, Dr
 *   the coverage account / Cr laborAbsorptionAccount at hours × the labor
 *   item's `itemCost.unitCost`, stored on each time row. Refused without an
 *   accepted estimate when the job needs one (`canComplete`), with a labor
 *   item that has no cost, or with a clock still running.
 * - `reopen` voids that journal with a negated copy and moves a Completed job
 *   back to In Progress. An Invoiced job cannot reopen.
 * - `set-coverage` moves the cost of the parts already issued from the old
 *   coverage account to the new one, in one journal, and sets the coverage.
 *   Refused once the job is Completed.
 *
 * Completing and reopening a job from an RMA line re-derive that RMA's status.
 */
export async function postServiceJob(
  ctx: ServiceContext,
  raw: z.input<typeof postServiceJobInput>
): Promise<PostServiceJobResult> {
  const input = postServiceJobInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const postingDate = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  return db.transaction().execute(async (trx) => {
    // Provisional before the company's accounting cutover, Posted after it.
    const postingStatus = await journalPostingStatus(trx, companyId);
    const now = datetime.timestamp();

    switch (input.action) {
      case "complete": {
        const job = await lockServiceJob(trx, {
          serviceJobId: input.serviceJobId,
          companyId
        });
        if (!COMPLETABLE_STATUSES.has(job.status)) {
          throw new InvalidInputError(
            `A job that is ${job.status} cannot be completed.`
          );
        }
        if (!canComplete(job)) {
          throw new InvalidInputError(
            "This job needs an accepted estimate before it can be completed."
          );
        }

        const [time, defaults] = await Promise.all([
          trx
            .selectFrom("serviceJobTime")
            .innerJoin("item", (join) =>
              join
                .onRef("item.id", "=", "serviceJobTime.laborItemId")
                .onRef("item.companyId", "=", "serviceJobTime.companyId")
            )
            .leftJoin("itemCost", (join) =>
              join
                .onRef("itemCost.itemId", "=", "serviceJobTime.laborItemId")
                .onRef("itemCost.companyId", "=", "serviceJobTime.companyId")
            )
            .select([
              "serviceJobTime.laborItemId",
              "serviceJobTime.hours",
              "serviceJobTime.startTime",
              "serviceJobTime.endTime",
              "item.name as laborItemName",
              "item.readableIdWithRevision as laborItemReadableId",
              "itemCost.unitCost"
            ])
            .where("serviceJobTime.serviceJobId", "=", job.id)
            .where("serviceJobTime.companyId", "=", companyId)
            .execute(),
          serviceJobAccountDefaults(trx, companyId)
        ]);

        const uncosted = time.find(
          (entry) => !(Number(entry.unitCost ?? 0) > 0)
        );
        if (uncosted) {
          throw new InvalidInputError(
            `The labor item ${
              uncosted.laborItemReadableId ?? uncosted.laborItemName
            } has no cost per hour. Set its unit cost first.`
          );
        }
        if (time.some((entry) => entry.startTime && !entry.endTime)) {
          throw new InvalidInputError("Stop the running clock first.");
        }

        // The accounts are resolved only when there is cost to post: an
        // empty default refuses nothing that writes no line.
        const costs = time.map((entry) => ({
          laborItemId: entry.laborItemId,
          laborItemName: entry.laborItemName,
          hours: Number(entry.hours),
          unitCost: Number(entry.unitCost)
        }));
        const { lines } = costs.some((entry) => entry.hours > 0)
          ? buildServiceJobCompletionLines({
              coverage: job.coverage,
              coverageAccountId: serviceCoverageAccount(
                defaults,
                job.coverage,
                postingStatus
              ),
              laborAbsorption: resolveDefaultAccount(
                defaults,
                "laborAbsorptionAccount",
                postingStatus
              ),
              time: costs
            })
          : { lines: [] };

        const journalId =
          lines.length > 0
            ? await writeServiceJobJournal(trx, {
                job,
                lines,
                description: `Service Job ${job.serviceJobId}`,
                postingStatus,
                postingDate,
                companyId,
                userId
              })
            : null;

        // Each entry keeps the cost it was posted at.
        if (time.length > 0) {
          await trx
            .updateTable("serviceJobTime")
            .from("itemCost")
            .set((eb) => ({
              unitCost: eb.ref("itemCost.unitCost"),
              updatedBy: userId,
              updatedAt: now
            }))
            .whereRef("itemCost.itemId", "=", "serviceJobTime.laborItemId")
            .whereRef("itemCost.companyId", "=", "serviceJobTime.companyId")
            .where("serviceJobTime.serviceJobId", "=", job.id)
            .where("serviceJobTime.companyId", "=", companyId)
            .execute();
        }

        await trx
          .updateTable("serviceJob")
          .set({
            status: "Completed",
            completedAt: now,
            completionJournalId: journalId,
            ...(input.signedByName !== undefined
              ? { signedByName: input.signedByName }
              : {}),
            ...(input.signaturePath !== undefined
              ? { signaturePath: input.signaturePath }
              : {}),
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", job.id)
          .where("companyId", "=", companyId)
          .execute();

        await refreshJobReturnOrder(
          trx,
          job.salesReturnOrderLineId,
          companyId,
          userId
        );
        return {
          success: true,
          serviceJobId: job.id,
          status: "Completed",
          journalId
        };
      }

      case "reopen": {
        const job = await lockServiceJob(trx, {
          serviceJobId: input.serviceJobId,
          companyId
        });
        if (job.status === "Invoiced") {
          throw new InvalidInputError("An invoiced job cannot be reopened.");
        }
        if (job.status !== "Completed") {
          throw new InvalidInputError(
            `A job that is ${job.status} cannot be reopened.`
          );
        }

        let journalId: string | null = null;
        if (job.completionJournalId) {
          const originalLines = await trx
            .selectFrom("journalLine")
            .selectAll()
            .where("journalId", "=", job.completionJournalId)
            .where("companyId", "=", companyId)
            .execute();
          journalId = await insertNegatedJournal(trx, {
            companyId,
            userId,
            originalLines,
            description: `Reopen Service Job ${job.serviceJobId}`,
            sourceType: "Service Job",
            postingStatus,
            date: postingDate,
            periodMode: "current",
            postedAt: now
          });
        }

        await trx
          .updateTable("serviceJobTime")
          .set({ unitCost: null, updatedBy: userId, updatedAt: now })
          .where("serviceJobId", "=", job.id)
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("serviceJob")
          .set({
            status: "In Progress",
            completedAt: null,
            completionJournalId: null,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", job.id)
          .where("companyId", "=", companyId)
          .execute();

        await refreshJobReturnOrder(
          trx,
          job.salesReturnOrderLineId,
          companyId,
          userId
        );
        return {
          success: true,
          serviceJobId: job.id,
          status: "In Progress",
          journalId
        };
      }

      case "set-coverage": {
        const job = await lockServiceJob(trx, {
          serviceJobId: input.serviceJobId,
          companyId,
          open: true
        });
        if (job.coverage === input.coverage) {
          return {
            success: true,
            serviceJobId: job.id,
            status: job.status,
            journalId: null
          };
        }

        // What the issued parts cost, net of returns: the job's own cost rows
        // are signed, issues negative.
        const [booked, defaults] = await Promise.all([
          trx
            .selectFrom("costLedger")
            .select((eb) => eb.fn.sum<number>("cost").as("cost"))
            .where("documentType", "=", "Service Job Consumption")
            .where("documentId", "=", job.id)
            .where("companyId", "=", companyId)
            .executeTakeFirst(),
          serviceJobAccountDefaults(trx, companyId)
        ]);
        const partsCost = -Number(booked?.cost ?? 0);

        const lines = buildCoverageReclassLines({
          from: {
            coverage: job.coverage,
            accountId: serviceCoverageAccount(
              defaults,
              job.coverage,
              postingStatus
            )
          },
          to: {
            coverage: input.coverage,
            accountId: serviceCoverageAccount(
              defaults,
              input.coverage,
              postingStatus
            )
          },
          partsCost
        });
        const journalId =
          lines.length > 0
            ? await writeServiceJobJournal(trx, {
                job,
                lines,
                description: `Service Job ${job.serviceJobId} coverage ${job.coverage} to ${input.coverage}`,
                postingStatus,
                postingDate,
                companyId,
                userId
              })
            : null;

        await trx
          .updateTable("serviceJob")
          .set({ coverage: input.coverage, updatedBy: userId, updatedAt: now })
          .where("id", "=", job.id)
          .where("companyId", "=", companyId)
          .execute();
        return {
          success: true,
          serviceJobId: job.id,
          status: job.status,
          journalId
        };
      }
    }
  });
}

// --- Service jobs: the invoice ------------------------------------------------
//
// Invoices a Completed Billable job: one Draft sales invoice of its billable
// time, parts and charges, or of its fixed price (`planServiceJobInvoiceLines`).
// It follows create-service-order-invoice (sequence, opportunity, header,
// salesInvoiceShipment, then lines). Every line carries `serviceJobId`, so
// post-sales-invoice posts revenue only for it: the parts already left stock
// when they were issued, and the time posted its cost at completion.

export const createServiceInvoiceInput = z.object({
  serviceJobId: z.string().min(1)
});

export type CreateServiceInvoiceResult = {
  success: true;
  salesInvoiceId: string;
  /** The readable invoice id. */
  invoiceId: string;
};

export const createServiceInvoicePermission = {
  update: "service",
  create: "invoicing"
} satisfies PermissionRule<z.output<typeof createServiceInvoiceInput>>;

/**
 * Drafts the invoice of one Completed Billable service job, in one
 * transaction:
 * 1. locks the job and refuses unless it is Completed and Billable;
 * 2. builds the lines (`planServiceJobInvoiceLines`): Time and Materials bills
 *    Σ billable hours × each labor item's sale price, then each billable
 *    Part and Charge; Fixed Price bills the service item at the fixed price;
 * 3. inserts the opportunity, the header (the customer, the job's location,
 *    the customer's payment term and currency) and `salesInvoiceShipment`;
 * 4. inserts the lines, each with `serviceJobId`;
 * 5. stamps the job with the invoice and sets it Invoiced.
 * Tax stays at 0, as create-service-order-invoice did.
 */
export async function createServiceInvoice(
  ctx: ServiceContext,
  raw: z.input<typeof createServiceInvoiceInput>
): Promise<CreateServiceInvoiceResult> {
  const { serviceJobId } = createServiceInvoiceInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  return db.transaction().execute(async (trx) => {
    // Row lock: two invoices of one job must not both bill it.
    const job = await lockServiceJob(trx, { serviceJobId, companyId });
    if (job.status === "Invoiced") {
      throw new InvalidInputError(
        `Service job ${job.serviceJobId} is already invoiced.`
      );
    }
    if (job.status !== "Completed") {
      throw new InvalidInputError(
        `Service job ${job.serviceJobId} is ${job.status}. Only a Completed job is invoiced.`
      );
    }
    if (job.coverage !== "Billable") {
      throw new InvalidInputError(
        `Service job ${job.serviceJobId} is ${job.coverage}. Only a Billable job is invoiced.`
      );
    }
    const customerId = job.customerId;

    const [time, items, serviceItem, customerPayment, customer, company] =
      await inOrder([
        () =>
          trx
            .selectFrom("serviceJobTime")
            .innerJoin("item", (join) =>
              join
                .onRef("item.id", "=", "serviceJobTime.laborItemId")
                .onRef("item.companyId", "=", "serviceJobTime.companyId")
            )
            .leftJoin("itemUnitSalePrice", (join) =>
              join
                .onRef(
                  "itemUnitSalePrice.itemId",
                  "=",
                  "serviceJobTime.laborItemId"
                )
                .onRef(
                  "itemUnitSalePrice.companyId",
                  "=",
                  "serviceJobTime.companyId"
                )
            )
            .select([
              "serviceJobTime.laborItemId",
              "serviceJobTime.hours",
              "serviceJobTime.billable",
              "item.name as laborItemName",
              "item.unitOfMeasureCode",
              "itemUnitSalePrice.unitSalePrice",
              "itemUnitSalePrice.salesUnitOfMeasureCode"
            ])
            .where("serviceJobTime.serviceJobId", "=", job.id)
            .where("serviceJobTime.companyId", "=", companyId)
            .orderBy("serviceJobTime.entryDate")
            .orderBy("serviceJobTime.createdAt")
            .orderBy("serviceJobTime.id")
            .execute(),
        () =>
          trx
            .selectFrom("serviceJobItem")
            .innerJoin("item", (join) =>
              join
                .onRef("item.id", "=", "serviceJobItem.itemId")
                .onRef("item.companyId", "=", "serviceJobItem.companyId")
            )
            .select([
              "serviceJobItem.lineType",
              "serviceJobItem.itemId",
              "serviceJobItem.description",
              "serviceJobItem.quantity",
              "serviceJobItem.unitPrice",
              "serviceJobItem.billable",
              "serviceJobItem.unitOfMeasureCode",
              "item.name as itemName",
              "item.unitOfMeasureCode as itemUnitOfMeasureCode"
            ])
            .where("serviceJobItem.serviceJobId", "=", job.id)
            .where("serviceJobItem.companyId", "=", companyId)
            .orderBy("serviceJobItem.createdAt")
            .orderBy("serviceJobItem.id")
            .execute(),
        async () =>
          job.billingMethod === "Fixed Price" && job.serviceItemId
            ? trx
                .selectFrom("item")
                .select(["name", "unitOfMeasureCode"])
                .where("id", "=", job.serviceItemId)
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            : undefined,
        () => maybeSingle(trx, "customerPayment", { customerId, companyId }),
        () => maybeSingle(trx, "customer", { id: customerId, companyId }),
        () =>
          maybeSingle(
            trx,
            "company",
            { id: companyId },
            { columns: ["baseCurrencyCode"] }
          )
      ]);
    if (customerPayment.error) throw customerPayment.error;
    if (customer.error) throw customer.error;
    if (company.error) throw company.error;

    const lines = planServiceJobInvoiceLines({
      job: {
        serviceJobId: job.serviceJobId,
        billingMethod: job.billingMethod,
        serviceItemId: job.serviceItemId,
        fixedPrice: job.fixedPrice === null ? null : Number(job.fixedPrice)
      },
      serviceItem: serviceItem ?? null,
      time: time.map((entry) => ({
        laborItemId: entry.laborItemId,
        laborItemName: entry.laborItemName,
        hours: Number(entry.hours),
        billable: entry.billable,
        unitSalePrice:
          entry.unitSalePrice === null ? null : Number(entry.unitSalePrice),
        unitOfMeasureCode:
          entry.salesUnitOfMeasureCode ?? entry.unitOfMeasureCode
      })),
      items: items.map((item) => ({
        lineType: item.lineType,
        itemId: item.itemId,
        description: item.description || item.itemName,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        billable: item.billable,
        unitOfMeasureCode: item.unitOfMeasureCode ?? item.itemUnitOfMeasureCode
      }))
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
      lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
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
        locationId: job.locationId,
        paymentTermId: customerPayment.data?.paymentTermId ?? null,
        currencyCode,
        exchangeRate,
        customerReference: job.serviceJobId,
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
        locationId: job.locationId,
        customerLocationId: job.customerLocationId,
        shippingCost: 0,
        companyId,
        createdBy: userId
      })
      .execute();

    await trx
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
          locationId: job.locationId,
          serviceJobId: job.id,
          sortOrder: index + 1,
          companyId,
          createdBy: userId
        }))
      )
      .execute();

    await trx
      .updateTable("serviceJob")
      .set({
        status: "Invoiced",
        salesInvoiceId: invoice.id,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", job.id)
      .where("companyId", "=", companyId)
      .execute();

    return {
      success: true,
      salesInvoiceId: invoice.id,
      invoiceId: readableInvoiceId
    };
  });
}
