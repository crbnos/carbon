// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { NotFoundError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import type {
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import {
  CONTROLLED_ENVIRONMENT,
  SUPABASE_INTERNAL_URL,
  SUPABASE_URL,
  VERCEL_URL
} from "@carbon/auth";
import { bustApiKeyCache } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { ACCOUNT_DEFAULT_COLUMNS } from "@carbon/database/account-import";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { single, updateRows } from "@carbon/database/rows";
import {
  accountDefaults,
  accounts,
  changeOrderRequiredActions,
  changeOrderTypes,
  currencies,
  customerStatuses,
  dimensions,
  failureModes,
  fiscalYearSettings,
  fixedAssetClasses,
  gaugeTypes,
  getGroupId,
  groups,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  periodCloseTaskDefinitions,
  returnReasons,
  scrapReasons,
  sequences,
  unitOfMeasures
} from "@carbon/database/seed-data";
import type {
  DocumentBlock,
  DocumentSectionPlacement,
  DocumentSettings,
  DocumentTemplate,
  DocumentTemplateType,
  DocumentTheme,
  ResolvedSection
} from "@carbon/documents/template";
import {
  CURRENT_TEMPLATE_FORMAT_VERSION,
  getBuiltInSection,
  isBuiltInSectionId,
  toDocumentTemplate
} from "@carbon/documents/template";
import { withRevisionSuffix } from "@carbon/documents/utils";
import {
  getIntegrationConfigById,
  getIntegrationIdsByRole,
  type IntegrationHealthcheckResult,
  type IntegrationID,
  resolveIntegrationSecrets,
  splitSecrets
} from "@carbon/ee";
import {
  buildRilletFieldTarget,
  buildXeroTrackingTarget,
  getAccountingIntegration,
  getProviderIntegration,
  getSyncOperationTransitionError,
  isAccountingSyncEnabled,
  ProviderID,
  QBO_DIMENSION_TARGET_CLASS,
  QBO_DIMENSION_TARGET_DEPARTMENT,
  type QboProvider,
  type RilletProvider,
  SYNC_OPERATION_ALLOWED_TRANSITIONS,
  SyncOperationStatusSchema,
  XERO_MAX_JOURNAL_DIMENSION_SLOTS,
  type XeroProvider
} from "@carbon/ee/accounting";
import { enableAuditLog } from "@carbon/ee/audit.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  ensureOnshapeReleaseWebhook,
  getIntegrationServerHooks,
  onshapeConnectionHasWriteScope
} from "@carbon/ee/hooks.server";
import type { OeeDevice } from "@carbon/ee/oee";
import { getOeeProvider } from "@carbon/ee/oee.server";
import {
  exchangeOnshapeAuthorizationCode,
  getConflictingOnshapeIntegration,
  ONSHAPE_OAUTH_SCOPES,
  type OnshapeIntegrationId
} from "@carbon/ee/onshape";
import { loadOnshapeOAuthConfig } from "@carbon/ee/onshape.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { patchRampSettings } from "@carbon/ee/ramp.server";
import { resolveCapabilities } from "@carbon/ee/sync";
import { trigger } from "@carbon/jobs";
import {
  compatibilityStatus,
  getCompanyTableCatalog,
  purgeScopeViolations,
  reportBackupCompatibility,
  selectExportableTables
} from "@carbon/jobs/backups";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  datetime,
  isInternalEmail,
  labelSizes,
  redirectExternal
} from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { type Insertable, type Selectable, sql } from "kysely";
import { nanoid } from "nanoid";
import { extract as tarExtract } from "tar-stream";
import { z } from "zod";
import { getPaymentTermsList } from "~/modules/accounting/accounting.service";
import {
  getShippingMethodsList,
  getStockTransfer,
  getStockTransferLines
} from "~/modules/inventory/inventory.service";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment
} from "~/modules/invoicing/invoicing.service";
import { insertEmployeeJob } from "~/modules/people/people.service";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getPurchasingTerms
} from "~/modules/purchasing/purchasing.service";
import { upsertLocation } from "~/modules/resources/resources.service";
import {
  getQuote,
  getQuoteCustomerDetails,
  getQuotePayment,
  getQuoteShipment,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines,
  getSalesTerms
} from "~/modules/sales/sales.service";
import {
  getQuoteLinePricesByQuoteId,
  getQuoteLines
} from "~/modules/sales/sales.utils";
import type { Integration } from "~/modules/settings/types";
import { oAuthCallbackSchema } from "~/modules/shared/shared.models";
import { getPermissionCacheKey } from "~/modules/users/users.service";
import { canAccessBackups } from "~/utils/backups";
import { path } from "~/utils/path";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { interpolateSequenceDate } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import {
  type CompanyBackupSummary,
  listCompanyBackupFolders
} from "./backups.service";
import type { IntegrationErrorCode } from "./integration-errors";
import { integrationErrorSearch } from "./integration-errors";
import { oeeDevicesCacheKey } from "./oee-devices-cache";
import type {
  itemSerialSequenceValidator,
  sequenceValidator,
  subsidiaryValidator
} from "./settings.models";
import { companyValidator, type customFieldValidator } from "./settings.models";

const PUBLIC_STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public/`;

export async function getAccountsPayableBillingAddress(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyAccountsPayableBillingAddress")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
}

export async function getAccountsReceivableBillingAddress(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyAccountsReceivableBillingAddress")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
}

export async function deleteSubsidiary(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("company").delete().eq("id", companyId);
}

export async function getApiKeys(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("apiKey")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true }
    ]);
  }

  return query;
}

type CompaniesRow = Database["public"]["Views"]["companies"]["Row"];

const logoUrl = (path: string | null) =>
  path ? `${PUBLIC_STORAGE_URL_PREFIX}${path}` : null;

export function withLogoUrls(company: CompaniesRow) {
  return {
    ...company,
    logoLight: logoUrl(company.logoLight),
    logoDark: logoUrl(company.logoDark),
    logoLightIcon: logoUrl(company.logoLightIcon),
    logoDarkIcon: logoUrl(company.logoDarkIcon),
    logoWatermark: logoUrl(company.logoWatermark)
  };
}

/**
 * The view already carries `companyGroupName`, so there is nothing to embed.
 */
export async function getCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  const companies = await client
    .from("companies")
    .select("*")
    .eq("userId", userId)
    .order("name");

  if (companies.error) {
    return companies;
  }

  return { data: companies.data.map(withLogoUrls), error: null };
}

/** The `getEmployeeCompanies` filter, for a list already loaded by `getCompanies`. */
export function employeeCompaniesOf<T extends { role: string | null }>(
  companies: T[]
) {
  return companies.filter((company) => company.role === "employee");
}

/**
 * The companies a user can enter in the ERP. ERP is an employee app, so
 * supplier/customer-only memberships (which belong to the portals) are
 * excluded. Single source of truth for the login callback, the select-company
 * picker, and the x+/_layout enforcement guard — keep those in sync via this.
 */
export async function getEmployeeCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  const companies = await client
    .from("companies")
    .select("*")
    .eq("userId", userId)
    .eq("role", "employee")
    .order("name");

  if (companies.error) {
    return companies;
  }

  return { data: companies.data.map(withLogoUrls), error: null };
}

export async function getIndustries(client: SupabaseClient<Database>) {
  return client
    .from("industry")
    .select("id, name, description, iconName")
    .eq("active", true)
    .order("sortOrder");
}

export async function getCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();
  if (company.error) {
    return company;
  }

  return {
    data: {
      ...company.data,
      logoLight: company.data.logoLight
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoLight}`
        : null,
      logoDark: company.data.logoDark
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoDark}`
        : null,
      logoLightIcon: company.data.logoLightIcon
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoLightIcon}`
        : null,
      logoDarkIcon: company.data.logoDarkIcon
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoDarkIcon}`
        : null,
      logoWatermark: company.data.logoWatermark
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoWatermark}`
        : null
    },
    error: null
  };
}

export async function getCompanyIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);
}

export async function getCompanyPlan(
  client: SupabaseClient,
  companyId: string
) {
  return client
    .from("companyPlan")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
}

export async function getCompanySettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();
}

export async function getConfig(client: SupabaseClient<Database>) {
  return client.from("config").select("*").single();
}

export async function getCurrentSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  const sequence = await getSequence(client, table, companyId);
  if (sequence.error) {
    return sequence;
  }

  const { prefix, suffix, next, size } = sequence.data;

  const currentSequence = next.toString().padStart(size, "0");
  // Same calendar as get_next_sequence (SQL): tokens roll over at the
  // company's midnight, or the preview disagrees with the issued number.
  const timezone = await getCompanyTimeZone(client, companyId);
  const derivedPrefix = interpolateSequenceDate(prefix, timezone);
  const derivedSuffix = interpolateSequenceDate(suffix, timezone);

  return {
    data: `${derivedPrefix}${currentSequence}${derivedSuffix}`,
    error: null
  };
}

export async function getCustomField(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("customField").select("*").eq("id", id).single();
}

export async function getCustomFields(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client
    .from("customFieldTables")
    .select("*")
    .eq("table", table)
    .eq("companyId", companyId)
    .single();
}

export async function getCustomFieldsTables(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("customFieldTables")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getIntegration(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("integrations").select("*").eq("companyId", companyId);
}

export async function getKanbanOutputSetting(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("kanbanOutput")
    .eq("id", companyId)
    .single();
}

/**
 * Takes the next number of a sequence, which advances it.
 */
export async function getNextSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client.rpc("get_next_sequence", {
    sequence_name: table,
    company_id: companyId
  });
}

export async function getPlanById(client: SupabaseClient, planId: string) {
  return client.from("plan").select("*").eq("id", planId).single();
}

export async function getPlans(client: SupabaseClient) {
  return client.from("plan").select("*");
}

export async function getSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client
    .from("sequence")
    .select("*")
    .eq("table", table)
    .eq("companyId", companyId)
    .single();
}

