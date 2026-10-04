// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { SalesOrderEmail } from "@carbon/documents/email";
import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import { actionTaskEntities } from "@carbon/ee/action-task-entity";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { Signals } from "@carbon/onboarding";
import { detectImplementationSignals } from "@carbon/onboarding/server";
import type { PrinterRoute } from "@carbon/printing";
import { unchecked } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { startOfWeek } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { createCookieSessionStorage } from "react-router";
import { getCurrencyByCode, getPaymentTermsList } from "~/modules/accounting";
import {
  getCustomerContact,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines
} from "~/modules/sales";
import { getCompany, withLogoUrls } from "~/modules/settings";
import { getTimezoneNames } from "~/modules/shared/shared.service";
import { getUser } from "~/modules/users/users.server";
// Created concurrently with the returns module; see routes/file+/purchase-return-order+/
import { loader as purchaseReturnOrderPdfLoader } from "~/routes/file+/purchase-return-order+/$id[.]pdf";
// Created concurrently with the RMA module; see routes/file+/sales-return-order+/
import { loader as salesReturnOrderPdfLoader } from "~/routes/file+/sales-return-order+/$id[.]pdf";
import { getDatabaseClient } from "~/services/database.server";
import { stripSpecialCharacters } from "~/utils/string";
import { upsertDocument } from "../documents/documents.service";
import type { CustomFieldsTableType } from "../settings";

const logger = getLogger("erp", "shared");

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export async function assign(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    table: string;
    assignee: string;
  }
) {
  const { id, table, assignee } = args;

  return (
    client
      // @ts-expect-error
      .from(table)
      .update(unchecked({ assignee: assignee ? assignee : null }))
      .eq(unchecked("id"), id)
  );
}

export async function getCustomFieldsCacheKey(args?: {
  companyId?: string;
  module?: string;
  table?: string;
}) {
  return `customFields:${args?.companyId}:${args?.module ?? ""}:${
    args?.table ?? ""
  }`;
}

export async function getCustomFieldsSchemas(
  client: SupabaseClient<Database>,
  args?: {
    companyId: string;
    module?: string;
    table?: string;
  }
) {
  const key = await getCustomFieldsCacheKey(args);

  // redis.get returns null on a cache miss (or when Redis is unreachable — the
  // @carbon/kv resilience wrapper fails soft). Treat both, and a malformed
  // cached payload, as a miss and fall through to the database.
  const cachedSchema = await redis.get(key);
  if (cachedSchema) {
    try {
      return {
        data: JSON.parse(cachedSchema) as CustomFieldsTableType[],
        error: null
      };
    } catch {
      // Corrupt cache entry — fall through to the source of truth.
    }
  }

  const query = client.from("customFieldTables").select("*");

  if (args?.companyId) {
    query.eq("companyId", args.companyId);
  }

  if (args?.module) {
    query.eq("module", args.module as any);
  }

  if (args?.table) {
    query.eq("table", args.table);
  }

  const result = await query;
  if (result.data) {
    await redis.set(key, JSON.stringify(result.data));
  }

  return result;
}

// tzdata only changes when the Postgres image is upgraded — a day-long TTL
// keeps the pg_timezone_names scan (~1ms but per-request) off the hot path
// while still picking up a DB upgrade within 24h.
const TIMEZONES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedTimezoneNames: {
  data: { name: string; utcOffset: string }[];
  fetchedAt: number;
} | null = null;

/**
 * In-memory memo of the get_timezone_names RPC (pg_timezone_names). The list
 * is global (not company-scoped), identical for every tenant, and never
 * invalidated by user action — so a per-process memo beats Redis: no network
 * round-trip, nothing to invalidate, and a cold start simply refetches
 * (~1ms scan). A failed fetch is returned as-is and not cached.
 */
export async function getCachedTimezoneNames(client: SupabaseClient<Database>) {
  if (
    cachedTimezoneNames &&
    Date.now() - cachedTimezoneNames.fetchedAt < TIMEZONES_CACHE_TTL_MS
  ) {
    return { data: cachedTimezoneNames.data, error: null };
  }

  const result = await getTimezoneNames(client);
  if (result.data?.length) {
    cachedTimezoneNames = { data: result.data, fetchedAt: Date.now() };
  }

  return result;
}

