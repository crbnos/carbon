// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl, ITAR_RIDER_SHA256, ITAR_RIDER_VERSION } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  ImplementationHubEmail,
  SalesOrderEmail
} from "@carbon/documents/email";
import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import {
  actionTaskEntities,
  actionTaskParentId,
  actionTaskPermissions
} from "@carbon/ee/action-task-entity";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { resolveIntegrationSecrets } from "@carbon/ee/integrations/secrets";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  linkActionToJiraIssue,
  type TiptapDocument,
  tiptapToAdf,
  unlinkActionFromJiraIssue
} from "@carbon/ee/jira.server";
import {
  getLinearClient,
  linkActionToLinearIssue,
  unlinkActionFromLinearIssue
} from "@carbon/ee/linear.server";
import {
  createIssueSlackThread,
  getCarbonEmployeeFromSlackId
} from "@carbon/ee/slack.server";
import { ERP_URL, SESSION_SECRET } from "@carbon/env";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { Signals } from "@carbon/onboarding";
import {
  detectImplementationSignals,
  enrollImplementation,
  getImplementationHub
} from "@carbon/onboarding/server";
import type { PrinterRoute } from "@carbon/printing";
import { serverFns } from "@carbon/server-functions";
import type { RequiredPermissions } from "@carbon/server-functions/permissions";
import {
  createConnectAccountLink,
  getOrCreateConnectAccount,
  isStaleConnectAccountError
} from "@carbon/stripe/connect.server";
import { datetime, unchecked } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { parseAbsolute, startOfWeek } from "@internationalized/date";
import { render, renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCookieSessionStorage, data } from "react-router";
import { z } from "zod";
import {
  getCurrencyByCode,
  getPaymentTermsList
} from "~/modules/accounting/accounting.service";
import {
  canEditChangeNoticeWorkflow,
  changeNoticeLockedMessage
} from "~/modules/items/items.models";
import { nonConformancePriority } from "~/modules/quality/quality.models";
import { insertIssue } from "~/modules/quality/quality.service";
import {
  importQuotes,
  isQuoteImportTable
} from "~/modules/sales/sales.import.server";
import {
  getCustomerContact,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines
} from "~/modules/sales/sales.service";
import {
  CarbonError,
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getCompany, withLogoUrls } from "~/modules/settings/settings.service";
import { getTimezoneNames, importCsv } from "~/modules/shared/shared.service";
import { getUser } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import type { CustomFieldsTableType } from "../settings";
import {
  type CreatableLookup,
  creatableLookups,
  importPermissions,
  importRequiresCreate,
  importSchemas
} from "./imports.models";

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
 * Throws a 404 `Response` naming the record unless a row of `table` in `companyId` matches every
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
    // The check itself failed: nothing is known about the record.
    throw new Response(`Failed to verify the ${recordName(table)}`, {
      status: 500
    });
  }
  if (!data) {
    logger.error("{table} not found for company", { table, companyId, match });
    // One message for a missing row and another company's row: the caller
    // must not learn which.
    throw new Response(
      `The ${recordName(table)} could not be found. It may have been deleted, or it belongs to another company.`,
      { status: 404 }
    );
  }
}

/**
 * `requireCompanyRecord` for a service function: a refusal instead of a thrown
 * `Response`. Checked with the service role, so it holds for an RLS-bypassing
 * write that follows.
 */
export async function refuseUnlessOwned(
  ctx: ServiceContext,
  table: CompanyScopedTable,
  match: { id: string } & Record<string, string>
): Promise<CarbonError | null> {
  try {
    await requireCompanyRecord(
      ctx.asSystem.supabase,
      table,
      ctx.company.id,
      match
    );
    return null;
  } catch (thrown) {
    if (!(thrown instanceof Response)) throw thrown;
    return ctx.error(
      thrown.status === 404 ? "notFound" : "internal",
      await thrown.text()
    );
  }
}

/**
 * Whether `userId` is an ACTIVE employee of `companyId` — the check every
 * user-id field that names a person in the company needs before it is saved
 * (a planning action's assignee, a responsible employee). Those columns
 * reference the global `user` table, so the database accepts anyone's id,
 * including a person from another company or one since deactivated. One query;
 * a failed read is logged and answered false (fail closed).
 */
export async function isActiveCompanyEmployee(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("employee")
    .select("id")
    .eq("id", userId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    logger.error("Failed to verify employee for company", {
      companyId,
      userId,
      error
    });
    return false;
  }
  return data !== null;
}

