// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import {
  hasPermissions,
  type PermissionRule,
  type Permissions,
  permissionsFromClaims,
  type RequiredPermissions,
  resolvePermissions
} from "@carbon/api/permissions";
import {
  type CreateInput,
  type CreateResult,
  type CreateResultFor,
  createInput
} from "@carbon/api/postings";
import type { PostingHandles } from "@carbon/api/postings.server";
import {
  type Actor,
  type CarbonError,
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { attempt, serverFnRefusal } from "@carbon/api/service-tools.server";
import { error, getAppUrl } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  type AnyPostgresClient,
  type Database,
  getLocationOwnTimeZone,
  isKysely,
  type Json,
  getCompanyTimeZone as resolveCompanyTimeZone,
  type Tables
} from "@carbon/database";
import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import {
  type ContractPosition,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import {
  isCostLayer,
  orderLayersForConsumption,
  relieveLayers
} from "@carbon/database/cost-relief";
import type { AutomaticJournalStatus } from "@carbon/database/journal-posting-status";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus,
  type OptionalDefaultRole,
  readAccountingCutoverDate,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { toJson } from "@carbon/database/json";
import type { AccountType } from "@carbon/database/ledger";
import { accountTypeFromClass, isAccountClass } from "@carbon/database/ledger";
import { equals } from "@carbon/database/precision";
import { quoteToOrderPriceTrace } from "@carbon/database/price-trace";
import { releaseReceiptSerialEntities } from "@carbon/database/receipt-serials";
import type * as rows from "@carbon/database/rows";
import type * as rowsModule from "@carbon/database/rows";
import {
  contains,
  inOrder,
  insertRows,
  many,
  maybeSingle,
  neq,
  rpcValue,
  single,
  updateRows
} from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import {
  type CurrencyRate,
  convertUnitPrice,
  supplierPartCurrency
} from "@carbon/database/supplier-part-price";
import {
  ImplementationHubEmail,
  SalesOrderEmail
} from "@carbon/documents/email";
import {
  type ActionTaskEntityType,
  actionTaskEntities,
  actionTaskParentId
} from "@carbon/ee/action-task-entity";
import {
  ERP_URL,
  SESSION_SECRET,
  SUPABASE_SERVICE_ROLE_KEY
} from "@carbon/env";
import {
  getContentType,
  getFileExtension,
  imageTransformErrorMessage,
  storage
} from "@carbon/files";
import { parseCsv } from "@carbon/files/csv";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { Signals } from "@carbon/onboarding";
import { detectImplementationSignals } from "@carbon/onboarding/server";
import type { PrinterRoute } from "@carbon/printing";
import type { SalesPostingAccount } from "@carbon/utils";
import {
  assertBalanced,
  async,
  credit,
  datetime,
  debit,
  deriveRate,
  EPSILON,
  escapeLike,
  generateLeasePayments,
  getReadableIdWithRevision,
  getRemainingQuantityToInvoice,
  type LeasePaymentRowInput,
  redirect,
  remainingLeasePayments,
  resolveTrackedEntityBins,
  round,
  settleQuantity,
  type TrackedEntityBin,
  textToTiptap
} from "@carbon/utils";
import {
  type CalendarDate,
  endOfMonth,
  parseDate,
  startOfMonth,
  startOfWeek
} from "@internationalized/date";
import { render, renderAsync } from "@react-email/components";
import type {
  PostgrestResponse,
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import type { Selectable } from "kysely";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
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
import { getMethod } from "~/modules/production/production.service";
import { getLocationsList } from "~/modules/resources/resources.service";
import {
  getCustomerContact,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines
} from "~/modules/sales/sales.service";
import { getCompany, withLogoUrls } from "~/modules/settings/settings.service";
import { getUser, getUserDefaults } from "~/modules/users/users.service";
import { path } from "~/utils/path";
import {
  type GenericQueryFilters,
  LIST_COUNT,
  setGenericQueryFilters
} from "~/utils/query";
import type { CustomFieldsTableType } from "../settings/types";
import type { assignableTables } from "./shared.models";
import { assertMethodHasPullFrom, isStrictBackflush } from "./strict-backflush";
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
 * One table's CSV import. Not published: `importCsvFile` is the operation,
 * and checks the table's permission and mappings first.
 */
export function importCsv(
  ctx: ServiceContext,
  args: {
    table: string;
    filePath: string;
    columnMappings: Record<string, string>;
    enumMappings?: Record<string, Record<string, string>>;
  }
) {
  // `importCsvTable` refuses a table it does not import.
  return invokePosting(
    ctx,
    "import-csv",
    args as z.input<typeof importCsvInput>,
    importCsvTable
  );
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
  // Joined for the search, which matches the customer's name. Every portal
  // has its customer (the form requires one), so the inner join drops none.
  let query = client
    .from("externalLink")
    .select("*, customer!inner(id)", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("documentType", "Customer");

  if (args?.search) {
    query = query.ilike("customer.name", `%${escapeLike(args.search)}%`);
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
      .eq("companyId", view.companyId)
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

/**
 * Reorder the caller's own saved views in one statement, all or nothing: an
 * id that is not one of their views in the company refuses the whole
 * reorder. Not `updateSortOrder`: a view has no `updatedAt`, and it belongs
 * to its creator rather than to a parent document.
 */
export async function reorderSavedViews(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  updates: { id: string; sortOrder: number }[]
) {
  if (updates.length === 0) return;
  const values = sql.join(
    updates.map(
      ({ id, sortOrder }) => sql`(${id}::text, ${sortOrder}::integer)`
    )
  );
  await db.transaction().execute(async (trx) => {
    const { rows } = await sql<{
      id: string;
    }>`UPDATE "tableView" AS t SET "sortOrder" = v."sortOrder", "updatedBy" = ${userId} FROM (VALUES ${values}) AS v("id", "sortOrder") WHERE t."id" = v."id" AND t."companyId" = ${companyId} AND t."createdBy" = ${userId} RETURNING t."id"`.execute(
      trx
    );
    if (rows.length !== updates.length) {
      throw new NotFoundError("Saved view not found");
    }
  });
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
    companyId: string;
    table: (typeof assignableTables)[number];
    assignee: string;
  }
) {
  const { id, companyId, table, assignee } = args;
  // Every assignable table has `id`, `companyId` and `assignee`; one stands in
  // for the union.
  return client
    .from(table as "job")
    .update({ assignee: assignee || null })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id");
}

/**
 * The stored work instruction for plain text. Empty text is `{}`, as the
 * editor stores it: the column is NOT NULL, so `null` refused every clear.
 */
export function workInstructionFromText(text: string) {
  return text.trim() ? textToTiptap(text) : {};
}

/**
 * Replaces one operation's work instruction, as the caller. The text becomes
 * the editor's document (`textToTiptap`); empty text clears it. An id the
 * caller cannot see, or of another company, is `notFound`.
 */
export async function setOperationWorkInstruction(
  ctx: ServiceContext,
  table: "jobOperation" | "methodOperation" | "quoteOperation",
  id: string,
  text: string
) {
  const updated = await ctx.asCaller.supabase
    .from(table as "jobOperation")
    .update({
      workInstruction: workInstructionFromText(text),
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", ctx.company.id)
    .select("id")
    .maybeSingle();
  if (updated.error) {
    return ctx.error(
      "internal",
      "Failed to save the work instruction",
      updated.error
    );
  }
  if (!updated.data) return ctx.error("notFound", "Operation not found");
  return { id: updated.data.id };
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
  db: Kysely<KyselyDatabase>,
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

export type { PostingHandles };

type PostingRule<I> = PermissionRule<I> | ((input: I) => Permissions);
type PostingBody<I, R> = (ctx: ServiceContext, input: I) => Promise<R>;
type PostingResult<R> =
  | { data: R; error: null }
  | { data: null; error: ServerFnError };
type PostingSchema = { parse(value: unknown): unknown };
type PostingOptions<I> = {
  as?: PostingRule<I>;
  schema?: PostingSchema;
  defaultStatus?: number;
};
/** Handles that carry the caller's client must name the permission to check. */
type PostingOptionsFor<H, I> = H extends { client: SupabaseClient<Database> }
  ? [
      options: {
        as: PostingRule<I>;
        schema?: PostingSchema;
        defaultStatus?: number;
      }
    ]
  : [options?: PostingOptions<I>];

/**
 * What a posting asks of the runner beyond the defaults, by name, so that no
 * caller can leave it out.
 */
const POSTING_DEFAULTS: Partial<
  Record<string, { defaultStatus?: number; groupless?: true }>
> = {
  // Its engine refuses with plain `Error`s written for the operator (an
  // unavailable or expired lot, a part already scrapped): a refusal, not a
  // failure, as its server function's `defaultStatus: 400` read them.
  issue: { defaultStatus: 400 },
  // Runs on the company `insertCompany` just made, which has no group yet:
  // the posting creates it.
  "seed-company": { groupless: true }
};

/**
 * Run a posting body and read it as `{ data, error }`, with the
 * `ServerFnError` it refused with.
 *
 * - From an operation, pass its `ctx` and no `as`: its own gate already
 *   checked the caller.
 * - From handles that carry the caller's `client`, `as` is required (the
 *   body's permission rule, or what the input requires): the caller must hold
 *   it first — a user's claims, an API key's
 *   scopes, nothing for the service role. With the body's input `schema`, the
 *   input is parsed first and the rule reads it as the body will. The body
 *   then runs as the system
 *   on the user's behalf, over that same `db` (a transaction stays one).
 * - From handles without a client, the body runs as the system.
 */
export function invokePosting<I, R>(
  from: ServiceContext,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  options?: { defaultStatus?: number }
): Promise<PostingResult<R>>;
export function invokePosting<I, R, H extends PostingHandles>(
  from: H,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  ...options: PostingOptionsFor<H, I>
): Promise<PostingResult<R>>;
export function invokePosting<I, R>(
  from: ServiceContext | PostingHandles,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  options: PostingOptions<I> = {}
): Promise<PostingResult<R>> {
  return runPosting(from, name, input, run, options);
}

/** {@link invokePosting}, throwing its refusal, as `invokeOrThrow` did. */
export function invokePostingOrThrow<I, R>(
  from: ServiceContext,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  options?: { defaultStatus?: number }
): Promise<R>;
export function invokePostingOrThrow<I, R, H extends PostingHandles>(
  from: H,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  ...options: PostingOptionsFor<H, I>
): Promise<R>;
export async function invokePostingOrThrow<I, R>(
  from: ServiceContext | PostingHandles,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  options: PostingOptions<I> = {}
): Promise<R> {
  const result = await runPosting(from, name, input, run, options);
  if (result.error) throw result.error;
  return result.data;
}

/** {@link invokePosting} for `create`, with the result its document type returns. */
export function invokeCreate<I extends CreateInput>(
  from: ServiceContext | PostingHandles,
  input: I
): Promise<PostingResult<CreateResultFor<I["type"]>>> {
  return runPosting(from, "create", input, createDocument, {}) as Promise<
    PostingResult<CreateResultFor<I["type"]>>
  >;
}

async function runPosting<I, R>(
  from: ServiceContext | PostingHandles,
  name: string,
  input: I,
  run: PostingBody<I, R>,
  { as, schema, defaultStatus }: PostingOptions<I>
): Promise<PostingResult<R>> {
  const posting = POSTING_DEFAULTS[name];
  const status = defaultStatus ?? posting?.defaultStatus;
  if ("actor" in from) {
    return attempt(from, name, () => run(from, input), status);
  }
  const handles = from;
  if (handles.client && !as) {
    throw new Error(
      `invokePosting("${name}"): handles with a caller's client need \`as\`, the permission to check the caller against`
    );
  }
  const actor: Actor = { type: "system", onBehalfOf: handles.userId };
  return attempt(
    { actor },
    name,
    async (span) => {
      if (handles.client && as) {
        const parsed = (schema ? schema.parse(input) : input) as I;
        const caller = postingCaller(handles.client, handles.userId);
        span.setAttribute("carbon.function.actor", caller.type);
        await authorizePostingCaller(
          handles,
          caller,
          typeof as === "function" ? as(parsed) : resolvePermissions(as, parsed)
        );
      }
      const ctx = createServiceContext({
        actor,
        company: await postingCompany(handles, posting?.groupless === true),
        caller: handles.client ?? getCarbonServiceRole(),
        system: getCarbonServiceRole,
        pg: () => handles.db,
        kv: () => redis
      });
      return run(ctx, input);
    },
    status
  );
}

async function postingCompany(
  { db, companyId, companyGroupId }: PostingHandles,
  groupless: boolean
): Promise<ServiceContext["company"]> {
  if (companyGroupId) return { id: companyId, groupId: companyGroupId };
  const company = await db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  // An unknown company is the caller's mistake; a company with no group is ours.
  if (!company) throw new NotFoundError(`Company ${companyId} not found`);
  if (company.companyGroupId) {
    return { id: companyId, groupId: company.companyGroupId };
  }
  const noGroup = new ServerFnError(
    `Company ${companyId} has no company group`,
    500
  );
  if (!groupless) throw noGroup;
  // A body that reads the group anyway is refused when it does.
  return {
    id: companyId,
    get groupId(): string {
      throw noGroup;
    }
  };
}

// Rows per INSERT. Every multi-row insert is bound by Postgres' 65535 bind
// parameters: the widest table written (itemLedger, 14 columns) is ~7k
// parameters at this size.
const INSERT_CHUNK_SIZE = 500;

export function chunked<T>(rows: T[], size = INSERT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `insert` once per chunk of `rows`, one after another (they share a
 * transaction), and returns every chunk's RETURNING rows in input order.
 */
export async function inChunks<T, R>(
  rows: T[],
  insert: (chunk: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  for (const chunk of chunked(rows)) {
    results.push(...(await insert(chunk)));
  }
  return results;
}
// Pure per-row decision for supplier/customer CSV import. No DB, no I/O — so it
// is unit-testable. The driver loop owns the running `seenIds`
// / `seenNames` sets and applies the returned action.
//
// Root-cause fix: a blank CSV id must NEVER participate in in-file dedup. The
// previous loop added "" to a Set and then treated every later blank-id row as a
// duplicate, silently dropping them (1 of 58 imported). Here, dedup keys are the
// non-empty id and the (always-present) name.

export type RowDecision =
  | { action: "insert" }
  | { action: "update"; entityId: string }
  | { action: "skip"; reason: string; category: "error" | "skipped" };

export function classifyImportRow(params: {
  id: string;
  name: string;
  externalIdMap: Map<string, string>;
  nameMap: Map<string, string>;
  seenIds: Set<string>;
  seenNames: Set<string>;
}): RowDecision {
  const { id, name, externalIdMap, nameMap, seenIds, seenNames } = params;

  // `name` can be undefined at runtime when the CSV's Name column is unmapped.
  if (!name || name.trim() === "") {
    return {
      action: "skip",
      reason: "Missing required Name",
      category: "error"
    };
  }
  if (id && seenIds.has(id)) {
    return {
      action: "skip",
      reason: `Duplicate ID "${id}" in file`,
      category: "skipped"
    };
  }
  if (seenNames.has(name)) {
    return {
      action: "skip",
      reason: `Duplicate name "${name}" in file`,
      category: "skipped"
    };
  }

  // The CSV name is matched as-is. Whitespace/case normalization is intentionally
  // out of scope for this data-loss fix and is handled by the later identity redesign.
  const matchedById = id ? externalIdMap.get(id) : undefined;
  const matchedByName =
    matchedById === undefined ? nameMap.get(name) : undefined;
  const existingEntityId = matchedById ?? matchedByName;

  if (existingEntityId !== undefined) {
    return { action: "update", entityId: existingEntityId };
  }
  return { action: "insert" };
}
export type StockImportTable =
  | "inventoryQuantity"
  | "batchQuantity"
  | "serialQuantity";

// The item tracking type each import accepts.
export const STOCK_IMPORT_TRACKING_TYPE: Record<StockImportTable, string> = {
  inventoryQuantity: "Inventory",
  batchQuantity: "Batch",
  serialQuantity: "Serial"
};

// The import a user should reach for, per tracking type, for the mismatch
// error message.
const IMPORT_LABEL_BY_TRACKING_TYPE: Record<string, string> = {
  Inventory: "Inventory Quantities",
  Batch: "Batch Quantities",
  Serial: "Serial Quantities"
};

export type StockItemInfo = {
  // More than one item shares this part number + revision AND this import's
  // tracking type, so the row cannot name one item. Reported per row rather
  // than resolved arbitrarily: posting opening stock to the wrong item is
  // silent and expensive to unwind.
  ambiguous?: boolean;
  id: string;
  itemTrackingType: string | null;
  hasItemCost: boolean;
};

export type StockRowResolved = {
  itemId: string;
  locationId: string;
  storageUnitId: string | null;
  quantity: number;
  // Batch / serial number; null for Inventory rows.
  readableId: string | null;
  expirationDate: string | null;
  comment: string | null;
  // In-file / existing dedup key for Batch / Serial rows; null for Inventory.
  trackedKey: string | null;
};

export type StockRowDecision =
  | { action: "post"; row: StockRowResolved }
  | { action: "skip"; reason: string; category: "error" | "skipped" };

const text = (s: string | undefined): string => (s ?? "").trim();

// Same shape as method-import.ts: readableId + revision, blank revision → "0".
export const itemKey = (readableId: string, revision: string) =>
  `${readableId} ${revision || "0"}`;

// readableId + revision → item (method-import key). item_unique also includes
// `type`, so two items (e.g. a Part and a Tool) can share the key. Ties break
// deterministically: the candidate whose tracking type matches this import
// wins; otherwise the first candidate in input order (the driver orders the
// query by type, id).
export function buildStockItemMap(
  table: StockImportTable,
  candidates: Array<{
    id: string;
    readableId: string;
    revision: string | null;
    itemTrackingType: string | null;
    hasItemCost: boolean;
  }>
): Map<string, StockItemInfo> {
  const expected = STOCK_IMPORT_TRACKING_TYPE[table];
  const map = new Map<string, StockItemInfo>();
  for (const c of candidates) {
    const key = itemKey(c.readableId, c.revision ?? "0");
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        id: c.id,
        itemTrackingType: c.itemTrackingType,
        hasItemCost: c.hasItemCost
      });
      continue;
    }
    const currentMatches = current.itemTrackingType === expected;
    const candidateMatches = c.itemTrackingType === expected;
    if (candidateMatches && currentMatches) {
      // Two items of this import's tracking type share the identity: neither
      // can be chosen, so mark the key and let classifyStockRow reject rows.
      map.set(key, { ...current, ambiguous: true });
      continue;
    }
    if (candidateMatches && !currentMatches) {
      map.set(key, {
        id: c.id,
        itemTrackingType: c.itemTrackingType,
        hasItemCost: c.hasItemCost
      });
    }
  }
  return map;
}

// Storage unit names are unique per location (storageUnit_name_locationId_key)
// and resolved case-insensitively — the storageUnit import's natural key.
export const storageUnitKey = (locationId: string, name: string) =>
  `${locationId}::${name.trim().toLowerCase()}`;

// A batch / serial number is unique per item, not per company: the same serial
// on two different items is allowed.
export const trackedKey = (itemId: string, readableId: string) =>
  `${itemId}::${readableId}`;

// ISO calendar date (YYYY-MM-DD) that actually exists. Hand-rolled rather than
// JS Date, which silently rolls 2026-02-30 over to March.
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];
  return day <= daysInMonth[month - 1]!;
}

export function classifyStockRow(params: {
  table: StockImportTable;
  record: Record<string, string>;
  itemMap: Map<string, StockItemInfo>;
  locationIds: Set<string>;
  storageUnitMap: Map<string, string>;
  existingTrackedKeys: Set<string>;
  seenTrackedKeys: Set<string>;
}): StockRowDecision {
  const {
    table,
    record,
    itemMap,
    locationIds,
    storageUnitMap,
    existingTrackedKeys,
    seenTrackedKeys
  } = params;
  const error = (reason: string): StockRowDecision => ({
    action: "skip",
    reason,
    category: "error"
  });

  const readableId = text(record.readableId);
  const revision = text(record.revision) || "0";
  if (!readableId) return error("Missing required Part Number");

  const item = itemMap.get(itemKey(readableId, revision));
  if (!item) return error(`Item ${readableId} rev ${revision} not found`);

  const expectedTrackingType = STOCK_IMPORT_TRACKING_TYPE[table];
  if (item.ambiguous) {
    return error(
      `More than one item is ${expectedTrackingType} tracked with part number ${readableId} rev ${revision}`
    );
  }
  if (item.itemTrackingType !== expectedTrackingType) {
    const other = IMPORT_LABEL_BY_TRACKING_TYPE[item.itemTrackingType ?? ""];
    return error(
      other
        ? `Item ${readableId} rev ${revision} is ${item.itemTrackingType} tracked; use the ${other} import`
        : `Item ${readableId} rev ${revision} is ${
            item.itemTrackingType ?? "not"
          } tracked and holds no stock`
    );
  }

  const locationId = text(record.locationId);
  if (!locationId) return error("Missing required Location");
  if (!locationIds.has(locationId)) return error("Location not found");

  const storageUnitName = text(record.storageUnitName);
  let storageUnitId: string | null = null;
  if (storageUnitName) {
    storageUnitId =
      storageUnitMap.get(storageUnitKey(locationId, storageUnitName)) ?? null;
    if (!storageUnitId) {
      return error(
        `Storage unit "${storageUnitName}" not found in this location`
      );
    }
  }

  // Serial rows carry no Quantity: each row is exactly one unit.
  let quantity = 1;
  if (table !== "serialQuantity") {
    const raw = text(record.quantity);
    const parsed = raw === "" ? Number.NaN : Number(raw);
    // Round to posting precision BEFORE validating, and carry the rounded
    // value: buildItemLedgerRow rounds the same way, so a quantity finer than
    // the scale (0.000001) would otherwise report an inserted movement that
    // adds nothing, and leave trackedEntity.quantity disagreeing with the
    // ledger.
    quantity = round(parsed);
    if (!Number.isFinite(parsed) || quantity <= 0) {
      return error("Quantity must be a positive number");
    }
  }

  let trackedNumber: string | null = null;
  if (table === "batchQuantity") {
    trackedNumber = text(record.batchNumber);
    if (!trackedNumber) return error("Missing required Batch Number");
  } else if (table === "serialQuantity") {
    trackedNumber = text(record.serialNumber);
    if (!trackedNumber) return error("Missing required Serial Number");
  }

  let expirationDate: string | null = null;
  if (table !== "inventoryQuantity") {
    const raw = text(record.expirationDate);
    if (raw) {
      if (!isIsoDate(raw)) {
        return error(
          `Expiration Date "${raw}" is not a valid date (use YYYY-MM-DD)`
        );
      }
      expirationDate = raw;
    }
  }

  if (!item.hasItemCost) {
    return error(`Item ${readableId} rev ${revision} has no item cost record`);
  }

  let key: string | null = null;
  if (trackedNumber) {
    const label = table === "serialQuantity" ? "Serial number" : "Batch number";
    key = trackedKey(item.id, trackedNumber);
    if (existingTrackedKeys.has(key)) {
      return {
        action: "skip",
        reason: `${label} "${trackedNumber}" already exists for this item`,
        category: "skipped"
      };
    }
    if (seenTrackedKeys.has(key)) {
      return {
        action: "skip",
        reason: `Duplicate ${label.toLowerCase()} "${trackedNumber}" for this item in file`,
        category: "skipped"
      };
    }
  }

  return {
    action: "post",
    row: {
      itemId: item.id,
      locationId,
      storageUnitId,
      quantity,
      readableId: trackedNumber,
      expirationDate,
      comment: text(record.comment) || null,
      trackedKey: key
    }
  };
}
const importCsvTableLogger = getLogger("server-functions", "import-csv");

type Rec = Record<string, string>;

type Summary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
};

// Company-scoped configuration lookups: small, flat, name-keyed tables a
// customer fills in once during onboarding. They share create-only,
// skip-duplicate semantics with the material-taxonomy imports
// (`material-property-import.ts`) rather than the id-mapped upsert the
// workCenter/process/item paths use, because none of them carries a natural
// external id — a customer's UoM list is a column of codes, not a keyed
// export. Every one of these tables has a UNIQUE (name, companyId) constraint,
// so a duplicate row would otherwise abort the whole transaction instead of
// reporting one skipped row.
export type ConfigLookupTable =
  | "unitOfMeasure"
  | "itemPostingGroup"
  | "storageType"
  | "scrapReason"
  | "department";

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

const requireName = (r: Rec) => (!r.name?.trim() ? "Name is required" : null);

type TableConfig = {
  // Row-level validation. Returns a reason string, or null when the row is fine.
  validate: (r: Rec) => string | null;
  // The natural keys used for both in-file dedup and match-against-existing.
  // A table with two unique constraints yields two keys, so a row colliding on
  // either is reported rather than dropped by the ON CONFLICT clause.
  keysOf: (r: Rec) => string[];
  // The same keys, read off a row already in the database.
  keysOfExisting: (r: {
    name: string | null;
    code?: string | null;
  }) => string[];
  // The columns to read off the mapped record, beyond the audit fields.
  values: (r: Rec) => Record<string, string>;
  // Set when the table carries a self-referencing parent applied in a second
  // pass (see `applyParents` below).
  parentField?: "parentDepartmentId";
};

// Exported for `config-lookup-import.test.ts` — the validation rules and
// dedup keys are the parts that fail silently.
export const CONFIGS: Record<ConfigLookupTable, TableConfig> = {
  unitOfMeasure: {
    validate: (r) => {
      if (!r.code?.trim()) return "Code is required";
      if (r.code.trim().length > 10)
        return "Code must be 10 characters or fewer";
      if (!r.name?.trim()) return "Name is required";
      if (r.name.trim().length > 50)
        return "Name must be 50 characters or fewer";
      return null;
    },
    // `code` and `name` are BOTH unique per company, so both are dedup keys —
    // importing "Each" against an existing EA/Each is a skip with a reason,
    // not a row silently swallowed by ON CONFLICT.
    keysOf: (r) => [`c:${norm(r.code)}`, `n:${norm(r.name)}`],
    keysOfExisting: (r) => [
      `c:${norm(r.code ?? "")}`,
      `n:${norm(r.name ?? "")}`
    ],
    values: (r) => ({ code: r.code!.trim(), name: r.name!.trim() })
  },
  itemPostingGroup: {
    validate: (r) => {
      const reason = requireName(r);
      if (reason) return reason;
      if (r.name!.trim().length > 255)
        return "Name must be 255 characters or fewer";
      return null;
    },
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => {
      const values: Record<string, string> = { name: r.name!.trim() };
      if (r.description?.trim()) values.description = r.description.trim();
      return values;
    }
  },
  storageType: {
    validate: requireName,
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => ({ name: r.name!.trim() })
  },
  scrapReason: {
    validate: requireName,
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => ({ name: r.name!.trim() })
  },
  department: {
    validate: requireName,
    keysOf: (r) => [norm(r.name)],
    keysOfExisting: (r) => [norm(r.name ?? "")],
    values: (r) => ({ name: r.name!.trim() }),
    parentField: "parentDepartmentId"
  }
};

const loadExisting = async (
  trx: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  table: ConfigLookupTable,
  companyId: string
) => {
  const rows = await trx
    .selectFrom(table)
    .select(table === "unitOfMeasure" ? ["id", "name", "code"] : ["id", "name"])
    .where("companyId", "=", companyId)
    .execute();
  return rows as Array<{ id: string; name: string | null; code?: string }>;
};

// Parents are applied AFTER every insert, as individual UPDATEs outside the
// insert transaction, so a parent defined further down the same file still
// resolves and an unresolved or self-referencing parent reports one row error
// instead of rolling the whole import back. Mirrors the storage-unit parent
// pass in `index.ts`.
const applyParents = async (
  db: Kysely<KyselyDatabase>,
  table: ConfigLookupTable,
  parentField: "parentDepartmentId",
  pending: Array<{ row: number; name: string; parentName: string }>,
  companyId: string,
  summary: Summary
) => {
  if (pending.length === 0) return;

  const idsByName = new Map<string, string>();
  for (const row of await loadExisting(db, table, companyId)) {
    idsByName.set(norm(row.name ?? ""), row.id);
  }

  for (const { row, name, parentName } of pending) {
    const id = idsByName.get(norm(name));
    if (!id) continue;

    if (norm(parentName) === norm(name)) {
      summary.errors.push({ row, reason: "A record cannot be its own parent" });
      continue;
    }

    const parentId = idsByName.get(norm(parentName));
    if (!parentId) {
      summary.errors.push({
        row,
        reason: `Parent "${parentName}" was not found`
      });
      continue;
    }

    try {
      await db
        .updateTable(table)
        .set({ [parentField]: parentId } as never)
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();
    } catch (err) {
      summary.errors.push({ row, reason: (err as Error).message });
    }
  }
};

export async function importConfigLookups(
  db: Kysely<KyselyDatabase>,
  {
    table,
    mappedRecords,
    companyId,
    userId,
    summary
  }: {
    table: ConfigLookupTable;
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
) {
  const config = CONFIGS[table];
  const pendingParents: Array<{
    row: number;
    name: string;
    parentName: string;
  }> = [];

  await db.transaction().execute(async (trx) => {
    const existingKeys = new Set(
      (await loadExisting(trx, table, companyId)).flatMap(config.keysOfExisting)
    );

    const seenKeys = new Set<string>();
    const accepted: Rec[] = [];

    for (const [rowIndex, record] of mappedRecords.entries()) {
      const reason = config.validate(record);
      if (reason) {
        summary.errors.push({ row: rowIndex, reason });
        continue;
      }

      const keys = config.keysOf(record);
      if (keys.some((k) => existingKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Already exists — skipped"
        });
        continue;
      }
      if (keys.some((k) => seenKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Duplicate row in file — skipped"
        });
        continue;
      }

      for (const key of keys) seenKeys.add(key);
      accepted.push(record);

      if (config.parentField && record.parentName?.trim()) {
        pendingParents.push({
          row: rowIndex,
          name: record.name!.trim(),
          parentName: record.parentName.trim()
        });
      }
    }

    importCsvTableLogger.info("import-config-lookups", {
      table,
      totalRecords: mappedRecords.length,
      accepted: accepted.length,
      skipped: summary.skipped.length,
      errors: summary.errors.length
    });

    if (accepted.length > 0) {
      const now = datetime.timestamp();
      const inserted = await inChunks(
        accepted.map(
          (r) =>
            ({
              ...config.values(r),
              companyId,
              createdBy: userId,
              createdAt: now
            }) as never
        ),
        (rows) =>
          trx
            .insertInto(table)
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      summary.inserted += inserted.length;
    }
  });

  if (config.parentField) {
    await applyParents(
      db,
      table,
      config.parentField,
      pendingParents,
      companyId,
      summary
    );
  }
}
export type MaterialPropertyTable =
  | "materialSubstance"
  | "materialForm"
  | "materialFinish"
  | "materialGrade"
  | "materialType"
  | "materialDimension";

const isMetricValue = (s: string | undefined) => {
  const v = norm(s);
  return (
    v === "true" || v === "1" || v === "yes" || v === "y" || v === "metric"
  );
};

const SUBSTANCE_UNMATCHED =
  "Substance could not be matched — make sure the substance exists and is mapped in the wizard";

const SHAPE_UNMATCHED =
  "Shape could not be matched — make sure the shape exists and is mapped in the wizard";

type ParentSpec = {
  field: "materialSubstanceId" | "materialFormId";
  table: "materialSubstance" | "materialForm";
  reason: string;
};

type materialPropertyImportTableConfig = {
  validate: (r: Rec) => string | null;
  keysOf: (r: Rec) => string[];
  loadExistingKeys: (
    trx: Transaction<KyselyDatabase>,
    companyId: string
  ) => Promise<Set<string>>;
  insert: (
    trx: Transaction<KyselyDatabase>,
    rows: Rec[],
    companyId: string,
    userId: string
  ) => Promise<number>;
  parents?: ParentSpec[];
};

const loadParentIds = async (
  trx: Transaction<KyselyDatabase>,
  table: "materialSubstance" | "materialForm",
  companyId: string
): Promise<Set<string>> => {
  const rows =
    table === "materialSubstance"
      ? await trx
          .selectFrom("materialSubstance")
          .select(["id"])
          .where((eb) =>
            eb.or([
              eb("companyId", "=", companyId),
              eb("companyId", "is", null)
            ])
          )
          .execute()
      : await trx
          .selectFrom("materialForm")
          .select(["id"])
          .where((eb) =>
            eb.or([
              eb("companyId", "=", companyId),
              eb("companyId", "is", null)
            ])
          )
          .execute();
  return new Set(rows.map((x) => x.id));
};

const materialPropertyImportCONFIGS: Record<
  MaterialPropertyTable,
  materialPropertyImportTableConfig
> = {
  materialSubstance: {
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.code?.trim()
          ? "Code is required"
          : null,
    keysOf: (r) => [`c:${norm(r.code)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialSubstance")
        .select(["code"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `c:${norm(x.code ?? "")}`));
    },
    insert: async (trx, rows, companyId, userId) => {
      const now = datetime.timestamp();
      const inserted = await inChunks(
        rows.map(
          (r) =>
            ({
              name: r.name!.trim(),
              code: r.code!.trim(),
              companyId,
              createdBy: userId,
              createdAt: now
            }) as never
        ),
        (rows) =>
          trx
            .insertInto("materialSubstance")
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      return inserted.length;
    }
  },
  materialForm: {
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.code?.trim()
          ? "Code is required"
          : null,
    keysOf: (r) => [`c:${norm(r.code)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialForm")
        .select(["code"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `c:${norm(x.code ?? "")}`));
    },
    insert: async (trx, rows, companyId, userId) => {
      const now = datetime.timestamp();
      const inserted = await inChunks(
        rows.map(
          (r) =>
            ({
              name: r.name!.trim(),
              code: r.code!.trim(),
              companyId,
              createdBy: userId,
              createdAt: now
            }) as never
        ),
        (rows) =>
          trx
            .insertInto("materialForm")
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      return inserted.length;
    }
  },
  materialFinish: {
    parents: [
      {
        field: "materialSubstanceId",
        table: "materialSubstance",
        reason: SUBSTANCE_UNMATCHED
      }
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.materialSubstanceId?.trim()
          ? SUBSTANCE_UNMATCHED
          : null,
    keysOf: (r) => [`${r.materialSubstanceId!.trim()}:${norm(r.name)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialFinish")
        .select(["materialSubstanceId", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(
        rows.map((x) => `${x.materialSubstanceId}:${norm(x.name)}`)
      );
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await inChunks(
        rows.map(
          (r) =>
            ({
              name: r.name!.trim(),
              materialSubstanceId: r.materialSubstanceId!.trim(),
              companyId
            }) as never
        ),
        (rows) =>
          trx
            .insertInto("materialFinish")
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      return inserted.length;
    }
  },
  materialGrade: {
    parents: [
      {
        field: "materialSubstanceId",
        table: "materialSubstance",
        reason: SUBSTANCE_UNMATCHED
      }
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.materialSubstanceId?.trim()
          ? SUBSTANCE_UNMATCHED
          : null,
    keysOf: (r) => [`${r.materialSubstanceId!.trim()}:${norm(r.name)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialGrade")
        .select(["materialSubstanceId", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(
        rows.map((x) => `${x.materialSubstanceId}:${norm(x.name)}`)
      );
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await inChunks(
        rows.map(
          (r) =>
            ({
              name: r.name!.trim(),
              materialSubstanceId: r.materialSubstanceId!.trim(),
              companyId
            }) as never
        ),
        (rows) =>
          trx
            .insertInto("materialGrade")
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      return inserted.length;
    }
  },
  materialType: {
    parents: [
      {
        field: "materialSubstanceId",
        table: "materialSubstance",
        reason: SUBSTANCE_UNMATCHED
      },
      {
        field: "materialFormId",
        table: "materialForm",
        reason: SHAPE_UNMATCHED
      }
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.code?.trim()
          ? "Code is required"
          : !r.materialSubstanceId?.trim()
            ? SUBSTANCE_UNMATCHED
            : !r.materialFormId?.trim()
              ? SHAPE_UNMATCHED
              : null,
    keysOf: (r) => {
      const sub = r.materialSubstanceId!.trim();
      const form = r.materialFormId!.trim();
      return [
        `${sub}:${form}:c:${norm(r.code)}`,
        `${sub}:${form}:n:${norm(r.name)}`
      ];
    },
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialType")
        .select(["materialSubstanceId", "materialFormId", "code", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      const set = new Set<string>();
      for (const x of rows) {
        set.add(
          `${x.materialSubstanceId}:${x.materialFormId}:c:${norm(x.code ?? "")}`
        );
        set.add(
          `${x.materialSubstanceId}:${x.materialFormId}:n:${norm(x.name)}`
        );
      }
      return set;
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await inChunks(
        rows.map(
          (r) =>
            ({
              name: r.name!.trim(),
              code: r.code!.trim(),
              materialSubstanceId: r.materialSubstanceId!.trim(),
              materialFormId: r.materialFormId!.trim(),
              companyId
            }) as never
        ),
        (rows) =>
          trx
            .insertInto("materialType")
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      return inserted.length;
    }
  },
  materialDimension: {
    parents: [
      {
        field: "materialFormId",
        table: "materialForm",
        reason: SHAPE_UNMATCHED
      }
    ],
    validate: (r) =>
      !r.name?.trim()
        ? "Name is required"
        : !r.materialFormId?.trim()
          ? SHAPE_UNMATCHED
          : null,
    keysOf: (r) => [`${r.materialFormId!.trim()}:${norm(r.name)}`],
    loadExistingKeys: async (trx, companyId) => {
      const rows = await trx
        .selectFrom("materialDimension")
        .select(["materialFormId", "name"])
        .where((eb) =>
          eb.or([eb("companyId", "=", companyId), eb("companyId", "is", null)])
        )
        .execute();
      return new Set(rows.map((x) => `${x.materialFormId}:${norm(x.name)}`));
    },
    insert: async (trx, rows, companyId) => {
      const inserted = await inChunks(
        rows.map(
          (r) =>
            ({
              name: r.name!.trim(),
              materialFormId: r.materialFormId!.trim(),
              isMetric: isMetricValue(r.isMetric),
              companyId
            }) as never
        ),
        (rows) =>
          trx
            .insertInto("materialDimension")
            .values(rows)
            .onConflict((oc) => oc.doNothing())
            .returning(["id"])
            .execute()
      );
      return inserted.length;
    }
  }
};

export async function importMaterialProperties(
  db: Kysely<KyselyDatabase>,
  {
    table,
    mappedRecords,
    companyId,
    userId,
    summary
  }: {
    table: MaterialPropertyTable;
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
) {
  const config = materialPropertyImportCONFIGS[table];

  await db.transaction().execute(async (trx) => {
    const existingKeys = await config.loadExistingKeys(trx, companyId);

    const parentSpecs = config.parents ?? [];
    const parentIds = new Map<string, Set<string>>();
    for (const parentTable of new Set(parentSpecs.map((p) => p.table))) {
      parentIds.set(
        parentTable,
        await loadParentIds(trx, parentTable, companyId)
      );
    }

    const seenKeys = new Set<string>();
    const accepted: Rec[] = [];

    for (const [rowIndex, record] of mappedRecords.entries()) {
      const reason = config.validate(record);
      if (reason) {
        summary.errors.push({ row: rowIndex, reason });
        continue;
      }

      const foreignParent = parentSpecs.find(
        (p) => !parentIds.get(p.table)?.has((record[p.field] ?? "").trim())
      );
      if (foreignParent) {
        summary.errors.push({ row: rowIndex, reason: foreignParent.reason });
        continue;
      }

      const keys = config.keysOf(record);
      if (keys.some((k) => existingKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Already exists — skipped"
        });
        continue;
      }
      if (keys.some((k) => seenKeys.has(k))) {
        summary.skipped.push({
          row: rowIndex,
          reason: "Duplicate row in file — skipped"
        });
        continue;
      }

      keys.forEach((k) => seenKeys.add(k));
      accepted.push(record);
    }

    importCsvTableLogger.info("import-material-properties", {
      table,
      totalRecords: mappedRecords.length,
      accepted: accepted.length,
      skipped: summary.skipped.length,
      errors: summary.errors.length
    });

    if (accepted.length > 0) {
      summary.inserted += await config.insert(trx, accepted, companyId, userId);
    }
  });
}
const ROW_TYPES = ["PART", "BOM", "BOP", "STEP", "TOOL", "PARAM"] as const;

type RowType = (typeof ROW_TYPES)[number];

const STEP_TYPES = [
  "Task",
  "Value",
  "Measurement",
  "Checkbox",
  "Timestamp",
  "Person",
  "List",
  "File",
  "Inspection"
] as const;

type Entry = { record: Rec; index: number };

type VersionBucket = {
  bom: Entry[];
  bop: Entry[];
  step: Entry[];
  tool: Entry[];
  param: Entry[];
};

type Group = {
  readableId: string;
  revision: string;
  firstIndex: number;
  partRow?: Entry;
  versions: Map<string, VersionBucket>;
};

type ItemInfo = {
  id: string;
  type: string;
  defaultMethodType: string | null;
  sourcingType: string | null;
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const key = (readableId: string, revision: string) =>
  `${readableId} ${revision || "0"}`;

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const bool = (s: string | undefined): boolean =>
  typeof s === "string" && s.trim().toLowerCase() === "true";

// Legacy CSV templates may still use the old "Inside"/"Outside" operation types.
const normalizeOperationType = (value: string): string =>
  value === "Inside"
    ? "Process"
    : value === "Outside"
      ? "Outside Processing"
      : value;

// The `row` reported on each error: the 0-based index of the data row. This must
// match how the results modal keys errors to rows (by array index into the parsed
// rows) and the standard importer in index.ts — NOT a human CSV line number.
const rowOf = (index: number) => index;

// Plain text → minimal tiptap doc for a step's rich-text description.
function plainTextToTiptap(value: string): Record<string, unknown> {
  const t = (value ?? "").trim();
  if (!t) return {};
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }]
  };
}

function normalizeRowType(
  raw: string | undefined,
  table: string
): RowType | null {
  const v = (raw ?? "").trim().toUpperCase();
  // The BOM file is homogeneous — every row is a BOM line — so a blank Row Type
  // defaults to BOM. The operations and combined files are multi-type (BOP/STEP/
  // TOOL/PARAM, +PART), so Row Type is a required discriminator there.
  if (!v) return table === "bom" ? "BOM" : null;
  return (ROW_TYPES as readonly string[]).includes(v) ? (v as RowType) : null;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export async function importMethods(
  db: Kysely<KyselyDatabase>,
  args: {
    table: "bom" | "operations" | "partWithMethod";
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { table, mappedRecords, companyId, userId, summary } = args;

  // 1. classify + group by parent part ------------------------------------
  const groups = new Map<string, Group>();
  const getGroup = (readableId: string, revision: string, index: number) => {
    const k = key(readableId, revision);
    let g = groups.get(k);
    if (!g) {
      g = {
        readableId,
        revision: revision || "0",
        firstIndex: index,
        versions: new Map()
      };
      groups.set(k, g);
    }
    return g;
  };
  const getBucket = (g: Group, version: string): VersionBucket => {
    let b = g.versions.get(version);
    if (!b) {
      b = { bom: [], bop: [], step: [], tool: [], param: [] };
      g.versions.set(version, b);
    }
    return b;
  };

  mappedRecords.forEach((record, index) => {
    const rowType = normalizeRowType(record.rowType, table);
    if (!rowType) {
      summary.errors.push({
        row: rowOf(index),
        reason: `Unknown or missing Row Type "${text(record.rowType)}"`
      });
      return;
    }

    if (rowType === "PART") {
      const readableId = text(record.readableId);
      if (!readableId) {
        summary.errors.push({
          row: rowOf(index),
          reason: "PART row is missing Part Number"
        });
        return;
      }
      const g = getGroup(readableId, text(record.revision), index);
      g.partRow = { record, index };
      return;
    }

    // BOM / BOP / STEP / TOOL / PARAM — keyed to a parent part.
    const parentId = text(record.parentId);
    if (!parentId) {
      summary.errors.push({
        row: rowOf(index),
        reason: `${rowType} row is missing Parent ID`
      });
      return;
    }
    const g = getGroup(parentId, text(record.parentRevision), index);
    const bucket = getBucket(g, text(record.makeMethodVersion));
    const entry = { record, index };
    if (rowType === "BOM") bucket.bom.push(entry);
    else if (rowType === "BOP") bucket.bop.push(entry);
    else if (rowType === "STEP") bucket.step.push(entry);
    else if (rowType === "TOOL") bucket.tool.push(entry);
    else if (rowType === "PARAM") bucket.param.push(entry);
  });

  if (groups.size === 0) return;

  // 2. collect reference lookups ------------------------------------------
  const readableIds = new Set<string>();
  const processNames = new Set<string>();
  const workCenterNames = new Set<string>();
  const uomCodes = new Set<string>();
  const supplierNames = new Set<string>();

  for (const g of groups.values()) {
    readableIds.add(g.readableId);
    for (const bucket of g.versions.values()) {
      for (const e of bucket.bom) {
        if (text(e.record.componentId))
          readableIds.add(text(e.record.componentId));
        if (text(e.record.unitOfMeasureCode))
          uomCodes.add(text(e.record.unitOfMeasureCode));
      }
      for (const e of bucket.bop) {
        if (text(e.record.process))
          processNames.add(text(e.record.process).toLowerCase());
        if (text(e.record.workCenter))
          workCenterNames.add(text(e.record.workCenter).toLowerCase());
        if (text(e.record.supplier))
          supplierNames.add(text(e.record.supplier).toLowerCase());
      }
      for (const e of bucket.tool) {
        if (text(e.record.toolId)) readableIds.add(text(e.record.toolId));
      }
      for (const e of bucket.step) {
        if (text(e.record.stepUnitOfMeasureCode))
          uomCodes.add(text(e.record.stepUnitOfMeasureCode));
      }
    }
  }

  const itemMap = new Map<string, ItemInfo>();
  if (readableIds.size > 0) {
    const rows = await db
      .selectFrom("item")
      .select([
        "id",
        "readableId",
        "revision",
        "type",
        "defaultMethodType",
        "sourcingType"
      ])
      .where("companyId", "=", companyId)
      .where("readableId", "in", Array.from(readableIds))
      .execute();
    for (const r of rows) {
      const k = key(r.readableId, r.revision ?? "0");
      if (!itemMap.has(k)) {
        itemMap.set(k, {
          id: r.id,
          type: r.type,
          defaultMethodType: r.defaultMethodType ?? null,
          sourcingType: r.sourcingType ?? null
        });
      }
    }
  }

  const { map: processMap, ambiguous: processAmbiguous } = await nameMap(
    db,
    "process",
    companyId,
    processNames
  );
  const { map: workCenterMap, ambiguous: workCenterAmbiguous } = await nameMap(
    db,
    "workCenter",
    companyId,
    workCenterNames
  );

  const uomSet = new Set<string>();
  if (uomCodes.size > 0) {
    const rows = await db
      .selectFrom("unitOfMeasure")
      .select(["code"])
      .where("companyId", "=", companyId)
      .execute();
    for (const r of rows) uomSet.add(r.code);
  }

  const supplierMap = new Map<string, string>();
  if (supplierNames.size > 0) {
    const rows = await db
      .selectFrom("supplier")
      .select(["id", "name", "readableId"])
      .where("companyId", "=", companyId)
      .execute();
    for (const r of rows) {
      supplierMap.set(r.name.toLowerCase(), r.id);
      if (r.readableId) supplierMap.set(r.readableId.toLowerCase(), r.id);
    }
  }

  // Set of parts that this file will create (so a same-file sub-assembly counts
  // as resolvable during validation even though it doesn't exist yet).
  const fileCreatedParts = new Set<string>();
  for (const g of groups.values()) {
    if (g.partRow) fileCreatedParts.add(key(g.readableId, g.revision));
  }

  // 3 + 4. validate and write each part group ------------------------------
  for (const g of groups.values()) {
    const partLabel = `${g.readableId} rev ${g.revision}`;
    const errors = validateGroup(g, {
      itemMap,
      fileCreatedParts,
      processMap,
      processAmbiguous,
      workCenterMap,
      workCenterAmbiguous,
      uomSet
    });

    if (errors.length > 0) {
      for (const e of errors) summary.errors.push(e);
      continue;
    }

    try {
      const result = await writeGroup(db, g, {
        companyId,
        userId,
        itemMap,
        processMap,
        workCenterMap,
        supplierMap
      });
      if (result.filledAny) {
        // A new part counts as imported; an existing part as updated.
        if (g.partRow) summary.inserted++;
        else summary.updated++;
      } else if (result.skippedExisting) {
        // The targeted version already had content — create-only, never clobber.
        // Benign: not something the user needs to fix, so it's a skip, not an error.
        summary.skipped.push({
          row: rowOf(g.firstIndex),
          reason: `Part ${partLabel} already has a method; skipped`
        });
      } else if (g.partRow) {
        // A PART row with no BOM/BOP rows — only the part itself was created.
        summary.inserted++;
      }
    } catch (err) {
      summary.errors.push({
        row: rowOf(g.firstIndex),
        reason: `Part ${partLabel} failed to import: ${
          err instanceof Error ? err.message : String(err)
        }`
      });
    }
  }
}

// ---------------------------------------------------------------------------
// reference helpers
// ---------------------------------------------------------------------------

async function nameMap(
  db: Kysely<KyselyDatabase>,
  table: "process" | "workCenter",
  companyId: string,
  names: Set<string>
): Promise<{ map: Map<string, string>; ambiguous: Set<string> }> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  if (names.size === 0) return { map, ambiguous };

  const rows = await db
    .selectFrom(table)
    .select(["id", "name"])
    .where("companyId", "=", companyId)
    .execute();
  for (const r of rows) {
    const lower = r.name.toLowerCase();
    if (map.has(lower)) ambiguous.add(lower);
    else map.set(lower, r.id);
  }
  return { map, ambiguous };
}

// ---------------------------------------------------------------------------
// validation (pure, given the resolved lookups)
// ---------------------------------------------------------------------------

type Lookups = {
  itemMap: Map<string, ItemInfo>;
  fileCreatedParts: Set<string>;
  processMap: Map<string, string>;
  processAmbiguous: Set<string>;
  workCenterMap: Map<string, string>;
  workCenterAmbiguous: Set<string>;
  uomSet: Set<string>;
};

function validateGroup(
  g: Group,
  lk: Lookups
): Array<{ row: number; reason: string }> {
  const errors: Array<{ row: number; reason: string }> = [];
  const parentKey = key(g.readableId, g.revision);
  const partLabel = `${g.readableId} rev ${g.revision}`;

  // Parent must be makeable (Part or Tool). A part created by this file is makeable.
  if (!g.partRow) {
    const parent = lk.itemMap.get(parentKey);
    if (!parent) {
      errors.push({
        row: rowOf(g.firstIndex),
        reason: `Parent part ${partLabel} not found`
      });
    } else if (parent.type !== "Part" && parent.type !== "Tool") {
      errors.push({
        row: rowOf(g.firstIndex),
        reason: `Parent ${partLabel} is a ${parent.type}; only a Part or Tool can own a method`
      });
    }
  }

  for (const bucket of g.versions.values()) {
    // Op No uniqueness within the parent + a set to validate child references.
    const opNos = new Set<string>();
    for (const e of bucket.bop) {
      const opNo = text(e.record.opNo);
      if (!opNo) {
        errors.push({
          row: rowOf(e.index),
          reason: "BOP row is missing Op No"
        });
        continue;
      }
      if (opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Duplicate Op No "${opNo}" for ${partLabel}`
        });
      }
      opNos.add(opNo);

      // process required + resolvable
      const proc = text(e.record.process).toLowerCase();
      if (!proc) {
        errors.push({
          row: rowOf(e.index),
          reason: `Op ${opNo}: Process is required`
        });
      } else if (lk.processAmbiguous.has(proc)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Op ${opNo}: Process name is ambiguous`
        });
      } else if (!lk.processMap.has(proc)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Op ${opNo}: Process "${text(e.record.process)}" not found`
        });
      }

      const wc = text(e.record.workCenter).toLowerCase();
      if (wc) {
        if (lk.workCenterAmbiguous.has(wc)) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Work Center name is ambiguous`
          });
        } else if (!lk.workCenterMap.has(wc)) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: Work Center "${text(e.record.workCenter)}" not found`
          });
        }
      }

      // In-house operations need time units.
      const opType =
        normalizeOperationType(text(e.record.operationType)) || "Process";
      if (opType !== "Outside Processing") {
        if (
          !text(e.record.setupUnit) ||
          !text(e.record.laborUnit) ||
          !text(e.record.machineUnit)
        ) {
          errors.push({
            row: rowOf(e.index),
            reason: `Op ${opNo}: In-house operations require Setup, Labor, and Machine units`
          });
        }
      }
    }

    // BOM lines
    for (const e of bucket.bom) {
      const componentId = text(e.record.componentId);
      if (!componentId) {
        errors.push({
          row: rowOf(e.index),
          reason: "BOM row is missing Material ID"
        });
        continue;
      }
      const compKey = key(componentId, text(e.record.componentRevision));
      if (!lk.itemMap.has(compKey) && !lk.fileCreatedParts.has(compKey)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Material ${componentId} rev ${text(e.record.componentRevision) || "0"} not found`
        });
      }
      if (num(e.record.quantity) === undefined) {
        errors.push({
          row: rowOf(e.index),
          reason: "BOM row has an invalid Quantity"
        });
      }
      const uom = text(e.record.unitOfMeasureCode);
      if (uom && !lk.uomSet.has(uom)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Unit of Measure "${uom}" not found`
        });
      }
    }

    // STEP / TOOL / PARAM must reference a known Op No within this version.
    for (const e of bucket.step) {
      const opNo = text(e.record.opNo);
      if (!opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `STEP references unknown Op No "${opNo}"`
        });
      }
      if (!text(e.record.stepName)) {
        errors.push({
          row: rowOf(e.index),
          reason: "STEP row is missing Name"
        });
      }
      const stepType = text(e.record.stepType) || "Task";
      if (!(STEP_TYPES as readonly string[]).includes(stepType)) {
        errors.push({
          row: rowOf(e.index),
          reason: `Invalid Step Type "${stepType}"`
        });
      }
      if (stepType === "Measurement" && !text(e.record.stepUnitOfMeasureCode)) {
        errors.push({
          row: rowOf(e.index),
          reason: "Measurement step requires a Step Unit of Measure"
        });
      }
      if (stepType === "List" && !text(e.record.stepListValues)) {
        errors.push({
          row: rowOf(e.index),
          reason: "List step requires Step List Values"
        });
      }
    }
    for (const e of bucket.tool) {
      const opNo = text(e.record.opNo);
      if (!opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `TOOL references unknown Op No "${opNo}"`
        });
      }
      const toolId = text(e.record.toolId);
      if (!toolId) {
        errors.push({
          row: rowOf(e.index),
          reason: "TOOL row is missing Tool ID"
        });
      } else {
        const toolKey = key(toolId, text(e.record.toolRevision));
        if (!lk.itemMap.has(toolKey) && !lk.fileCreatedParts.has(toolKey)) {
          errors.push({
            row: rowOf(e.index),
            reason: `Tool ${toolId} rev ${text(e.record.toolRevision) || "0"} not found`
          });
        }
      }
      if (num(e.record.toolQuantity) === undefined) {
        errors.push({
          row: rowOf(e.index),
          reason: "TOOL row has an invalid Quantity"
        });
      }
    }
    for (const e of bucket.param) {
      const opNo = text(e.record.opNo);
      if (!opNos.has(opNo)) {
        errors.push({
          row: rowOf(e.index),
          reason: `PARAM references unknown Op No "${opNo}"`
        });
      }
      if (!text(e.record.paramKey)) {
        errors.push({
          row: rowOf(e.index),
          reason: "PARAM row is missing Key"
        });
      }
      if (!text(e.record.paramValue)) {
        errors.push({
          row: rowOf(e.index),
          reason: "PARAM row is missing Value"
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// write (one transaction per part group → atomic per part, ADR-0001)
// ---------------------------------------------------------------------------

async function writeGroup(
  db: Kysely<KyselyDatabase>,
  g: Group,
  ctx: {
    companyId: string;
    userId: string;
    itemMap: Map<string, ItemInfo>;
    processMap: Map<string, string>;
    workCenterMap: Map<string, string>;
    supplierMap: Map<string, string>;
  }
): Promise<{ filledAny: boolean; skippedExisting: boolean }> {
  const { companyId, userId } = ctx;
  const now = () => datetime.timestamp();

  return await db.transaction().execute(async (trx) => {
    let filledAny = false;
    let skippedExisting = false;

    // Resolve (or create) the parent item.
    let parentItemId: string;
    if (g.partRow) {
      const r = g.partRow.record;
      const inserted = await trx
        .insertInto("item")
        .values([
          {
            readableId: g.readableId,
            revision: g.revision || "0",
            name: text(r.name) || g.readableId,
            mpn: text(r.mpn) || undefined,
            type: "Part",
            companyId,
            active: text(r.active).toLowerCase() !== "false",
            replenishmentSystem: text(r.replenishmentSystem) || "Buy and Make",
            defaultMethodType: text(r.defaultMethodType) || undefined,
            itemTrackingType: text(r.itemTrackingType) || "Inventory",
            unitOfMeasureCode: text(r.unitOfMeasureCode) || "EA",
            createdAt: now(),
            createdBy: userId
          } as never
        ])
        // Re-running the same file upserts the item rather than duplicating it.
        .onConflict((oc) =>
          oc.constraint("item_unique").doUpdateSet({
            updatedAt: now(),
            updatedBy: userId
          } as never)
        )
        .returning(["id"])
        .execute();
      parentItemId = inserted[0]!.id;

      // The makeMethod Draft v1 is created by the AFTER INSERT trigger on item.
      // The part row links to the item by readableId (part.id = item.readableId).
      await trx
        .insertInto("part")
        .values([
          {
            id: g.readableId,
            companyId,
            approved: true,
            createdAt: now(),
            createdBy: userId
          } as never
        ])
        .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
        .execute();
    } else {
      const parent = ctx.itemMap.get(key(g.readableId, g.revision));
      parentItemId = parent!.id;
    }

    for (const [version, bucket] of g.versions) {
      const makeMethodId = await ensureMakeMethod(
        trx,
        parentItemId,
        version,
        companyId,
        userId
      );

      // Create-only: fill a version only if it has no method content yet.
      const hasMaterial = await trx
        .selectFrom("methodMaterial")
        .select("id")
        .where("makeMethodId", "=", makeMethodId)
        .limit(1)
        .executeTakeFirst();
      const hasOperation = await trx
        .selectFrom("methodOperation")
        .select("id")
        .where("makeMethodId", "=", makeMethodId)
        .limit(1)
        .executeTakeFirst();
      if (hasMaterial || hasOperation) {
        skippedExisting = true;
        continue;
      }

      // --- materials (BOM), in file row order ---
      let order = 1;
      for (const e of bucket.bom) {
        const r = e.record;
        const component = await resolveItem(
          trx,
          companyId,
          text(r.componentId),
          text(r.componentRevision),
          ctx.itemMap
        );
        const methodType = component.defaultMethodType ?? "Pull from Inventory";
        const sourcingType = component.sourcingType ?? "Specified";

        let materialMakeMethodId: string | null = null;
        if (methodType === "Make to Order") {
          materialMakeMethodId = await currentMakeMethodId(
            trx,
            component.id,
            companyId
          );
        }

        const storageUnitIds = await seedStorageUnitIds(trx, component.id);

        await trx
          .insertInto("methodMaterial")
          .values([
            {
              makeMethodId,
              itemId: component.id,
              itemType: component.type,
              methodType,
              sourcingType,
              materialMakeMethodId,
              quantity: num(r.quantity) ?? 1,
              unitOfMeasureCode: text(r.unitOfMeasureCode) || "EA",
              order,
              kit: bool(r.kit),
              storageUnitIds,
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
        order++;
        filledAny = true;
      }

      // --- operations (BOP), keyed by Op No ---
      const opIdByNo = new Map<string, string>();
      let opIndex = 1;
      for (const e of bucket.bop) {
        const r = e.record;
        const opNo = text(r.opNo);
        const opType =
          normalizeOperationType(text(r.operationType)) || "Process";
        const processId = ctx.processMap.get(text(r.process).toLowerCase())!;
        const workCenterId = text(r.workCenter)
          ? ctx.workCenterMap.get(text(r.workCenter).toLowerCase())
          : undefined;

        let operationSupplierProcessId: string | undefined;
        if (opType === "Outside Processing" && text(r.supplier)) {
          operationSupplierProcessId = await resolveSupplierProcess(
            trx,
            companyId,
            ctx.supplierMap.get(text(r.supplier).toLowerCase()),
            processId
          );
        }

        const inserted = await trx
          .insertInto("methodOperation")
          .values([
            {
              makeMethodId,
              order: num(opNo) ?? opIndex,
              operationOrder: text(r.operationOrder) || "After Previous",
              operationType: opType,
              processId,
              workCenterId,
              description: text(r.operationDescription),
              setupUnit: text(r.setupUnit) || undefined,
              setupTime: num(r.setupTime) ?? 0,
              laborUnit: text(r.laborUnit) || undefined,
              laborTime: num(r.laborTime) ?? 0,
              machineUnit: text(r.machineUnit) || undefined,
              machineTime: num(r.machineTime) ?? 0,
              operationSupplierProcessId,
              operationMinimumCost: num(r.operationMinimumCost),
              operationUnitCost: num(r.operationUnitCost),
              operationLeadTime: num(r.operationLeadTime),
              workInstruction: {},
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .returning(["id"])
          .execute();
        opIdByNo.set(opNo, inserted[0]!.id);
        opIndex++;
        filledAny = true;
      }

      // --- steps / tools / parameters per operation ---
      const sortByOp = new Map<string, number>();
      for (const e of bucket.step) {
        const r = e.record;
        const operationId = opIdByNo.get(text(r.opNo))!;
        const sortOrder = (sortByOp.get(operationId) ?? 0) + 1;
        sortByOp.set(operationId, sortOrder);
        const stepType = text(r.stepType) || "Task";
        await trx
          .insertInto("methodOperationStep")
          .values([
            {
              operationId,
              name: text(r.stepName),
              description: plainTextToTiptap(text(r.stepDescription)),
              type: stepType,
              required: bool(r.stepRequired),
              sortOrder,
              unitOfMeasureCode:
                stepType === "Measurement"
                  ? text(r.stepUnitOfMeasureCode) || undefined
                  : undefined,
              minValue: num(r.stepMinValue),
              maxValue: num(r.stepMaxValue),
              listValues:
                stepType === "List" && text(r.stepListValues)
                  ? text(r.stepListValues)
                      .split("|")
                      .map((v) => v.trim())
                      .filter(Boolean)
                  : undefined,
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
      }

      for (const e of bucket.tool) {
        const r = e.record;
        const operationId = opIdByNo.get(text(r.opNo))!;
        const tool = await resolveItem(
          trx,
          companyId,
          text(r.toolId),
          text(r.toolRevision),
          ctx.itemMap
        );
        await trx
          .insertInto("methodOperationTool")
          .values([
            {
              operationId,
              toolId: tool.id,
              quantity: num(r.toolQuantity) ?? 1,
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
      }

      for (const e of bucket.param) {
        const r = e.record;
        const operationId = opIdByNo.get(text(r.opNo))!;
        await trx
          .insertInto("methodOperationParameter")
          .values([
            {
              operationId,
              key: text(r.paramKey),
              value: text(r.paramValue),
              companyId,
              createdBy: userId,
              createdAt: now()
            } as never
          ])
          .execute();
      }
    }

    return { filledAny, skippedExisting };
  });
}

// ---------------------------------------------------------------------------
// transaction-scoped resolution helpers
// ---------------------------------------------------------------------------

// Resolve an item id by readableId + revision. Falls back to a DB lookup for a
// part created earlier in this same file (not present in the prefetched map).
async function resolveItem(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  readableId: string,
  revision: string,
  itemMap: Map<string, ItemInfo>
): Promise<ItemInfo> {
  const k = key(readableId, revision);
  const cached = itemMap.get(k);
  if (cached) return cached;

  const row = await trx
    .selectFrom("item")
    .select(["id", "type", "defaultMethodType", "sourcingType"])
    .where("companyId", "=", companyId)
    .where("readableId", "=", readableId)
    .where("revision", "=", revision || "0")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    throw new Error(`Item ${readableId} rev ${revision || "0"} not found`);
  }
  const info: ItemInfo = {
    id: row.id,
    type: row.type,
    defaultMethodType: row.defaultMethodType ?? null,
    sourcingType: row.sourcingType ?? null
  };
  itemMap.set(k, info);
  return info;
}

// The part's current (active, else highest non-archived) make method id —
// mirrors the activeMakeMethods view ranking.
async function currentMakeMethodId(
  trx: Transaction<KyselyDatabase>,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const rows = await trx
    .selectFrom("makeMethod")
    .select(["id", "version", "status"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("status", "!=", "Archived")
    .execute();
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const aActive = a.status === "Active" ? 0 : 1;
    const bActive = b.status === "Active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return Number(b.version) - Number(a.version);
  });
  return rows[0]!.id;
}

// Resolve the target make method for a version. Blank → the part's current
// method (the trigger-created Draft v1 for a new part). Explicit → find-or-create
// that version as a Draft; never auto-activate.
async function ensureMakeMethod(
  trx: Transaction<KyselyDatabase>,
  itemId: string,
  version: string,
  companyId: string,
  userId: string
): Promise<string> {
  if (!version.trim()) {
    const current = await currentMakeMethodId(trx, itemId, companyId);
    if (current) return current;
    // No make method yet (e.g. a non-trigger item type) — create Draft v1.
    const inserted = await trx
      .insertInto("makeMethod")
      .values([
        {
          itemId,
          companyId,
          version: 1,
          status: "Draft",
          createdBy: userId,
          createdAt: datetime.timestamp()
        } as never
      ])
      .returning(["id"])
      .execute();
    return inserted[0]!.id;
  }

  const versionNumber = num(version) ?? 1;
  const existing = await trx
    .selectFrom("makeMethod")
    .select(["id"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("version", "=", versionNumber)
    .limit(1)
    .executeTakeFirst();
  if (existing) return existing.id;

  const inserted = await trx
    .insertInto("makeMethod")
    .values([
      {
        itemId,
        companyId,
        version: versionNumber,
        status: "Draft",
        createdBy: userId,
        createdAt: datetime.timestamp()
      } as never
    ])
    .returning(["id"])
    .execute();
  return inserted[0]!.id;
}

// Seed storageUnitIds from the component's pickMethod default bins (mirrors
// resolveMethodMaterialStorageUnitIds in items.service.ts).
async function seedStorageUnitIds(
  trx: Transaction<KyselyDatabase>,
  itemId: string
): Promise<Record<string, string>> {
  const current: Record<string, string> = {};
  const rows = await trx
    .selectFrom("pickMethod")
    .select(["locationId", "defaultStorageUnitId"])
    .where("itemId", "=", itemId)
    .execute();
  for (const row of rows) {
    if (
      row.locationId &&
      row.defaultStorageUnitId &&
      !current[row.locationId]
    ) {
      current[row.locationId] = row.defaultStorageUnitId;
    }
  }
  return current;
}

// Optional supplier-process link for an Outside Processing operation (by supplier + process).
async function resolveSupplierProcess(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  supplierId: string | undefined,
  processId: string
): Promise<string | undefined> {
  if (!supplierId) return undefined;
  const row = await trx
    .selectFrom("supplierProcess")
    .select(["id"])
    .where("companyId", "=", companyId)
    .where("supplierId", "=", supplierId)
    .where("processId", "=", processId)
    .limit(1)
    .executeTakeFirst();
  return row?.id;
}
export async function importStockQuantities(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: {
    table: StockImportTable;
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { table, mappedRecords, companyId, userId, summary } = args;
  const isTracked = table !== "inventoryQuantity";

  // 1. preload lookups ------------------------------------------------------
  const readableIds = [
    ...new Set(mappedRecords.map((r) => text(r.readableId)).filter(Boolean))
  ];
  const items =
    readableIds.length > 0
      ? await db
          .selectFrom("item")
          .select([
            "id",
            "readableId",
            "revision",
            "readableIdWithRevision",
            "itemTrackingType",
            "replenishmentSystem",
            "type"
          ])
          .where("companyId", "=", companyId)
          .where("readableId", "in", readableIds)
          .orderBy("type")
          .orderBy("id")
          .execute()
      : [];

  const itemIds = items.map((i) => i.id);
  const [itemCosts, shelfLives] =
    itemIds.length > 0
      ? await Promise.all([
          db
            .selectFrom("itemCost")
            .select([
              "itemId",
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ])
            .where("companyId", "=", companyId)
            .where("itemId", "in", itemIds)
            .execute(),
          isTracked
            ? db
                .selectFrom("itemShelfLife")
                .select(["itemId", "mode", "days"])
                .where("companyId", "=", companyId)
                .where("itemId", "in", itemIds)
                .execute()
            : Promise.resolve([])
        ])
      : [[], []];
  const itemCostByItem = new Map(itemCosts.map((c) => [c.itemId, c]));
  const shelfLifeByItem = new Map(shelfLives.map((s) => [s.itemId, s]));

  // readableId + revision → item; ties broken in `buildStockItemMap`. The
  // query order (type, id) makes the fallback pick deterministic.
  const itemMap = buildStockItemMap(
    table,
    items.map((i) => ({
      id: i.id,
      readableId: i.readableId,
      revision: i.revision,
      itemTrackingType: i.itemTrackingType,
      hasItemCost: itemCostByItem.has(i.id)
    }))
  );
  const itemById = new Map(items.map((i) => [i.id, i]));

  const locations = await db
    .selectFrom("location")
    .select(["id"])
    .where("companyId", "=", companyId)
    .execute();
  const locationIds = new Set(locations.map((l) => l.id));

  const referencedLocationIds = [
    ...new Set(
      mappedRecords
        .map((r) => text(r.locationId))
        .filter((l) => l !== "" && locationIds.has(l))
    )
  ];
  const storageUnits =
    referencedLocationIds.length > 0
      ? await db
          .selectFrom("storageUnit")
          .select(["id", "name", "locationId"])
          .where("companyId", "=", companyId)
          .where("locationId", "in", referencedLocationIds)
          // Only active units, as the single-record adjustment offers
          // (getStorageUnitsListForLocation); an inactive name falls through
          // to the "not found in this location" row error.
          .where("active", "=", true)
          .execute()
      : [];
  const storageUnitMap = new Map<string, string>();
  for (const u of storageUnits) {
    storageUnitMap.set(storageUnitKey(u.locationId, u.name), u.id);
  }

  // Existing batch / serial numbers on the referenced items, any status.
  const existingTrackedKeys = new Set<string>();
  if (isTracked && itemIds.length > 0) {
    const numberField =
      table === "serialQuantity" ? "serialNumber" : "batchNumber";
    const numbers = [
      ...new Set(mappedRecords.map((r) => text(r[numberField])).filter(Boolean))
    ];
    if (numbers.length > 0) {
      const existing = await db
        .selectFrom("trackedEntity")
        .select(["itemId", "readableId"])
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .where("readableId", "in", numbers)
        .execute();
      for (const e of existing) {
        if (e.itemId && e.readableId) {
          existingTrackedKeys.add(trackedKey(e.itemId, e.readableId));
        }
      }
    }
  }

  // 2. classify -------------------------------------------------------------
  const seenTrackedKeys = new Set<string>();
  const planned: StockRowResolved[] = [];
  for (const [rowIndex, record] of mappedRecords.entries()) {
    const decision = classifyStockRow({
      table,
      record,
      itemMap,
      locationIds,
      storageUnitMap,
      existingTrackedKeys,
      seenTrackedKeys
    });
    if (decision.action === "skip") {
      (decision.category === "error" ? summary.errors : summary.skipped).push({
        row: rowIndex,
        reason: decision.reason
      });
      continue;
    }
    // Claim the dedup slot only once the row is valid, so a rejected row never
    // blocks a later legitimate row with the same number.
    if (decision.row.trackedKey) seenTrackedKeys.add(decision.row.trackedKey);
    planned.push(decision.row);
  }

  importCsvTableLogger.info({
    function: "import-stock-quantities",
    table,
    trackingType: STOCK_IMPORT_TRACKING_TYPE[table],
    totalRecords: mappedRecords.length,
    planned: planned.length,
    skipped: summary.skipped.length,
    errors: summary.errors.length
  });

  if (planned.length === 0) return;

  // 3. accounting context — resolved BEFORE the transaction, as
  // post-inventory-adjustment / post-inventory-count do (REST hops
  // mid-transaction park the size-1 pool in idle-in-transaction).
  const today = datetime
    .today(await resolveCompanyTimeZone(db, companyId))
    .toString();
  const nowIso = datetime.timestamp();

  // The journal is Provisional before the company's accounting cutover and
  // Posted after it. Read here to decide whether to resolve a period, and
  // again inside the transaction. A Provisional journal has no period.
  const postingStatus = await journalPostingStatus(db, companyId);
  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, db, today)
      : null;

  // Active dimensions for the company group — journal lines get Item /
  // ItemPostingGroup / Location tags.
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
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      inventoryAdjustmentVarianceAccount:
        accountDefaults.data.inventoryAdjustmentVarianceAccount
    },
    description: "Inventory Adjustment — CSV import",
    userId,
    dimensions: dimensionMap
  };

  // Fixed Duration shelf-life fallback for a new tracked entity with no typed
  // expiry — same rule as post-inventory-adjustment's
  // resolveExpirationForNewEntity. Other modes stay NULL.
  const resolveExpiration = (row: StockRowResolved): string | null => {
    if (row.expirationDate) return row.expirationDate;
    const shelfLife = shelfLifeByItem.get(row.itemId);
    if (shelfLife?.mode === "Fixed Duration" && shelfLife.days) {
      return parseDate(today)
        .add({ days: Number(shelfLife.days) })
        .toString();
    }
    return null;
  };

  // 4. write — whole file in one transaction --------------------------------
  // Everything is planned in memory first, then written table by table in bulk.
  // The rows are byte-for-byte what `bookAdjustment` writes per movement
  // because every one of them — item ledger, cost layer, journal line,
  // journal line dimension — comes out of the builders in
  // `../lib/plan-adjustment.ts` that `bookAdjustment` itself calls, and the
  // cost layers are valued by replaying the per-row read (see
  // `planIncreaseUnitCosts`). Nothing here re-derives a field.
  await db.transaction().execute(async (trx) => {
    await assertPostingStatusUnchanged(trx, companyId, postingStatus);

    // A tracked entity's id is ours to choose, so the ledger rows can name it
    // before anything is inserted.
    const trackedEntityIds = planned.map(() => (isTracked ? nanoid() : null));

    // Value every row up front. `planStockRows` (pure, tested) does the whole
    // per-file plan: which rows carry value at all (bookAdjustment's early
    // return — classifyStockRow already rejects both cases, so it guards a
    // future column rather than a live branch), each row's layer cost from the
    // per-item replay, and which rows post to the GL.
    const planInputs = planned.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      itemTrackingType: itemById.get(row.itemId)!.itemTrackingType
    }));
    const openLayersByItem = await loadOpenCostLayers(trx, {
      itemIds: [
        ...new Set(
          planInputs
            .filter((row) =>
              carriesAdjustmentValue(row.quantity, row.itemTrackingType)
            )
            .map((row) => row.itemId)
        )
      ],
      companyId
    });
    const rowPlans = planStockRows({
      rows: planInputs,
      itemCosts: itemCostByItem,
      openLayersByItem
    });

    // Tracked entities first: the ledger rows reference them.
    if (isTracked) {
      const trackedEntityRows = planned.map((row, rowIndex) => {
        const item = itemById.get(row.itemId)!;
        const expirationDate = resolveExpiration(row);
        // Stamp the trace blob so the popover Source / Override steps show
        // where the entity originated (post-inventory-adjustment shape).
        const adjustmentStamp = {
          userId,
          at: nowIso,
          reason: "Created via CSV import"
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
        return {
          id: trackedEntityIds[rowIndex]!,
          sourceDocument: "Item",
          sourceDocumentId: row.itemId,
          sourceDocumentReadableId: item.readableIdWithRevision ?? undefined,
          itemId: row.itemId,
          readableId: row.readableId,
          quantity: row.quantity,
          status: "Available" as const,
          expirationDate,
          attributes: attributes as unknown as Json,
          companyId,
          createdBy: userId
        };
      });
      for (const rows of chunked(trackedEntityRows)) {
        await trx.insertInto("trackedEntity").values(rows).execute();
      }
    }

    // Item ledger. The generated id is each movement's documentId on its cost
    // ledger and journal lines, so the ids have to come back mapped to their
    // source row. `entryNumber` is a SERIAL assigned as the VALUES rows are
    // formed, so sorting each chunk by it recovers the source order without
    // depending on RETURNING's output order.
    const itemLedgerIds: string[] = [];
    for (const rows of chunked(
      planned.map((row, rowIndex) =>
        buildItemLedgerRow({
          postingDate: today,
          entryType: "Positive Adjmt.",
          documentType: null,
          documentId: null,
          correctionOfItemLedgerId: null,
          itemId: row.itemId,
          locationId: row.locationId,
          storageUnitId: row.storageUnitId,
          trackedEntityId: trackedEntityIds[rowIndex] ?? null,
          quantity: row.quantity,
          comment: row.comment,
          scrapReasonId: null,
          companyId,
          createdBy: userId
        })
      )
    )) {
      const inserted = await trx
        .insertInto("itemLedger")
        .values(rows)
        .returning(["id", "entryNumber"])
        .execute();
      inserted.sort((a, b) => Number(a.entryNumber) - Number(b.entryNumber));
      for (const row of inserted) itemLedgerIds.push(row.id);
    }
    if (itemLedgerIds.length !== planned.length) {
      throw new Error("Item ledger insert did not return a row per movement");
    }

    // Cost layers.
    const costLedgerRows = planned.flatMap((row, rowIndex) =>
      rowPlans[rowIndex]!.carriesValue
        ? [
            buildCostLedgerRow({
              entryType: "Positive Adjmt.",
              documentType: null,
              documentId: itemLedgerIds[rowIndex]!,
              itemId: row.itemId,
              quantity: row.quantity,
              cost: rowPlans[rowIndex]!.cost,
              postingDate: today,
              companyId
            })
          ]
        : []
    );
    for (const rows of chunked(costLedgerRows)) {
      await trx.insertInto("costLedger").values(rows).execute();
    }

    // Journal. A zero-value movement posts no lines, so an all-zero-cost file
    // creates no journal at all — the lazy `getJournalId` behaviour, decided
    // once here instead of per row.
    const postingRowIndexes = planned
      .map((_, rowIndex) => rowIndex)
      .filter((rowIndex) => rowPlans[rowIndex]!.postsJournal);
    if (postingRowIndexes.length > 0) {
      const journalId = await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId: accounting.accountingPeriodId,
        status: postingStatus,
        description: accounting.description,
        postingDate: today,
        userId
      });

      // `journalLineReference` already identifies a movement's line pair (it
      // is what ties the two sides together on the per-row path), so it is
      // also how the inserted ids find their way back to their movement — no
      // positional assumption about RETURNING.
      const referenceByRowIndex = new Map<number, string>(
        postingRowIndexes.map((rowIndex) => [rowIndex, nanoid()])
      );
      const journalLineRows = postingRowIndexes.flatMap((rowIndex) => {
        const row = planned[rowIndex];
        const item = itemById.get(row!.itemId)!;
        return buildAdjustmentJournalLines({
          journalId,
          documentId: itemLedgerIds[rowIndex]!,
          documentType: null,
          journalLineReference: referenceByRowIndex.get(rowIndex)!,
          isGain: true,
          cost: rowPlans[rowIndex]!.cost,
          quantity: row!.quantity,
          replenishmentSystem: item.replenishmentSystem,
          accountDefaults: accounting.accountDefaults,
          companyId
        });
      });
      const journalLineIdsByReference = new Map<string, string[]>();
      for (const rows of chunked(journalLineRows)) {
        const inserted = await trx
          .insertInto("journalLine")
          .values(rows)
          .returning(["id", "journalLineReference"])
          .execute();
        for (const line of inserted) {
          const reference = line.journalLineReference;
          const ids = journalLineIdsByReference.get(reference) ?? [];
          ids.push(line.id);
          journalLineIdsByReference.set(reference, ids);
        }
      }

      const dimensionRows = postingRowIndexes.flatMap((rowIndex) => {
        const row = planned[rowIndex];
        const reference = referenceByRowIndex.get(rowIndex)!;
        const journalLineIds = journalLineIdsByReference.get(reference) ?? [];
        if (journalLineIds.length !== 2) {
          throw new Error(
            "Journal line insert did not return a pair per movement"
          );
        }
        return buildJournalLineDimensions({
          journalLineIds,
          dimensions: accounting.dimensions,
          itemId: row!.itemId,
          itemPostingGroupId: itemCostByItem.get(row!.itemId)!
            .itemPostingGroupId,
          locationId: row!.locationId,
          companyId
        });
      });
      for (const rows of chunked(dimensionRows)) {
        await trx.insertInto("journalLineDimension").values(rows).execute();
      }
    }

    summary.inserted += planned.length;
  });
}
export const importCsvInput = z.object({
  table: z.enum([
    "consumable",
    "customer",
    "customerContact",
    "fixture",
    "material",
    "bom",
    "operations",
    "partWithMethod",
    "part",
    "service",
    "supplier",
    "supplierContact",
    "tool",
    "workCenter",
    "process",
    "storageUnit",
    "unitOfMeasure",
    "itemPostingGroup",
    "storageType",
    "scrapReason",
    "department",
    "materialSubstance",
    "materialForm",
    "materialFinish",
    "materialGrade",
    "materialType",
    "materialDimension",
    "inventoryQuantity",
    "batchQuantity",
    "serialQuantity"
  ]),
  filePath: z.string(),
  columnMappings: z.record(z.string(), z.string()),
  enumMappings: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional()
});

const EXTERNAL_ID_KEY = "csv";

type ImportTable = z.infer<typeof importCsvInput>["table"];

// The columns each importer may write from a CSV row. Kysely here runs as the
// service role, so spreading a row into an INSERT/UPDATE would let a crafted
// mapping write `id`, `createdBy`, `intercompanyCompanyId`, or any other
// column. These mirror `fieldMappings` / `importSchemas` in the ERP's
// `imports.models.ts`; columns the importer derives itself (rates, flags,
// side-table fields) are handled explicitly at the call site.
type CsvTables = Database["public"]["Tables"];

type InsertColumns<T extends keyof CsvTables> =
  readonly (keyof CsvTables[T]["Insert"] & string)[];

const CUSTOMER_COLUMNS = [
  "name",
  "accountManagerId",
  "customerStatusId",
  "customerTypeId",
  "phone",
  "fax",
  "currencyCode",
  "website"
] as const satisfies InsertColumns<"customer">;

const SUPPLIER_COLUMNS = [
  "name",
  "accountManagerId",
  "supplierStatus",
  "supplierTypeId",
  "phone",
  "fax",
  "currencyCode",
  "website"
] as const satisfies InsertColumns<"supplier">;

const CONTACT_COLUMNS = [
  "firstName",
  "lastName",
  "email",
  "title",
  "mobilePhone",
  "workPhone",
  "homePhone",
  "fax",
  "notes"
] as const satisfies InsertColumns<"contact">;

const WORK_CENTER_COLUMNS = [
  "name",
  "description",
  "defaultStandardFactor",
  "locationId"
] as const satisfies InsertColumns<"workCenter">;

const PROCESS_COLUMNS = [
  "name",
  "defaultStandardFactor"
] as const satisfies InsertColumns<"process">;

/**
 * The allow-listed columns of a CSV row, typed as `table`'s own columns. CSV
 * cells are strings; the enum and numeric columns among them are checked by
 * Postgres on write, as they were before the allow-list.
 */
function pickColumns<
  T extends keyof CsvTables,
  K extends keyof CsvTables[T]["Insert"] & string
>(
  _table: T,
  record: Partial<Record<string, string>>,
  columns: readonly K[]
): Partial<Pick<CsvTables[T]["Insert"], K>> {
  const out: Partial<Record<K, string>> = {};
  for (const column of columns) {
    if (column in record) out[column] = record[column];
  }
  return out as unknown as Partial<Pick<CsvTables[T]["Insert"], K>>;
}

// Tables a CSV row may reference by id. The material taxonomy has global
// system rows (companyId IS NULL) that every company may use.
type ReferencedTable =
  | "employee"
  | "customerStatus"
  | "customerType"
  | "supplierType"
  | "paymentTerm"
  | "shippingMethod"
  | "supplier"
  | "location"
  | "materialSubstance"
  | "materialForm"
  | "materialFinish"
  | "materialGrade"
  | "materialDimension";

const GLOBAL_REFERENCED_TABLES = new Set<ReferencedTable>([
  "materialSubstance",
  "materialForm",
  "materialFinish",
  "materialGrade",
  "materialDimension"
]);

type ReferenceSpec = { column: string; table: ReferencedTable; label: string };

const itemReferences: ReferenceSpec[] = [
  { column: "supplierId", table: "supplier", label: "Supplier" }
];

// Id-valued columns per import. The wizard resolves these through
// company-scoped fetchers, but the ids arrive in the request body, so each is
// re-checked against the caller's company before anything is written.
const REFERENCES: Partial<Record<ImportTable, ReferenceSpec[]>> = {
  customer: [
    { column: "accountManagerId", table: "employee", label: "Account Manager" },
    { column: "customerStatusId", table: "customerStatus", label: "Status" },
    { column: "customerTypeId", table: "customerType", label: "Type" },
    { column: "paymentTermId", table: "paymentTerm", label: "Payment Term" }
  ],
  supplier: [
    { column: "accountManagerId", table: "employee", label: "Account Manager" },
    { column: "supplierTypeId", table: "supplierType", label: "Type" },
    { column: "paymentTermId", table: "paymentTerm", label: "Payment Term" },
    {
      column: "shippingMethodId",
      table: "shippingMethod",
      label: "Shipping Method"
    }
  ],
  part: itemReferences,
  tool: itemReferences,
  fixture: itemReferences,
  consumable: itemReferences,
  service: itemReferences,
  material: [
    ...itemReferences,
    {
      column: "materialSubstanceId",
      table: "materialSubstance",
      label: "Substance"
    },
    { column: "materialFormId", table: "materialForm", label: "Form" },
    { column: "finishId", table: "materialFinish", label: "Finish" },
    { column: "gradeId", table: "materialGrade", label: "Grade" },
    { column: "dimensionId", table: "materialDimension", label: "Dimensions" }
  ],
  workCenter: [{ column: "locationId", table: "location", label: "Location" }],
  storageUnit: [{ column: "locationId", table: "location", label: "Location" }]
};

type CsvRecord = Record<string, string>;

/**
 * Report every row that references a record outside the caller's company, and
 * return the other rows as `[rowIndex, record]` pairs (the index is the CSV row
 * the summary reports). One query per referenced column, run together.
 */
async function rejectForeignReferences(
  db: Kysely<KyselyDatabase>,
  table: ImportTable,
  records: CsvRecord[],
  cId: string,
  errors: Array<{ row: number; reason: string }>
): Promise<Array<[number, CsvRecord]>> {
  const ownedBySpec = await Promise.all(
    (REFERENCES[table] ?? []).map(async (spec) => {
      const ids = [
        ...new Set(
          records.map((r) => r[spec.column]).filter((v): v is string => !!v)
        )
      ];
      if (ids.length === 0) return { spec, owned: new Set<string>() };
      const scope = GLOBAL_REFERENCED_TABLES.has(spec.table)
        ? sql<boolean>`("companyId" = ${cId} OR "companyId" IS NULL)`
        : sql<boolean>`"companyId" = ${cId}`;
      // Every referenced table has an `id` and a `companyId`; the cast only
      // narrows the union for Kysely's types.
      const rows = await db
        .selectFrom(spec.table as "location")
        .select(["id"])
        .where("id", "in", ids)
        .where(scope)
        .execute();
      return { spec, owned: new Set(rows.map((r) => r.id)) };
    })
  );

  const accepted: Array<[number, CsvRecord]> = [];
  for (const [rowIndex, record] of records.entries()) {
    const foreign = ownedBySpec.find(
      ({ spec, owned }) =>
        !!record[spec.column] && !owned.has(record[spec.column]!)
    );
    if (foreign) {
      errors.push({
        row: rowIndex,
        reason: `${foreign.spec.label} "${record[foreign.spec.column]}" was not found in this company`
      });
    } else {
      accepted.push([rowIndex, record]);
    }
  }
  return accepted;
}

/**
 * Fallback CSV parser used when std/csv rejects a row-length mismatch.
 * Handles RFC-4180 quoting but tolerates uneven row widths (extra cells
 * dropped, missing cells become "").
 */
function parsePermissiveCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // \r\n: consume the \n that follows
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip blank rows that arise from trailing newlines
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers!.length; i++) {
      obj[headers![i]!] = r[i] ?? "";
    }
    return obj;
  });
}

type CsvEntityType =
  | "customer"
  | "supplier"
  | "item"
  | "contact"
  | "workCenter"
  | "process"
  | "storageUnit";

/**
 * Look up the ids that still exist in the entity table. Done as a typed
 * switch so each Kysely query is fully type-checked — avoids `as any` casts
 * that bypass the generated DB types.
 */
async function fetchLiveEntityIds(
  db: Kysely<KyselyDatabase>,
  entityType: CsvEntityType,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  let rows: { id: string }[];
  switch (entityType) {
    case "customer":
      rows = await db
        .selectFrom("customer")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "supplier":
      rows = await db
        .selectFrom("supplier")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "item":
      rows = await db
        .selectFrom("item")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "contact":
      rows = await db
        .selectFrom("contact")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "workCenter":
      rows = await db
        .selectFrom("workCenter")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "process":
      rows = await db
        .selectFrom("process")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
    case "storageUnit":
      rows = await db
        .selectFrom("storageUnit")
        .select(["id"])
        .where("id", "in", ids)
        .execute();
      break;
  }
  return new Set(rows.map((r) => r.id));
}

/**
 * Build a name → id map for an entity table, scoped to a company and to the
 * specific names the caller cares about. Used as a fallback dedup key when
 * the CSV's Unique ID has no externalIntegrationMapping row yet (e.g., the
 * entity was created in-app, then a CSV with the same name is imported).
 * Scoping the query to `namesToCheck` avoids a full-table scan on
 * supplier/customer for companies with large rosters.
 */
async function getNameMap(
  db: Kysely<KyselyDatabase>,
  entityType: "supplier" | "customer",
  cId: string,
  namesToCheck: string[]
): Promise<Map<string, string>> {
  if (namesToCheck.length === 0) return new Map();
  const rows =
    entityType === "supplier"
      ? await db
          .selectFrom("supplier")
          .select(["id", "name"])
          .where("companyId", "=", cId)
          .where("name", "in", namesToCheck)
          .execute()
      : await db
          .selectFrom("customer")
          .select(["id", "name"])
          .where("companyId", "=", cId)
          .where("name", "in", namesToCheck)
          .execute();
  return new Map(rows.map((r) => [r.name, r.id]));
}

/**
 * Build a map of CSV external IDs → entity IDs from externalIntegrationMapping.
 * Filters orphan mappings (rows whose entityId points at a deleted entity)
 * so re-imports cleanly take the INSERT path instead of failing the
 * subsequent supplierTax/customerTax upsert with a 23503 FK error.
 */
async function getCsvExternalIdMap(
  db: Kysely<KyselyDatabase>,
  entityType: CsvEntityType,
  cId: string
): Promise<Map<string, string>> {
  const result = await db
    .selectFrom("externalIntegrationMapping")
    .select(["externalId", "entityId"])
    .where("entityType", "=", entityType)
    .where("integration", "=", EXTERNAL_ID_KEY)
    .where("companyId", "=", cId)
    .execute();

  const candidates = result.filter(
    (r): r is typeof r & { externalId: string; entityId: string } =>
      r.externalId !== null && r.entityId !== null
  );

  if (candidates.length === 0) return new Map();

  const liveIds = await fetchLiveEntityIds(
    db,
    entityType,
    candidates.map((r) => r.entityId)
  );

  return new Map(
    candidates
      .filter((r) => liveIds.has(r.entityId))
      .map((r) => [r.externalId, r.entityId])
  );
}

/**
 * Convert empty-string values to undefined. Kysely drops undefined keys from
 * the INSERT, so the column gets its DB default (NULL). Empty CSV cells would
 * otherwise become literal "" and fail FK or enum constraints.
 */
function nullifyEmptyStrings<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" ? undefined : v;
  }
  return out as Partial<T>;
}

/**
 * Upsert CSV external ID mappings into the externalIntegrationMapping table.
 * Uses ON CONFLICT to handle re-imports idempotently.
 */
async function upsertCsvMappings(
  trx: Kysely<KyselyDatabase>,
  entityType: CsvEntityType,
  mappings: Array<{ entityId: string; externalId: string }>,
  cId: string,
  userId: string
): Promise<void> {
  // Skip blank external ids: they carry no match value, and multiple "" rows
  // would collide on the ON CONFLICT key and abort the entire batch insert.
  const valid = mappings.filter((m) => m.externalId);
  if (valid.length === 0) return;

  const now = datetime.timestamp();

  await inChunks(
    valid.map((m) => ({
      entityType,
      entityId: m.entityId,
      integration: EXTERNAL_ID_KEY,
      externalId: m.externalId,
      companyId: cId,
      allowDuplicateExternalId: false,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    })),
    (rows) =>
      trx
        .insertInto("externalIntegrationMapping")
        .values(rows)
        // On conflict (orphan mapping with same csv id but stale entityId),
        // repoint entityId to the freshly-inserted entity. The .where() matches
        // the partial unique index's predicate, required by Postgres for
        // arbitration on partial indexes (42P10 otherwise).
        .onConflict((oc) =>
          oc
            .columns(["integration", "externalId", "entityType", "companyId"])
            .where("allowDuplicateExternalId", "=", false)
            .doUpdateSet((eb) => ({
              entityId: eb.ref("excluded.entityId"),
              updatedAt: eb.ref("excluded.updatedAt")
            }))
        )
        .execute()
  );
}

/**
 * Key for a scoped material-taxonomy lookup: the parent scope id (substance
 * for finish/grade, form for dimensions) plus the case-insensitively
 * normalized name.
 */
function materialTaxonomyKey(scopeId: string, name: string): string {
  return `${scopeId.trim()}:${name.trim().toLowerCase()}`;
}

/**
 * Resolve raw Finish / Grade / Dimensions CSV text to material-taxonomy ids.
 * The taxonomy tables are scoped — materialFinish/materialGrade by substance,
 * materialDimension by form — so names are matched within the row's scope
 * against both global (companyId IS NULL) and company rows; a company row wins
 * a name clash. Unmatched names create a company-scoped row, mirroring the
 * creatable comboboxes on the material form. Returns ids keyed by
 * materialTaxonomyKey.
 */
async function resolveMaterialTaxonomyIds(
  trx: Kysely<KyselyDatabase>,
  taxonomyTable: "materialFinish" | "materialGrade" | "materialDimension",
  scopeColumn: "materialSubstanceId" | "materialFormId",
  pairs: Array<{ scopeId: string; name: string }>,
  cId: string
): Promise<Map<string, string>> {
  const needed = new Map<string, { scopeId: string; name: string }>();
  for (const pair of pairs) {
    const scopeId = pair.scopeId?.trim();
    const name = pair.name?.trim();
    if (!scopeId || !name) continue;
    const key = materialTaxonomyKey(scopeId, name);
    if (!needed.has(key)) {
      needed.set(key, { scopeId, name });
    }
  }

  const idByKey = new Map<string, string>();
  if (needed.size === 0) return idByKey;

  const scopeIds = [...new Set([...needed.values()].map((p) => p.scopeId))];

  const selectMatches = async () => {
    const rows = await trx
      .selectFrom(taxonomyTable)
      .select(["id", "name", "companyId", scopeColumn] as never)
      .where(trx.dynamic.ref<string>(scopeColumn), "in", scopeIds)
      .where(sql<boolean>`("companyId" = ${cId} OR "companyId" IS NULL)`)
      .$castTo<Record<string, string | null>>()
      .execute();
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      companyId: row.companyId ?? null,
      scopeId: row[scopeColumn] as string
    }));
  };

  const collect = (rows: Awaited<ReturnType<typeof selectMatches>>) => {
    for (const row of rows) {
      const key = materialTaxonomyKey(row.scopeId, row.name);
      // Company-scoped rows win over global (NULL companyId) rows.
      if (!idByKey.has(key) || row.companyId === cId) {
        idByKey.set(key, row.id);
      }
    }
  };

  collect(await selectMatches());

  const missing = [...needed.values()].filter(
    (pair) => !idByKey.has(materialTaxonomyKey(pair.scopeId, pair.name))
  );

  if (missing.length > 0) {
    await inChunks(
      missing.map((pair) => ({
        name: pair.name,
        companyId: cId,
        [scopeColumn]: pair.scopeId
      })),
      (rows) =>
        trx
          .insertInto(taxonomyTable)
          .values(rows as never)
          // A concurrent import may have created the same name first; the
          // re-select below picks up whichever row won. The unique constraint is
          // exact-match, so two concurrent imports inserting different CASINGS of
          // the same new name can both land, leaving a case-variant duplicate —
          // the same duplicate the app's creatable comboboxes permit. Closing
          // that window needs a case-insensitive unique index on
          // (scope, lower(name), companyId), which requires a migration plus a
          // dedupe of existing case-variant rows.
          .onConflict((oc) =>
            oc.columns([scopeColumn, "name", "companyId"] as never).doNothing()
          )
          .execute()
    );

    collect(await selectMatches());
  }

  return idByKey;
}

/**
 * Address/payment/shipping fields that can ride along on a supplier or
 * customer CSV row. Written to side-tables (address + supplierLocation /
 * supplierPayment / supplierShipping, mirror for customer) after the parent
 * upsert lands.
 */
type PartnerExtensionData = {
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
  paymentTermId?: string;
  shippingMethodId?: string;
  incoterm?: string;
  incotermLocation?: string;
};

function extractPartnerExtensions(
  record: Record<string, string>
): PartnerExtensionData {
  return {
    locationName: record.locationName,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    state: record.state,
    postalCode: record.postalCode,
    countryCode: record.countryCode,
    paymentTermId: record.paymentTermId,
    shippingMethodId: record.shippingMethodId,
    incoterm: record.incoterm,
    incotermLocation: record.incotermLocation
  };
}

function hasAnyAddressField(ext: PartnerExtensionData): boolean {
  // Require addressLine1 to recognize a row as having an address. It's the
  // most distinguishing line of a postal address and also doubles as the
  // location-name fallback when `Location Name` is blank — without it,
  // creating a supplierLocation/customerLocation would have no usable label.
  return !!ext.addressLine1;
}

function buildAddressFields(ext: PartnerExtensionData): {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string | null;
} {
  return {
    addressLine1: ext.addressLine1 || null,
    addressLine2: ext.addressLine2 || null,
    city: ext.city || null,
    // The CSV field is `state` (user-facing label "State / Region"); the
    // column was renamed to stateProvince in migration 20240928155702.
    stateProvince: ext.state || null,
    postalCode: ext.postalCode || null,
    // address.countryCode is TEXT storing ISO 3166-1 alpha-2 (e.g., "US"),
    // post-20240928155702_country-codes.
    countryCode: ext.countryCode || null
  };
}

/**
 * Bulk-load the addressId of each entity's primary (lowest-id) location.
 * Used by the supplier/customer extension UPDATE paths to avoid an N+1
 * SELECT per entity inside the per-row loop. New inserts pass undefined
 * since by construction they have no location yet.
 */
async function preloadPrimaryLocationAddressIds(
  trx: Kysely<KyselyDatabase>,
  entityType: "supplier" | "customer",
  entityIds: string[]
): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map();
  const rows =
    entityType === "supplier"
      ? await trx
          .selectFrom("supplierLocation")
          .select(["supplierId", "id", "addressId"])
          .where("supplierId", "in", entityIds)
          .orderBy("id")
          .execute()
      : await trx
          .selectFrom("customerLocation")
          .select(["customerId", "id", "addressId"])
          .where("customerId", "in", entityIds)
          .orderBy("id")
          .execute();
  const map = new Map<string, string>();
  for (const row of rows) {
    const key =
      entityType === "supplier"
        ? (row as { supplierId: string }).supplierId
        : (row as { customerId: string }).customerId;
    if (!map.has(key)) map.set(key, row.addressId);
  }
  return map;
}

async function writeSupplierExtensions(
  trx: Kysely<KyselyDatabase>,
  supplierId: string,
  ext: PartnerExtensionData,
  companyId: string,
  userId: string,
  // Pre-fetched addressId of the supplier's existing primary location, if
  // any. Caller bulk-loads these for the whole batch to avoid an N+1
  // SELECT per supplier. undefined means "no existing location → insert".
  existingAddressId: string | undefined
): Promise<void> {
  const now = datetime.timestamp();

  if (hasAnyAddressField(ext)) {
    const addressFields = buildAddressFields(ext);

    if (existingAddressId) {
      await trx
        .updateTable("address")
        .set(addressFields)
        .where("id", "=", existingAddressId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      const inserted = await trx
        .insertInto("address")
        .values({ ...addressFields, companyId })
        .returning(["id"])
        .executeTakeFirst();
      if (inserted?.id) {
        await trx
          .insertInto("supplierLocation")
          .values({
            supplierId,
            companyId,
            addressId: inserted.id,
            // supplierLocation.name is NOT NULL. Prefer the user's
            // Location Name column; fall back to Address Line 1 so the row
            // always has a recognizable label.
            name: (ext.locationName || ext.addressLine1)!
          })
          .execute();
      }
    }
  }

  if (ext.paymentTermId) {
    // The sync_create_supplier_entries interceptor creates the supplierPayment
    // row on supplier INSERT; UPSERT here makes us resilient to edge cases
    // where that row is somehow missing.
    await trx
      .insertInto("supplierPayment")
      .values({
        supplierId,
        paymentTermId: ext.paymentTermId,
        companyId,
        updatedAt: now,
        updatedBy: userId
      })
      .onConflict((oc) =>
        oc.column("supplierId").doUpdateSet({
          paymentTermId: ext.paymentTermId,
          updatedAt: now,
          updatedBy: userId
        })
      )
      .execute();
  }

  if (ext.shippingMethodId || ext.incoterm || ext.incotermLocation) {
    // Build the conditional update separately from the always-set fields so
    // ON CONFLICT only touches columns the user provided in the CSV — blank
    // cells don't overwrite existing values on re-import. The incoterm cast
    // narrows `string` to the Postgres enum union; Postgres rejects invalid
    // values at insert time as a safety net.
    const partialUpdate = {
      ...(ext.shippingMethodId
        ? { shippingMethodId: ext.shippingMethodId }
        : {}),
      ...(ext.incoterm
        ? {
            incoterm: ext.incoterm as Database["public"]["Enums"]["incoterm"]
          }
        : {}),
      ...(ext.incotermLocation
        ? { incotermLocation: ext.incotermLocation }
        : {})
    };
    await trx
      .insertInto("supplierShipping")
      .values({
        supplierId,
        companyId,
        updatedAt: now,
        updatedBy: userId,
        ...partialUpdate
      })
      .onConflict((oc) =>
        oc.column("supplierId").doUpdateSet({
          updatedAt: now,
          updatedBy: userId,
          ...partialUpdate
        })
      )
      .execute();
  }
}

async function writeCustomerExtensions(
  trx: Kysely<KyselyDatabase>,
  customerId: string,
  ext: PartnerExtensionData,
  companyId: string,
  userId: string,
  existingAddressId: string | undefined
): Promise<void> {
  const now = datetime.timestamp();

  if (hasAnyAddressField(ext)) {
    const addressFields = buildAddressFields(ext);

    if (existingAddressId) {
      await trx
        .updateTable("address")
        .set(addressFields)
        .where("id", "=", existingAddressId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      const inserted = await trx
        .insertInto("address")
        .values({ ...addressFields, companyId })
        .returning(["id"])
        .executeTakeFirst();
      if (inserted?.id) {
        await trx
          .insertInto("customerLocation")
          .values({
            customerId,
            companyId,
            addressId: inserted.id,
            // customerLocation.name is NOT NULL. Prefer the user's
            // Location Name column; fall back to Address Line 1.
            name: (ext.locationName || ext.addressLine1)!
          })
          .execute();
      }
    }
  }

  if (ext.paymentTermId) {
    await trx
      .insertInto("customerPayment")
      .values({
        customerId,
        paymentTermId: ext.paymentTermId,
        companyId,
        updatedAt: now,
        updatedBy: userId
      })
      .onConflict((oc) =>
        oc.column("customerId").doUpdateSet({
          paymentTermId: ext.paymentTermId,
          updatedAt: now,
          updatedBy: userId
        })
      )
      .execute();
  }
}

/**
 * Idempotent supplierPart writes for the part/material/tool/fixture/consumable
 * import flow. One CSV row optionally creates one supplierPart link; re-imports
 * UPDATE the existing row (matched by (itemId, supplierId) per company).
 */
type SupplierPartImportLink = {
  itemId: string;
  supplierId: string;
  supplierPartId?: string;
  supplierUnitOfMeasureCode?: string;
  minimumOrderQuantity?: string;
  orderMultiple?: string;
  conversionFactor?: string;
  unitPrice?: string;
};

type ItemPurchasingLeadTime = {
  itemId: string;
  leadTime: string;
};

type ItemUnitCost = {
  itemId: string;
  unitCost: string;
};

type ItemPlanningOrderMultiple = {
  itemId: string;
  orderMultiple: string;
};

async function writeSupplierPartLinks(
  trx: Kysely<KyselyDatabase>,
  links: SupplierPartImportLink[],
  companyId: string,
  userId: string
): Promise<void> {
  if (links.length === 0) return;
  const itemIds = [...new Set(links.map((l) => l.itemId))];
  const supplierIds = [...new Set(links.map((l) => l.supplierId))];
  const existing = await trx
    .selectFrom("supplierPart")
    .select(["id", "itemId", "supplierId"])
    .where("itemId", "in", itemIds)
    .where("supplierId", "in", supplierIds)
    .where("companyId", "=", companyId)
    .execute();
  const existingByPair = new Map(
    existing.map((e) => [`${e.itemId}:${e.supplierId}`, e.id])
  );

  const now = datetime.timestamp();
  for (const link of links) {
    const key = `${link.itemId}:${link.supplierId}`;
    const existingId = existingByPair.get(key);
    const numericMOQ = link.minimumOrderQuantity
      ? Number.parseInt(link.minimumOrderQuantity, 10)
      : null;
    const numericOrderMultiple = link.orderMultiple
      ? Number.parseInt(link.orderMultiple, 10)
      : null;
    const numericConversion = link.conversionFactor
      ? Number.parseFloat(link.conversionFactor)
      : 1;
    // The price is in the supplier part's currency: an existing part keeps
    // its own, a new one is created in base (currencyCode NULL), which is
    // what an imported price has always meant.
    const numericPrice = link.unitPrice
      ? Number.parseFloat(link.unitPrice)
      : null;

    if (existingId) {
      await trx
        .updateTable("supplierPart")
        .set({
          supplierPartId: link.supplierPartId || null,
          supplierUnitOfMeasureCode: link.supplierUnitOfMeasureCode || null,
          minimumOrderQuantity: numericMOQ,
          orderMultiple: numericOrderMultiple,
          conversionFactor: numericConversion,
          supplierUnitPrice: numericPrice,
          updatedAt: now,
          updatedBy: userId
        })
        .where("id", "=", existingId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      await trx
        .insertInto("supplierPart")
        .values({
          itemId: link.itemId,
          supplierId: link.supplierId,
          supplierPartId: link.supplierPartId || null,
          supplierUnitOfMeasureCode: link.supplierUnitOfMeasureCode || null,
          minimumOrderQuantity: numericMOQ,
          orderMultiple: numericOrderMultiple,
          conversionFactor: numericConversion,
          supplierUnitPrice: numericPrice,
          companyId,
          createdBy: userId
        })
        .execute();
    }
  }
}

// Set the item-level purchasing lead time (the "Purchasing" tab field).
// The itemReplenishment row is created by the create_item_related_records
// AFTER INSERT trigger on item (default leadTime 7, per migration
// 20250610000433_demand-planning.sql which renamed purchasingLeadTime →
// leadTime), so within this transaction the row already exists for every
// item we just upserted — we only need to UPDATE it.
async function writeItemPurchasingLeadTimes(
  trx: Kysely<KyselyDatabase>,
  entries: ItemPurchasingLeadTime[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = datetime.timestamp();
  for (const entry of entries) {
    const numericLeadTime = Number.parseInt(entry.leadTime, 10);
    if (Number.isNaN(numericLeadTime)) continue;
    await trx
      .updateTable("itemReplenishment")
      .set({
        leadTime: numericLeadTime,
        updatedAt: now,
        updatedBy: userId
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

// Set the item-level unit cost (the "Costing" tab field). The itemCost row is
// created by the create_item_related_records AFTER INSERT trigger on item, so
// within this transaction the row already exists for every item we upserted —
// we only need to UPDATE it. Non-numeric/blank values are skipped.
async function writeItemUnitCosts(
  trx: Kysely<KyselyDatabase>,
  entries: ItemUnitCost[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = datetime.timestamp();
  for (const entry of entries) {
    const numericUnitCost = Number.parseFloat(entry.unitCost);
    if (Number.isNaN(numericUnitCost)) continue;
    await trx
      .updateTable("itemCost")
      .set({
        unitCost: numericUnitCost,
        updatedAt: now,
        updatedBy: userId
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

// Set the item-level planning order multiple. itemPlanning has one row per
// (item, location) pair, all created by create_item_related_records at item
// insert time (SELECT FROM location WHERE companyId = ...). A single UPDATE
// scoped by itemId + companyId therefore covers every location row for that
// item — matching the "order multiple is unique across every location"
// expectation. Mirrors the same CSV value already written to
// supplierPart.orderMultiple in writeSupplierPartLinks; both are intentionally
// kept in sync at import time even though they're structurally distinct
// fields (supplier case-pack vs MRP preferred multiple).
async function writeItemPlanningOrderMultiples(
  trx: Kysely<KyselyDatabase>,
  entries: ItemPlanningOrderMultiple[],
  companyId: string,
  userId: string
): Promise<void> {
  if (entries.length === 0) return;
  const now = datetime.timestamp();
  for (const entry of entries) {
    const numericOrderMultiple = Number.parseInt(entry.orderMultiple, 10);
    if (Number.isNaN(numericOrderMultiple) || numericOrderMultiple < 1)
      continue;
    await trx
      .updateTable("itemPlanning")
      .set({
        orderMultiple: numericOrderMultiple,
        updatedAt: now,
        updatedBy: userId
      })
      .where("itemId", "=", entry.itemId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

async function upsertTaxIdentifiers(
  trx: Kysely<KyselyDatabase>,
  table: "customerTax" | "supplierTax",
  records: Array<{ entityId: string; taxId: string | null | undefined }>,
  cId: string,
  userId: string
): Promise<void> {
  if (records.length === 0) return;

  const now = datetime.timestamp();
  if (table === "customerTax") {
    await inChunks(
      records.map((r) => ({
        customerId: r.entityId,
        taxId: r.taxId ?? null,
        companyId: cId,
        updatedAt: now,
        updatedBy: userId
      })),
      (rows) =>
        trx
          .insertInto("customerTax")
          .values(rows)
          .onConflict((oc) =>
            oc.column("customerId").doUpdateSet({
              taxId: sql`excluded."taxId"`,
              updatedAt: now,
              updatedBy: userId
            })
          )
          .execute()
    );
    return;
  }
  await inChunks(
    records.map((r) => ({
      supplierId: r.entityId,
      taxId: r.taxId ?? null,
      companyId: cId,
      updatedAt: now,
      updatedBy: userId
    })),
    (rows) =>
      trx
        .insertInto("supplierTax")
        .values(rows)
        .onConflict((oc) =>
          oc.column("supplierId").doUpdateSet({
            taxId: sql`excluded."taxId"`,
            updatedAt: now,
            updatedBy: userId
          })
        )
        .execute()
  );
}

/**
 * Imports an uploaded CSV into `table`, per the caller's column and enum
 * mappings. Run under `importCsvFile`, whose gate holds the table's
 * permission (`importPermissions` in `imports.models.ts`).
 */
export async function importCsvTable(
  ctx: ServiceContext,
  raw: z.input<typeof importCsvInput>
) {
  const {
    table,
    filePath,
    columnMappings,
    enumMappings = {}
  } = importCsvInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  importCsvTableLogger.info({
    table,
    filePath,
    columnMappings,
    enumMappings,
    companyId,
    userId
  });

  const client = ctx.asSystem.supabase;

  // The client is service-role, so the company bucket wrapper is what keeps
  // the caller-supplied path inside the company's own files.
  const csvFile = await storage(client).company(companyId).download(filePath);
  if (!csvFile.data) {
    throw new Error("Failed to download file");
  }
  const csvText = new TextDecoder().decode(
    new Uint8Array(await csvFile.data.arrayBuffer())
  );
  // A row whose field count disagrees with the header falls back to the
  // permissive parser for real-world CSVs with quoting/comma issues.
  const strict = parseCsv<Record<string, string>>(csvText);
  const parsedCsv: Record<string, string>[] = strict.errors.some(
    (e) => e.type === "FieldMismatch"
  )
    ? parsePermissiveCsv(csvText)
    : strict.rows;

  let mappedRecords = parsedCsv.map((row) => {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(columnMappings)) {
      if (key in enumMappings) {
        const enumMapping = enumMappings[key];
        const csvValue = row[value];
        if (csvValue! in enumMapping!) {
          record[key] = enumMapping![csvValue!]!;
        } else {
          record[key] = enumMapping!["Default"]!;
        }
      } else if (value && value !== "N/A") {
        record[key] = row[value] || "";
      }
    }
    return record;
  });

  const missingEnumKeys = Object.keys(enumMappings).filter(
    (key) => !(key in mappedRecords[0]!)
  );

  if (missingEnumKeys.length > 0) {
    mappedRecords = mappedRecords.map((record) => {
      const processedRecord = { ...record };

      missingEnumKeys.forEach((key) => {
        processedRecord[key] = enumMappings[key]!["Default"]!;
      });

      return processedRecord;
    });
  }

  const summary = {
    inserted: 0,
    updated: 0,
    // Rows the user should fix and re-import (validation / missing required data).
    errors: [] as Array<{ row: number; reason: string }>,
    // Rows intentionally not written (duplicates, already-existing) — informational.
    skipped: [] as Array<{ row: number; reason: string }>
  };

  const acceptedRows = await rejectForeignReferences(
    db,
    table,
    mappedRecords,
    companyId,
    summary.errors
  );

  switch (table) {
    case "customer": {
      const externalIdMap = await getCsvExternalIdMap(
        db,
        "customer",
        companyId
      );
      const csvNames = Array.from(
        new Set(
          mappedRecords
            .map((r) => r.name)
            .filter((n): n is string => typeof n === "string" && n !== "")
        )
      );
      const nameMap = await getNameMap(db, "customer", companyId, csvNames);
      const customerIds = new Set<string>();
      // Tracks names queued for INSERT in this batch so a second CSV row
      // with the same name doesn't trip the (name, companyId) unique
      // constraint at flush time. The customer table enforces one record
      // per name per company, so duplicates within the CSV collapse.
      const namesQueuedForInsert = new Set<string>();

      await db.transaction().execute(async (trx) => {
        const customerInserts: Database["public"]["Tables"]["customer"]["Insert"][] =
          [];
        const customerTaxForInserts: Array<{
          taxId: string | null | undefined;
        }> = [];
        const csvIdsForInserts: string[] = [];
        const customerUpdates: {
          id: string;
          data: Database["public"]["Tables"]["customer"]["Update"];
        }[] = [];
        const customerTaxUpdates: Array<{
          entityId: string;
          taxId: string | null | undefined;
        }> = [];
        // Updates matched by name (no pre-existing csv mapping). After the
        // updates run, we add csv mappings for these so the next import takes
        // the externalIdMap path directly.
        const csvIdsForNameMatchedUpdates: Array<{
          entityId: string;
          externalId: string;
        }> = [];
        const extForInserts: PartnerExtensionData[] = [];
        const extForUpdates: Array<{
          entityId: string;
          ext: PartnerExtensionData;
        }> = [];

        for (const [rowIndex, record] of acceptedRows) {
          const ext = extractPartnerExtensions(record);
          const {
            id,
            taxId,
            locationName: _ln,
            addressLine1: _a1,
            addressLine2: _a2,
            city: _city,
            state: _state,
            postalCode: _pc,
            countryCode: _cc,
            paymentTermId: _pt,
            shippingMethodId: _sm,
            incoterm: _ic,
            incotermLocation: _icl,
            ...rest
          } = record;
          const matchedByCsvId = id ? externalIdMap.get(id) : undefined;
          const decision = classifyImportRow({
            id: id!,
            name: rest.name!,
            externalIdMap,
            nameMap,
            seenIds: customerIds,
            seenNames: namesQueuedForInsert
          });

          if (decision.action === "skip") {
            const bucket =
              decision.category === "error" ? summary.errors : summary.skipped;
            bucket.push({ row: rowIndex, reason: decision.reason });
            continue;
          }

          if (id) customerIds.add(id);
          if (decision.action === "insert")
            namesQueuedForInsert.add(rest.name!);

          if (decision.action === "update") {
            customerUpdates.push({
              id: decision.entityId,
              data: {
                ...nullifyEmptyStrings(
                  pickColumns("customer", rest, CUSTOMER_COLUMNS)
                ),
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              }
            });
            customerTaxUpdates.push({ entityId: decision.entityId, taxId });
            extForUpdates.push({ entityId: decision.entityId, ext });
            // Only attach a CSV->entity mapping when there is a real external id.
            if (matchedByCsvId === undefined && id) {
              csvIdsForNameMatchedUpdates.push({
                entityId: decision.entityId,
                externalId: id
              });
            }
          } else {
            customerInserts.push({
              ...nullifyEmptyStrings(
                pickColumns("customer", rest, CUSTOMER_COLUMNS)
              ),
              readableId: (id || null) as string | undefined,
              companyId,
              createdAt: datetime.timestamp(),
              createdBy: userId
            } as Database["public"]["Tables"]["customer"]["Insert"]);
            customerTaxForInserts.push({ taxId });
            csvIdsForInserts.push(id!);
            extForInserts.push(ext);
          }
        }

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          customerInserts: customerInserts.length,
          customerUpdates: customerUpdates.length
        });
        summary.inserted += customerInserts.length;
        summary.updated += customerUpdates.length;

        if (customerInserts.length > 0) {
          const inserted = await inChunks(customerInserts, (rows) =>
            trx.insertInto(table).values(rows).returning(["id"]).execute()
          );
          await upsertCsvMappings(
            trx,
            "customer",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForInserts[i]!
            })),
            companyId,
            userId
          );
          await upsertTaxIdentifiers(
            trx,
            "customerTax",
            inserted.map((row, i) => ({
              entityId: row.id!,
              taxId: customerTaxForInserts[i]?.taxId
            })),
            companyId,
            userId
          );
          for (let i = 0; i < inserted.length; i++) {
            // Newly-inserted customers can't have an existing location yet.
            await writeCustomerExtensions(
              trx,
              inserted[i]!.id!,
              extForInserts[i] ?? {},
              companyId,
              userId,
              undefined
            );
          }
        }
        if (customerUpdates.length > 0) {
          for (const update of customerUpdates) {
            await trx
              .updateTable(table)
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
          await upsertTaxIdentifiers(
            trx,
            "customerTax",
            customerTaxUpdates,
            companyId,
            userId
          );
          const customerAddressByEntity =
            await preloadPrimaryLocationAddressIds(
              trx,
              "customer",
              extForUpdates.map((u) => u.entityId)
            );
          for (const { entityId, ext } of extForUpdates) {
            await writeCustomerExtensions(
              trx,
              entityId,
              ext,
              companyId,
              userId,
              customerAddressByEntity.get(entityId)
            );
          }
        }
        if (csvIdsForNameMatchedUpdates.length > 0) {
          await upsertCsvMappings(
            trx,
            "customer",
            csvIdsForNameMatchedUpdates,
            companyId,
            userId
          );
        }
      });
      break;
    }
    case "supplier": {
      const externalIdMap = await getCsvExternalIdMap(
        db,
        "supplier",
        companyId
      );
      const csvNames = Array.from(
        new Set(
          mappedRecords
            .map((r) => r.name)
            .filter((n): n is string => typeof n === "string" && n !== "")
        )
      );
      const nameMap = await getNameMap(db, "supplier", companyId, csvNames);
      const supplierIds = new Set<string>();
      const namesQueuedForInsert = new Set<string>();

      await db.transaction().execute(async (trx) => {
        const supplierInserts: Database["public"]["Tables"]["supplier"]["Insert"][] =
          [];
        const supplierTaxForInserts: Array<{
          taxId: string | null | undefined;
        }> = [];
        const csvIdsForInserts: string[] = [];
        const supplierUpdates: {
          id: string;
          data: Database["public"]["Tables"]["supplier"]["Update"];
        }[] = [];
        const supplierTaxUpdates: Array<{
          entityId: string;
          taxId: string | null | undefined;
        }> = [];
        const csvIdsForNameMatchedUpdates: Array<{
          entityId: string;
          externalId: string;
        }> = [];
        // Parallel to supplierInserts / supplierUpdates — captures the
        // address/payment/incoterm fields so we can write to side-tables
        // after the parent upsert lands.
        const extForInserts: PartnerExtensionData[] = [];
        const extForUpdates: Array<{
          entityId: string;
          ext: PartnerExtensionData;
        }> = [];

        for (const [rowIndex, record] of acceptedRows) {
          const ext = extractPartnerExtensions(record);
          const {
            id,
            taxId,
            locationName: _ln,
            addressLine1: _a1,
            addressLine2: _a2,
            city: _city,
            state: _state,
            postalCode: _pc,
            countryCode: _cc,
            paymentTermId: _pt,
            shippingMethodId: _sm,
            incoterm: _ic,
            incotermLocation: _icl,
            ...rest
          } = record;
          const matchedByCsvId = id ? externalIdMap.get(id) : undefined;
          const decision = classifyImportRow({
            id: id!,
            name: rest.name!,
            externalIdMap,
            nameMap,
            seenIds: supplierIds,
            seenNames: namesQueuedForInsert
          });

          if (decision.action === "skip") {
            const bucket =
              decision.category === "error" ? summary.errors : summary.skipped;
            bucket.push({ row: rowIndex, reason: decision.reason });
            continue;
          }

          if (id) supplierIds.add(id);
          if (decision.action === "insert")
            namesQueuedForInsert.add(rest.name!);

          if (decision.action === "update") {
            supplierUpdates.push({
              id: decision.entityId,
              data: {
                ...nullifyEmptyStrings(
                  pickColumns("supplier", rest, SUPPLIER_COLUMNS)
                ),
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              }
            });
            supplierTaxUpdates.push({ entityId: decision.entityId, taxId });
            extForUpdates.push({ entityId: decision.entityId, ext });
            // Only attach a CSV->entity mapping when there is a real external id.
            if (matchedByCsvId === undefined && id) {
              csvIdsForNameMatchedUpdates.push({
                entityId: decision.entityId,
                externalId: id
              });
            }
          } else {
            supplierInserts.push({
              ...nullifyEmptyStrings(
                pickColumns("supplier", rest, SUPPLIER_COLUMNS)
              ),
              readableId: (id || null) as string | undefined,
              companyId,
              createdAt: datetime.timestamp(),
              createdBy: userId
            } as Database["public"]["Tables"]["supplier"]["Insert"]);
            supplierTaxForInserts.push({ taxId });
            csvIdsForInserts.push(id!);
            extForInserts.push(ext);
          }
        }

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          supplierInserts: supplierInserts.length,
          supplierUpdates: supplierUpdates.length
        });
        summary.inserted += supplierInserts.length;
        summary.updated += supplierUpdates.length;

        if (supplierInserts.length > 0) {
          const inserted = await inChunks(supplierInserts, (rows) =>
            trx.insertInto(table).values(rows).returning(["id"]).execute()
          );
          await upsertCsvMappings(
            trx,
            "supplier",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForInserts[i]!
            })),
            companyId,
            userId
          );
          await upsertTaxIdentifiers(
            trx,
            "supplierTax",
            inserted.map((row, i) => ({
              entityId: row.id!,
              taxId: supplierTaxForInserts[i]?.taxId
            })),
            companyId,
            userId
          );
          for (let i = 0; i < inserted.length; i++) {
            // Newly-inserted suppliers can't have an existing location yet.
            await writeSupplierExtensions(
              trx,
              inserted[i]!.id!,
              extForInserts[i] ?? {},
              companyId,
              userId,
              undefined
            );
          }
        }
        if (supplierUpdates.length > 0) {
          for (const update of supplierUpdates) {
            await trx
              .updateTable(table)
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
          await upsertTaxIdentifiers(
            trx,
            "supplierTax",
            supplierTaxUpdates,
            companyId,
            userId
          );
          const supplierAddressByEntity =
            await preloadPrimaryLocationAddressIds(
              trx,
              "supplier",
              extForUpdates.map((u) => u.entityId)
            );
          for (const { entityId, ext } of extForUpdates) {
            await writeSupplierExtensions(
              trx,
              entityId,
              ext,
              companyId,
              userId,
              supplierAddressByEntity.get(entityId)
            );
          }
        }
        if (csvIdsForNameMatchedUpdates.length > 0) {
          await upsertCsvMappings(
            trx,
            "supplier",
            csvIdsForNameMatchedUpdates,
            companyId,
            userId
          );
        }
      });
      break;
    }
    case "material":
    case "consumable":
    case "tool":
    case "fixture":
    case "service":
    case "part": {
      const getExternalId = (id: string) => {
        return `${table}:${id}`;
      };

      // A service can never be shipped, received or stocked. The wizard
      // therefore offers neither a Tracking Type nor a Default Method column
      // for one: the validator below requires a tracking type, and the method
      // is fully determined by the replenishment system — "Pull from
      // Inventory" is not valid for a Non-Inventory item, and an independent
      // column could contradict the replenishment system on the same row.
      // `ServiceForm` derives both the same way and hides the method field.
      // A service is identified by its name: the wizard offers no Service ID,
      // Revision or Unit of Measure column — the name is its readable id and
      // its unit is Each, as in `upsertService`.
      if (table === "service") {
        for (const record of mappedRecords) {
          // A missing name stays undefined, so validation reports it.
          const name = record.name?.trim() as string;
          record.name = name;
          record.readableId = name;
          record.revision = "0";
          record.unitOfMeasureCode = "EA";
          record.itemTrackingType = "Non-Inventory";
          record.defaultMethodType =
            record.replenishmentSystem === "Make"
              ? "Make to Order"
              : "Purchase to Order";
        }
      }

      const externalIdMap = await getCsvExternalIdMap(db, "item", companyId);
      const readableIds = new Set();

      await db.transaction().execute(async (trx) => {
        const itemInserts: Database["public"]["Tables"]["item"]["Insert"][] =
          [];
        const csvIdsForInserts: string[] = [];
        const itemUpdates: {
          id: string;
          data: Database["public"]["Tables"]["item"]["Update"];
        }[] = [];
        const materialPartialInserts: Record<
          string,
          Database["public"]["Tables"]["material"]["Insert"]
        > = {};

        const materialUpdates: {
          id: string;
          data: Database["public"]["Tables"]["material"]["Update"];
        }[] = [];

        // Optional supplier-part fields ride along on each row. Parallel to
        // itemInserts; supplierPartLinks accumulates the full resolved
        // links (with the item's actual DB id) as the inserts/updates land.
        const supplierPartForInserts: Array<{
          supplierId?: string;
          supplierPartId?: string;
          supplierUnitOfMeasureCode?: string;
          minimumOrderQuantity?: string;
          orderMultiple?: string;
          conversionFactor?: string;
          unitPrice?: string;
        }> = [];
        const supplierPartLinks: SupplierPartImportLink[] = [];
        // Item-level purchasing lead times. leadTimeForInserts is parallel to
        // itemInserts (filled in the insert branch); purchasingLeadTimes
        // collects the final {itemId, leadTime} entries once item ids are
        // known (immediately for updates, post-insert for new items).
        const leadTimeForInserts: Array<string | undefined> = [];
        const purchasingLeadTimes: ItemPurchasingLeadTime[] = [];
        // Item-level unit cost — same parallel-array pattern as lead time.
        const unitCostForInserts: Array<string | undefined> = [];
        const itemUnitCosts: ItemUnitCost[] = [];
        // Same shape for the item-level planning order multiple. CSV's
        // "Order Multiple" column populates both supplierPart.orderMultiple
        // (per-supplier case-pack) and itemPlanning.orderMultiple
        // (per-(item, location) MRP setting) at import time.
        const orderMultipleForInserts: Array<string | undefined> = [];
        const itemPlanningOrderMultiples: ItemPlanningOrderMultiple[] = [];

        const itemValidator = z.object({
          // Unique ID is the external-integration mapping key and the upsert
          // key (externalIdMap), so a blank one is broken data, not a new row.
          // Part Number / Description are likewise required for a usable item.
          id: z.string().min(1, { message: "Unique ID is required" }),
          readableId: z.string().min(1, {
            // A service's readable id is its name (set above).
            message:
              table === "service"
                ? "Name is required"
                : "Part Number is required"
          }),
          revision: z.string().optional(),
          name: z.string().min(1, { message: "Description is required" }),
          description: z.string().optional(),
          mpn: z.string().optional(),
          active: z.string().optional(),
          unitOfMeasureCode: z.string().optional(),
          replenishmentSystem: z
            .enum(["Buy", "Make", "Buy and Make"])
            .optional(),
          defaultMethodType: z
            .enum(["Purchase to Order", "Make to Order", "Pull from Inventory"])
            .optional(),
          itemTrackingType: z.enum([
            "Inventory",
            "Non-Inventory",
            "Serial",
            "Batch"
          ])
        });

        const materialValidator = itemValidator.extend({
          materialSubstanceId: z.string().optional(),
          materialFormId: z.string().optional(),
          finishId: z.string().optional(),
          dimensionId: z.string().optional(),
          gradeId: z.string().optional(),
          // Raw text from the mapping UI; resolved to the *Id columns below.
          finish: z.string().optional(),
          grade: z.string().optional(),
          dimensions: z.string().optional()
        });

        // The mapping UI sends Finish / Grade / Dimensions as raw CSV text —
        // materialFinish/materialGrade are scoped by substance and
        // materialDimension by form, so a flat enum mapping can't target
        // them. Resolve the text to taxonomy ids up front (creating
        // company-scoped rows for unmatched names). Rows without a resolved
        // substance/form keep the attribute unset, since the taxonomy
        // tables require the scope.
        let finishIdByKey = new Map<string, string>();
        let gradeIdByKey = new Map<string, string>();
        let dimensionIdByKey = new Map<string, string>();

        if (table === "material") {
          const finishPairs: Array<{ scopeId: string; name: string }> = [];
          const gradePairs: Array<{ scopeId: string; name: string }> = [];
          const dimensionPairs: Array<{ scopeId: string; name: string }> = [];

          // Rejected rows are left out: one may name another company's
          // substance or form, and resolving it would create taxonomy rows
          // under that parent.
          for (const [, record] of acceptedRows) {
            const substanceId = record.materialSubstanceId;
            const formId = record.materialFormId;
            // An explicit *Id (possible via direct invocation) wins over the
            // raw text, so don't resolve — and possibly create — a taxonomy
            // row that nothing would reference.
            if (substanceId && record.finish && !record.finishId) {
              finishPairs.push({ scopeId: substanceId, name: record.finish });
            }
            if (substanceId && record.grade && !record.gradeId) {
              gradePairs.push({ scopeId: substanceId, name: record.grade });
            }
            if (formId && record.dimensions && !record.dimensionId) {
              dimensionPairs.push({
                scopeId: formId,
                name: record.dimensions
              });
            }
          }

          finishIdByKey = await resolveMaterialTaxonomyIds(
            trx,
            "materialFinish",
            "materialSubstanceId",
            finishPairs,
            companyId
          );
          gradeIdByKey = await resolveMaterialTaxonomyIds(
            trx,
            "materialGrade",
            "materialSubstanceId",
            gradePairs,
            companyId
          );
          dimensionIdByKey = await resolveMaterialTaxonomyIds(
            trx,
            "materialDimension",
            "materialFormId",
            dimensionPairs,
            companyId
          );
        }

        const resolveFinishId = (data: {
          materialSubstanceId?: string;
          finish?: string;
        }) =>
          data.materialSubstanceId && data.finish
            ? finishIdByKey.get(
                materialTaxonomyKey(data.materialSubstanceId, data.finish)
              )
            : undefined;

        const resolveGradeId = (data: {
          materialSubstanceId?: string;
          grade?: string;
        }) =>
          data.materialSubstanceId && data.grade
            ? gradeIdByKey.get(
                materialTaxonomyKey(data.materialSubstanceId, data.grade)
              )
            : undefined;

        const resolveDimensionId = (data: {
          materialFormId?: string;
          dimensions?: string;
        }) =>
          data.materialFormId && data.dimensions
            ? dimensionIdByKey.get(
                materialTaxonomyKey(data.materialFormId, data.dimensions)
              )
            : undefined;

        // Rows on the INSERT path whose Unique ID already exists in this
        // company's catalog (e.g. a re-import after the item was deleted,
        // which frees the Unique ID to collide on the un-onConflict'd
        // sub-table inserts) would otherwise abort the whole transaction with
        // an opaque 500. Detect them up front so we can report a clear per-row
        // reason and skip just those rows while the rest still import.
        const candidateReadableIds = [
          ...new Set(
            mappedRecords
              .map((r) => r.readableId)
              .filter((id): id is string => !!id && id.trim() !== "")
          )
        ];
        // readable id with revision → item id, so an update can tell its own
        // key from another item's.
        const existingItemKeys = new Map<string, string>();
        if (candidateReadableIds.length > 0) {
          const existingItems = await trx
            .selectFrom("item")
            .select(["id", "readableId", "revision"])
            .where("companyId", "=", companyId)
            .where(
              "type",
              "=",
              capitalize(table) as
                | "Part"
                | "Service"
                | "Material"
                | "Tool"
                | "Fixture"
                | "Consumable"
            )
            .where("readableId", "in", candidateReadableIds)
            .execute();
          for (const existing of existingItems) {
            existingItemKeys.set(
              getReadableIdWithRevision(existing.readableId, existing.revision),
              existing.id
            );
          }
        }

        for (const [rowIndex, record] of acceptedRows) {
          const item = itemValidator.safeParse(record);

          if (!item.success) {
            summary.errors.push({
              row: rowIndex,
              reason: item.error.issues[0]?.message ?? "Invalid row"
            });
            continue;
          }

          const { id, ...rest } = item.data;
          // A blank Revision cell arrives as "" — not undefined — so the
          // `??` this replaced let it through and the item landed with an
          // empty revision instead of the "0" the wizard advertises as the
          // default. (Unreachable until the route stopped stripping the
          // field, which made `rest.revision` genuinely present-but-empty.)
          // Normalize once, before the dedup key is built from it, so the
          // key and the stored value cannot disagree.
          const revision = rest.revision || "0";
          const readableIdWithRevision = getReadableIdWithRevision(
            item.data.readableId,
            revision
          );

          if (
            externalIdMap.has(getExternalId(id)) &&
            !readableIds.has(readableIdWithRevision)
          ) {
            const existingEntityId = externalIdMap.get(getExternalId(id))!;

            readableIds.add(readableIdWithRevision);
            // Renaming onto another item's readable id would violate
            // item_unique and abort the whole import; refuse just this row.
            const owner = existingItemKeys.get(readableIdWithRevision);
            if (owner && owner !== existingEntityId) {
              summary.errors.push({
                row: rowIndex,
                reason:
                  table === "service"
                    ? `A service named "${item.data.readableId}" already exists.`
                    : `An item with Unique ID "${item.data.readableId}" already exists.`
              });
              continue;
            }
            itemUpdates.push({
              id: existingEntityId,
              data: {
                ...rest,
                revision,
                active: rest.active?.toLowerCase() !== "false",
                unitOfMeasureCode: rest.unitOfMeasureCode || undefined,
                description: rest.description || undefined,
                replenishmentSystem: rest.replenishmentSystem || undefined,
                defaultMethodType: rest.defaultMethodType || undefined,
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              }
            });

            // Existing item: we already know its id, so the supplierPart
            // link can be queued directly.
            if (record.supplierId) {
              supplierPartLinks.push({
                itemId: existingEntityId,
                supplierId: record.supplierId,
                supplierPartId: record.supplierPartId,
                supplierUnitOfMeasureCode: record.supplierUnitOfMeasureCode,
                minimumOrderQuantity: record.minimumOrderQuantity,
                orderMultiple: record.orderMultiple,
                conversionFactor: record.conversionFactor,
                unitPrice: record.unitPrice
              });
            }

            if (record.leadTime) {
              purchasingLeadTimes.push({
                itemId: existingEntityId,
                leadTime: record.leadTime
              });
            }

            if (record.unitCost) {
              itemUnitCosts.push({
                itemId: existingEntityId,
                unitCost: record.unitCost
              });
            }

            if (record.orderMultiple) {
              itemPlanningOrderMultiples.push({
                itemId: existingEntityId,
                orderMultiple: record.orderMultiple
              });
            }

            if (table === "material") {
              const material = materialValidator.safeParse(record);
              if (material.success) {
                materialUpdates.push({
                  id: material.data.readableId,
                  data: {
                    materialSubstanceId:
                      material.data.materialSubstanceId || undefined,
                    materialFormId: material.data.materialFormId || undefined,
                    dimensionId:
                      material.data.dimensionId ||
                      resolveDimensionId(material.data) ||
                      undefined,
                    gradeId:
                      material.data.gradeId ||
                      resolveGradeId(material.data) ||
                      undefined,
                    finishId:
                      material.data.finishId ||
                      resolveFinishId(material.data) ||
                      undefined,
                    companyId,
                    updatedAt: datetime.timestamp(),
                    updatedBy: userId
                  }
                });
              }
            }
          } else if (!readableIds.has(readableIdWithRevision)) {
            readableIds.add(readableIdWithRevision);
            if (existingItemKeys.has(readableIdWithRevision)) {
              summary.errors.push({
                row: rowIndex,
                reason:
                  table === "service"
                    ? `A service named "${item.data.readableId}" already exists. Change the Name or delete the existing service, then re-import.`
                    : `An item with Unique ID "${item.data.readableId}" already exists. Change the Unique ID (and Name) or delete the existing item, then re-import.`
              });
              continue;
            }
            const newItem = {
              ...rest,
              replenishmentSystem: rest.replenishmentSystem ?? "Buy",
              active: rest.active?.toLowerCase() !== "false",
              unitOfMeasureCode: rest.unitOfMeasureCode || undefined,
              description: rest.description || undefined,
              defaultMethodType: rest.defaultMethodType || undefined,
              type: capitalize(table) as
                | "Part"
                | "Service"
                | "Material"
                | "Tool"
                | "Fixture"
                | "Consumable",
              companyId,
              revision,
              createdAt: datetime.timestamp(),
              createdBy: userId
            };
            itemInserts.push(newItem);
            csvIdsForInserts.push(getExternalId(id));
            // New item: id will come back from the bulk insert. Capture
            // supplier-part data and lead time in parallel arrays so we can
            // build the link / lead-time entry once the id is known.
            supplierPartForInserts.push({
              supplierId: record.supplierId,
              supplierPartId: record.supplierPartId,
              supplierUnitOfMeasureCode: record.supplierUnitOfMeasureCode,
              minimumOrderQuantity: record.minimumOrderQuantity,
              orderMultiple: record.orderMultiple,
              conversionFactor: record.conversionFactor,
              unitPrice: record.unitPrice
            });
            leadTimeForInserts.push(record.leadTime);
            orderMultipleForInserts.push(record.orderMultiple);
            unitCostForInserts.push(record.unitCost);

            if (table === "material") {
              const material = materialValidator.safeParse(record);
              if (!material.success) {
                summary.errors.push({
                  row: rowIndex,
                  reason:
                    material.error.issues[0]?.message ?? "Invalid material row"
                });
                continue;
              }
              if (material.success) {
                materialPartialInserts[material.data.readableId!] = {
                  ...material.data,
                  id: material.data.readableId,
                  dimensionId:
                    material.data.dimensionId ||
                    resolveDimensionId(material.data),
                  gradeId:
                    material.data.gradeId || resolveGradeId(material.data),
                  finishId:
                    material.data.finishId || resolveFinishId(material.data),
                  companyId,
                  createdAt: datetime.timestamp(),
                  createdBy: userId
                };
              }
            }
          }
        }

        if (itemInserts.length > 0) {
          const insertedItems = await inChunks(itemInserts, (rows) =>
            trx
              .insertInto("item")
              .values(rows)
              .onConflict((oc) =>
                oc.constraint("item_unique").doUpdateSet({
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId,
                  name: sql`EXCLUDED."name"`,
                  description: sql`EXCLUDED."description"`,
                  mpn: sql`EXCLUDED."mpn"`,
                  active: sql`EXCLUDED."active"`,
                  unitOfMeasureCode: sql`EXCLUDED."unitOfMeasureCode"`,
                  replenishmentSystem: sql`EXCLUDED."replenishmentSystem"`,
                  defaultMethodType: sql`EXCLUDED."defaultMethodType"`,
                  itemTrackingType: sql`EXCLUDED."itemTrackingType"`
                })
              )
              .returning(["id", "readableId"])
              .execute()
          );

          await upsertCsvMappings(
            trx,
            "item",
            insertedItems.map((item, i) => ({
              entityId: item.id!,
              externalId: csvIdsForInserts[i]!
            })),
            companyId,
            userId
          );

          if (
            ["part", "fixture", "tool", "consumable", "service"].includes(table)
          ) {
            const specificInserts = insertedItems.map((item) => ({
              id: item.readableId,
              // `service` has its own `approved` default and a legacy
              // NOT NULL `serviceType` the UI no longer surfaces —
              // `upsertService` writes "External" for the same reason.
              ...(table === "service"
                ? { serviceType: "External" }
                : { approved: true }),
              companyId,
              createdAt: datetime.timestamp(),
              createdBy: userId
            }));

            await inChunks(specificInserts, (rows) =>
              trx
                .insertInto(table)
                .values(rows as unknown as never)
                // Hard-deleting an item does NOT remove its type row: the type
                // tables (part/tool/fixture/consumable) key on readableId and have
                // no FK back to item, so the row is orphaned by (id, companyId).
                // Re-importing that Part Number would otherwise collide on the PK
                // and abort the whole import (the "deleted then re-imported and it
                // failed" case). The orphan already represents this Part Number, so
                // keep it.
                .onConflict((oc: any) =>
                  oc.columns(["id", "companyId"]).doNothing()
                )
                .execute()
            );
          }

          if (
            table === "material" &&
            Object.keys(materialPartialInserts).length > 0
          ) {
            const materialInserts = insertedItems.reduce<
              Database["public"]["Tables"]["material"]["Insert"][]
            >((acc, item) => {
              const materialData = materialPartialInserts[item.readableId];
              if (materialData) {
                acc.push({
                  id: item.readableId,
                  materialSubstanceId:
                    materialData.materialSubstanceId || undefined,
                  materialFormId: materialData.materialFormId || undefined,
                  dimensionId: materialData.dimensionId || undefined,
                  gradeId: materialData.gradeId || undefined,
                  finishId: materialData.finishId || undefined,
                  companyId,
                  createdAt: datetime.timestamp(),
                  createdBy: userId
                });
              }
              return acc;
            }, []);

            await inChunks(materialInserts, (rows) =>
              trx
                .insertInto("material")
                .values(rows)
                // Same orphan-after-delete case as the type insert above: the
                // material row survives an item delete, so re-import must not
                // collide on the (id, companyId) PK.
                .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
                .execute()
            );
          }

          // Build supplier-part links and lead-time entries for the items we
          // just inserted. supplierPartForInserts / leadTimeForInserts are
          // parallel to itemInserts; only rows with a supplier produce a
          // link, only rows with a lead time produce a lead-time entry.
          for (let i = 0; i < insertedItems.length; i++) {
            const sp = supplierPartForInserts[i];
            if (sp?.supplierId && insertedItems[i]!.id) {
              supplierPartLinks.push({
                itemId: insertedItems[i]!.id!,
                supplierId: sp.supplierId,
                supplierPartId: sp.supplierPartId,
                supplierUnitOfMeasureCode: sp.supplierUnitOfMeasureCode,
                minimumOrderQuantity: sp.minimumOrderQuantity,
                orderMultiple: sp.orderMultiple,
                conversionFactor: sp.conversionFactor,
                unitPrice: sp.unitPrice
              });
            }
            const leadTime = leadTimeForInserts[i];
            if (leadTime && insertedItems[i]!.id) {
              purchasingLeadTimes.push({
                itemId: insertedItems[i]!.id!,
                leadTime
              });
            }
            const orderMultiple = orderMultipleForInserts[i];
            if (orderMultiple && insertedItems[i]!.id) {
              itemPlanningOrderMultiples.push({
                itemId: insertedItems[i]!.id!,
                orderMultiple
              });
            }
            const unitCost = unitCostForInserts[i];
            if (unitCost && insertedItems[i]!.id) {
              itemUnitCosts.push({
                itemId: insertedItems[i]!.id!,
                unitCost
              });
            }
          }
        }

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          itemInserts: itemInserts.length,
          itemUpdates: itemUpdates.length,
          materialInserts: Object.keys(materialPartialInserts).length,
          materialUpdates: materialUpdates.length
        });

        if (itemUpdates.length > 0) {
          const currentItems = await trx
            .selectFrom("item")
            .select(["id", "readableId"])
            .where(
              "id",
              "in",
              itemUpdates.map((u) => u.id)
            )
            .execute();
          const currentReadableIdMap = new Map(
            currentItems.map((i) => [i.id, i.readableId])
          );

          for (const update of itemUpdates) {
            await trx
              .updateTable("item")
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }

          for (const update of itemUpdates) {
            const oldReadableId = currentReadableIdMap.get(update.id);
            const newReadableId = update.data.readableId;
            if (
              newReadableId &&
              oldReadableId &&
              oldReadableId !== newReadableId
            ) {
              await trx
                .updateTable(table)
                .set({ id: newReadableId } as never)
                .where("id", "=", oldReadableId)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          if (materialUpdates.length > 0) {
            for (const update of materialUpdates) {
              await trx
                .updateTable("material")
                .set(update.data)
                .where("id", "=", update.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }
        }

        await writeSupplierPartLinks(trx, supplierPartLinks, companyId, userId);

        await writeItemPurchasingLeadTimes(
          trx,
          purchasingLeadTimes,
          companyId,
          userId
        );

        await writeItemPlanningOrderMultiples(
          trx,
          itemPlanningOrderMultiples,
          companyId,
          userId
        );

        await writeItemUnitCosts(trx, itemUnitCosts, companyId, userId);

        // Items were silently uncounted before — only customer/supplier
        // incremented the summary. Count inserts/updates here so the toast
        // reports the real totals instead of "Imported 0, Updated 0".
        summary.inserted += itemInserts.length;
        summary.updated += itemUpdates.length;
      });

      break;
    }
    case "customerContact": {
      const externalContactIdMap = await getCsvExternalIdMap(
        db,
        "contact",
        companyId
      );
      const externalCustomerIdMap = await getCsvExternalIdMap(
        db,
        "customer",
        companyId
      );

      await db.transaction().execute(async (trx) => {
        const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
          [];
        const csvIdsForContactInserts: string[] = [];
        const contactUpdates: {
          id: string;
          data: Database["public"]["Tables"]["contact"]["Update"];
        }[] = [];
        const customerContactInserts: Database["public"]["Tables"]["customerContact"]["Insert"][] =
          [];

        const isContactValid = (record: {
          email?: string | null;
        }): record is {
          email: string;
        } => {
          return typeof record.email === "string" && record.email.trim() !== "";
        };

        for (const [rowIndex, record] of mappedRecords.entries()) {
          // `companyId` here is the parent's External Company ID; only
          // contact columns are written.
          const { id, companyId: customerId } = record;
          const contactData = pickColumns("contact", record, CONTACT_COLUMNS);

          if (externalContactIdMap.has(id!)) {
            const existingEntityId = externalContactIdMap.get(id!)!;
            if (isContactValid(contactData)) {
              contactUpdates.push({
                id: existingEntityId,
                data: {
                  ...contactData
                }
              });
            }
          } else if (
            isContactValid(contactData) &&
            externalCustomerIdMap.has(customerId!)
          ) {
            const existingCustomerId = externalCustomerIdMap.get(customerId!)!;
            const contactId = nanoid();
            const newContact = {
              id: contactId,
              ...contactData,
              companyId
            };

            contactInserts.push(newContact);
            csvIdsForContactInserts.push(id!);
            customerContactInserts.push({
              contactId,
              customerId: existingCustomerId,
              companyId,
              customFields: {}
            });
          } else {
            summary.errors.push({
              row: rowIndex,
              reason: isContactValid(contactData)
                ? `No customer found for External Company ID "${customerId}"`
                : "Invalid contact (missing required fields)"
            });
          }
        }

        summary.inserted += contactInserts.length;
        summary.updated += contactUpdates.length;

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          contactInserts: contactInserts.length,
          contactUpdates: contactUpdates.length,
          customerContactInserts: customerContactInserts.length
        });

        if (contactInserts.length > 0) {
          const inserted = await inChunks(contactInserts, (rows) =>
            trx.insertInto("contact").values(rows).returning(["id"]).execute()
          );
          await upsertCsvMappings(
            trx,
            "contact",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForContactInserts[i]!
            })),
            companyId,
            userId
          );
        }

        if (contactUpdates.length > 0) {
          for (const update of contactUpdates) {
            await trx
              .updateTable("contact")
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        if (customerContactInserts.length > 0) {
          await inChunks(customerContactInserts, (rows) =>
            trx.insertInto("customerContact").values(rows).execute()
          );
        }
      });

      break;
    }
    case "supplierContact": {
      const externalContactIdMap = await getCsvExternalIdMap(
        db,
        "contact",
        companyId
      );
      const externalSupplierIdMap = await getCsvExternalIdMap(
        db,
        "supplier",
        companyId
      );

      await db.transaction().execute(async (trx) => {
        const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
          [];
        const csvIdsForContactInserts: string[] = [];
        const contactUpdates: {
          id: string;
          data: Database["public"]["Tables"]["contact"]["Update"];
        }[] = [];
        const supplierContactInserts: Database["public"]["Tables"]["supplierContact"]["Insert"][] =
          [];

        const isContactValid = (record: {
          email?: string | null;
        }): record is {
          email: string;
        } => {
          return typeof record.email === "string" && record.email.trim() !== "";
        };

        for (const [rowIndex, record] of mappedRecords.entries()) {
          // `companyId` here is the parent's External Company ID; only
          // contact columns are written.
          const { id, companyId: supplierId } = record;
          const contactData = pickColumns("contact", record, CONTACT_COLUMNS);

          if (externalContactIdMap.has(id!)) {
            const existingEntityId = externalContactIdMap.get(id!)!;
            if (isContactValid(contactData)) {
              contactUpdates.push({
                id: existingEntityId,
                data: {
                  ...contactData
                }
              });
            }
          } else if (
            isContactValid(contactData) &&
            externalSupplierIdMap.has(supplierId!)
          ) {
            const existingSupplierId = externalSupplierIdMap.get(supplierId!)!;
            const contactId = nanoid();
            const newContact = {
              id: contactId,
              ...contactData,
              companyId
            };
            contactInserts.push(newContact);
            csvIdsForContactInserts.push(id!);
            supplierContactInserts.push({
              contactId,
              supplierId: existingSupplierId,
              companyId,
              customFields: {}
            });
          } else {
            summary.errors.push({
              row: rowIndex,
              reason: isContactValid(contactData)
                ? `No supplier found for External Company ID "${supplierId}"`
                : "Invalid contact (missing required fields)"
            });
          }
        }

        summary.inserted += contactInserts.length;
        summary.updated += contactUpdates.length;

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          contactInserts: contactInserts.length,
          contactUpdates: contactUpdates.length,
          supplierContactInserts: supplierContactInserts.length
        });

        if (contactInserts.length > 0) {
          const inserted = await inChunks(contactInserts, (rows) =>
            trx.insertInto("contact").values(rows).returning(["id"]).execute()
          );
          await upsertCsvMappings(
            trx,
            "contact",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForContactInserts[i]!
            })),
            companyId,
            userId
          );
        }

        if (contactUpdates.length > 0) {
          for (const update of contactUpdates) {
            await trx
              .updateTable("contact")
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        if (supplierContactInserts.length > 0) {
          await inChunks(supplierContactInserts, (rows) =>
            trx.insertInto("supplierContact").values(rows).execute()
          );
        }
      });

      break;
    }
    case "workCenter": {
      const externalIdMap = await getCsvExternalIdMap(
        db,
        "workCenter",
        companyId
      );
      const workCenterIds = new Set();

      await db.transaction().execute(async (trx) => {
        const workCenterInserts: Database["public"]["Tables"]["workCenter"]["Insert"][] =
          [];
        const csvIdsForInserts: string[] = [];
        const workCenterUpdates: {
          id: string;
          data: Database["public"]["Tables"]["workCenter"]["Update"];
        }[] = [];

        const isWorkCenterValid = (
          record: Record<string, string>
        ): record is Record<string, string> & {
          name: string;
          locationId: string;
        } => {
          return (
            typeof record.name === "string" &&
            record.name.trim() !== "" &&
            typeof record.locationId === "string" &&
            record.locationId.trim() !== ""
          );
        };

        for (const [, record] of acceptedRows) {
          const { id, ...rest } = record;
          if (externalIdMap.has(id!)) {
            const existingEntityId = externalIdMap.get(id!)!;
            if (isWorkCenterValid(rest) && !workCenterIds.has(id)) {
              workCenterIds.add(id);
              workCenterUpdates.push({
                id: existingEntityId,
                data: {
                  ...pickColumns("workCenter", rest, WORK_CENTER_COLUMNS),
                  laborRate: rest.laborRate ? parseFloat(rest.laborRate) : 0,
                  machineRate: rest.machineRate
                    ? parseFloat(rest.machineRate)
                    : 0,
                  overheadRate: rest.overheadRate
                    ? parseFloat(rest.overheadRate)
                    : 0,
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                }
              });
            }
          } else if (isWorkCenterValid(rest) && !workCenterIds.has(id)) {
            workCenterIds.add(id);
            workCenterInserts.push({
              ...pickColumns("workCenter", rest, WORK_CENTER_COLUMNS),
              laborRate: rest.laborRate ? parseFloat(rest.laborRate) : 0,
              machineRate: rest.machineRate ? parseFloat(rest.machineRate) : 0,
              overheadRate: rest.overheadRate
                ? parseFloat(rest.overheadRate)
                : 0,
              companyId,
              createdAt: datetime.timestamp(),
              createdBy: userId
            } as never);
            csvIdsForInserts.push(id!);
          }
        }

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          workCenterInserts: workCenterInserts.length,
          workCenterUpdates: workCenterUpdates.length
        });

        if (workCenterInserts.length > 0) {
          const inserted = await inChunks(workCenterInserts, (rows) =>
            trx
              .insertInto("workCenter")
              .values(rows)
              .returning(["id"])
              .execute()
          );
          await upsertCsvMappings(
            trx,
            "workCenter",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForInserts[i]!
            })),
            companyId,
            userId
          );
        }
        if (workCenterUpdates.length > 0) {
          for (const update of workCenterUpdates) {
            await trx
              .updateTable("workCenter")
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      });
      break;
    }
    case "process": {
      const externalIdMap = await getCsvExternalIdMap(db, "process", companyId);
      const processIds = new Set();

      await db.transaction().execute(async (trx) => {
        const processInserts: Database["public"]["Tables"]["process"]["Insert"][] =
          [];
        const csvIdsForInserts: string[] = [];
        const processUpdates: {
          id: string;
          data: Database["public"]["Tables"]["process"]["Update"];
        }[] = [];

        // Legacy CSV templates may still use the old Inside/Outside process types.
        const normalizeProcessType = (value: string) =>
          (value === "Inside"
            ? "Process"
            : value === "Outside" || value === "Inside and Outside"
              ? "Outside Processing"
              : value) as Database["public"]["Enums"]["operationType"];

        const validProcessTypes = [
          "Process",
          "Assembly",
          "Inspection",
          "Outside Processing"
        ];

        const isProcessValid = (
          record: Record<string, string>
        ): record is Record<string, string> & {
          name: string;
          processType: string;
        } => {
          return (
            typeof record.name === "string" &&
            record.name.trim() !== "" &&
            typeof record.processType === "string" &&
            validProcessTypes.includes(normalizeProcessType(record.processType))
          );
        };

        for (const record of mappedRecords) {
          const { id, ...rest } = record;
          if (externalIdMap.has(id!)) {
            const existingEntityId = externalIdMap.get(id!)!;
            if (isProcessValid(rest) && !processIds.has(id)) {
              processIds.add(id);
              processUpdates.push({
                id: existingEntityId,
                data: {
                  ...pickColumns("process", rest, PROCESS_COLUMNS),
                  processType: normalizeProcessType(rest.processType),
                  completeAllOnScan:
                    rest.completeAllOnScan?.toLowerCase() === "true",
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                }
              });
            }
          } else if (isProcessValid(rest) && !processIds.has(id)) {
            processIds.add(id);
            processInserts.push({
              ...pickColumns("process", rest, PROCESS_COLUMNS),
              processType: normalizeProcessType(rest.processType),
              completeAllOnScan:
                rest.completeAllOnScan?.toLowerCase() === "true",
              companyId,
              createdAt: datetime.timestamp(),
              createdBy: userId
            } as never);
            csvIdsForInserts.push(id!);
          }
        }

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          processInserts: processInserts.length,
          processUpdates: processUpdates.length
        });

        if (processInserts.length > 0) {
          const inserted = await inChunks(processInserts, (rows) =>
            trx.insertInto("process").values(rows).returning(["id"]).execute()
          );
          await upsertCsvMappings(
            trx,
            "process",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForInserts[i]!
            })),
            companyId,
            userId
          );
        }
        if (processUpdates.length > 0) {
          for (const update of processUpdates) {
            await trx
              .updateTable("process")
              .set(update.data)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      });
      break;
    }
    case "storageUnit": {
      const externalIdMap = await getCsvExternalIdMap(
        db,
        "storageUnit",
        companyId
      );
      // Entities that already carry a csv mapping. externalIntegrationMapping
      // is unique on (entityType, entityId, integration, companyId) — ONE
      // external id per entity — so a name-matched update must NOT attach a
      // second external id to an entity that already has one (it would violate
      // that index and roll back the whole import).
      const alreadyMappedEntityIds = new Set(externalIdMap.values());

      // Stored location of each already-mapped entity. A csv-id match that
      // resolves to a unit in a DIFFERENT location than the row states is a
      // conflict, not a move — used below to reject it instead of silently
      // renaming the wrong unit or crashing on storageUnit_name_locationId_key.
      const mappedEntityIds = Array.from(alreadyMappedEntityIds);
      const entityLocation = new Map<string, string>(
        (mappedEntityIds.length > 0
          ? await db
              .selectFrom("storageUnit")
              .select(["id", "locationId"])
              .where("id", "in", mappedEntityIds)
              .execute()
          : []
        ).map((r) => [r.id, r.locationId])
      );

      // Storage unit names are unique per location
      // (storageUnit_name_locationId_key), so the natural key for both in-file
      // dedup and match-existing-to-update is (locationId + lowercased name).
      const naturalKey = (locationId: string, name: string) =>
        `${locationId}::${name.trim().toLowerCase()}`;

      // Preload existing units for the referenced locations so a name that
      // already exists updates instead of tripping the unique constraint, and
      // so parent references can resolve against pre-existing units.
      const referencedLocationIds = Array.from(
        new Set(
          mappedRecords
            .map((r) => r.locationId)
            .filter(
              (l): l is string => typeof l === "string" && l.trim() !== ""
            )
        )
      );
      const existingUnits =
        referencedLocationIds.length > 0
          ? await db
              .selectFrom("storageUnit")
              .select(["id", "name", "locationId"])
              .where("companyId", "=", companyId)
              .where("locationId", "in", referencedLocationIds)
              .execute()
          : [];
      // (locationId + lowercased name) -> storageUnit id. Grows as we insert,
      // so a child whose parent is defined later in the same file resolves.
      const naturalKeyMap = new Map<string, string>();
      for (const u of existingUnits) {
        naturalKeyMap.set(naturalKey(u.locationId, u.name), u.id);
      }

      // Preload existing storage types (lowercased name -> id). Unmatched
      // names create a company-scoped storageType, mirroring the creatable
      // StorageTypes combobox on the storage-unit form.
      const existingTypes = await db
        .selectFrom("storageType")
        .select(["id", "name"])
        .where("companyId", "=", companyId)
        .execute();
      const storageTypeByName = new Map<string, string>();
      for (const st of existingTypes) {
        storageTypeByName.set(st.name.trim().toLowerCase(), st.id);
      }

      const parseActive = (value: string | undefined): boolean => {
        const v = (value ?? "").trim().toLowerCase();
        // Default active; only explicit falsey values deactivate.
        return !["false", "no", "0", "inactive", "n"].includes(v);
      };
      const parseTypeNames = (value: string | undefined): string[] =>
        (value ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");

      const seenNaturalKeys = new Set<string>();
      const seenCsvIds = new Set<string>();
      // Parent links are applied in a second pass (after all inserts) so a
      // parent defined later in the same file resolves and a bad parent
      // reports a row error instead of rolling back the whole import.
      const parentIntents: Array<{
        locationId: string;
        childKey: string;
        parentName: string;
        rowIndex: number;
      }> = [];

      await db.transaction().execute(async (trx) => {
        const inserts: Database["public"]["Tables"]["storageUnit"]["Insert"][] =
          [];
        const csvIdsForInserts: string[] = [];
        const updates: {
          id: string;
          data: Database["public"]["Tables"]["storageUnit"]["Update"];
        }[] = [];
        const csvIdsForNameMatchedUpdates: Array<{
          entityId: string;
          externalId: string;
        }> = [];

        // Resolve storage type names to ids, creating any that don't exist.
        const resolveTypeIds = async (names: string[]): Promise<string[]> => {
          const ids: string[] = [];
          for (const name of names) {
            const key = name.toLowerCase();
            let id = storageTypeByName.get(key);
            if (!id) {
              const created = await trx
                .insertInto("storageType")
                .values({
                  id: nanoid(),
                  name,
                  companyId,
                  createdBy: userId,
                  createdAt: datetime.timestamp()
                } as never)
                .returning(["id"])
                .execute();
              id = created[0]?.id ?? undefined;
              if (id) storageTypeByName.set(key, id);
            }
            if (id && !ids.includes(id)) ids.push(id);
          }
          return ids;
        };

        for (const [rowIndex, record] of acceptedRows) {
          const id = record.id ?? "";
          const name = (record.name ?? "").trim();
          const locationId = (record.locationId ?? "").trim();
          const parentName = (record.parentName ?? "").trim();

          if (name === "" || locationId === "") {
            summary.errors.push({
              row: rowIndex,
              reason:
                name === ""
                  ? "Missing required Name"
                  : "Missing required Location"
            });
            continue;
          }
          if (id && seenCsvIds.has(id)) {
            summary.skipped.push({
              row: rowIndex,
              reason: `Duplicate ID "${id}" in file`
            });
            continue;
          }
          const key = naturalKey(locationId, name);
          if (seenNaturalKeys.has(key)) {
            summary.skipped.push({
              row: rowIndex,
              reason: `Duplicate storage unit "${name}" for this location in file`
            });
            continue;
          }
          // Resolve the row to an existing unit. A csv-id match is honored only
          // when it is in the SAME location the row states — a storage unit's
          // location is immutable via import. Updates never touch locationId, so
          // a cross-location id match would otherwise silently rename the unit in
          // its old location (ignoring the CSV Location) or crash the whole
          // import on storageUnit_name_locationId_key.
          const matchedByCsvId = id ? externalIdMap.get(id) : undefined;
          const csvIdLocation =
            matchedByCsvId !== undefined
              ? entityLocation.get(matchedByCsvId)
              : undefined;
          if (
            matchedByCsvId !== undefined &&
            csvIdLocation !== undefined &&
            csvIdLocation !== locationId
          ) {
            summary.errors.push({
              row: rowIndex,
              reason: `Unique ID "${id}" already belongs to a storage unit in a different location; import cannot move a storage unit between locations`
            });
            continue;
          }
          const matchedByName =
            matchedByCsvId === undefined ? naturalKeyMap.get(key) : undefined;
          // An id-matched update renames the unit to `name`. If a DIFFERENT unit
          // in this location already owns that name, the rename would violate
          // storageUnit_name_locationId_key — report it instead of crashing.
          if (matchedByCsvId !== undefined) {
            const nameOwner = naturalKeyMap.get(key);
            if (nameOwner !== undefined && nameOwner !== matchedByCsvId) {
              summary.errors.push({
                row: rowIndex,
                reason: `A different storage unit named "${name}" already exists in this location`
              });
              continue;
            }
          }
          const existingEntityId = matchedByCsvId ?? matchedByName;

          // Row is valid — claim its dedup slots now (after the guards, so a
          // rejected row never blocks a later legitimate row with the same
          // name/id from being processed).
          seenNaturalKeys.add(key);
          if (id) seenCsvIds.add(id);

          const storageTypeIds = await resolveTypeIds(
            parseTypeNames(record.storageTypeNames)
          );
          const active = parseActive(record.active);

          if (parentName) {
            parentIntents.push({
              locationId,
              childKey: key,
              parentName,
              rowIndex
            });
          }

          if (existingEntityId !== undefined) {
            // Deliberately does not touch locationId (the match/natural key)
            // to avoid the "cannot move a unit with children" interceptor.
            updates.push({
              id: existingEntityId,
              data: {
                name,
                storageTypeIds,
                active,
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              }
            });
            if (
              matchedByCsvId === undefined &&
              id &&
              !alreadyMappedEntityIds.has(existingEntityId)
            ) {
              csvIdsForNameMatchedUpdates.push({
                entityId: existingEntityId,
                externalId: id
              });
              // Guard against two name-matched rows in the same file both
              // trying to first-map the same entity (they can't share a
              // natural key, but belt-and-braces for the unique index).
              alreadyMappedEntityIds.add(existingEntityId);
            }
            naturalKeyMap.set(key, existingEntityId);
          } else {
            const newId = nanoid();
            inserts.push({
              id: newId,
              name,
              locationId,
              storageTypeIds,
              active,
              companyId,
              createdBy: userId,
              createdAt: datetime.timestamp()
            } as never);
            csvIdsForInserts.push(id);
            naturalKeyMap.set(key, newId);
          }
        }

        importCsvTableLogger.info({
          totalRecords: mappedRecords.length,
          storageUnitInserts: inserts.length,
          storageUnitUpdates: updates.length
        });
        summary.inserted += inserts.length;
        summary.updated += updates.length;

        if (inserts.length > 0) {
          const inserted = await inChunks(inserts, (rows) =>
            trx
              .insertInto("storageUnit")
              .values(rows)
              .returning(["id"])
              .execute()
          );
          await upsertCsvMappings(
            trx,
            "storageUnit",
            inserted.map((row, i) => ({
              entityId: row.id!,
              externalId: csvIdsForInserts[i]!
            })),
            companyId,
            userId
          );
        }
        for (const update of updates) {
          await trx
            .updateTable("storageUnit")
            .set(update.data)
            .where("id", "=", update.id)
            .where("companyId", "=", companyId)
            .execute();
        }
        if (csvIdsForNameMatchedUpdates.length > 0) {
          await upsertCsvMappings(
            trx,
            "storageUnit",
            csvIdsForNameMatchedUpdates,
            companyId,
            userId
          );
        }
      });

      // Second pass: link parents by (locationId + name) now that every unit
      // in the file exists. Individual UPDATEs (outside the insert txn) so an
      // unresolved or cyclic parent reports a row error without discarding the
      // successful imports. The DB same-location / no-cycle interceptors are
      // the final guard; their exceptions are caught per-row.
      for (const intent of parentIntents) {
        const childId = naturalKeyMap.get(intent.childKey);
        const parentId = naturalKeyMap.get(
          naturalKey(intent.locationId, intent.parentName)
        );
        if (!childId) continue;
        if (!parentId) {
          summary.errors.push({
            row: intent.rowIndex,
            reason: `Parent storage unit "${intent.parentName}" not found in the same location`
          });
          continue;
        }
        if (parentId === childId) {
          summary.errors.push({
            row: intent.rowIndex,
            reason: `Storage unit cannot be its own parent`
          });
          continue;
        }
        try {
          await db
            .updateTable("storageUnit")
            .set({
              parentId,
              updatedAt: datetime.timestamp(),
              updatedBy: userId
            })
            .where("id", "=", childId)
            .where("companyId", "=", companyId)
            .execute();
        } catch (parentErr) {
          summary.errors.push({
            row: intent.rowIndex,
            reason: `Could not set parent "${intent.parentName}": ${
              (parentErr as Error).message
            }`
          });
        }
      }
      break;
    }
    case "bom":
    case "operations":
    case "partWithMethod": {
      await importMethods(db, {
        table,
        mappedRecords,
        companyId,
        userId,
        summary
      });
      break;
    }
    case "unitOfMeasure":
    case "itemPostingGroup":
    case "storageType":
    case "scrapReason":
    case "department": {
      await importConfigLookups(db, {
        table,
        mappedRecords,
        companyId,
        userId,
        summary
      });
      break;
    }
    case "materialSubstance":
    case "materialForm":
    case "materialFinish":
    case "materialGrade":
    case "materialType":
    case "materialDimension": {
      await importMaterialProperties(db, {
        table,
        mappedRecords,
        companyId,
        userId,
        summary
      });
      break;
    }
    case "inventoryQuantity":
    case "batchQuantity":
    case "serialQuantity": {
      await importStockQuantities(db, client, {
        table,
        mappedRecords,
        companyId,
        userId,
        summary
      });
      break;
    }
    default: {
      throw new Error(`Invalid table: ${table}`);
    }
  }

  // Attach each failed/skipped row's original CSV cells (keyed by the user's
  // headers) so the results UI renders the exact rows the server parsed — no
  // dependence on a second, client-side parse. `row` is the 0-based index into
  // parsedCsv for both the standard and method importers.
  const withValues = (issues: Array<{ row: number; reason: string }>) =>
    issues.map((issue) => ({ ...issue, values: parsedCsv[issue.row] ?? {} }));

  return {
    success: true,
    inserted: summary.inserted,
    updated: summary.updated,
    errors: withValues(summary.errors),
    skipped: withValues(summary.skipped)
  };
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
const convertDocumentLogger = getLogger("server-functions", "convert");

export const convertInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("methodVersionToActive"),
    id: z.string()
  }),
  z.object({
    type: z.literal("purchaseOrderToPurchaseInvoice"),
    id: z.string()
  }),
  z.object({
    type: z.literal("quoteToSalesOrder"),
    id: z.string(),
    purchaseOrderNumber: z.string().optional(),
    // Only `quantity` is trusted (it selects a quantity break). Every financial
    // field is derived server-side from quoteLinePrice in the handler; the money
    // fields below are accepted-but-ignored for backward compatibility with
    // existing clients that still send them.
    selectedLines: z.record(
      z.string(),
      z.object({
        quantity: z.number().min(0),
        netUnitPrice: z.number().optional(),
        convertedNetUnitPrice: z.number().optional(),
        addOn: z.number().optional(),
        convertedAddOn: z.number().optional(),
        taxableAddOn: z.number().optional(),
        convertedTaxableAddOn: z.number().optional(),
        shippingCost: z.number().optional(),
        convertedShippingCost: z.number().optional(),
        leadTime: z.number().optional()
      })
    ),
    digitalQuoteAcceptedBy: z.string().optional(),
    digitalQuoteAcceptedByEmail: z.string().optional()
  }),

  z.object({
    type: z.literal("salesOrderToSalesInvoice"),
    id: z.string()
  }),
  z.object({
    type: z.literal("salesRfqToQuote"),
    id: z.string()
  }),
  z.object({
    type: z.literal("shipmentToSalesInvoice"),
    id: z.string()
  }),
  z.object({
    type: z.literal("supplierQuoteToPurchaseOrder"),
    id: z.string(),
    selectedLines: z.record(
      z.string(),
      z.object({
        leadTime: z.number(),
        quantity: z.number(),
        shippingCost: z.number(),
        supplierShippingCost: z.number(),
        supplierUnitPrice: z.number(),
        supplierTaxAmount: z.number(),
        // Mirrors selectedLineSchema in purchasing.models.ts — a 0..1 fraction.
        // Left optional so existing clients keep working; resolveTaxPercent
        // derives it from the amount rather than storing 0 beside a real one.
        taxPercent: z.number().min(0).max(1).optional().default(0),
        unitPrice: z.number()
      })
    )
  }),
  z.object({
    type: z.literal("warehouseTransferToShipment"),
    id: z.string()
  }),
  z.object({
    type: z.literal("warehouseTransferToReceipt"),
    id: z.string()
  })
]);

/**
 * taxPercent and the tax amount are one value pair — a write that sets one sets
 * both. The payload's rate is optional for client compatibility, so when a
 * client sends a real amount without a rate, derive the rate once from the
 * canonical denominator (unit price x quantity + shipping) instead of storing 0
 * next to it, which the form would then treat as "no tax" and zero out.
 */
function resolveTaxPercent(line: {
  taxPercent?: number;
  supplierTaxAmount: number;
  supplierUnitPrice: number;
  quantity: number;
  supplierShippingCost: number;
}): number {
  if (line.taxPercent) return line.taxPercent;
  if (!line.supplierTaxAmount) return 0;
  return deriveRate(
    line.supplierTaxAmount,
    line.supplierUnitPrice * line.quantity + line.supplierShippingCost
  );
}

/**
 * Where an order's goods go, for the invoice's customer ship-to: a drop
 * shipment's own location, else the order header's ship-to. The same rule as
 * `resolveSalesOrderShipTo` (sales rules) — never the bill-to.
 */
function orderShipToCustomerLocationId(
  order: { customerLocationId: string | null },
  orderShipment: { dropShipment: boolean; customerLocationId: string | null }
): string | null {
  return orderShipment.dropShipment
    ? orderShipment.customerLocationId
    : order.customerLocationId;
}

/** `id` for the three document-to-invoice conversions, `convertedId` for the rest. */
export type ConvertResult = { id?: string; convertedId?: string };

export const convertDocumentPermission = {
  by: "type",
  rules: {
    methodVersionToActive: { update: "resources" },
    purchaseOrderToPurchaseInvoice: { update: "invoicing" },
    quoteToSalesOrder: { update: "sales" },
    salesOrderToSalesInvoice: { update: "invoicing" },
    salesRfqToQuote: { update: "sales" },
    shipmentToSalesInvoice: { update: "invoicing" },
    supplierQuoteToPurchaseOrder: { update: "purchasing" },
    warehouseTransferToShipment: { update: "inventory" },
    warehouseTransferToReceipt: { update: "inventory" }
  }
} satisfies PermissionRule<z.output<typeof convertInput>>;

/** Converts one document into the next (quote → order, order → invoice, …). */
export async function convertDocument(
  ctx: ServiceContext,
  raw: z.input<typeof convertInput>
) {
  const payload = convertInput.parse(raw);

  const { type, id } = payload;
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  let convertedId = "";

  convertDocumentLogger.info("convert", { type, id, companyId, userId });

  const client = ctx.asSystem.supabase;

  switch (payload.type) {
    case "methodVersionToActive": {
      const makeMethodId = id;
      const makeMethod = await maybeSingle(db, "makeMethod", {
        id: makeMethodId,
        companyId
      });
      if (makeMethod.error) throw new Error(makeMethod.error.message);
      if (!makeMethod.data) throw new NotFoundError("Make method not found");

      if (await isStrictBackflush(db, companyId)) {
        await assertMethodHasPullFrom(db, { makeMethodId, companyId });
      }

      const [relatedMakeMethods, draftQuotes, draftJobs] = await inOrder([
        () =>
          many(db, "makeMethod", {
            itemId: makeMethod.data?.itemId,
            companyId
          }),
        () => many(db, "quote", { companyId, status: "Draft" }),
        () => many(db, "job", { companyId, status: "Draft" })
      ]);

      if (relatedMakeMethods.error)
        throw new Error(relatedMakeMethods.error.message);

      if (draftQuotes.error) throw new Error(draftQuotes.error.message);
      if (draftJobs.error) throw new Error(draftJobs.error.message);

      const draftMakeMethodIds = relatedMakeMethods.data
        ?.filter(
          (makeMethod) =>
            makeMethod.id !== makeMethodId && makeMethod.status === "Draft"
        )
        ?.map((makeMethod) => makeMethod.id);

      const activeMakeMethodIds = relatedMakeMethods.data
        ?.filter(
          (makeMethod) =>
            makeMethod.id !== makeMethodId && makeMethod.status === "Active"
        )
        ?.map((makeMethod) => makeMethod.id);

      const relatedMakeMethodIds = [
        ...(draftMakeMethodIds ?? []),
        ...(activeMakeMethodIds ?? [])
      ];

      const [methodMaterials] = await inOrder([
        () =>
          many(db, "methodMaterial", {
            materialMakeMethodId: relatedMakeMethodIds,
            companyId
          })
      ]);

      if (methodMaterials.error) throw new Error(methodMaterials.error.message);

      await db.transaction().execute(async (trx) => {
        if (activeMakeMethodIds.length > 0) {
          await trx
            .updateTable("makeMethod")
            .set({ status: "Archived" })
            .where("id", "in", activeMakeMethodIds)
            .where("companyId", "=", companyId)
            .execute();
        }

        await trx
          .updateTable("makeMethod")
          .set({ status: "Active" })
          .where("id", "=", makeMethodId)
          .where("companyId", "=", companyId)
          .execute();

        if (relatedMakeMethodIds.length > 0) {
          await trx
            .updateTable("methodMaterial")
            .set({ materialMakeMethodId: makeMethodId })
            .where("materialMakeMethodId", "in", relatedMakeMethodIds)
            .where("companyId", "=", companyId)
            .execute();
        }
      });

      break;
    }
    case "purchaseOrderToPurchaseInvoice": {
      const purchaseOrderId = id;
      const [
        purchaseOrder,
        purchaseOrderLines,
        purchaseOrderPayment,
        purchaseOrderDelivery
      ] = await inOrder([
        () =>
          maybeSingle(db, "purchaseOrder", {
            id: purchaseOrderId,
            companyId
          }),
        () => many(db, "purchaseOrderLine", { purchaseOrderId, companyId }),
        () =>
          maybeSingle(db, "purchaseOrderPayment", {
            id: purchaseOrderId,
            companyId
          }),
        () =>
          maybeSingle(db, "purchaseOrderDelivery", {
            id: purchaseOrderId,
            companyId
          })
      ]);

      if (!purchaseOrder.data)
        throw new NotFoundError("Purchase order not found");
      if (purchaseOrderLines.error)
        throw new Error(purchaseOrderLines.error.message);
      if (!purchaseOrderPayment.data)
        throw new NotFoundError("Purchase order payment not found");
      if (!purchaseOrderDelivery.data)
        throw new NotFoundError("Purchase order delivery not found");

      // Short-closed lines ("Stop Receiving") only bill what was received,
      // so quantities go through getRemainingQuantityToInvoice rather than
      // the generated quantityToInvoice column (ordered - invoiced).
      const uninvoicedLines = purchaseOrderLines?.data?.reduce<
        (typeof purchaseOrderLines)["data"]
      >((acc, line) => {
        if (
          line &&
          !line.invoicedComplete &&
          getRemainingQuantityToInvoice(line) > 0
        ) {
          acc.push(line);
        }

        return acc;
      }, []);

      if (!uninvoicedLines || uninvoicedLines.length === 0) {
        throw new Error(
          "No lines available to invoice. All lines may already be marked as invoiced complete."
        );
      }

      const uninvoicedSubtotal = uninvoicedLines.reduce((acc, line) => {
        if (line?.unitPrice) {
          acc += getRemainingQuantityToInvoice(line) * line.unitPrice;
        }

        return acc;
      }, 0);

      // Flat header/line amounts (shipping, tax) must not be duplicated
      // when a PO is invoiced in multiple partial invoices: the header
      // shipping goes on the first (non-voided) invoice only, and flat
      // line amounts are prorated by the fraction being invoiced.
      // Untyped client: this embedded select exceeds TypeScript's
      // instantiation depth, and only the row count is read.
      const priorInvoiceLines = await (client as unknown as SupabaseClient)
        .from("purchaseInvoiceLine")
        .select("id, purchaseInvoice!inner(status)")
        .eq("purchaseOrderId", purchaseOrderId)
        .eq("companyId", companyId)
        .neq("purchaseInvoice.status", "Voided")
        .limit(1);
      const hasPriorInvoice = (priorInvoiceLines.data?.length ?? 0) > 0;

      const uninvoicedFraction = (line: {
        purchaseQuantity: number | null;
        quantityReceived: number | null;
        quantityInvoiced: number | null;
        receivedComplete: boolean | null;
      }) => {
        const ordered = line.purchaseQuantity ?? 0;
        if (ordered <= 0) return 1;
        return Math.min(getRemainingQuantityToInvoice(line) / ordered, 1);
      };

      let purchaseInvoiceId = "";

      await db.transaction().execute(async (trx) => {
        purchaseInvoiceId = await getNextSequence(
          trx,
          "purchaseInvoice",
          companyId
        );

        const purchaseInvoice = await trx
          .insertInto("purchaseInvoice")
          .values({
            invoiceId: purchaseInvoiceId!,
            status: "Draft",
            supplierId: purchaseOrder.data!.supplierId,
            supplierReference: purchaseOrder.data!.supplierReference ?? "",
            invoiceSupplierId: purchaseOrderPayment.data!.invoiceSupplierId,
            invoiceSupplierContactId:
              purchaseOrderPayment.data!.invoiceSupplierContactId,
            invoiceSupplierLocationId:
              purchaseOrderPayment.data!.invoiceSupplierLocationId,
            locationId: purchaseOrderDelivery.data!.locationId,
            paymentTermId: purchaseOrderPayment.data!.paymentTermId,
            currencyCode: purchaseOrder.data!.currencyCode ?? "USD",
            dateIssued: datetime
              .today(await resolveCompanyTimeZone(trx, companyId))
              .toString(),
            exchangeRate: purchaseOrder.data!.exchangeRate ?? 1,
            subtotal: uninvoicedSubtotal ?? 0,
            supplierInteractionId: purchaseOrder.data!.supplierInteractionId,
            totalDiscount: 0,
            totalAmount: uninvoicedSubtotal ?? 0,
            totalTax: 0,
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!purchaseInvoice.id)
          throw new Error("Purchase invoice not created");
        purchaseInvoiceId = purchaseInvoice.id;

        await trx
          .insertInto("purchaseInvoiceDelivery")
          .values({
            id: purchaseInvoiceId,
            locationId: purchaseOrderDelivery.data!.locationId,
            supplierShippingCost: hasPriorInvoice
              ? 0
              : (purchaseOrderDelivery.data!.supplierShippingCost ?? 0),
            shippingMethodId: purchaseOrderDelivery.data!.shippingMethodId,
            shippingTermId: purchaseOrderDelivery.data!.shippingTermId,
            incoterm: purchaseOrderDelivery.data!.incoterm,
            incotermLocation: purchaseOrderDelivery.data!.incotermLocation,
            companyId,
            updatedBy: userId
          })
          .execute();

        const purchaseInvoiceLines: Database["public"]["Tables"]["purchaseInvoiceLine"]["Insert"][] =
          uninvoicedLines.map((line) => ({
            invoiceId: purchaseInvoiceId,
            invoiceLineType: line.purchaseOrderLineType,
            purchaseOrderId: line.purchaseOrderId,
            purchaseOrderLineId: line.id,
            itemId: line.itemId,
            locationId: line.locationId,
            storageUnitId: line.storageUnitId,
            accountId: line.accountId,
            costCenterId: line.costCenterId,
            assetId: line.assetId,
            description: line.description,
            quantity: getRemainingQuantityToInvoice(line),
            supplierUnitPrice: line.supplierUnitPrice ?? 0,
            supplierShippingCost:
              (line.supplierShippingCost ?? 0) * uninvoicedFraction(line),
            supplierTaxAmount:
              (line.supplierTaxAmount ?? 0) * uninvoicedFraction(line),
            // The rate is invariant under proration; only the amount scales
            taxPercent: line.taxPercent ?? 0,
            purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
            inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode,
            conversionFactor: line.conversionFactor,
            exchangeRate: line.exchangeRate ?? 1,
            jobOperationId: line.jobOperationId,
            sortOrder: line.sortOrder ?? 1,
            companyId,
            createdBy: userId
          }));

        await trx
          .insertInto("purchaseInvoiceLine")
          .values(purchaseInvoiceLines)
          .execute();
      });

      return { id: purchaseInvoiceId };
    }
    case "quoteToSalesOrder": {
      const {
        selectedLines,
        purchaseOrderNumber,
        digitalQuoteAcceptedBy,
        digitalQuoteAcceptedByEmail
      } = payload;
      const [
        quote,
        quoteLines,
        quoteLinePrices,
        quotePayment,
        quoteShipping,
        company
      ] = await inOrder([
        () => single(db, "quote", { id, companyId }),
        // Read in full: the direct connection has no row cap to page around.
        () => many(db, "quoteLine", { quoteId: id, companyId }),
        () => many(db, "quoteLinePrice", { quoteId: id, companyId }),
        () => single(db, "quotePayment", { id, companyId }),
        () => single(db, "quoteShipment", { id, companyId }),
        () => single(db, "company", { id: companyId })
      ]);

      if (quote.error) throw new NotFoundError(`Quote with id ${id} not found`);
      if (quoteLines.error || !quoteLines.data)
        throw new NotFoundError(`Quote Lines with id ${id} not found`);
      if (quoteLinePrices.error || !quoteLinePrices.data)
        throw new NotFoundError(`Quote line prices with id ${id} not found`);
      const quoteLineRows = quoteLines.data;
      if (quotePayment.error)
        throw new NotFoundError(`Quote payment with id ${id} not found`);
      if (quoteShipping.error)
        throw new NotFoundError(`Quote shipping with id ${id} not found`);

      // SECURITY: every financial field on the resulting sales order line is
      // derived here from the canonical quoteLinePrice rows, keyed by
      // (quoteLineId, quantity). The digital-quote accept endpoint is
      // unauthenticated, so the client `selectedLines` payload is trusted only
      // as a selection of quantity break — never as a source of prices. Do not
      // read money fields (netUnitPrice, shippingCost, addOn, …) from it.
      const canonicalPriceByLineQty = new Map<
        string,
        NonNullable<typeof quoteLinePrices.data>[number]
      >();
      for (const price of quoteLinePrices.data ?? []) {
        canonicalPriceByLineQty.set(
          `${price.quoteLineId}:${price.quantity}`,
          price
        );
      }

      const computeAddOns = (
        additionalCharges: unknown,
        quantity: number
      ): { addOn: number; taxableAddOn: number } => {
        const charges =
          (additionalCharges as Record<
            string,
            { amounts?: Record<string, number>; taxable?: boolean }
          > | null) ?? {};
        let addOn = 0;
        let taxableAddOn = 0;
        for (const charge of Object.values(charges)) {
          const amount = Number(charge?.amounts?.[quantity] ?? 0) || 0;
          addOn += amount;
          if (charge?.taxable !== false) taxableAddOn += amount;
        }
        return { addOn, taxableAddOn };
      };

      let insertedSalesOrderId = "";
      await db.transaction().execute(async (trx) => {
        const todayDate = datetime.today(
          await resolveCompanyTimeZone(trx, companyId)
        );
        const today = todayDate.toString();
        const salesOrderId = await getNextSequence(
          trx,
          "salesOrder",
          companyId
        );

        // Check if any selected lines have quantity 0
        const hasZeroQuantityLines = quoteLineRows.some(
          (line) =>
            line.id &&
            selectedLines &&
            line.id in selectedLines &&
            selectedLines[line.id]!.quantity === 0
        );

        // Only the selected lines become sales order lines below. A No Quote
        // line is never offered to the customer, so it never converts —
        // whatever the (unauthenticated) selection payload says.
        const selectedQuoteLines = quoteLineRows.filter(
          (line) =>
            line.id &&
            line.status !== "No Quote" &&
            selectedLines &&
            line.id in selectedLines &&
            selectedLines[line.id]!.quantity > 0
        );

        // Never create an empty order: the share page gates Accept, but this
        // payload comes from an unauthenticated endpoint.
        if (selectedQuoteLines.length === 0) {
          throw new Error("No quote lines selected to convert");
        }

        // Services are never shipped — a service-only order goes straight to
        // "To Invoice" so it isn't stuck waiting on a shipment that can't happen.
        const hasShippableLine = selectedQuoteLines.some(
          (line) => line.itemType !== "Service"
        );
        const salesOrderStatus = hasShippableLine
          ? "To Ship and Invoice"
          : "To Invoice";

        // An order always has a location. A quote can reach here without
        // one (Paperless Parts imports never set it), so fall back to the
        // quote's shipment location, then the company's first location.
        const locationId =
          quote.data.locationId ??
          quoteShipping.data.locationId ??
          (
            await trx
              .selectFrom("location")
              .select("id")
              .where("companyId", "=", companyId)
              .orderBy("createdAt")
              .orderBy("id")
              .executeTakeFirst()
          )?.id;
        if (!locationId) {
          throw new Error("The company has no location for the sales order");
        }

        const salesOrder = await trx
          .insertInto("salesOrder")
          .values([
            {
              salesOrderId,
              revisionId: 0,
              orderDate: today,
              customerId: quote.data.customerId,
              customerContactId: quote.data.customerContactId,
              customerEngineeringContactId:
                quote.data.customerEngineeringContactId,
              customerLocationId: quote.data.customerLocationId,
              customerReference: purchaseOrderNumber ?? "",
              locationId,
              salesPersonId: quote.data.salesPersonId ?? userId,
              status: salesOrderStatus,
              createdBy: userId,
              companyId: companyId,
              currencyCode:
                quote.data.currencyCode ??
                company.data?.baseCurrencyCode ??
                "USD",
              externalNotes: toJson(quote.data.externalNotes),
              internalNotes: toJson(quote.data.internalNotes),
              exchangeRate: quote.data.exchangeRate ?? 1,
              exchangeRateUpdatedAt:
                quote.data.exchangeRateUpdatedAt ?? datetime.timestamp(),
              opportunityId: quote.data.opportunityId
            }
          ])
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!salesOrder.id) {
          throw new Error("sales order is not created");
        }
        insertedSalesOrderId = salesOrder.id;

        // Copy quotePayment data to salesOrderPayment
        await trx
          .insertInto("salesOrderPayment")
          .values({
            ...quotePayment.data,
            id: insertedSalesOrderId
          })
          .execute();

        // One read for every picked line's default bin, keyed by item and location.
        const pickedLines = selectedQuoteLines.flatMap((line) => {
          return line.id && line.itemId && line.methodType !== "Make to Order"
            ? [
                {
                  id: line.id,
                  itemId: line.itemId,
                  locationId: line.locationId ?? locationId
                }
              ]
            : [];
        });
        const pickMethods = pickedLines.length
          ? await trx
              .selectFrom("pickMethod")
              .where(
                "itemId",
                "in",
                pickedLines.map((line) => line.itemId)
              )
              .where(
                "locationId",
                "in",
                pickedLines.map((line) => line.locationId)
              )
              .where("companyId", "=", companyId)
              .select(["itemId", "locationId", "defaultStorageUnitId"])
              .execute()
          : [];
        const defaultBinByItemLocation = new Map(
          pickMethods.map((pm) => [
            `${pm.itemId}:${pm.locationId}`,
            pm.defaultStorageUnitId
          ])
        );
        const pickMethodDefaultsByLineId = new Map(
          pickedLines.map((line) => [
            line.id,
            defaultBinByItemLocation.get(`${line.itemId}:${line.locationId}`) ??
              null
          ])
        );

        const salesOrderLineInserts: Database["public"]["Tables"]["salesOrderLine"]["Insert"][] =
          selectedQuoteLines.map((line) => {
            const selectedQuantity = selectedLines![line.id!]!.quantity;
            const price = canonicalPriceByLineQty.get(
              `${line.id}:${selectedQuantity}`
            );
            if (!price) {
              throw new Error(
                `No quote price found for line ${line.id} at quantity ${selectedQuantity}`
              );
            }
            const { addOn, taxableAddOn } = computeAddOns(
              line.additionalCharges,
              price.quantity
            );
            return {
              id: line.id,
              salesOrderId: insertedSalesOrderId,
              salesOrderLineType: line.itemType as "Part",
              addOnCost: taxableAddOn,
              nonTaxableAddOnCost: addOn - taxableAddOn,
              description: line.description,
              itemId: line.itemId,
              locationId: line.locationId ?? locationId,
              methodType: line.methodType,
              storageUnitId: pickMethodDefaultsByLineId.get(line.id!) ?? null,
              internalNotes: toJson(line.internalNotes),
              externalNotes: toJson(line.externalNotes),
              saleQuantity: price.quantity,
              status: "Ordered",
              unitOfMeasureCode: line.unitOfMeasureCode,
              unitPrice: price.netUnitPrice ?? 0,
              // How the quoted price was reached, carried onto the order.
              priceTrace: toJson(
                quoteToOrderPriceTrace(
                  price.priceTrace,
                  price.unitPrice ?? 0,
                  price.netUnitPrice ?? 0,
                  price.discountPercent ?? 0
                )
              ),
              promisedDate: todayDate
                .add({ days: price.leadTime ?? 0 })
                .toString(),
              createdBy: userId,
              companyId,
              exchangeRate: quote.data.exchangeRate ?? 1,
              taxPercent: line.taxPercent,
              shippingCost: price.shippingCost ?? 0,
              sortOrder: line.sortOrder ?? 1,
              configuration: toJson(line.configuration)
            };
          });

        // The order is promised when its last line is: the latest line
        // promise (today + that line's quoted lead time). A requested date
        // the quote already carries is the customer's and is kept.
        const receiptPromisedDate =
          salesOrderLineInserts
            .map((insert) => insert.promisedDate)
            .filter((date): date is string => !!date)
            .sort()
            .at(-1) ?? null;

        // Copy quoteShipment data to salesOrderShipment
        await trx
          .insertInto("salesOrderShipment")
          .values({
            ...quoteShipping.data,
            id: insertedSalesOrderId,
            locationId: quoteShipping.data.locationId ?? locationId,
            receiptRequestedDate:
              quoteShipping.data.receiptRequestedDate ?? receiptPromisedDate,
            receiptPromisedDate
          })
          .execute();

        if (salesOrderLineInserts.length > 0) {
          await trx
            .insertInto("salesOrderLine")
            .values(salesOrderLineInserts)
            .execute();

          await trx
            .updateTable("item")
            .set({ active: true })
            .where(
              "id",
              "in",
              salesOrderLineInserts.map((insert) => insert.itemId as string)
            )
            .where("companyId", "=", companyId)
            .execute();
        }

        const newQuoteStatus: "Ordered" | "Partial" = hasZeroQuantityLines
          ? "Partial"
          : "Ordered";
        // Atomic guard: only convert a quote that is still "Sent". Both the
        // internal "convert to order" flow and the unauthenticated digital
        // quote accept run from "Sent" only. If a concurrent or replayed
        // request already converted it, 0 rows update here and the throw rolls
        // the whole transaction back — no duplicate sales order is committed.
        const quoteStatusUpdate = await trx
          .updateTable("quote")
          .set({
            status: newQuoteStatus,
            digitalQuoteAcceptedBy: digitalQuoteAcceptedBy ?? null,
            digitalQuoteAcceptedByEmail: digitalQuoteAcceptedByEmail ?? null
          })
          .where("id", "=", quote.data.id)
          .where("status", "=", "Sent")
          .where("companyId", "=", companyId)
          .executeTakeFirst();

        if (Number(quoteStatusUpdate.numUpdatedRows ?? 0) === 0) {
          throw new Error(
            `Quote ${quote.data.id} is no longer in a convertible state`
          );
        }

        const customerPartSeen = new Set<string>();
        const customerPartToItemInserts = quoteLineRows
          .map((line) => ({
            companyId,
            customerId: quote.data?.customerId!,
            customerPartId: line.customerPartId!,
            customerPartRevision: line.customerPartRevision ?? "",
            itemId: line.itemId!
          }))
          .filter((line) => {
            if (!line.itemId || !line.customerPartId) return false;
            const key = `${line.customerId}-${line.itemId}`;
            if (customerPartSeen.has(key)) return false;
            customerPartSeen.add(key);
            return true;
          });
        if (customerPartToItemInserts.length > 0) {
          await trx
            .insertInto("customerPartToItem")
            .values(customerPartToItemInserts)
            .onConflict((oc) =>
              oc.columns(["customerId", "itemId"]).doUpdateSet((eb) => ({
                customerPartId: eb.ref("excluded.customerPartId"),
                customerPartRevision: eb.ref("excluded.customerPartRevision")
              }))
            )
            .execute();
        }

        const updatedItemModels = quoteLineRows
          .filter((line) => !!line.modelUploadId && !!line.itemId)
          .map((line) => ({
            id: line.itemId!,
            modelUploadId: line.modelUploadId!
          }));

        if (updatedItemModels.length > 0) {
          for await (const update of updatedItemModels) {
            await trx
              .updateTable("item")
              .set(update)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      });

      if (!insertedSalesOrderId) {
        throw new Error("Failed to insert sales order");
      }

      convertedId = insertedSalesOrderId;
      break;
    }
    case "salesOrderToSalesInvoice": {
      const salesOrderId = id;
      const [
        salesOrder,
        salesOrderLines,
        salesOrderPayment,
        salesOrderShipment
      ] = await inOrder([
        () => maybeSingle(db, "salesOrder", { id: salesOrderId, companyId }),
        () => many(db, "salesOrderLine", { salesOrderId, companyId }),
        () =>
          maybeSingle(db, "salesOrderPayment", {
            id: salesOrderId,
            companyId
          }),
        () =>
          maybeSingle(db, "salesOrderShipment", {
            id: salesOrderId,
            companyId
          })
      ]);

      if (salesOrder.error) throw new Error(salesOrder.error.message);
      if (!salesOrder.data) throw new NotFoundError("Sales order not found");
      const order = salesOrder.data;
      if (salesOrderLines.error) throw new Error(salesOrderLines.error.message);
      if (salesOrderPayment.error)
        throw new Error(salesOrderPayment.error.message);
      if (!salesOrderPayment.data)
        throw new NotFoundError("Sales order payment details not found");
      if (salesOrderShipment.error)
        throw new Error(salesOrderShipment.error.message);
      if (!salesOrderShipment.data)
        throw new NotFoundError("Sales order delivery details not found");
      const orderShipment = salesOrderShipment.data;

      // Lines a contract bills are marked invoicedComplete when the
      // contract is created; the lines inserted below skip them, so the
      // subtotal must too.
      const uninvoicedLines = salesOrderLines?.data?.reduce<
        (typeof salesOrderLines)["data"]
      >((acc, line) => {
        if (
          line?.quantityToInvoice &&
          line.quantityToInvoice > 0 &&
          !line.invoicedComplete
        ) {
          acc.push(line);
        }

        return acc;
      }, []);

      const uninvoicedSubtotal = uninvoicedLines?.reduce((acc, line) => {
        if (
          line?.quantityToInvoice &&
          line.unitPrice &&
          line.quantityToInvoice > 0
        ) {
          acc += line.quantityToInvoice * line.unitPrice;
        }

        return acc;
      }, 0);

      let salesInvoiceId = "";

      await db.transaction().execute(async (trx) => {
        salesInvoiceId = await getNextSequence(trx, "salesInvoice", companyId);

        const salesInvoice = await trx
          .insertInto("salesInvoice")
          .values({
            invoiceId: salesInvoiceId!,
            status: "Draft",
            customerId: order.customerId,
            customerReference: order.customerReference ?? "",
            invoiceCustomerId: salesOrderPayment.data!.invoiceCustomerId,
            invoiceCustomerContactId:
              salesOrderPayment.data!.invoiceCustomerContactId,
            invoiceCustomerLocationId:
              salesOrderPayment.data!.invoiceCustomerLocationId,
            locationId: orderShipment.locationId,
            paymentTermId: salesOrderPayment.data!.paymentTermId,
            currencyCode: order.currencyCode ?? "USD",
            dateIssued: datetime
              .today(await resolveCompanyTimeZone(trx, companyId))
              .toString(),
            exchangeRate: order.exchangeRate ?? 1,
            subtotal: uninvoicedSubtotal ?? 0,
            opportunityId: order.opportunityId,
            totalDiscount: 0,
            totalAmount: uninvoicedSubtotal ?? 0,
            totalTax: 0,
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!salesInvoice.id) throw new Error("Sales invoice not created");
        salesInvoiceId = salesInvoice.id;

        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: salesInvoiceId,
            locationId: orderShipment.locationId,
            customerLocationId: orderShipToCustomerLocationId(
              order,
              orderShipment
            ),
            shippingCost: orderShipment.shippingCost ?? 0,
            shippingMethodId: orderShipment.shippingMethodId,
            shippingTermId: orderShipment.shippingTermId,
            incoterm: orderShipment.incoterm,
            incotermLocation: orderShipment.incotermLocation,
            companyId,
            createdBy: userId
          })
          .execute();

        const salesInvoiceLines = uninvoicedLines?.reduce<
          Database["public"]["Tables"]["salesInvoiceLine"]["Insert"][]
        >((acc, line) => {
          if (
            line?.quantityToInvoice &&
            line.quantityToInvoice > 0 &&
            !line.invoicedComplete
          ) {
            acc.push({
              invoiceId: salesInvoiceId,
              invoiceLineType: line.salesOrderLineType,
              salesOrderId: line.salesOrderId,
              salesOrderLineId: line.id,
              methodType: line.methodType,
              itemId: line.itemId,
              locationId: line.locationId,
              storageUnitId: line.storageUnitId,
              accountId: line.accountId,
              assetId: line.assetId,
              description: line.description,
              quantity: line.quantityToInvoice,
              unitPrice: line.unitPrice ?? 0,
              addOnCost: line.addOnCost ?? 0,
              nonTaxableAddOnCost: line.nonTaxableAddOnCost ?? 0,
              shippingCost: line.shippingCost ?? 0,
              taxPercent: line.taxPercent ?? 0,
              unitOfMeasureCode: line.unitOfMeasureCode ?? "EA",
              exchangeRate: line.exchangeRate ?? 1,
              serviceStartDate: line.serviceStartDate ?? null,
              serviceEndDate: line.serviceEndDate ?? null,
              sortOrder: line.sortOrder ?? 1,
              companyId,
              createdBy: userId
            });
          }
          return acc;
        }, []);

        if (salesInvoiceLines.length > 0) {
          await trx
            .insertInto("salesInvoiceLine")
            .values(salesInvoiceLines)
            .execute();
        }
      });

      return { id: salesInvoiceId };
    }
    case "salesRfqToQuote": {
      const [salesRfq, salesRfqLines] = await inOrder([
        () => single(db, "salesRfq", { id, companyId }),
        () => many(db, "salesRfqLines", { salesRfqId: id, companyId })
      ]);

      if (salesRfq.error)
        throw new NotFoundError(`Sales RFQ with id ${id} not found`);
      if (salesRfq.data?.status !== "Ready for Quote")
        throw new Error(
          `Sales RFQ with id ${id} is not in Ready for Quote status`
        );

      if (salesRfqLines.error) {
        throw new NotFoundError(`Sales RFQ Lines with id ${id} not found`);
      }

      // Create Item records for each line that does not yet have one assigned
      const linesToCreateItems = salesRfqLines.data.filter(
        (line) => !line.itemId
      );

      const readableIdToLineIdMapping = new Map<string, string>();
      let itemInserts: Database["public"]["Tables"]["item"]["Insert"][] = [];
      if (linesToCreateItems.length > 0) {
        itemInserts = await Promise.all(
          linesToCreateItems.map(async (line) => {
            let revisionId = line.customerPartRevision ?? "0";
            let readableId = line.customerPartId ?? "";
            let suffix = 1;

            // Check for uniqueness and append a suffix if necessary
            while (true) {
              const { data, error } = await single(
                db,
                "item",
                { readableId, revision: revisionId, companyId },
                { columns: ["id"] }
              );

              if (
                // If multiple line items in the RFQ have the same customer part number and revision,
                // make sure they get assiged different readableIds
                !readableIdToLineIdMapping.has(readableId) &&
                (error || !data)
              ) {
                // readableId is unique, we can use it
                break;
              }

              // If not unique, append or increment suffix
              revisionId = `${revisionId} (${suffix})`;
              suffix++;
            }

            readableIdToLineIdMapping.set(readableId, line.id!);
            return {
              readableId,
              revision: revisionId,
              type: "Part" as const,
              active: false,
              name: line.description ?? line.itemName ?? "",
              description: "",
              itemTrackingType: "Inventory" as const,
              replenishmentSystem: "Make" as const,
              defaultMethodType: "Make to Order" as const,
              unitOfMeasureCode: "EA",
              companyId: companyId,
              createdBy: userId
            };
          })
        );
      }

      if (!salesRfq.data.customerId) {
        throw new Error(`Sales RFQ with id ${id} has no customerId`);
      }

      // Handle customer payment terms, shipping, currency codes, etc.
      const [customerPayment, customerShipping, customer, company] =
        await inOrder([
          () =>
            single(db, "customerPayment", {
              customerId: salesRfq.data.customerId,
              companyId
            }),
          () =>
            single(db, "customerShipping", {
              customerId: salesRfq.data.customerId,
              companyId
            }),
          () =>
            single(db, "customer", {
              id: salesRfq.data.customerId,
              companyId
            }),
          () => single(db, "company", { id: companyId })
        ]);

      if (customerPayment.error) throw customerPayment.error;
      if (customerShipping.error) throw customerShipping.error;
      if (customer.error) throw customer.error;
      if (company.error) throw company.error;

      const currencyCode =
        customer.data?.currencyCode ?? company.data?.baseCurrencyCode ?? "USD";
      // get_exchange_rate returns 1 for the base currency, prefers a
      // company override, falls back to the global store, and raises on a
      // missing rate -- a foreign-currency customer is never quoted at par.
      const exchangeRateResult = await rpcValue(db, "get_exchange_rate", {
        p_company_id: companyId,
        p_currency_code: currencyCode
      });
      if (exchangeRateResult.error) {
        throw new Error(exchangeRateResult.error.message);
      }
      const exchangeRate = Number(exchangeRateResult.data);

      const {
        paymentTermId,
        invoiceCustomerId,
        invoiceCustomerContactId,
        invoiceCustomerLocationId
      } = customerPayment.data;

      const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
        customerShipping.data;

      let insertedQuoteId = "";
      let insertedQuoteLines: {
        id?: string;
        itemId?: string;
        methodType?:
          | "Purchase to Order"
          | "Make to Order"
          | "Pull from Inventory";
      }[] = [];

      await db.transaction().execute(async (trx) => {
        // Create the items for any salesRfqLines that do not yet have an itemId
        if (itemInserts.length > 0) {
          const itemIds = await trx
            .insertInto("item")
            .values(itemInserts)
            .returning(["id", "readableId", "revision"])
            .execute();

          const partInserts: Database["public"]["Tables"]["part"]["Insert"][] =
            itemIds.map((item) => ({
              id: item.readableId!,
              companyId,
              createdBy: userId
            }));
          await trx
            .insertInto("part")
            .values(partInserts)
            .onConflict((oc) =>
              oc.columns(["id", "companyId"]).doUpdateSet({
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              })
            )
            .execute();

          const salesRfqLineUpdates: Database["public"]["Tables"]["salesRfqLine"]["Update"][] =
            itemIds.map((item) => ({
              itemId: item.id!,
              id: readableIdToLineIdMapping.get(item.readableId!)!
            }));
          for await (const update of salesRfqLineUpdates) {
            await trx
              .updateTable("salesRfqLine")
              .set({ itemId: update.itemId })
              .where("id", "=", update.id!)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        // Create the quote
        const quoteId = await getNextSequence(trx, "quote", companyId);
        const externalLinkId = await trx
          .insertInto("externalLink")
          .values({
            documentId: quoteId,
            documentType: "Quote",
            companyId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!salesRfq.data.customerId) {
          throw new Error(`Sales RFQ with id ${id} has no customerId`);
        }

        const quote = await trx
          .insertInto("quote")
          .values([
            {
              quoteId,
              customerId: salesRfq.data?.customerId,
              customerContactId: salesRfq.data?.customerContactId,
              customerEngineeringContactId:
                salesRfq.data?.customerEngineeringContactId,
              customerLocationId: salesRfq.data?.customerLocationId,
              customerReference: salesRfq.data?.customerReference,
              locationId: salesRfq.data?.locationId,
              expirationDate: datetime
                .today(await resolveCompanyTimeZone(trx, companyId))
                .add({ days: 30 })
                .toString(),
              salesPersonId: salesRfq.data?.salesPersonId ?? userId,
              status: "Draft",
              externalNotes: toJson(salesRfq.data?.externalNotes),
              internalNotes: toJson(salesRfq.data?.internalNotes),
              companyId,
              createdBy: userId,
              currencyCode,
              exchangeRate,
              exchangeRateUpdatedAt: datetime.timestamp(),
              externalLinkId: externalLinkId.id,
              opportunityId: salesRfq.data.opportunityId
            }
          ])
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!quote.id) {
          throw new Error("Failed to insert quote");
        }

        // Insert quotePayment
        await trx
          .insertInto("quotePayment")
          .values({
            id: quote.id,
            invoiceCustomerId: invoiceCustomerId,
            invoiceCustomerContactId: invoiceCustomerContactId,
            invoiceCustomerLocationId: invoiceCustomerLocationId,
            paymentTermId: paymentTermId,
            companyId
          })
          .execute();

        // Insert quoteShipment
        await trx
          .insertInto("quoteShipment")
          .values({
            id: quote.id,
            locationId: salesRfq.data?.locationId,
            shippingMethodId: shippingMethodId,
            shippingTermId: shippingTermId,
            incoterm: incoterm,
            incotermLocation: incotermLocation,
            companyId
          })
          .execute();

        const salesRfqLinesWithItemIds = await trx
          .selectFrom("salesRfqLines")
          .selectAll()
          .where("salesRfqId", "=", id)
          .execute();

        const quoteLineInserts: Database["public"]["Tables"]["quoteLine"]["Insert"][] =
          salesRfqLinesWithItemIds.map((line) => ({
            id: line.id ?? undefined,
            quoteId: quote.id!,
            itemId: line.itemId!,
            customerPartId: line.customerPartId,
            customerPartRevision: line.customerPartRevision,
            description: line.description ?? line.itemName ?? "",
            itemType: line.itemType!,
            locationId: salesRfq.data?.locationId,
            methodType: line.methodType!,
            modelUploadId: line.modelUploadId,
            internalNotes: toJson(line.internalNotes),
            externalNotes: toJson(line.externalNotes),
            quantity: line.quantity,
            status: "Not Started",
            unitOfMeasureCode: line.unitOfMeasureCode,
            // Sales RFQ uses "order" column; map it to quoteLine.sortOrder
            sortOrder: line.order ?? 1,
            companyId,
            createdBy: userId
          }));

        if (quoteLineInserts.length > 0) {
          insertedQuoteLines = await trx
            .insertInto("quoteLine")
            .values(quoteLineInserts)
            .returning(["id", "itemId", "methodType"])
            .execute();
        }

        // update salesRfq status
        await trx
          .updateTable("salesRfq")
          .set({ status: "Ready for Quote" })
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        const rfqCustomerPartSeen = new Set<string>();
        const customerPartToItemInserts = salesRfqLinesWithItemIds
          .map((line) => ({
            companyId,
            customerId: salesRfq.data?.customerId!,
            customerPartId: line.customerPartId!,
            customerPartRevision: line.customerPartRevision ?? "",
            itemId: line.itemId!
          }))
          .filter((line) => {
            if (!line.itemId || !line.customerPartId) return false;
            const key = `${line.customerId}-${line.itemId}`;
            if (rfqCustomerPartSeen.has(key)) return false;
            rfqCustomerPartSeen.add(key);
            return true;
          });
        if (customerPartToItemInserts.length > 0) {
          await trx
            .insertInto("customerPartToItem")
            .values(customerPartToItemInserts)
            .onConflict((oc) =>
              oc.columns(["customerId", "itemId"]).doUpdateSet((eb) => ({
                customerPartId: eb.ref("excluded.customerPartId"),
                customerPartRevision: eb.ref("excluded.customerPartRevision")
              }))
            )
            .execute();
        }

        await trx
          .updateTable("salesRfq")
          .set({
            status: "Quoted"
          })
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        const updatedItemModels = salesRfqLinesWithItemIds
          .filter((line) => !!line.modelUploadId && !!line.itemId)
          .map((line) => ({
            id: line.itemId!,
            modelUploadId: line.modelUploadId!
          }));

        if (updatedItemModels.length > 0) {
          for await (const update of updatedItemModels) {
            await trx
              .updateTable("item")
              .set(update)
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        insertedQuoteId = quote.id!;
        convertedId = insertedQuoteId;
      });

      // Copy each make line's method. Each copy holds a pooled connection
      // for its whole tree, so a few at a time rather than all at once.
      const makeLines = insertedQuoteLines.filter(
        (line) => line.methodType === "Make to Order"
      );
      const copies = await async.map(
        makeLines,
        (line) =>
          invokePosting(
            { db, companyId, userId },
            "get-method",
            {
              type: "itemToQuoteLine",
              sourceId: line.itemId!,
              targetId: `${insertedQuoteId}:${line.id}`
            },
            getMethod
          ),
        { concurrency: 2 }
      );
      // The quote stands either way; a line's method can be copied again.
      for (const [index, copy] of copies.entries()) {
        if (copy.error) {
          convertDocumentLogger.error(
            "Failed to copy the method onto a quote line",
            {
              quoteId: insertedQuoteId,
              quoteLineId: makeLines[index]?.id,
              error: copy.error
            }
          );
        }
      }
      break;
    }
    case "shipmentToSalesInvoice": {
      const shipmentId = id;
      const [shipment, shipmentLines, shipmentFixedAssetLines] = await inOrder([
        () => maybeSingle(db, "shipment", { id: shipmentId, companyId }),
        () => many(db, "shipmentLine", { shipmentId, companyId }),
        () =>
          many(db, "shipmentFixedAssetLine", {
            shipmentId,
            companyId,
            shipped: true
          })
      ]);

      if (shipment.error) throw shipment.error;
      if (!shipment.data) throw new NotFoundError("Shipment not found");
      if (shipmentLines.error) throw shipmentLines.error;
      if (shipmentFixedAssetLines.error) throw shipmentFixedAssetLines.error;

      // Accumulate quantities for each sales order line
      const quantitiesByLine = shipmentLines.data.reduce<
        Record<string, number>
      >((acc, line) => {
        const lineId = line.lineId!;
        acc[lineId] = (acc[lineId] || 0) + line.shippedQuantity;
        return acc;
      }, {});

      // Each shipped fixed asset line counts as quantity 1
      for (const line of shipmentFixedAssetLines.data) {
        const lineId = line.salesOrderLineId;
        if (!lineId) continue;
        quantitiesByLine[lineId] = (quantitiesByLine[lineId] || 0) + 1;
      }

      const salesOrderLineIds = Object.keys(quantitiesByLine);

      if (
        !shipment.data?.sourceDocumentId ||
        shipment.data?.sourceDocument !== "Sales Order"
      ) {
        throw new Error(
          "This shipment isn't linked to a sales order, so there's nothing to invoice."
        );
      }

      const [
        salesOrder,
        salesOrderLines,
        salesOrderPayment,
        salesOrderShipment
      ] = await inOrder([
        () =>
          maybeSingle(db, "salesOrder", {
            id: shipment.data?.sourceDocumentId,
            companyId
          }),
        () => many(db, "salesOrderLine", { id: salesOrderLineIds, companyId }),
        () =>
          maybeSingle(db, "salesOrderPayment", {
            id: shipment.data?.sourceDocumentId,
            companyId
          }),
        () =>
          maybeSingle(db, "salesOrderShipment", {
            id: shipment.data?.sourceDocumentId,
            companyId
          })
      ]);

      if (salesOrder.error) throw new Error(salesOrder.error.message);
      if (!salesOrder.data) throw new NotFoundError("Sales order not found");
      const order = salesOrder.data;
      if (salesOrderLines.error) throw new Error(salesOrderLines.error.message);
      if (salesOrderPayment.error)
        throw new Error(salesOrderPayment.error.message);
      if (!salesOrderPayment.data)
        throw new NotFoundError("Sales order payment details not found");
      if (salesOrderShipment.error)
        throw new Error(salesOrderShipment.error.message);
      if (!salesOrderShipment.data)
        throw new NotFoundError("Sales order delivery details not found");
      const orderShipment = salesOrderShipment.data;

      const uninvoicedLines = salesOrderLines?.data?.reduce<
        (typeof salesOrderLines)["data"]
      >((acc, line) => {
        if (line.id in quantitiesByLine) {
          const shippedInThisShipment = quantitiesByLine[line.id]!;
          const remainingToInvoice = line.quantityToInvoice ?? 0;
          const quantityToInvoice = Math.min(
            shippedInThisShipment,
            remainingToInvoice
          );

          if (quantityToInvoice > 0) {
            acc.push({
              ...line,
              quantityToInvoice
            });
          }
        }

        return acc;
      }, []);

      const uninvoicedSubtotal = uninvoicedLines?.reduce((acc, line) => {
        if (
          line?.quantityToInvoice &&
          line.unitPrice &&
          line.quantityToInvoice > 0
        ) {
          acc += line.quantityToInvoice * line.unitPrice;
        }

        return acc;
      }, 0);

      let salesInvoiceId = "";

      await db.transaction().execute(async (trx) => {
        salesInvoiceId = await getNextSequence(trx, "salesInvoice", companyId);

        const salesInvoice = await trx
          .insertInto("salesInvoice")
          .values({
            invoiceId: salesInvoiceId!,
            status: "Draft",
            customerId: order.customerId,
            customerReference: order.customerReference ?? "",
            invoiceCustomerId: salesOrderPayment.data!.invoiceCustomerId,
            invoiceCustomerContactId:
              salesOrderPayment.data!.invoiceCustomerContactId,
            invoiceCustomerLocationId:
              salesOrderPayment.data!.invoiceCustomerLocationId,
            locationId: orderShipment.locationId,
            paymentTermId: salesOrderPayment.data!.paymentTermId,
            currencyCode: order.currencyCode ?? "USD",
            dateIssued: datetime
              .today(await resolveCompanyTimeZone(trx, companyId))
              .toString(),
            exchangeRate: order.exchangeRate ?? 1,
            subtotal: uninvoicedSubtotal ?? 0,
            opportunityId: order.opportunityId,
            shipmentId: shipmentId,
            totalDiscount: 0,
            totalAmount: uninvoicedSubtotal ?? 0,
            totalTax: 0,
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!salesInvoice.id) throw new Error("Sales invoice not created");
        salesInvoiceId = salesInvoice.id;

        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: salesInvoiceId,
            locationId: orderShipment.locationId,
            customerLocationId: orderShipToCustomerLocationId(
              order,
              orderShipment
            ),
            shippingCost: orderShipment.shippingCost ?? 0,
            shippingMethodId: orderShipment.shippingMethodId,
            shippingTermId: orderShipment.shippingTermId,
            incoterm: orderShipment.incoterm,
            incotermLocation: orderShipment.incotermLocation,
            companyId,
            createdBy: userId
          })
          .execute();

        const salesInvoiceLines = uninvoicedLines?.reduce<
          Database["public"]["Tables"]["salesInvoiceLine"]["Insert"][]
        >((acc, line) => {
          if (
            line?.quantityToInvoice &&
            line.quantityToInvoice > 0 &&
            !line.invoicedComplete
          ) {
            acc.push({
              invoiceId: salesInvoiceId,
              invoiceLineType: line.salesOrderLineType,
              salesOrderId: line.salesOrderId,
              salesOrderLineId: line.id,
              methodType: line.methodType,
              itemId: line.itemId,
              locationId: line.locationId,
              storageUnitId: line.storageUnitId,
              accountId: line.accountId,
              assetId: line.assetId,
              description: line.description,
              quantity: line.quantityToInvoice,
              unitPrice: line.unitPrice ?? 0,
              addOnCost: line.addOnCost ?? 0,
              nonTaxableAddOnCost: line.nonTaxableAddOnCost ?? 0,
              shippingCost: line.shippingCost ?? 0,
              taxPercent: line.taxPercent ?? 0,
              unitOfMeasureCode: line.unitOfMeasureCode ?? "EA",
              exchangeRate: line.exchangeRate ?? 1,
              serviceStartDate: line.serviceStartDate ?? null,
              serviceEndDate: line.serviceEndDate ?? null,
              sortOrder: line.sortOrder ?? 1,
              companyId,
              createdBy: userId
            });
          }
          return acc;
        }, []);

        if (salesInvoiceLines.length > 0) {
          await trx
            .insertInto("salesInvoiceLine")
            .values(salesInvoiceLines)
            .execute();
        }
      });

      return { id: salesInvoiceId };
    }
    case "supplierQuoteToPurchaseOrder": {
      const { selectedLines } = payload;

      const [quote, quoteLines, company, employeeJob] = await inOrder([
        () => single(db, "supplierQuote", { id, companyId }),
        () =>
          many<
            "supplierQuoteLine",
            rows.Tables["supplierQuoteLine"]["Row"] & {
              item: Pick<rows.Tables["item"]["Row"], "type"> | null;
            }
          >(
            db,
            "supplierQuoteLine",
            { supplierQuoteId: id, companyId },
            {
              embed: {
                item: { table: "item", via: "itemId", columns: ["type"] }
              }
            }
          ),
        () => single(db, "company", { id: companyId }),
        () => single(db, "employeeJob", { id: userId, companyId })
      ]);

      if (quote.error) throw new NotFoundError(`Quote with id ${id} not found`);
      if (quoteLines.error)
        throw new NotFoundError(`Quote Lines with id ${id} not found`);

      const [supplierPayment, supplierShipping, supplier, pickMethods] =
        await inOrder([
          () =>
            single(db, "supplierPayment", {
              supplierId: quote.data.supplierId,
              companyId
            }),
          () =>
            single(db, "supplierShipping", {
              supplierId: quote.data.supplierId,
              companyId
            }),
          () =>
            single(db, "supplier", { id: quote.data.supplierId, companyId }),

          () =>
            many(db, "pickMethod", {
              itemId: quoteLines.data.map((line) => line.itemId as string),
              locationId: employeeJob.data?.locationId ?? "",
              companyId
            })
        ]);

      if (supplierPayment.error) throw supplierPayment.error;
      if (supplierShipping.error) throw supplierShipping.error;
      if (supplier.error) throw supplier.error;

      let insertedPurchaseOrderId = "";
      await db.transaction().execute(async (trx) => {
        const purchaseOrderId = await getNextSequence(
          trx,
          "purchaseOrder",
          companyId
        );

        const purchaseOrder = await trx
          .insertInto("purchaseOrder")
          .values([
            {
              purchaseOrderId,
              purchaseOrderType: quote.data.supplierQuoteType,
              supplierId: quote.data.supplierId,
              supplierContactId: quote.data.supplierContactId,
              supplierLocationId: quote.data.supplierLocationId,
              supplierReference: quote.data.supplierReference,
              supplierInteractionId: quote.data.supplierInteractionId,
              createdBy: userId,
              companyId: companyId,
              currencyCode:
                quote.data.currencyCode ??
                supplier.data?.currencyCode ??
                company.data?.baseCurrencyCode ??
                "USD",
              exchangeRate: quote.data.exchangeRate ?? 1,
              exchangeRateUpdatedAt:
                quote.data.exchangeRateUpdatedAt ?? datetime.timestamp()
            }
          ])
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!purchaseOrder.id) {
          throw new Error("purchase order is not created");
        }
        insertedPurchaseOrderId = purchaseOrder.id;

        await Promise.all([
          trx
            .insertInto("purchaseOrderPayment")
            .values({
              id: insertedPurchaseOrderId,
              invoiceSupplierId: supplierPayment.data.invoiceSupplierId,
              invoiceSupplierContactId:
                supplierPayment.data.invoiceSupplierContactId,
              invoiceSupplierLocationId:
                supplierPayment.data.invoiceSupplierLocationId,
              paymentTermId: supplierPayment.data.paymentTermId,
              companyId: companyId
            })
            .execute(),
          trx
            .insertInto("purchaseOrderDelivery")
            .values({
              id: insertedPurchaseOrderId,
              locationId: employeeJob.data?.locationId,
              shippingMethodId: supplierShipping.data.shippingMethodId,
              shippingTermId: supplierShipping.data.shippingTermId,
              incoterm: supplierShipping.data.incoterm,
              incotermLocation: supplierShipping.data.incotermLocation,
              companyId: companyId
            })
            .execute()
        ]);

        const purchaseOrderLineInserts: Database["public"]["Tables"]["purchaseOrderLine"]["Insert"][] =
          quoteLines.data
            .filter(
              (line) =>
                line.id &&
                selectedLines &&
                line.id in selectedLines &&
                selectedLines[line.id]!.quantity > 0
            )
            .map((line) => {
              const isIndirect = line.supplierQuoteLineType === "G/L Account";
              return {
                purchaseOrderId: insertedPurchaseOrderId,
                purchaseOrderLineType: isIndirect
                  ? ("G/L Account" as const)
                  : (line.item?.type as "Part"),
                description: line.description,
                itemId: isIndirect ? null : line.itemId,
                accountId: isIndirect ? line.accountId : null,
                costCenterId: isIndirect ? line.costCenterId : null,
                locationId: isIndirect ? null : employeeJob.data?.locationId,
                storageUnitId:
                  pickMethods.data?.find(
                    (method) => method.itemId === line.itemId
                  )?.defaultStorageUnitId ?? null,
                exchangeRate: quote.data.exchangeRate ?? 1,
                conversionFactor: line.conversionFactor,
                internalNotes: toJson(line.internalNotes),
                externalNotes: toJson(line.externalNotes),
                purchaseQuantity: selectedLines![line.id!]!.quantity,
                inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode,
                purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
                supplierUnitPrice: selectedLines![line.id!]!.supplierUnitPrice,
                supplierShippingCost:
                  selectedLines![line.id!]!.supplierShippingCost,
                supplierTaxAmount: selectedLines![line.id!]!.supplierTaxAmount,
                taxPercent: resolveTaxPercent(selectedLines![line.id!]!),
                sortOrder: line.sortOrder ?? 1,
                createdBy: userId,
                companyId
              };
            });

        if (purchaseOrderLineInserts.length > 0) {
          await trx
            .insertInto("purchaseOrderLine")
            .values(purchaseOrderLineInserts)
            .execute();

          const itemIdsToActivate = purchaseOrderLineInserts
            .map((insert) => insert.itemId)
            .filter((id): id is string => !!id);
          if (itemIdsToActivate.length > 0) {
            await trx
              .updateTable("item")
              .set({ active: true })
              .where("id", "in", itemIdsToActivate)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        // Record the ordered prices in the supplier's price list, as quoted:
        // per purchase unit, in the quote's currency. A part created here
        // takes that currency; an existing part keeps its own and gets the
        // price converted into it.
        const pricedLines = quoteLines.data.filter(
          (line) =>
            !!line.itemId &&
            line.id &&
            selectedLines &&
            line.id in selectedLines
        );

        // One supplier part per item; the later line wins.
        const supplierPartInserts = [
          ...new Map(
            pricedLines.map((line) => [
              line.itemId!,
              {
                companyId,
                supplierId: quote.data.supplierId,
                supplierPartId: line.supplierPartId,
                supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
                conversionFactor: line.conversionFactor ?? 1,
                currencyCode: quote.data.currencyCode,
                itemId: line.itemId!,
                createdBy: userId
              }
            ])
          ).values()
        ];

        if (supplierPartInserts.length > 0) {
          await trx
            .insertInto("supplierPart")
            .values(supplierPartInserts)
            .onConflict((oc) =>
              oc
                .columns(["itemId", "supplierId", "companyId"])
                .doUpdateSet((eb) => ({
                  supplierPartId: eb.ref("excluded.supplierPartId")
                }))
            )
            .execute();

          const supplierParts = await trx
            .selectFrom("supplierPart")
            .select(["id", "itemId", "currencyCode"])
            .where("supplierId", "=", quote.data.supplierId)
            .where("companyId", "=", companyId)
            .where(
              "itemId",
              "in",
              supplierPartInserts.map((insert) => insert.itemId)
            )
            .execute();
          const supplierPartByItemId = new Map(
            supplierParts.map((sp) => [sp.itemId, sp])
          );

          const converter = await getSupplierPartPriceConverter(
            trx,
            companyId,
            {
              currencyCode: quote.data.currencyCode,
              exchangeRate: quote.data.exchangeRate ?? 1
            },
            supplierParts.map((sp) => sp.currencyCode)
          );

          // One break per (part, quantity); the later line wins.
          const priceBreaks = new Map<
            string,
            Database["public"]["Tables"]["supplierPartPrice"]["Insert"]
          >();
          for (const line of pricedLines) {
            const supplierPart = supplierPartByItemId.get(line.itemId!);
            if (!supplierPart) continue;
            const selectedLine = selectedLines![line.id!]!;
            priceBreaks.set(`${supplierPart.id}:${selectedLine.quantity}`, {
              supplierPartId: supplierPart.id,
              quantity: selectedLine.quantity,
              supplierUnitPrice: converter.toPartCurrency(
                selectedLine.supplierUnitPrice,
                supplierPart.currencyCode
              ),
              leadTime: selectedLine.leadTime ?? 0,
              sourceType: "Purchase Order",
              sourceDocumentId: insertedPurchaseOrderId,
              companyId,
              createdBy: userId,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            });
          }

          if (priceBreaks.size > 0) {
            await trx
              .insertInto("supplierPartPrice")
              .values([...priceBreaks.values()])
              .onConflict((oc) =>
                oc
                  .columns(["supplierPartId", "quantity"])
                  .doUpdateSet((eb) => ({
                    supplierUnitPrice: eb.ref("excluded.supplierUnitPrice"),
                    leadTime: eb.ref("excluded.leadTime"),
                    sourceType: eb.ref("excluded.sourceType"),
                    sourceDocumentId: eb.ref("excluded.sourceDocumentId"),
                    updatedBy: eb.ref("excluded.updatedBy"),
                    updatedAt: eb.ref("excluded.updatedAt")
                  }))
              )
              .execute();
          }

          // Each part's own price and minimum order quantity follow its
          // cheapest break.
          const supplierPartIds = supplierParts.map((sp) => sp.id);
          if (supplierPartIds.length > 0) {
            await sql`
                UPDATE "supplierPart" sp
                SET "supplierUnitPrice" = best."supplierUnitPrice",
                    "minimumOrderQuantity" = best."quantity"
                FROM (
                  SELECT DISTINCT ON ("supplierPartId")
                    "supplierPartId", "supplierUnitPrice", "quantity"
                  FROM "supplierPartPrice"
                  WHERE "supplierPartId" = ANY(${supplierPartIds}::text[])
                    AND "companyId" = ${companyId}
                  ORDER BY "supplierPartId", "supplierUnitPrice" ASC
                ) best
                WHERE sp."id" = best."supplierPartId"
                  AND sp."companyId" = ${companyId}
              `.execute(trx);
          }
        }
      });

      if (!insertedPurchaseOrderId) {
        throw new Error("Failed to insert purchase order");
      }

      // Create RFQ→PurchaseOrder links if this quote came from an RFQ
      const { data: linkedRfqs } = await many(
        db,
        "purchasingRfqToSupplierQuote",
        { supplierQuoteId: id, companyId },
        { columns: ["purchasingRfqId"] }
      );

      if (linkedRfqs && linkedRfqs.length > 0) {
        await insertRows(
          db,
          "purchasingRfqToPurchaseOrder",
          linkedRfqs.map((rfq) => ({
            purchasingRfqId: rfq.purchasingRfqId,
            purchaseOrderId: insertedPurchaseOrderId,
            companyId
          }))
        );
      }

      convertedId = insertedPurchaseOrderId;

      break;
    }

    case "warehouseTransferToShipment": {
      const warehouseTransferId = id;
      const [warehouseTransfer, warehouseTransferLines] = await inOrder([
        () =>
          maybeSingle(db, "warehouseTransfer", {
            id: warehouseTransferId,
            companyId
          }),
        () =>
          many(db, "warehouseTransferLine", {
            transferId: warehouseTransferId,
            companyId
          })
      ]);

      if (warehouseTransfer.error)
        throw new Error(warehouseTransfer.error.message);
      if (!warehouseTransfer.data)
        throw new NotFoundError("Warehouse transfer not found");
      if (warehouseTransferLines.error)
        throw new Error(warehouseTransferLines.error.message);

      let shipmentId = "";

      await db.transaction().execute(async (trx) => {
        // Create shipment for outbound transfer
        shipmentId = await getNextSequence(trx, "shipment", companyId);

        const shipment = await trx
          .insertInto("shipment")
          .values({
            shipmentId,
            status: "Draft",
            sourceDocument: "Outbound Transfer",
            sourceDocumentId: warehouseTransferId,
            sourceDocumentReadableId: warehouseTransfer.data!.transferId,
            locationId: warehouseTransfer.data!.fromLocationId,
            createdBy: userId,
            companyId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!shipment.id) throw new Error("Failed to create shipment");
        shipmentId = shipment.id;

        // Create shipment lines
        const shipmentLineInserts = warehouseTransferLines.data.map((line) => ({
          shipmentId,
          lineId: line.id,
          itemId: line.itemId,
          locationId: line.fromLocationId,
          storageUnitId: line.fromStorageUnitId,
          orderQuantity: line.quantity,
          shippedQuantity: 0,
          unitOfMeasure: line.unitOfMeasureCode || "EA",
          unitPrice: 0,
          companyId,
          createdBy: userId
        }));

        if (shipmentLineInserts.length > 0) {
          await trx
            .insertInto("shipmentLine")
            .values(shipmentLineInserts)
            .execute();
        }
      });

      convertedId = shipmentId;
      break;
    }

    case "warehouseTransferToReceipt": {
      const warehouseTransferId = id;
      const [warehouseTransfer, warehouseTransferLines] = await inOrder([
        () =>
          maybeSingle(db, "warehouseTransfer", {
            id: warehouseTransferId,
            companyId
          }),
        () =>
          many(db, "warehouseTransferLine", {
            transferId: warehouseTransferId,
            companyId
          })
      ]);

      if (warehouseTransfer.error)
        throw new Error(warehouseTransfer.error.message);
      if (!warehouseTransfer.data)
        throw new NotFoundError("Warehouse transfer not found");
      if (warehouseTransferLines.error)
        throw new Error(warehouseTransferLines.error.message);

      let receiptId = "";

      await db.transaction().execute(async (trx) => {
        // Create receipt for inbound transfer
        receiptId = await getNextSequence(trx, "receipt", companyId);

        const receipt = await trx
          .insertInto("receipt")
          .values({
            receiptId,
            status: "Draft",
            sourceDocument: "Inbound Transfer",
            sourceDocumentId: warehouseTransferId,
            sourceDocumentReadableId: warehouseTransfer.data!.transferId,
            locationId: warehouseTransfer.data!.toLocationId,
            createdBy: userId,
            companyId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!receipt.id) throw new Error("Failed to create receipt");
        receiptId = receipt.id;

        // Create receipt lines
        const receiptLineInserts = warehouseTransferLines.data.map((line) => ({
          receiptId,
          lineId: line.id,
          itemId: line.itemId,
          locationId: line.toLocationId,
          storageUnitId: line.toStorageUnitId,
          orderQuantity: line.quantity,
          receivedQuantity: 0,
          unitOfMeasure: line.unitOfMeasureCode || "EA",
          unitPrice: 0,
          companyId,
          createdBy: userId
        }));

        if (receiptLineInserts.length > 0) {
          await trx
            .insertInto("receiptLine")
            .values(receiptLineInserts)
            .execute();
        }
      });

      convertedId = receiptId;
      break;
    }

    default:
      throw new Error(`Invalid type  ${type}`);
  }

  return { convertedId };
}

/** A server function's refusal as this function's error, mapped as `run`
 *  maps it; an empty message (our own failure) is `fallback`. */
export function fromServerFn(
  ctx: ServiceContext,
  error: { status: number; message: string },
  fallback: string
): CarbonError {
  return serverFnRefusal(ctx, error, fallback);
}
const createDocumentLogger = getLogger("server-functions", "create");

// Resolves a fallback location when a caller omits locationId, so creating a
// blank shipment degrades gracefully instead of failing payload validation.
// Prefers the creating user's assigned employeeJob location, then the company's
// earliest-created location. Only safe where locationId does not scope which
// source-document lines are shipped (i.e. shipmentDefault).
async function getFallbackLocationId(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string
): Promise<string | null> {
  const employeeJob = await maybeSingle(
    db,
    "employeeJob",
    { id: userId, companyId },
    { columns: ["locationId"] }
  );
  if (employeeJob.data?.locationId) return employeeJob.data.locationId;

  const location = await maybeSingle(
    db,
    "location",
    { companyId },
    { columns: ["id"], orderBy: ["createdAt"], limit: 1 }
  );
  return location.data?.id ?? null;
}

async function receiptQuantitiesStartAtZero(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<boolean> {
  const row = await db
    .selectFrom("companySettings")
    .select("receiptQuantitiesStartAtZero")
    .where("id", "=", companyId)
    .executeTakeFirst();
  return row?.receiptQuantitiesStartAtZero === true;
}

export const createDocumentPermission = {
  by: "type",
  rules: {
    nonConformanceTasks: { update: "quality" },
    purchaseOrderFromJob: { create: ["purchasing", "production"] },
    receiptDefault: { create: "inventory" },
    receiptFromPurchaseOrder: { create: "inventory" },
    receiptFromInboundTransfer: { create: "inventory" },
    receiptFromSalesReturnOrder: { create: "inventory" },
    receiptFromWarehouseTransfer: { create: "inventory" },
    receiptLineSplit: { create: "inventory" },
    shipmentDefault: { create: "inventory" },
    shipmentFromPurchaseOrder: { create: "inventory" },
    shipmentFromWarehouseTransfer: { create: "inventory" },
    shipmentFromPurchaseReturnOrder: { create: "inventory" },
    shipmentFromSalesOrder: { create: "inventory" },
    shipmentFromSalesReturnOrder: { create: "inventory" },
    shipmentFromSalesOrderLine: { create: "inventory" },
    shipmentLineSplit: { create: "inventory" },
    shipmentFromRentalAgreement: { create: "inventory" },
    receiptFromRentalAgreement: { create: "inventory" },
    journalEntry: { create: "accounting" }
  }
} satisfies PermissionRule<z.output<typeof createInput>>;

/** Creates receipts, shipments, NCR tasks, purchase orders and journal entries, per `type`. */
export async function createDocument(
  ctx: ServiceContext,
  raw: CreateInput
): Promise<CreateResult> {
  const input = createInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const payload = { ...input, companyId, userId };
  const { type } = payload;

  // Every receipt/shipment type writes the body's locationId onto the new
  // document (and its lines); the FK alone accepts another company's location.
  await assertCompanyRecords(
    db,
    "location",
    ["locationId" in payload ? payload.locationId : undefined],
    companyId,
    "Location"
  );

  switch (payload.type) {
    case "nonConformanceTasks": {
      const { id } = payload;

      createDocumentLogger.info({ type, id });

      const [nonConformance, actionTasks, approvalTasks, existingReviewers] =
        await inOrder([
          () => maybeSingle(db, "nonConformance", { id, companyId }),
          () =>
            many(db, "nonConformanceActionTask", {
              nonConformanceId: id,
              companyId
            }),
          () =>
            many(db, "nonConformanceApprovalTask", {
              nonConformanceId: id,
              companyId
            }),
          () =>
            many(db, "nonConformanceReviewer", {
              nonConformanceId: id,
              companyId
            })
        ]);

      if (nonConformance.error) throw new Error(nonConformance.error.message);
      if (!nonConformance.data)
        throw new NotFoundError("Non-conformance not found");

      const workflow = nonConformance.data?.nonConformanceWorkflowId
        ? await maybeSingle(db, "nonConformanceWorkflow", {
            id: nonConformance.data?.nonConformanceWorkflowId,
            companyId
          })
        : null;

      if (workflow?.error) throw new Error(workflow.error.message);

      const currentActionTasks =
        actionTasks.data?.reduce<Record<string, string>>((acc, d) => {
          if (d.actionTypeId && !acc[d.actionTypeId]) {
            acc[d.actionTypeId] = d.id;
          }
          return acc;
        }, {}) ?? {};

      const currentApprovalTasks =
        approvalTasks.data?.reduce<Record<string, string>>((acc, d) => {
          if (d.approvalType && !acc[d.approvalType]) {
            acc[d.approvalType] = d.id;
          }
          return acc;
        }, {}) ?? {};

      const actionTasksToDelete: string[] = [];
      const approvalTasksToDelete: string[] = [];
      const reviewersToDelete: string[] = [];

      Object.keys(currentActionTasks).forEach((actionTypeId) => {
        if (
          !(nonConformance.data?.requiredActionIds ?? []).some(
            (d) => d === actionTypeId
          )
        ) {
          actionTasksToDelete.push(currentActionTasks[actionTypeId]!);
        }
      });

      Object.keys(currentApprovalTasks).forEach((approvalType) => {
        if (
          !(nonConformance.data?.approvalRequirements ?? []).some(
            (d) => d === approvalType
          )
        ) {
          approvalTasksToDelete.push(currentApprovalTasks[approvalType]!);
        }
      });

      const actionTaskInserts: Database["public"]["Tables"]["nonConformanceActionTask"]["Insert"][] =
        [];
      const approvalTaskInserts: Database["public"]["Tables"]["nonConformanceApprovalTask"]["Insert"][] =
        [];

      const reviewerInserts: Database["public"]["Tables"]["nonConformanceReviewer"]["Insert"][] =
        [];

      nonConformance.data?.requiredActionIds?.forEach((actionTypeId, index) => {
        if (!currentActionTasks[actionTypeId]) {
          actionTaskInserts.push({
            nonConformanceId: id,
            actionTypeId,
            sortOrder: index + 1,
            companyId,
            createdBy: userId
          });
        }
      });

      nonConformance.data?.approvalRequirements?.forEach((approvalType) => {
        if (!currentApprovalTasks[approvalType]) {
          approvalTaskInserts.push({
            nonConformanceId: id,
            approvalType,
            companyId,
            createdBy: userId
          });
        }
      });

      // Check if MRB approval is required
      const hasMRBApproval =
        Array.isArray(nonConformance.data?.approvalRequirements) &&
        nonConformance.data?.approvalRequirements.includes("MRB");

      const hasExistingMRBTask =
        Object.keys(currentApprovalTasks).includes("MRB");
      const hasExistingReviewers = (existingReviewers.data?.length ?? 0) > 0;

      // If MRB is no longer required but we have existing reviewers, delete them
      if (!hasMRBApproval && hasExistingReviewers) {
        existingReviewers.data?.forEach((reviewer) => {
          reviewersToDelete.push(reviewer.id);
        });
      }
      // Only add reviewers if MRB is required and either:
      // 1. MRB task is newly added (not in currentApprovalTasks)
      // 2. There are no existing reviewers
      else if (
        hasMRBApproval &&
        (!hasExistingMRBTask || !hasExistingReviewers)
      ) {
        reviewerInserts.push({
          nonConformanceId: id,
          title: "Engineering",
          companyId,
          createdBy: userId
        });

        reviewerInserts.push({
          nonConformanceId: id,
          title: "Quality",
          companyId,
          createdBy: userId
        });
      }

      await db.transaction().execute(async (trx) => {
        if (
          typeof nonConformance.data?.content === "object" &&
          // @ts-ignore -- content is json
          Object.keys(nonConformance.data?.content ?? {}).length === 0
        ) {
          const contentFromWorkflow =
            (workflow?.data?.content as { content?: unknown[] } | null)
              ?.content ?? [];
          const insertedContent = {
            type: "doc",
            content: contentFromWorkflow
          };

          if (nonConformance.data?.description) {
            insertedContent.content.unshift({
              type: "paragraph",
              content: [
                { type: "text", text: nonConformance.data?.description }
              ]
            });
          }

          createDocumentLogger.debug({
            description: nonConformance.data?.description,
            insertedContent
          });

          if (insertedContent.content.length > 0) {
            await trx
              .updateTable("nonConformance")
              .set({
                content: JSON.stringify(insertedContent)
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        if (actionTaskInserts.length > 0) {
          await trx
            .insertInto("nonConformanceActionTask")
            .values(actionTaskInserts)
            .execute();
        }
        if (approvalTaskInserts.length > 0) {
          await trx
            .insertInto("nonConformanceApprovalTask")
            .values(approvalTaskInserts)
            .execute();
        }

        if (actionTasksToDelete.length > 0) {
          await trx
            .deleteFrom("nonConformanceActionTask")
            .where("id", "in", actionTasksToDelete)
            .where("companyId", "=", companyId)
            .execute();
        }
        if (approvalTasksToDelete.length > 0) {
          await trx
            .deleteFrom("nonConformanceApprovalTask")
            .where("id", "in", approvalTasksToDelete)
            .where("companyId", "=", companyId)
            .execute();
        }

        if (reviewerInserts.length > 0) {
          await trx
            .insertInto("nonConformanceReviewer")
            .values(reviewerInserts)
            .execute();
        }

        if (reviewersToDelete.length > 0) {
          await trx
            .deleteFrom("nonConformanceReviewer")
            .where("id", "in", reviewersToDelete)
            .where("companyId", "=", companyId)
            .execute();
        }
      });
      return { success: true };
    }

    case "purchaseOrderFromJob": {
      const { jobId, purchaseOrdersBySupplierId } = payload;
      // The PO each supplier's lines landed on (created or chosen), so a caller
      // releasing several jobs can put them on one PO per supplier.
      const purchaseOrderIdsBySupplierId: Record<string, string> = {};

      createDocumentLogger.info({ type, jobId, companyId, userId });
      const [job, jobOperations] = await inOrder([
        () => maybeSingle(db, "job", { id: jobId, companyId }),
        () =>
          many<
            "jobOperation",
            rowsModule.Tables["jobOperation"]["Row"] & {
              jobMakeMethod: Pick<
                rowsModule.Tables["jobMakeMethod"]["Row"],
                "itemId"
              > | null;
            }
          >(
            db,
            "jobOperation",
            { jobId, companyId },
            {
              embed: {
                jobMakeMethod: {
                  table: "jobMakeMethod",
                  via: "jobMakeMethodId",
                  columns: ["itemId"]
                }
              }
            }
          )
      ]);

      if (job.error) throw new Error(job.error.message);
      if (!job.data) throw new NotFoundError("Job not found");
      if (jobOperations.error) throw new Error(jobOperations.error.message);

      // Caller-chosen existing POs must belong to this company — lines are
      // appended to them by id below.
      await assertCompanyRecords(
        db,
        "purchaseOrder",
        Object.values(
          purchaseOrdersBySupplierId as Record<string, string>
        ).filter((poId) => poId && poId !== "new"),
        companyId,
        "Purchase order"
      );

      const outsideOperations = jobOperations.data?.filter(
        (d) => d.operationType === "Outside Processing"
      );

      if (outsideOperations.length > 0) {
        const supplierProcessIds = new Set(
          outsideOperations
            .map((d) => d.operationSupplierProcessId)
            .filter(Boolean)
        );
        const outsideProcessIds = new Set(
          outsideOperations.map((d) => d.processId).filter(Boolean)
        );
        const [
          supplierProcesses,
          supplierProcessesByProcess,
          existingPurchaseOrderLines
        ] = await inOrder([
          () =>
            supplierProcessIds.size > 0
              ? many(db, "supplierProcess", {
                  id: Array.from(supplierProcessIds) as string[],
                  companyId
                })
              : Promise.resolve({ data: [], error: null }),
          () =>
            outsideProcessIds.size > 0
              ? many(db, "supplierProcess", {
                  processId: Array.from(outsideProcessIds),
                  companyId
                })
              : Promise.resolve({ data: [], error: null }),
          () =>
            many(db, "purchaseOrderLine", {
              jobId,
              companyId,
              jobOperationId: outsideOperations.map((d) => d.id)
            })
        ]);

        if (supplierProcesses.error)
          throw new Error(supplierProcesses.error.message);
        if (supplierProcessesByProcess.error)
          throw new Error(supplierProcessesByProcess.error.message);

        // Resolve an operation's supplier process: its own, or — when it has none
        // — the sole supplier configured for its process (a process with exactly
        // one supplier is unambiguous). Mirrors the release modal's resolution so
        // an operation the modal counted as "has a supplier" actually gets a PO.
        const allSupplierProcesses = [
          ...(supplierProcesses.data ?? []),
          ...(supplierProcessesByProcess.data ?? [])
        ];
        const supplierProcessById = new Map(
          allSupplierProcesses.map((sp) => [sp.id, sp])
        );
        const supplierProcessesByProcessId = new Map<
          string,
          typeof allSupplierProcesses
        >();
        for (const sp of supplierProcessesByProcess.data ?? []) {
          const list = supplierProcessesByProcessId.get(sp.processId) ?? [];
          list.push(sp);
          supplierProcessesByProcessId.set(sp.processId, list);
        }
        const resolveSupplierProcess = (oo: {
          operationSupplierProcessId: string | null;
          processId: string | null;
        }) => {
          if (oo.operationSupplierProcessId) {
            return supplierProcessById.get(oo.operationSupplierProcessId);
          }
          const candidates = oo.processId
            ? (supplierProcessesByProcessId.get(oo.processId) ?? [])
            : [];
          return candidates.length === 1 ? candidates[0] : undefined;
        };

        const outsideOperationsBySupplierId = outsideOperations.reduce<
          Record<
            string,
            (Database["public"]["Tables"]["jobOperation"]["Row"] & {
              jobMakeMethod: { itemId: string } | null;
            })[]
          >
        >((acc, oo) => {
          const supplierProcess = resolveSupplierProcess(oo);
          if (
            existingPurchaseOrderLines.data?.find(
              (d) => d.jobOperationId === oo.id
            )
          ) {
            return acc;
          }
          if (!supplierProcess) return acc;
          if (!acc[supplierProcess.supplierId]) {
            acc[supplierProcess.supplierId] = [];
          }
          acc[supplierProcess.supplierId]!.push(oo);
          return acc;
        }, {});

        const supplierIds = new Set(Object.keys(outsideOperationsBySupplierId));
        const itemIds = new Set(
          outsideOperations.map((d) => d.jobMakeMethod?.itemId).filter(Boolean)
        );

        const [suppliers, supplierPayments, supplierShipping, items] =
          await inOrder([
            () =>
              many(db, "supplier", {
                id: Array.from(supplierIds),
                companyId
              }),
            () =>
              many(db, "supplierPayment", {
                supplierId: Array.from(supplierIds),
                companyId
              }),
            () =>
              many(db, "supplierShipping", {
                supplierId: Array.from(supplierIds),
                companyId
              }),
            () =>
              many(db, "item", {
                id: Array.from(itemIds) as string[],
                companyId
              })
          ]);

        if (suppliers.error) throw new Error(suppliers.error.message);
        if (supplierPayments.error)
          throw new Error(supplierPayments.error.message);
        if (supplierShipping.error)
          throw new Error(supplierShipping.error.message);

        // A supplier with no configured currency means "the company's own
        // base currency" (rate 1 by definition) -- never a hardcoded USD,
        // which is only correct for USD-base companies.
        const companyRecord = await single(
          db,
          "company",
          { id: companyId },
          { columns: ["baseCurrencyCode"] }
        );
        if (companyRecord.error) {
          throw new Error(companyRecord.error.message);
        }
        const baseCurrencyCode = companyRecord.data.baseCurrencyCode;

        const currencyCodes = new Set(
          suppliers.data?.map((d) => d.currencyCode ?? baseCurrencyCode)
        );

        // get_exchange_rate raises on a missing rate -- a resolver error
        // must fail the operation rather than default the rate.
        const exchangeRates = await Promise.all(
          Array.from(currencyCodes).map(async (currencyCode) => {
            const exchangeRate = await rpcValue(db, "get_exchange_rate", {
              p_company_id: companyId,
              p_currency_code: currencyCode
            });
            if (exchangeRate.error) {
              throw new Error(exchangeRate.error.message);
            }
            return {
              currencyCode,
              exchangeRate: Number(exchangeRate.data)
            };
          })
        );

        await db.transaction().execute(async (trx) => {
          for await (const supplier of Object.keys(
            outsideOperationsBySupplierId
          )) {
            const outsideOperations = outsideOperationsBySupplierId[supplier];

            const payment = supplierPayments.data?.find(
              (d) => d.supplierId === supplier
            );
            const shipping = supplierShipping.data?.find(
              (d) => d.supplierId === supplier
            );

            const supplierCurrencyCode =
              suppliers.data?.find((d) => d.id === supplier)?.currencyCode ??
              baseCurrencyCode;
            const exchangeRate = exchangeRates.find(
              (d) => d.currencyCode === supplierCurrencyCode
            )?.exchangeRate;
            if (exchangeRate === undefined) {
              throw new Error(
                `No exchange rate resolved for currency ${supplierCurrencyCode}`
              );
            }

            let purchaseOrderId =
              purchaseOrdersBySupplierId[supplier] === "new"
                ? undefined
                : purchaseOrdersBySupplierId[supplier];

            if (!purchaseOrderId) {
              const supplierInteraction = await trx
                .insertInto("supplierInteraction")
                .values({
                  companyId,
                  supplierId: supplier
                })
                .returning(["id"])
                .execute();

              const supplierInteractionId = supplierInteraction?.[0]?.id;
              const nextSequence = await getNextSequence(
                trx,
                "purchaseOrder",
                companyId
              );

              if (!nextSequence) throw new Error("Failed to get next sequence");
              if (!supplierInteractionId)
                throw new Error("Failed to create supplier interaction");

              const order = await trx
                .insertInto("purchaseOrder")
                .values({
                  purchaseOrderId: nextSequence,
                  status: "Draft",
                  supplierId: supplier,
                  jobId: jobId,
                  jobReadableId: job.data?.jobId,
                  companyId: companyId,
                  createdBy: userId,
                  purchaseOrderType: "Outside Processing",
                  supplierInteractionId: supplierInteractionId,
                  currencyCode: supplierCurrencyCode,
                  exchangeRate,
                  exchangeRateUpdatedAt: datetime.timestamp()
                })
                .returning(["id"])
                .execute();

              if (!order?.[0]?.id)
                throw new Error("Failed to create purchase order");

              purchaseOrderId = order[0].id;

              // Create purchase order delivery and payment
              const locationId = job.data?.locationId ?? null; // Default location
              const shippingMethodId = shipping?.shippingMethodId;
              const shippingTermId = shipping?.shippingTermId;

              const paymentTermId = payment?.paymentTermId;
              const invoiceSupplierId = payment?.invoiceSupplierId;
              const invoiceSupplierContactId =
                payment?.invoiceSupplierContactId;
              const invoiceSupplierLocationId =
                payment?.invoiceSupplierLocationId;

              await Promise.all([
                trx
                  .insertInto("purchaseOrderDelivery")
                  .values({
                    id: purchaseOrderId,
                    locationId,
                    shippingMethodId,
                    shippingTermId,
                    companyId
                  })
                  .execute(),
                trx
                  .insertInto("purchaseOrderPayment")
                  .values({
                    id: purchaseOrderId,
                    invoiceSupplierId,
                    invoiceSupplierContactId,
                    invoiceSupplierLocationId,
                    paymentTermId,
                    companyId
                  })
                  .execute()
              ]);
            }

            purchaseOrderIdsBySupplierId[supplier] = purchaseOrderId;

            const purchaseOrderLineInserts: Database["public"]["Tables"]["purchaseOrderLine"]["Insert"][] =
              [];

            // Create purchase order lines for each process
            for await (const operation of outsideOperations!) {
              // Get the item associated with the operation
              const item = items.data?.find(
                (d) => d.id === operation.jobMakeMethod?.itemId
              );
              const supplierProcess = resolveSupplierProcess(operation);

              if (item && supplierProcess) {
                const totalCostWithUnitPrice =
                  (operation.operationUnitCost ?? 0) *
                  (operation.operationQuantity ?? 0);
                const totalCostWithMinimumCost =
                  (operation.operationMinimumCost ?? 0) > totalCostWithUnitPrice
                    ? (operation.operationMinimumCost ?? 0)
                    : totalCostWithUnitPrice;

                // Create purchase order line
                purchaseOrderLineInserts.push({
                  purchaseOrderId,
                  purchaseOrderLineType: item.type,
                  itemId: item.id,
                  description: item.name || item.description,
                  purchaseQuantity: operation.operationQuantity || 1,
                  purchaseUnitOfMeasureCode: item.unitOfMeasureCode,
                  inventoryUnitOfMeasureCode: item.unitOfMeasureCode,
                  conversionFactor: 1,
                  supplierUnitPrice:
                    operation.operationQuantity &&
                    operation.operationQuantity > 0
                      ? totalCostWithMinimumCost / operation.operationQuantity
                      : totalCostWithMinimumCost,
                  locationId: job.data?.locationId,
                  jobId: job.data?.id,
                  jobOperationId: operation.id,
                  companyId,
                  createdBy: userId,
                  exchangeRate
                });
              }
            }

            // Insert all purchase order lines
            if (purchaseOrderLineInserts.length > 0) {
              await trx
                .insertInto("purchaseOrderLine")
                .values(purchaseOrderLineInserts)
                .execute();
            }
          }
        });
      }

      return { success: true, purchaseOrderIdsBySupplierId };
    }
    case "receiptDefault": {
      const { locationId } = payload;
      let createdDocumentId;
      createDocumentLogger.info({ type, locationId, companyId, userId });
      const id = await db.transaction().execute(async (trx) => {
        createdDocumentId = await getNextSequence(trx, "receipt", companyId);
        const newReceipt = await trx
          .insertInto("receipt")
          .values({
            receiptId: createdDocumentId,
            companyId: companyId,
            locationId: locationId,
            createdBy: userId
          })
          .returning(["id", "receiptId"])
          .execute();

        createdDocumentId = newReceipt?.[0]?.id;
        if (!createdDocumentId) throw new Error("Failed to create receipt");
        return createdDocumentId;
      });

      return { id };
    }
    case "receiptFromPurchaseOrder": {
      const {
        purchaseOrderId,
        receiptId: existingReceiptId,
        locationId: userLocationId
      } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        purchaseOrderId,
        existingReceiptId,
        userLocationId,
        userId
      });

      const [purchaseOrder, purchaseOrderLines, fixedAssetPoLines, receipt] =
        await inOrder([
          () =>
            single(db, "purchaseOrders", { companyId, id: purchaseOrderId }),
          () =>
            many(db, "purchaseOrderLine", {
              companyId,
              purchaseOrderId,
              purchaseOrderLineType: [
                "Part",
                "Material",
                "Tool",
                "Fixture",
                "Consumable"
              ]
            }),
          () =>
            many(
              db,
              "purchaseOrderLine",
              {
                companyId,
                purchaseOrderId,
                purchaseOrderLineType: "Fixed Asset"
              },
              {
                columns: [
                  "id",
                  "purchaseOrderLineType",
                  "assetId",
                  "purchaseQuantity",
                  "quantityReceived",
                  "receivedComplete"
                ]
              }
            ),
          () =>
            maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
        ]);

      if (!purchaseOrder.data)
        throw new NotFoundError("Purchase order not found");
      if (purchaseOrderLines.error)
        throw new Error(purchaseOrderLines.error.message);

      let locationId = purchaseOrder.data.locationId;
      if (
        purchaseOrderLines.data.some(
          (d) => d.locationId !== locationId && d.locationId === userLocationId
        )
      ) {
        locationId = userLocationId ?? null;
      }

      const items = await many(
        db,
        "item",
        {
          companyId,
          id: purchaseOrderLines.data
            .filter((d) => d.locationId === locationId)
            .map((d) => d.itemId) as string[]
        },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // Map (itemId, locationId) -> defaultStorageUnitId. Receipt lines
      // fall back to the pickMethod-configured storage unit for their
      // destination location when the purchase order line doesn't pin
      // one explicitly. Scoped by locationId because a single item can
      // be stocked across multiple locations with different defaults
      // per location (that's why pickMethod exists).
      const receiptItemIds = purchaseOrderLines.data
        .filter((d): d is typeof d & { itemId: string } => !!d.itemId)
        .map((d) => d.itemId);
      const pickMethods = await many(
        db,
        "pickMethod",
        { companyId, itemId: receiptItemIds },
        { columns: ["itemId", "locationId", "defaultStorageUnitId"] }
      );
      const pickMethodKey = (itemId: string, loc: string | null) =>
        `${itemId}::${loc ?? ""}`;
      const defaultStorageUnitByItemLocation = new Map<string, string>();
      for (const row of pickMethods.data ?? []) {
        if (row.defaultStorageUnitId) {
          defaultStorageUnitByItemLocation.set(
            pickMethodKey(row.itemId, row.locationId),
            row.defaultStorageUnitId
          );
        }
      }

      // A supplied id that is not this company's receipt is a 404, not a
      // silent create-new.
      if (existingReceiptId && !receipt.data)
        throw new NotFoundError("Receipt not found");
      const hasReceipt = !!receipt.data?.id;
      const isOutsideOperation =
        purchaseOrder.data.purchaseOrderType === "Outside Processing";

      const previouslyReceivedQuantitiesByLine = (
        purchaseOrderLines.data ?? []
      ).reduce<Record<string, number>>((acc, d) => {
        if (d.id) acc[d.id] = d.quantityReceived ?? 0;
        return acc;
      }, {});

      const startAtZero = await receiptQuantitiesStartAtZero(db, companyId);

      const receiptLineItems = purchaseOrderLines.data.reduce<
        ReceiptLineItem[]
      >((acc, d) => {
        if (
          !d.itemId ||
          !d.purchaseQuantity ||
          d.receivedComplete ||
          d.purchaseOrderLineType === "Service" ||
          d.purchaseOrderLineType === "G/L Account"
        ) {
          return acc;
        }

        const unitPrice = d.unitPrice ?? 0;
        const outstandingQuantity =
          d.purchaseQuantity - (previouslyReceivedQuantitiesByLine[d.id!] ?? 0);

        const shippingAndTaxUnitCost =
          ((d.taxAmount ?? 0) + (d.shippingCost ?? 0)) /
          (d.purchaseQuantity * (d.conversionFactor ?? 1));

        acc.push({
          lineId: d.id,
          companyId: companyId,
          itemId: d.itemId,
          orderQuantity: d.purchaseQuantity * (d.conversionFactor ?? 1),
          outstandingQuantity: outstandingQuantity * (d.conversionFactor ?? 1),
          receivedQuantity: startAtZero
            ? 0
            : outstandingQuantity * (d.conversionFactor ?? 1),
          conversionFactor: d.conversionFactor ?? 1,
          requiresSerialTracking:
            serializedItems.has(d.itemId) && !isOutsideOperation,
          requiresBatchTracking:
            batchItems.has(d.itemId) && !isOutsideOperation,
          unitPrice:
            unitPrice / (d.conversionFactor ?? 1) + shippingAndTaxUnitCost,
          unitOfMeasure: d.inventoryUnitOfMeasureCode ?? "EA",
          locationId: d.locationId ?? null,
          storageUnitId:
            d.storageUnitId ??
            defaultStorageUnitByItemLocation.get(
              pickMethodKey(d.itemId!, d.locationId ?? null)
            ) ??
            null,
          createdBy: userId ?? ""
        });

        return acc;
      }, []);

      const hasUnreceivedFaLines = (fixedAssetPoLines.data ?? []).some(
        (d) => d.assetId && d.purchaseQuantity && !d.receivedComplete
      );
      if (receiptLineItems.length === 0 && !hasUnreceivedFaLines) {
        throw new Error("No valid receipt line items found");
      }

      let receiptId = hasReceipt ? receipt.data?.id! : "";
      let receiptIdReadable = hasReceipt ? receipt.data?.receiptId! : "";

      await db.transaction().execute(async (trx) => {
        if (hasReceipt) {
          // update existing receipt
          await trx
            .updateTable("receipt")
            .set({
              sourceDocument: "Purchase Order",
              sourceDocumentId: purchaseOrder.data.id,
              sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
              locationId: locationId,
              updatedBy: userId
            })
            .where("id", "=", receiptId)
            .returning(["id", "receiptId"])
            .where("companyId", "=", companyId)
            .execute();
          // delete existing receipt lines
          await trx
            .deleteFrom("receiptLine")
            .where("receiptId", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          receiptIdReadable = await getNextSequence(trx, "receipt", companyId);
          const newReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: receiptIdReadable,
              sourceDocument: "Purchase Order",
              sourceDocumentId: purchaseOrder.data.id,
              sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
              supplierId: purchaseOrder.data.supplierId,
              supplierInteractionId: purchaseOrder.data.supplierInteractionId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId
            })
            .returning(["id", "receiptId"])
            .execute();

          receiptId = newReceipt?.[0]?.id!;
          receiptIdReadable = newReceipt?.[0]?.receiptId!;
        }

        if (receiptLineItems.length > 0) {
          await trx
            .insertInto("receiptLine")
            .values(
              receiptLineItems.map((line) => ({
                ...line,
                receiptId: receiptId,
                locationId
              }))
            )
            .execute();
        }

        const unreceivedFaLines = (fixedAssetPoLines.data ?? []).filter(
          (d) => d.assetId && d.purchaseQuantity && !d.receivedComplete
        );
        if (unreceivedFaLines.length > 0) {
          await trx
            .deleteFrom("receiptFixedAssetLine")
            .where("receiptId", "=", receiptId)
            .where("companyId", "=", companyId)
            .execute();
          await trx
            .insertInto("receiptFixedAssetLine")
            .values(
              unreceivedFaLines.map((line) => ({
                receiptId: receiptId,
                purchaseOrderLineId: line.id,
                received: !startAtZero,
                companyId,
                createdBy: userId
              }))
            )
            .execute();
        }
      });

      return { id: receiptId };
    }
    case "receiptFromInboundTransfer": {
      const { warehouseTransferId, receiptId: existingReceiptId } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        warehouseTransferId,
        existingReceiptId,
        userId
      });

      const [warehouseTransfer, warehouseTransferLines, receipt] =
        await inOrder([
          () =>
            single(db, "warehouseTransfer", {
              companyId,
              id: warehouseTransferId
            }),
          () =>
            many(db, "warehouseTransferLine", {
              companyId,
              transferId: warehouseTransferId
            }),
          () =>
            maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
        ]);

      if (!warehouseTransfer.data)
        throw new NotFoundError("Warehouse transfer not found");
      if (warehouseTransferLines.error)
        throw new Error(warehouseTransferLines.error.message);

      const locationId = warehouseTransfer.data.toLocationId;

      const items = await many(
        db,
        "item",
        {
          companyId,
          id: warehouseTransferLines.data
            .map((d) => d.itemId)
            .filter(Boolean) as string[]
        },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's receipt is a 404, not a
      // silent create-new.
      if (existingReceiptId && !receipt.data)
        throw new NotFoundError("Receipt not found");
      const hasReceipt = !!receipt.data?.id;

      const previouslyReceivedQuantitiesByLine = (
        warehouseTransferLines.data ?? []
      ).reduce<Record<string, number>>((acc, d) => {
        if (d.id) acc[d.id] = d.receivedQuantity ?? 0;
        return acc;
      }, {});

      const startAtZero = await receiptQuantitiesStartAtZero(db, companyId);

      const receiptLineItems = warehouseTransferLines.data.reduce<
        ReceiptLineItem[]
      >((acc, d) => {
        if (!d.itemId || !d.quantity) return acc;

        const serialTracking = serializedItems.has(d.itemId);
        const batchTracking = batchItems.has(d.itemId);
        // For unshipped lines, we want all lines where shippedQuantity < quantity
        const quantityToReceive = Math.max(
          0,
          (d.shippedQuantity ?? 0) -
            (previouslyReceivedQuantitiesByLine[d.id] ?? 0)
        );

        if (quantityToReceive === 0) return acc;

        acc.push({
          lineId: d.id,
          itemId: d.itemId,
          locationId: d.toLocationId ?? locationId,
          storageUnitId: d.toStorageUnitId,
          requiresSerialTracking: serialTracking,
          requiresBatchTracking: batchTracking,
          receivedQuantity: startAtZero ? 0 : quantityToReceive,
          outstandingQuantity: quantityToReceive,
          unitPrice: 0, // Transfers don't have a unit price
          conversionFactor: 1,
          unitOfMeasure: d.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId,
          orderQuantity: d.quantity ?? 0
        });

        return acc;
      }, []);

      if (receiptLineItems.length === 0) {
        throw new Error("No lines to receive");
      }

      const result = await db.transaction().execute(async (trx) => {
        const receiptId = await getNextSequence(trx, "receipt", companyId);

        let id: string;
        if (hasReceipt) {
          id = receipt.data!.id;
          await trx
            .updateTable("receipt")
            .set({
              sourceDocument: "Inbound Transfer",
              sourceDocumentId: warehouseTransferId,
              sourceDocumentReadableId: warehouseTransfer.data.transferId,
              locationId,
              updatedBy: userId
            })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          const insertReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId,
              sourceDocument: "Inbound Transfer",
              sourceDocumentId: warehouseTransferId,
              sourceDocumentReadableId: warehouseTransfer.data.transferId,
              locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          id = insertReceipt[0]?.id ?? "";
        }

        await trx
          .deleteFrom("receiptLine")
          .where("receiptId", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .insertInto("receiptLine")
          .values(
            receiptLineItems.map((lineItem) => ({
              ...lineItem,
              receiptId: id
            }))
          )
          .execute();

        return { id };
      });

      return result;
    }
    case "receiptFromSalesReturnOrder": {
      const {
        salesReturnOrderId,
        receiptId: existingReceiptId,
        locationId: userLocationId
      } = payload;

      createDocumentLogger.info({
        function: "create",
        type,
        companyId,
        salesReturnOrderId,
        existingReceiptId,
        userId
      });

      const [salesReturnOrder, salesReturnOrderLines, receipt] = await inOrder([
        () =>
          single(db, "salesReturnOrder", {
            id: salesReturnOrderId,
            companyId
          }),
        () =>
          many(db, "salesReturnOrderLine", {
            salesReturnOrderId,
            companyId
          }),
        () => maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
      ]);

      if (!salesReturnOrder.data)
        throw new NotFoundError("Sales return order not found");
      if (salesReturnOrder.data.status !== "To Receive")
        throw new Error(
          `Cannot receive against a return order in ${salesReturnOrder.data.status} status`
        );
      if (salesReturnOrderLines.error)
        throw new Error(salesReturnOrderLines.error.message);

      const locationId =
        userLocationId ?? salesReturnOrder.data.locationId ?? null;
      if (!locationId)
        throw new Error(
          "The return order has no receiving location — set one before creating a receipt"
        );

      const returnItemIds = salesReturnOrderLines.data
        .map((d) => d.itemId)
        .filter(Boolean) as string[];
      const items = await many(
        db,
        "item",
        { companyId, id: returnItemIds },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      const pickMethods = await many(
        db,
        "pickMethod",
        { companyId, itemId: returnItemIds },
        { columns: ["itemId", "locationId", "defaultStorageUnitId"] }
      );
      const defaultStorageUnitByItem = new Map<string, string>();
      for (const row of pickMethods.data ?? []) {
        if (row.defaultStorageUnitId && row.locationId === locationId) {
          defaultStorageUnitByItem.set(row.itemId, row.defaultStorageUnitId);
        }
      }

      // A supplied id that is not this company's receipt is a 404, not a
      // silent create-new.
      if (existingReceiptId && !receipt.data)
        throw new NotFoundError("Receipt not found");
      const hasReceipt = !!receipt.data?.id;
      // Re-targeting deletes and rebuilds the lines — only a Draft may be
      // rebuilt; a Posted document's lines are referenced by ledger rows.
      if (hasReceipt && receipt.data!.status !== "Draft")
        throw new Error(`Cannot re-source a ${receipt.data!.status} receipt`);

      const startAtZero = await receiptQuantitiesStartAtZero(db, companyId);

      const receiptLineItems = salesReturnOrderLines.data.reduce<
        ReceiptLineItem[]
      >((acc, d) => {
        if (!d.itemId || !d.quantity || d.closedComplete) return acc;

        const outstanding = Math.max(
          0,
          (d.quantity ?? 0) - (d.quantityReceived ?? 0)
        );
        if (outstanding === 0) return acc;

        acc.push({
          lineId: d.id,
          itemId: d.itemId,
          locationId,
          storageUnitId: defaultStorageUnitByItem.get(d.itemId) ?? null,
          requiresSerialTracking: serializedItems.has(d.itemId),
          requiresBatchTracking: batchItems.has(d.itemId),
          receivedQuantity: startAtZero ? 0 : outstanding,
          outstandingQuantity: outstanding,
          // Cost is resolved at posting (original outbound cost / current /
          // zero-value reason) — never the line's credit-basis unitPrice.
          unitPrice: 0,
          conversionFactor: 1,
          unitOfMeasure: d.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId,
          orderQuantity: d.quantity ?? 0
        });

        return acc;
      }, []);

      if (receiptLineItems.length === 0) {
        throw new Error("No lines to receive");
      }

      const result = await db.transaction().execute(async (trx) => {
        const receiptId = await getNextSequence(trx, "receipt", companyId);

        let id: string;
        if (hasReceipt) {
          id = receipt.data!.id;
          await trx
            .updateTable("receipt")
            .set({
              sourceDocument: "Sales Return Order",
              sourceDocumentId: salesReturnOrderId,
              sourceDocumentReadableId:
                salesReturnOrder.data.salesReturnOrderId,
              locationId,
              updatedBy: userId
            })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          const insertReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId,
              sourceDocument: "Sales Return Order",
              sourceDocumentId: salesReturnOrderId,
              sourceDocumentReadableId:
                salesReturnOrder.data.salesReturnOrderId,
              locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          id = insertReceipt[0]?.id ?? "";
        }

        await trx
          .deleteFrom("receiptLine")
          .where("receiptId", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .insertInto("receiptLine")
          .values(
            receiptLineItems.map((lineItem) => ({
              ...lineItem,
              receiptId: id
            }))
          )
          .execute();

        return { id };
      });

      return result;
    }
    case "receiptFromWarehouseTransfer": {
      const { warehouseTransferId, receiptId: existingReceiptId } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        warehouseTransferId,
        existingReceiptId,
        userId
      });

      const [warehouseTransfer, warehouseTransferLines, receipt] =
        await inOrder([
          () =>
            single(db, "warehouseTransfer", {
              companyId,
              id: warehouseTransferId
            }),
          () =>
            many(db, "warehouseTransferLine", {
              companyId,
              transferId: warehouseTransferId
            }),
          () =>
            maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
        ]);

      if (!warehouseTransfer.data)
        throw new NotFoundError("Warehouse transfer not found");
      if (warehouseTransferLines.error)
        throw new Error(warehouseTransferLines.error.message);

      const locationId = warehouseTransfer.data.toLocationId;

      const items = await many(
        db,
        "item",
        {
          companyId,
          id: warehouseTransferLines.data
            .map((d) => d.itemId)
            .filter(Boolean) as string[]
        },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's receipt is a 404, not a
      // silent create-new.
      if (existingReceiptId && !receipt.data)
        throw new NotFoundError("Receipt not found");
      const hasReceipt = !!receipt.data?.id;

      const previouslyReceivedQuantitiesByLine = (
        warehouseTransferLines.data ?? []
      ).reduce<Record<string, number>>((acc, d) => {
        if (d.id) acc[d.id] = d.receivedQuantity ?? 0;
        return acc;
      }, {});

      const startAtZero = await receiptQuantitiesStartAtZero(db, companyId);

      const receiptLineItems = warehouseTransferLines.data.reduce<
        ReceiptLineItem[]
      >((acc, d) => {
        if (!d.itemId || !d.quantity) return acc;

        const serialTracking = serializedItems.has(d.itemId);
        const batchTracking = batchItems.has(d.itemId);
        const quantityToReceive = Math.max(
          0,
          (d.shippedQuantity ?? 0) -
            (previouslyReceivedQuantitiesByLine[d.id] ?? 0)
        );

        if (quantityToReceive === 0) return acc;

        acc.push({
          lineId: d.id,
          itemId: d.itemId,
          locationId: d.toLocationId ?? locationId,
          storageUnitId: d.toStorageUnitId,
          requiresSerialTracking: serialTracking,
          requiresBatchTracking: batchTracking,
          receivedQuantity: startAtZero ? 0 : quantityToReceive,
          outstandingQuantity: quantityToReceive,
          unitPrice: 0, // Transfers don't have a unit price
          conversionFactor: 1,
          unitOfMeasure: d.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId,
          orderQuantity: d.quantity ?? 0
        });

        return acc;
      }, []);

      if (receiptLineItems.length === 0) {
        throw new Error("No lines to receive");
      }

      const result = await db.transaction().execute(async (trx) => {
        const receiptId = await getNextSequence(trx, "receipt", companyId);

        let id: string;
        if (hasReceipt) {
          id = receipt.data!.id;
          await trx
            .updateTable("receipt")
            .set({
              sourceDocument: "Inbound Transfer",
              sourceDocumentId: warehouseTransferId,
              sourceDocumentReadableId: warehouseTransfer.data.transferId,
              locationId,
              updatedBy: userId
            })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          const insertReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId,
              sourceDocument: "Inbound Transfer",
              sourceDocumentId: warehouseTransferId,
              sourceDocumentReadableId: warehouseTransfer.data.transferId,
              locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          id = insertReceipt[0]?.id ?? "";
        }

        await trx
          .insertInto("receiptLine")
          .values(
            receiptLineItems.map((d) => ({
              receiptId: id,
              lineId: d.lineId,
              itemId: d.itemId,
              locationId: d.locationId,
              storageUnitId: d.storageUnitId,
              requiresSerialTracking: d.requiresSerialTracking,
              requiresBatchTracking: d.requiresBatchTracking,
              receivedQuantity: d.receivedQuantity,
              outstandingQuantity: d.outstandingQuantity,
              unitPrice: d.unitPrice,
              conversionFactor: d.conversionFactor,
              unitOfMeasure: d.unitOfMeasure,
              orderQuantity: d.orderQuantity,
              companyId,
              createdBy: userId
            }))
          )
          .execute();

        return { id };
      });

      return result;
    }
    case "receiptLineSplit": {
      const { receiptId, receiptLineId, quantity, locationId } = payload;

      createDocumentLogger.info({
        type,
        locationId,
        receiptId,
        receiptLineId,
        quantity,
        userId
      });

      const [receiptLine, trackedEntities] = await inOrder([
        () => single(db, "receiptLine", { companyId, id: receiptLineId }),
        () =>
          many(db, "trackedEntity", {
            companyId,
            attributes: contains({ "Receipt Line": receiptLineId })
          })
      ]);

      createDocumentLogger.debug({ trackedEntities });

      if (!receiptLine.data) throw new NotFoundError("Receipt line not found");

      await db.transaction().execute(async (trx) => {
        const { id: _id, ...data } = receiptLine.data;

        if (
          receiptLine.data.requiresSerialTracking &&
          trackedEntities.data?.length
        ) {
          // TODO: update the Receipt Line and Index attributes to point to the new line
          await releaseReceiptSerialEntities(
            trx,
            companyId,
            trackedEntities.data.map((d) => d.id)
          );
        }

        const newReceiptLineRows = await trx
          .insertInto("receiptLine")
          .values({
            ...data,
            orderQuantity: quantity,
            outstandingQuantity: quantity,
            receivedQuantity: quantity,
            createdBy: userId
          })
          .returning(["id"])
          .execute();

        const newReceiptLineId = newReceiptLineRows[0]?.id;

        await trx
          .updateTable("receiptLine")
          .set({
            orderQuantity: receiptLine.data.orderQuantity - quantity,
            outstandingQuantity:
              receiptLine.data.outstandingQuantity - quantity,
            receivedQuantity: receiptLine.data.receivedQuantity - quantity,
            updatedBy: userId
          })
          .where("id", "=", receiptLineId)
          .where("companyId", "=", companyId)
          .execute();

        // Carry batch tracking onto the new line: clone each existing
        // trackedEntity (batch number + expirationDate + attributes) and
        // shrink the original entity's quantity by the split amount.
        if (
          !receiptLine.data.requiresSerialTracking &&
          newReceiptLineId &&
          trackedEntities.data?.length
        ) {
          for (const entity of trackedEntities.data) {
            const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
            const { "Receipt Line Index": _ignored, ...rest } = attrs;
            const newAttributes = {
              ...rest,
              "Receipt Line": newReceiptLineId
            };

            await trx
              .insertInto("trackedEntity")
              .values({
                id: nanoid(),
                quantity: round(quantity),
                status: entity.status,
                sourceDocument: entity.sourceDocument,
                sourceDocumentId: entity.sourceDocumentId,
                sourceDocumentReadableId: entity.sourceDocumentReadableId,
                readableId: entity.readableId,
                attributes: newAttributes,
                companyId: entity.companyId,
                createdBy: userId,
                itemId: entity.itemId,
                expirationDate: entity.expirationDate
              })
              .execute();

            await trx
              .updateTable("trackedEntity")
              // A parent drained to zero by the split is Consumed, not a
              // zero-quantity Available husk; a Scrapped parent stays so.
              // The Math.max clamp is kept deliberately: a receipt-line
              // split over the parent's quantity has always clamped here
              // rather than refused, and that is not this change to make.
              .set(
                settleQuantity({
                  quantity: Math.max(0, (entity.quantity ?? 0) - quantity),
                  status: entity.status
                })
              )
              .where("id", "=", entity.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      });

      return { id: receiptLineId };
    }
    case "shipmentDefault": {
      let createdDocumentId;
      const { locationId } = payload;
      createDocumentLogger.info({ type, companyId, locationId, userId });
      const effectiveLocationId =
        locationId ?? (await getFallbackLocationId(db, companyId, userId));

      const id = await db.transaction().execute(async (trx) => {
        createdDocumentId = await getNextSequence(trx, "shipment", companyId);

        const newShipment = await trx
          .insertInto("shipment")
          .values({
            shipmentId: createdDocumentId,
            companyId: companyId,
            locationId: effectiveLocationId,
            createdBy: userId
          })
          .returning(["id", "shipmentId"])
          .execute();

        createdDocumentId = newShipment?.[0]?.id;
        if (!createdDocumentId) throw new Error("Failed to create shipment");
        return createdDocumentId;
      });

      return { id };
    }
    case "shipmentFromWarehouseTransfer": {
      const { warehouseTransferId, shipmentId: existingShipmentId } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        warehouseTransferId,
        existingShipmentId,
        userId
      });

      const [warehouseTransfer, warehouseTransferLines, shipment] =
        await inOrder([
          () =>
            single(db, "warehouseTransfer", {
              companyId,
              id: warehouseTransferId
            }),
          () =>
            many(db, "warehouseTransferLine", {
              companyId,
              transferId: warehouseTransferId
            }),
          () =>
            maybeSingle(db, "shipment", {
              companyId,
              id: existingShipmentId!
            })
        ]);

      if (!warehouseTransfer.data)
        throw new NotFoundError("Warehouse transfer not found");
      if (warehouseTransferLines.error)
        throw new Error(warehouseTransferLines.error.message);

      const locationId = warehouseTransfer.data.toLocationId;

      const items = await many(
        db,
        "item",
        {
          companyId,
          id: warehouseTransferLines.data
            .map((d) => d.itemId)
            .filter(Boolean) as string[]
        },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's shipment is a 404, not a
      // silent create-new.
      if (existingShipmentId && !shipment.data)
        throw new NotFoundError("Shipment not found");
      const hasShipment = !!shipment.data?.id;

      const previouslyShippedQuantitiesByLine = (
        warehouseTransferLines.data ?? []
      ).reduce<Record<string, number>>((acc, d) => {
        if (d.id) acc[d.id] = d.shippedQuantity ?? 0;
        return acc;
      }, {});

      const shipmentLineItems = warehouseTransferLines.data.reduce<
        ShipmentLineItem[]
      >((acc, d) => {
        if (!d.itemId || !d.quantity) return acc;

        const serialTracking = serializedItems.has(d.itemId);
        const batchTracking = batchItems.has(d.itemId);
        // For unshipped lines, we want all lines where shippedQuantity < quantity
        const quantityToShip = Math.max(
          0,
          (d.quantity ?? 0) - (previouslyShippedQuantitiesByLine[d.id] ?? 0)
        );

        if (quantityToShip === 0) return acc;

        acc.push({
          lineId: d.id,
          itemId: d.itemId,
          locationId: d.fromLocationId ?? locationId,
          storageUnitId: d.fromStorageUnitId,
          requiresSerialTracking: serialTracking,
          requiresBatchTracking: batchTracking,
          shippedQuantity: quantityToShip,
          outstandingQuantity: quantityToShip,
          unitPrice: 0, // Transfers don't have a unit price
          unitOfMeasure: d.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId,
          orderQuantity: d.quantity ?? 0
        });

        return acc;
      }, []);

      if (shipmentLineItems.length === 0) {
        throw new Error("No lines to ship");
      }

      const result = await db.transaction().execute(async (trx) => {
        const shipmentId = await getNextSequence(trx, "shipment", companyId);

        let id: string;
        if (hasShipment) {
          id = shipment.data!.id;
          await trx
            .updateTable("shipment")
            .set({
              sourceDocument: "Outbound Transfer",
              sourceDocumentId: warehouseTransferId,
              sourceDocumentReadableId: warehouseTransfer.data.transferId,
              locationId,
              updatedBy: userId
            })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          const insertShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId,
              sourceDocument: "Outbound Transfer",
              sourceDocumentId: warehouseTransferId,
              sourceDocumentReadableId: warehouseTransfer.data.transferId,
              locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          id = insertShipment[0]?.id ?? "";
        }

        await trx
          .deleteFrom("shipmentLine")
          .where("shipmentId", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .insertInto("shipmentLine")
          .values(
            shipmentLineItems.map((lineItem) => ({
              ...lineItem,
              shipmentId: id
            }))
          )
          .execute();

        return { id };
      });

      return result;
    }
    case "shipmentFromSalesReturnOrder": {
      // Return-to-customer shipment: ships back RECEIVED quantity on lines
      // dispositioned "Return to Customer", minus what earlier posted
      // shipments of this source already sent back.
      const {
        salesReturnOrderId,
        shipmentId: existingShipmentId,
        locationId: userLocationId
      } = payload;

      createDocumentLogger.info({
        function: "create",
        type,
        companyId,
        salesReturnOrderId,
        existingShipmentId,
        userId
      });

      const [salesReturnOrder, salesReturnOrderLines, shipment] = await inOrder(
        [
          () =>
            single(db, "salesReturnOrder", {
              id: salesReturnOrderId,
              companyId
            }),
          () =>
            many(db, "salesReturnOrderLine", {
              salesReturnOrderId,
              companyId
            }),
          () =>
            maybeSingle(db, "shipment", {
              companyId,
              id: existingShipmentId!
            })
        ]
      );

      if (!salesReturnOrder.data)
        throw new NotFoundError("Sales return order not found");
      if (salesReturnOrderLines.error)
        throw new Error(salesReturnOrderLines.error.message);
      // Goods can only go back out once they came in: the return must be
      // confirmed (To Receive) or already Completed — never Draft/Cancelled.
      if (!["To Receive", "Completed"].includes(salesReturnOrder.data.status))
        throw new Error(
          `Cannot create a shipment for a ${salesReturnOrder.data.status} return order`
        );

      const locationId =
        userLocationId ?? salesReturnOrder.data.locationId ?? null;
      if (!locationId) throw new Error("The return order has no location");

      const returnLines = salesReturnOrderLines.data.filter(
        (d) => d.disposition === "Return to Customer"
      );
      if (returnLines.length === 0)
        throw new Error('No lines are dispositioned "Return to Customer"');

      // Quantity already shipped back by earlier posted shipments
      const priorShipments = await many(
        db,
        "shipment",
        {
          sourceDocumentId: salesReturnOrderId,
          sourceDocument: "Sales Return Order",
          status: "Posted",
          companyId
        },
        { columns: ["id"] }
      );
      const priorShipmentIds = (priorShipments.data ?? []).map((d) => d.id);
      const shippedBackByLine = new Map<string, number>();
      if (priorShipmentIds.length > 0) {
        const priorLines = await many(
          db,
          "shipmentLine",
          { companyId, shipmentId: priorShipmentIds },
          { columns: ["lineId", "shippedQuantity"] }
        );
        for (const line of priorLines.data ?? []) {
          if (!line.lineId) continue;
          shippedBackByLine.set(
            line.lineId,
            (shippedBackByLine.get(line.lineId) ?? 0) +
              (line.shippedQuantity ?? 0)
          );
        }
      }

      const returnItemIds = returnLines
        .map((d) => d.itemId)
        .filter(Boolean) as string[];
      const items = await many(
        db,
        "item",
        { companyId, id: returnItemIds },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's shipment is a 404, not a
      // silent create-new.
      if (existingShipmentId && !shipment.data)
        throw new NotFoundError("Shipment not found");
      const hasShipment = !!shipment.data?.id;
      if (hasShipment && shipment.data!.status !== "Draft")
        throw new Error(`Cannot re-source a ${shipment.data!.status} shipment`);

      const shipmentLineItems = returnLines.reduce<ShipmentLineItem[]>(
        (acc, d) => {
          if (!d.itemId) return acc;
          const outstanding = Math.max(
            0,
            (d.quantityReceived ?? 0) - (shippedBackByLine.get(d.id) ?? 0)
          );
          if (outstanding === 0) return acc;

          acc.push({
            lineId: d.id,
            itemId: d.itemId,
            locationId,
            requiresSerialTracking: serializedItems.has(d.itemId),
            requiresBatchTracking: batchItems.has(d.itemId),
            shippedQuantity: outstanding,
            outstandingQuantity: outstanding,
            orderQuantity: d.quantityReceived ?? 0,
            // No revenue on a rejected-claim return
            unitPrice: 0,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId
          });
          return acc;
        },
        []
      );

      if (shipmentLineItems.length === 0) {
        throw new Error("No quantity remains to ship back");
      }

      const result = await db.transaction().execute(async (trx) => {
        const shipmentId = await getNextSequence(trx, "shipment", companyId);

        let id: string;
        if (hasShipment) {
          id = shipment.data!.id;
          await trx
            .updateTable("shipment")
            .set({
              sourceDocument: "Sales Return Order",
              sourceDocumentId: salesReturnOrderId,
              sourceDocumentReadableId:
                salesReturnOrder.data.salesReturnOrderId,
              customerId: salesReturnOrder.data.customerId,
              locationId,
              updatedBy: userId
            })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          const insertShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId,
              sourceDocument: "Sales Return Order",
              sourceDocumentId: salesReturnOrderId,
              sourceDocumentReadableId:
                salesReturnOrder.data.salesReturnOrderId,
              customerId: salesReturnOrder.data.customerId,
              locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          id = insertShipment[0]?.id ?? "";
        }

        await trx
          .deleteFrom("shipmentLine")
          .where("shipmentId", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        await trx
          .insertInto("shipmentLine")
          .values(
            shipmentLineItems.map((lineItem) => ({
              ...lineItem,
              shipmentId: id
            }))
          )
          .execute();

        return { id };
      });

      return result;
    }
    case "shipmentFromPurchaseReturnOrder": {
      // Supplier return shipment: open (not short-closed) return lines,
      // quantity minus already shipped. Quantities are inventory units.
      const {
        purchaseReturnOrderId,
        shipmentId: existingShipmentId,
        locationId: userLocationId
      } = payload;

      createDocumentLogger.info({
        function: "create",
        type,
        companyId,
        purchaseReturnOrderId,
        existingShipmentId,
        userId
      });

      const [purchaseReturnOrder, purchaseReturnOrderLines, shipment] =
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
            }),
          () =>
            maybeSingle(db, "shipment", {
              companyId,
              id: existingShipmentId!
            })
        ]);

      if (!purchaseReturnOrder.data)
        throw new NotFoundError("Purchase return order not found");
      if (purchaseReturnOrder.data.status !== "To Ship")
        throw new Error(
          `Cannot ship against a return order in ${purchaseReturnOrder.data.status} status`
        );
      if (purchaseReturnOrderLines.error)
        throw new Error(purchaseReturnOrderLines.error.message);

      const locationId =
        userLocationId ?? purchaseReturnOrder.data.locationId ?? null;
      if (!locationId) throw new Error("The return order has no location");

      const returnItemIds = purchaseReturnOrderLines.data
        .map((d) => d.itemId)
        .filter(Boolean) as string[];
      const items = await many(
        db,
        "item",
        { companyId, id: returnItemIds },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's shipment is a 404, not a
      // silent create-new.
      if (existingShipmentId && !shipment.data)
        throw new NotFoundError("Shipment not found");
      const hasShipment = !!shipment.data?.id;
      if (hasShipment && shipment.data!.status !== "Draft")
        throw new Error(`Cannot re-source a ${shipment.data!.status} shipment`);

      const shipmentLineItems = purchaseReturnOrderLines.data.reduce<
        ShipmentLineItem[]
      >((acc, d) => {
        if (!d.itemId || d.closedComplete) return acc;
        const outstanding = Math.max(
          0,
          (d.quantity ?? 0) - (d.quantityShipped ?? 0)
        );
        if (outstanding === 0) return acc;

        acc.push({
          lineId: d.id,
          itemId: d.itemId,
          locationId,
          requiresSerialTracking: serializedItems.has(d.itemId),
          requiresBatchTracking: batchItems.has(d.itemId),
          shippedQuantity: outstanding,
          outstandingQuantity: outstanding,
          orderQuantity: d.quantity ?? 0,
          unitPrice: d.unitPrice ?? 0,
          unitOfMeasure: d.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId
        });
        return acc;
      }, []);

      if (shipmentLineItems.length === 0) {
        throw new Error("No lines to ship");
      }

      // Carry the batches/serials picked on each return line onto the
      // shipment's tracked entities, so the shipment already knows what to
      // send back (post-shipment reads entities via attributes ->> Shipment).
      const returnLineIds = purchaseReturnOrderLines.data.map((l) => l.id);
      const lineTrackedEntities = await many<
        "purchaseReturnOrderLineTrackedEntity",
        Pick<
          rowsModule.Tables["purchaseReturnOrderLineTrackedEntity"]["Row"],
          "purchaseReturnOrderLineId"
        > & {
          trackedEntity: Pick<
            rowsModule.Tables["trackedEntity"]["Row"],
            "id" | "attributes"
          > | null;
        }
      >(
        db,
        "purchaseReturnOrderLineTrackedEntity",
        { purchaseReturnOrderLineId: returnLineIds, companyId },
        {
          columns: ["purchaseReturnOrderLineId"],
          embed: {
            trackedEntity: {
              table: "trackedEntity",
              via: "trackedEntityId",
              columns: ["id", "attributes"]
            }
          }
        }
      );
      if (lineTrackedEntities.error)
        throw new Error(lineTrackedEntities.error.message);

      const entitiesByReturnLine = new Map<
        string,
        { id: string; attributes: Record<string, unknown> | null }[]
      >();
      for (const row of lineTrackedEntities.data ?? []) {
        const entity = row.trackedEntity;
        if (!entity) continue;
        const list =
          entitiesByReturnLine.get(row.purchaseReturnOrderLineId) ?? [];
        list.push({
          id: entity.id,
          attributes: entity.attributes as Record<string, unknown> | null
        });
        entitiesByReturnLine.set(row.purchaseReturnOrderLineId, list);
      }

      // Re-source path: clear the shipment tag off any entity previously
      // stamped for this shipment before re-stamping the current selection.
      const staleEntities = hasShipment
        ? await many(
            db,
            "trackedEntity",
            {
              companyId,
              attributes: contains({ Shipment: shipment.data!.id })
            },
            { columns: ["id", "attributes"] }
          )
        : { data: [], error: null };
      if (staleEntities.error) throw new Error(staleEntities.error.message);

      const result = await db.transaction().execute(async (trx) => {
        const shipmentId = await getNextSequence(trx, "shipment", companyId);

        let id: string;
        if (hasShipment) {
          id = shipment.data!.id;
          await trx
            .updateTable("shipment")
            .set({
              sourceDocument: "Purchase Return Order",
              sourceDocumentId: purchaseReturnOrderId,
              sourceDocumentReadableId:
                purchaseReturnOrder.data.purchaseReturnOrderId,
              supplierId: purchaseReturnOrder.data.supplierId,
              locationId,
              updatedBy: userId
            })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          const insertShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId,
              sourceDocument: "Purchase Return Order",
              sourceDocumentId: purchaseReturnOrderId,
              sourceDocumentReadableId:
                purchaseReturnOrder.data.purchaseReturnOrderId,
              supplierId: purchaseReturnOrder.data.supplierId,
              locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          id = insertShipment[0]?.id ?? "";
        }

        await trx
          .deleteFrom("shipmentLine")
          .where("shipmentId", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        const insertedLines = await trx
          .insertInto("shipmentLine")
          .values(
            shipmentLineItems.map((lineItem) => ({
              ...lineItem,
              shipmentId: id
            }))
          )
          .returning(["id", "lineId"])
          .execute();

        // Strip the shipment tag off entities left over from a prior source.
        for (const entity of staleEntities.data ?? []) {
          const attrs = {
            ...((entity.attributes as Record<string, unknown> | null) ?? {})
          };
          delete attrs.Shipment;
          delete attrs["Shipment Line"];
          delete attrs["Shipment Line Index"];
          await trx
            .updateTable("trackedEntity")
            .set({ attributes: attrs as Json })
            .where("id", "=", entity.id)
            .where("companyId", "=", companyId)
            .execute();
        }

        // Stamp each return line's picked entities onto its shipment line, so
        // the batch/serial flows through to posting. post-shipment splits a
        // batch when the shipped quantity is less than the entity's quantity.
        for (const shipmentLine of insertedLines) {
          const entities = shipmentLine.lineId
            ? entitiesByReturnLine.get(shipmentLine.lineId)
            : undefined;
          for (const entity of entities ?? []) {
            const attrs = {
              ...(entity.attributes ?? {}),
              Shipment: id,
              "Shipment Line": shipmentLine.id
            };
            await trx
              .updateTable("trackedEntity")
              .set({ attributes: attrs as Json })
              .where("id", "=", entity.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        return { id };
      });

      return result;
    }
    case "shipmentFromPurchaseOrder": {
      const {
        purchaseOrderId,
        shipmentId: existingShipmentId,
        locationId
      } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        locationId,
        purchaseOrderId,
        existingShipmentId,
        userId
      });

      const [
        purchaseOrder,
        purchaseOrderLines,
        purchaseOrderDelivery,
        shipment
      ] = await inOrder([
        () => single(db, "purchaseOrder", { companyId, id: purchaseOrderId }),
        () =>
          many(db, "purchaseOrderLine", {
            companyId,
            purchaseOrderId,
            purchaseOrderLineType: [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable"
            ],
            locationId
          }),
        () =>
          maybeSingle(db, "purchaseOrderDelivery", {
            companyId,
            id: purchaseOrderId
          }),
        () =>
          maybeSingle(db, "shipment", { companyId, id: existingShipmentId! })
      ]);

      if (!purchaseOrder.data)
        throw new NotFoundError("Purchase order not found");
      if (purchaseOrderLines.error)
        throw new Error(purchaseOrderLines.error.message);

      const items = await many(
        db,
        "item",
        {
          companyId,
          id: purchaseOrderLines.data.map((d) => d.itemId) as string[]
        },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's shipment is a 404, not a
      // silent create-new.
      if (existingShipmentId && !shipment.data)
        throw new NotFoundError("Shipment not found");
      const hasShipment = !!shipment.data?.id;
      const isOutsideOperation =
        purchaseOrder.data.purchaseOrderType === "Outside Processing";

      const previouslyShippedQuantitiesByLine = (
        purchaseOrderLines.data ?? []
      ).reduce<Record<string, number>>((acc, d) => {
        if (d.id) acc[d.id] = d.quantityShipped ?? 0;
        return acc;
      }, {});

      let shipmentId = hasShipment ? shipment.data?.id! : "";
      let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

      await db.transaction().execute(async (trx) => {
        if (hasShipment) {
          // update existing shipment
          await trx
            .updateTable("shipment")
            .set({
              sourceDocument: "Purchase Order",
              sourceDocumentId: purchaseOrder.data.id,
              sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
              supplierId: purchaseOrder.data.supplierId,
              supplierInteractionId: purchaseOrder.data.supplierInteractionId,
              shippingMethodId: purchaseOrderDelivery.data?.shippingMethodId,
              locationId: locationId,
              updatedBy: userId
            })
            .where("id", "=", shipmentId)
            .returning(["id", "shipmentId"])
            .where("companyId", "=", companyId)
            .execute();
          // delete existing shipment lines
          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", shipmentId)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          shipmentIdReadable = await getNextSequence(
            trx,
            "shipment",
            companyId
          );

          const newShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: shipmentIdReadable,
              sourceDocument: "Purchase Order",
              sourceDocumentId: purchaseOrder.data.id,
              sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
              externalDocumentId: purchaseOrder.data.supplierReference,
              supplierId: purchaseOrder.data.supplierId,
              supplierInteractionId: purchaseOrder.data.supplierInteractionId,
              shippingMethodId: purchaseOrderDelivery.data?.shippingMethodId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId
            })
            .returning(["id", "shipmentId"])
            .execute();

          shipmentId = newShipment?.[0]?.id!;
          shipmentIdReadable = newShipment?.[0]?.shipmentId!;
        }

        // Process each sales order line
        for await (const purchaseOrderLine of purchaseOrderLines.data) {
          if (
            !purchaseOrderLine.itemId ||
            !purchaseOrderLine.purchaseQuantity ||
            purchaseOrderLine.purchaseOrderLineType === "Service" ||
            purchaseOrderLine.purchaseOrderLineType === "G/L Account"
          ) {
            continue;
          }

          const isSerial = serializedItems.has(purchaseOrderLine.itemId);
          const isBatch = batchItems.has(purchaseOrderLine.itemId);

          const outstandingQuantity =
            (purchaseOrderLine.purchaseQuantity ?? 0) -
            (previouslyShippedQuantitiesByLine[purchaseOrderLine.id] ?? 0);

          const shippingAndTaxUnitCost =
            ((purchaseOrderLine.shippingCost ?? 0) /
              (purchaseOrderLine.purchaseQuantity ?? 0) +
              (purchaseOrderLine.unitPrice ?? 0)) *
            (1 + (purchaseOrderLine.taxPercent ?? 0));

          await trx
            .insertInto("shipmentLine")
            .values({
              shipmentId: shipmentId,
              lineId: purchaseOrderLine.id,
              companyId: companyId,
              itemId: purchaseOrderLine.itemId,
              orderQuantity: purchaseOrderLine.purchaseQuantity,
              outstandingQuantity: outstandingQuantity,
              shippedQuantity: outstandingQuantity ?? 0,
              requiresSerialTracking: isSerial && !isOutsideOperation,
              requiresBatchTracking: isBatch && !isOutsideOperation,
              unitPrice: shippingAndTaxUnitCost,
              unitOfMeasure:
                purchaseOrderLine.purchaseUnitOfMeasureCode ?? "EA",
              locationId: purchaseOrderLine.locationId,
              storageUnitId: purchaseOrderLine.storageUnitId,
              createdBy: userId ?? ""
            })
            .execute();
        }
      });

      return { id: shipmentId };
    }
    case "shipmentFromSalesOrder": {
      const {
        salesOrderId,
        shipmentId: existingShipmentId,
        locationId
      } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        locationId,
        salesOrderId,
        existingShipmentId,
        userId
      });

      const [
        salesOrder,
        salesOrderLines,
        fixedAssetSoLines,
        salesOrderShipment,
        shipment,
        jobs
      ] = await inOrder([
        () => single(db, "salesOrder", { id: salesOrderId, companyId }),
        () =>
          many(db, "salesOrderLine", {
            companyId,
            salesOrderId,
            salesOrderLineType: [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable"
            ],
            locationId
          }),
        () =>
          many(
            db,
            "salesOrderLine",
            { companyId, salesOrderId, salesOrderLineType: "Fixed Asset" },
            {
              columns: [
                "id",
                "salesOrderLineType",
                "assetId",
                "saleQuantity",
                "quantitySent",
                "sentComplete"
              ]
            }
          ),
        () =>
          maybeSingle(db, "salesOrderShipment", {
            companyId,
            id: salesOrderId
          }),
        () =>
          maybeSingle(db, "shipment", { companyId, id: existingShipmentId! }),
        () =>
          many(db, "job", {
            companyId,
            salesOrderId,
            status: neq("Cancelled")
          })
      ]);

      if (!salesOrder.data) throw new NotFoundError("Sales order not found");
      if (salesOrderLines.error) throw new Error(salesOrderLines.error.message);

      const items = await many(
        db,
        "item",
        {
          companyId,
          id: salesOrderLines.data.map((d) => d.itemId) as string[]
        },
        { columns: ["id", "itemTrackingType"] }
      );
      const serializedItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Serial")
          .map((d) => d.id)
      );
      const batchItems = new Set(
        items.data
          ?.filter((d) => d.itemTrackingType === "Batch")
          .map((d) => d.id)
      );

      // A supplied id that is not this company's shipment is a 404, not a
      // silent create-new.
      if (existingShipmentId && !shipment.data)
        throw new NotFoundError("Shipment not found");
      const hasShipment = !!shipment.data?.id;

      // Group jobs by sales order line ID
      const jobsBySalesOrderLine = (jobs.data || []).reduce<
        Record<string, Database["public"]["Tables"]["job"]["Row"][]>
      >((acc, job) => {
        if (job.salesOrderLineId) {
          if (!acc[job.salesOrderLineId]) {
            acc[job.salesOrderLineId] = [];
          }
          acc[job.salesOrderLineId]!.push(job);
        }
        return acc;
      }, {});

      const previouslyShippedQuantitiesByLine = (
        salesOrderLines.data ?? []
      ).reduce<Record<string, number>>((acc, d) => {
        if (d.id) acc[d.id] = d.quantitySent ?? 0;
        return acc;
      }, {});

      let shipmentId = hasShipment ? shipment.data?.id! : "";
      let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

      await db.transaction().execute(async (trx) => {
        if (hasShipment) {
          // update existing shipment
          await trx
            .updateTable("shipment")
            .set({
              sourceDocument: "Sales Order",
              sourceDocumentId: salesOrder.data.id,
              sourceDocumentReadableId: salesOrder.data.salesOrderId,
              customerId: salesOrder.data.customerId,
              shippingMethodId: salesOrderShipment.data?.shippingMethodId,
              opportunityId: salesOrder.data.opportunityId,
              locationId: locationId,
              updatedBy: userId
            })
            .where("id", "=", shipmentId)
            .returning(["id", "shipmentId"])
            .where("companyId", "=", companyId)
            .execute();
          // delete existing shipment lines
          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", shipmentId)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          shipmentIdReadable = await getNextSequence(
            trx,
            "shipment",
            companyId
          );

          const newShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: shipmentIdReadable,
              sourceDocument: "Sales Order",
              sourceDocumentId: salesOrder.data.id,
              sourceDocumentReadableId: salesOrder.data.salesOrderId,
              externalDocumentId: salesOrder.data.customerReference,
              shippingMethodId: salesOrderShipment.data?.shippingMethodId,
              customerId: salesOrder.data.customerId,
              opportunityId: salesOrder.data.opportunityId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId
            })
            .returning(["id", "shipmentId"])
            .execute();

          shipmentId = newShipment?.[0]?.id!;
          shipmentIdReadable = newShipment?.[0]?.shipmentId!;
        }

        const shipmentLineItems: ShipmentLineItem[] = [];

        // Process each sales order line
        for await (const salesOrderLine of salesOrderLines.data) {
          if (
            !salesOrderLine.itemId ||
            !salesOrderLine.saleQuantity ||
            salesOrderLine.salesOrderLineType === "Service"
          ) {
            continue;
          }

          const isSerial = serializedItems.has(salesOrderLine.itemId);
          const isBatch = batchItems.has(salesOrderLine.itemId);

          if (salesOrderLine.methodType === "Make to Order") {
            for await (const job of jobsBySalesOrderLine[salesOrderLine.id] ??
              []) {
              if (!salesOrderLine.itemId) return;

              const quantityToShip = Math.max(
                0,
                (job.quantityComplete ?? 0) - (job.quantityShipped ?? 0)
              );

              if (!isSerial || (isSerial && quantityToShip > 0)) {
                const fulfillment = await trx
                  .insertInto("fulfillment")
                  .values({
                    salesOrderLineId: salesOrderLine.id,
                    type: "Job",
                    jobId: job.id,
                    quantity: quantityToShip,
                    companyId: companyId,
                    createdBy: userId
                  })
                  .returning(["id"])
                  .execute();

                const fulfillmentId = fulfillment?.[0]?.id;

                const shippingAndTaxUnitCost =
                  (salesOrderLine.shippingCost / quantityToShip +
                    (salesOrderLine.unitPrice ?? 0)) *
                  (1 + salesOrderLine.taxPercent);

                const shipmentLine = await trx
                  .insertInto("shipmentLine")
                  .values({
                    shipmentId: shipmentId,
                    lineId: salesOrderLine.id,
                    companyId: companyId,
                    fulfillmentId,
                    itemId: salesOrderLine.itemId,
                    orderQuantity: salesOrderLine.saleQuantity,
                    outstandingQuantity:
                      salesOrderLine.quantityToSend ??
                      salesOrderLine.saleQuantity,
                    shippedQuantity: quantityToShip,
                    requiresSerialTracking: isSerial,
                    requiresBatchTracking: isBatch,
                    unitPrice: shippingAndTaxUnitCost,
                    unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                    createdBy: userId ?? ""
                  })
                  .returning(["id"])
                  .execute();

                const shipmentLineId = shipmentLine?.[0]?.id;

                if (!shipmentLineId)
                  throw new NotFoundError("Shipment line not found");

                if (isSerial || isBatch) {
                  const jobMakeMethod = await trx
                    .selectFrom("jobMakeMethod")
                    .select(["id"])
                    .where("jobId", "=", job.id)
                    .where("parentMaterialId", "is", null)
                    .executeTakeFirst();

                  if (jobMakeMethod?.id) {
                    const trackedEntities = await many(
                      trx,
                      "trackedEntity",
                      {
                        companyId,
                        attributes: contains({
                          "Job Make Method": jobMakeMethod.id
                        })
                      },
                      { orderBy: ["createdAt", "readableId", "id"] }
                    );

                    let index = 0;
                    for await (const trackedEntity of trackedEntities?.data ??
                      []) {
                      await trx
                        .updateTable("trackedEntity")
                        .set({
                          attributes: {
                            ...(trackedEntity.attributes as Record<
                              string,
                              unknown
                            >),
                            Shipment: shipmentId,
                            "Shipment Line": shipmentLineId,
                            "Shipment Line Index": index
                          }
                        })
                        .where("id", "=", trackedEntity.id)
                        .where("companyId", "=", companyId)
                        .execute();
                      index++;
                    }
                  }
                }
              }
            }
          } else {
            const outstandingQuantity =
              (salesOrderLine.saleQuantity ?? 0) -
              (previouslyShippedQuantitiesByLine[salesOrderLine.id] ?? 0);

            const shippingAndTaxUnitCost =
              (salesOrderLine.shippingCost /
                (salesOrderLine.saleQuantity ?? 0) +
                (salesOrderLine.unitPrice ?? 0)) *
              (1 + salesOrderLine.taxPercent);

            await trx
              .insertInto("shipmentLine")
              .values({
                shipmentId: shipmentId,
                lineId: salesOrderLine.id,
                companyId: companyId,
                itemId: salesOrderLine.itemId,
                orderQuantity: salesOrderLine.saleQuantity,
                outstandingQuantity: outstandingQuantity,
                shippedQuantity: outstandingQuantity ?? 0,
                requiresSerialTracking: isSerial,
                requiresBatchTracking: isBatch,
                unitPrice: shippingAndTaxUnitCost,
                unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                locationId: salesOrderLine.locationId,
                storageUnitId: salesOrderLine.storageUnitId,
                createdBy: userId ?? ""
              })
              .execute();
          }
        }

        if (shipmentLineItems.length > 0) {
          // Insert all shipment lines
          await trx
            .insertInto("shipmentLine")
            .values(
              shipmentLineItems.map((line) => ({
                ...line,
                shipmentId: shipmentId,
                locationId
              }))
            )
            .execute();
        }

        const unshippedFaLines = (fixedAssetSoLines.data ?? []).filter(
          (d) => d.assetId && d.saleQuantity && !d.sentComplete
        );
        if (unshippedFaLines.length > 0) {
          await trx
            .deleteFrom("shipmentFixedAssetLine")
            .where("shipmentId", "=", shipmentId)
            .where("companyId", "=", companyId)
            .execute();
          await trx
            .insertInto("shipmentFixedAssetLine")
            .values(
              unshippedFaLines.map((line) => ({
                shipmentId: shipmentId,
                salesOrderLineId: line.id,
                shipped: true,
                companyId,
                createdBy: userId
              }))
            )
            .execute();
        }
      });

      return { id: shipmentId };
    }
    case "shipmentFromSalesOrderLine": {
      const {
        salesOrderLineId,
        shipmentId: existingShipmentId,
        locationId
      } = payload;

      createDocumentLogger.info({
        type,
        companyId,
        locationId,
        salesOrderLineId,
        existingShipmentId,
        userId
      });

      const salesOrderLine = await single(db, "salesOrderLine", {
        companyId,
        id: salesOrderLineId,
        locationId
      });

      if (!salesOrderLine.data || !salesOrderLine.data.itemId)
        throw new NotFoundError("Sales order line not found");
      // Services are never shipped
      if (salesOrderLine.data.salesOrderLineType === "Service")
        throw new Error("Service lines cannot be shipped");
      const salesOrderId = salesOrderLine.data.salesOrderId;

      const [salesOrder, salesOrderShipment, shipment, jobs] = await inOrder([
        () => single(db, "salesOrder", { companyId, id: salesOrderId }),
        () =>
          maybeSingle(db, "salesOrderShipment", {
            companyId,
            id: salesOrderId
          }),
        () =>
          maybeSingle(db, "shipment", { companyId, id: existingShipmentId! }),
        () =>
          many(db, "job", {
            companyId,
            salesOrderLineId,
            status: neq("Cancelled")
          })
      ]);

      if (!salesOrder.data) throw new NotFoundError("Sales order not found");

      const item = await single(
        db,
        "item",
        { companyId, id: salesOrderLine.data.itemId },
        { columns: ["id", "itemTrackingType"] }
      );

      if (!item.data) throw new NotFoundError("Item not found");

      const isSerial = item.data.itemTrackingType === "Serial";
      const isBatch = item.data.itemTrackingType === "Batch";

      // A supplied id that is not this company's shipment is a 404, not a
      // silent create-new.
      if (existingShipmentId && !shipment.data)
        throw new NotFoundError("Shipment not found");
      const hasShipment = !!shipment.data?.id;
      if (hasShipment && shipment.data!.status !== "Draft")
        throw new Error(`Cannot re-source a ${shipment.data!.status} shipment`);
      const previouslyShippedQuantity = salesOrderLine.data.quantitySent ?? 0;

      let shipmentId = hasShipment ? shipment.data?.id! : "";
      let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

      await db.transaction().execute(async (trx) => {
        if (hasShipment) {
          // update existing shipment
          await trx
            .updateTable("shipment")
            .set({
              sourceDocument: "Sales Order",
              sourceDocumentId: salesOrder.data.id,
              sourceDocumentReadableId: salesOrder.data.salesOrderId,
              locationId: locationId,
              updatedBy: userId
            })
            .where("id", "=", shipmentId)
            .returning(["id", "shipmentId"])
            .where("companyId", "=", companyId)
            .execute();
          // delete existing shipment lines
          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", shipmentId)
            .where("companyId", "=", companyId)
            .execute();
        } else {
          shipmentIdReadable = await getNextSequence(
            trx,
            "shipment",
            companyId
          );

          const newShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: shipmentIdReadable,
              sourceDocument: "Sales Order",
              sourceDocumentId: salesOrder.data.id,
              sourceDocumentReadableId: salesOrder.data.salesOrderId,
              externalDocumentId: salesOrder.data.customerReference,
              shippingMethodId: salesOrderShipment.data?.shippingMethodId,
              customerId: salesOrder.data.customerId,
              opportunityId: salesOrder.data.opportunityId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId
            })
            .returning(["id", "shipmentId"])
            .execute();

          shipmentId = newShipment?.[0]?.id!;
          shipmentIdReadable = newShipment?.[0]?.shipmentId!;
        }

        if (salesOrderLine.data.methodType === "Make to Order") {
          for await (const job of jobs.data ?? []) {
            if (!salesOrderLine.data.itemId) return;
            const quantityToShip = Math.max(
              0,
              (job.quantityComplete ?? 0) - (job.quantityShipped ?? 0)
            );

            if (!isSerial || (isSerial && quantityToShip > 0)) {
              const fulfillment = await trx
                .insertInto("fulfillment")
                .values({
                  salesOrderLineId: salesOrderLineId,
                  type: "Job",
                  jobId: job.id,
                  quantity: quantityToShip,
                  companyId: companyId,
                  createdBy: userId
                })
                .returning(["id"])
                .execute();

              const fulfillmentId = fulfillment?.[0]?.id;

              const shippingAndTaxUnitCost =
                (salesOrderLine.data.shippingCost / quantityToShip +
                  (salesOrderLine.data.unitPrice ?? 0)) *
                (1 + salesOrderLine.data.taxPercent);

              const shipmentLine = await trx
                .insertInto("shipmentLine")
                .values({
                  shipmentId: shipmentId,
                  lineId: salesOrderLineId,
                  companyId: companyId,
                  fulfillmentId,
                  itemId: salesOrderLine.data.itemId,
                  orderQuantity: job.productionQuantity ?? 0,
                  outstandingQuantity: Math.max(0, job.productionQuantity ?? 0),
                  shippedQuantity: quantityToShip,
                  requiresSerialTracking: isSerial,
                  requiresBatchTracking: isBatch,
                  unitPrice: shippingAndTaxUnitCost,
                  unitOfMeasure: salesOrderLine.data.unitOfMeasureCode ?? "EA",
                  createdBy: userId ?? ""
                })
                .returning(["id"])
                .execute();

              const shipmentLineId = shipmentLine?.[0]?.id;

              if (!shipmentLineId)
                throw new NotFoundError("Shipment line not found");

              if (isSerial || isBatch) {
                const jobMakeMethod = await trx
                  .selectFrom("jobMakeMethod")
                  .select(["id"])
                  .where("jobId", "=", job.id)
                  .where("parentMaterialId", "is", null)
                  .executeTakeFirst();

                if (jobMakeMethod?.id) {
                  const trackedEntities = await many(
                    trx,
                    "trackedEntity",
                    {
                      companyId,
                      attributes: contains({
                        "Job Make Method": jobMakeMethod.id
                      })
                    },
                    { orderBy: ["createdAt", "readableId", "id"] }
                  );

                  let index = 0;
                  for await (const trackedEntity of trackedEntities?.data ??
                    []) {
                    await trx
                      .updateTable("trackedEntity")
                      .set({
                        attributes: {
                          ...(trackedEntity.attributes as Record<
                            string,
                            unknown
                          >),
                          Shipment: shipmentId,
                          "Shipment Line": shipmentLineId,
                          "Shipment Line Index": index
                        }
                      })
                      .where("id", "=", trackedEntity.id)
                      .where("companyId", "=", companyId)
                      .execute();
                    index++;
                  }
                }
              }
            }
          }
        } else {
          const outstandingQuantity = Math.max(
            0,
            (salesOrderLine.data.saleQuantity ?? 0) - previouslyShippedQuantity
          );

          const shippingAndTaxUnitCost =
            (salesOrderLine.data.shippingCost /
              (salesOrderLine.data.saleQuantity ?? 0) +
              (salesOrderLine.data.unitPrice ?? 0)) *
            (1 + salesOrderLine.data.taxPercent);

          await trx
            .insertInto("shipmentLine")
            .values({
              shipmentId: shipmentId,
              lineId: salesOrderLineId,
              companyId: companyId,
              itemId: salesOrderLine.data.itemId!,
              orderQuantity: salesOrderLine.data.saleQuantity ?? 0,
              outstandingQuantity: outstandingQuantity,
              shippedQuantity: outstandingQuantity,
              requiresSerialTracking: isSerial,
              requiresBatchTracking: isBatch,
              unitPrice: shippingAndTaxUnitCost,
              unitOfMeasure: salesOrderLine.data.unitOfMeasureCode ?? "EA",
              locationId: salesOrderLine.data.locationId!,
              storageUnitId: salesOrderLine.data.storageUnitId!,
              createdBy: userId ?? ""
            })
            .execute();
        }
      });

      return { id: shipmentId };
    }
    case "shipmentLineSplit": {
      const { shipmentId, shipmentLineId, quantity, locationId } = payload;

      createDocumentLogger.info({
        type,
        locationId,
        shipmentId,
        shipmentLineId,
        quantity,
        userId
      });

      const [shipmentLine] = await inOrder([
        () => single(db, "shipmentLine", { companyId, id: shipmentLineId })
      ]);

      if (!shipmentLine.data)
        throw new NotFoundError("Shipment line not found");

      await db.transaction().execute(async (trx) => {
        const { id: _id, ...data } = shipmentLine.data;

        await trx
          .insertInto("shipmentLine")
          .values({
            ...data,
            orderQuantity: quantity,
            outstandingQuantity: quantity,
            shippedQuantity: quantity,
            createdBy: userId
          })
          .execute();

        await trx
          .updateTable("shipmentLine")
          .set({
            orderQuantity: shipmentLine.data.orderQuantity - quantity,
            outstandingQuantity:
              shipmentLine.data.outstandingQuantity - quantity,
            shippedQuantity: shipmentLine.data.shippedQuantity - quantity,
            updatedBy: userId
          })
          .where("id", "=", shipmentLineId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return { id: shipmentLineId };
    }
    case "shipmentFromRentalAgreement": {
      // A rental delivery: one Draft shipment per agreement holds the
      // Pending units. A per-unit shortcut adds (or ticks) its unit on it.
      const { rentalAgreementId, rentalAgreementLineId } = payload;

      createDocumentLogger.info({
        function: "create",
        type,
        companyId,
        rentalAgreementId,
        rentalAgreementLineId,
        userId
      });

      return db.transaction().execute(async (trx) => {
        const agreement = await trx
          .selectFrom("rentalAgreement")
          .select([
            "id",
            "rentalAgreementId",
            "status",
            "customerId",
            "locationId"
          ])
          .where("id", "=", rentalAgreementId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!agreement) throw new NotFoundError("Rental agreement not found");
        if (agreement.status !== "Active") {
          throw new InvalidInputError(
            `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are delivered from an Active agreement`
          );
        }

        const draft = await trx
          .selectFrom("shipment")
          .select("id")
          .where("sourceDocument", "=", "Rental Agreement")
          .where("sourceDocumentId", "=", agreement.id)
          .where("status", "=", "Draft")
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();

        const onOpenShipments = await trx
          .selectFrom("shipmentFixedAssetLine as sfl")
          .innerJoin("shipment as s", (join) =>
            join
              .onRef("s.id", "=", "sfl.shipmentId")
              .onRef("s.companyId", "=", "sfl.companyId")
          )
          .select([
            "sfl.id",
            "sfl.shipmentId",
            "sfl.rentalAgreementLineId",
            "sfl.shipped"
          ])
          .where("s.sourceDocument", "=", "Rental Agreement")
          .where("s.sourceDocumentId", "=", agreement.id)
          .where("s.status", "in", ["Draft", "Pending"])
          .where("sfl.companyId", "=", companyId)
          .execute();

        let candidatesQuery = trx
          .selectFrom("rentalAgreementLine")
          .select(["id", "status"])
          .where("rentalAgreementId", "=", agreement.id)
          .where("companyId", "=", companyId)
          .where("status", "=", "Pending");
        if (rentalAgreementLineId) {
          candidatesQuery = candidatesQuery.where(
            "id",
            "=",
            rentalAgreementLineId
          );
        }
        const candidates = await candidatesQuery.orderBy("id").execute();
        if (rentalAgreementLineId && candidates.length === 0) {
          throw new InvalidInputError("Only a Pending unit can be delivered");
        }

        if (draft) {
          if (!rentalAgreementLineId) return { id: draft.id };
          const onDocument = onOpenShipments.find(
            (row) => row.rentalAgreementLineId === rentalAgreementLineId
          );
          if (onDocument && onDocument.shipmentId !== draft.id) {
            throw new InvalidInputError(
              "The unit is already on an open shipment"
            );
          }
          if (onDocument) {
            if (!onDocument.shipped) {
              await trx
                .updateTable("shipmentFixedAssetLine")
                .set({ shipped: true, updatedBy: userId })
                .where("id", "=", onDocument.id)
                .where("companyId", "=", companyId)
                .execute();
            }
            return { id: draft.id };
          }
          await trx
            .insertInto("shipmentFixedAssetLine")
            .values({
              shipmentId: draft.id,
              rentalAgreementLineId,
              shipped: true,
              companyId,
              createdBy: userId
            })
            .execute();
          return { id: draft.id };
        }

        const onOpenDocument = new Set(
          onOpenShipments.map((row) => row.rentalAgreementLineId)
        );
        const units = candidates.filter((line) => !onOpenDocument.has(line.id));
        if (units.length === 0) {
          throw new InvalidInputError("No units to deliver");
        }

        const header = await trx
          .insertInto("shipment")
          .values({
            shipmentId: await getNextSequence(trx, "shipment", companyId),
            sourceDocument: "Rental Agreement",
            sourceDocumentId: agreement.id,
            sourceDocumentReadableId: agreement.rentalAgreementId,
            customerId: agreement.customerId,
            locationId: agreement.locationId,
            status: "Draft",
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("shipmentFixedAssetLine")
          .values(
            units.map((line) => ({
              shipmentId: header.id,
              rentalAgreementLineId: line.id,
              shipped: true,
              companyId,
              createdBy: userId
            }))
          )
          .execute();
        return { id: header.id };
      });
    }
    case "receiptFromRentalAgreement": {
      // A rental return: one Draft receipt per agreement holds the units
      // that can come back — On Rent ticked, Pending unticked (spec Q8). A
      // per-unit shortcut adds (or ticks) its unit on it.
      const { rentalAgreementId, rentalAgreementLineId } = payload;

      createDocumentLogger.info({
        function: "create",
        type,
        companyId,
        rentalAgreementId,
        rentalAgreementLineId,
        userId
      });

      return db.transaction().execute(async (trx) => {
        const agreement = await trx
          .selectFrom("rentalAgreement")
          .select([
            "id",
            "rentalAgreementId",
            "status",
            "customerId",
            "locationId"
          ])
          .where("id", "=", rentalAgreementId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!agreement) throw new NotFoundError("Rental agreement not found");
        if (agreement.status !== "Active") {
          throw new InvalidInputError(
            `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are returned from an Active agreement`
          );
        }

        const draft = await trx
          .selectFrom("receipt")
          .select("id")
          .where("sourceDocument", "=", "Rental Agreement")
          .where("sourceDocumentId", "=", agreement.id)
          .where("status", "=", "Draft")
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();

        // Only another open RECEIPT keeps a unit off this one: a Pending
        // unit may sit on an open shipment too, and the first to post wins.
        const onOpenReceipts = await trx
          .selectFrom("receiptFixedAssetLine as rfl")
          .innerJoin("receipt as r", (join) =>
            join
              .onRef("r.id", "=", "rfl.receiptId")
              .onRef("r.companyId", "=", "rfl.companyId")
          )
          .select([
            "rfl.id",
            "rfl.receiptId",
            "rfl.rentalAgreementLineId",
            "rfl.received"
          ])
          .where("r.sourceDocument", "=", "Rental Agreement")
          .where("r.sourceDocumentId", "=", agreement.id)
          .where("r.status", "in", ["Draft", "Pending"])
          .where("rfl.companyId", "=", companyId)
          .execute();

        let candidatesQuery = trx
          .selectFrom("rentalAgreementLine")
          .select(["id", "status"])
          .where("rentalAgreementId", "=", agreement.id)
          .where("companyId", "=", companyId)
          .where("status", "in", ["Pending", "On Rent"]);
        if (rentalAgreementLineId) {
          candidatesQuery = candidatesQuery.where(
            "id",
            "=",
            rentalAgreementLineId
          );
        }
        const candidates = await candidatesQuery.orderBy("id").execute();
        if (rentalAgreementLineId && candidates.length === 0) {
          throw new InvalidInputError(
            "Only a Pending or On Rent unit can be returned"
          );
        }

        if (draft) {
          if (!rentalAgreementLineId) return { id: draft.id };
          const onDocument = onOpenReceipts.find(
            (row) => row.rentalAgreementLineId === rentalAgreementLineId
          );
          if (onDocument && onDocument.receiptId !== draft.id) {
            throw new InvalidInputError(
              "The unit is already on an open receipt"
            );
          }
          if (onDocument) {
            if (!onDocument.received) {
              await trx
                .updateTable("receiptFixedAssetLine")
                .set({ received: true, updatedBy: userId })
                .where("id", "=", onDocument.id)
                .where("companyId", "=", companyId)
                .execute();
            }
            return { id: draft.id };
          }
          await trx
            .insertInto("receiptFixedAssetLine")
            .values({
              receiptId: draft.id,
              rentalAgreementLineId,
              received: true,
              companyId,
              createdBy: userId
            })
            .execute();
          return { id: draft.id };
        }

        const onOpenDocument = new Set(
          onOpenReceipts.map((row) => row.rentalAgreementLineId)
        );
        const units = candidates.filter((line) => !onOpenDocument.has(line.id));
        if (units.length === 0) {
          throw new InvalidInputError("No units to return");
        }

        const header = await trx
          .insertInto("receipt")
          .values({
            receiptId: await getNextSequence(trx, "receipt", companyId),
            sourceDocument: "Rental Agreement",
            sourceDocumentId: agreement.id,
            sourceDocumentReadableId: agreement.rentalAgreementId,
            locationId: agreement.locationId,
            status: "Draft",
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("receiptFixedAssetLine")
          .values(
            units.map((line) => ({
              receiptId: header.id,
              rentalAgreementLineId: line.id,
              // The shortcut names its unit, so it comes back ticked; a
              // whole-agreement receipt ticks only what is out on rent.
              received: rentalAgreementLineId
                ? true
                : line.status === "On Rent",
              companyId,
              createdBy: userId
            }))
          )
          .execute();
        return { id: header.id };
      });
    }
    case "journalEntry": {
      let createdDocumentId;
      const id = await db.transaction().execute(async (trx) => {
        const journalEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );

        const newJournalEntry = await trx
          .insertInto("journal")
          .values({
            journalEntryId,
            postingDate: datetime
              .today(await resolveCompanyTimeZone(trx, companyId))
              .toString(),
            companyId,
            sourceType: "Manual",
            status: "Draft",
            createdBy: userId
          })
          .returning(["id"])
          .execute();

        createdDocumentId = newJournalEntry?.[0]?.id;
        if (!createdDocumentId)
          throw new Error("Failed to create journal entry");
        return createdDocumentId;
      });

      return { id };
    }
    default:
      throw new InvalidInputError("Invalid document type");
  }
}

export type ReceiptLineItem = Omit<
  Database["public"]["Tables"]["receiptLine"]["Insert"],
  "id" | "receiptId" | "updatedBy" | "createdAt" | "updatedAt"
>;

export type ShipmentLineItem = Omit<
  Database["public"]["Tables"]["shipmentLine"]["Insert"],
  "id" | "shipmentId" | "updatedBy" | "createdAt" | "updatedAt"
>;
/**
 * Pure journal-line builders for moving value between inventory and the fixed
 * asset register — capitalising stock / WIP / CIP into an asset, and returning
 * an asset to stock at its net book value.
 *
 * A line's stored amount is natural-balance-signed the way `journalLine.amount`
 * is: on an Asset account `debit("asset", x)` is +x and `credit("asset", x)` is
 * −x. Every account is class Asset except the offset of `buildOffsetLines`
 * (and an entered cost's credit), which is signed by its own class. Each
 * amount is rounded to the internal scale before it is placed on a line, and
 * every builder refuses to return an unbalanced set of lines.
 */

export type PostingLine = {
  accountId: string;
  description: string;
  amount: number;
};

export type AssetAccounts = {
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
};

/** A finite input, rounded to the internal scale the ledger stores. */
function ledgerAmount(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return round(value);
}

// Every line here sits on an Asset-class account, so the stored amounts are
// already signed debits (+ debit, − credit) and a balanced journal sums to 0.
function assertAssetLinesBalance(lines: PostingLine[], label: string): void {
  const signedDebitTotal = round(
    lines.reduce((sum, line) => sum + line.amount, 0)
  );
  assertBalanced(signedDebitTotal, 0, EPSILON, label);
}

/** A stored, natural-balance-signed amount as a signed debit. */
function asSignedDebit(type: AccountType, amount: number): number {
  return amount * debit(type, 1);
}

/**
 * Capitalise `cost` into a fixed asset: Dr the asset account, Cr the account
 * the value came from — a stock account (Finished Goods / Raw Materials), WIP,
 * or CIP — under `creditDescription`. `creditAccountType` is that account's
 * class (default asset): an entered cost is credited to whatever account it
 * was spent from — Retained Earnings is Equity, so its credit is stored +x.
 */
export function buildCapitalizationLines(args: {
  cost: number;
  assetAccountId: string;
  creditAccountId: string;
  creditDescription: string;
  creditAccountType?: AccountType;
}): PostingLine[] {
  const cost = ledgerAmount(args.cost, "Asset cost");
  // A cost that rounds to nothing at ledger precision has nothing to post.
  if (cost <= 0) throw new Error("Asset cost must be positive");

  return buildOffsetLines({
    amount: cost,
    accountId: args.assetAccountId,
    description: "Fixed Asset Acquisition",
    offsetAccountId: args.creditAccountId,
    offsetDescription: args.creditDescription,
    offsetAccountType: args.creditAccountType ?? "asset",
    label: "Asset capitalization journal"
  });
}

/**
 * Raise (`amount` > 0) or lower (`amount` < 0) an Asset-class account against
 * an offset account of any class: Dr asset / Cr offset to raise, the reverse
 * to lower. Each line is signed by its own account's natural balance, and the
 * pair is checked as debits = credits.
 */
export function buildOffsetLines(args: {
  amount: number;
  accountId: string;
  description: string;
  offsetAccountId: string;
  offsetDescription: string;
  offsetAccountType: AccountType;
  label: string;
}): PostingLine[] {
  const amount = ledgerAmount(args.amount, args.label);
  if (amount === 0) throw new Error(`${args.label} has nothing to post`);
  const raise = amount > 0;
  const size = Math.abs(amount);
  const lines: PostingLine[] = [
    {
      accountId: args.accountId,
      description: args.description,
      amount: raise ? debit("asset", size) : credit("asset", size)
    },
    {
      accountId: args.offsetAccountId,
      description: args.offsetDescription,
      amount: raise
        ? credit(args.offsetAccountType, size)
        : debit(args.offsetAccountType, size)
    }
  ];
  const [assetLine, offsetLine] = lines as [PostingLine, PostingLine];
  assertBalanced(
    round(
      asSignedDebit("asset", assetLine.amount) +
        asSignedDebit(args.offsetAccountType, offsetLine.amount)
    ),
    0,
    EPSILON,
    args.label
  );
  return lines;
}

/**
 * Return a fixed asset to inventory at its net book value: Dr inventory for
 * `cost − accumulatedDepreciation`, Dr accumulated depreciation to clear it
 * (omitted when nothing has been depreciated), Cr the asset account at cost.
 */
export function buildReturnToInventoryLines(args: {
  cost: number;
  accumulatedDepreciation: number;
  inventoryAccountId: string;
  inventoryDescription: string;
  accounts: AssetAccounts;
}): PostingLine[] {
  const cost = ledgerAmount(args.cost, "Asset cost");
  const accumulatedDepreciation = ledgerAmount(
    args.accumulatedDepreciation,
    "Accumulated depreciation"
  );
  if (cost <= 0) throw new Error("Asset cost must be positive");
  if (accumulatedDepreciation < 0) {
    throw new Error("Accumulated depreciation must not be negative");
  }
  if (accumulatedDepreciation > cost) {
    throw new Error("Accumulated depreciation exceeds asset cost");
  }
  const netBookValue = round(cost - accumulatedDepreciation);

  const lines: PostingLine[] = [
    {
      accountId: args.inventoryAccountId,
      description: args.inventoryDescription,
      amount: debit("asset", netBookValue)
    }
  ];
  if (accumulatedDepreciation !== 0) {
    lines.push({
      accountId: args.accounts.accumulatedDepreciationAccountId,
      description: "Accumulated Depreciation",
      amount: debit("asset", accumulatedDepreciation)
    });
  }
  lines.push({
    accountId: args.accounts.assetAccountId,
    description: "Fixed Asset Cost",
    amount: credit("asset", cost)
  });
  assertAssetLinesBalance(lines, "Asset return to inventory journal");
  return lines;
}
export interface CostLayer {
  costLedgerId: string;
  quantityConsumed: number;
  unitCost: number;
}

export interface COGSResult {
  unitCost: number;
  totalCost: number;
  layersConsumed: CostLayer[];
}

export async function calculateCOGS(
  trx: Transaction<DB>,
  {
    itemId,
    quantity,
    companyId,
    trackedEntityIds
  }: {
    itemId: string;
    quantity: number;
    companyId: string;
    // The serial units leaving, when the caller knows them: each is relieved
    // from the layer booked for it (specific identification) before the
    // FIFO / LIFO layers (`orderLayersForConsumption`).
    trackedEntityIds?: readonly string[];
  }
): Promise<COGSResult> {
  const itemCost = await trx
    .selectFrom("itemCost")
    .selectAll()
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const costingMethod = itemCost.costingMethod;

  switch (costingMethod) {
    case "Standard": {
      const standardCost = Number(itemCost.standardCost ?? 0);
      return {
        unitCost: standardCost,
        totalCost: standardCost * quantity,
        layersConsumed: []
      };
    }

    case "Average": {
      const unitCost = Number(itemCost.unitCost ?? 0);
      return {
        unitCost,
        totalCost: unitCost * quantity,
        layersConsumed: []
      };
    }

    case "FIFO":
    case "LIFO": {
      // The item's open layers, oldest first, and their open adjustment
      // children. Locked for this transaction: two concurrent consumers
      // would otherwise both read the same remainingQuantity and consume the
      // layer twice (lost update).
      const openLayers = trx
        .selectFrom("costLedger")
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("remainingQuantity", ">", 0)
        .where(isCostLayer);
      const layers = await openLayers
        .select([
          "id",
          "quantity",
          "cost",
          "remainingQuantity",
          "trackedEntityId"
        ])
        .orderBy("postingDate", "asc")
        .orderBy("createdAt", "asc")
        .forUpdate()
        .execute();
      const children = await trx
        .selectFrom("costLedger")
        .select([
          "id",
          "appliesToCostLedgerId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("companyId", "=", companyId)
        .where("appliesToCostLedgerId", "in", openLayers.select("id"))
        .where("remainingQuantity", ">", 0)
        .orderBy("createdAt", "asc")
        .forUpdate()
        .execute();
      const childrenByLayer = Map.groupBy(
        children,
        (child) => child.appliesToCostLedgerId
      );

      const relief = relieveLayers(
        layers.map((layer) => ({
          id: layer.id,
          quantity: Number(layer.quantity),
          cost: Number(layer.cost),
          remainingQuantity: Number(layer.remainingQuantity),
          trackedEntityId: layer.trackedEntityId,
          children: (childrenByLayer.get(layer.id) ?? []).map((child) => ({
            id: child.id,
            quantity: Number(child.quantity),
            cost: Number(child.cost),
            remainingQuantity: Number(child.remainingQuantity)
          }))
        })),
        costingMethod,
        { quantity, trackedEntityIds: trackedEntityIds ?? [] },
        // Negative inventory: a quantity no layer covers.
        Number(itemCost.unitCost ?? 0)
      );

      if (relief.remaining.size > 0) {
        await sql`
          UPDATE "costLedger" AS c
          SET "remainingQuantity" = v."remaining"
          FROM (VALUES ${sql.join(
            [...relief.remaining].map(
              ([id, remaining]) => sql`(${id}, ${remaining}::numeric)`
            )
          )}) AS v("id", "remaining")
          WHERE c."id" = v."id" AND c."companyId" = ${companyId}
        `.execute(trx);
      }

      return {
        unitCost: quantity > 0 ? relief.totalCost / quantity : 0,
        totalCost: relief.totalCost,
        layersConsumed: relief.layersConsumed.map((layer) => ({
          costLedgerId: layer.layerId,
          quantityConsumed: layer.quantity,
          unitCost: layer.unitCost
        }))
      };
    }

    default:
      throw new Error(`Unsupported costing method: ${costingMethod}`);
  }
}
/**
 * Serializes every writer of one company's contract positions. A movement is
 * computed from the position as read, so two writers interleaving on one line
 * would both draw on the same pool. Transaction-scoped: released at commit.
 */
export async function lockContractPositions(
  trx: KyselyTx,
  companyId: string
): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`contract-position:${companyId}`}))`.execute(
    trx
  );
}

/** Each line's position — the sum of its ledger entries — in one grouped
 *  read. A line with no entries is the empty position. */
export async function loadContractPositions(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  lineIds: string[]
): Promise<Map<string, ContractPosition>> {
  const positions = new Map<string, ContractPosition>();
  const ids = [...new Set(lineIds)];
  for (const id of ids) positions.set(id, { ...EMPTY_POSITION });
  if (ids.length === 0) return positions;
  const rows = await db
    .selectFrom("customerContractLedgerEntry")
    .select([
      "customerContractLineId",
      sql<number>`COALESCE(SUM("deferredAmount"), 0)`.as("deferredAmount"),
      sql<number>`COALESCE(SUM("deferredBase"), 0)`.as("deferredBase"),
      sql<number>`COALESCE(SUM("assetAmount"), 0)`.as("assetAmount"),
      sql<number>`COALESCE(SUM("assetBase"), 0)`.as("assetBase")
    ])
    .where("companyId", "=", companyId)
    .where("customerContractLineId", "in", ids)
    .groupBy("customerContractLineId")
    .execute();
  for (const row of rows) {
    positions.set(row.customerContractLineId, {
      deferredAmount: Number(row.deferredAmount),
      deferredBase: Number(row.deferredBase),
      assetAmount: Number(row.assetAmount),
      assetBase: Number(row.assetBase)
    });
  }
  return positions;
}

export function samePosition(a: ContractPosition, b: ContractPosition) {
  return (
    equals(a.deferredAmount, b.deferredAmount) &&
    equals(a.deferredBase, b.deferredBase) &&
    equals(a.assetAmount, b.assetAmount) &&
    equals(a.assetBase, b.assetBase)
  );
}

/** A signed credit (negative = debit) as the stored natural-balance amount of
 *  an account of `accountClass`. */
export function signedCreditAmount(accountClass: string, amount: number) {
  const type = accountTypeFromClass(accountClass);
  return amount >= 0 ? credit(type, amount) : debit(type, -amount);
}
/**
 * The dimension a charge or reimbursement line's cost center and project
 * post under: the oldest active Cost Center and Project dimension of the
 * company group, or null when the group has none. One read for both.
 */
export async function costCenterAndProjectDimensions(
  trx: Kysely<DB>,
  companyGroupId: string | null
): Promise<{ costCenter: string | null; project: string | null }> {
  // A company in no group has no dimensions.
  if (!companyGroupId) return { costCenter: null, project: null };
  const dimensions = await trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["CostCenter", "Project"])
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  return {
    costCenter:
      dimensions.find((dimension) => dimension.entityType === "CostCenter")
        ?.id ?? null,
    project:
      dimensions.find((dimension) => dimension.entityType === "Project")?.id ??
      null
  };
}
// The tracked entities an item's outgoing ledger rows name — the ids to pass
// calculateCOGS as `trackedEntityIds`. Batch ids come along harmlessly: only
// serial layers are ever stamped, so a batch id matches no layer.
export function leavingTrackedEntityIds(
  ledgerRows: readonly {
    itemId?: string | null;
    trackedEntityId?: string | null;
    quantity?: number | null;
  }[],
  itemId: string
): string[] {
  const leaving = new Set<string>();
  for (const row of ledgerRows) {
    if (
      row.itemId === itemId &&
      row.trackedEntityId &&
      (row.quantity ?? 0) < 0
    ) {
      leaving.add(row.trackedEntityId);
    }
  }
  return [...leaving];
}
/** A currency's settlement precision for this company: the group's
 *  `currency.decimalPlaces`, never a literal. Billed amounts (rental billing
 *  periods, lease payment rows) are rounded to it. */
export async function currencyDecimals(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  currencyCode: string
): Promise<number> {
  const currency = await trx
    .selectFrom("currency")
    .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
    .select("currency.decimalPlaces")
    .where("company.id", "=", companyId)
    .where("currency.code", "=", currencyCode)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces === null) {
    throw new InvalidInputError(
      `Currency ${currencyCode} is not set up for this company`
    );
  }
  return currency.decimalPlaces;
}
export const INVENTORY_VOID_BEFORE_CUTOVER_ERROR =
  "This document is from before your accounting cutover. Record a return or an inventory adjustment instead.";

export const SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR =
  "This invoice is from before your accounting cutover. Issue a credit memo instead.";

export const PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR =
  "This invoice is from before your accounting cutover. Record a debit memo instead.";

export const CHARGE_VOID_BEFORE_CUTOVER_ERROR =
  "This charge is from before your accounting cutover. Record a journal entry to correct it instead.";

export const REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR =
  "This reimbursement is from before your accounting cutover. Record a journal entry to correct it instead.";

export const STOCK_CORRECTION_BEFORE_CUTOVER_ERROR =
  "This movement is from before your accounting cutover. Record an inventory adjustment instead.";

export const TIME_ENTRY_BEFORE_CUTOVER_ERROR =
  "This time entry was posted before your accounting cutover. Record a journal entry to correct it instead.";

/**
 * Throws `message` when the document's posting date is before the company's
 * cutover. Call it before any write. A company with no cutover, or a document
 * with no posting date, passes.
 */
export async function refuseVoidBeforeCutover(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  postingDate: string | null | undefined,
  message: string
): Promise<void> {
  if (!postingDate) return;
  const cutoverDate = await readAccountingCutoverDate(db, companyId);
  if (isBeforeCutover(postingDate, cutoverDate)) {
    throw new InvalidInputError(message);
  }
}

/**
 * Refuses a rebuilt void line on Migration Clearing. Only the opening journal
 * and the trial balance post there; a void that did would move the proof
 * that the opening ties out.
 */
export function assertNoMigrationClearing(
  lines: { accountId: string | null }[],
  migrationClearingAccountId: string | null
): void {
  if (
    migrationClearingAccountId &&
    lines.some((line) => line.accountId === migrationClearingAccountId)
  ) {
    throw new Error("A void never posts to the Migration Clearing account.");
  }
}
type DocumentType = Database["public"]["Enums"]["journalLineDocumentType"];

/** What narrows the lines. Every field set must match; an empty list matches
 *  nothing. */
export type DocumentJournalLineFilter = {
  documentId?: string;
  documentType?: DocumentType | readonly DocumentType[];
  documentLineReference?: readonly string[];
  journalId?: readonly string[];
  journalLineReference?: readonly string[];
  accrual?: boolean;
};

export async function documentJournalLines(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  filter: DocumentJournalLineFilter
): Promise<Selectable<KyselyDatabase["journalLine"]>[]> {
  const lists = [
    filter.documentLineReference,
    filter.journalId,
    filter.journalLineReference
  ];
  if (lists.some((list) => list !== undefined && list.length === 0)) {
    return [];
  }
  let query = db
    .selectFrom("journalLine")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "journalLine.journalId")
        .onRef("journal.companyId", "=", "journalLine.companyId")
    )
    .selectAll("journalLine")
    .where("journalLine.companyId", "=", companyId)
    .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES]);
  if (filter.documentId !== undefined) {
    query = query.where("journalLine.documentId", "=", filter.documentId);
  }
  if (typeof filter.documentType === "string") {
    query = query.where("journalLine.documentType", "=", filter.documentType);
  } else if (filter.documentType !== undefined) {
    query = query.where("journalLine.documentType", "in", [
      ...filter.documentType
    ]);
  }
  if (filter.documentLineReference !== undefined) {
    query = query.where("journalLine.documentLineReference", "in", [
      ...filter.documentLineReference
    ]);
  }
  if (filter.journalId !== undefined) {
    query = query.where("journalLine.journalId", "in", [...filter.journalId]);
  }
  if (filter.journalLineReference !== undefined) {
    query = query.where("journalLine.journalLineReference", "in", [
      ...filter.journalLineReference
    ]);
  }
  if (filter.accrual !== undefined) {
    query = query.where("journalLine.accrual", "=", filter.accrual);
  }
  return query.execute();
}
/**
 * Keeps Draft revenue recognition runs in step with a Planned schedule row a
 * document is about to delete or shrink. A run line copies its row's amount
 * when the run is proposed and posting uses that copy, so a credit memo that
 * trimmed a held deferral left the run recognizing the old amount, and a void
 * or memo that deleted one tripped the line's ON DELETE RESTRICT foreign key.
 * Only a Draft run can hold a Planned row (posting flips both), so this never
 * touches a posted run. A run left with no lines is deleted — it could not
 * post. Call it in the document's transaction, BEFORE the schedule write.
 */
export async function syncDraftRecognitionRuns(
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    deletedScheduleIds?: string[];
    reduced?: { id: string; amount: number }[];
  }
): Promise<void> {
  const { companyId, userId, deletedScheduleIds = [], reduced = [] } = args;

  if (deletedScheduleIds.length > 0) {
    const released = await trx
      .deleteFrom("revenueRecognitionRunLine")
      .where("companyId", "=", companyId)
      .where("scheduleId", "in", deletedScheduleIds)
      .returning("runId")
      .execute();
    const runIds = [...new Set(released.map((line) => line.runId))];
    if (runIds.length > 0) {
      await trx
        .deleteFrom("revenueRecognitionRun")
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .where("id", "in", runIds)
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom("revenueRecognitionRunLine as l")
                .select("l.id")
                .whereRef("l.runId", "=", "revenueRecognitionRun.id")
                .where("l.companyId", "=", companyId)
            )
          )
        )
        .execute();
    }
  }

  if (reduced.length > 0) {
    await trx
      .updateTable("revenueRecognitionRunLine")
      .set({
        amount: sql<number>`CASE "scheduleId" ${sql.join(
          reduced.map(
            ({ id, amount }) => sql`WHEN ${id} THEN ${amount}::numeric`
          ),
          sql` `
        )} END`,
        updatedBy: userId
      })
      .where("companyId", "=", companyId)
      .where(
        "scheduleId",
        "in",
        reduced.map(({ id }) => id)
      )
      .execute();
  }
}
type FixedAssetUpdate = Database["public"]["Tables"]["fixedAsset"]["Update"];

type Write = (trx: Kysely<KyselyDatabase>) => Promise<unknown>;

/** Fixed-asset writes decided while the journal is built, applied inside the
 *  posting transaction so a failed post leaves the asset register untouched. */
export class FixedAssetWrites {
  private patches = new Map<string, FixedAssetUpdate>();
  private writes: Write[] = [];

  /** Later lines of one document see what earlier lines staged. */
  overlay<T extends object>(assetId: string, row: T): T {
    return Object.assign(row, this.patches.get(assetId));
  }

  patch(assetId: string, set: FixedAssetUpdate): void {
    this.patches.set(assetId, { ...this.patches.get(assetId), ...set });
  }

  defer(write: Write): void {
    this.writes.push(write);
  }

  async apply(trx: Kysely<KyselyDatabase>, companyId: string): Promise<void> {
    for (const [id, set] of this.patches) {
      await updateRows(trx, "fixedAsset", set, { id, companyId });
    }
    for (const write of this.writes) await write(trx);
  }
}
const MONTH_NUMBER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12
};

type PeriodMode = "historical" | "historical-with-shift" | "current";

function closedPeriodError(mode: PeriodMode, closed: boolean): Error {
  if (mode === "historical") {
    return new Error(
      closed
        ? "The original movement's accounting period is closed — its movements can no longer be corrected."
        : "The original movement's accounting period is locked. Unlock it before posting a correction."
    );
  }
  return new Error(
    closed
      ? "Accounting period is closed. Reopen it before posting."
      : "Accounting period is locked. Unlock it before posting operational documents."
  );
}

/** Resolve a posting date and lock its period on the caller's transaction.
 * Historical card imports may shift to the next open period; corrections keep
 * their original date. Only current-period posting changes the Active period,
 * and only when the period contains the company's today: a posting dated in
 * another month (a catch-up run, a back-dated document) leaves it alone.
 */
export async function resolveAccountingPeriod(
  db: Kysely<DB>,
  companyId: string,
  requestedDate: string,
  mode: PeriodMode
): Promise<{ id: string; postingDate: string }> {
  // Reuse a transaction instead of borrowing a second pool connection. All
  // reads observe the same transaction.
  if (!db.isTransaction) {
    return db
      .transaction()
      .execute((trx) =>
        resolveAccountingPeriod(trx, companyId, requestedDate, mode)
      );
  }

  const periods = db
    .selectFrom("accountingPeriod")
    .select([
      "id",
      // Keep calendar values as ISO text, never passing through a JavaScript
      // Date.
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string>`"endDate"::text`.as("endDate"),
      "status",
      "closeStatus",
      "closedAt"
    ])
    .where("companyId", "=", companyId);
  let period = await periods
    .where("startDate", "<=", requestedDate)
    .where("endDate", ">=", requestedDate)
    .orderBy("startDate")
    .orderBy("id")
    .forUpdate()
    .executeTakeFirst();

  const isClosed =
    period &&
    (period.closeStatus === "Locked" ||
      period.closeStatus === "Closed" ||
      period.closedAt !== null);
  if (isClosed && mode === "historical-with-shift") {
    period = await periods
      .where("startDate", ">", requestedDate)
      .where("closeStatus", "=", "Open")
      .where("closedAt", "is", null)
      .orderBy("startDate")
      .orderBy("id")
      .forUpdate()
      .executeTakeFirst();
    if (!period) {
      throw new Error(
        "Accounting period is locked or closed; no open successor exists"
      );
    }
  } else if (period && isClosed) {
    throw closedPeriodError(
      mode,
      period.closeStatus === "Closed" || period.closedAt !== null
    );
  }

  if (!period) {
    const date = parseDate(requestedDate);
    const fiscalSettings = await db
      .selectFrom("fiscalYearSettings")
      .select("startMonth")
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    const startMonth = fiscalSettings?.startMonth
      ? (MONTH_NUMBER[fiscalSettings.startMonth] ?? 1)
      : 1;
    const fiscalYear =
      startMonth === 1 || date.month < startMonth ? date.year : date.year + 1;
    const periodNumber = ((date.month - startMonth + 12) % 12) + 1;
    // Create inactive, then activate below: this also preserves one active
    // period while simultaneous first-time callers converge on the same row.
    await db
      .insertInto("accountingPeriod")
      .values({
        startDate: startOfMonth(date).toString(),
        endDate: endOfMonth(date).toString(),
        fiscalYear,
        periodNumber,
        status: "Inactive",
        closeStatus: "Open",
        companyId,
        createdBy: "system"
      })
      .onConflict((oc) =>
        oc.columns(["companyId", "fiscalYear", "periodNumber"]).doNothing()
      )
      .execute();
    period = await periods
      .where("fiscalYear", "=", fiscalYear)
      .where("periodNumber", "=", periodNumber)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (
      period.closeStatus === "Locked" ||
      period.closeStatus === "Closed" ||
      period.closedAt !== null
    ) {
      throw closedPeriodError(
        mode,
        period.closeStatus === "Closed" || period.closedAt !== null
      );
    }
  }

  if (mode === "current" && period.status !== "Active") {
    const today = datetime
      .today(await resolveCompanyTimeZone(db, companyId))
      .toString();
    if (period.startDate <= today && period.endDate >= today) {
      await db
        .updateTable("accountingPeriod")
        .set({ status: "Inactive" })
        .where("companyId", "=", companyId)
        .where("status", "=", "Active")
        .execute();
      await db
        .updateTable("accountingPeriod")
        .set({ status: "Active" })
        .where("companyId", "=", companyId)
        .where("id", "=", period.id)
        .execute();
    }
  }
  return {
    id: period.id,
    postingDate:
      mode === "historical-with-shift" && period.startDate > requestedDate
        ? period.startDate
        : requestedDate
  };
}

/** Original-period corrections retain the existing public calling contract. */
export async function getAccountingPeriodForDate(
  companyId: string,
  db: Kysely<DB>,
  date: string
) {
  return (await resolveAccountingPeriod(db, companyId, date, "historical")).id;
}

/** Pass the same business day used by the caller's journal and ledger rows. */
export async function getCurrentAccountingPeriod(
  companyId: string,
  db: Kysely<DB>,
  forDate?: string
) {
  const date =
    forDate ??
    datetime.today(await resolveCompanyTimeZone(db, companyId)).toString();
  return (await resolveAccountingPeriod(db, companyId, date, "current")).id;
}
/** The company's posting accounts. Pass `db` (or `trx`); a Supabase client still works. */
export async function getDefaultPostingGroup(
  client: AnyPostgresClient,
  companyId: string
) {
  if (isKysely(client)) {
    return await single(client, "accountDefault", { companyId });
  }
  return await client
    .from("accountDefault")
    .select("*")
    .eq("companyId", companyId)
    .single();
}

// Buy → Raw Materials; Make / Buy and Make → Finished Goods. The rule is a
// stable property of the item so the debit side (receipt/job completion) and
// the credit side (shipment/issue/invoice) always hit the same account.
export function resolveInventoryAccount(
  replenishmentSystem:
    | Database["public"]["Enums"]["itemReplenishmentSystem"]
    | null,
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
  }
): { account: string; description: string } {
  return replenishmentSystem === "Make" ||
    replenishmentSystem === "Buy and Make"
    ? {
        account: accountDefaults.finishedGoodsAccount,
        description: "Finished Goods Account"
      }
    : {
        account: accountDefaults.rawMaterialsAccount,
        description: "Raw Materials Account"
      };
}
/** A journal line's dimension values, by entity type: the shape a pure
 *  posting builder returns and the legacy backfill writes as is. */
export type JournalLineDimensionValues = Partial<
  Record<Database["public"]["Enums"]["dimensionEntityType"], string | null>
>;

/**
 * The `journalLineDimension` rows of inserted lines: `journalLineIds[i]` is
 * the id of `lines[i]`. A value whose entity type has no active dimension
 * (`dimensionIdByEntity`) writes none. Rows follow each line's key order.
 */
export function journalLineDimensionRows({
  journalLineIds,
  lines,
  dimensionIdByEntity,
  companyId
}: {
  journalLineIds: string[];
  lines: { dimensions: JournalLineDimensionValues }[];
  dimensionIdByEntity: ReadonlyMap<string, string>;
  companyId: string;
}) {
  return journalLineIds.flatMap((journalLineId, index) =>
    Object.entries(lines[index]?.dimensions ?? {}).flatMap(
      ([entityType, valueId]) => {
        const dimensionId = dimensionIdByEntity.get(entityType);
        return dimensionId && valueId
          ? [{ journalLineId, dimensionId, valueId, companyId }]
          : [];
      }
    )
  );
}
/**
 * Allocate native journal-line ids before a bulk insert. Callers can then keep
 * related rows bound to the intended line without depending on PostgreSQL's
 * unspecified INSERT ... RETURNING row order.
 */
export async function allocateJournalLineIds(
  trx: Transaction<KyselyDatabase>,
  count: number
): Promise<string[]> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Journal line id count must be a non-negative integer");
  }
  if (count === 0) return [];

  const allocated = await sql<{ id: string; position: number }>`
    SELECT id('jl') AS id, position::integer AS position
    FROM generate_series(1, ${count}) WITH ORDINALITY AS requested(_, position)
    ORDER BY position
  `.execute(trx);
  if (allocated.rows.length !== count) {
    throw new Error("Failed to allocate journal line ids");
  }
  return allocated.rows.map((row) => row.id);
}
type Enums = Database["public"]["Enums"];

/** The lease terms a payment row is cut from. */
export type LeasePaymentCutTerms = {
  commencementDate: string;
  /** Null is open-ended: pass `through`. */
  endDate: string | null;
  /** A row due before it was paid outside Carbon: it is Skipped. */
  invoiceFromDate: string;
  paymentFrequency: Enums["leasePaymentFrequency"];
  paymentTiming: Enums["rentalBillingTiming"];
  annualEscalationPercent: number;
};

/** The leased asset (`leaseLine`) whose rows are cut. */
export type LeasePaymentCutAsset = {
  id: string;
  /** The payment at commencement. */
  paymentAmount: number;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
};

export type CutLeasePaymentRow = LeasePaymentRowInput & {
  leaseLineId: string;
  status: Extract<Enums["leasePaymentStatus"], "Pending" | "Skipped">;
};

/**
 * One asset's payment rows, cut from the COMMENCEMENT so the escalation steps
 * up on its anniversaries and a lease from the 29th–31st keeps its clamped
 * months (`generateLeasePayments`: a short last period prorated by days; the
 * purchase option on the end date, only when it is reasonably certain). A row
 * due before `invoiceFromDate` was paid outside Carbon and is `Skipped`; a row
 * of 0 is never cut.
 *
 * - `through` — an open-ended lease: the last date a period may start on
 *   (`openEndedLeaseHorizon`).
 * - `after` — only the periods that start after it (the rows an open-ended
 *   lease already has end there, edited or not).
 * - `from` — Modify: only the rows from lease month `month` on, where the
 *   asset pays `paymentAtStart` (`remainingLeasePayments`, the math the
 *   Modify preview shares): its commencement payment is derived from it,
 *   and a period that started before the month (the frequency changed) is
 *   cut down to its days from there.
 *
 * Returns the commencement payment the rows are cut at, which Modify stores
 * on the asset.
 */
export function cutLeasePaymentRows(args: {
  lease: LeasePaymentCutTerms;
  asset: LeasePaymentCutAsset;
  decimals: number;
  through?: string;
  after?: string | null;
  from?: { month: number; paymentAtStart: number };
}): { commencementPayment: number; rows: CutLeasePaymentRow[] } {
  const { lease, asset, decimals, from } = args;
  const purchaseOptionAmount = asset.purchaseOptionReasonablyCertain
    ? (asset.purchaseOptionAmount ?? 0)
    : 0;
  let cut: { commencementPayment: number; rows: LeasePaymentRowInput[] };
  if (from) {
    if (!lease.endDate) {
      throw new Error("Only a lease with an end date is cut from a month");
    }
    cut = remainingLeasePayments({
      commencementDate: lease.commencementDate,
      fromMonth: from.month,
      endDate: lease.endDate,
      paymentAtStart: from.paymentAtStart,
      frequency: lease.paymentFrequency,
      timing: lease.paymentTiming,
      annualEscalationPercent: lease.annualEscalationPercent,
      purchaseOptionAmount,
      decimals
    });
  } else {
    cut = {
      commencementPayment: asset.paymentAmount,
      rows: generateLeasePayments({
        commencementDate: lease.commencementDate,
        endDate: lease.endDate,
        through: args.through,
        paymentAmount: asset.paymentAmount,
        frequency: lease.paymentFrequency,
        timing: lease.paymentTiming,
        annualEscalationPercent: lease.annualEscalationPercent,
        purchaseOptionAmount,
        decimals
      })
    };
  }

  const rows = cut.rows
    .filter(
      (row) => row.amount > 0 && (!args.after || row.periodStart > args.after)
    )
    .map(
      (row): CutLeasePaymentRow => ({
        ...row,
        leaseLineId: asset.id,
        status: row.dueDate < lease.invoiceFromDate ? "Skipped" : "Pending"
      })
    );

  return { commencementPayment: round(cut.commencementPayment), rows };
}
// The account an entered cost is credited to: where that value was booked
// when it was spent (an expense this year, Retained Earnings for an earlier
// one). Any active posting account of the company group.
export async function getOffsetAccount(
  db: Kysely<DB>,
  companyId: string,
  accountId: string | null | undefined
): Promise<{ id: string; type: AccountType }> {
  if (!accountId) {
    throw new InvalidInputError(
      "Choose the account the cost was booked to when it was spent"
    );
  }
  const account = await db
    .selectFrom("account")
    .innerJoin("company", "company.companyGroupId", "account.companyGroupId")
    .select(["account.id", "account.class"])
    .where("account.id", "=", accountId)
    .where("company.id", "=", companyId)
    .where("account.active", "=", true)
    .where("account.isGroup", "=", false)
    .executeTakeFirst();
  if (!account || !isAccountClass(account.class)) {
    throw new InvalidInputError(
      "The offset account must be an active posting account"
    );
  }
  // The credit is signed by the account's own class (Retained Earnings is
  // Equity), not as the inventory account it replaces.
  return { id: account.id, type: accountTypeFromClass(account.class) };
}
type PartyDimension = { id: string; entityType: string };

/** The company group's active party dimensions, for `partyDimensionValuesFrom`. */
export function loadPartyDimensions(
  trx: Transaction<KyselyDatabase>,
  companyGroupId: string,
  entityTypes: ("CustomerType" | "Customer" | "SupplierType" | "Supplier")[] = [
    "CustomerType",
    "Customer",
    "SupplierType",
    "Supplier"
  ]
): Promise<PartyDimension[]> {
  return trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", entityTypes)
    .execute();
}

/** `partyDimensionValues` over dimensions already read. */
export function partyDimensionValuesFrom(
  dimensions: PartyDimension[],
  args: { isAR: boolean; partyId: string; typeId: string | null }
): { dimensionId: string; valueId: string }[] {
  const { isAR, partyId, typeId } = args;
  const partyType = isAR ? "Customer" : "Supplier";
  return dimensions
    .filter((dimension) =>
      isAR
        ? dimension.entityType === "CustomerType" ||
          dimension.entityType === "Customer"
        : dimension.entityType === "SupplierType" ||
          dimension.entityType === "Supplier"
    )
    .flatMap((dimension) => {
      const valueId = dimension.entityType === partyType ? partyId : typeId;
      return valueId ? [{ dimensionId: dimension.id, valueId }] : [];
    });
}

/**
 * The party dimensions of a payment or memo journal: Customer and
 * CustomerType for a customer, Supplier and SupplierType for a supplier.
 * Every line of the journal carries each of them.
 */
export async function partyDimensionValues(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyGroupId: string;
    isAR: boolean;
    partyId: string;
    typeId: string | null;
  }
): Promise<{ dimensionId: string; valueId: string }[]> {
  const { companyGroupId, isAR } = args;
  const dimensions = await loadPartyDimensions(
    trx,
    companyGroupId,
    isAR ? ["CustomerType", "Customer"] : ["SupplierType", "Supplier"]
  );
  return partyDimensionValuesFrom(dimensions, args);
}
type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

type CostLedgerInsert = Database["public"]["Tables"]["costLedger"]["Insert"];

type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

type JournalLineDimensionInsert =
  Database["public"]["Tables"]["journalLineDimension"]["Insert"];

type ItemLedgerDocumentType =
  Database["public"]["Enums"]["itemLedgerDocumentType"];

type JournalLineDocumentType =
  Database["public"]["Enums"]["journalLineDocumentType"];

// itemLedgerDocumentType values that also exist on journalLineDocumentType.
// The journal line falls back to 'Inventory Adjustment' for ledger documentType
// values the journal enum doesn't carry (e.g. 'Sales Invoice', 'Direct
// Transfer', 'Posted Assembly') — inserting those would fail the enum cast.
export const JOURNAL_LINE_SAFE_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "Sales Shipment",
  "Purchase Receipt",
  "Purchase Invoice",
  "Transfer Shipment",
  "Job Consumption",
  "Job Receipt",
  "Batch Split",
  "Maintenance Consumption",
  "Inventory Count",
  "Non-Conformance",
  "Inbound Inspection",
  "Scrap",
  "Asset Transfer"
]);

export function toJournalLineDocumentType(
  documentType: ItemLedgerDocumentType | null | undefined
): JournalLineDocumentType {
  return (
    documentType && JOURNAL_LINE_SAFE_DOCUMENT_TYPES.has(documentType)
      ? documentType
      : "Inventory Adjustment"
  ) as JournalLineDocumentType;
}

// The item ledger row for a movement — the stock movement itself, written
// before anything that references it. `quantity` is SIGNED (positive for an
// increase, negative for a decrease) and is the only field with arithmetic on
// it. Every caller goes through here so a column added to the movement lands
// on the single-record path and the bulk importer at once.
export function buildItemLedgerRow(args: {
  postingDate: string;
  entryType: Database["public"]["Enums"]["itemLedgerType"];
  documentType?: ItemLedgerDocumentType | null;
  documentId?: string | null;
  correctionOfItemLedgerId?: string | null;
  itemId: string;
  locationId: string | null;
  storageUnitId: string | null;
  trackedEntityId: string | null;
  quantity: number;
  comment?: string | null;
  scrapReasonId?: string | null;
  companyId: string;
  createdBy: string;
}): ItemLedgerInsert {
  return {
    postingDate: args.postingDate,
    entryType: args.entryType,
    documentType: args.documentType ?? null,
    documentId: args.documentId ?? null,
    correctionOfItemLedgerId: args.correctionOfItemLedgerId ?? null,
    itemId: args.itemId,
    locationId: args.locationId,
    storageUnitId: args.storageUnitId,
    trackedEntityId: args.trackedEntityId,
    quantity: round(args.quantity),
    comment: args.comment ?? null,
    scrapReasonId: args.scrapReasonId ?? null,
    companyId: args.companyId,
    createdBy: args.createdBy
  };
}

// One cost-ledger row for a movement. `quantity` and `cost` are SIGNED —
// negative for a decrease (the relief of carrying value), positive for an
// increase. A decrease leaves nothing to consume later, so its layer opens
// with remainingQuantity 0; an increase opens a layer for its full quantity.
export function buildCostLedgerRow(args: {
  entryType: Database["public"]["Enums"]["itemLedgerType"];
  documentType?: ItemLedgerDocumentType | null;
  documentId: string;
  itemId: string;
  quantity: number;
  cost: number;
  postingDate: string;
  // A serial unit's own layer (specific identification); null for FIFO/LIFO.
  trackedEntityId?: string | null;
  companyId: string;
}): CostLedgerInsert {
  const quantity = round(args.quantity);
  return {
    itemLedgerType: args.entryType,
    costLedgerType: "Direct Cost",
    adjustment: false,
    documentType: args.documentType ?? null,
    documentId: args.documentId,
    itemId: args.itemId,
    quantity,
    cost: round(args.cost),
    remainingQuantity: quantity > 0 ? quantity : 0,
    postingDate: args.postingDate,
    trackedEntityId: args.trackedEntityId ?? null,
    companyId: args.companyId
  };
}

// The balanced pair for a movement that carries value: the inventory account
// against the offset (variance / scrap) account. `cost` and `quantity` are
// ABSOLUTE; `isGain` picks which side each account takes.
export function buildAdjustmentJournalLines(args: {
  journalId: string;
  documentId: string;
  documentType?: ItemLedgerDocumentType | null;
  journalLineReference: string;
  isGain: boolean;
  cost: number;
  quantity: number;
  replenishmentSystem:
    | Database["public"]["Enums"]["itemReplenishmentSystem"]
    | null;
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    inventoryAdjustmentVarianceAccount: string;
  };
  offsetAccount?: string | null;
  offsetDescription?: string;
  companyId: string;
}): [JournalLineInsert, JournalLineInsert] {
  const inventoryAccount = resolveInventoryAccount(
    args.replenishmentSystem,
    args.accountDefaults
  );
  const documentType = toJournalLineDocumentType(args.documentType);
  const quantity = round(args.quantity);
  const shared = {
    journalId: args.journalId,
    quantity,
    documentType,
    documentId: args.documentId,
    journalLineReference: args.journalLineReference,
    companyId: args.companyId
  };
  return [
    {
      ...shared,
      accountId: inventoryAccount.account,
      description: inventoryAccount.description,
      amount: round(
        args.isGain ? debit("asset", args.cost) : credit("asset", args.cost)
      )
    },
    {
      ...shared,
      accountId:
        args.offsetAccount ??
        args.accountDefaults.inventoryAdjustmentVarianceAccount,
      description: args.offsetDescription ?? "Inventory Adjustment",
      amount: round(
        args.isGain ? credit("expense", args.cost) : debit("expense", args.cost)
      )
    }
  ];
}

// Dimension tags (post-shipment precedent): every line of the entry gets the
// movement's Item / ItemPostingGroup / Location, for whichever dimensions are
// active on the company group, plus any caller-supplied extras.
export function buildJournalLineDimensions(args: {
  journalLineIds: string[];
  dimensions: Record<string, string>;
  itemId: string;
  itemPostingGroupId?: string | null;
  locationId: string | null;
  extraDimensions?: Array<{ entityType: string; valueId: string }>;
  companyId: string;
}): JournalLineDimensionInsert[] {
  const dimensionValues: Array<[string, string | null | undefined]> = [
    ["Item", args.itemId],
    ["ItemPostingGroup", args.itemPostingGroupId],
    ["Location", args.locationId],
    ...(args.extraDimensions ?? []).map(
      (d) => [d.entityType, d.valueId] as [string, string]
    )
  ];
  return args.journalLineIds.flatMap((journalLineId) =>
    dimensionValues
      .filter(([entityType, valueId]) => args.dimensions[entityType] && valueId)
      .map(([entityType, valueId]) => ({
        journalLineId,
        dimensionId: args.dimensions[entityType]!,
        valueId: valueId as string,
        companyId: args.companyId
      }))
  );
}

export interface PlannedIncrease {
  /** The layer's unit cost, as `computeCurrentUnitCost` would return it. */
  unitCost: number;
  /** quantity × unitCost, unrounded — `buildCostLedgerRow` rounds it. */
  cost: number;
}

// Successive increases for ONE item, in the order they will be written.
//
// Booking them one at a time re-reads the item's open cost layers before every
// row, so row n+1 sees the layer row n just wrote. This replays that read in
// memory from a SINGLE starting snapshot, which is what lets the caller write
// the whole file in a few statements instead of a query per row.
//
// Why the replay and not one hoisted unit cost per item:
//
// - Standard and Average ignore the layers entirely (`computeCurrentUnitCost`
//   returns standardCost / itemCost.unitCost), so every row of an item gets
//   the same unit cost. The replay reproduces that for free.
// - FIFO and LIFO take the remaining-quantity-weighted average of the open
//   layers. Adding a layer of quantity q at exactly that average u contributes
//   value q·u against quantity q, so the average is unchanged: (V + q·u) /
//   (R + q) = (u·R + q·u) / (R + q) = u. In EXACT arithmetic the cost is
//   therefore hoistable. It is not hoistable as written, because the layer is
//   stored as round(q·u, 5) (`buildCostLedgerRow`): row n+1 reads the rounded
//   cost back and divides by q, so the average drifts by up to half a unit of
//   the 5th decimal per row — and the drift is scaled up by the next row's
//   quantity. A 1-unit row at 1/3 stores 0.33333; a following 1000-unit row
//   then books 333.33, not 333.33333. Replaying the rounded layer keeps the
//   batch path byte-identical to the per-row path instead of "close".
// - The fallback branch (no open layers → itemCost.unitCost) is covered by the
//   same replay: the first row opens a layer at that fallback cost, and every
//   later row averages over it.
//
// Rows whose quantity rounds to 0 open no layer the next row can see (the
// open-layer query filters remainingQuantity > 0), so they are skipped here
// exactly as the query would skip them.
export function planIncreaseUnitCosts(
  itemCost: AdjustmentItemCost,
  openLayers: OpenCostLayer[],
  quantities: number[]
): PlannedIncrease[] {
  const layers = [...openLayers];
  return quantities.map((quantity) => {
    const unitCost = computeCurrentUnitCost(itemCost, layers);
    // Build the layer through the same builder the caller will insert with,
    // and read the stored values back off it — the replay must see what the
    // database would have handed the next row, not a second derivation of it.
    // Only quantity / remainingQuantity / cost are read, so the identity
    // fields are placeholders.
    const row = buildCostLedgerRow({
      entryType: "Positive Adjmt.",
      documentType: null,
      documentId: "",
      itemId: "",
      quantity,
      cost: quantity * unitCost,
      postingDate: "",
      companyId: ""
    });
    if ((row.remainingQuantity ?? 0) > 0) {
      // New layers carry no applied adjustment children.
      layers.push({
        quantity: row.quantity as number,
        remainingQuantity: row.remainingQuantity as number,
        cost: row.cost as number,
        appliedChildCost: 0
      });
    }
    return { unitCost, cost: quantity * unitCost };
  });
}

// Whether a movement carries value at all — `bookAdjustment`'s early return:
// a Non-Inventory item or a zero-quantity movement books the ledger row alone,
// with no cost layer and no journal.
export function carriesAdjustmentValue(
  quantity: number,
  itemTrackingType: string | null
): boolean {
  return quantity !== 0 && itemTrackingType !== "Non-Inventory";
}

export interface StockRowPlanInput {
  itemId: string;
  quantity: number;
  itemTrackingType: string | null;
}

export interface StockRowPlan {
  /** false ⇒ ledger row only: no cost layer, no journal line. */
  carriesValue: boolean;
  /** The layer's cost, unrounded; 0 when the row carries no value. */
  cost: number;
  /** Whether this row contributes a journal line pair. */
  postsJournal: boolean;
}

// The whole-file plan the bulk opening-stock importer writes from, one entry
// per source row in source order.
//
// This is the batching itself, kept pure and away from the transaction: group
// the valued rows by item, replay each item's cost layers once
// (`planIncreaseUnitCosts`), scatter the per-item costs back onto the rows
// they came from, and decide which rows post to the GL. `bookAdjustment` makes
// the same three decisions one movement at a time; getting the scatter or the
// journal filter wrong here is what would put a wrong cost on every row, so it
// is a function with a test rather than a loop inside a transaction.
export function planStockRows(args: {
  rows: StockRowPlanInput[];
  itemCosts: ReadonlyMap<string, AdjustmentItemCost>;
  openLayersByItem: ReadonlyMap<string, OpenCostLayer[]>;
}): StockRowPlan[] {
  const plans: StockRowPlan[] = args.rows.map((row) => ({
    carriesValue: carriesAdjustmentValue(row.quantity, row.itemTrackingType),
    cost: 0,
    postsJournal: false
  }));

  const rowIndexesByItem = new Map<string, number[]>();
  args.rows.forEach((row, rowIndex) => {
    if (!plans[rowIndex]!.carriesValue) return;
    const indexes = rowIndexesByItem.get(row.itemId) ?? [];
    indexes.push(rowIndex);
    rowIndexesByItem.set(row.itemId, indexes);
  });

  for (const [itemId, rowIndexes] of rowIndexesByItem) {
    const itemCost = args.itemCosts.get(itemId);
    if (!itemCost) {
      throw new Error(`No item cost for item ${itemId}`);
    }
    const increases = planIncreaseUnitCosts(
      itemCost,
      args.openLayersByItem.get(itemId) ?? [],
      rowIndexes.map((rowIndex) => args.rows[rowIndex]!.quantity)
    );
    rowIndexes.forEach((rowIndex, n) => {
      const cost = increases[n]!.cost;
      plans[rowIndex]!.cost = cost;
      // A zero-value movement posts no journal — `bookAdjustment`'s
      // `!accounting || cost === 0` guard, per row.
      plans[rowIndex]!.postsJournal = cost !== 0;
    });
  }

  return plans;
}
export interface AdjustmentItemCost {
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
  unitCost: number | null;
  standardCost: number | null;
}

export interface OpenCostLayer {
  quantity: number;
  remainingQuantity: number;
  cost: number;
  appliedChildCost: number;
}

// Current carrying unit cost for a POSITIVE adjustment's new layer / journal
// value. Mirrors the valuation RPC's carrying CTE: FIFO/LIFO use the
// weighted-average effective cost of open layers (including applied
// invoice-vs-receipt children); Average/Standard come straight from itemCost.
export function computeCurrentUnitCost(
  itemCost: AdjustmentItemCost,
  openLayers: OpenCostLayer[]
): number {
  switch (itemCost.costingMethod) {
    case "Standard":
      return Number(itemCost.standardCost ?? 0);
    case "Average":
      return Number(itemCost.unitCost ?? 0);
    case "FIFO":
    case "LIFO": {
      let remaining = 0;
      let value = 0;
      for (const layer of openLayers) {
        const quantity = Number(layer.quantity);
        const layerRemaining = Number(layer.remainingQuantity);
        if (quantity <= 0 || layerRemaining <= 0) continue;
        const effectiveUnitCost =
          (Number(layer.cost) + Number(layer.appliedChildCost)) / quantity;
        remaining += layerRemaining;
        value += layerRemaining * effectiveUnitCost;
      }
      if (remaining <= 0) return Number(itemCost.unitCost ?? 0);
      return value / remaining;
    }
    default:
      return Number(itemCost.unitCost ?? 0);
  }
}
export interface BookAdjustmentArgs {
  ledger: {
    postingDate: string; // yyyy-MM-dd
    itemId: string;
    // SIGNED delta: > 0 for Positive Adjmt., < 0 for Negative Adjmt.
    quantity: number;
    locationId: string | null;
    storageUnitId: string | null;
    trackedEntityId: string | null;
    entryType: "Positive Adjmt." | "Negative Adjmt.";
    // itemLedgerDocumentType — manual adjustments stay NULL (ledger rows keep
    // today's shape; 'Inventory Adjustment' exists only on journalLineDocumentType).
    // Non-Conformance / Inbound Inspection tag NCR-disposition & inspection-reject
    // write-offs (these also flow to the journal line's documentType). The full
    // enum is accepted because stock-movement corrections copy the ORIGINAL
    // movement's documentType so document-scoped movement views keep including
    // the fix.
    documentType?: Database["public"]["Enums"]["itemLedgerDocumentType"] | null;
    documentId?: string | null;
    correctionOfItemLedgerId?: string | null;
    comment?: string | null;
    // Reason for scrap/unscrap movements (documentType 'Scrap'); NULL for
    // every other adjustment. MES production scrap keeps its reason on
    // productionQuantity.scrapReasonId.
    scrapReasonId?: string | null;
    companyId: string;
    createdBy: string;
  };
  item: {
    itemTrackingType: string | null;
    replenishmentSystem:
      | Database["public"]["Enums"]["itemReplenishmentSystem"]
      | null;
    itemPostingGroupId?: string | null;
  };
  itemCost: AdjustmentItemCost;
  // null ⇒ no journal: ledger + cost layers only (asset transfers and rental
  // returns value the movement inside a journal of their own)
  accounting: {
    // Provisional before the company's accounting cutover, Posted after it
    // (journalPostingStatus). A Provisional journal has no accounting period.
    postingStatus: AutomaticJournalStatus;
    accountingPeriodId: string | null;
    accountDefaults: {
      rawMaterialsAccount: string;
      finishedGoodsAccount: string;
      inventoryAdjustmentVarianceAccount: string;
    };
    // Offset (non-inventory) side of the balanced pair. Defaults to
    // inventoryAdjustmentVarianceAccount; NCR-disposition / inspection-reject
    // write-offs pass the company's scrapAccount so cost of quality is separable
    // on the P&L.
    offsetAccount?: string | null;
    offsetDescription?: string;
    // journal.sourceType for a header this call creates (default
    // 'Inventory Adjustment'). Ignored when getJournalId supplies a shared journal.
    sourceType?: Database["public"]["Enums"]["journalEntrySourceType"];
    description: string;
    userId: string;
    // active dimensions for the company group, entityType → dimension id
    // (Item / ItemPostingGroup / Location are consulted) — journal lines get
    // journalLineDimension tags for whichever are configured
    dimensions?: Record<string, string>;
    // Additional journalLineDimension tags beyond Item/ItemPostingGroup/
    // Location (ScrapReason / WorkCenter / Employee for scrap postings).
    // entityType must be a dimensionEntityType value present in `dimensions`;
    // valueId is the referenced entity id (polymorphic, no FK).
    extraDimensions?: Array<{ entityType: string; valueId: string }>;
    // When set, lines append to this shared journal instead of the core
    // creating one journal per movement — inventory counts post ONE journal
    // per count with a line pair per variance. Lazy (called only when a
    // movement writes a pair: one with value, or any outbound one) so a run
    // of zero-cost increases never creates an empty journal.
    getJournalId?: () => Promise<string>;
  } | null;
  // storage-unit-transfer legs move stock between bins without changing its
  // value: ledger row only — no cost layers, no journal
  skipValuation?: boolean;
  // Book an INCREASE's new cost layer at this unit cost instead of
  // computeCurrentUnitCost — Unscrap reverses at the original scrapped cost
  // (Oracle Return-from-Scrap precedent). Ignored for decreases, which always
  // relieve via calculateCOGS.
  fixedUnitCost?: number;
}

export interface BookAdjustmentResult {
  itemLedgerId: string;
  journalId: string | null;
  cost: number;
}

export interface CreateAdjustmentJournalArgs {
  companyId: string;
  // null for a Provisional journal: it has no accounting period
  accountingPeriodId: string | null;
  status: AutomaticJournalStatus;
  description: string;
  postingDate: string;
  userId: string;
  sourceType?: Database["public"]["Enums"]["journalEntrySourceType"];
}

// One journal header for adjustment postings ('Inventory Adjustment' source,
// Provisional before the accounting cutover, Posted after it). Manual adjustments create one per movement; inventory
// counts share ONE journal per count post via accounting.getJournalId.
export async function createAdjustmentJournal(
  trx: Transaction<DB>,
  args: CreateAdjustmentJournalArgs
): Promise<string> {
  const journalEntryId = await getNextSequence(
    trx,
    "journalEntry",
    args.companyId
  );
  const journal = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId: args.accountingPeriodId,
      description: args.description,
      postingDate: args.postingDate,
      companyId: args.companyId,
      sourceType: args.sourceType ?? "Inventory Adjustment",
      status: args.status,
      postedAt: datetime.timestamp(),
      postedBy: args.userId,
      createdBy: args.userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return journal.id;
}

// The open cost layers an INCREASE values itself against, per item. Same
// filters as calculateCOGS so both sides of the math agree: positive
// remaining quantity, not an adjustment child, and not a 'Purchase Order'
// planning artifact. Applied adjustment children (invoice-vs-receipt price
// corrections) are folded into each layer's `appliedChildCost`.
//
// Takes a LIST of items so the bulk importer reads every item it is about to
// post in a couple of queries instead of two per row. `bookAdjustment` passes
// one.
const CHILD_LAYER_CHUNK_SIZE = 500;

export async function loadOpenCostLayers(
  trx: Transaction<DB>,
  args: { itemIds: string[]; companyId: string }
): Promise<Map<string, OpenCostLayer[]>> {
  const byItem = new Map<string, OpenCostLayer[]>();
  if (args.itemIds.length === 0) return byItem;

  const openLayers = await trx
    .selectFrom("costLedger")
    .select(["id", "itemId", "quantity", "remainingQuantity", "cost"])
    .where("itemId", "in", args.itemIds)
    .where("companyId", "=", args.companyId)
    .where("remainingQuantity", ">", 0)
    .where("adjustment", "=", false)
    .where("appliesToCostLedgerId", "is", null)
    .where((eb) =>
      eb.or([
        eb("documentType", "is", null),
        eb("documentType", "!=", "Purchase Order")
      ])
    )
    .execute();
  if (openLayers.length === 0) return byItem;

  // The child lookup is chunked over the LAYER ids, not the item ids: open
  // layers are receipts not yet consumed, so their count is data-dependent and
  // unbounded. The bulk importer reaches here with every referenced item's
  // layers at once, and a single `in (...)` over them would exceed Postgres'
  // 65535 bind parameters on a large file against well-stocked items.
  const appliedChildCostByLayer = new Map<string, number>();
  const layerIds = openLayers.map((layer) => layer.id);
  for (let i = 0; i < layerIds.length; i += CHILD_LAYER_CHUNK_SIZE) {
    const children = await trx
      .selectFrom("costLedger")
      .select(["appliesToCostLedgerId", "cost"])
      .where(
        "appliesToCostLedgerId",
        "in",
        layerIds.slice(i, i + CHILD_LAYER_CHUNK_SIZE)
      )
      .where("companyId", "=", args.companyId)
      .execute();
    for (const child of children) {
      const key = child.appliesToCostLedgerId as string;
      appliedChildCostByLayer.set(
        key,
        (appliedChildCostByLayer.get(key) ?? 0) + Number(child.cost)
      );
    }
  }

  for (const layer of openLayers) {
    const itemId = layer.itemId as string;
    const list = byItem.get(itemId) ?? [];
    list.push({
      quantity: Number(layer.quantity),
      remainingQuantity: Number(layer.remainingQuantity),
      cost: Number(layer.cost),
      appliedChildCost: appliedChildCostByLayer.get(layer.id) ?? 0
    });
    byItem.set(itemId, list);
  }
  return byItem;
}

// Book one adjustment movement inside the caller's transaction: the item
// ledger row, then its valuation (`valueMovement`). Tracked-entity mutations
// are the caller's responsibility.
export async function bookAdjustment(
  trx: Transaction<DB>,
  args: BookAdjustmentArgs
): Promise<BookAdjustmentResult> {
  const { ledger, item, itemCost, accounting, skipValuation } = args;

  const inserted = await trx
    .insertInto("itemLedger")
    .values(
      buildItemLedgerRow({
        postingDate: ledger.postingDate,
        entryType: ledger.entryType,
        documentType: ledger.documentType,
        documentId: ledger.documentId,
        correctionOfItemLedgerId: ledger.correctionOfItemLedgerId,
        itemId: ledger.itemId,
        locationId: ledger.locationId,
        storageUnitId: ledger.storageUnitId,
        trackedEntityId: ledger.trackedEntityId,
        quantity: ledger.quantity,
        comment: ledger.comment,
        scrapReasonId: ledger.scrapReasonId,
        companyId: ledger.companyId,
        createdBy: ledger.createdBy
      })
    )
    .returning(["id"])
    .executeTakeFirstOrThrow();

  if (skipValuation) {
    return { itemLedgerId: inserted.id, journalId: null, cost: 0 };
  }

  const { journalId, cost } = await valueMovement(trx, {
    movement: {
      postingDate: ledger.postingDate,
      itemId: ledger.itemId,
      quantity: ledger.quantity,
      locationId: ledger.locationId,
      entryType: ledger.entryType,
      documentType: ledger.documentType,
      documentId: ledger.documentId ?? inserted.id,
      trackedEntityId: ledger.trackedEntityId,
      companyId: ledger.companyId
    },
    item,
    itemCost,
    accounting,
    fixedUnitCost: args.fixedUnitCost
  });

  return { itemLedgerId: inserted.id, journalId, cost };
}

export interface ValueMovementArgs {
  movement: {
    postingDate: string; // yyyy-MM-dd
    itemId: string;
    // SIGNED: < 0 relieves cost layers, > 0 opens one
    quantity: number;
    locationId: string | null;
    entryType: Database["public"]["Enums"]["itemLedgerType"];
    documentType?: Database["public"]["Enums"]["itemLedgerDocumentType"] | null;
    // costLedger.documentId and journalLine.documentId
    documentId: string;
    // The moved unit or batch; only a serial unit's is used for costing.
    trackedEntityId?: string | null;
    companyId: string;
  };
  item: BookAdjustmentArgs["item"];
  itemCost: AdjustmentItemCost;
  accounting: BookAdjustmentArgs["accounting"];
  fixedUnitCost?: number;
}

// Value a stock movement whose item ledger row the caller has already written:
// cost-layer maintenance (consume via calculateCOGS on decreases, open a layer
// at current cost — or `fixedUnitCost` — on increases) and, when the caller
// passes `accounting`, a balanced journal of the inventory account against
// the offset account: for every decrease, and for an increase with value. `bookAdjustment` is this plus the ledger
// row; maintenance consumption calls it directly because its ledger rows are
// written alongside tracked-entity splits.
export async function valueMovement(
  trx: Transaction<DB>,
  args: ValueMovementArgs
): Promise<{ journalId: string | null; cost: number }> {
  const { movement, item, itemCost, accounting } = args;
  const { companyId, documentId } = movement;

  if (!carriesAdjustmentValue(movement.quantity, item.itemTrackingType)) {
    return { journalId: null, cost: 0 };
  }

  const absQuantity = Math.abs(movement.quantity);
  // A serial unit's movement is costed by specific identification: an
  // increase books a layer that belongs to the unit, and a decrease relieves
  // that layer first (calculateCOGS / cost-layer-order.ts). A batch entity is
  // split and re-pointed as it moves, so its layers stay FIFO / LIFO.
  const serialId =
    item.itemTrackingType === "Serial"
      ? (movement.trackedEntityId ?? null)
      : null;
  let cost = 0;

  if (movement.quantity < 0) {
    // Decrease: relieve carrying value exactly as shipments do — consume
    // layers (FIFO/LIFO) / current cost (Average/Standard).
    const cogs = await calculateCOGS(trx, {
      itemId: movement.itemId,
      quantity: absQuantity,
      companyId,
      trackedEntityIds: serialId ? [serialId] : []
    });
    cost = cogs.totalCost;

    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          entryType: movement.entryType,
          documentType: movement.documentType,
          documentId,
          itemId: movement.itemId,
          quantity: -absQuantity,
          cost: -cogs.totalCost,
          postingDate: movement.postingDate,
          trackedEntityId: serialId,
          companyId
        })
      )
      .execute();
  } else if (args.fixedUnitCost != null) {
    // Increase at a caller-fixed unit cost: Unscrap restores stock at the
    // ORIGINAL scrapped cost so a scrap→unscrap round trip nets zero P&L.
    cost = absQuantity * args.fixedUnitCost;

    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          entryType: movement.entryType,
          documentType: movement.documentType,
          documentId,
          itemId: movement.itemId,
          quantity: absQuantity,
          cost,
          postingDate: movement.postingDate,
          trackedEntityId: serialId,
          companyId
        })
      )
      .execute();
  } else {
    // Increase: create a layer at the item's current carrying cost.
    const openLayers = await loadOpenCostLayers(trx, {
      itemIds: [movement.itemId],
      companyId
    });
    const unitCost = computeCurrentUnitCost(
      itemCost,
      openLayers.get(movement.itemId) ?? []
    );
    cost = absQuantity * unitCost;

    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          entryType: movement.entryType,
          documentType: movement.documentType,
          documentId,
          itemId: movement.itemId,
          quantity: absQuantity,
          cost,
          postingDate: movement.postingDate,
          trackedEntityId: serialId,
          companyId
        })
      )
      .execute();
  }

  // An inbound movement at no value posts no journal (nothing to tie out).
  // An outbound one always writes its pair, at zero too: every outbound cost
  // row carries a pair, because the accounting enable's re-cost may give it
  // a cost and adjusts the pair it finds. With no pair, and another journal
  // of the document that day, neither the legacy backfill (which skips a
  // document-day that has a journal) nor the re-cost could book the cost.
  if (!accounting || (cost === 0 && movement.quantity > 0)) {
    return { journalId: null, cost };
  }

  const journalId = accounting.getJournalId
    ? await accounting.getJournalId()
    : await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId: accounting.accountingPeriodId,
        status: accounting.postingStatus,
        description: accounting.description,
        postingDate: movement.postingDate,
        userId: accounting.userId,
        sourceType: accounting.sourceType
      });

  const [inventoryLine, offsetLine] = buildAdjustmentJournalLines({
    journalId,
    documentId,
    documentType: movement.documentType,
    journalLineReference: nanoid(),
    isGain: movement.quantity > 0,
    cost,
    quantity: absQuantity,
    replenishmentSystem: item.replenishmentSystem,
    accountDefaults: accounting.accountDefaults,
    offsetAccount: accounting.offsetAccount,
    offsetDescription: accounting.offsetDescription,
    companyId
  });
  const journalLines = await trx
    .insertInto("journalLine")
    .values([inventoryLine, offsetLine])
    .returning(["id"])
    .execute();

  const journalLineDimensionInserts = buildJournalLineDimensions({
    journalLineIds: journalLines.map((line) => line.id),
    dimensions: accounting.dimensions ?? {},
    itemId: movement.itemId,
    itemPostingGroupId: item.itemPostingGroupId,
    locationId: movement.locationId,
    extraDimensions: accounting.extraDimensions,
    companyId
  });
  if (journalLineDimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(journalLineDimensionInserts)
      .execute();
  }

  return { journalId, cost };
}
type PostableTable =
  | "receipt"
  | "shipment"
  | "purchaseInvoice"
  | "salesInvoice";

/** Call BEFORE the posting function's `try`: its failure handler resets the
 *  document to Draft, which must not happen to one that is already posted. */
export async function assertPostable(
  db: Kysely<KyselyDatabase>,
  table: PostableTable,
  id: string,
  companyId: string
): Promise<void> {
  const document = await db
    .selectFrom(table)
    .select(["status"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (document && !["Draft", "Pending"].includes(document.status ?? "")) {
    throw new ServerFnError(
      `Cannot post: it is already ${document.status}`,
      409
    );
  }
}
// Manual accounting work (recognition runs here) runs only after the
// company's accounting cutover: before it, journals are Provisional and count
// nowhere (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 1). The ERP
// service functions refuse the same work with the same message.
export const ACCOUNTING_NOT_STARTED =
  "Set up accounting before you post journals, runs or period closes.";

export async function assertAccountingCutover(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string
) {
  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new InvalidInputError(ACCOUNTING_NOT_STARTED);
  }
}
type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/**
 * The optional defaults a sales invoice line may stand in for, with the class
 * each one must have. A stand-in line is signed for that class, so the enable
 * can re-point it without changing its amount.
 */
export const STAND_IN_CLASS = {
  leaseRevenueAccount: "Revenue",
  netInvestmentInLeasesAccount: "Asset",
  salesShippingRevenueAccount: "Revenue"
} as const satisfies Partial<Record<OptionalDefaultRole, string>>;

export type StandInRole = keyof typeof STAND_IN_CLASS;

/** The prefix of a placeholder id. Never an account id: those come from id('…'). */
export const STAND_IN_PREFIX = "stand-in:";

/** The stand-in bookkeeping of one sales invoice posting. */
export function salesInvoiceStandIns(
  defaults: Pick<AccountDefaults, StandInRole | "retainedEarningsAccount">,
  postingStatus: AutomaticJournalStatus
) {
  const roles = new Map<string, StandInRole>();

  /** The account a line takes for `role`: the default when it is set; a
   *  placeholder before the cutover; null after it. */
  const defaultId = (role: StandInRole): string | null => {
    if (defaults[role]) return defaults[role];
    if (postingStatus === "Posted") return null;
    const resolved = resolveDefaultAccount(defaults, role, postingStatus);
    if (!resolved.accountDefaultRole) return resolved.accountId;
    const placeholder = `${STAND_IN_PREFIX}${role}`;
    roles.set(placeholder, role);
    return placeholder;
  };

  const isPlaceholder = (id: string) => roles.has(id);

  /** The account id a row stores: Retained Earnings for a placeholder. */
  const storedAccountId = (id: string) =>
    roles.has(id) ? defaults.retainedEarningsAccount : id;

  /** A journal line as stored: a placeholder becomes Retained Earnings and
   *  the line names the default it stands in for. */
  const storedLine = <T extends { accountId?: string | null }>(line: T) =>
    line.accountId && roles.has(line.accountId)
      ? {
          ...line,
          accountId: defaults.retainedEarningsAccount,
          accountDefaultRole: roles.get(line.accountId)!
        }
      : line;

  /** One account per placeholder, of the class its default must have. */
  const placeholderAccounts = (companyGroupId: string): SalesPostingAccount[] =>
    [...roles].map(([placeholder, role]) => ({
      id: placeholder,
      class: STAND_IN_CLASS[role],
      active: true,
      isGroup: false,
      companyGroupId
    }));

  return {
    defaultId,
    isPlaceholder,
    storedAccountId,
    storedLine,
    placeholderAccounts
  };
}
// What ONE serial unit would leave stock at right now, without consuming
// anything: the same arithmetic calculateCOGS runs for a quantity of one —
// Standard at the standard cost, Average at the unit cost, FIFO / LIFO from
// the unit's own layer first (cost-layer-order.ts), then the unstamped layers,
// each with its price-correction children, falling back to the item's unit
// cost when no layer is left. Pure, so a whole item's units are valued from
// one read of its layers.

export type UnitCostLayer = {
  id: string;
  trackedEntityId: string | null;
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

export type UnitCostChild = {
  quantity: number;
  cost: number;
  remainingQuantity: number;
};

export type UnitCostBasis = {
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
  unitCost: number | null;
  standardCost: number | null;
};

export function serialUnitCost(args: {
  itemCost: UnitCostBasis;
  // Open layers already in FIFO / LIFO order, as calculateCOGS reads them.
  layers: UnitCostLayer[];
  // Open price-correction children per layer id, oldest first.
  childrenByLayer: ReadonlyMap<string, UnitCostChild[]>;
  trackedEntityId: string;
}): number {
  const { itemCost } = args;
  switch (itemCost.costingMethod) {
    case "Standard":
      return Number(itemCost.standardCost ?? 0);
    case "Average":
      return Number(itemCost.unitCost ?? 0);
    case "FIFO":
    case "LIFO": {
      let remaining = 1;
      let total = 0;
      const ordered = orderLayersForConsumption(args.layers, [
        args.trackedEntityId
      ]);
      for (const layer of ordered) {
        if (remaining <= 0) break;
        const layerRemaining = Number(layer.remainingQuantity);
        if (layerRemaining <= 0) continue;
        const layerUnitCost =
          Number(layer.quantity) > 0
            ? Number(layer.cost) / Number(layer.quantity)
            : 0;
        const taken = Math.min(remaining, layerRemaining);
        total += taken * layerUnitCost;
        remaining -= taken;

        let unapplied = taken;
        for (const child of args.childrenByLayer.get(layer.id) ?? []) {
          if (unapplied <= 0) break;
          const childRemaining = Number(child.remainingQuantity);
          const perUnitBump =
            Number(child.quantity) > 0
              ? Number(child.cost) / Number(child.quantity)
              : 0;
          const applied = Math.min(childRemaining, unapplied);
          total += applied * perUnitBump;
          unapplied -= applied;
        }
      }
      if (remaining > 0) total += remaining * Number(itemCost.unitCost ?? 0);
      return total;
    }
    default:
      throw new Error(`Unsupported costing method: ${itemCost.costingMethod}`);
  }
}
export async function getStorageUnitId(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string,
  storageUnitId?: string,
  /** False under strict backflush: the fullest bin is a guess, not a choice. */
  allowFullestBin = true
): Promise<string | undefined> {
  if (storageUnitId) return storageUnitId;

  const pickMethod = await trx
    .selectFrom("pickMethod")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .select("defaultStorageUnitId")
    .executeTakeFirst();

  if (pickMethod?.defaultStorageUnitId) return pickMethod.defaultStorageUnitId;
  if (!allowFullestBin) return undefined;

  const storageUnitWithHighestQuantity =
    await getStorageUnitWithHighestQuantity(trx, itemId, locationId);

  return storageUnitWithHighestQuantity ?? undefined;
}

/**
 * Where each tracked entity holds stock, and how much, per location (see
 * `resolveTrackedEntityBins`: `null` is the unassigned bin). The lookup returns
 * `undefined` for an entity with no positive bin at that location.
 */
export async function getTrackedEntityBins(
  db: Kysely<DB>,
  args: { trackedEntityIds: string[]; locationIds: string[]; companyId: string }
): Promise<
  (trackedEntityId: string, locationId: string) => TrackedEntityBin | undefined
> {
  if (args.trackedEntityIds.length === 0 || args.locationIds.length === 0) {
    return () => undefined;
  }

  const rows = await db
    .selectFrom("itemLedger")
    .where("trackedEntityId", "in", args.trackedEntityIds)
    .where("locationId", "in", args.locationIds)
    .where("companyId", "=", args.companyId)
    .select(["trackedEntityId", "locationId", "storageUnitId", "quantity"])
    .execute();

  const binsByLocation = new Map<string, Map<string, TrackedEntityBin>>();
  for (const locationId of args.locationIds) {
    binsByLocation.set(
      locationId,
      resolveTrackedEntityBins(rows.filter((r) => r.locationId === locationId))
    );
  }
  return (trackedEntityId, locationId) =>
    binsByLocation.get(locationId)?.get(trackedEntityId);
}

/** A tracked entity's on-hand in one bin; `null` is the unassigned bin. */
export async function getTrackedEntityOnHandInBin(
  trx: Transaction<DB>,
  args: {
    trackedEntityId: string;
    locationId: string;
    storageUnitId: string | null;
    companyId: string;
  }
): Promise<number> {
  const row = await trx
    .selectFrom("itemLedger")
    .where("trackedEntityId", "=", args.trackedEntityId)
    .where("locationId", "=", args.locationId)
    .where("storageUnitId", "is not distinct from", args.storageUnitId)
    .where("companyId", "=", args.companyId)
    .select((eb) => eb.fn.sum<number>("quantity").as("onHand"))
    .executeTakeFirst();
  return Number(row?.onHand ?? 0);
}

// Utility function to get the storage unit with the highest quantity
export async function getStorageUnitWithHighestQuantity(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string
): Promise<string | null> {
  const storageUnitWithHighestQuantity = await trx
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("storageUnitId", "is not", null)
    .groupBy("storageUnitId")
    .select([
      "storageUnitId",
      (eb) => eb.fn.sum("quantity").as("totalQuantity")
    ])
    .having((eb) => eb.fn.sum("quantity"), ">", 0)
    .orderBy("totalQuantity", "desc")
    .executeTakeFirst();

  return storageUnitWithHighestQuantity?.storageUnitId ?? null;
}

// Utility function to update pickMethod defaultStorageUnitId if this is the only non-null storage unit
export async function updatePickMethodDefaultStorageUnitIfNeeded(
  trx: Transaction<DB>,
  itemId: string,
  locationId: string | null | undefined,
  storageUnitId: string | null | undefined,
  companyId: string,
  userId: string
): Promise<void> {
  // Only proceed if storageUnitId and locationId are not null
  if (!storageUnitId || !locationId) return;

  // Check if there are other non-null storage units for this item/location
  const otherStorageUnits = await trx
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("locationId", "=", locationId)
    .where("storageUnitId", "is not", null)
    .where("storageUnitId", "!=", storageUnitId)
    .select("storageUnitId")
    .executeTakeFirst();

  // If there are no other non-null storage units, update or insert pickMethod
  if (!otherStorageUnits) {
    const existingPickMethod = await trx
      .selectFrom("pickMethod")
      .where("itemId", "=", itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .select("defaultStorageUnitId")
      .executeTakeFirst();

    if (existingPickMethod) {
      // Update existing pickMethod
      await trx
        .updateTable("pickMethod")
        .set({
          defaultStorageUnitId: storageUnitId,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("itemId", "=", itemId)
        .where("locationId", "=", locationId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      // Insert new pickMethod
      await trx
        .insertInto("pickMethod")
        .values({
          itemId,
          locationId,
          defaultStorageUnitId: storageUnitId,
          companyId,
          createdBy: userId,
          createdAt: datetime.timestamp()
        })
        .execute();
    }
  }
}
export type SupplierPartPriceConverter = {
  /** The currency a supplier part's price is in (NULL = base). */
  currencyOf: (partCurrencyCode: string | null) => string;
  /** A price per purchase unit in the DOCUMENT's currency, in the part's. */
  toPartCurrency: (price: number, partCurrencyCode: string | null) => number;
};

/**
 * Converts prices learned from a purchase document (a supplier quote, order or
 * invoice) into the currency of the supplier part that records them. A part
 * keeps the currency it was set up in; a price in that same currency is copied
 * exactly, any other crosses through base at the document's own rate and the
 * part currency's CURRENT rate. A missing rate raises (`get_exchange_rate`)
 * rather than recording the price at par.
 *
 * A NULL document or part currency is the company base currency. Rates are
 * loaded once, for every part currency the caller will convert into.
 */
export async function getSupplierPartPriceConverter(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  document: { currencyCode: string | null; exchangeRate: number },
  partCurrencyCodes: (string | null)[]
): Promise<SupplierPartPriceConverter> {
  const company = await db
    .selectFrom("company")
    .select("baseCurrencyCode")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const baseCurrencyCode = company.baseCurrencyCode;

  const currencyOf = (code: string | null) =>
    supplierPartCurrency(code, baseCurrencyCode);
  const from: CurrencyRate = {
    currencyCode: currencyOf(document.currencyCode),
    exchangeRate: document.exchangeRate
  };

  const codes = [
    ...new Set(
      partCurrencyCodes
        .map(currencyOf)
        .filter((code) => code !== from.currencyCode)
    )
  ];

  const rates = new Map<string, number>();
  if (codes.length > 0) {
    const { rows } = await sql<{ code: string; rate: number }>`
      SELECT code, get_exchange_rate(${companyId}, code) AS rate
      FROM unnest(${codes}::text[]) AS code
    `.execute(db);
    for (const row of rows) rates.set(row.code, Number(row.rate));
  }

  return {
    currencyOf,
    toPartCurrency: (price, partCurrencyCode) => {
      const currencyCode = currencyOf(partCurrencyCode);
      return convertUnitPrice(price, from, {
        currencyCode,
        exchangeRate:
          currencyCode === from.currencyCode
            ? from.exchangeRate
            : rates.get(currencyCode)!
      });
    }
  };
}
type JournalLine = Selectable<KyselyDatabase["journalLine"]>;

/**
 * Voids a journal with a negated copy: a new journal dated `date` (in the
 * period `periodMode` resolves for it once the company has a cutover; a
 * Provisional journal has none), each original line negated with its
 * documents, account default role and dimensions. The caller checks the
 * original's provenance and passes its lines. Returns the copy's id.
 *
 * Used by the charge, reimbursement and lease voids.
 */
export async function insertNegatedJournal(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    originalLines: JournalLine[];
    description: string;
    sourceType: Database["public"]["Enums"]["journalEntrySourceType"];
    postingStatus: AutomaticJournalStatus;
    date: string;
    periodMode: "current" | "historical-with-shift";
    postedAt: string;
  }
): Promise<string> {
  const { companyId, userId, originalLines } = args;
  const period =
    args.postingStatus === "Posted"
      ? await resolveAccountingPeriod(
          trx,
          companyId,
          args.date,
          args.periodMode
        )
      : null;
  const reversal = await trx
    .insertInto("journal")
    .values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period?.id ?? null,
      description: args.description,
      postingDate: period?.postingDate ?? args.date,
      companyId,
      sourceType: args.sourceType,
      status: args.postingStatus,
      postedAt: args.postedAt,
      postedBy: userId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (originalLines.length === 0) return reversal.id;

  const reversalLineIds = await allocateJournalLineIds(
    trx,
    originalLines.length
  );
  await trx
    .insertInto("journalLine")
    .values(
      originalLines.map((line, index) => ({
        id: reversalLineIds[index],
        journalId: reversal.id,
        accountId: line.accountId,
        amount: -Number(line.amount),
        quantity: line.quantity,
        description: `VOID: ${line.description ?? ""}`,
        documentType: line.documentType,
        documentId: line.documentId,
        documentLineReference: line.documentLineReference,
        journalLineReference: line.journalLineReference,
        accountDefaultRole: line.accountDefaultRole,
        companyId
      }))
    )
    .execute();

  const dimensions = await trx
    .selectFrom("journalLineDimension")
    .select(["journalLineId", "dimensionId", "valueId"])
    .where("companyId", "=", companyId)
    .where(
      "journalLineId",
      "in",
      originalLines.map((line) => line.id)
    )
    .execute();
  if (dimensions.length > 0) {
    const reversalByOriginal = new Map(
      originalLines.map((line, index) => [line.id, reversalLineIds[index]])
    );
    await trx
      .insertInto("journalLineDimension")
      .values(
        dimensions.map((dimension) => {
          const journalLineId = reversalByOriginal.get(dimension.journalLineId);
          if (!journalLineId) {
            throw new Error("Failed to map a reversed journal line");
          }
          return { ...dimension, journalLineId, companyId };
        })
      )
      .execute();
  }
  return reversal.id;
}
// Record ids in an input come straight from the caller and prove nothing about
// tenancy: a permission check authorizes the CALLER for companyId, not the ids it
// sends. Several of these ids are only ever written as references into the
// caller's own rows (a ledger's locationId, an activity's trackedEntityId), and
// their single-column FKs accept a row from any company, so nothing downstream
// refuses a foreign id. Re-read them under companyId before writing.

type CompanyRecordTable =
  | "inspection"
  | "inspectionSample"
  | "jobOperationStep"
  | "location"
  | "nonConformance"
  | "productionEvent"
  | "purchaseOrder"
  | "scrapReason"
  | "storageUnit"
  | "trackedEntity"
  | "workCenter";

/**
 * Throws `NotFoundError` unless every provided id is a row of `table` in
 * `companyId`. Null / undefined / duplicate ids are ignored, so optional input
 * fields stay optional. One query per call — collect the ids first.
 */
export async function assertCompanyRecords(
  db: Kysely<KyselyDatabase>,
  table: CompanyRecordTable,
  ids: Iterable<string | null | undefined>,
  companyId: string,
  label: string
): Promise<void> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => typeof id === "string"))
  ];
  if (unique.length === 0) return;

  const rows = await db
    .selectFrom(table)
    .select("id")
    .where("id", "in", unique)
    .where("companyId", "=", companyId)
    .execute();

  if (rows.length !== unique.length) {
    throw new NotFoundError(`${label} not found`);
  }
}
export type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

/** An operator's request to consume or move expired material anyway. */
export type ExpiryOverride = { allowed: boolean; reason: string | null };

/**
 * The company's expired-entity policy (`companySettings.inventoryShelfLife`).
 * `Block` when unset, so the safe behavior is the default.
 */
export async function getExpiredEntityPolicy(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<ExpiredEntityPolicy> {
  const row = await db
    .selectFrom("companySettings")
    .select("inventoryShelfLife")
    .where("id", "=", companyId)
    .executeTakeFirst();
  const settings = row?.inventoryShelfLife as {
    expiredEntityPolicy?: ExpiredEntityPolicy;
  } | null;
  return settings?.expiredEntityPolicy ?? "Block";
}

/** The entities that expired before `today`; an unparseable date never counts. */
export function expiredEntities<E extends { expirationDate: string | null }>(
  entities: E[],
  today: CalendarDate
): E[] {
  return entities.filter(({ expirationDate }) => {
    if (!expirationDate) return false;
    try {
      return parseDate(expirationDate).compare(today) < 0;
    } catch {
      return false;
    }
  });
}

/**
 * What the policy does with expired material: `warn` under `Warn`, `allow`
 * under `BlockWithOverride` when the override carries a reason, else `block`.
 */
export function expiryVerdict(
  policy: ExpiredEntityPolicy,
  override: ExpiryOverride
): "warn" | "allow" | "block" {
  if (policy === "Warn") return "warn";
  if (
    policy === "BlockWithOverride" &&
    override.allowed &&
    (override.reason?.trim().length ?? 0) > 0
  ) {
    return "allow";
  }
  return "block";
}
/**
 * `"attributes" @> {…}`: the containment form the `trackedEntity` GIN index
 * serves. `attributes->>'Key' = value` reads the same rows but cannot use the
 * index, so it walks every tracked entity of the company.
 */
export function attributesContain(values: Record<string, string>) {
  return sql<boolean>`"attributes" @> ${JSON.stringify(values)}::jsonb`;
}
/**
 * Who stands behind a posting's client: the service role (the system), an API
 * key (checked against its scopes) or the signed-in user (checked against the
 * user's claims). Never derive it from input.
 */
export type PostingCaller =
  | { type: "system" }
  | { type: "apiKey"; apiKey: string }
  | { type: "user" };

/**
 * The client's key decides the caller. A user's token must be `userId`'s,
 * since the permissions are read for that user. Never replace this with a flag
 * the caller passes: /api/v1 fills unknown parameters from the body.
 */
export function postingCaller(
  client: SupabaseClient<Database>,
  userId: string
): PostingCaller {
  const { supabaseKey, headers = {} } = client as unknown as {
    supabaseKey?: string;
    headers?: Record<string, string>;
  };
  const apiKey = headers["carbon-key"];
  if (apiKey) return { type: "apiKey", apiKey };
  if (SUPABASE_SERVICE_ROLE_KEY && supabaseKey === SUPABASE_SERVICE_ROLE_KEY) {
    return { type: "system" };
  }
  if (bearerSubject(headers.Authorization) !== userId) {
    throw new ForbiddenError("userId does not match the signed-in user");
  }
  return { type: "user" };
}

/** The `sub` of a `Bearer` JWT, unverified. The token comes from this
 *  process's own session, or from an MES internal call that forwards it under
 *  its signature (caller mode). Either way the authority is the `userId` that
 *  session or signature vouches for: this only checks that the token names the
 *  same user. */
function bearerSubject(authorization: string | undefined): string | undefined {
  const payload = authorization?.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
  } catch {
    return undefined;
  }
}

/** Refuses a caller who does not hold `required` in the company. */
export async function authorizePostingCaller(
  {
    db,
    companyId,
    userId
  }: Pick<PostingHandles, "db" | "companyId" | "userId">,
  caller: PostingCaller,
  required: Permissions
): Promise<void> {
  if (caller.type === "system") return;
  if (required === "system") {
    throw new ForbiddenError("Only server-side callers may run this");
  }
  if (caller.type === "apiKey") {
    return authorizeApiKey(db, companyId, caller.apiKey, required);
  }
  const { rows } = await sql<{
    claims: Record<string, unknown> | null;
  }>`SELECT get_claims(${userId}, ${companyId}) AS claims`.execute(db);
  const claims = rows[0]?.claims ?? {};
  // A portal account holds a few view permissions, so the list alone would admit it.
  if (claims.role === "customer" || claims.role === "supplier") {
    throw new ForbiddenError();
  }
  if (!hasPermissions(permissionsFromClaims(claims), companyId, required)) {
    throw new ForbiddenError();
  }
}

/** A key of this company, unexpired, whose scopes (`<module>_<action>` →
 *  company ids, shaped like claims) cover `required`. Rate limiting stays with
 *  the route that authenticated the key. */
async function authorizeApiKey(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  apiKey: string,
  required: RequiredPermissions
): Promise<void> {
  const key = await db
    .selectFrom("apiKey")
    .select("scopes")
    .where(
      "keyHash",
      "=",
      sql<string>`encode(sha256(convert_to(${apiKey}, 'UTF8')), 'hex')`
    )
    .where("companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb("expiresAt", "is", null),
        eb("expiresAt", ">", sql<string>`now()`)
      ])
    )
    .executeTakeFirst();
  if (!key) throw new ForbiddenError("Invalid API key");
  if (Object.keys(required).length === 0) return;
  const scopes = permissionsFromClaims(
    (key.scopes ?? {}) as Record<string, unknown>
  );
  if (!hasPermissions(scopes, companyId, required)) {
    throw new ForbiddenError("API key lacks required permissions");
  }
}