/**
 * Generates a sales order PDF via the pdfLoader, uploads it to Supabase
 * storage under the opportunity path, and creates a document DB record.
 *
 * Returns the PDF ArrayBuffer (useful for email attachments) and the
 * generated file name.
 */
export async function generateAndAttachSalesOrderPdf(args: {
  /** The original action/loader args from the route */
  routeArgs: LoaderFunctionArgs;
  /** Sales order DB id */
  salesOrderId: string;
  /** Human-readable sales order identifier (e.g. "SO-0001") */
  salesOrderIdentifier: string;
  /** Opportunity the SO belongs to */
  opportunityId: string;
  companyId: string;
  userId: string;
  /** A service-role Supabase client for storage + DB writes */
  serviceRole: SupabaseClient<Database>;
  /** The pdf loader imported from the sales-order pdf route */
  pdfLoader: (args: LoaderFunctionArgs) => Promise<Response>;
}): Promise<{ file: ArrayBuffer; fileName: string; documentFilePath: string }> {
  const {
    routeArgs,
    salesOrderId,
    salesOrderIdentifier,
    opportunityId,
    companyId,
    userId,
    serviceRole,
    pdfLoader
  } = args;

  // 1. Generate the PDF
  const pdfArgs = {
    ...routeArgs,
    params: { ...routeArgs.params, id: salesOrderId }
  };
  const pdf = await pdfLoader(pdfArgs);

  if (pdf.headers.get("content-type") !== "application/pdf") {
    throw new Error("Failed to generate PDF");
  }

  const file = await pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${salesOrderIdentifier} - ${new Date().toISOString().slice(0, -5)}.pdf`
  );

  // 2. Upload to Supabase storage
  const documentFilePath = `${companyId}/opportunity/${opportunityId}/${fileName}`;

  const uploadResult = await storage(serviceRole)
    .company(companyId)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadResult.error) {
    throw new Error("Failed to upload PDF to storage");
  }

  // 3. Create the document DB record
  const documentResult = await upsertDocument(serviceRole, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Sales Order",
    sourceDocumentId: salesOrderId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (documentResult.error) {
    throw new Error("Failed to create document record");
  }

  return { file, fileName, documentFilePath };
}

/**
 * Generates a sales return order (RMA) PDF via the pdf route loader, uploads
 * it to Supabase storage under the return order path, and creates a document
 * DB record.
 *
 * Returns the PDF ArrayBuffer and the generated file name.
 */
export async function generateAndAttachSalesReturnOrderPdf(
  /** A service-role Supabase client for storage + DB writes */
  serviceRole: SupabaseClient<Database>,
  args: {
    /** The original action/loader args from the route */
    routeArgs: LoaderFunctionArgs;
    /** Sales return order DB id */
    id: string;
    /** Human-readable RMA identifier (e.g. "RMA000001") */
    salesReturnOrderIdentifier: string;
    companyId: string;
    userId: string;
  }
): Promise<{ file: ArrayBuffer; fileName: string; documentFilePath: string }> {
  const { routeArgs, id, salesReturnOrderIdentifier, companyId, userId } = args;

  // 1. Generate the PDF
  const pdfArgs = {
    ...routeArgs,
    params: { ...routeArgs.params, id }
  };
  const pdf = await salesReturnOrderPdfLoader(pdfArgs);

  if (pdf.headers.get("content-type") !== "application/pdf") {
    throw new Error("Failed to generate PDF");
  }

  const file = await pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${salesReturnOrderIdentifier} - ${new Date().toISOString().slice(0, -5)}.pdf`
  );

  // 2. Upload to Supabase storage
  const documentFilePath = `${companyId}/sales-return-order/${id}/${fileName}`;

  const uploadResult = await storage(serviceRole)
    .company(companyId)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadResult.error) {
    throw new Error("Failed to upload PDF to storage");
  }

  // 3. Create the document DB record
  const documentResult = await upsertDocument(serviceRole, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Sales Return Order",
    sourceDocumentId: id,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (documentResult.error) {
    throw new Error("Failed to create document record");
  }

  return { file, fileName, documentFilePath };
}