/** `quoteLine` → `quote line`, for a message a person reads. */
function recordName(table: string): string {
  return table.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
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
  // Absent for someone who has signed in and has no company yet.
  companyId: string | null | undefined,
  userId: string
) {
  const result = await client.rpc("get_app_shell", {
    // Sent as null, never left out. An undefined key is dropped from the
    // request, the API then looks for a `get_app_shell(user_id)` that does
    // not exist, and a first sign-in was logged straight back out instead
    // of being sent to onboarding. With null the function runs and returns
    // the user with no company rows.
    company_id: (companyId ?? null) as string,
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
    secrets: [SESSION_SECRET!],
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

// For a list that is the same for every company and changes only with a deploy
// or the database's own reference data. `private`: the route still needs a
// session, so no shared cache may hold it.
export const DAY_CACHE_HEADERS = { "Cache-Control": "private, max-age=86400" };

/**
 * A global `{ data, error }` list the browser keeps for a day, across page
 * loads. An empty or failed read is not kept: it would stick for the day.
 */
export function keptForADay<T extends { data: unknown[] | null }>(result: T) {
  return data(
    result,
    result.data?.length ? { headers: DAY_CACHE_HEADERS } : undefined
  );
}

// ── Operations ──────────────────────────────────────────────────────────────

/** The notification an assignment on `table` sends its assignee, if any. */
function assignmentEvent(table: string): NotificationEvent | null {
  switch (table) {
    case "purchasingRfq":
      return NotificationEvent.PurchasingRfqAssignment;
    case "salesRfq":
      return NotificationEvent.SalesRfqAssignment;
    case "quote":
      return NotificationEvent.QuoteAssignment;
    case "salesOrder":
      return NotificationEvent.SalesOrderAssignment;
    case "job":
      return NotificationEvent.JobAssignment;
    case "jobCompleted":
      return NotificationEvent.JobCompleted;
    case "jobOperation":
      return NotificationEvent.JobOperationAssignment;
    case "maintenanceDispatch":
      return NotificationEvent.MaintenanceDispatchAssignment;
    case "nonConformanceInvestigationTask":
    case "nonConformanceActionTask":
    case "nonConformanceApprovalTask":
    case "nonConformance":
      return NotificationEvent.NonConformanceAssignment;
    case "procedure":
      return NotificationEvent.ProcedureAssignment;
    case "purchaseOrder":
      return NotificationEvent.PurchaseOrderAssignment;
    case "purchaseInvoice":
      return NotificationEvent.PurchaseInvoiceAssignment;
    case "riskRegister":
      return NotificationEvent.RiskAssignment;
    case "supplierQuote":
      return NotificationEvent.SupplierQuoteAssignment;
    case "stockTransfer":
      return NotificationEvent.StockTransferAssignment;
    case "pickingList":
      return NotificationEvent.PickingListAssignment;
    case "training":
      return NotificationEvent.ResourceTrainingAssignment;
    case "trainingAssignment":
      return NotificationEvent.TrainingAssignment;
    default:
      return null;
  }
}

/**
 * Assign a record to a person, and tell them.
 *
 * @remarks
 * Sets `assignee` on the row of `table` with `id`, as the caller: row-level
 * security decides what they may change. An empty `assignee` unassigns it.
 * When someone is assigned and the table has an assignment notification,
 * they are notified: a job operation's names its job, make method and parent
 * material, and an issue task's names its issue. A failed notification comes
 * back as an error after the assignment is saved.
 */
export const assignRecord = defineServiceFn({
  input: z.object({
    table: z.string().min(1),
    id: z.string().min(1),
    assignee: z.string()
  }),
  permission: {},

  async run(ctx, { table, id, assignee }) {
    const client = ctx.asCaller.supabase;
    const assigned = await assign(client, { table, id, assignee });
    if (assigned.error) {
      return ctx.error("internal", "Failed to assign", assigned.error);
    }

    const event = assignee ? assignmentEvent(table) : null;
    if (!event) return { id };

    let documentId: string | null | undefined = id;
    if (table === "jobOperation") {
      const operation = await client
        .from("jobOperation")
        .select("*, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
        .eq("id", id)
        .single();
      const jobId = operation.data?.job?.id;
      const makeMethodId = operation.data?.jobMakeMethod?.id;
      const materialId = operation.data?.jobMakeMethod?.parentMaterialId;
      documentId = `${jobId}:${id}:${makeMethodId}:${materialId ?? ""}`;
    }
    if (
      table === "nonConformanceActionTask" ||
      table === "nonConformanceApprovalTask"
    ) {
      const task = await client
        .from(table)
        .select("nonConformanceId")
        .eq("id", id)
        .single();
      documentId = task.data?.nonConformanceId;
    }
    if (!documentId) return { id };

    try {
      await trigger("notify", {
        companyId: ctx.company.id,
        documentId,
        event,
        recipient: { type: "user", userId: assignee },
        from: ctx.auditUserId
      });
    } catch (error) {
      return ctx.error("internal", "Failed to notify user", error);
    }
    return { id };
  }
});

type ImportTable = keyof typeof importPermissions;

const importTables = Object.keys(importPermissions) as [
  ImportTable,
  ...ImportTable[]
];

// `update` on the table's module; an import that posts stock also needs
// `create`, as the single-record adjustment does.
const importRules = Object.fromEntries(
  importTables.map((table) => [
    table,
    importRequiresCreate.has(table)
      ? { update: importPermissions[table], create: importPermissions[table] }
      : { update: importPermissions[table] }
  ])
) as Record<ImportTable, RequiredPermissions>;

/**
 * Import a CSV file into a table.
 *
 * @remarks
 * The file is already in the company's storage at `filePath`.
 * `columnMappings` names, for each of the table's fields, the CSV column that
 * fills it; the table's required fields must be mapped. `enumMappings` maps
 * CSV values onto a field's allowed values (field → CSV value → value). Needs
 * `update` on the table's module, and `create` too for the stock imports.
 * Quotes go through the sales importer, so each gets its opportunity,
 * payment, shipment and share link as one made in the app does; every other
 * table goes through the import server function. Returns how many rows were
 * inserted and updated, and the rows that failed or were skipped, with why.
 */
export const importCsvFile = defineServiceFn({
  input: z.object({
    table: z.enum(importTables),
    filePath: z.string().min(1),
    columnMappings: z.record(z.string(), z.string()),
    enumMappings: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional()
  }),
  permission: { by: "table", rules: importRules },

  async run(ctx, { table, filePath, enumMappings, ...input }) {
    const mapped = importSchemas[table].safeParse(input.columnMappings);
    if (!mapped.success) {
      return ctx.error("validation", z.prettifyError(mapped.error));
    }
    const columnMappings = mapped.data as Record<string, string>;

    const imported = isQuoteImportTable(table)
      ? await importQuotes(ctx.asSystem.supabase, {
          db: ctx.asSystem.pg,
          table,
          filePath,
          columnMappings,
          enumMappings,
          companyId: ctx.company.id,
          companyGroupId: ctx.company.groupId,
          userId: ctx.auditUserId
        })
      : await importCsv(ctx.asSystem.supabase, ctx.asSystem.pg, {
          table,
          filePath,
          columnMappings,
          // Typed loosely by the service; the server function reads the
          // real shape (field → { value → mapped }).
          enumMappings: enumMappings as unknown as Record<string, string[]>,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        });
    if (imported.error) {
      return ctx.error("internal", imported.error.message, imported.error);
    }

    type RowIssue = {
      row: number;
      reason: string;
      values: Record<string, string>;
    };
    const summary = (imported.data ?? {}) as {
      inserted?: number;
      updated?: number;
      errors?: RowIssue[];
      skipped?: RowIssue[];
    };
    return {
      inserted: summary.inserted ?? 0,
      updated: summary.updated ?? 0,
      errors: summary.errors ?? [],
      skipped: summary.skipped ?? []
    };
  }
});

// Creating a lookup is gated by the module that owns it. Exhaustive: a new
// lookup without a permission fails typecheck.
const lookupRules: Record<CreatableLookup, RequiredPermissions> = {
  supplierType: { create: "purchasing" },
  customerType: { create: "sales" },
  customerStatus: { create: "sales" }
};

const normalizeLookupName = (value: string) => value.toLowerCase().trim();

/**
 * Create name-only lookup values for a CSV import: supplier types, customer
 * types, customer statuses.
 *
 * @remarks
 * Needs `create` on the module that owns the lookup. A name that already
 * exists is matched case-insensitively and returned instead of created, and
 * case variants within the batch become one value. `results` answers every
 * name, in order: the value's id and name, or an error.
 */
export const createImportLookups = defineServiceFn({
  input: z.object({
    lookup: z.enum(creatableLookups),
    names: z.array(z.string().trim().min(1)).min(1).max(100)
  }),
  permission: { by: "lookup", rules: lookupRules },

  async run(ctx, { lookup, names }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // All three tables share the same name-only shape, unique on
    // (name, companyId): one read, one bulk insert.
    const existing = await client
      .from(lookup)
      .select("id, name")
      .eq("companyId", companyId);
    if (existing.error) {
      return ctx.error("internal", "Failed to read the values", existing.error);
    }

    const rowByName = new Map(
      existing.data.map((row) => [normalizeLookupName(row.name), row])
    );
    const missing = [
      ...new Map(
        names
          .filter((name) => !rowByName.has(normalizeLookupName(name)))
          .map((name) => [normalizeLookupName(name), name])
      ).values()
    ];

    if (missing.length > 0) {
      const inserted = await client
        .from(lookup)
        .insert(
          missing.map((name) => ({
            name,
            companyId,
            createdBy: ctx.auditUserId
          }))
        )
        .select("id, name");
      if (inserted.error) {
        return ctx.error(
          "internal",
          "Failed to create the values",
          inserted.error
        );
      }
      for (const row of inserted.data) {
        rowByName.set(normalizeLookupName(row.name), row);
      }
    }

    return {
      results: names.map((name) => {
        const row = rowByName.get(normalizeLookupName(name));
        return row
          ? { id: row.id, name: row.name }
          : { name, error: "Could not create value" };
      })
    };
  }
});

/**
 * Enroll the company in the Implementation Hub, and tell its admins.
 *
 * @remarks
 * Self-serve: anyone who can update company settings may enroll their own
 * company. A company that is already enrolled is left as it is (`enrolled`
 * is false). Every active Admin employee with an email is sent "Your
 * Implementation Hub is ready"; a failed email is logged and never fails the
 * enrollment.
 *
 * @mcp
 */
export const enrollImplementationHub = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },

  async run(ctx) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    // A double submit or a stale tab: it is enrolled already.
    const existing = await getImplementationHub(serviceRole, companyId);
    if (existing.data) return { enrolled: false };

    const enrolled = await enrollImplementation(serviceRole, {
      companyId,
      userId: ctx.auditUserId,
      tier: "self_serve"
    });
    if (enrolled.error) {
      return ctx.error("internal", "Failed to enroll company", enrolled.error);
    }

    await notifyImplementationHubAdmins(ctx);
    return { enrolled: true };
  }
});

