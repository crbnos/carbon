// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type PermissionRule,
  type Permissions,
  resolvePermissions
} from "@carbon/api/permissions";
import {
  CarbonError,
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { settle } from "@carbon/api/service-tools.server";
import {
  error,
  getAppUrl,
  ITAR_RIDER_SHA256,
  ITAR_RIDER_VERSION
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { AnyPostgresClient, Database, Tables } from "@carbon/database";
import {
  getLocationOwnTimeZone,
  getCompanyTimeZone as resolveCompanyTimeZone
} from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  ImplementationHubEmail,
  SalesOrderEmail
} from "@carbon/documents/email";
import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import {
  actionTaskEntities,
  actionTaskParentId
} from "@carbon/ee/action-task-entity";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { ERP_URL, SESSION_SECRET } from "@carbon/env";
import {
  getContentType,
  getFileExtension,
  imageTransformErrorMessage,
  storage
} from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { Signals } from "@carbon/onboarding";
import { detectImplementationSignals } from "@carbon/onboarding/server";
import type { PrinterRoute } from "@carbon/printing";
import { type ServerFnInput, serverFns } from "@carbon/server-functions";
import {
  authorize,
  ServerFnContext
} from "@carbon/server-functions/server-fn-context";
import { datetime, redirect, unchecked } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { parseAbsolute, startOfWeek } from "@internationalized/date";
import { render, renderAsync } from "@react-email/components";
import type {
  PostgrestResponse,
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import { createCookieSessionStorage, data } from "react-router";
import {
  getCurrencyByCode,
  getPaymentTermsList
} from "~/modules/accounting/accounting.service";
import {
  canEditChangeNoticeWorkflow,
  changeNoticeLockedMessage
} from "~/modules/items/items.models";
import { getLocationsList } from "~/modules/resources/resources.service";
import {
  getCustomerContact,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines
} from "~/modules/sales/sales.service";
import { getCompany, withLogoUrls } from "~/modules/settings/settings.service";
import { getUser, getUserDefaults } from "~/modules/users/users.service";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import type { CustomFieldsTableType } from "../settings/types";
import type { ItemModelUpload } from "./types";

const logger = getLogger("erp", "shared");

export async function deleteNote(
  client: SupabaseClient<Database>,
  noteId: string
) {
  return client.from("note").update({ active: false }).eq("id", noteId);
}

export async function deleteSavedView(
  client: SupabaseClient<Database>,
  viewId: string
) {
  return client.from("tableView").delete().eq("id", viewId);
}

export async function generateEmbedding(
  client: SupabaseClient<Database>,
  text: string
): Promise<number[]> {
  const response = await client.functions.invoke("embedding", {
    body: { text }
  });

  if (response.error) {
    throw new Error(
      `Failed to generate embedding: ${
        response.error.message || "Unknown error"
      }`
    );
  }

  if (!response.data?.embedding) {
    throw new Error("No embedding returned from function");
  }

  return response.data.embedding as number[];
}

export async function getBase64ImageFromSupabase(
  client: SupabaseClient<Database>,
  path: string
) {
  // Legacy stored HEIC can't be decoded by consumers (PDF rendering) — serve
  // the imgproxy JPEG rendition instead. Everything else passes through raw.
  const extension = getFileExtension(path);
  const heic = extension === "heic" || extension === "heif";

  // Private object paths are prefixed with the owning company's id. A path
  // with no leading segment has no company to resolve a bucket from, and
  // `.company("")` throws — this function's contract is to return null on a
  // miss, so callers would get a rejected promise instead of the fallback.
  const companyId = path.split("/")[0];
  if (!companyId) {
    return null;
  }

  const { data, error } = await storage(client)
    .company(companyId)
    .download(path, heic ? { transform: { quality: 90 } } : undefined);
  if (!data) {
    if (heic) {
      logger.error(
        imageTransformErrorMessage(error, "Failed to transform HEIC file"),
        { path, error }
      );
    }
    return null;
  }

  const base64String = Buffer.from(await data.arrayBuffer()).toString("base64");

  const contentType = heic ? "image/jpeg" : getContentType(extension);
  const mimeType = contentType.startsWith("image/") ? contentType : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}

export async function getCountries(client: SupabaseClient<Database>) {
  return client.from("country").select("*").order("name");
}

/**
 * Timezone names from the database's own tzdata (pg_timezone_names via the
 * get_timezone_names RPC) — the authoritative list for what AT TIME ZONE
 * resolves.
 */
export async function getTimezoneNames(client: SupabaseClient<Database>) {
  return client.rpc("get_timezone_names");
}

/**
 * The item's CAD model in the same shape the line views expose it, so it drops
 * straight into `<CadModel modelUpload={...} />`. Always the full shape — an item
 * with no model is every field null, never a narrower branch.
 */
export async function getModelByItemId(
  client: SupabaseClient<Database>,
  itemId: string
): Promise<ItemModelUpload> {
  const item = await client
    .from("item")
    .select("id, modelUploadId")
    .eq("id", itemId)
    .single();

  const noModel: ItemModelUpload = {
    itemId: item.data?.id ?? null,
    modelId: null,
    modelName: null,
    modelPath: null,
    modelSize: null,
    thumbnailPath: null
  };

  if (!item.data?.modelUploadId) return noModel;

  const model = await client
    .from("modelUpload")
    .select("id, name, modelPath, size, thumbnailPath")
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  if (!model.data) return noModel;

  return {
    itemId: item.data.id,
    modelId: model.data.id,
    modelName: model.data.name,
    modelPath: model.data.modelPath,
    modelSize: model.data.size,
    thumbnailPath: model.data.thumbnailPath
  };
}

export async function getNotes(
  client: SupabaseClient<Database>,
  documentId: string
) {
  return client
    .from("note")
    .select(
      "id, note, createdAt, user!notes_createdBy_fkey(id, fullName, avatarUrl)"
    )
    .eq("documentId", documentId)
    .eq("active", true)
    .order("createdAt");
}

export async function getPeriods(
  client: SupabaseClient<Database>,
  { startDate, endDate }: { startDate: string; endDate: string }
) {
  const endWithTime = endDate.includes("T") ? endDate : `${endDate}T23:59:59`;
  return client
    .from("period")
    .select("*")
    .gte("startDate", startDate)
    .lte("endDate", endWithTime);
}

export async function getSavedViews(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("tableView")
    .select("*")
    .eq("createdBy", userId)
    .eq("companyId", companyId)
    .order("name");
}

export async function getTagsList(
  client: SupabaseClient<Database>,
  companyId: string,
  table?: string | null
) {
  let query = client.from("tag").select("name").eq("companyId", companyId);

  if (table) {
    query = query.eq("table", table);
  }

  return query.order("name");
}

/**
 * One table's CSV import. Not published: `shared.csvImport.run` is the
 * operation, and checks the table's permission and mappings first.
 */
export async function importCsv(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    table: string;
    filePath: string;
    columnMappings: Record<string, string>;
    enumMappings?: Record<string, string[]>;
    companyId: string;
    userId: string;
  }
) {
  // The operation validates `table` and the enum mappings' real shape
  // (field → { value → mapped }).
  return serverFns
    .as({ client, db, companyId: args.companyId, userId: args.userId })
    .invoke("import-csv", args as unknown as ServerFnInput<"import-csv">);
}

export async function insertNote(
  client: SupabaseClient<Database>,
  note: {
    note: string;
    documentId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("note").insert([note]).select("*").single();
}

export async function insertTag(
  client: SupabaseClient<Database>,
  tag: Database["public"]["Tables"]["tag"]["Insert"]
) {
  return client.from("tag").insert(tag).select("*").single();
}

export async function getExternalLink(
  client: SupabaseClient<Database>,
  id: string
) {
  let query = client.from("externalLink").select("*").eq("id", id).single();

  return query;
}

export async function upsertExternalLink(
  client: SupabaseClient<Database>,
  externalLink:
    | Database["public"]["Tables"]["externalLink"]["Insert"]
    | Database["public"]["Tables"]["externalLink"]["Update"]
) {
  if ("id" in externalLink && externalLink.id) {
    return client
      .from("externalLink")
      .update(externalLink)
      .eq("id", externalLink.id)
      .select("id")
      .single();
  }
  return client
    .from("externalLink")
    .insert(
      externalLink as Database["public"]["Tables"]["externalLink"]["Insert"]
    )
    .select("id")
    .single();
}

export async function getCustomerPortals(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("externalLink")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("documentType", "Customer");

  if (args?.search) {
    query = query.ilike("customer.name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getCustomerPortal(
  client: SupabaseClient<Database>,
  id: string
): Promise<
  PostgrestSingleResponse<
    Tables<"externalLink"> & {
      customer: Pick<Tables<"customer">, "id" | "name">;
    }
  >
> {
  return client
    .from("externalLink")
    .select("*, customer(id, name)")
    .eq("id", id)
    .eq("documentType", "Customer")
    .single();
}

export async function updateModelThumbnail(
  client: SupabaseClient<Database>,
  modelId: string,
  thumbnailPath: string
) {
  return client.from("modelUpload").update({ thumbnailPath }).eq("id", modelId);
}

export async function upsertModelUpload(
  client: SupabaseClient<Database>,
  upload:
    | {
        id: string;
        modelPath: string;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        name: string;
        size: number;
        thumbnailPath: string;
      }
) {
  if ("createdBy" in upload) {
    return client.from("modelUpload").insert(upload);
  }
  return client.from("modelUpload").update(upload).eq("id", upload.id);
}

export async function updateNote(
  client: SupabaseClient<Database>,
  id: string,
  note: string
) {
  return client.from("note").update({ note }).eq("id", id);
}

export async function upsertSavedView(
  client: SupabaseClient<Database>,
  view: {
    id?: string;
    name: string;
    description?: string;
    table: string;
    type: "Public" | "Private";
    filters?: string[];
    sorts?: string[];
    columnPinning?: Record<string, boolean>;
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    userId: string;
    companyId: string;
  }
) {
  const { userId, ...data } = view;
  if ("id" in view && view.id) {
    return client
      .from("tableView")
      .update({
        ...data,
        updatedBy: userId
      })
      .eq("id", view.id)
      .select("id")
      .single();
  }

  const { data: maxSortOrderData, error: maxSortOrderError } = await client
    .from("tableView")
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxSortOrderError) {
    return { data: null, error: maxSortOrderError };
  }

  const newSortOrder = maxSortOrderData ? maxSortOrderData.sortOrder + 1 : 1;

  return client
    .from("tableView")
    .insert({
      ...data,
      createdBy: userId,
      sortOrder: newSortOrder
    })
    .select("id")
    .single();
}

export async function updateSavedViewOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client.from("tableView").update({ sortOrder, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

// -----------------------------------------------------------------------------
// Enforcement Rules (storage + sales families)
// -----------------------------------------------------------------------------
// Both rule families live in ONE `enforcementRule` table discriminated by
// `family`, so the admin CRUD is written once here rather than duplicated in
// `inventory.service.ts` and `sales.service.ts`. Callers pass their family
// explicitly — there is no per-family wrapper to keep in sync, and adding a
// third family costs nothing here.
//
// Cross-app queries (assignment loaders, evaluator fetches) live in
// `@carbon/ee/rules`; this file is the ERP-only admin surface, because it
// depends on ERP request-utils (GenericQueryFilters, sanitize).

export type EnforcementRuleFamily =
  Database["public"]["Enums"]["enforcementRuleFamily"];

export type EnforcementRuleRow =
  Database["public"]["Tables"]["enforcementRule"]["Row"];

// Authoring writes (`upsertEnforcementRule` / `deleteEnforcementRule`) and their
// `EnforcementRuleInsert` / `EnforcementRuleUpdate` input types moved to
// `@carbon/ee/rules.server` (`packages/ee/src/rules/service.server.ts`), where
// they embed the commercial `requireEntitlement` gate. The read helpers below
// stay here (ERP admin surface, client-safe).

export async function getEnforcementRules(
  client: SupabaseClient<Database>,
  family: EnforcementRuleFamily,
  companyId: string,
  args?: GenericQueryFilters & {
    search: string | null;
    targetType?:
      | Database["public"]["Enums"]["enforcementRuleTargetType"]
      | null;
  }
): Promise<PostgrestResponse<EnforcementRuleRow>> {
  let query = client
    .from("enforcementRule")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("family", family);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }
  if (args?.targetType) {
    query = query.eq("targetType", args.targetType);
  }

  // The `family` argument is a union rather than a literal, which is enough to
  // drop PostgREST's inferred row type to `any`; state it once here so every
  // caller gets a real row instead of re-annotating at each call site.
  return setGenericQueryFilters(query, args ?? {}, [
    { column: "name", ascending: true }
  ]) as unknown as Promise<PostgrestResponse<EnforcementRuleRow>>;
}

export async function getEnforcementRule(
  client: SupabaseClient<Database>,
  family: EnforcementRuleFamily,
  id: string,
  companyId: string
): Promise<PostgrestSingleResponse<EnforcementRuleRow>> {
  return (
    client
      .from("enforcementRule")
      .select("*")
      .eq("id", id)
      .eq("family", family)
      // RLS scopes the user client already; the explicit predicate is
      // defense-in-depth for service-role callers (these functions are
      // MCP-exposed).
      .eq("companyId", companyId)
      // Same union-family `any` collapse as `getEnforcementRules` above.
      .single() as unknown as Promise<
      PostgrestSingleResponse<EnforcementRuleRow>
    >
  );
}

/**
 * Pin counts per rule id. Rule ids are globally unique, so counting by id needs
 * no family predicate even though the item table is shared between families.
 * Work-center pins only exist for the storage family; passing sales ids simply
 * matches nothing there.
 */
export async function getEnforcementRuleAssignmentCounts(
  client: SupabaseClient<Database>,
  ruleIds: string[]
) {
  if (ruleIds.length === 0) return { data: {}, error: null };

  const tables = [
    "enforcementRuleItemAssignment",
    "enforcementRuleWorkCenterAssignment"
  ] as const;

  const results = await Promise.all(
    tables.map((table) =>
      client.from(table).select("ruleId").in("ruleId", ruleIds)
    )
  );

  const counts: Record<string, number> = {};
  for (const { data, error } of results) {
    if (error) return { data: {}, error };
    for (const row of (data ?? []) as Array<{ ruleId: string }>) {
      counts[row.ruleId] = (counts[row.ruleId] ?? 0) + 1;
    }
  }

  return { data: counts, error: null };
}
/**
 * Resolve the location a location-scoped screen should render.
 *
 * Precedence: the `?location=` search param, then the user's default location,
 * then the company's first location. Each of the six planning/scheduling
 * screens carried its own copy of this, differing only in where they redirect
 * on failure.
 *
 * The steps run sequentially on purpose: each one usually resolves the id, so
 * running them concurrently would add queries to the common path to save a
 * round-trip on the rare one.
 *
 * The returned id always belongs to `companyId` — callers rely on that, because
 * several run with `bypassRls: true` and then filter only on the location.
 */
export async function resolveLocationId(
  client: SupabaseClient<Database>,
  request: Request,
  args: {
    searchParams: URLSearchParams;
    userId: string;
    companyId: string;
    /** Where to send the user if their defaults can't be read. */
    onDefaultsError: string;
    /** Where to send the user if the company has no locations. */
    onNoLocations: string;
  }
): Promise<string> {
  const { searchParams, userId, companyId, onDefaultsError, onNoLocations } =
    args;

  let locationId = searchParams.get("location");

  // `?location=` is attacker-controlled and five of the six callers run with
  // `bypassRls: true`, over queries that filter on the location with no company
  // predicate of their own (`get_jobs_by_date_range`, `get_unscheduled_jobs`,
  // `get_active_job_operations_by_location`, the `workCenters` reads) — so a
  // foreign id here would return another tenant's rows. Falls back to the
  // user's default rather than 404ing, which is what a stale bookmark should do.
  if (locationId) {
    const requested = await client
      .from("location")
      .select("id")
      .eq("id", locationId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (requested.error || !requested.data) {
      locationId = null;
    }
  }

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        onDefaultsError,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        onNoLocations,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data[0].id as string;
  }

  return locationId;
}
type PublicTables = Database["public"]["Tables"];

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
  [K in keyof PublicTables]: PublicTables[K]["Row"] extends {
    id: string;
    companyId: string | null;
  }
    ? K
    : never;
}[keyof PublicTables];

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
  companyIntegrations: PublicTables["companyIntegration"]["Row"][];
  companySettings: PublicTables["companySettings"]["Row"] | null;
  savedViews: PublicTables["tableView"]["Row"][];
  user: PublicTables["user"]["Row"] | null;
  groups: string[];
  defaults: Views["userDefaults"]["Row"] | null;
  modulePreferences: Pick<
    PublicTables["userModulePreference"]["Row"],
    "module" | "position" | "hidden"
  >[];
  printerRoutes: PrinterRoute[];
  implementationHub: PublicTables["implementationHub"]["Row"] | null;
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
export function assignmentEvent(table: string): NotificationEvent | null {
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

export const normalizeLookupName = (value: string) =>
  value.toLowerCase().trim();

/** Email the company's active admins that their hub is ready. Never throws. */
export async function notifyImplementationHubAdmins(ctx: ServiceContext) {
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

/**
 * The action task an integration acts on, or a refusal when it hangs off a
 * change notice whose workflow can no longer change.
 */
export async function editableActionTask(
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
export function actionTaskUrl(
  rows: unknown,
  entityType: ActionTaskEntityType
): string {
  const parentId = actionTaskParentId(rows, entityType) ?? "";
  return `${getAppUrl()}${actionTaskEntities[entityType].detailPath(parentId)}/details`;
}
// Timezones change only when someone edits Settings → Company or a location, so
// a long TTL is fine — writes invalidate the key explicitly (below). The
// @carbon/kv resilience wrapper fails soft: a Redis miss/outage/corrupt value
// just falls through to the database read.
const TTL_SECONDS = 60 * 60 * 24 * 7;

// 7 days
const companyKey = (companyId: string) => `timezone:company:${companyId}`;

const locationKey = (companyId: string, locationId: string) =>
  `timezone:location:${companyId}:${locationId}`;

// Cached marker for "this location defines no timezone of its own". The
// location cache must never store an INHERITED company timezone: that copy
// would survive invalidateCompanyTimeZone for up to 7 days. Instead the
// inherit case is cached as this sentinel and the fallback flows through the
// (invalidatable) company cache on every read.
const INHERIT = "__inherit__";

/** Redis-cached {@link resolveCompanyTimeZone}. */
export async function getCompanyTimeZone(
  db: AnyPostgresClient,
  companyId: string
): Promise<string> {
  const key = companyKey(companyId);
  const cached = await redis.get(key);
  if (cached) return cached;

  const tz = await resolveCompanyTimeZone(db, companyId);
  await redis.set(key, tz, "EX", TTL_SECONDS);
  return tz;
}

/**
 * Redis-cached location timezone with company fallback. Only the location's
 * OWN timezone is cached under the location key (company-scoped); a location
 * that inherits resolves through {@link getCompanyTimeZone} on every call, so
 * a company-timezone change takes effect immediately after its invalidation.
 */
export async function getLocationTimeZone(
  db: AnyPostgresClient,
  locationId: string,
  companyId: string
): Promise<string> {
  const key = locationKey(companyId, locationId);
  const cached = await redis.get(key);
  if (cached !== null) {
    return cached === INHERIT ? getCompanyTimeZone(db, companyId) : cached;
  }

  const own = await getLocationOwnTimeZone(db, locationId, companyId);
  await redis.set(key, own ?? INHERIT, "EX", TTL_SECONDS);
  return own ?? getCompanyTimeZone(db, companyId);
}

/** Drop the cached company timezone — call after writing `company.timezone`. */
export async function invalidateCompanyTimeZone(
  companyId: string
): Promise<void> {
  await redis.del(companyKey(companyId));
}

/** Drop the cached location timezone — call after writing `location.timezone`. */
export async function invalidateLocationTimeZone(
  locationId: string,
  companyId: string
): Promise<void> {
  await redis.del(locationKey(companyId, locationId));
}

/** What an older building block holds instead of a `ServiceContext`. */
export type PostingHandles = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  userId: string;
  companyGroupId?: string;
  /** The caller's client, when the call was made as the caller. */
  client?: SupabaseClient<Database>;
};

/**
 * Run a posting body (a server function ported from `@carbon/server-functions`)
 * and read it as `{ data, error }`, as `serverFns…invoke` returned it. From an
 * operation, pass its `ctx`. From an older building block, pass the handles it
 * holds: the body runs as the system, on the user's behalf, over that same
 * `db` (a transaction stays one). With `as` (the body's permission rule, or
 * what the input requires), the caller behind `client` must hold it first, as
 * `serverFns.as` checked it: a user's claims, an API key's scopes, nothing for
 * the service role.
 */
export async function invokePosting<I, R>(
  from: ServiceContext | PostingHandles,
  name: string,
  input: I,
  run: (ctx: ServiceContext, input: I) => Promise<R>,
  options: {
    as?: PermissionRule<I> | ((input: I) => Permissions);
    defaultStatus?: number;
  } = {}
): Promise<{ data: R; error: null } | { data: null; error: CarbonError }> {
  const ctx = "actor" in from ? from : postingContext(from);
  const out = await settle(
    ctx,
    name,
    async () => {
      if (!("actor" in from) && from.client && options.as) {
        await authorize(
          await ServerFnContext.fromClient(from.client, {
            db: from.db,
            companyId: from.companyId,
            userId: from.userId
          }),
          typeof options.as === "function"
            ? options.as(input)
            : resolvePermissions(options.as, input)
        );
      }
      return run(ctx, input);
    },
    options.defaultStatus
  );
  return out instanceof CarbonError
    ? { data: null, error: out }
    : { data: out, error: null };
}

function postingContext(handles: PostingHandles): ServiceContext {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: handles.userId },
    company: { id: handles.companyId, groupId: handles.companyGroupId ?? "" },
    caller: handles.client ?? getCarbonServiceRole(),
    system: getCarbonServiceRole,
    pg: () => handles.db,
    kv: () => redis
  });
}