export async function getSequences(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("sequence")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getSequencesList(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client
    .from("sequence")
    .select("id")
    .eq("table", table)
    .eq("companyId", companyId)
    .order("table");
}

export async function getItemSerialSequences(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("itemSerialSequences")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    // Strip PostgREST filter-grammar characters so a search term can't alter the
    // `or` expression or filter unintended columns (mirrors inventory.service.ts).
    const search = args.search.replace(/[,()\\]/g, " ");
    query = query.or(
      `itemReadableId.ilike.%${search}%,itemName.ilike.%${search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "itemReadableId", ascending: true }
  ]);
  return query;
}

export async function getItemSerialSequence(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemSerialSequences")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemSerialSequenceByItemId(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemSerialSequence")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function upsertItemSerialSequence(
  client: SupabaseClient<Database>,
  itemSerialSequence:
    | (Omit<z.infer<typeof itemSerialSequenceValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof itemSerialSequenceValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in itemSerialSequence) {
    return client
      .from("itemSerialSequence")
      .insert([itemSerialSequence])
      .select("id")
      .single();
  }
  const { id, companyId, ...update } = itemSerialSequence;
  return client
    .from("itemSerialSequence")
    .update(sanitize(update))
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function deleteItemSerialSequence(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemSerialSequence")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function getSubsidiaries(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("company")
    .select(
      "id, name, baseCurrencyCode, countryCode, parentCompanyId, isEliminationEntity, active"
    )
    .eq("companyGroupId", companyGroupId)
    .order("name");
}

export async function getSubsidiary(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("company").select("*").eq("id", companyId).single();
}

export async function getTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("terms").select("*").eq("id", companyId).single();
}

export async function getDocumentTemplate(
  client: SupabaseClient<Database>,
  companyId: string,
  documentType: DocumentTemplateType
) {
  return client
    .from("documentTemplate")
    .select("*")
    .eq("companyId", companyId)
    .eq("documentType", documentType)
    .maybeSingle();
}

/**
 * Load a stored document template as a `DocumentTemplate | null` ready to pass
 * to a PDF (which runs it through `resolveTemplate`). Returns null when no row
 * is stored, so the PDF falls back to the type's default.
 */
export async function getDocumentTemplateConfig(
  client: SupabaseClient<Database>,
  companyId: string,
  documentType: DocumentTemplateType
): Promise<DocumentTemplate | null> {
  const stored = await getDocumentTemplate(client, companyId, documentType);
  return toDocumentTemplate(stored.data, documentType);
}

/** The template row only: `settings.documentTemplate.save` also saves the header layout onto its section. */
export async function upsertDocumentTemplate(
  client: SupabaseClient<Database>,
  documentTemplate: {
    companyId: string;
    documentType: DocumentTemplateType;
    blocks: DocumentBlock[];
    theme: DocumentTheme;
    settings: DocumentSettings;
    headerSectionId: string | null;
    footerSectionId: string | null;
    createdBy: string;
    updatedBy: string;
  }
) {
  return client.from("documentTemplate").upsert(
    {
      ...documentTemplate,
      // Always persist the current schema version of the JSON we're writing.
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      updatedAt: new Date().toISOString()
    },
    { onConflict: "companyId,documentType" }
  );
}

export async function getDocumentSections(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("documentSection")
    .select("*")
    .eq("companyId", companyId)
    .order("name");
}

export async function getDocumentSection(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("documentSection")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getDocumentSectionsByIds(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
) {
  return client
    .from("documentSection")
    .select("*")
    .eq("companyId", companyId)
    .in("id", ids);
}

/** The section row: `settings.documentSection.save` is the operation. */
export async function upsertDocumentSection(
  client: SupabaseClient<Database>,
  documentSection: {
    id?: string;
    companyId: string;
    name: string;
    placement: DocumentSectionPlacement;
    content: JSONContent;
    config?: Record<string, unknown>;
  } & ({ createdBy: string } | { updatedBy: string })
) {
  // Editing a system default forks it into a real row keyed by the same id, so
  // it overrides the built-in everywhere it's referenced. Upsert keeps repeat
  // edits idempotent (the row may or may not exist yet).
  if (documentSection.id && isBuiltInSectionId(documentSection.id)) {
    const actor =
      "createdBy" in documentSection
        ? documentSection.createdBy
        : documentSection.updatedBy;
    return client
      .from("documentSection")
      .upsert(
        {
          id: documentSection.id,
          companyId: documentSection.companyId,
          name: documentSection.name,
          placement: documentSection.placement,
          content: documentSection.content as Json,
          config: (documentSection.config ?? {}) as Json,
          createdBy: actor,
          updatedBy: actor,
          updatedAt: new Date().toISOString()
        },
        { onConflict: "id,companyId" }
      )
      .select("id");
  }

  if ("createdBy" in documentSection) {
    return client
      .from("documentSection")
      .insert({
        ...documentSection,
        content: documentSection.content as Json,
        config: (documentSection.config ?? {}) as Json
      })
      .select("id");
  }
  const { id, companyId, ...update } = documentSection;
  return client
    .from("documentSection")
    .update({
      ...update,
      content: update.content as Json,
      config: (update.config ?? {}) as Json,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id ?? "")
    .eq("companyId", companyId)
    .select("id");
}

/** The section row: `settings.documentSection.delete` is the operation. */
export async function deleteDocumentSection(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("documentSection")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

/**
 * Fetch the given section ids and return them keyed by id for rendering.
 */
export async function resolveSections(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<Record<string, ResolvedSection>> {
  if (ids.length === 0) return {};
  const map: Record<string, ResolvedSection> = {};

  // System sections live in code, not the DB. Seed them first so a stored row
  // with the same id (a customized/forked default) overrides below.
  for (const id of ids) {
    const builtIn = getBuiltInSection(id);
    if (builtIn) map[id] = builtIn;
  }

  const dbIds = ids.filter((id) => !map[id] || map[id]?.builtIn);
  const { data } = await getDocumentSectionsByIds(client, companyId, dbIds);
  for (const row of (data ?? []) as ResolvedSection[]) {
    map[row.id] = {
      id: row.id,
      name: row.name,
      placement: row.placement,
      content: row.content,
      config: row.config
    };
  }
  return map;
}

export async function getWebhook(client: SupabaseClient<Database>, id: string) {
  return client.from("webhook").select("*").eq("id", id).single();
}

export async function getWebhooks(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("webhook")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true }
    ]);
  }

  return query;
}

export async function getWebhookTables(client: SupabaseClient<Database>) {
  return client.from("webhookTable").select("*").order("name");
}

export async function insertCompany(
  client: SupabaseClient<Database>,
  company: z.infer<typeof companyValidator>,
  companyGroupId?: string
) {
  return client
    .from("company")
    .insert({ ...company, companyGroupId })
    .select("id")
    .single();
}

export async function insertSubsidiary(
  client: SupabaseClient<Database>,
  subsidiary: z.infer<typeof subsidiaryValidator> & {
    companyGroupId: string;
    createdBy: string;
    isEliminationEntity?: boolean;
  }
) {
  // company has no createdBy column.
  const { id: _, createdBy: _createdBy, ...data } = subsidiary;
  return client.from("company").insert(data).select("id").single();
}

/** Only the company fields: `settings.subsidiary.update` gates it and drops the cached time zone. */
export async function updateSubsidiary(
  client: SupabaseClient<Database>,
  id: string,
  subsidiary: Partial<z.infer<typeof subsidiaryValidator>> & {
    updatedBy: string;
  }
) {
  const { id: _, ...data } = subsidiary;
  return client.from("company").update(data).eq("id", id);
}

export async function updateCompanyPlan(
  client: SupabaseClient<Database>,
  data: {
    companyId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionStatus: string;
    subscriptionStartDate: string;
  }
) {
  // Extract companyId and build the update data without it
  const { companyId, ...updateData } = data;

  return client.from("companyPlan").update(updateData).eq("id", companyId);
}

/** Only the company row: `settings.company.update` also handles a base-currency change and the cached time zone. */
export async function updateCompany(
  client: SupabaseClient<Database>,
  companyId: string,
  company: Partial<z.infer<typeof companyValidator>> & {
    updatedBy: string;
  }
) {
  return client.from("company").update(sanitize(company)).eq("id", companyId);
}

/**
 * Company update for a BASE-CURRENCY change: exchange-rate overrides are
 * denominated in the old base, so they must be cleared in the SAME transaction
 * — a committed base flip with surviving old-base pins silently mis-rates
 * every new document, and a non-atomic cleanup can race a freshly created
 * new-base override. Kysely throws on rollback; `settings.company.update`
 * try/catches.
 */
export async function updateCompanyWithBaseCurrencyChange(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  company: Partial<z.infer<typeof companyValidator>> & {
    updatedBy: string;
  }
) {
  // An explicit allow-list of the company form's fields, never the caller's
  // object: Kysely bypasses RLS and the API passes `company` through with
  // whatever keys were sent, so a spread would reach any column of the row.
  const allowed = new Set<string>(Object.keys(companyValidator.shape));
  const fields = Object.fromEntries(
    Object.entries(sanitize(company)).filter(([key]) => allowed.has(key))
  ) as Partial<z.infer<typeof companyValidator>>;

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("company")
      .set({ ...fields, updatedBy: company.updatedBy })
      .where("id", "=", companyId)
      .execute();
    await trx
      .deleteFrom("exchangeRateOverride")
      .where("companyId", "=", companyId)
      .execute();
  });
}

// NOTE: updateIntegrationMetadata lives in settings.server.ts, NOT here. It needs
// the service-role client for the Vault RPC, and this file is re-exported by the
// client barrel (~/modules/settings) — a `@carbon/auth/client.server` import here
// would pull the service-role client into the browser bundle (Vite blocks it).

export async function updateLogoDark(
  client: SupabaseClient<Database>,
  companyId: string,
  logoDark: string | null
) {
  return client
    .from("company")
    .update(
      sanitize({
        logoDark
      })
    )
    .eq("id", companyId);
}

export async function updateLogoDarkIcon(
  client: SupabaseClient<Database>,
  companyId: string,
  logoDarkIcon: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoDarkIcon }))
    .eq("id", companyId);
}

export async function updateLogoLight(
  client: SupabaseClient<Database>,
  companyId: string,
  logoLight: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoLight }))
    .eq("id", companyId);
}

export async function updateLogoLightIcon(
  client: SupabaseClient<Database>,
  companyId: string,
  logoLightIcon: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoLightIcon }))
    .eq("id", companyId);
}

export async function updateLogoWatermark(
  client: SupabaseClient<Database>,
  companyId: string,
  logoWatermark: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoWatermark }))
    .eq("id", companyId);
}

export async function updateProductLabelSize(
  client: SupabaseClient<Database>,
  companyId: string,
  productLabelSize: string
) {
  return client
    .from("companySettings")
    .update(sanitize({ productLabelSize }))
    .eq("id", companyId);
}

export async function updateSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string,
  sequence: Partial<z.infer<typeof sequenceValidator>> & {
    updatedBy: string;
  }
) {
  return client
    .from("sequence")
    .update(sanitize(sequence))
    .eq("companyId", companyId)
    .eq("table", table);
}

// ── Planning ownership + tolerance (spec §P1.3 / §P1.6) ────────────────────
// The responsibleEmployee ladder's configurable rungs: company default →
// per-location → per-(location, item group). The item-group tier is
// LOCATION-SPECIFIC, stored sparsely in itemPostingGroupResponsibility — an
// inheritance tree (the printer AssignmentsCard model), never a matrix.

export async function getItemPostingGroupResponsibilities(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("itemPostingGroupResponsibility")
    .select("id, locationId, itemPostingGroupId, responsibleEmployee")
    .eq("companyId", companyId);
}

export async function setLocationResponsibleEmployee(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    employeeId: string | null;
    userId: string;
  }
) {
  // `location` is a resources table: without resources_update, row-level
  // security matches no row and the update succeeds having changed nothing.
  // Returning the row lets the caller tell the two apart.
  return client
    .from("location")
    .update({ responsibleEmployee: args.employeeId, updatedBy: args.userId })
    .eq("id", args.locationId)
    .eq("companyId", args.companyId)
    .select("id");
}

/**
 * Upsert one (location, item group) ownership cell; clearing the employee
 * DELETES the row (unset → inherit up the tree, matching printers).
 */
export async function upsertItemPostingGroupResponsibility(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    itemPostingGroupId: string;
    employeeId: string | null;
    userId: string;
  }
) {
  if (!args.employeeId) {
    return client
      .from("itemPostingGroupResponsibility")
      .delete()
      .eq("companyId", args.companyId)
      .eq("locationId", args.locationId)
      .eq("itemPostingGroupId", args.itemPostingGroupId);
  }
  // Update first, insert only when the cell is new: an upsert would restate
  // `createdBy` on every reassignment.
  const updated = await client
    .from("itemPostingGroupResponsibility")
    .update({
      responsibleEmployee: args.employeeId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId)
    .eq("itemPostingGroupId", args.itemPostingGroupId)
    .select("id");
  if (updated.error || (updated.data?.length ?? 0) > 0) return updated;
  return client
    .from("itemPostingGroupResponsibility")
    .insert({
      companyId: args.companyId,
      locationId: args.locationId,
      itemPostingGroupId: args.itemPostingGroupId,
      responsibleEmployee: args.employeeId,
      createdBy: args.userId
    })
    .select("id");
}
/**
 * Unpack a `.carbon.tar.gz` (a whole backup folder) into a fresh
 * `exports/<name>/` so restore/import can read it. Streams entry-by-entry — every
 * file is small and under the bucket size cap — so a multi-GB prod backup is
 * never uploaded as one (over-cap) object. Returns the folder name.
 *
 * Server-only (tar-stream + zlib). Shared by the Settings upload route and the
 * onboarding "restore from a backup" flow.
 */
export async function unpackBackupArchive(
  client: SupabaseClient<Database>,
  companyId: string,
  source: Readable
): Promise<{ name: string; assetErrors: number }> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${ts}_uploaded`;
  const dir = `exports/${name}`;
  let manifestSeen = false;
  // Split critical (manifest + table) failures from asset failures: a missing
  // table breaks the load, but assets are best-effort downstream (the restore
  // only warns on a failed asset copy), so a hiccuped asset must not block it.
  let criticalErrors = 0;
  let assetErrors = 0;

  const extract = tarExtract();
  const gunzip = createGunzip();
  source.on("error", (err) => extract.destroy(err));
  gunzip.on("error", (err) => extract.destroy(err));

  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("error", next);
      stream.on("end", async () => {
        try {
          const rel = header.name;
          // Reject path traversal; only land files inside this backup's folder.
          if (rel.includes("..") || rel.startsWith("/")) {
            next();
            return;
          }
          const up = await client.storage
            .from(companyId)
            .upload(`${dir}/${rel}`, Buffer.concat(chunks), { upsert: true });
          if (up.error) {
            if (rel.startsWith("assets/")) assetErrors++;
            else criticalErrors++;
          } else if (rel === "manifest.json") {
            // Only mark the manifest seen once it's actually landed — an
            // interrupted/failed upload must not pass the completeness check
            // below and yield a phantom folder a restore would fire against.
            manifestSeen = true;
          }
          next();
        } catch (err) {
          next(err as Error);
        }
      });
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    source.pipe(gunzip).pipe(extract);
  });

  if (!manifestSeen) {
    throw new Error("Archive is missing manifest.json");
  }
  if (criticalErrors > 0) {
    // A manifest or table file failed to land — the folder is unrestorable.
    // Surface it rather than return a name a restore would later fail on with
    // an opaque "manifest not found".
    throw new Error(
      `${criticalErrors} critical file(s) failed to upload — the backup is incomplete. Retry the upload.`
    );
  }
  return { name, assetErrors };
}
const log = getLogger("erp", "backups");

/**
 * Backups are a Business/Enterprise feature (`BACKUPS`), plus an escape hatch for
 * internal staff and local dev (`canAccessBackups`). Community/Starter cannot
 * reach them. Shared by every backup route gate so they can never diverge.
 */
export async function canManageBackups(
  client: SupabaseClient<Database>,
  companyId: string,
  email: string | null | undefined
): Promise<boolean> {
  if (canAccessBackups(email)) return true;
  return companyHasFeature(client, companyId, { feature: "BACKUPS" });
}