/** Email the company's active admins that their hub is ready. Never throws. */
async function notifyImplementationHubAdmins(ctx: ServiceContext) {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  try {
    const adminTypes = await serviceRole
      .from("employeeType")
      .select("id")
      .eq("companyId", companyId)
      .eq("systemType", "Admin");
    if (adminTypes.error) throw adminTypes.error;

    const adminTypeIds = (adminTypes.data ?? []).map((type) => type.id);
    if (adminTypeIds.length === 0) {
      logger.info(
        "No Admin employee type found for company; skipping enrollment notification"
      );
      return;
    }

    const admins = await serviceRole
      .from("employees")
      .select("id, email, name")
      .eq("companyId", companyId)
      .eq("active", true)
      .in("employeeTypeId", adminTypeIds);
    if (admins.error) throw admins.error;

    const hubUrl = `${ERP_URL}${path.to.getStarted}`;
    for (const admin of admins.data ?? []) {
      if (!admin.email) continue;
      try {
        const email = ImplementationHubEmail({
          recipientName: admin.name ?? undefined,
          hubUrl
        });
        await trigger("send-email", {
          to: [admin.email],
          subject: "Your Implementation Hub is ready",
          html: await render(email),
          text: await render(email, { plainText: true }),
          companyId
        });
      } catch (error) {
        logger.error("Failed to send Implementation Hub email to admin", {
          adminId: admin.id ?? "unknown",
          error
        });
      }
    }
  } catch (error) {
    logger.error("Failed to notify admins of Implementation Hub enrollment", {
      companyId,
      error
    });
  }
}

