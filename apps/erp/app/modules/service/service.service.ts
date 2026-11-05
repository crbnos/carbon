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
import { getCompanyTimeZone, journalReference } from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  journalPostingStatus,
  postingStatusFor,
  readAccountingCutoverDate,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { inOrder, maybeSingle, rpcValue } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { ServiceJobEstimateEmail } from "@carbon/documents/email";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import {
  coverageAccountRole,
  datetime,
  documentHasImages,
  EPSILON,
  isServiceJobLocked,
  manualHoursForDay,
  richTextToPlainText,
  round,
  textToRichTextDoc,
  toBaseAmount
} from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { render } from "react-email";
import { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { stripSpecialCharacters } from "~/utils/string";
import {
  diffLaborGroups,
  type LaborDimension,
  type LaborGroup,
  withoutSupersededEntries
} from "../resources/resources.service";
import {
  getCustomerContact,
  refreshSalesReturnOrderStatus
} from "../sales/sales.service";
import {
  allocateJournalLineIds,
  createAdjustmentJournal,
  invokePosting,
  isActiveCompanyEmployee,
  refuseUnlessOwned,
  resolveAccountingPeriod,
  TIME_ENTRY_BEFORE_CUTOVER_ERROR
} from "../shared/shared.service";
import { getUser } from "../users/users.service";
import type {
  customerAssetPatchValidator,
  customerAssetValidator,
  ServiceBillingMethod,
  ServiceCoverage,
  ServiceEstimateStatus,
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
  buildServiceTimeCostGroups,
  type ServiceJobJournalLine,
  serviceCoverageAccount
} from "./service-job-plan";

type Client = SupabaseClient<Database>;

const logger = getLogger("erp", "service");

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
 * warranty end dates and the notes. A field left out keeps its value. A unit
 * is registered with `registerCustomerAsset` (`service.server.ts`); shipments
 * create the rest.
 */
export async function upsertCustomerAsset(
  client: Client,
  asset: z.infer<typeof customerAssetPatchValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("customerAsset")
    .update({
      ...(asset.customerLocationId !== undefined
        ? { customerLocationId: asset.customerLocationId }
        : {}),
      ...(asset.laborWarrantyEndDate !== undefined
        ? { laborWarrantyEndDate: asset.laborWarrantyEndDate }
        : {}),
      ...(asset.partsWarrantyEndDate !== undefined
        ? { partsWarrantyEndDate: asset.partsWarrantyEndDate }
        : {}),
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
      "*, customer:customer!serviceJob_customerId_fkey(id, name), customerAsset:customerAsset!serviceJob_customerAssetId_fkey(id, status, laborWarrantyEndDate, partsWarrantyEndDate, trackedEntity:trackedEntity!customerAsset_trackedEntityId_fkey(id, readableId)), item:item!serviceJob_itemId_fkey(id, readableIdWithRevision, name), assigneeUser:user!serviceJob_assignee_fkey(id, fullName, avatarUrl), salesReturnOrderLine:salesReturnOrderLine!serviceJob_salesReturnOrderLineId_fkey(id, returnType, salesReturnOrder:salesReturnOrder!salesReturnOrderLine_salesReturnOrderId_fkey(id, salesReturnOrderId))"
    )
    .eq("id", id)
    .single();
}

/** A job's time entries, newest day first. */
export async function getServiceJobTime(client: Client, serviceJobId: string) {
  return client
    .from("serviceJobTime")
    .select(
      "*, employee:user!serviceJobTime_employeeId_fkey(id, fullName, avatarUrl)"
    )
    .eq("serviceJobId", serviceJobId)
    .order("entryDate", { ascending: false })
    .order("createdAt", { ascending: false });
}

/**
 * A job's parts and charges, in the order they were added. A charge paid by a
 * reimbursement or supplier invoice line carries that document's number.
 */
export async function getServiceJobItems(client: Client, serviceJobId: string) {
  return client
    .from("serviceJobItem")
    .select(
      "*, item:item!serviceJobItem_itemId_fkey(id, readableIdWithRevision, name, itemTrackingType), reimbursementLine:reimbursementLine!serviceJobItem_reimbursementLineId_fkey(id, reimbursement:reimbursement!reimbursementLine_reimbursementId_fkey(id, reimbursementId)), purchaseInvoiceLine:purchaseInvoiceLine!serviceJobItem_purchaseInvoiceLineId_fkey(id, purchaseInvoice:purchaseInvoice!purchaseInvoiceLines_invoiceId_fkey(id, invoiceId))"
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
      "id, status, coverage, billingMethod, estimateStatus, salesReturnOrderLineId, repairable, laborBillRate"
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
      "locationId",
      "customerId",
      "customerLocationId",
      "fixedPrice",
      "laborBillRate"
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
 * operation (`createServiceJob`) checks the ids and chooses the coverage. The
 * job's bill rate is the company's default (Settings → Service).
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
    assignee?: string | null;
    dueDate?: string | null;
    /** A TipTap document; text from a short field goes through `textToRichTextDoc`. */
    problem?: Json | null;
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

  const settings = await client
    .from("companySettings")
    .select("serviceLaborBillRate")
    .eq("id", input.companyId)
    .maybeSingle();
  if (settings.error) return { data: null, error: settings.error };

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
      laborBillRate: settings.data?.serviceLaborBillRate ?? null,
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

/**
 * A job's problem as the TipTap document the column holds. The editor posts
 * its document as JSON; a caller that sends plain text gets it as
 * paragraphs. An empty document is null, so "no problem described" reads
 * the same however the job was opened.
 */
export function problemDocument(value: string | null | undefined): Json | null {
  if (!value?.trim()) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Plain text, below.
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return textToRichTextDoc(value) as Json | null;
  }
  return richTextToPlainText(parsed) || documentHasImages(parsed)
    ? (parsed as Json)
    : null;
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
 * Refuses unless `itemId` is a Service item of the company, as a charge
 * needs. `what` names it in the message.
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

/** Refused when a time entry needs the company's cost rate and none is set. */
export const SERVICE_LABOR_COST_RATE_MISSING =
  "Set the labor cost rate in Settings → Service.";

/**
 * Refuses a time write while the company has no labor cost rate
 * (Settings → Service): the entry's cost could not post.
 */
export async function refuseWithoutLaborCostRate(ctx: ServiceContext) {
  const settings = await ctx.asSystem.supabase
    .from("companySettings")
    .select("serviceLaborCostRate")
    .eq("id", ctx.company.id)
    .maybeSingle();
  if (settings.error) {
    return ctx.error(
      "internal",
      "Failed to load the company settings",
      settings.error
    );
  }
  if (
    settings.data?.serviceLaborCostRate === null ||
    settings.data?.serviceLaborCostRate === undefined
  ) {
    return ctx.error("rule", SERVICE_LABOR_COST_RATE_MISSING);
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
    | "laborBillRate"
    | "fixedPrice"
    | "priority"
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

/**
 * Sets the bill rate on one or more jobs and, in the same transaction, the
 * unit price of their Labor estimate lines (the lines with no item).
 */
export async function updateServiceJobLaborBillRate(
  db: Kysely<KyselyDatabase>,
  args: {
    ids: string[];
    companyId: string;
    updatedBy: string;
    laborBillRate: number | null;
  }
) {
  const updatedAt = datetime.timestamp();
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("serviceJob")
      .set({
        laborBillRate: args.laborBillRate,
        updatedBy: args.updatedBy,
        updatedAt
      })
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .execute();
    if (args.laborBillRate === null) return;
    await trx
      .updateTable("serviceJobEstimateLine")
      .set({
        unitPrice: args.laborBillRate,
        updatedBy: args.updatedBy,
        updatedAt
      })
      .where("serviceJobId", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .where("itemId", "is", null)
      .execute();
  });
}

/** Refused when the bill rate changes after the customer saw the estimate. */
export const SERVICE_JOB_BILL_RATE_LOCKED =
  "The bill rate is locked: the estimate was sent to the customer.";

/**
 * The refusal a header field change gets from the jobs it would change, else
 * null. A customer location, contact or asset must be each job's customer's.
 * A job from a return or on an asset keeps its customer. A job with a Part
 * line keeps its location: the parts were issued from it. The bill rate is
 * locked once the estimate is Sent or Accepted, and only a Fixed Price job
 * takes a fixed price.
 */
export async function serviceJobFieldRefusal(
  ctx: ServiceContext,
  jobs: {
    id: string;
    customerId: string;
    salesReturnOrderLineId: string | null;
    customerAssetId: string | null;
    estimateStatus: ServiceEstimateStatus | null;
    billingMethod: ServiceBillingMethod;
  }[],
  field: (typeof serviceJobUpdateFields)[number],
  value: string | null | undefined
): Promise<CarbonError | null> {
  const text = value?.trim() ? value : null;
  const customerIds = [...new Set(jobs.map((job) => job.customerId))];

  switch (field) {
    case "customerId":
      if (
        jobs.some(
          (job) =>
            job.customerId !== text &&
            (job.salesReturnOrderLineId || job.customerAssetId)
        )
      ) {
        return ctx.error(
          "rule",
          "A job from a return or on a customer asset keeps its customer."
        );
      }
      return null;
    case "customerLocationId":
    case "customerContactId": {
      if (!text) return null;
      const table =
        field === "customerLocationId" ? "customerLocation" : "customerContact";
      for (const customerId of customerIds) {
        const refused = await refuseUnlessOwned(ctx, table, {
          id: text,
          customerId
        });
        if (refused) return refused;
      }
      return null;
    }
    case "customerAssetId": {
      if (!text) return null;
      const asset = await companyCustomerAsset(ctx, text);
      if (asset instanceof Error) return asset;
      if (customerIds.some((customerId) => customerId !== asset.customerId)) {
        return ctx.error("rule", "The asset belongs to another customer");
      }
      return null;
    }
    case "locationId": {
      const parts = await ctx.asSystem.supabase
        .from("serviceJobItem")
        .select("id", { count: "exact", head: true })
        .in(
          "serviceJobId",
          jobs.map((job) => job.id)
        )
        .eq("companyId", ctx.company.id)
        .eq("lineType", "Part");
      if (parts.error) {
        return ctx.error(
          "internal",
          "Failed to load the job's parts",
          parts.error
        );
      }
      if ((parts.count ?? 0) > 0) {
        return ctx.error(
          "rule",
          "Return the issued parts before changing the job's location."
        );
      }
      return null;
    }
    case "laborBillRate":
      return jobs.some(
        (job) =>
          job.estimateStatus === "Sent" || job.estimateStatus === "Accepted"
      )
        ? ctx.error("rule", SERVICE_JOB_BILL_RATE_LOCKED)
        : null;
    case "fixedPrice":
      return jobs.some((job) => job.billingMethod !== "Fixed Price")
        ? ctx.error("rule", "Only a Fixed Price job has a fixed price.")
        : null;
    default:
      return null;
  }
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
    case "laborBillRate":
    case "fixedPrice": {
      if (text === null) {
        return field === "laborBillRate"
          ? { laborBillRate: null }
          : { fixedPrice: null };
      }
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount < 0) {
        return ctx.error(
          "validation",
          field === "laborBillRate"
            ? "The bill rate must be a number of 0 or more"
            : "The fixed price must be a number of 0 or more"
        );
      }
      return field === "laborBillRate"
        ? { laborBillRate: round(amount) }
        : { fixedPrice: round(amount) };
    }
    case "problem":
      return { problem: problemDocument(text) };
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
  "id" | "unitPrice"
> & { unitPrice: number };

/**
 * Adds an estimate line (`createdBy`) or saves one (`id`). A line with no
 * item is a Labor line.
 */
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
    itemId: line.itemId ?? null,
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

/**
 * Stops every clock still running on a job, in one statement: its end time
 * is now, its hours the time since it started (never negative, at the
 * internal scale), and its day the company's day it started on, as the MES
 * `stopServiceClock` computes them with `clockHours` and
 * `datetime.businessDay`. Returns the ids of the entries it stopped. The
 * caller posts their cost.
 */
export async function stopServiceJobClocks(
  db: Kysely<KyselyDatabase>,
  args: { serviceJobId: string; companyId: string; updatedBy: string }
): Promise<string[]> {
  const timeZone = await getCompanyTimeZone(db, args.companyId);
  const endTime = datetime.timestamp();
  const stopped = await db
    .updateTable("serviceJobTime")
    .set({
      endTime,
      hours: sql<number>`GREATEST(0, ROUND((EXTRACT(EPOCH FROM (${endTime}::timestamptz - "startTime")) / 3600)::numeric, 5))`,
      entryDate: sql<string>`("startTime" AT TIME ZONE ${timeZone})::date`,
      updatedBy: args.updatedBy,
      updatedAt: endTime
    })
    .where("serviceJobId", "=", args.serviceJobId)
    .where("companyId", "=", args.companyId)
    .where("startTime", "is not", null)
    .where("endTime", "is", null)
    .returning("id")
    .execute();
  return stopped.map((row) => row.id);
}

export const SERVICE_DAY_HAS_CLOCK_TIME =
  "This day has clock time on the job. Edit it on the job.";

/**
 * My Time: sets an employee's total hours on a job for one day. The
 * difference from the day's clock entries goes to the day's one manual entry
 * (no clock): saved, added, or removed at 0. Then the job's time cost is
 * reconciled in the same transaction (`reconcileServiceJobTime`). A total
 * below the clock entries writes nothing (`saved: false`) and comes back as
 * `warning`. Locks the job FOR UPDATE and refuses a Completed, Invoiced or
 * Cancelled one. Any employee may log time on any open job, as on the MES
 * clock: the assignee owns the job, but more than one person works on it.
 */
export async function setServiceJobDayHours(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    employeeId: string;
    serviceJobId: string;
    entryDate: string;
    hours: number;
  }
): Promise<{ saved: boolean; warning: string | null }> {
  return db.transaction().execute(async (trx) => {
    const job = await lockServiceJob(trx, {
      serviceJobId: args.serviceJobId,
      companyId: args.companyId,
      open: true
    });

    const dayEntries = await trx
      .selectFrom("serviceJobTime")
      .select(["id", "hours", "startTime"])
      .where("serviceJobId", "=", job.id)
      .where("companyId", "=", args.companyId)
      .where("employeeId", "=", args.employeeId)
      .where("entryDate", "=", args.entryDate)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    const entries = dayEntries.map((entry) => ({
      id: entry.id,
      hours: Number(entry.hours),
      startTime: entry.startTime ? String(entry.startTime) : null
    }));

    const manual = manualHoursForDay(entries, args.hours);
    if (manual === null) {
      return { saved: false, warning: SERVICE_DAY_HAS_CLOCK_TIME };
    }
    const manualEntries = entries.filter((entry) => !entry.startTime);
    if (manualEntries.length > 1) {
      throw new InvalidInputError(
        "This day has more than one entry on the job. Edit it on the job."
      );
    }
    const existing = manualEntries[0];

    if (manual === 0) {
      if (existing) {
        await trx
          .deleteFrom("serviceJobTime")
          .where("id", "=", existing.id)
          .where("companyId", "=", args.companyId)
          .execute();
      }
    } else if (existing) {
      await trx
        .updateTable("serviceJobTime")
        .set({
          hours: manual,
          updatedBy: args.userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", existing.id)
        .where("companyId", "=", args.companyId)
        .execute();
    } else {
      await trx
        .insertInto("serviceJobTime")
        .values({
          companyId: args.companyId,
          serviceJobId: job.id,
          employeeId: args.employeeId,
          entryDate: args.entryDate,
          hours: manual,
          billable: job.coverage === "Billable",
          createdBy: args.userId
        })
        .execute();
    }

    await reconcileServiceJobTime(trx, {
      companyId: args.companyId,
      serviceJobId: job.id,
      userId: args.userId
    });
    return { saved: true, warning: null };
  });
}

type ChargeInput = Omit<
  z.infer<typeof serviceJobItemValidator>,
  "id" | "reimbursementLineId" | "purchaseInvoiceLineId"
> & {
  /** Base currency, from the linked cost line (`chargeCost`); 0 with no link. */
  unitCost: number;
  reimbursementLineId: string | null;
  purchaseInvoiceLineId: string | null;
};

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
    billable: charge.billable,
    unitCost: charge.unitCost,
    reimbursementLineId: charge.reimbursementLineId,
    purchaseInvoiceLineId: charge.purchaseInvoiceLineId
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

// --- A charge's paid cost ----------------------------------------------------
// A hotel or a part bought on site is a real cost. The reimbursement or
// supplier invoice that paid it posts the journal, so the job only stores
// the link and the cost; it posts nothing for it.

/** What paid a charge's cost: an employee's reimbursement or a supplier invoice. */
export type CostLineSource = "reimbursement" | "purchaseInvoice";

/** A posted line a charge's cost can be linked to. */
export type LinkableCostLine = {
  source: CostLineSource;
  id: string;
  /** The reimbursement's or the purchase invoice's id. */
  documentId: string;
  /** Its number: `reimbursementId` or `invoiceId`. */
  documentReadableId: string;
  description: string | null;
  /** In base currency: what the line posted. */
  amount: number;
  /** The account the line posted to. */
  accountId: string | null;
  accountName: string | null;
  accountNumber: string | null;
};

/** How many recent lines of each source the charge form lists. */
export const LINKABLE_COST_LINE_LIMIT = 100;

/** A purchase invoice in one of these has posted no journal. */
const UNPOSTED_PURCHASE_INVOICE_STATUSES = '("Draft","Pending","Voided")';

type CostLineResult<T> =
  | { data: T; error: null }
  | { data: null; error: PostgrestError };

/**
 * Lines of Posted reimbursements, newest first. A Draft reimbursement
 * rewrites its lines on every save, which would drop the link, and has posted
 * nothing yet.
 */
async function reimbursementCostLines(
  client: Client,
  companyId: string,
  args: { ids?: string[]; employeeId?: string; limit: number }
): Promise<CostLineResult<LinkableCostLine[]>> {
  let query = client
    .from("reimbursementLine")
    .select(
      "id, description, amount, accountId, account:account!reimbursementLine_accountId_fkey(name, number), reimbursement:reimbursement!reimbursementLine_reimbursementId_fkey!inner(id, reimbursementId, exchangeRate, status, employeeId)"
    )
    .eq("companyId", companyId)
    .eq("reimbursement.status", "Posted");
  if (args.ids) query = query.in("id", args.ids);
  if (args.employeeId) {
    query = query.eq("reimbursement.employeeId", args.employeeId);
  }
  const result = await query
    .order("createdAt", { ascending: false })
    .limit(args.limit);
  if (result.error) return { data: null, error: result.error };
  return {
    data: result.data.map((row) => ({
      source: "reimbursement" as const,
      id: row.id,
      documentId: row.reimbursement.id,
      documentReadableId: row.reimbursement.reimbursementId,
      description: row.description,
      // The reimbursement posts its lines converted the same way.
      amount: toBaseAmount(
        Number(row.amount),
        Number(row.reimbursement.exchangeRate)
      ),
      accountId: row.accountId,
      accountName: row.account?.name ?? null,
      accountNumber: row.account?.number ?? null
    })),
    error: null
  };
}

/**
 * Lines of posted purchase invoices that post to an account, newest first. A
 * line with no account (a part received into stock) gets its cost to a job
 * when the part is issued, not through a charge.
 */
async function purchaseInvoiceCostLines(
  client: Client,
  companyId: string,
  args: { ids?: string[]; supplierId?: string; limit: number }
): Promise<CostLineResult<LinkableCostLine[]>> {
  let query = client
    .from("purchaseInvoiceLine")
    .select(
      "id, description, totalAmount, accountId, account:account!purchaseInvoiceLine_accountId_fkey(name, number), purchaseInvoice:purchaseInvoice!purchaseInvoiceLines_invoiceId_fkey!inner(id, invoiceId, status, supplierId)"
    )
    .eq("companyId", companyId)
    .not("accountId", "is", null)
    .neq("invoiceLineType", "Comment")
    .not("purchaseInvoice.status", "in", UNPOSTED_PURCHASE_INVOICE_STATUSES);
  if (args.ids) query = query.in("id", args.ids);
  if (args.supplierId) {
    query = query.eq("purchaseInvoice.supplierId", args.supplierId);
  }
  const result = await query
    .order("createdAt", { ascending: false })
    .limit(args.limit);
  if (result.error) return { data: null, error: result.error };
  return {
    data: result.data.map((row) => ({
      source: "purchaseInvoice" as const,
      id: row.id,
      documentId: row.purchaseInvoice.id,
      documentReadableId: row.purchaseInvoice.invoiceId,
      description: row.description,
      // Base currency: the line's price, freight and tax, as it posted.
      amount: Number(row.totalAmount ?? 0),
      accountId: row.accountId,
      accountName: row.account?.name ?? null,
      accountNumber: row.account?.number ?? null
    })),
    error: null
  };
}

/** One posted cost line, or null when the company has no such posted line. */
export async function getCostLine(
  client: Client,
  companyId: string,
  link: { reimbursementLineId?: string; purchaseInvoiceLineId?: string }
): Promise<CostLineResult<LinkableCostLine | null>> {
  const result = link.reimbursementLineId
    ? await reimbursementCostLines(client, companyId, {
        ids: [link.reimbursementLineId],
        limit: 1
      })
    : link.purchaseInvoiceLineId
      ? await purchaseInvoiceCostLines(client, companyId, {
          ids: [link.purchaseInvoiceLineId],
          limit: 1
        })
      : { data: [], error: null };
  if (result.error) return result;
  return { data: result.data[0] ?? null, error: null };
}

/**
 * The charges, other than `exceptItemId`, that the lines already pay, with
 * their job's number. One read per source.
 */
async function chargesPaidBy(
  client: Client,
  companyId: string,
  lines: Pick<LinkableCostLine, "source" | "id">[],
  exceptItemId?: string
): Promise<
  CostLineResult<
    { lineId: string; itemId: string; serviceJobId: string | null }[]
  >
> {
  const ids = (source: CostLineSource) =>
    lines.filter((line) => line.source === source).map((line) => line.id);
  const read = (
    column: "reimbursementLineId" | "purchaseInvoiceLineId",
    lineIds: string[]
  ) =>
    lineIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("serviceJobItem")
          .select(
            "id, reimbursementLineId, purchaseInvoiceLineId, serviceJob:serviceJob!serviceJobItem_serviceJobId_fkey(serviceJobId)"
          )
          .eq("companyId", companyId)
          .in(column, lineIds);
  const [reimbursed, invoiced] = await Promise.all([
    read("reimbursementLineId", ids("reimbursement")),
    read("purchaseInvoiceLineId", ids("purchaseInvoice"))
  ]);
  if (reimbursed.error) return { data: null, error: reimbursed.error };
  if (invoiced.error) return { data: null, error: invoiced.error };
  return {
    data: [...(reimbursed.data ?? []), ...(invoiced.data ?? [])]
      .filter((row) => row.id !== exceptItemId)
      .map((row) => ({
        lineId: (row.reimbursementLineId ?? row.purchaseInvoiceLineId)!,
        itemId: row.id,
        serviceJobId: row.serviceJob?.serviceJobId ?? null
      })),
    error: null
  };
}

/**
 * The posted reimbursement and supplier invoice lines a charge's cost can be
 * linked to: the newest `limit` of each source, less the lines that already
 * pay another charge. The line `serviceJobItemId` is linked to is always
 * listed.
 */
export async function getLinkableCostLines(
  client: Client,
  companyId: string,
  args: {
    serviceJobItemId?: string;
    employeeId?: string;
    supplierId?: string;
    limit?: number;
  }
): Promise<CostLineResult<LinkableCostLine[]>> {
  const limit = args.limit ?? LINKABLE_COST_LINE_LIMIT;
  const [reimbursements, invoices, current] = await Promise.all([
    reimbursementCostLines(client, companyId, {
      employeeId: args.employeeId,
      limit
    }),
    purchaseInvoiceCostLines(client, companyId, {
      supplierId: args.supplierId,
      limit
    }),
    args.serviceJobItemId
      ? client
          .from("serviceJobItem")
          .select("reimbursementLineId, purchaseInvoiceLineId")
          .eq("id", args.serviceJobItemId)
          .eq("companyId", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (reimbursements.error) return reimbursements;
  if (invoices.error) return invoices;
  if (current.error) return { data: null, error: current.error };

  const lines = [...reimbursements.data, ...invoices.data];
  const currentLink = current.data;
  if (
    currentLink &&
    (currentLink.reimbursementLineId || currentLink.purchaseInvoiceLineId) &&
    !lines.some(
      (line) =>
        line.id === currentLink.reimbursementLineId ||
        line.id === currentLink.purchaseInvoiceLineId
    )
  ) {
    const linked = await getCostLine(client, companyId, {
      reimbursementLineId: currentLink.reimbursementLineId ?? undefined,
      purchaseInvoiceLineId: currentLink.purchaseInvoiceLineId ?? undefined
    });
    if (linked.error) return linked;
    if (linked.data) lines.unshift(linked.data);
  }

  const paid = await chargesPaidBy(
    client,
    companyId,
    lines,
    args.serviceJobItemId
  );
  if (paid.error) return paid;
  const taken = new Set(paid.data.map((row) => row.lineId));
  return { data: lines.filter((line) => !taken.has(line.id)), error: null };
}

/**
 * The account a job's cost goes to, for the charge form's warning: Warranty
 * expense for Warranty work, else cost of service, falling back to Cost of
 * Goods Sold. Null when the company has not set it.
 */
export async function getServiceJobCoverageAccount(
  client: Client,
  companyId: string,
  serviceJobId: string
) {
  const [job, defaults] = await Promise.all([
    client
      .from("serviceJob")
      .select("coverage")
      .eq("id", serviceJobId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("accountDefault")
      .select(
        "costOfServiceAccount, costOfGoodsSoldAccount, warrantyExpenseAccount"
      )
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (job.error) return { data: null, error: job.error };
  if (defaults.error) return { data: null, error: defaults.error };
  if (!job.data || !defaults.data) return { data: null, error: null };

  const accountId =
    coverageAccountRole(job.data.coverage) === "warrantyExpenseAccount"
      ? defaults.data.warrantyExpenseAccount
      : (defaults.data.costOfServiceAccount ??
        defaults.data.costOfGoodsSoldAccount);
  if (!accountId) return { data: null, error: null };
  return client
    .from("account")
    .select("id, name, number")
    .eq("id", accountId)
    .maybeSingle();
}

export const CHARGE_COST_LINE_TAKEN = "This line already pays another charge";

/**
 * Whether a charge's write failed on the one-line-one-charge unique indexes
 * (`serviceJobItem_reimbursementLineId_key`,
 * `serviceJobItem_purchaseInvoiceLineId_key`): another save linked the line
 * after `chargeCost` checked it.
 */
export function isChargeCostLinkTaken(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  return (
    error?.code === "23505" &&
    /serviceJobItem_(reimbursementLineId|purchaseInvoiceLineId)_key/.test(
      error.message ?? ""
    )
  );
}

/**
 * A charge's paid cost: the line it links to and the unit cost that line
 * gives it (its amount ÷ the charge's quantity), or no link and no cost.
 * Refuses both links at once, a line the company has not posted, and a line
 * that already pays another charge.
 */
export async function chargeCost(
  ctx: ServiceContext,
  charge: {
    id?: string;
    quantity: number;
    reimbursementLineId?: string;
    purchaseInvoiceLineId?: string;
  }
): Promise<
  | {
      unitCost: number;
      reimbursementLineId: string | null;
      purchaseInvoiceLineId: string | null;
    }
  | CarbonError
> {
  const { reimbursementLineId, purchaseInvoiceLineId } = charge;
  if (reimbursementLineId && purchaseInvoiceLineId) {
    return ctx.error(
      "validation",
      "A charge is paid by one line: a reimbursement line or a supplier invoice line"
    );
  }
  if (!reimbursementLineId && !purchaseInvoiceLineId) {
    return {
      unitCost: 0,
      reimbursementLineId: null,
      purchaseInvoiceLineId: null
    };
  }

  const client = ctx.asCaller.supabase;
  const line = await getCostLine(client, ctx.company.id, {
    reimbursementLineId,
    purchaseInvoiceLineId
  });
  if (line.error) {
    return ctx.error("internal", "Failed to load the cost line", line.error);
  }
  if (!line.data) {
    return ctx.error(
      "notFound",
      "Cost line not found. Link a line of a posted reimbursement or supplier invoice."
    );
  }
  const paid = await chargesPaidBy(
    client,
    ctx.company.id,
    [line.data],
    charge.id
  );
  if (paid.error) {
    return ctx.error("internal", "Failed to load the cost line", paid.error);
  }
  const other = paid.data[0];
  if (other) {
    return ctx.error(
      "rule",
      other.serviceJobId
        ? `This line already pays a charge on ${other.serviceJobId}`
        : CHARGE_COST_LINE_TAKEN
    );
  }
  return {
    unitCost: round(line.data.amount / charge.quantity),
    reimbursementLineId: reimbursementLineId ?? null,
    purchaseInvoiceLineId: purchaseInvoiceLineId ?? null
  };
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

/**
 * One 'Service Job' journal of a job's lines, each tagged with the job's
 * location when a Location dimension is active. Returns the journal's id.
 */
async function writeServiceJobJournal(
  trx: Transaction<KyselyDatabase>,
  args: {
    job: { id: string; locationId: string };
    lines: ServiceJobJournalLine[];
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

/**
 * Reconciles the cost of a job's closed time entries with the journal, inside
 * the caller's transaction. Each entry with `hours` > 0 and no running clock
 * costs hours × its `unitCost`; an entry with no `unitCost` takes the
 * company's `serviceLaborCostRate` and keeps it, so a later rate change never
 * moves a posted entry. The desired pair per entry is Dr the job's coverage
 * account / Cr laborAbsorptionAccount, keyed by
 * `journalReference.to.serviceJobTime`; the difference from what the journal
 * already holds posts as 'Service Job' journals. Each entry's difference is
 * dated on its `entryDate`, as the revenue recognition run counts the hours,
 * unless that day's period is Closed or Locked (`serviceTimePostingDates`);
 * then, and for a deleted entry, it is dated today. One journal per posting
 * date: an entry's lines balance, so each journal balances. A deleted entry
 * reverses, and a coverage change moves the posted cost. Returns the first
 * journal's id, or null when nothing changed. Copies `postMaintenanceEvent`.
 */
export async function reconcileServiceJobTime(
  trx: Transaction<KyselyDatabase>,
  args: { companyId: string; serviceJobId: string; userId: string }
): Promise<string | null> {
  const { companyId, userId } = args;
  const job = await lockServiceJob(trx, {
    serviceJobId: args.serviceJobId,
    companyId
  });
  // Provisional before the company's accounting cutover, Posted after it.
  const cutoverDate = await readAccountingCutoverDate(trx, companyId);
  const postingStatus = postingStatusFor(cutoverDate);

  const [
    time,
    entryDates,
    settings,
    defaults,
    location,
    priorLines,
    supersededLines
  ] = await Promise.all([
    trx
      .selectFrom("serviceJobTime")
      .select(["id", "hours", "unitCost"])
      .where("serviceJobId", "=", job.id)
      .where("companyId", "=", companyId)
      .where("hours", ">", 0)
      .where((eb) =>
        eb.or([eb("startTime", "is", null), eb("endTime", "is not", null)])
      )
      .execute(),
    // Every entry's day, also one now at 0 hours: its reversal posts there.
    trx
      .selectFrom("serviceJobTime")
      .select(["id", "entryDate"])
      .where("serviceJobId", "=", job.id)
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("companySettings")
      .select("serviceLaborCostRate")
      .where("id", "=", companyId)
      .executeTakeFirst(),
    serviceJobAccountDefaults(trx, companyId),
    trx
      .selectFrom("dimension")
      .innerJoin(
        "company",
        "company.companyGroupId",
        "dimension.companyGroupId"
      )
      .select(["dimension.id"])
      .where("company.id", "=", companyId)
      .where("dimension.active", "=", true)
      .where("dimension.entityType", "=", "Location")
      .executeTakeFirst(),
    trx
      .selectFrom("journalLine")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "journalLine.journalId")
          .onRef("journal.companyId", "=", "journalLine.companyId")
      )
      .select([
        "journalLine.id",
        "journalLine.documentLineReference",
        "journalLine.accountId",
        "journalLine.amount"
      ])
      .where("journalLine.documentType", "=", "Service Job")
      .where("journalLine.documentId", "=", job.id)
      .where("journalLine.documentLineReference", "like", "service-job-time:%")
      .where("journalLine.companyId", "=", companyId)
      .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .execute(),
    // Lines the enable superseded: posted before the cutover.
    trx
      .selectFrom("journalLine")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "journalLine.journalId")
          .onRef("journal.companyId", "=", "journalLine.companyId")
      )
      .select([
        "journalLine.documentLineReference",
        "journalLine.accountId",
        "journalLine.amount"
      ])
      .where("journalLine.documentType", "=", "Service Job")
      .where("journalLine.documentId", "=", job.id)
      .where("journalLine.documentLineReference", "like", "service-job-time:%")
      .where("journalLine.companyId", "=", companyId)
      .where("journal.status", "=", "Superseded")
      .execute()
  ]);

  // Each entry keeps the rate it first posted at.
  const rate =
    settings?.serviceLaborCostRate === null ||
    settings?.serviceLaborCostRate === undefined
      ? null
      : Number(settings.serviceLaborCostRate);
  const unrated = time.filter((entry) => entry.unitCost === null);
  if (unrated.length > 0) {
    if (rate === null) {
      throw new InvalidInputError(SERVICE_LABOR_COST_RATE_MISSING);
    }
    await trx
      .updateTable("serviceJobTime")
      .set({
        unitCost: rate,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where(
        "id",
        "in",
        unrated.map((entry) => entry.id)
      )
      .where("companyId", "=", companyId)
      .execute();
  }
  const entries = time.map((entry) => ({
    id: entry.id,
    hours: Number(entry.hours),
    unitCost: entry.unitCost === null ? (rate ?? 0) : Number(entry.unitCost)
  }));

  // The accounts are resolved only when there is cost to post: an empty
  // default refuses nothing that writes no line.
  const costs = entries.some(
    (entry) => round(entry.hours * entry.unitCost) > EPSILON
  );
  const laborAbsorption = costs
    ? resolveDefaultAccount(defaults, "laborAbsorptionAccount", postingStatus)
    : null;
  const desired =
    costs && laborAbsorption
      ? buildServiceTimeCostGroups({
          entries,
          coverageAccountId: serviceCoverageAccount(
            defaults,
            job.coverage,
            postingStatus
          ),
          laborAbsorptionAccountId: laborAbsorption.accountId,
          dimensions: location
            ? [{ dimensionId: location.id, valueId: job.locationId }]
            : []
        })
      : [];

  // What the journal already holds, with each line's own tags.
  const priorDimensions =
    priorLines.length > 0
      ? await trx
          .selectFrom("journalLineDimension")
          .select(["journalLineId", "dimensionId", "valueId"])
          .where(
            "journalLineId",
            "in",
            priorLines.map((line) => line.id)
          )
          .where("companyId", "=", companyId)
          .execute()
      : [];
  const dimensionsByLine = new Map<string, LaborDimension[]>();
  for (const d of priorDimensions) {
    const list = dimensionsByLine.get(d.journalLineId) ?? [];
    list.push({ dimensionId: d.dimensionId, valueId: d.valueId });
    dimensionsByLine.set(d.journalLineId, list);
  }
  const prior: LaborGroup[] = priorLines.map((line) => ({
    reference: line.documentLineReference ?? "",
    accountId: line.accountId ?? "",
    dimensions: dimensionsByLine.get(line.id) ?? [],
    amount: Number(line.amount)
  }));

  const expenseAccountIds = new Set(
    [
      defaults.costOfServiceAccount,
      defaults.warrantyExpenseAccount,
      defaults.costOfGoodsSoldAccount
    ].filter((id): id is string => !!id)
  );
  const kept = withoutSupersededEntries(
    desired,
    supersededLines.map((line) => ({
      reference: line.documentLineReference ?? "",
      accountId: line.accountId ?? "",
      amount: Number(line.amount)
    })),
    expenseAccountIds
  );
  if (kept.changed.length > 0) {
    throw new InvalidInputError(TIME_ENTRY_BEFORE_CUTOVER_ERROR);
  }
  const delta = diffLaborGroups(kept.desired, prior);
  if (delta.length === 0) return null;

  // Each entry posts on its own day when that day's period takes postings,
  // so its cost lands in the month the revenue run counts its hours.
  const today = datetime
    .today(await getCompanyTimeZone(trx, companyId))
    .toString();
  const entryDateByReference = new Map(
    entryDates.map((entry) => [
      journalReference.to.serviceJobTime(entry.id),
      entry.entryDate
    ])
  );
  const postingDateByEntryDate = await serviceTimePostingDates(trx, {
    companyId,
    entryDates: delta.flatMap((group) => {
      const entryDate = entryDateByReference.get(group.reference);
      return entryDate ? [entryDate] : [];
    }),
    cutoverDate,
    today
  });
  const groupsByPostingDate = new Map<string, LaborGroup[]>();
  for (const group of delta) {
    // A deleted entry has no day any more: its reversal posts today.
    const entryDate = entryDateByReference.get(group.reference);
    const postingDate =
      (entryDate && postingDateByEntryDate.get(entryDate)) || today;
    const groups = groupsByPostingDate.get(postingDate) ?? [];
    groups.push(group);
    groupsByPostingDate.set(postingDate, groups);
  }

  let firstJournalId: string | null = null;
  for (const postingDate of [...groupsByPostingDate.keys()].sort()) {
    const journalId = await writeServiceTimeJournal(trx, {
      job,
      groups: groupsByPostingDate.get(postingDate) ?? [],
      postingDate,
      postingStatus,
      isAdjustment: prior.length > 0,
      defaults,
      expenseAccountIds,
      companyId,
      userId
    });
    firstJournalId ??= journalId;
  }
  return firstJournalId;
}

/**
 * The day each entry's time cost posts, by entry date. Before the cutover
 * (Provisional, no period) it is the entry's own day. After it, the entry's
 * own day while the period that holds it takes postings, else today: a
 * period that is Closed or Locked, or a day before the cutover. A day with no
 * period yet gets one from `resolveAccountingPeriod`, as today's does.
 */
async function serviceTimePostingDates(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    entryDates: string[];
    cutoverDate: string | null;
    today: string;
  }
): Promise<Map<string, string>> {
  const { companyId, cutoverDate, today } = args;
  const entryDates = [...new Set(args.entryDates)].sort();
  const postingDates = new Map<string, string>();
  if (entryDates.length === 0) return postingDates;
  if (!cutoverDate) {
    for (const entryDate of entryDates) postingDates.set(entryDate, entryDate);
    return postingDates;
  }
  // The rows and lock `resolveAccountingPeriod` takes, read without its
  // refusal, in its order: the first period that holds a day is its period.
  const periods = await trx
    .selectFrom("accountingPeriod")
    .select([
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string>`"endDate"::text`.as("endDate"),
      "closeStatus",
      "closedAt"
    ])
    .where("companyId", "=", companyId)
    .where("startDate", "<=", entryDates[entryDates.length - 1])
    .where("endDate", ">=", entryDates[0])
    .orderBy("startDate")
    .orderBy("id")
    .forUpdate()
    .execute();
  for (const entryDate of entryDates) {
    const period = periods.find(
      (row) => row.startDate <= entryDate && row.endDate >= entryDate
    );
    const closed =
      !!period &&
      (period.closeStatus === "Locked" ||
        period.closeStatus === "Closed" ||
        period.closedAt !== null);
    postingDates.set(
      entryDate,
      entryDate < cutoverDate || closed ? today : entryDate
    );
  }
  return postingDates;
}

/** Writes one 'Service Job' time journal for the lines of one posting date. */
async function writeServiceTimeJournal(
  trx: Transaction<KyselyDatabase>,
  args: {
    job: { id: string; serviceJobId: string };
    groups: LaborGroup[];
    postingDate: string;
    postingStatus: AutomaticJournalStatus;
    isAdjustment: boolean;
    defaults: Awaited<ReturnType<typeof serviceJobAccountDefaults>>;
    expenseAccountIds: Set<string>;
    companyId: string;
    userId: string;
  }
): Promise<string> {
  const {
    job,
    groups,
    postingDate,
    postingStatus,
    defaults,
    expenseAccountIds,
    companyId,
    userId
  } = args;
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
    description: `Service Job Time ${job.serviceJobId}${
      args.isAdjustment ? " (Adjustment)" : ""
    }`,
    postingDate,
    userId,
    sourceType: "Service Job"
  });

  // One line per insert: each carries its own tags, and a multi-row
  // RETURNING does not promise insert order.
  const journalLineReference = nanoid();
  for (const group of groups) {
    const isCostLine = expenseAccountIds.has(group.accountId);
    const line = await trx
      .insertInto("journalLine")
      .values({
        journalId,
        accountId: group.accountId,
        description: isCostLine
          ? group.accountId === defaults.warrantyExpenseAccount
            ? "Warranty Expense"
            : "Cost of Service"
          : "Labor Absorption",
        // A Provisional absorption line on Retained Earnings is a stand-in,
        // the new one or the reversal of a prior one; the enable re-points it.
        accountDefaultRole:
          postingStatus === "Provisional" &&
          !isCostLine &&
          group.accountId === defaults.retainedEarningsAccount
            ? "laborAbsorptionAccount"
            : null,
        amount: group.amount,
        quantity: 1,
        documentType: "Service Job",
        documentId: job.id,
        documentLineReference: group.reference,
        journalLineReference,
        companyId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    if (group.dimensions.length > 0) {
      await trx
        .insertInto("journalLineDimension")
        .values(
          group.dimensions.map((d) => ({
            journalLineId: line.id,
            dimensionId: d.dimensionId,
            valueId: d.valueId,
            companyId
          }))
        )
        .execute();
    }
  }
  return journalId;
}

/**
 * Runs `post-service-job` `post-time` for one job as the system: the
 * operation has already authorized the change, and a delete-only user must
 * still reverse its cost. Returns the failure's message, or null. Copies
 * `postMaintenanceLabor`.
 */
export async function postServiceJobTime(
  ctx: ServiceContext,
  serviceJobId: string
): Promise<string | null> {
  const posting = await invokePosting(
    {
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    "post-service-job",
    { action: "post-time" as const, serviceJobId },
    postServiceJob
  );
  if (posting.error) {
    logger.error("Failed to post service job time", {
      companyId: ctx.company.id,
      serviceJobId,
      error: posting.error
    });
    return posting.error.message || "Failed to post service job time";
  }
  return null;
}

export const SERVICE_JOB_UNIT_LEFT_ERROR =
  "This unit has already left the repair; it cannot be reopened.";

/**
 * Refuses to reopen a job whose RMA unit has moved on: shipped back,
 * scrapped, or replaced. Reopening would put work on a unit the depot no
 * longer has.
 */
async function refuseReopenOfDepartedUnit(
  trx: Transaction<KyselyDatabase>,
  salesReturnOrderLineId: string | null,
  companyId: string
) {
  if (!salesReturnOrderLineId) return;
  const [line, replacement] = await Promise.all([
    trx
      .selectFrom("salesReturnOrderLine")
      .select(["quantityShipped", "disposition"])
      .where("id", "=", salesReturnOrderLineId)
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    trx
      .selectFrom("salesOrderLine")
      .select("id")
      .where("salesReturnOrderLineId", "=", salesReturnOrderLineId)
      .where("companyId", "=", companyId)
      .limit(1)
      .executeTakeFirst()
  ]);
  if (
    replacement ||
    (line && (Number(line.quantityShipped) > 0 || line.disposition === "Scrap"))
  ) {
    throw new InvalidInputError(SERVICE_JOB_UNIT_LEFT_ERROR);
  }
}

const COMPLETABLE_STATUSES: ReadonlySet<string> = new Set([
  "Open",
  "In Progress",
  "On Hold"
]);

/**
 * Completes, reopens or changes the coverage of a service job, or posts its
 * time, in one transaction with the job row locked.
 *
 * - `complete` refuses a clock still running, runs the time reconcile
 *   (`reconcileServiceJobTime`) and sets the job Completed. It writes no
 *   journal of its own; the reconcile's journal, if any, is `journalId`. An
 *   estimate is never required.
 * - `reopen` moves a Completed job back to In Progress and writes no
 *   journal. An Invoiced job cannot reopen, nor can a job whose RMA unit was
 *   shipped back, scrapped or replaced.
 * - `set-coverage` moves the cost of the parts already issued from the old
 *   coverage account to the new one, in one journal, sets the coverage, then
 *   runs the time reconcile, which moves the posted time. `journalId` is the
 *   parts journal, else the time journal. Refused once the job is Completed.
 * - `post-time` runs the time reconcile alone.
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

        const running = await trx
          .selectFrom("serviceJobTime")
          .select("id")
          .where("serviceJobId", "=", job.id)
          .where("companyId", "=", companyId)
          .where("startTime", "is not", null)
          .where("endTime", "is", null)
          .limit(1)
          .executeTakeFirst();
        if (running) {
          throw new InvalidInputError("Stop the running clock first.");
        }

        // Time posts as it is logged; Complete only catches up what a
        // failed post-after-write left behind, and refuses if it cannot.
        const journalId = await reconcileServiceJobTime(trx, {
          companyId,
          serviceJobId: job.id,
          userId
        });

        await trx
          .updateTable("serviceJob")
          .set({
            status: "Completed",
            completedAt: now,
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
        await refuseReopenOfDepartedUnit(
          trx,
          job.salesReturnOrderLineId,
          companyId
        );

        await trx
          .updateTable("serviceJob")
          .set({
            status: "In Progress",
            completedAt: null,
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
          journalId: null
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
        // Time takes its billable flag from the coverage it was logged under,
        // so a job that becomes Billable bills the hours logged before.
        if (input.coverage === "Billable" && job.coverage !== "Billable") {
          await trx
            .updateTable("serviceJobTime")
            .set({ billable: true, updatedBy: userId, updatedAt: now })
            .where("serviceJobId", "=", job.id)
            .where("companyId", "=", companyId)
            .execute();
        }
        // The posted time moves to the new coverage account.
        const timeJournalId = await reconcileServiceJobTime(trx, {
          companyId,
          serviceJobId: job.id,
          userId
        });
        return {
          success: true,
          serviceJobId: job.id,
          status: job.status,
          journalId: journalId ?? timeJournalId
        };
      }

      case "post-time": {
        const job = await lockServiceJob(trx, {
          serviceJobId: input.serviceJobId,
          companyId
        });
        const journalId = await reconcileServiceJobTime(trx, {
          companyId,
          serviceJobId: job.id,
          userId
        });
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
// when they were issued, and each time entry posted its cost when logged.

export const createServiceInvoiceInput = z.object({
  serviceJobId: z.string().min(1),
  /** The price of a Fixed Price job that has none, saved before billing. */
  fixedPrice: z.number().min(0).optional()
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
 * 1. locks the job and refuses unless it is Completed and Billable; a
 *    `fixedPrice` is saved on a Fixed Price job that has none (the Create
 *    Invoice dialog asks for it) and refused on any other job;
 * 2. builds the lines (`planServiceJobInvoiceLines`): Time and Materials bills
 *    one Labor line, Σ billable hours × the job's bill rate, then each
 *    billable Part and Charge; Fixed Price bills one plain line, with no
 *    item, at the fixed price;
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
  const { serviceJobId, fixedPrice } = createServiceInvoiceInput.parse(raw);
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
    if (fixedPrice !== undefined) {
      if (job.billingMethod !== "Fixed Price") {
        throw new InvalidInputError(
          "Only a Fixed Price job has a fixed price."
        );
      }
      if (job.fixedPrice !== null) {
        throw new InvalidInputError(
          `Service job ${job.serviceJobId} already has a fixed price.`
        );
      }
      await trx
        .updateTable("serviceJob")
        .set({
          fixedPrice,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", job.id)
        .where("companyId", "=", companyId)
        .execute();
    }
    const jobFixedPrice =
      fixedPrice ?? (job.fixedPrice === null ? null : Number(job.fixedPrice));
    const customerId = job.customerId;

    const [time, items, customerPayment, customer, company] = await inOrder([
      () =>
        trx
          .selectFrom("serviceJobTime")
          .select(["hours", "billable"])
          .where("serviceJobId", "=", job.id)
          .where("companyId", "=", companyId)
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
        fixedPrice: jobFixedPrice,
        laborBillRate:
          job.laborBillRate === null ? null : Number(job.laborBillRate)
      },
      time: time.map((entry) => ({
        hours: Number(entry.hours),
        billable: entry.billable
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

/**
 * Files a sent estimate's PDF in the job's files
 * (`${companyId}/service-job/${jobId}`, the folder the job page lists), named
 * by the job and the time it was sent so each send keeps its own copy. No
 * `document` row: `documentSourceType` has no service job value.
 */
export async function fileServiceJobEstimatePdf(
  ctx: ServiceContext,
  args: { jobId: string; serviceJobId: string; pdf: Buffer }
): Promise<{ fileName: string } | CarbonError> {
  const companyId = ctx.company.id;
  const fileName = stripSpecialCharacters(
    `${args.serviceJobId} - Estimate - ${datetime.timestamp().slice(0, -5)}.pdf`
  );
  const upload = await storage(ctx.asSystem.supabase)
    .company(companyId)
    .upload(`${companyId}/service-job/${args.jobId}/${fileName}`, args.pdf, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });
  if (upload.error) {
    return ctx.error(
      "internal",
      "Failed to file the estimate PDF",
      upload.error
    );
  }
  return { fileName };
}
/**
 * Emails a service job's estimate to a customer contact, the PDF attached,
 * from the sending user (who is copied). Throws when the contact has no email
 * or a record cannot be read: the caller keeps the send and reports a
 * warning.
 */
export async function emailServiceJobEstimate(
  ctx: ServiceContext,
  args: {
    serviceJobId: string;
    customerContactId: string;
    cc?: string[];
    companyName: string;
    total: string;
    itemName: string | null;
    serial: string | null;
    pdf: Buffer;
    fileName: string;
  }
) {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const [customerContact, user] = await Promise.all([
    getCustomerContact(serviceRole, args.customerContactId, companyId),
    getUser(serviceRole, ctx.auditUserId)
  ]);
  const recipient = customerContact.data?.contact;
  if (!recipient?.email) throw new Error("The contact has no email address");
  if (!user.data) throw new Error("Failed to get user");

  const template = ServiceJobEstimateEmail({
    companyName: args.companyName,
    serviceJobId: args.serviceJobId,
    total: args.total,
    itemName: args.itemName,
    serial: args.serial,
    recipientName: recipient.firstName,
    senderName: [user.data.firstName, user.data.lastName]
      .filter(Boolean)
      .join(" ")
  });
  const [html, text] = await Promise.all([
    render(template),
    render(template, { plainText: true })
  ]);

  await trigger("send-email", {
    to: [user.data.email, recipient.email],
    cc: args.cc?.length ? args.cc : undefined,
    from: user.data.email,
    subject: `Estimate ${args.serviceJobId}`,
    html,
    text,
    attachments: [
      { filename: args.fileName, content: args.pdf.toString("base64") }
    ],
    companyId
  });
}