// Server-only: enqueues the in-place restore inngest jobs and computes the
// live compatibility verdict. Kept out of the route module so `@carbon/jobs`
// (which pulls Node `Buffer` via the Inngest client) never lands in the
// browser bundle.

/**
 * The Backups loader's list: each ready backup's manifest diffed against
 * TODAY's schema, so the badge and the restore disclosure describe what a
 * restore would actually do right now. Computed on every load rather than
 * stored — a verdict written at export time compares the manifest against the
 * very schema it was projected from and can only ever say "ready".
 */
export async function getCompanyBackups(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ data: CompanyBackupSummary[] | null; error: Error | null }> {
  const { data, error } = await listCompanyBackupFolders(client, companyId);
  if (error || !data) return { data: null, error };

  // One schema read per page load, shared by every row. A failure here must
  // NOT take the page down: listing, downloading and deleting backups all work
  // without a verdict, and the restore has its own gate. So a database that is
  // unreachable or out of connections costs the badges, not the screen.
  let catalog: Awaited<ReturnType<typeof getCompanyTableCatalog>> | null = null;
  if (data.some((b) => b.manifest)) {
    try {
      catalog = await getCompanyTableCatalog(db);
    } catch (err) {
      log.warn("Backups: live compatibility unavailable — listing without it", {
        companyId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    data: data.map(({ manifest, ...summary }) => {
      // No catalog (schema unreadable) or no manifest (incomplete export) →
      // `compatibility` stays null: "not checked", never a green "ready".
      if (!catalog || !manifest) return summary;
      const report = reportBackupCompatibility(catalog, manifest);
      return {
        ...summary,
        compatibility: {
          status: compatibilityStatus(report),
          findings: report.findings
        }
      };
    }),
    error: null
  };
}

/**
 * Kick off an in-place restore of `filePath` (one of this company's own
 * backups). The job snapshots the current state, wipes the company's data and
 * loads the backup. Returns the restore run id used to poll status and to
 * keep/revert the result.
 */
export async function startCompanyRestore(args: {
  companyId: string;
  userId: string;
  filePath: string;
  includeStorage: "none" | "all";
  label?: string;
}): Promise<string> {
  const restoreRunId = nanoid();
  await trigger("company-restore", { ...args, restoreRunId });
  return restoreRunId;
}

/** Keep a restore — drop the pre-restore snapshot + marker. */
export async function finalizeCompanyRestore(args: {
  companyId: string;
  restoreRunId: string;
}): Promise<void> {
  await trigger("company-restore-finalize", args);
}

/** Undo a restore — wipe again and reload the pre-restore snapshot. */
export async function revertCompanyRestore(args: {
  companyId: string;
  restoreRunId: string;
}): Promise<void> {
  await trigger("company-restore-revert", args);
}

/**
 * Clear the failed-export marker once the user has acknowledged it. Service
 * role: `externalIntegrationMapping` has no DELETE policy, and the marker is
 * written by the export job (see EXPORT_INTEGRATION in
 * packages/jobs/src/inngest/functions/tasks/company-export.ts).
 */
export async function dismissCompanyExportFailure(
  companyId: string
): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", "company-export")
    .eq("companyId", companyId);
}

/**
 * Permanently delete this company's rows whose NOT-NULL FK escapes company scope
 * (and rows depending on them) — the data the export guard refuses on, and the
 * reason a restore's pre-restore snapshot fails on a company with them. Only
 * ever called from the user-confirmed "Remove corrupted data and restore"
 * action. One transaction; children first (see `purgeScopeViolations`).
 */
export async function purgeCorruptedRows(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ deleted: Array<{ table: string; rows: number }> }> {
  const serviceRole = getCarbonServiceRole();
  const company = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error) throw new Error(company.error.message);

  const catalog = await getCompanyTableCatalog(db);
  const { exportable } = selectExportableTables(catalog);
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));
  const result = await db
    .transaction()
    .execute((trx) =>
      purgeScopeViolations(
        trx,
        exportable,
        byName,
        companyId,
        company.data.companyGroupId ?? null
      )
    );
  log.warn("Backups: purged out-of-scope rows before restore", {
    companyId,
    deleted: result.deleted
  });
  return result;
}

/**
 * Starts a company backup export (`carbon/company-export`). The caller has
 * already checked `update: settings` and `canManageBackups`; the job itself
 * enforces the BACKUPS entitlement.
 */
export async function exportCompanyBackup(args: {
  companyId: string;
  userId: string;
  label?: string;
  includeStorage?: "none" | "all";
  /** Opt-in recovery: leave out rows whose links escape company scope. */
  skipCorrupted?: boolean;
}): Promise<{ error: Error | null }> {
  try {
    await trigger("company-export", {
      companyId: args.companyId,
      userId: args.userId,
      label: args.label?.slice(0, 80),
      includeStorage: args.includeStorage ?? "none",
      skipCorrupted: args.skipCorrupted === true
    });
    return { error: null };
  } catch (error) {
    log.error("Failed to start backup export", {
      companyId: args.companyId,
      error
    });
    return { error: error as Error };
  }
}
// Server-only: enqueues the demo-template inngest jobs. Kept out of the route
// module so `@carbon/jobs` (which pulls Node `Buffer` via the Inngest client)
// never lands in the browser bundle.

/**
 * Apply a demo dataset to this company. Always snapshots first, so the result is
 * revertible — `snapshot: true` also drives the wipe, since wiping without a
 * snapshot would be unrecoverable. Returns the run id used to poll status and to
 * keep/revert the result.
 */
export async function startCompanyTemplate(args: {
  companyId: string;
  userId: string;
  datasetKey: string;
}): Promise<string> {
  const templateRunId = nanoid();
  await trigger("company-template", {
    ...args,
    templateRunId,
    snapshot: true
  });
  return templateRunId;
}

/**
 * Resolve a settled template run — drop the pre-apply snapshot, then the marker.
 * Backs both "Keep" (on a ready run) and "Dismiss" (on a failed one): they are
 * the same operation. Deleting the marker row from here instead would strand the
 * snapshot folder in storage, since a failed revert keeps its `snapshotPath` so
 * the user can retry.
 */
export async function finalizeCompanyTemplate(args: {
  companyId: string;
  templateRunId: string;
}): Promise<void> {
  await trigger("company-template-finalize", args);
}

/** Undo an applied template — wipe again and reload the pre-apply snapshot. */
export async function revertCompanyTemplate(args: {
  companyId: string;
  userId: string;
  templateRunId: string;
}): Promise<void> {
  await trigger("company-template-revert", args);
}
type Client = SupabaseClient<Database>;

export interface PreviewEntity {
  id: string;
  label: string;
}

/**
 * Document types that support previewing against a real record.
 *
 * `hasRevision` marks the types whose records are revised — two revisions share
 * a readable id, so the picker must label them apart. It also gates selecting
 * `revisionId`, which only some of these views carry. Sales orders are NOT
 * revised (the column exists but nothing writes it), so they stay off.
 */
const LIST_CONFIG: Record<
  string,
  { view: string; idColumn: string; hasRevision?: boolean } | undefined
> = {
  salesInvoice: { view: "salesInvoices", idColumn: "invoiceId" },
  salesOrder: { view: "salesOrders", idColumn: "salesOrderId" },
  purchaseOrder: {
    view: "purchaseOrders",
    idColumn: "purchaseOrderId",
    hasRevision: true
  },
  quote: { view: "quotes", idColumn: "quoteId", hasRevision: true },
  stockTransfer: { view: "stockTransfer", idColumn: "stockTransferId" }
};

/** Shape `listPreviewEntities` reads back; `revisionId` only when requested. */
type PreviewRow = {
  id: string;
  revisionId?: number | null;
} & Record<string, string | number | null | undefined>;

/** Recent records of a document type, to populate the preview record picker. */
export async function listPreviewEntities(
  client: Client,
  companyId: string,
  documentType: string
): Promise<PreviewEntity[]> {
  const cfg = LIST_CONFIG[documentType];
  if (!cfg) return [];

  const { data } = await client
    .from(cfg.view as never)
    .select(
      cfg.hasRevision
        ? `id, ${cfg.idColumn}, revisionId`
        : `id, ${cfg.idColumn}`
    )
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    // Just the latest handful — the picker is for sampling, not browsing.
    .limit(6);

  return ((data ?? []) as PreviewRow[])
    .filter((row) => row.id)
    .map((row) => {
      const readableId = row[cfg.idColumn];
      return {
        id: row.id,
        label:
          withRevisionSuffix(
            typeof readableId === "string" ? readableId : null,
            row.revisionId
          ) || row.id
      };
    });
}

const emptyThumbnails: Record<string, string | null> = {};

/**
 * Fetch the real data props a document's PDF needs for a record id, mirroring
 * the live PDF route loaders. Returns null when unsupported / not found, so the
 * preview falls back to sample data.
 */
export async function buildPreviewProps(
  client: Client,
  companyId: string,
  documentType: string,
  id: string,
  locale: string
): Promise<Record<string, unknown> | null> {
  const [company, companySettings] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId)
  ]);
  if (!company.data) return null;
  const base = {
    company: company.data,
    companySettings: companySettings.data,
    locale,
    thumbnails: emptyThumbnails
  };

  switch (documentType) {
    case "salesInvoice": {
      const [
        invoice,
        lines,
        locations,
        shipment,
        terms,
        payment,
        shipping,
        ar
      ] = await Promise.all([
        getSalesInvoice(client, id),
        getSalesInvoiceLines(client, id),
        getSalesInvoiceCustomerDetails(client, id),
        getSalesInvoiceShipment(client, id),
        getSalesTerms(client, companyId),
        getPaymentTermsList(client, companyId),
        getShippingMethodsList(client, companyId),
        getAccountsReceivableBillingAddress(client, companyId)
      ]);
      if (!invoice.data) return null;
      return {
        ...base,
        salesInvoice: invoice.data,
        salesInvoiceLines: lines.data ?? [],
        salesInvoiceLocations: locations.data,
        salesInvoiceShipment: shipment.data,
        accountsReceivableBillingAddress: companySettings.data
          ?.accountsReceivableAddress
          ? ar.data
          : null,
        terms: (terms?.data?.salesTerms ?? {}) as JSONContent,
        paymentTerms: payment.data ?? [],
        shippingMethods: shipping.data ?? []
      };
    }
    case "salesOrder": {
      const [order, lines, locations, terms, payment, shipping, ar] =
        await Promise.all([
          getSalesOrder(client, id),
          getSalesOrderLines(client, id),
          getSalesOrderCustomerDetails(client, id),
          getSalesTerms(client, companyId),
          getPaymentTermsList(client, companyId),
          getShippingMethodsList(client, companyId),
          getAccountsReceivableBillingAddress(client, companyId)
        ]);
      if (!order.data) return null;
      return {
        ...base,
        salesOrder: order.data,
        salesOrderLines: lines.data ?? [],
        salesOrderLocations: locations.data,
        accountsReceivableBillingAddress: companySettings.data
          ?.accountsReceivableAddress
          ? ar.data
          : null,
        terms: (terms?.data?.salesTerms ?? {}) as JSONContent,
        paymentTerms: payment.data ?? [],
        shippingMethods: shipping.data ?? []
      };
    }
    case "purchaseOrder": {
      const [order, lines, locations, terms, payment, ap] = await Promise.all([
        getPurchaseOrder(client, id),
        getPurchaseOrderLines(client, id),
        getPurchaseOrderLocations(client, id),
        getPurchasingTerms(client, companyId),
        getPaymentTermsList(client, companyId),
        getAccountsPayableBillingAddress(client, companyId)
      ]);
      if (!order.data) return null;
      return {
        ...base,
        purchaseOrder: order.data,
        purchaseOrderLines: lines.data ?? [],
        purchaseOrderLocations: locations.data,
        accountsPayableBillingAddress: companySettings.data
          ?.accountsPayableAddress
          ? ap.data
          : null,
        terms: (terms?.data?.purchasingTerms ?? {}) as JSONContent,
        paymentTerms: payment.data ?? []
      };
    }
    case "quote": {
      const [
        quote,
        lines,
        prices,
        locations,
        payment,
        shipment,
        terms,
        paymentTerms,
        shipping
      ] = await Promise.all([
        getQuote(client, id),
        getQuoteLines(client, id),
        getQuoteLinePricesByQuoteId(client, id),
        getQuoteCustomerDetails(client, id),
        getQuotePayment(client, id),
        getQuoteShipment(client, id),
        getSalesTerms(client, companyId),
        getPaymentTermsList(client, companyId),
        getShippingMethodsList(client, companyId)
      ]);
      if (!quote.data) return null;
      // The document's own stamped rate — never a live lookup, so a reprint
      // can't silently change. Legacy pre-stamping quotes (null) render at 1,
      // consistent with their line snapshots' default.
      const exchangeRate = quote.data.exchangeRate ?? 1;
      return {
        ...base,
        exchangeRate,
        quote: quote.data,
        quoteLines: lines.data ?? [],
        quoteLinePrices: prices.data ?? [],
        quoteCustomerDetails: locations.data,
        payment: payment?.data,
        shipment: shipment?.data,
        terms: (terms?.data?.salesTerms ?? {}) as JSONContent,
        paymentTerms: paymentTerms.data ?? [],
        shippingMethods: shipping.data ?? []
      };
    }
    case "stockTransfer": {
      const [transfer, lines] = await Promise.all([
        getStockTransfer(client, id),
        getStockTransferLines(client, id)
      ]);
      if (!transfer.data) return null;
      const location = await client
        .from("location")
        .select("*")
        .eq("id", transfer.data.locationId)
        .single();
      return {
        ...base,
        stockTransfer: transfer.data,
        stockTransferLines: lines.data ?? [],
        location: location.data
      };
    }
    default:
      return null;
  }
}
export {
  type ResolvedLabelLogo,
  resolveLabelLogo
} from "@carbon/documents/labels";