/**
 * Open an issue from Slack's Create Issue form, with its Slack thread.
 *
 * @remarks
 * For the Slack integration's signed requests only: the company is the one
 * the Slack workspace is connected to. The Slack user is matched to a Carbon
 * user by email, and the issue is created as them at their default location
 * (the company's first location when they have none). Its action tasks are
 * created, and a thread for it is posted in the integration's channel; a
 * failure of either is logged and does not fail the issue.
 */
export const createIssueFromSlack = defineServiceFn({
  input: z.object({
    slackUserId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    nonConformanceTypeId: z.string(),
    nonConformanceWorkflowId: z.string().optional(),
    priority: z.enum(nonConformancePriority)
  }),
  permission: "system",

  async run(ctx, input) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    const integration = await serviceRole
      .from("companyIntegration")
      .select("metadata, secretRef")
      .eq("id", "slack")
      .eq("companyId", companyId)
      .maybeSingle();
    if (integration.error || !integration.data) {
      return ctx.error(
        "notFound",
        "Slack integration not found for this workspace.",
        integration.error
      );
    }

    // The configured channel, not the one the form was opened from.
    const channelId = (integration.data.metadata as { channel_id?: string })
      ?.channel_id;
    if (!channelId) {
      return ctx.error("rule", "No channel configured for Slack integration");
    }

    const secrets = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      "slack",
      integration.data.metadata,
      integration.data.secretRef
    )) as { access_token?: string };
    const slackToken = secrets.access_token;
    if (!slackToken) {
      return ctx.error(
        "rule",
        "Slack token not found. Please reconfigure the integration."
      );
    }

    const employee = await getCarbonEmployeeFromSlackId(
      serviceRole,
      slackToken,
      input.slackUserId,
      companyId
    );
    if (employee.error || !employee.data) {
      return ctx.error("internal", "Failed to get employee", employee.error);
    }
    const userId = employee.data.id;

    const created = await insertIssue(serviceRole, {
      companyId,
      createdBy: userId,
      description: input.description,
      locationId: employee.data.locationId || "",
      name: input.title,
      nonConformanceTypeId: input.nonConformanceTypeId,
      nonConformanceWorkflowId: input.nonConformanceWorkflowId,
      openDate: datetime.timestamp(),
      priority: input.priority,
      source: "Internal"
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to create issue", created.error);
    }
    const issueId = created.data.id;

    const [thread, tasks] = await Promise.all([
      createIssueSlackThread(
        serviceRole,
        {
          carbonUrl: `${ERP_URL}${path.to.issue(issueId)}`,
          companyId,
          description: input.description,
          id: issueId,
          nonConformanceId: created.data.nonConformanceId,
          severity: input.priority,
          title: input.title,
          userId
        },
        { slackToken, slackUserId: input.slackUserId, channelId }
      ),
      serverFns
        .system({ db: ctx.asSystem.pg, companyId, userId })
        .invoke("create", { type: "nonConformanceTasks", id: issueId })
    ]);
    if (tasks.error) {
      logger.error("Error creating tasks", { error: tasks.error });
    }
    if (thread.error) {
      logger.error("Error creating thread", { error: thread.error });
    }

    return { issueId };
  }
});