/**
 * Generates a purchase return order (supplier return) PDF via the pdf route
 * loader, uploads it to Supabase storage under the return order path, and
 * creates a document DB record.
 *
 * Returns the PDF ArrayBuffer and the generated file name.
 */
export async function generateAndAttachPurchaseReturnOrderPdf(
  /** A service-role Supabase client for storage + DB writes */
  serviceRole: SupabaseClient<Database>,
  args: {
    /** The original action/loader args from the route */
    routeArgs: LoaderFunctionArgs;
    /** Purchase return order DB id */
    id: string;
    /** Human-readable return identifier (e.g. "PRO000001") */
    purchaseReturnOrderIdentifier: string;
    companyId: string;
    userId: string;
  }
): Promise<{ file: ArrayBuffer; fileName: string; documentFilePath: string }> {
  const { routeArgs, id, purchaseReturnOrderIdentifier, companyId, userId } =
    args;

  // 1. Generate the PDF
  const pdfArgs = {
    ...routeArgs,
    params: { ...routeArgs.params, id }
  };
  const pdf = await purchaseReturnOrderPdfLoader(pdfArgs);

  if (pdf.headers.get("content-type") !== "application/pdf") {
    throw new Error("Failed to generate PDF");
  }

  const file = await pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${purchaseReturnOrderIdentifier} - ${new Date()
      .toISOString()
      .slice(0, -5)}.pdf`
  );

  // 2. Upload to Supabase storage
  const documentFilePath = `${companyId}/purchase-return-order/${id}/${fileName}`;

  const uploadResult = await storage(serviceRole)
    .company(companyId)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadResult.error) {
    throw new Error("Failed to upload PDF to storage");
  }

  // 3. Create the document DB record
  const documentResult = await upsertDocument(serviceRole, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Purchase Return Order",
    sourceDocumentId: id,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (documentResult.error) {
    throw new Error("Failed to create document record");
  }

  return { file, fileName, documentFilePath };
}

/**
 * Sends a sales order confirmation email with the PDF attached.
 *
 * This mirrors the email-sending logic originally in the confirm action
 * and can be reused by the quote-to-order conversion flow.
 */
export async function sendSalesOrderEmail(args: {
  salesOrderId: string;
  companyId: string;
  companyGroupId: string;
  userId: string;
  customerContactId: string;
  cc?: string[];
  documentFilePath: string;
  fileName: string;
  serviceRole: SupabaseClient<Database>;
  locales: string[];
}): Promise<{ success: boolean; message?: string }> {
  const {
    salesOrderId,
    companyId,
    companyGroupId,
    userId,
    customerContactId,
    cc: ccSelections,
    documentFilePath,
    fileName,
    serviceRole,
    locales
  } = args;

  const [
    company,
    customer,
    salesOrder,
    salesOrderLines,
    salesOrderLocations,
    seller,
    paymentTerms
  ] = await Promise.all([
    getCompany(serviceRole, companyId),
    // customerContactId comes from the form and the service role bypasses
    // RLS — scope it so another company's contact is never read or emailed.
    getCustomerContact(serviceRole, customerContactId, companyId),
    getSalesOrder(serviceRole, salesOrderId),
    getSalesOrderLines(serviceRole, salesOrderId),
    getSalesOrderCustomerDetails(serviceRole, salesOrderId),
    getUser(serviceRole, userId),
    getPaymentTermsList(serviceRole, companyId)
  ]);

  if (!customer?.data?.contact) {
    return { success: false, message: "Failed to get customer contact" };
  }
  if (!company.data) {
    return { success: false, message: "Failed to get company" };
  }
  if (!seller.data) {
    return { success: false, message: "Failed to get user" };
  }
  if (!salesOrder.data) {
    return { success: false, message: "Failed to get sales order" };
  }
  if (!salesOrderLocations.data) {
    return { success: false, message: "Failed to get sales order locations" };
  }
  if (!paymentTerms.data) {
    return { success: false, message: "Failed to get payment terms" };
  }

  // Amounts render at the ORDER currency's decimals, same as the PDF of the
  // same order — otherwise the two disagree about the width of a total.
  const currencyRow = salesOrder.data.currencyCode
    ? await getCurrencyByCode(
        serviceRole,
        companyGroupId,
        salesOrder.data.currencyCode
      )
    : null;

  const emailTemplate = SalesOrderEmail({
    currencyDecimals: currencyRow?.data?.decimalPlaces ?? null,
    company: company.data as any,
    locale: locales?.[0] ?? "en-US",
    salesOrder: salesOrder.data,
    salesOrderLines: salesOrderLines.data ?? [],
    salesOrderLocations: salesOrderLocations.data,
    recipient: {
      email: customer.data.contact.email!,
      firstName: customer.data.contact.firstName ?? undefined,
      lastName: customer.data.contact.lastName ?? undefined
    },
    sender: {
      email: seller.data.email,
      firstName: seller.data.firstName,
      lastName: seller.data.lastName
    },
    paymentTerms: paymentTerms.data
  });

  const html = await renderAsync(emailTemplate);
  const text = await renderAsync(emailTemplate, { plainText: true });
  const signed = await storage(serviceRole)
    .company(companyId)
    .createSignedUrl(documentFilePath, 3600);

  await trigger("send-email", {
    to: [seller.data.email, customer.data.contact.email!],
    cc: ccSelections?.length ? ccSelections : undefined,
    from: seller.data.email,
    subject: `Order ${salesOrder.data.salesOrderId} from ${company.data.name}`,
    html,
    text,
    attachments: signed.data
      ? [
          {
            path: signed.data.signedUrl,
            filename: fileName
          }
        ]
      : undefined,
    companyId
  });

  return { success: true };
}

export async function getOrCreatePeriods(
  today: CalendarDate,
  weeksToProject: number
) {
  const start = startOfWeek(today, "en-US");

  // Generate weekly date ranges
  const ranges: { startDate: string; endDate: string }[] = [];
  let currentStart = start;
  for (let i = 0; i < weeksToProject; i++) {
    const periodEnd = currentStart.add({ days: 6 });
    ranges.push({
      startDate: currentStart.toString(),
      endDate: periodEnd.toString()
    });
    currentStart = periodEnd.add({ days: 1 });
  }

  const db = getDatabaseClient();

  // Check which periods already exist
  const existingPeriods = await db
    .selectFrom("period")
    .selectAll()
    .where(
      "startDate",
      "in",
      ranges.map((r) => r.startDate)
    )
    .where("periodType", "=", "Week")
    .execute();

  if (existingPeriods.length === ranges.length) {
    return existingPeriods.map(toPlainPeriod);
  }

  // Find missing periods
  const existingStartDates = new Set(
    existingPeriods.map((p) => dateToString(p.startDate))
  );

  const periodsToCreate = ranges.filter(
    (r) => !existingStartDates.has(r.startDate)
  );

  // Create missing periods in a transaction
  const created = await db.transaction().execute(async (trx) => {
    return await trx
      .insertInto("period")
      .values(
        periodsToCreate.map((p) => ({
          startDate: p.startDate,
          endDate: p.endDate,
          periodType: "Week" as const,
          createdAt: new Date().toISOString()
        }))
      )
      .returningAll()
      .execute();
  });

  return [...existingPeriods, ...created].map(toPlainPeriod);
}

/** Convert a pg DATE value (Date object or string) to an ISO date string. */
function dateToString(value: Date | string): string {
  if (value instanceof Date) {
    // Use local date parts to avoid timezone shift from toISOString()
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value);
}

/** Return a plain JSON-safe object with only the fields consumers need. */
function toPlainPeriod(p: {
  id: string;
  startDate: Date | string;
  endDate: Date | string;
  periodType: string;
}) {
  return {
    id: String(p.id),
    startDate: dateToString(p.startDate),
    endDate: dateToString(p.endDate),
    periodType: p.periodType
  };
}

/**
 * Every table with a string `id` and a `companyId` column. A nullable
 * `companyId` (e.g. `item`) is fine: global rows never match `.eq("companyId")`.
 */
type CompanyScopedTable = {
  [K in keyof Tables]: Tables[K]["Row"] extends {
    id: string;
    companyId: string | null;
  }
    ? K
    : never;
}[keyof Tables];

/**
 * Throws a 404 `Response` unless a row of `table` in `companyId` matches every
 * column in `match` — e.g. `{ id: lineId, quoteId }` proves the line exists,
 * belongs to the company AND hangs off that quote. One query.
 *
 * Record ids in a URL or form body prove nothing about tenancy:
 * `requirePermissions` authorizes the CALLER for `companyId`, not the ids it
 * sends. Most tables have single-column foreign keys, so a service-role or
 * Kysely write happily accepts another company's row as a parent. Call this
 * before any RLS-bypassing read or write keyed on a caller-supplied id.
 */
export async function requireCompanyRecord(
  client: SupabaseClient<Database>,
  table: CompanyScopedTable,
  companyId: string,
  match: { id: string } & Record<string, string>
): Promise<void> {
  // Every table in the union has `id` + `companyId`; the cast only narrows the
  // union so supabase-js can type the builder.
  const { data, error } = await client
    .from(table as "quoteLine")
    .select("id")
    .match(match)
    .eq("companyId", companyId)
    .maybeSingle();

  if (error) {
    logger.error("Failed to verify {table} for company", {
      table,
      companyId,
      match,
      error
    });
    throw new Response("Not found", { status: 404 });
  }
  if (!data) {
    logger.error("{table} not found for company", { table, companyId, match });
    throw new Response("Not found", { status: 404 });
  }
}

// What `get_app_shell` returns: the rows the shell used to read with nine
// requests. Each key holds what `select("*")` on that table returned.
type AppShellRows = {
  companies: Views["companies"]["Row"][];
  companyIntegrations: Tables["companyIntegration"]["Row"][];
  companySettings: Tables["companySettings"]["Row"] | null;
  savedViews: Tables["tableView"]["Row"][];
  user: Tables["user"]["Row"] | null;
  groups: string[];
  defaults: Views["userDefaults"]["Row"] | null;
  modulePreferences: Pick<
    Tables["userModulePreference"]["Row"],
    "module" | "position" | "hidden"
  >[];
  printerRoutes: PrinterRoute[];
  implementationHub: Tables["implementationHub"]["Row"] | null;
};

/**
 * Everything the app shell reads about the user and the company, in one round
 * trip. `client` is the user's own client: the function runs as them, so each
 * table's RLS applies as it did when these were separate requests.
 */
export async function getAppShell(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  const result = await client.rpc("get_app_shell", {
    company_id: companyId,
    user_id: userId
  });
  if (result.error || !result.data) {
    return { data: null, error: result.error ?? new Error("Empty app shell") };
  }
  const rows = result.data as unknown as AppShellRows;
  return {
    data: { ...rows, companies: rows.companies.map(withLogoUrls) },
    error: null
  };
}

const signalsLogger = getLogger("erp", "implementation-signals");

// A day, not forever: wiping a company's data (a demo template revert, a
// restore) can make a signal false again, and this bounds how long the hub
// would keep showing that step as done.
const IMPLEMENTATION_SIGNALS_TTL_SECONDS = 60 * 60 * 24;

const implementationSignalsKey = (companyId: string) =>
  `implementation:signals:${companyId}`;

/**
 * The hub's product signals, probing only the ones not already seen true.
 *
 * The app shell loads these on every page for an enrolled company — five
 * existence queries each time. A signal that is true stays true, so it is
 * remembered per company and its probe is skipped; a company that has done
 * all five steps costs one Redis read instead.
 */
export async function getImplementationSignals(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<Signals> {
  let known: Partial<Signals> = {};
  try {
    const cached = await redis.get(implementationSignalsKey(companyId));
    if (cached) known = JSON.parse(cached) as Partial<Signals>;
  } catch (error) {
    // Redis is an optimisation here; without it, probe everything.
    signalsLogger.warn("Could not read cached implementation signals", {
      companyId,
      error
    });
  }

  const signals = await detectImplementationSignals(client, companyId, known);

  const seen = Object.fromEntries(
    Object.entries(signals).filter(([, value]) => value)
  ) as Partial<Signals>;
  if (Object.keys(seen).length > Object.keys(known).length) {
    try {
      await redis.set(
        implementationSignalsKey(companyId),
        JSON.stringify(seen),
        "EX",
        IMPLEMENTATION_SIGNALS_TTL_SECONDS
      );
    } catch (error) {
      signalsLogger.warn("Could not cache implementation signals", {
        companyId,
        error
      });
    }
  }
  return signals;
}

// The readable identifier on each action task's parent, used for the Linear
// attachment / Jira remote-link title.
const actionTaskParents: Record<
  ActionTaskEntityType,
  { parentTable: string; readableColumn: string }
> = {
  nonConformanceActionTask: {
    parentTable: "nonConformance",
    readableColumn: "nonConformanceId"
  },
  changeOrderActionTask: {
    parentTable: "changeOrder",
    readableColumn: "changeOrderId"
  }
};

export type ActionTaskWithParent = {
  id: string | null;
  notes: unknown;
  parentId: string | null;
  parentReadableId: string | null;
};

// Entity-aware action-task read: resolves the task plus its parent (NCR or change notice) — reads an action
// task and its parent's readable id from whichever table the entity type names.
export async function getActionTaskWithParent(
  client: SupabaseClient<Database>,
  entityType: ActionTaskEntityType,
  taskId: string,
  companyId: string
): Promise<ActionTaskWithParent> {
  const { table, parentColumn } = actionTaskEntities[entityType];
  const { parentTable, readableColumn } = actionTaskParents[entityType];

  const result = await client
    .from(table)
    .select(`id, notes, ${parentColumn}, ${parentTable}(${readableColumn})`)
    .eq("id", taskId)
    .eq("companyId", companyId)
    .maybeSingle();

  // The select string is built from the entity map, which erases Supabase's row typing
  const row = result.data as Record<string, any> | null;

  return {
    id: row?.id ?? null,
    notes: row?.notes ?? null,
    parentId: row?.[parentColumn] ?? null,
    parentReadableId: row?.[parentTable]?.[readableColumn] ?? null
  };
}

const ONBOARDING_DRAFT_KEY = "onboarding-draft";

const onboardingDraftStorage = createCookieSessionStorage({
  cookie: {
    name: ONBOARDING_DRAFT_KEY,
    path: "/",
    secure: false,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 // 24 hours
  }
});

export type OnboardingDraft = {
  industry?: {
    industryId: string;
    customIndustryDescription?: string;
  };
  company?: {
    name?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateProvince?: string;
    postalCode?: string;
    countryCode?: string;
    baseCurrencyCode?: string;
    timezone?: string;
    website?: string;
  };
};

export async function getOnboardingDraft(
  request: Request
): Promise<OnboardingDraft | null> {
  const session = await onboardingDraftStorage.getSession(
    request.headers.get("Cookie")
  );
  const draft = session.get(ONBOARDING_DRAFT_KEY) as
    | OnboardingDraft
    | undefined;
  return draft ?? null;
}

export async function setOnboardingDraft(
  request: Request,
  draft: Partial<OnboardingDraft>
): Promise<string> {
  const session = await onboardingDraftStorage.getSession(
    request.headers.get("Cookie")
  );
  const existingDraft =
    (session.get(ONBOARDING_DRAFT_KEY) as OnboardingDraft | undefined) ?? {};
  const updatedDraft = { ...existingDraft, ...draft };
  session.set(ONBOARDING_DRAFT_KEY, updatedDraft);
  return onboardingDraftStorage.commitSession(session);
}

export async function clearOnboardingDraft(request: Request): Promise<string> {
  const session = await onboardingDraftStorage.getSession(
    request.headers.get("Cookie")
  );
  session.set(ONBOARDING_DRAFT_KEY, undefined);
  return onboardingDraftStorage.commitSession(session);
}