type CompanyLogoPaths = {
  logoLight: string | null;
  logoLightIcon: string | null;
};

/**
 * Reads the company's logo storage paths fresh (not `getCompany`'s
 * already-public-URL result — that one is shared with browser-facing callers
 * like the company picker and settings page, and cannot be pointed at the
 * internal URL without breaking those) and expands them against the internal
 * URL. Label routes feed this into `resolveLabelLogo` instead of `getCompany`'s
 * `logoLight`/`logoLightIcon`; `getCompany`'s own result stays public and is
 * still safe to use for everything else a label route needs (name, text vars).
 */
export async function getCompanyLogoForLabel(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<CompanyLogoPaths | null> {
  const { data } = await client
    .from("company")
    .select("logoLight, logoLightIcon")
    .eq("id", companyId)
    .maybeSingle();

  if (!data) return null;

  const expand = (path: string | null) =>
    path
      ? `${SUPABASE_INTERNAL_URL}/storage/v1/object/public/public/${path}`
      : null;

  return {
    logoLight: expand(data.logoLight),
    logoLightIcon: expand(data.logoLightIcon)
  };
}
const logger = getLogger("erp", "oee-devices");

// Picking a work center revalidates the tab, and a mapping change does not
// change the provider's device list. A short TTL keeps those revalidations off
// the provider. A change to the integration's connection (its API key or
// environment) clears it: `clearCompanyIntegrationCache` deletes these keys.
// The @carbon/kv wrapper fails soft: a Redis miss or outage just calls the
// provider.
const DEVICES_TTL_SECONDS = 60;

async function getCachedDevices(
  companyId: string,
  integrationId: string
): Promise<OeeDevice[] | null> {
  const key = oeeDevicesCacheKey(companyId, integrationId);
  const cached = await redis.get(key);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as OeeDevice[];
  } catch (err) {
    logger.error("Failed to parse cached OEE devices", {
      companyId,
      integrationId,
      error: err
    });
    await redis.del(key);
    return null;
  }
}

/**
 * The provider's devices for an OEE integration, cached for 60 seconds. A
 * provider error is never cached.
 */
export async function listOeeDevices(
  companyId: string,
  integrationId: string
): Promise<{ devices: OeeDevice[]; error: string | null }> {
  const cached = await getCachedDevices(companyId, integrationId);
  if (cached) return { devices: cached, error: null };

  let error: string | null = null;
  try {
    const oee = await getOeeProvider(
      getCarbonServiceRole(),
      companyId,
      integrationId
    );
    if (oee.error || !oee.data) {
      error = oee.error ?? "Could not connect to the provider";
    } else {
      const devices = await oee.data.provider.listDevices();
      await redis.set(
        oeeDevicesCacheKey(companyId, integrationId),
        JSON.stringify(devices),
        "EX",
        DEVICES_TTL_SECONDS
      );
      return { devices, error: null };
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  logger.error("Failed to list OEE devices", {
    companyId,
    integrationId,
    error
  });
  return { devices: [], error };
}

/**
 * Device-mapping data for an OEE integration's Devices tab: the provider's
 * devices, this integration's saved mappings, the work centers another OEE
 * integration already holds, and the active work centers (plus any inactive
 * one a device of this integration is still mapped to) with their location
 * timezone. A provider failure renders the mappings with no devices and the
 * error above the list rather than failing the drawer. The device list is
 * cached for 60 seconds; a provider error is never cached.
 */
export async function getOeeDevicesTabData(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
) {
  // The provider read runs alongside the mappings. Mappings come before the
  // work centers: the work center list must include an inactive work center a
  // device is still mapped to, or its row shows no work center.
  const [{ devices, error: providerError }, mappings] = await Promise.all([
    listOeeDevices(companyId, integrationId),
    client
      .from("workCenterDevice")
      .select(
        "externalDeviceId, deviceName, externalSiteId, siteTimezone, workCenterId, currentState, lastSyncedAt, lastSyncError"
      )
      .eq("companyId", companyId)
      .eq("integration", integrationId)
  ]);

  const mappedIds = (mappings.data ?? []).map((m) => m.workCenterId);
  const workCentersQuery = client
    .from("workCenter")
    .select("id, name, location(timezone)")
    .eq("companyId", companyId);

  const [takenWorkCenters, workCenters] = await Promise.all([
    client
      .from("workCenterDevice")
      .select("workCenterId, deviceName, integration")
      .eq("companyId", companyId)
      .neq("integration", integrationId),
    (mappedIds.length > 0
      ? workCentersQuery.or(`active.eq.true,id.in.(${mappedIds.join(",")})`)
      : workCentersQuery.eq("active", true)
    ).order("name")
  ]);

  for (const result of [mappings, takenWorkCenters, workCenters]) {
    if (result.error) {
      logger.error("Failed to load OEE device mapping data", {
        companyId,
        integrationId,
        error: result.error
      });
    }
  }

  return {
    devices,
    mappings: mappings.data ?? [],
    takenWorkCenters: takenWorkCenters.data ?? [],
    workCenters: (workCenters.data ?? []).map((workCenter) => ({
      id: workCenter.id,
      name: workCenter.name,
      // Null when the location inherits the company's timezone ('' or null):
      // the tab falls back to the company's.
      locationTimezone: workCenter.location?.timezone || null
    })),
    error: providerError
  };
}
/** Absolute integrations-page URL on this request's origin. */
function integrationsUrl(request: Request) {
  const requestUrl = new URL(request.url);

  if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
    requestUrl.protocol = "http";
  }

  return `${requestUrl.origin}${path.to.integrations}`;
}

/**
 * The OAuth callback for both Onshape integrations — the public app
 * (`/api/integrations/onshape/oauth`) and a Government customer's private app
 * (`/api/integrations/onshape-government/oauth`). Only where the client comes
 * from differs, and `loadOnshapeOAuthConfig` owns that.
 *
 * Onshape reaches this by redirecting the user's browser, so a failure has to
 * render as something they can act on: send them back to the integrations
 * page, which turns the code into a toast. Only a code crosses the URL;
 * `integrationErrors` owns the copy.
 */
export async function completeOnshapeAuthorization({
  request,
  integrationId,
  userId,
  companyId
}: {
  request: Request;
  integrationId: OnshapeIntegrationId;
  userId: string;
  companyId: string;
}) {
  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  // The state must be the one issued to THIS browser for this user, company and
  // integration. Without the check anyone could send a victim a callback URL
  // carrying the attacker's own Onshape code, linking the victim's company to
  // the attacker's Onshape account. Single-use: consumed whether it matches or
  // not.
  const consumedState = await consumeOAuthState(
    request,
    url.searchParams.get("state") ?? "",
    { integrationId, userId, companyId }
  );

  // Both integrations declare the same codes, each with its own copy.
  const connectionFailed = (
    reason: IntegrationErrorCode<OnshapeIntegrationId>
  ) =>
    redirectExternal(
      `${integrationsUrl(request)}${integrationErrorSearch<OnshapeIntegrationId>(integrationId, reason)}`,
      { headers: { "Set-Cookie": consumedState.cookie } }
    );

  if (!consumedState.valid) {
    logger.error("Invalid Onshape OAuth state", { integrationId, companyId });
    return connectionFailed("invalid-state");
  }

  // Onshape reports a refused authorization by redirecting here with `error`
  // (and usually `error_description`) in place of `code`. `invalid_scope`
  // means the OAuth application isn't granted a scope we asked for — in
  // practice `OAuth2Write` ("Application can write to your documents"), so the
  // UI can name the exact fix instead of echoing Onshape's wording.
  if (searchParams.error) {
    logger.error("Onshape authorization refused", {
      integrationId,
      error: searchParams.error,
      errorDescription: searchParams.error_description
    });
    return connectionFailed(
      searchParams.error === "invalid_scope" ? "write-permission" : "denied"
    );
  }

  const authResponse = oAuthCallbackSchema.safeParse(searchParams);
  if (!authResponse.success) {
    // Log the parameter names (never the values — `code` is a live credential).
    logger.error("Invalid Onshape auth response", {
      integrationId,
      params: Object.keys(searchParams)
    });
    return connectionFailed("invalid-response");
  }

  const serviceRole = getCarbonServiceRole();

  // A company holds one Onshape connection at a time; two would leave every
  // background job guessing which tenant to talk to.
  if (
    await getConflictingOnshapeIntegration(
      serviceRole,
      companyId,
      integrationId
    )
  ) {
    return connectionFailed("connection-conflict");
  }

  const oauth = await loadOnshapeOAuthConfig(companyId, integrationId);
  if (!oauth) return connectionFailed("not-configured");

  try {
    let tokenData: Awaited<ReturnType<typeof exchangeOnshapeAuthorizationCode>>;
    try {
      tokenData = await exchangeOnshapeAuthorizationCode(
        oauth,
        authResponse.data.code
      );
    } catch (error) {
      logger.error("Onshape token exchange failed", { integrationId, error });
      return connectionFailed("token-exchange");
    }

    if (!tokenData.access_token) {
      logger.error("Onshape token response had no access token", {
        integrationId
      });
      return connectionFailed("token-exchange");
    }

    const existing = await serviceRole
      .from("companyIntegration")
      .select("metadata")
      .eq("id", integrationId)
      .eq("companyId", companyId)
      .maybeSingle();
    const existingMetadata = (existing.data?.metadata ?? {}) as Record<
      string,
      unknown
    >;

    // The scope actually granted by this authorization. Onshape returns it on
    // the token response; fall back to what we requested. A token minted
    // without write can't export assets or manage the release webhook, and a
    // refresh can't widen it — so asset sync is switched off rather than left
    // on-but-broken.
    const scope = tokenData.scope ?? ONSHAPE_OAUTH_SCOPES.join(" ");
    const metadata: Record<string, unknown> = {
      ...existingMetadata,
      credentials: {
        type: "oauth2",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      },
      scope,
      baseUrl: oauth.baseUrl
    };
    // Settings survive a reconnect (a Government app's client and tenant, the
    // asset-sync toggle), but the Onshape company is re-resolved from the new
    // token: it may belong to a different account or tenant.
    delete metadata.onshapeCompanyId;
    const canWrite = onshapeConnectionHasWriteScope(metadata);
    if (!canWrite) metadata.assetSyncEnabled = false;

    const saved = await upsertCompanyIntegration(serviceRole, {
      id: integrationId,
      active: true,
      // @ts-expect-error TS2322 - metadata is a JSON object
      metadata,
      updatedBy: userId,
      companyId
    });

    if (saved.error || !saved.data?.metadata) {
      logger.error("Failed to save Onshape integration", {
        integrationId,
        error: saved.error
      });
      return connectionFailed("save-failed");
    }

    // A Government connection is configured BEFORE it is authorized, so asset
    // sync may already be on: subscribe to releases now that there is a token.
    // Best-effort — the settings save retries it and reports a failure there.
    if (metadata.assetSyncEnabled === true) {
      const webhook = await ensureOnshapeReleaseWebhook(companyId, true);
      if (!webhook.ok) {
        logger.error("Onshape release webhook registration failed", {
          integrationId,
          error: webhook.error
        });
      }
    }

    return redirectExternal(integrationsUrl(request), {
      headers: { "Set-Cookie": consumedState.cookie }
    });
  } catch (error) {
    logger.error("Onshape OAuth Error", { integrationId, error });
    return connectionFailed("unexpected");
  }
}
const INTEGRATION_CACHE_TTL = 3600;

/**
 * Drop the cached auth record for an API key so a scope change or revocation
 * takes effect immediately in the common case. An in-flight auth read can still
 * re-prime the cache with the pre-write row, so the hard bound is the 30s TTL —
 * callers that delete the row should bust AGAIN after the delete commits, using
 * the returned keyHash (unreadable from the DB once the row is gone).
 *
 * Service-role on purpose: apiKey's RLS SELECT requires `settings_view`, but the
 * routes that revoke or rescope a key gate on `users_update`, so the caller's own
 * client cannot see the row and the bust would silently do nothing.
 */
export async function invalidateApiKeyCache(
  id: string,
  companyId: string
): Promise<string | null> {
  const { data, error } = await getCarbonServiceRole()
    .from("apiKey")
    .select("keyHash")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  // A failed lookup is indistinguishable from a missing row at the return type,
  // and neither may block the revoke — log it so a stale scope surviving its TTL
  // is diagnosable rather than silent.
  if (error) {
    logger.error("Failed to read api key for cache bust", {
      error,
      id,
      companyId
    });
  }
  if (!data?.keyHash) return null;
  await bustApiKeyCache(data.keyHash);
  return data.keyHash;
}

export async function clearCustomFieldsCache(companyId?: string) {
  const keys = companyId ? `customFields:${companyId}:*` : "customFields:*";
  redis.keys(keys).then(function (keys) {
    const pipeline = redis.pipeline();
    keys.forEach(function (key) {
      pipeline.del(key);
    });
    return pipeline.exec();
  });
}

export async function clearCompanyIntegrationCache(
  companyId: string
): Promise<void> {
  const cacheKey = `integrations:${companyId}`;

  try {
    // Clear both old and new key formats, and the OEE device lists: a new API
    // key or environment can name different stations.
    await redis.del(
      cacheKey,
      `json:${cacheKey}`,
      ...getIntegrationIdsByRole("oee").map((integrationId) =>
        oeeDevicesCacheKey(companyId, integrationId)
      )
    );
  } catch (error) {
    logger.error("Redis cache invalidation error", { error });
  }
}

export async function clearAllIntegrationCaches(): Promise<void> {
  try {
    // Clear both old and new key patterns
    const oldPattern = "integrations:*";
    const newPattern = "json:integrations:*";

    const [oldKeys, newKeys] = await Promise.all([
      redis.keys(oldPattern),
      redis.keys(newPattern)
    ]);

    const allKeys = [...oldKeys, ...newKeys];
    if (allKeys.length > 0) {
      logger.info("Clearing integration cache entries", {
        count: allKeys.length
      });
      await redis.del(...allKeys);
    }
  } catch (error) {
    logger.error("Error clearing all integration caches", { error });
  }
}

/**
 * Move accounting sync operations to `to` in one UPDATE. The statement itself
 * holds the transition rule: it matches only operations whose CURRENT status
 * may move to `to`, so one changed since it was read is left alone. Each
 * operation it did not move is reported with its reason.
 */
export async function transitionSyncOperations(
  client: SupabaseClient<Database>,
  args: {
    ids: string[];
    companyId: string;
    to: "Pending" | "Skipped";
    userId: string;
  }
): Promise<
  | { moved: number; failures: { id: string; reason: string }[]; error: null }
  | { moved: 0; failures: []; error: PostgrestError }
> {
  const { ids, companyId, to, userId } = args;
  const from = SyncOperationStatusSchema.options.filter((status) =>
    SYNC_OPERATION_ALLOWED_TRANSITIONS[status].includes(to)
  );

  const updated = await client
    .from("accountingSyncOperation")
    .update({ status: to, updatedBy: userId, updatedAt: datetime.timestamp() })
    .eq("companyId", companyId)
    .in("id", ids)
    .in("status", from)
    .select("id");
  if (updated.error) return { moved: 0, failures: [], error: updated.error };

  const moved = new Set(updated.data.map((row) => row.id));
  const missed = [...new Set(ids)].filter((id) => !moved.has(id));
  if (missed.length === 0) {
    return { moved: moved.size, failures: [], error: null };
  }

  const current = await client
    .from("accountingSyncOperation")
    .select("id, status")
    .eq("companyId", companyId)
    .in("id", missed);
  const statusById = new Map(
    (current.data ?? []).map((row) => [row.id, row.status])
  );
  const failures = missed.map((id) => {
    const status = statusById.get(id);
    return {
      id,
      reason: current.error
        ? current.error.message
        : !status
          ? `Sync operation ${id} not found`
          : (getSyncOperationTransitionError(status, to) ??
            `Sync operation ${id} changed while it was being updated`)
    };
  });
  return { moved: moved.size, failures, error: null };
}

export async function deactivateIntegration(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    updatedBy: string;
  }
) {
  const { id, companyId, updatedBy } = args;

  const result = await client
    .from("companyIntegration")
    .update({
      active: false,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .eq("companyId", companyId);

  if (result.error) {
    return result;
  }

  await clearCompanyIntegrationCache(companyId);

  return result;
}

export async function deleteCustomField(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  try {
    clearCustomFieldsCache(companyId);
  } finally {
    return client.from("customField").delete().eq("id", id);
  }
}

interface CompanyIntegration {
  id: string;
  companyId: string;
  metadata: Record<string, any>;
  active: boolean;
}

export async function getCachedCompanyIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<CompanyIntegration[]> {
  const cacheKey = `integrations:${companyId}`;

  try {
    // Try the new prefixed key first
    let cached = await redis.get(`json:${cacheKey}`);
    if (cached && typeof cached === "string") {
      try {
        return JSON.parse(cached);
      } catch (parseError) {
        logger.error("JSON parse error for prefixed cache key", {
          cacheKey: `json:${cacheKey}`,
          error: parseError
        });
        await redis.del(`json:${cacheKey}`);
      }
    }

    // Fallback to old key format for backwards compatibility
    cached = await redis.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      // Log the type and content for debugging
      logger.info("Cache hit", {
        cacheKey,
        type: typeof cached,
        isArray: Array.isArray(cached),
        value: cached,
        constructor: cached?.constructor?.name
      });

      // Handle different response types from Upstash
      if (Array.isArray(cached)) {
        // Direct array return from Upstash
        return cached as CompanyIntegration[];
      } else if (typeof cached === "object" && cached !== null) {
        // Object return from Upstash - could be a parsed JSON already
        return cached as CompanyIntegration[];
      } else if (typeof cached === "string") {
        // String return - needs JSON parsing
        try {
          return JSON.parse(cached);
        } catch (parseError) {
          logger.error("JSON parse error for cache key", {
            cacheKey,
            error: parseError,
            cached
          });
          await redis.del(cacheKey);
        }
      } else {
        logger.warning("Unexpected cache format for key", {
          cacheKey,
          type: typeof cached,
          cached
        });
        await redis.del(cacheKey);
      }
    }
  } catch (error) {
    logger.error("Redis cache read error", { error });
    // Clear the corrupted cache entry
    try {
      await redis.del(cacheKey);
    } catch (deleteError) {
      logger.error("Failed to delete corrupted cache entry", {
        error: deleteError
      });
    }
  }

  const { data, error } = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);

  if (error) {
    throw error;
  }

  // Secret material must never reach Redis. Strip each integration's secret keys
  // into the vault-backed shape (config only) before caching AND returning, so no
  // consumer of this function depends on a plaintext secret in `metadata` (secret
  // reads go through resolveIntegrationSecrets against the row, not this cache).
  const integrations = (data || []).map((integration) => ({
    ...integration,
    metadata: splitSecrets(integration.id, integration.metadata).config
  }));

  try {
    // Force string storage to avoid Upstash automatic deserialization issues
    const serializedData = JSON.stringify(integrations);
    if (typeof serializedData === "string" && serializedData.length > 0) {
      // Use a prefixed key to ensure we know this is a JSON string
      await redis.setex(
        `json:${cacheKey}`,
        INTEGRATION_CACHE_TTL,
        serializedData
      );
    } else {
      logger.error("Failed to serialize integrations data for cache");
    }
  } catch (error) {
    logger.error("Redis cache write error", { error });
  }

  return integrations as CompanyIntegration[];
}