/**
 * Start Stripe Connect onboarding: the URL of Stripe's onboarding page.
 *
 * @remarks
 * Uses the company's Connect account, or creates one for the caller's email.
 * When Stripe no longer recognises the stored account (deleted, or its
 * access revoked) a new one is created and used instead. The account is
 * recorded on the company's `stripe-connect` integration, active and marked
 * as onboarding started; without that record the callback cannot finish.
 * Stripe sends the browser back to `origin`'s callback. A Stripe account
 * that is not set up as a Connect platform comes back as `unavailable`.
 */
export const startStripeConnectOnboarding = defineServiceFn({
  input: z.object({ origin: z.url() }),
  permission: { update: "settings" },

  async run(ctx, { origin }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const returnUrl = `${origin}/api/integrations/stripe-connect/callback?status=success`;
    const refreshUrl = `${origin}/api/integrations/stripe-connect/callback?status=refresh`;

    const user = await ctx.asSystem.supabase
      .from("user")
      .select("email")
      .eq("id", ctx.auditUserId)
      .single();
    if (user.error || !user.data?.email) {
      return ctx.error("internal", "Failed to read your email", user.error);
    }
    const email = user.data.email;

    try {
      let stripeAccountId = await getOrCreateConnectAccount(
        client,
        companyId,
        email
      );

      let redirectUrl: string;
      try {
        redirectUrl = await createConnectAccountLink(
          stripeAccountId,
          returnUrl,
          refreshUrl
        );
      } catch (linkError) {
        if (!isStaleConnectAccountError(linkError)) throw linkError;
        logger.warn(
          "Stripe Connect account link failed against the stored account; creating a new account",
          { companyId, stripeAccountId, error: linkError }
        );
        stripeAccountId = await getOrCreateConnectAccount(
          client,
          companyId,
          email,
          { forceNew: true }
        );
        redirectUrl = await createConnectAccountLink(
          stripeAccountId,
          returnUrl,
          refreshUrl
        );
      }

      const existing = await client
        .from("companyIntegration")
        .select("metadata")
        .eq("id", "stripe-connect")
        .eq("companyId", companyId)
        .maybeSingle();
      const saved = await client.from("companyIntegration").upsert({
        id: "stripe-connect",
        companyId,
        active: true,
        metadata: {
          ...(existing.data?.metadata as Record<string, unknown> | undefined),
          stripeAccountId,
          onboardingStarted: true
        }
      });
      if (saved.error) {
        // Without the account id the callback fails with "No Stripe Connect
        // account found", after onboarding against an unrecorded account.
        return ctx.error(
          "internal",
          `Failed to save Stripe Connect account id: ${saved.error.message}`,
          saved.error
        );
      }

      return { redirectUrl };
    } catch (error) {
      const stripeError = error as {
        message?: string;
        code?: string;
        raw?: { code?: string };
      };
      const message =
        stripeError.message || "Failed to initiate Stripe Connect onboarding";
      // Stripe's code for "your own account is not a Connect platform": an
      // administrator has to fix the platform, so a retry never helps.
      if (
        (stripeError.code ?? stripeError.raw?.code) ===
        "platform_account_required"
      ) {
        return ctx.error("unavailable", message, error);
      }
      return ctx.error("internal", message, error);
    }
  }
});

const _itarRequestMeta = {
  /** Best-effort, from the request, for the compliance record. */
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable()
};

/**
 * Record an ITAR certification with a 365-day expiry, and audit it.
 * Through the service role: a self-attesting user holds no settings_create.
 */
async function _recordItarCertification(
  ctx: ServiceContext,
  certification: {
    type: "entity" | "user";
    fullLegalName: string;
    title?: string;
    complianceContact?: string;
    ipAddress: string | null;
    userAgent: string | null;
  }
) {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const certifiedAt = datetime.timestamp();
  const expiresAt = parseAbsolute(certifiedAt, "UTC")
    .add({ days: 365 })
    .toAbsoluteString();

  const inserted = await serviceRole
    .from("itarCertification")
    .insert({
      companyId,
      userId,
      type: certification.type,
      docVersion: ITAR_RIDER_VERSION,
      docHash: ITAR_RIDER_SHA256,
      fullLegalName: certification.fullLegalName,
      title: certification.title ?? null,
      complianceContact: certification.complianceContact ?? null,
      certifiedAt,
      ipAddress: certification.ipAddress,
      userAgent: certification.userAgent,
      expiresAt,
      createdBy: userId
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    return ctx.error(
      "internal",
      "Failed to record certification",
      inserted.error
    );
  }

  // Best-effort: a company without audit logging has no audit table, and the
  // certification row is the authoritative compliance record.
  try {
    await insertAuditLogEntries(serviceRole, companyId, [
      {
        tableName: "itarCertification",
        entityType: "itarCertification",
        entityId: inserted.data.id,
        recordId: inserted.data.id,
        operation: "INSERT",
        actorId: userId,
        metadata: {
          ipAddress: certification.ipAddress ?? undefined,
          userAgent: certification.userAgent ?? undefined
        },
        createdAt: certifiedAt
      }
    ]);
  } catch (error) {
    logger.warn(`ITAR ${certification.type} certification audit skipped`, {
      error
    });
  }
  return { id: inserted.data.id };
}

const actionTaskEntityTypes = Object.keys(actionTaskEntities) as [
  ActionTaskEntityType,
  ...ActionTaskEntityType[]
];

// An issue's tasks are quality's, a change notice's are parts'.
const actionTaskRule = {
  by: "entityType",
  rules: {
    nonConformanceActionTask: actionTaskPermissions("nonConformanceActionTask"),
    changeOrderActionTask: actionTaskPermissions("changeOrderActionTask")
  }
} as const;

const actionTaskInput = {
  entityType: z.enum(actionTaskEntityTypes),
  actionId: z.string().min(1)
};

/**
 * The action task an integration acts on, or a refusal when it hangs off a
 * change notice whose workflow can no longer change.
 */
async function editableActionTask(
  ctx: ServiceContext,
  entityType: ActionTaskEntityType,
  actionId: string
): Promise<ActionTaskWithParent | CarbonError> {
  const client = ctx.asCaller.supabase;
  const task = await getActionTaskWithParent(
    client,
    entityType,
    actionId,
    ctx.company.id
  );
  if (entityType !== "changeOrderActionTask") return task;

  const notFound = ctx.error("notFound", "Could not find change notice");
  if (!task.parentId) return notFound;
  const notice = await client
    .from("changeOrder")
    .select("status")
    .eq("id", task.parentId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (notice.error || !notice.data) return notFound;
  if (!canEditChangeNoticeWorkflow(notice.data.status)) {
    return ctx.error("rule", changeNoticeLockedMessage(notice.data.status));
  }
  return task;
}

/** Where the action task's parent opens in Carbon, for the link back. */
function actionTaskUrl(
  rows: unknown,
  entityType: ActionTaskEntityType
): string {
  const parentId = actionTaskParentId(rows, entityType) ?? "";
  return `${getAppUrl()}${actionTaskEntities[entityType].detailPath(parentId)}/details`;
}

/**
 * Create a Jira issue for an action task, and link the two.
 *
 * @remarks
 * The task's notes become the issue's description, else `description`
 * (Tiptap JSON or plain text). A change notice's task is refused once the
 * notice's workflow is locked. The Jira issue gets a link back to the task's
 * issue or change notice in Carbon.
 */
export const createJiraIssue = defineServiceFn({
  input: z.object({
    ...actionTaskInput,
    projectKey: z.string().min(1),
    issueTypeId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional()
  }),
  permission: actionTaskRule,

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const { entityType, actionId } = input;
    const jira = getJiraClient();

    const [task, siteUrl] = await Promise.all([
      editableActionTask(ctx, entityType, actionId),
      jira.getSiteUrl(companyId)
    ]);
    if (task instanceof CarbonError) return task;

    let description: ReturnType<typeof tiptapToAdf> | undefined;
    if (task.notes && typeof task.notes === "object") {
      try {
        description = tiptapToAdf(task.notes as TiptapDocument);
      } catch (error) {
        logger.error("Failed to convert notes to ADF", { error });
      }
    }
    if (!description && input.description) {
      try {
        description = tiptapToAdf(JSON.parse(input.description));
      } catch {
        description = {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: input.description }]
            }
          ]
        } as ReturnType<typeof tiptapToAdf>;
      }
    }

    const issue = await jira.createIssue(companyId, {
      projectKey: input.projectKey,
      issueTypeId: input.issueTypeId,
      summary: input.title,
      description,
      assigneeId: input.assignee || undefined
    });
    if (!issue) return ctx.error("internal", "Failed to create Jira issue");

    const linked = await linkActionToJiraIssue(
      ctx.asCaller.supabase,
      companyId,
      { entityType, actionId, issue, siteUrl }
    );
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    await jira.createRemoteLink(
      companyId,
      issue.id,
      actionTaskUrl(linked.data, entityType),
      `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    );
    return { issueId: issue.id };
  }
});

/**
 * Link an action task to an existing Jira issue.
 *
 * @remarks
 * The issue's assignee becomes the task's when a Carbon user has their
 * email. A change notice's task is refused once the notice's workflow is
 * locked. The task's notes replace the issue's description (best effort),
 * and the Jira issue gets a link back to Carbon.
 */
export const linkJiraIssue = defineServiceFn({
  input: z.object({ ...actionTaskInput, issueId: z.string().min(1) }),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId, issueId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const jira = getJiraClient();

    const [task, issue, siteUrl] = await Promise.all([
      editableActionTask(ctx, entityType, actionId),
      jira.getIssue(companyId, issueId),
      jira.getSiteUrl(companyId)
    ]);
    if (task instanceof CarbonError) return task;
    if (!issue) return ctx.error("notFound", "Issue not found");

    const email = issue.fields.assignee?.emailAddress ?? "";
    let assignee: string | null = null;
    if (email) {
      const user = await client
        .from("user")
        .select("id")
        .eq("email", email)
        .single();
      assignee = user.data?.id ?? null;
    }

    const linked = await linkActionToJiraIssue(client, companyId, {
      entityType,
      actionId,
      issue,
      siteUrl,
      assignee
    });
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    if (task.notes && typeof task.notes === "object") {
      try {
        await jira.updateIssue(companyId, issue.id, {
          description: tiptapToAdf(task.notes as TiptapDocument)
        });
      } catch (error) {
        logger.error("Failed to update Jira issue description", { error });
      }
    }

    await jira.createRemoteLink(
      companyId,
      issue.id,
      actionTaskUrl(linked.data, entityType),
      `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    );
    return { issueId: issue.id };
  }
});