export async function hasIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
): Promise<boolean> {
  const integrations = await getCachedCompanyIntegrations(client, companyId);
  return integrations.some((i) => i.id === integrationId && i.active === true);
}

export async function getCompanyIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
): Promise<CompanyIntegration | null> {
  const integrations = await getCachedCompanyIntegrations(client, companyId);
  return (
    integrations.find((i) => i.id === integrationId && i.active === true) ||
    null
  );
}

export async function getSlackIntegration(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ token: string; channelId?: string } | null> {
  // The Redis cache (getCompanyIntegration) no longer holds secret material, so
  // read the row directly with a service-role client — required both to resolve
  // the vaulted access_token and, in the transitional window, to see the plaintext
  // still in the column.
  const serviceRole = getCarbonServiceRole();
  const { data: integration } = await serviceRole
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("companyId", companyId)
    .eq("id", "slack")
    .maybeSingle();

  if (!integration?.active || !integration.metadata) {
    return null;
  }

  const metadata = (await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    "slack",
    integration.metadata,
    integration.secretRef
  )) as any;

  if (!metadata.access_token) {
    return null;
  }

  return {
    token: metadata.access_token,
    channelId: metadata.channel_id || metadata.default_channel_id
  };
}

export async function hasSlackIntegration(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<boolean> {
  return hasIntegration(client, companyId, "slack");
}

export async function upsertCompanyIntegration(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    active: boolean;
    metadata: Json;
    companyId: string;
    updatedBy: string;
  }
) {
  if (update.id === "ramp") {
    try {
      const data = await patchRampSettings(
        getCarbonServiceRole(),
        update.companyId,
        {
          metadata: update.metadata as Record<string, unknown>,
          active: update.active,
          updatedBy: update.updatedBy
        }
      );
      await clearCompanyIntegrationCache(update.companyId);
      return { data, error: null };
    } catch (error) {
      logger.error("Failed to atomically patch Ramp settings", {
        error,
        companyId: update.companyId
      });
      return { data: null, error };
    }
  }

  // Split secret material out of the metadata: only the non-secret config is
  // written to the column; the secrets go to Supabase Vault. The row is upserted
  // FIRST (so it exists), then the vault RPC stamps `secretRef` onto it.
  // `secrets` is a PARTIAL bag — splitSecrets omits untouched masked fields — so
  // `upsert_integration_secret` MERGES it into the stored bag (an omitted secret
  // keeps its value). A full replace here silently wiped a multi-secret
  // integration's other credential on a partial save.
  const { config, secrets } = splitSecrets(update.id, update.metadata);

  const result = await client
    .from("companyIntegration")
    .upsert([{ ...update, metadata: config as Json }], {
      onConflict: "id,companyId"
    })
    .select()
    .single();

  if (result.error) {
    return result;
  }

  if (Object.keys(secrets).length > 0) {
    const serviceRole = getCarbonServiceRole();
    const { error: vaultError } = await serviceRole.rpc(
      "upsert_integration_secret",
      {
        p_company_id: update.companyId,
        p_integration_id: update.id,
        p_secret: secrets as never
      }
    );
    if (vaultError) {
      logger.error("Failed to persist integration secret to vault", {
        error: vaultError,
        id: update.id
      });
      return { ...result, data: null, error: vaultError };
    }
  }

  await clearCompanyIntegrationCache(update.companyId);

  return result;
}