/**
 * Unlink an action task from its Jira issue.
 *
 * @remarks
 * A change notice's task is refused once the notice's workflow is locked.
 * The link back to Carbon is then removed from the Jira issue (best effort).
 */
export const unlinkJiraIssue = defineServiceFn({
  input: z.object(actionTaskInput),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    if (entityType === "changeOrderActionTask") {
      const task = await editableActionTask(ctx, entityType, actionId);
      if (task instanceof CarbonError) return task;
    }

    const mapping = await getJiraIssueFromExternalId(
      client,
      companyId,
      actionId,
      entityType
    );
    const unlinked = await unlinkActionFromJiraIssue(client, companyId, {
      entityType,
      actionId
    });
    if (unlinked.error) {
      return ctx.error("internal", "Failed to unlink issue", unlinked.error);
    }

    if (mapping) {
      try {
        const jira = getJiraClient();
        const remoteLinks = await jira.getRemoteLinks(companyId, mapping.id);
        const carbonLink = remoteLinks.find(
          (link) =>
            link.application?.name === "Carbon" ||
            link.globalId.startsWith("carbon-")
        );
        if (carbonLink) {
          await jira.deleteRemoteLink(
            companyId,
            mapping.id,
            carbonLink.globalId
          );
        }
      } catch (error) {
        logger.error("Failed to clean up Jira remote link", { error });
      }
    }
    return { actionId };
  }
});

/**
 * Create a Linear issue for an action task, and link the two.
 *
 * @remarks
 * A change notice's task is refused once the notice's workflow is locked.
 * The Linear issue gets an attachment linking back to the task's issue or
 * change notice in Carbon.
 */
export const createLinearIssue = defineServiceFn({
  input: z.object({
    ...actionTaskInput,
    teamId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    assignee: z.string().optional()
  }),
  permission: actionTaskRule,

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const { entityType, actionId } = input;
    const linear = getLinearClient();

    const task = await editableActionTask(ctx, entityType, actionId);
    if (task instanceof CarbonError) return task;

    const issue = await linear.createIssue(companyId, {
      teamId: input.teamId,
      title: input.title,
      description: input.description || undefined,
      assigneeId: input.assignee || null
    });
    if (!issue) return ctx.error("internal", "Failed to create Linear issue");

    const linked = await linkActionToLinearIssue(
      ctx.asCaller.supabase,
      companyId,
      { entityType, actionId, issue }
    );
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id,
      url: actionTaskUrl(linked.data, entityType),
      title: `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    });
    return { issueId: issue.id };
  }
});

/**
 * Link an action task to an existing Linear issue.
 *
 * @remarks
 * The issue's assignee becomes the task's when a Carbon user has their
 * email. A change notice's task is refused once the notice's workflow is
 * locked. The Linear issue gets an attachment linking back to Carbon.
 */
export const linkLinearIssue = defineServiceFn({
  input: z.object({ ...actionTaskInput, issueId: z.string().min(1) }),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId, issueId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const linear = getLinearClient();

    const [task, issue] = await Promise.all([
      editableActionTask(ctx, entityType, actionId),
      linear.getIssueById(companyId, issueId)
    ]);
    if (task instanceof CarbonError) return task;
    if (!issue) return ctx.error("notFound", "Issue not found");

    const email = issue.assignee?.email ?? "";
    let assignee: string | null = null;
    if (email) {
      const user = await client
        .from("user")
        .select("id")
        .eq("email", email)
        .single();
      assignee = user.data?.id ?? null;
    }

    const linked = await linkActionToLinearIssue(client, companyId, {
      entityType,
      actionId,
      issue,
      assignee
    });
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id as string,
      url: actionTaskUrl(linked.data, entityType),
      title: `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    });
    return { issueId: issue.id as string };
  }
});

/**
 * Unlink an action task from its Linear issue.
 *
 * @remarks
 * A change notice's task is refused once the notice's workflow is locked.
 * The attachment linking back to Carbon is then removed from the Linear
 * issue (best effort).
 */
export const unlinkLinearIssue = defineServiceFn({
  input: z.object(actionTaskInput),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId }) {
    const companyId = ctx.company.id;
    if (entityType === "changeOrderActionTask") {
      const task = await editableActionTask(ctx, entityType, actionId);
      if (task instanceof CarbonError) return task;
    }

    const unlinked = await unlinkActionFromLinearIssue(
      ctx.asCaller.supabase,
      companyId,
      { entityType, actionId }
    );
    if (unlinked.error) {
      return ctx.error("internal", "Failed to unlink issue", unlinked.error);
    }

    try {
      const parentId = actionTaskParentId(unlinked.data, entityType);
      if (parentId) {
        const linear = getLinearClient();
        const [found] = await linear.listAttachments(companyId, parentId);
        if (found) await linear.removeAttachment(companyId, found.id);
      }
    } catch (error) {
      logger.error("Failed to clean up Linear attachment", { error });
    }
    return { actionId };
  }
});