export async function upsertCustomField(
  client: SupabaseClient<Database>,
  customField:
    | (Omit<z.infer<typeof customFieldValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof customFieldValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  try {
    clearCustomFieldsCache();
  } finally {
    if ("createdBy" in customField) {
      const sortOrders = await client
        .from("customField")
        .select("sortOrder")
        .eq("table", customField.table);

      if (sortOrders.error) return sortOrders;
      const maxSortOrder = sortOrders.data.reduce((max, item) => {
        return Math.max(max, item.sortOrder);
      }, 0);

      return client
        .from("customField")
        .insert([{ ...customField, sortOrder: maxSortOrder + 1 }]);
    }
    return client
      .from("customField")
      .update(
        sanitize({
          ...customField,
          updatedBy: customField.updatedBy
        })
      )
      .eq("id", customField.id);
  }
}

export async function updateCustomFieldsSortOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  try {
    clearCustomFieldsCache();
  } finally {
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client.from("customField").update({ sortOrder, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
}

export type IntegrationHealthStatus =
  | "healthy"
  | "unhealthy"
  | "inactive"
  | "sync-off";

type IntegrationHealthFields = {
  health: IntegrationHealthStatus;
  /** Why an unhealthy check failed, when the integration says. */
  healthReason: string | null;
};

/**
 * Connection health, plus `sync-off` for an accounting integration whose
 * connection works but whose sync switch is off (a new connection still being
 * set up, or one switched off since). A broken connection still reads
 * `unhealthy` — that is the more urgent thing to show.
 */
export async function getIntegrationHealth(
  companyId: string,
  integration: Integration
): Promise<Integration & IntegrationHealthFields> {
  const result = await getConnectionHealth(companyId, integration);
  if (
    result.health === "healthy" &&
    (getIntegrationIdsByRole("accounting") as string[]).includes(
      integration.id ?? ""
    ) &&
    !isAccountingSyncEnabled(integration.metadata)
  ) {
    return { ...result, health: "sync-off" };
  }
  return result;
}

async function getConnectionHealth(
  companyId: string,
  integration: Integration
): Promise<
  Integration &
    IntegrationHealthFields & { health: "healthy" | "unhealthy" | "inactive" }
> {
  if (!integration.active) {
    return {
      ...integration,
      health: "inactive",
      healthReason: null
    };
  }

  const serverHooks = getIntegrationServerHooks(integration.id!);
  const config = getIntegrationConfigById(integration.id as IntegrationID);
  const healthcheck = serverHooks?.onHealthcheck ?? config?.onHealthcheck;

  if (!healthcheck) {
    return {
      ...integration,
      health: "healthy",
      healthReason: null
    };
  }

  const key = `integrations:${companyId}:${integration.id}:health`;

  const cached = await redis.get(key);

  // Only cache healthy status
  if (cached === "1") {
    return {
      ...integration,
      health: "healthy",
      healthReason: null
    };
  }

  // Resolve vaulted secrets back into the metadata before the healthcheck
  // builds its provider/client. Since the secret-vault refactor, credentials no
  // longer live in the plaintext `metadata` column, so an unresolved metadata
  // authenticates with nothing and every secret-bearing healthcheck (Rillet,
  // Xero, Email) would read "unhealthy". `resolveIntegrationSecrets` looks up
  // the row's `secretRef` itself (the `integrations` view doesn't expose it) and
  // throws when the secret can't be read — treat that as unhealthy rather than
  // crashing the whole settings page.
  let resolvedMetadata: Record<string, any>;
  try {
    resolvedMetadata = (await resolveIntegrationSecrets(
      getCarbonServiceRole(),
      companyId,
      integration.id!,
      (integration.metadata as Record<string, any>) ?? {}
    )) as Record<string, any>;
  } catch {
    return {
      ...integration,
      health: "unhealthy",
      healthReason: null
    };
  }

  const result = await (
    healthcheck as (
      companyId: string,
      metadata: Record<string, any>
    ) => Promise<boolean | IntegrationHealthcheckResult>
  )(companyId, resolvedMetadata);
  const healthy = typeof result === "boolean" ? result : result.healthy;
  const reason = typeof result === "boolean" ? null : (result.reason ?? null);

  await redis.set(key, healthy ? "1" : "0", "EX", INTEGRATION_CACHE_TTL * 5); // Cache for 5 hours

  return {
    ...integration,
    health: healthy ? "healthy" : "unhealthy",
    healthReason: healthy ? null : reason
  };
}

export async function getIntegrationsWithHealth(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const results = await client
    .from("integrations")
    .select("*")
    .eq("companyId", companyId);

  if (results.error) return results;

  const integrations = results.data;

  const withHealth = await Promise.all(
    integrations.map((i) => getIntegrationHealth(companyId, i))
  );

  return {
    data: withHealth,
    error: null
  };
}

export async function invalidateIntegrationHealthCache(
  integrationId: string,
  companyId: string
) {
  const key = `integrations:${companyId}:${integrationId}:health`;

  return await redis.del(key);
}

// Needs the service-role client for the Vault RPC.
export async function updateIntegrationMetadata(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string,
  metadata: any,
  updatedBy?: string
) {
  if (integrationId === "ramp") {
    try {
      const data = await patchRampSettings(getCarbonServiceRole(), companyId, {
        metadata: metadata as Record<string, unknown>,
        updatedBy
      });
      await clearCompanyIntegrationCache(companyId);
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Split secret material out to Supabase Vault; only the non-secret config is
  // written to the column. The row already exists (this is an update), so vault
  // FIRST (fail-closed: if the vault write fails, the plaintext is left intact
  // rather than stripped-and-lost), then write the stripped config.
  const { config, secrets } = splitSecrets(integrationId, metadata);

  if (Object.keys(secrets).length > 0) {
    const serviceRole = getCarbonServiceRole();
    const { error } = await serviceRole.rpc("upsert_integration_secret", {
      p_company_id: companyId,
      p_integration_id: integrationId,
      p_secret: secrets as never
    });
    if (error) {
      return { data: null, error };
    }
  }

  return client
    .from("companyIntegration")
    .update(
      sanitize({
        metadata: config as Json,
        updatedAt: new Date().toISOString(),
        updatedBy
      })
    )
    .eq("companyId", companyId)
    .eq("id", integrationId);
}

/**
 * Where a sync operation's `entityId` resolves to a human-readable document
 * number, per `entityType` (the keys of the accounting sync engine's
 * `ENTITY_DEFINITIONS`). `employee` and `inventoryAdjustment` are absent on
 * purpose: the first is a `user` id with no readable column of its own, the
 * second an `itemLedger` row with no document number at all.
 */
const SYNC_ENTITY_READABLE_ID_SOURCES: Record<
  string,
  { table: string; column: string }
> = {
  customer: { table: "customer", column: "name" },
  vendor: { table: "supplier", column: "name" },
  item: { table: "item", column: "readableId" },
  purchaseOrder: { table: "purchaseOrder", column: "purchaseOrderId" },
  bill: { table: "purchaseInvoice", column: "invoiceId" },
  salesOrder: { table: "salesOrder", column: "salesOrderId" },
  invoice: { table: "salesInvoice", column: "invoiceId" },
  payment: { table: "payment", column: "paymentId" },
  charge: { table: "charge", column: "chargeId" },
  reimbursement: { table: "reimbursement", column: "reimbursementId" },
  journalEntry: { table: "journal", column: "journalEntryId" },
  // One table, two entity types — the sweep splits `memo` by party.
  creditMemo: { table: "memo", column: "memoId" },
  supplierCredit: { table: "memo", column: "memoId" }
};

const JOURNAL_REVERSAL_SUFFIX = ":reversal";

const DAILY_CONSOLIDATION_PREFIX = "daily:";

/** The fields of a sync operation this resolver reads. */
type SyncOperationReference = {
  integration: string;
  entityType: string;
  entityId: string;
  direction: string;
};

/**
 * The lookup key, built identically here and in `SyncActivity`'s
 * `getEntityReference`.
 */
function syncOperationReadableIdKey(operation: {
  entityType: string;
  entityId: string;
}) {
  return `${operation.entityType}:${operation.entityId}`;
}

/**
 * A pulled operation is keyed by the PROVIDER's remote id, so it only
 * reaches a Carbon row through `externalIntegrationMapping`. One query for
 * the whole page, keyed back by `entityType:externalId`.
 */
async function getPulledEntityIds(
  client: SupabaseClient<Database>,
  companyId: string,
  operations: SyncOperationReference[]
): Promise<Map<string, string>> {
  const pulled = operations.filter(
    (operation) =>
      operation.direction === "pull-from-accounting" &&
      operation.entityType in SYNC_ENTITY_READABLE_ID_SOURCES
  );
  if (pulled.length === 0) return new Map();

  const { data, error } = await client
    .from("externalIntegrationMapping")
    .select("entityType, entityId, externalId")
    .eq("companyId", companyId)
    .in("integration", [
      ...new Set(pulled.map((operation) => operation.integration))
    ])
    .in("entityType", [
      ...new Set(pulled.map((operation) => operation.entityType))
    ])
    .in("externalId", [
      ...new Set(pulled.map((operation) => operation.entityId))
    ]);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [`${row.entityType}:${row.externalId}`, row.entityId])
  );
}

/**
 * Resolve one page of sync operations to the document numbers a human reads
 * — `PO000001` rather than `po_6UyRfXggN6YrmCSauBaVf1`. One query per entity
 * type on the page (plus one for pulled records' mappings), never one per
 * row.
 *
 * Silently incomplete by design, and the caller falls back to the raw id: a
 * pulled record that never landed a Carbon row has only the provider's
 * remote id, a pulled payment's id is a composite of two remote ids, and a
 * daily-consolidation journal marker backs no row at all.
 *
 * `recordId` is the CARBON row id — the same as `entityId` for a push, the
 * mapped id for a pull — so the table's link goes somewhere real instead of
 * to the provider's remote id.
 */
export async function getSyncOperationReadableIds(
  client: SupabaseClient<Database>,
  companyId: string,
  operations: SyncOperationReference[]
): Promise<Record<string, { label: string; recordId: string }>> {
  const pulledEntityIds = await getPulledEntityIds(
    client,
    companyId,
    operations
  );

  // entityType -> the ids to look up, mapped back to the operation keys they
  // came from (a journal reversal's id is the journal's id plus a suffix, so
  // one row can answer two keys).
  const byEntityType = new Map<string, Map<string, string[]>>();

  for (const operation of operations) {
    if (!(operation.entityType in SYNC_ENTITY_READABLE_ID_SOURCES)) continue;

    let lookupId =
      pulledEntityIds.get(syncOperationReadableIdKey(operation)) ??
      operation.entityId;

    if (operation.entityType === "journalEntry") {
      if (lookupId.startsWith(DAILY_CONSOLIDATION_PREFIX)) continue;
      if (lookupId.endsWith(JOURNAL_REVERSAL_SUFFIX)) {
        lookupId = lookupId.slice(0, -JOURNAL_REVERSAL_SUFFIX.length);
      }
    } else if (lookupId.includes(":")) {
      // A pulled payment's composite remote id — no Carbon row behind it.
      continue;
    }

    const ids = byEntityType.get(operation.entityType) ?? new Map();
    ids.set(lookupId, [
      ...(ids.get(lookupId) ?? []),
      syncOperationReadableIdKey(operation)
    ]);
    byEntityType.set(operation.entityType, ids);
  }

  if (byEntityType.size === 0) return {};

  const results = await Promise.all(
    Array.from(byEntityType.entries()).map(async ([entityType, ids]) => {
      const source = SYNC_ENTITY_READABLE_ID_SOURCES[entityType]!;
      // The table and column are chosen from the const map above, never from
      // request input — but they are values, so the select string can't be
      // typed. Cast, the same way the tie-out read in the route does.
      const { data, error } = (await (client.from(source.table as any) as any)
        .select(`id, ${source.column}`)
        .eq("companyId", companyId)
        .in("id", Array.from(ids.keys()))) as {
        data: { id: string }[] | null;
        error: unknown;
      };

      if (error || !data)
        return [] as [string, { label: string; recordId: string }][];

      return data.flatMap((row) => {
        const value = (row as Record<string, unknown>)[source.column];
        if (typeof value !== "string" || value.length === 0) return [];
        return (ids.get(row.id) ?? []).map(
          (key): [string, { label: string; recordId: string }] => [
            key,
            {
              label: key.endsWith(JOURNAL_REVERSAL_SUFFIX)
                ? `${value} (reversal)`
                : value,
              recordId: row.id
            }
          ]
        );
      });
    })
  );

  return Object.fromEntries(results.flat());
}

/** One provider analytics target with its selectable option values. */
export type DimensionTargetWithValues = {
  id: string;
  label: string;
  capacity: number;
  values: { id: string; name: string }[];
};

/**
 * Provider journal-dimension targets with their selectable values, for
 * the Dimensions tab and the slot-save validation. Guarded on the
 * provider actually implementing `journalDimensionTargets`; option values
 * come from the provider's list methods (Rillet Fields carry their values
 * inline; QBO Classes/Departments and Xero tracking options are the
 * target's own list). A provider API failure degrades to an empty target
 * list + `targetsError` so the settings drawer never blocks on a provider
 * outage.
 */
export async function getProviderDimensionTargets(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
): Promise<{
  supported: boolean;
  targets: DimensionTargetWithValues[];
  maxSlots: number | null;
  targetsError: boolean;
}> {
  const unsupported = {
    supported: false,
    targets: [],
    maxSlots: null,
    targetsError: false
  };

  const providerId = (Object.values(ProviderID) as string[]).includes(
    integrationId
  )
    ? (integrationId as ProviderID)
    : null;
  if (!providerId) return unsupported;

  try {
    const accountingIntegration = await getAccountingIntegration(
      client,
      companyId,
      providerId
    );
    const provider = getProviderIntegration(
      client,
      companyId,
      providerId,
      accountingIntegration.metadata
    );

    if (typeof provider.journalDimensionTargets !== "function") {
      return unsupported;
    }

    if (providerId === ProviderID.RILLET) {
      // One GET /fields serves both the targets and their values (calling
      // journalDimensionTargets() separately would hit the same endpoint
      // twice); target ids come from the engine's composite-id helper.
      const fields = await (provider as RilletProvider).listFields();
      return {
        supported: true,
        targets: fields.map((field) => ({
          id: buildRilletFieldTarget(field.id),
          label: field.name,
          capacity: 1,
          values: (field.values ?? [])
            .filter((value) => !value.deactivated)
            .map((value) => ({ id: value.id, name: value.name }))
        })),
        maxSlots:
          resolveCapabilities(provider.capabilities).maxJournalDimensionSlots ??
          null,
        targetsError: false
      };
    }

    if (providerId === ProviderID.QUICKBOOKS) {
      // journalDimensionTargets() probes the Intuit feature gates, so an
      // org without class/location tracking sees a reduced target list;
      // the values then load from the matching list method.
      const qbo = provider as QboProvider;
      const declared = await qbo.journalDimensionTargets();
      const targets: DimensionTargetWithValues[] = [];
      for (const target of declared) {
        const options =
          target.id === QBO_DIMENSION_TARGET_CLASS
            ? await qbo.listClasses()
            : target.id === QBO_DIMENSION_TARGET_DEPARTMENT
              ? await qbo.listDepartments()
              : [];
        targets.push({
          id: target.id,
          label: target.label,
          capacity: target.capacity ?? 1,
          values: options.map((option) => ({
            id: option.Id,
            name: option.Name
          }))
        });
      }
      return {
        supported: true,
        targets,
        maxSlots:
          resolveCapabilities(qbo.capabilities).maxJournalDimensionSlots ??
          null,
        targetsError: false
      };
    }

    // Xero: one target per active tracking category, options inline.
    const categories = await (
      provider as XeroProvider
    ).listTrackingCategories();
    return {
      supported: true,
      targets: categories.map((category) => ({
        id: buildXeroTrackingTarget(category.TrackingCategoryID),
        label: category.Name,
        capacity: 1,
        values: (category.Options ?? [])
          .filter(
            (option) =>
              option.Status === "ACTIVE" || option.Status === undefined
          )
          .map((option) => ({ id: option.TrackingOptionID, name: option.Name }))
      })),
      maxSlots: XERO_MAX_JOURNAL_DIMENSION_SLOTS,
      targetsError: false
    };
  } catch (err) {
    logger.error("Failed to load provider dimension targets", {
      companyId,
      integrationId,
      error: err
    });
    return { supported: true, targets: [], maxSlots: null, targetsError: true };
  }
}

// ─── Operations (`defineServiceFn`) ─────────────────────────────────────────
// What the routes, the API and MCP all run. A settings page has ONE update
// operation: it takes the page's fields, all optional, and writes the ones
// sent. An absent field keeps its stored value, so one form never blanks a
// neighbouring setting.

type CompanySettingsUpdate =
  Database["public"]["Tables"]["companySettings"]["Update"];

/** The fields the caller sent: an absent (undefined) one is left out. */
export function sentFields<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export function nothingSent(
  ctx: ServiceContext,
  input: object
): CarbonError | null {
  return Object.keys(sentFields(input)).length === 0
    ? ctx.error("validation", "Send at least one setting to change")
    : null;
}

/** Writes the sent fields to the company's settings row, as the caller. */
export async function saveCompanySettings(
  ctx: ServiceContext,
  fields: CompanySettingsUpdate,
  failure: string
): Promise<CarbonError | null> {
  const changes = sentFields(fields);
  if (Object.keys(changes).length === 0) return null;
  const { error } = await ctx.asCaller.supabase
    .from("companySettings")
    .update(changes)
    .eq("id", ctx.company.id);
  return error ? ctx.error("internal", failure, error) : null;
}

/** Multi-company management is open to internal (Carbon) users only, for now. */
export async function refuseUnlessInternalUser(
  ctx: ServiceContext
): Promise<CarbonError | null> {
  const refused = ctx.error(
    "forbidden",
    "Managing companies is not available to this account"
  );
  if (ctx.actor.type !== "user") return refused;
  const { data } = await ctx.asSystem.supabase
    .from("user")
    .select("email")
    .eq("id", ctx.actor.userId)
    .maybeSingle();
  return isInternalEmail(data?.email ?? "") ? null : refused;
}

/** The headquarters location and the creator's job at it: what a new company starts with. */
export async function createHeadquarters(
  ctx: ServiceContext,
  companyId: string,
  location: Omit<z.output<typeof companyValidator>, "baseCurrencyCode">
): Promise<CarbonError | null> {
  const client = ctx.asSystem.supabase;

  // Controlled environments (ITAR/CUI, NIST 800-171 3.3.1) capture audit from
  // day one: enable it at company creation, not just when settings are opened.
  if (CONTROLLED_ENVIRONMENT) {
    await enableAuditLog(client, companyId).catch((err) =>
      logger.error("Failed to enable audit log for new company", {
        companyId,
        error: err
      })
    );
  }

  const headquarters = await upsertLocation(client, {
    ...location,
    name: "Headquarters",
    companyId,
    // The timezone comes with the company's address: HQ shares it.
    createdBy: ctx.auditUserId
  });
  if (headquarters.error || !headquarters.data?.id) {
    return ctx.error(
      "internal",
      "Failed to create headquarters location",
      headquarters.error
    );
  }

  const [job] = await Promise.all([
    insertEmployeeJob(client, {
      id: ctx.auditUserId,
      companyId,
      locationId: headquarters.data.id
    }),
    redis.del(getPermissionCacheKey(ctx.auditUserId))
  ]);
  if (job.error) {
    return ctx.error(
      "internal",
      "Failed to create employee job record",
      job.error
    );
  }
  return null;
}

/** A one-label ZPL test page for the route's media size; null for a PDF route or no size. */
export function generateTestLabel(
  format: string,
  mediaSizeId: string | null
): string | null {
  if (format !== "zpl" || !mediaSizeId) return null;
  const labelSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!labelSize?.zpl) return null;
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;
  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);
  const now = new Date();
  const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  return [
    "^XA",
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    "^MNW",
    "^FO20,20^A0N,30,30^FDTest Print^FS",
    `^FO20,60^A0N,20,20^FD${mediaSizeId} — ${width}x${height}"^FS`,
    `^FO20,90^A0N,16,16^FD${timestamp}^FS`,
    "^XZ"
  ].join("\n");
}

/** An API key action on a company without the plan. */
export function apiKeysEntitlement(ctx: ServiceContext, err: unknown) {
  if (!(err instanceof EntitlementError)) throw err;
  return ctx.error("entitlement", "API keys require the Business plan");
}

/** The integration's stored metadata and its `settings` object, for a merge. */
export async function integrationSettings(
  ctx: ServiceContext,
  integrationId: string
) {
  const existing = await getIntegration(
    ctx.asCaller.supabase,
    integrationId,
    ctx.company.id
  );
  if (existing.error || !existing.data) return null;
  const metadata = (existing.data.metadata as Record<string, unknown>) ?? {};
  return {
    active: existing.data.active,
    metadata,
    settings: (metadata.settings as Record<string, unknown> | undefined) ?? {}
  };
}

/** Write an integration's merged metadata and drop its cached health. */
export async function saveIntegrationMetadata(
  ctx: ServiceContext,
  integrationId: string,
  active: boolean,
  metadata: Record<string, unknown>,
  failure: string
): Promise<CarbonError | null> {
  const update = await upsertCompanyIntegration(ctx.asCaller.supabase, {
    id: integrationId,
    active,
    metadata: metadata as Json,
    companyId: ctx.company.id,
    updatedBy: ctx.auditUserId
  });
  if (update.error) return ctx.error("internal", failure, update.error);
  await invalidateIntegrationHealthCache(integrationId, ctx.company.id);
  return null;
}
type Account = Pick<
  Database["public"]["Tables"]["account"]["Row"],
  | "id"
  | "name"
  | "companyGroupId"
  | "active"
  | "isGroup"
  | "class"
  | "incomeBalance"
  | "accountType"
  | "consolidatedRate"
  | "parentId"
>;

export function resolveShippingDefault({
  parentDefaultId,
  accounts,
  companyGroupId
}: {
  parentDefaultId: string | null;
  accounts: readonly Account[];
  companyGroupId: string;
}): string {
  const eligible = (account: Account) =>
    account.companyGroupId === companyGroupId &&
    account.active === true &&
    account.isGroup === false &&
    account.class === "Revenue" &&
    account.incomeBalance === "Income Statement";
  const mapped = accounts.find((account) => account.id === parentDefaultId);
  if (mapped && eligible(mapped)) return mapped.id;

  const byId = new Map(accounts.map((account) => [account.id, account]));
  const candidates = accounts.filter((account) => {
    const parent = account.parentId ? byId.get(account.parentId) : undefined;
    return (
      eligible(account) &&
      account.name === "Shipping Revenue" &&
      account.accountType === "Income" &&
      account.consolidatedRate === "Average" &&
      parent?.companyGroupId === companyGroupId &&
      parent.active === true &&
      parent.isGroup === true &&
      parent.class === "Revenue" &&
      parent.accountType === "Income" &&
      parent.incomeBalance === "Income Statement"
    );
  });
  if (candidates.length !== 1) {
    throw new Error(
      "A unique compatible Shipping Revenue default is required for this company group"
    );
  }
  return candidates[0]!.id;
}
const seedCompanyLogger = getLogger("erp", "seed-company");

export const seedCompanyInput = z.object({
  parentCompanyId: z.string().optional(),
  identityOnly: z.boolean().optional()
});

export const seedCompanyPermission = "system" satisfies PermissionRule<
  z.output<typeof seedCompanyInput>
>;

/** Seeds a new company's reference data, groups and admin link, in one transaction. */
export async function seedCompany(
  ctx: ServiceContext,
  raw: z.input<typeof seedCompanyInput>
) {
  const { parentCompanyId, identityOnly } = seedCompanyInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  seedCompanyLogger.info({
    companyId,
    userId,
    parentCompanyId,
    identityOnly: identityOnly === true
  });

  const company = await single(db, "company", { id: companyId });
  if (company.error) throw new Error(company.error.message);
  if (!company.data) throw new NotFoundError("Company not found");

  // Idempotency guard. The whole seed runs in a single transaction, so a
  // committed run has inserted `userToCompany(userId, companyId)`. A caller
  // that retries a seed which already committed would otherwise throw 23505
  // on the identity inserts. If the link already exists, the prior run
  // finished: no-op.
  const existingLink = await db
    .selectFrom("userToCompany")
    .select("userId")
    .where("userId", "=", userId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  if (existingLink) {
    return { success: true, alreadySeeded: true };
  }

  // Determine if this is a new root company or joining an existing group
  let companyGroupId = company.data.companyGroupId;
  const isNewGroup = !companyGroupId && !parentCompanyId;

  // If this is a subsidiary, get the parent's companyGroupId
  if (parentCompanyId && !companyGroupId) {
    const parent = await single(
      db,
      "company",
      { id: parentCompanyId },
      { columns: ["companyGroupId"] }
    );
    if (parent.error) throw new Error(parent.error.message);
    if (!parent.data?.companyGroupId)
      throw new Error("Parent company has no group");
    companyGroupId = parent.data.companyGroupId;
  }

  await db.transaction().execute(async (trx) => {
    // If no companyGroupId, create a new company group and assign it
    if (isNewGroup) {
      const companyGroupResult = await trx
        .insertInto("companyGroup")
        .values({
          name: company.data.name,
          createdBy: userId,
          ownerId: userId
        })
        .returning(["id"])
        .execute();

      companyGroupId = companyGroupResult[0]!.id;
      if (!companyGroupId) throw new Error("Failed to create company group");

      await trx
        .updateTable("company")
        .set({ companyGroupId })
        .where("id", "=", companyId)
        .execute();
    }

    // For subsidiaries, companyGroupId + parentCompanyId are set LATER (just
    // before the elimination-entity block), not here. Setting companyGroupId
    // fires the `company_sync_ic_partners` trigger, which inserts an
    // intercompany supplier/customer row in this company for each sibling. Those
    // inserts rely on the `set_{supplier,customer}_readable_id_on_insert`
    // triggers to stamp a readableId from the company's sequence — and the
    // sequences aren't seeded until the reference-data block below. Firing the
    // trigger here left every intercompany row with readableId '' (the auto-fill
    // no-ops when no sequence row exists yet). Since
    // `supplier_readableId_companyId_unique` treats '' as a real value, only the
    // FIRST sibling's row survived; every later sibling collided on
    // (companyId, '') and was silently dropped by ON CONFLICT DO NOTHING — so a
    // company created into a group of 3+ only ever saw one sibling.

    // The generated types cover the public schema only.
    await (
      trx.withSchema("storage") as unknown as Kysely<{
        buckets: { id: string; name: string; public: boolean };
      }>
    )
      .insertInto("buckets")
      .values({
        id: companyId,
        name: companyId,
        public: false
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await trx
      .insertInto("userToCompany")
      .values([{ userId, companyId, role: "employee" }])
      .execute();

    // high-order groups — identity infrastructure: the employeeType insert
    // below fires a trigger that creates a membership row referencing these,
    // so they must exist even in identity-only mode. (The onboarding import
    // skips `group` so the template doesn't duplicate them.)
    await trx
      .insertInto("group")
      .values(
        groups.map(({ idPrefix, ...g }) => ({
          ...g,
          id: getGroupId(idPrefix, companyId),
          companyId
        }))
      )
      .execute();

    const employeeTypes = await trx
      .insertInto("employeeType")
      .values([
        {
          name: "Admin",
          companyId,
          protected: true,
          systemType: "Admin" as const
        }
      ])
      .returning(["id"])
      .execute();

    const employeeTypeId = employeeTypes[0]!.id;
    if (!employeeTypeId)
      throw new Error("Failed to insert admin employee type");

    // get the modules
    const modules = (await trx
      .selectFrom("modules")
      .select("name")
      .execute()) as { name: string }[];

    // create employee type permissions for admin
    const employeeTypePermissions = modules.reduce<
      Database["public"]["Tables"]["employeeTypePermission"]["Insert"][]
    >((acc, module) => {
      if (module.name) {
        acc.push({
          employeeTypeId: employeeTypeId,
          // @ts-expect-error - it's legit, chill typescript
          module: module.name,
          create: [companyId],
          update: [companyId],
          delete: [companyId],
          view: [companyId]
        });
      }
      return acc;
    }, []);

    // insert employee type permissions
    await trx
      .insertInto("employeeTypePermission")
      .values(employeeTypePermissions)
      .execute();

    // insert employee
    await trx
      .insertInto("employee")
      .values([
        {
          id: String(userId),
          employeeTypeId,
          companyId,
          active: true
        }
      ])
      .execute();

    // Reference + accounting data (customer statuses, UoMs, sequences,
    // chart of accounts, …). Skipped in identity-only mode — a company
    // backup carries all of this, so onboarding-from-a-backup seeds only
    // the identity layer above and lets the import provide the rest.
    if (!identityOnly) {
      // customer status
      await trx
        .insertInto("customerStatus")
        .values(
          customerStatuses.map((name) => ({
            name,
            companyId,
            createdBy: "system"
          }))
        )
        .execute();

      // scrap reason codes
      await trx
        .insertInto("scrapReason")
        .values(
          scrapReasons.map((name) => ({
            name,
            companyId,
            createdBy: "system"
          }))
        )
        .execute();

      // return reason codes (shared by customer RMAs and supplier returns)
      await trx
        .insertInto("returnReason")
        .values(
          returnReasons.map((name) => ({
            name,
            inventoryValueZero: false,
            companyId,
            createdBy: "system"
          }))
        )
        .execute();

      // payment terms
      await trx
        .insertInto("paymentTerm")
        .values(paymentTerms.map((pt) => ({ ...pt, companyId })))
        .execute();

      await trx
        .insertInto("unitOfMeasure")
        .values(unitOfMeasures.map((uom) => ({ ...uom, companyId })))
        .execute();

      await trx
        .insertInto("gaugeType")
        .values(
          gaugeTypes.map((gt) => ({
            name: gt,
            companyId,
            createdBy: "system"
          }))
        )
        .execute();

      await trx
        .insertInto("maintenanceFailureMode")
        .values(
          failureModes.map((name) => ({
            name,
            companyId,
            createdBy: "system"
          }))
        )
        .execute();

      await trx
        .insertInto("nonConformanceType")
        .values(nonConformanceTypes.map((nc) => ({ ...nc, companyId })))
        .execute();

      await trx
        .insertInto("nonConformanceRequiredAction")
        .values(
          nonConformanceRequiredActions.map((nc) => ({ ...nc, companyId }))
        )
        .execute();

      // change-order default types (the changeOrderType lookup). New on this
      // branch and not yet in the cloud-generated Kysely types, so the insert
      // goes through a cast (mirrors changeOrderRequiredAction below).
      await (trx as any)
        .insertInto("changeOrderType")
        .values(changeOrderTypes.map((ct) => ({ ...ct, companyId })))
        .execute();

      // change-order default actions (system template rows). New on this branch
      // and not yet in the cloud-generated Kysely types, so the insert goes
      // through a cast (mirrors periodCloseTaskDefinition below).
      await (trx as any)
        .insertInto("changeOrderRequiredAction")
        .values(changeOrderRequiredActions.map((ca) => ({ ...ca, companyId })))
        .execute();

      await trx
        .insertInto("sequence")
        .values(sequences.map((s) => ({ ...s, companyId })))
        .execute();

      // period-close checklist definitions (system template rows). The table is
      // new on this branch and not yet in the cloud-generated Kysely types, so
      // the insert goes through a cast (mirrors accounting.service.ts).
      await (trx as any)
        .insertInto("periodCloseTaskDefinition")
        .values(
          periodCloseTaskDefinitions.map((d) => ({
            ...d,
            companyId,
            createdBy: "system"
          }))
        )
        .execute();

      // Shared tables: only seed for new groups (existing groups already have these)
      let accountIdByKey: Record<string, string> = {};
      let siblingDefaults:
        | Selectable<KyselyDatabase["accountDefault"]>
        | undefined;
      let siblingAssetClasses: Selectable<KyselyDatabase["fixedAssetClass"]>[] =
        [];
      if (isNewGroup) {
        await trx
          .insertInto("currency")
          .values(
            currencies.map((c) => ({ ...c, companyGroupId: companyGroupId! }))
          )
          .execute();

        // Insert accounts in order, resolving parentKey to parentId
        for (const { key, parentKey, ...acc } of accounts) {
          const result = await trx
            .insertInto("account")
            .values({
              ...acc,
              companyGroupId: companyGroupId!,
              parentId: parentKey ? (accountIdByKey[parentKey] ?? null) : null
            })
            .returning(["id"])
            .execute();
          if (result[0]?.id) {
            accountIdByKey[key] = result[0].id;
          }
        }

        await trx
          .insertInto("dimension")
          .values(
            dimensions.map((d) => ({
              name: d.name,
              entityType: d.entityType,
              companyGroupId: companyGroupId!,
              createdBy: userId
            }))
          )
          .execute();
      } else {
        // A subsidiary joining an existing group copies the account ids of a
        // company already in it. Its chart may have been imported, so the
        // seeded numbers below are only the fallback for a group with none.
        const sibling = await trx
          .selectFrom("accountDefault")
          .innerJoin("company", "company.id", "accountDefault.companyId")
          .selectAll("accountDefault")
          .where("company.companyGroupId", "=", companyGroupId!)
          .where("accountDefault.companyId", "!=", companyId)
          .orderBy(
            sql`"accountDefault"."companyId" = ${parentCompanyId ?? ""}`,
            "desc"
          )
          .orderBy("accountDefault.companyId")
          .executeTakeFirst();
        if (sibling) {
          siblingDefaults = sibling;
          siblingAssetClasses = await trx
            .selectFrom("fixedAssetClass")
            .selectAll()
            .where("companyId", "=", sibling.companyId)
            .execute();
        } else {
          const existingAccounts = await trx
            .selectFrom("account")
            .select([
              "id",
              "number",
              "name",
              "companyGroupId",
              "active",
              "isGroup",
              "class",
              "incomeBalance",
              "accountType",
              "consolidatedRate",
              "parentId"
            ])
            .where("companyGroupId", "=", companyGroupId!)
            .execute();
          for (const acc of existingAccounts) {
            if (acc.number) {
              accountIdByKey[acc.number] = acc.id;
            }
          }
          accountIdByKey["4050"] = resolveShippingDefault({
            parentDefaultId: null,
            accounts: existingAccounts.filter(
              (account) => account.id !== accountIdByKey["4010"]
            ),
            companyGroupId: companyGroupId!
          });
        }
      }

      // Resolve account numbers to IDs for account defaults
      const resolvedDefaults: Record<string, string | null> = {};
      for (const [key, number] of Object.entries(accountDefaults)) {
        resolvedDefaults[key] = accountIdByKey[number] ?? null;
      }
      // A sibling's defaults are copied exactly, empty ones included: after
      // a chart import the seeded numbers may name unrelated accounts.
      if (siblingDefaults) {
        for (const column of ACCOUNT_DEFAULT_COLUMNS) {
          resolvedDefaults[column] =
            (siblingDefaults[column] as string | null) ?? null;
        }
      }

      // These defaults are NOT NULL in the schema. If a customized COA
      // on an existing group is missing one of their accounts
      // (6050/4130/4120/7060/1150/1210/1220), the lookup yields null and the
      // insert below would violate the not-null constraint. Fall back to an
      // existing default of the same nature so the insert can't fail — mirrors
      // the COALESCE backfills in 20260630093809_ar-ap-payments.sql,
      // 20260711155312_supplier-prepayment-account.sql, and
      // 20260713190909_raw-materials-finished-goods-accounts.sql.
      // Order matters: rawMaterialsAccount resolves before finishedGoodsAccount
      // chains onto it.
      const arApDefaultFallbacks: Record<string, string> = {
        customerWriteOffAccount: "salesDiscountAccount",
        supplierWriteOffAccount: "salesAccount",
        realizedExchangeGainAccount: "salesAccount",
        realizedExchangeLossAccount: "interestAccount",
        assetGainOnDisposalAccount: "assetLossOnDisposalAccount",
        supplierPrepaymentAccount: "receivablesAccount",
        rawMaterialsAccount: "workInProgressAccount",
        finishedGoodsAccount: "rawMaterialsAccount"
      };
      for (const [key, fallbackKey] of Object.entries(arApDefaultFallbacks)) {
        if (!resolvedDefaults[key]) {
          resolvedDefaults[key] = resolvedDefaults[fallbackKey] ?? null;
        }
      }

      // Company-specific accounting defaults and posting groups
      await trx
        .insertInto("accountDefault")
        .values([
          {
            ...resolvedDefaults,
            companyId
          } as Insertable<KyselyDatabase["accountDefault"]>
        ])
        .execute();

      await trx
        .insertInto("fiscalYearSettings")
        .values([{ ...fiscalYearSettings, companyId }])
        .execute();

      // A new company stays Provisional until the activation wizard sets
      // its cutover, so the chart can be imported before anything is
      // Posted (.ai/specs/2026-10-12-chart-of-accounts-import.md).

      // A subsidiary copies the group's fixed asset classes from a sibling,
      // every setting included; a new group seeds them by account number.
      const classRows = siblingDefaults
        ? siblingAssetClasses.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...fac
            }) => ({ ...fac, companyId, createdBy: userId })
          )
        : fixedAssetClasses.map((fac) => ({
            name: fac.name,
            depreciationMethod: fac.depreciationMethod,
            usefulLifeMonths: fac.usefulLifeMonths,
            residualValuePercent: fac.residualValuePercent,
            assetAccountId: accountIdByKey[fac.assetAccount]!,
            accumulatedDepreciationAccountId:
              accountIdByKey[fac.accumulatedDepreciationAccount]!,
            depreciationExpenseAccountId:
              accountIdByKey[fac.depreciationExpenseAccount]!,
            writeOffAccountId: accountIdByKey[fac.writeOffAccount]!,
            writeDownAccountId: accountIdByKey[fac.writeDownAccount]!,
            gainOnDisposalAccountId: accountIdByKey[fac.gainOnDisposalAccount]!,
            lossOnDisposalAccountId: accountIdByKey[fac.lossOnDisposalAccount]!,
            isConstructionInProgress: fac.isConstructionInProgress,
            companyId,
            createdBy: userId
          }));
      if (classRows.length > 0) {
        await trx.insertInto("fixedAssetClass").values(classRows).execute();
      }
    } // end if (!identityOnly)

    const user = await single(
      trx,
      "userPermission",
      { id: userId },
      { columns: ["permissions"] }
    );
    if (user.error) throw new Error(user.error.message);

    const currentPermissions = (user.data?.permissions ?? {}) as Record<
      string,
      string[]
    >;
    const newPermissions = { ...currentPermissions };
    modules.forEach(({ name }) => {
      const module = name?.toLowerCase();
      if (`${module}_view` in newPermissions) {
        newPermissions[`${module}_view`]!.push(companyId);
      } else {
        newPermissions[`${module}_view`] = [companyId];
      }

      if (`${module}_create` in newPermissions) {
        newPermissions[`${module}_create`]!.push(companyId);
      } else {
        newPermissions[`${module}_create`] = [companyId];
      }

      if (`${module}_update` in newPermissions) {
        newPermissions[`${module}_update`]!.push(companyId);
      } else {
        newPermissions[`${module}_update`] = [companyId];
      }

      if (`${module}_delete` in newPermissions) {
        newPermissions[`${module}_delete`]!.push(companyId);
      } else {
        newPermissions[`${module}_delete`] = [companyId];
      }
    });

    const { error } = await updateRows(
      trx,
      "userPermission",
      { permissions: newPermissions },
      { id: userId }
    );
    if (error) throw new Error(error.message);

    // For subsidiaries: set companyGroupId + parentCompanyId now that the
    // reference data (including the supplier/customer sequences) has been
    // seeded. This is what fires `company_sync_ic_partners`; running it here
    // guarantees the readableId auto-fill triggers can stamp a real id on every
    // intercompany partner row, so no two siblings collide on (companyId, '').
    if (parentCompanyId) {
      await trx
        .updateTable("company")
        .set({ companyGroupId, parentCompanyId })
        .where("id", "=", companyId)
        .execute();
    }

    // Auto-create elimination entity if this is a subsidiary
    if (parentCompanyId && companyGroupId) {
      const siblings = await trx
        .selectFrom("company")
        .select(["id", "isEliminationEntity"])
        .where("companyGroupId", "=", companyGroupId)
        .where("parentCompanyId", "=", parentCompanyId)
        .execute();

      const hasElimination = siblings.some((s) => s.isEliminationEntity);

      if (!hasElimination) {
        const parent = await trx
          .selectFrom("company")
          .select(["name", "baseCurrencyCode", "countryCode"])
          .where("id", "=", parentCompanyId)
          .executeTakeFirst();

        const eliminationCompany = await trx
          .insertInto("company")
          .values({
            name: `Elimination - ${parent?.name ?? "Unknown"}`,
            addressLine1: "",
            city: "",
            stateProvince: "",
            postalCode: "",
            baseCurrencyCode:
              parent?.baseCurrencyCode ?? company.data.baseCurrencyCode,
            countryCode: parent?.countryCode ?? company.data.countryCode ?? "",
            parentCompanyId,
            isEliminationEntity: true,
            companyGroupId
          })
          .returning(["id"])
          .executeTakeFirst();

        // Seed sequences for the elimination entity. It is otherwise a bare
        // consolidation shell, but generateEliminationEntries posts an
        // elimination journal on it and stamps journalEntryId from
        // get_next_sequence('journalEntry', <elim>) — without its own
        // sequence rows that raises "Sequence not found".
        if (eliminationCompany?.id) {
          await trx
            .insertInto("sequence")
            .values(
              sequences.map((s) => ({
                ...s,
                companyId: eliminationCompany.id
              }))
            )
            .execute();
        }
      }
    }
  });

  return { success: true };
}
