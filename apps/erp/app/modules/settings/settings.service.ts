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
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  SUPABASE_INTERNAL_URL,
  SUPABASE_URL,
  VERCEL_URL
} from "@carbon/auth";
import { bustApiKeyCache } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import type { Database, Json } from "@carbon/database";
import { activeJobStatuses, getCompanyTimeZone } from "@carbon/database";
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
import {
  getPullFromLocations,
  missingPullFromLocations,
  PULLED_ITEM_TYPES
} from "@carbon/database/strict-backflush";
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
import type {
  DescriptionModes,
  ItemEdit,
  ItemFieldSnapshot,
  MappedRowPlan,
  OnshapeBomNode,
  OnshapePushDefaults,
  OwnedFieldChange,
  PartPlan,
  PartPlanRow,
  PlanCustomField,
  PlanCustomFieldDefinition,
  PlanItemRow,
  PropertyMapEntry,
  ProposedItem,
  ReleasePlanItem,
  StandardFieldWriter
} from "@carbon/ee";
import {
  integrations as availableIntegrations,
  bomLineItemType,
  CUSTOM_FIELD_TYPE_LABELS,
  changeNoticeDescriptionJson,
  createdItemExtras,
  defaultUnitOfMeasureCode,
  externalIdForAssembly,
  externalIdForBomLine,
  externalIdForPart,
  flattenNodes,
  getIntegrationConfigById,
  getIntegrationIdsByRole,
  type IntegrationHealthcheckResult,
  type IntegrationID,
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  isModelReleaseItem,
  MAPPABLE_VALUE_TYPES,
  MAPPING_MODES,
  mappedFieldValues,
  mergeChangeNoticeEdit,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  mergeExistingItemEdits,
  normalizeConfiguration,
  pickAdoptTarget,
  pickBomChildRow,
  pickReuseRow,
  pickRevisionBase,
  proposeItem,
  reconcilePushDefaults,
  releaseBomKey,
  resolveIntegrationSecrets,
  STANDARD_FIELD_IDS,
  splitSecrets,
  standardField,
  targetKey,
  translationErrors
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
import type {
  DraftCandidate,
  ManualLineRow,
  MappedLineRow,
  ReleaseExportSelection,
  StoredReleasePlan
} from "@carbon/ee/onshape";
import {
  chunkFilterValues,
  DRAFT_MARKER_ENTITY_TYPE,
  exchangeOnshapeAuthorizationCode,
  getConflictingOnshapeIntegration,
  isOnshapeIntegrationId,
  loadActiveMakeMethods,
  loadMethodLineOwnership,
  loadPartCustomFieldDefinitions,
  loadPlanOptions,
  loadReusableDrafts,
  ONSHAPE_OAUTH_SCOPES,
  type OnshapeOAuthIntegrationId,
  pairOwnedCopiedLines,
  peekPanelPlan,
  releaseExportSelection,
  selectInBatches,
  takePanelPlan
} from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import {
  isOnshapeOAuthIntegrationId,
  loadOnshapeOAuthConfig,
  patchOnshapeOAuthGrant,
  patchOnshapeSettings
} from "@carbon/ee/onshape.server";
import { isIntegrationComingSoon } from "@carbon/ee/plan";
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
  searchFilter
} from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { type Insertable, type Selectable, sql } from "kysely";
import { nanoid } from "nanoid";
import { data } from "react-router";
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
import { canEditChangeNoticeEngineering } from "~/modules/items/items.models";
import {
  cascadeItemTrackingType,
  copyMakeMethod,
  createRevision,
  deleteChangeNotice,
  deleteItem,
  type getItem,
  getLockVerdict,
  insertChangeNotice,
  type ReleaseControl,
  requireChangeNoticeEditable,
  updateDefaultRevision,
  updateItemMethodAndSourcing,
  upsertMakeMethodVersion,
  upsertPart
} from "~/modules/items/items.service";
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
import type {
  Integration,
  JobMissingStorageUnit,
  MethodMissingPullFrom
} from "~/modules/settings/types";
import { oAuthCallbackSchema } from "~/modules/shared/shared.models";
import * as sharedService from "~/modules/shared/shared.service";
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
import type { OAuthPopupOutcome, OAuthPopupResult } from "./oauth-popup";
import { OAUTH_POPUP_MESSAGE } from "./oauth-popup";
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

const integrationInstallLogger = getLogger("erp", "settings", "integrations");

/**
 * Whether a new install is refused: an `internalOnly` integration this user
 * sees as "Coming soon" (`isIntegrationComingSoon`), in a company that does not
 * have it installed. A failed read refuses.
 */
export async function isIntegrationInstallWithheld(
  client: SupabaseClient<Database>,
  {
    companyId,
    integrationId,
    email
  }: { companyId: string; integrationId: string; email: string }
): Promise<boolean> {
  const integration = availableIntegrations.find((i) => i.id === integrationId);
  if (
    !integration ||
    !isIntegrationComingSoon(integration, { edition: CarbonEdition, email })
  ) {
    return false;
  }

  const existing = await getIntegration(client, integrationId, companyId);
  if (existing.error) {
    integrationInstallLogger.error("Failed to read the integration install", {
      companyId,
      integrationId,
      error: existing.error
    });
    return true;
  }
  return existing.data?.active !== true;
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
    query = query.or(searchFilter(["itemReadableId", "itemName"], args.search));
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

/** Only the company fields: `updateSubsidiaryDetails` gates it and drops the cached time zone. */
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

  // The Onshape rows are shared with the token refresh, the OAuth callback and
  // the panel's property map, so a settings save patches only its own keys.
  if (isOnshapeOAuthIntegrationId(update.id)) {
    try {
      const data = await patchOnshapeSettings(
        getCarbonServiceRole(),
        update.companyId,
        update.id,
        {
          metadata: update.metadata as Record<string, unknown>,
          active: update.active,
          updatedBy: update.updatedBy
        }
      );
      await clearCompanyIntegrationCache(update.companyId);
      return { data, error: null };
    } catch (error) {
      logger.error("Failed to patch Onshape settings", {
        error,
        companyId: update.companyId,
        integrationId: update.id
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

  if (isOnshapeOAuthIntegrationId(integrationId)) {
    try {
      const data = await patchOnshapeSettings(
        getCarbonServiceRole(),
        companyId,
        integrationId,
        { metadata: metadata as Record<string, unknown>, updatedBy }
      );
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
/**
 * OAuth callback page: posts the outcome to the popup's opener and closes, or
 * goes to `fallbackUrl` when there is no opener (popup blocked, callback opened
 * directly). Only Carbon-authored values reach the page, never provider text.
 */
export function oauthPopupResponse(
  outcome: OAuthPopupOutcome,
  fallbackUrl: string
) {
  const message: OAuthPopupResult = { type: OAUTH_POPUP_MESSAGE, ...outcome };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Carbon</title>
</head>
<body>
<script>
(function () {
  var message = ${embed(message)};
  var fallback = ${embed(fallbackUrl)};
  var opener = window.opener;
  var delivered = false;
  try {
    if (opener && !opener.closed) {
      opener.postMessage(message, window.location.origin);
      delivered = true;
    }
  } catch (_) {}
  if (delivered) {
    window.close();
  }
  // Still here: no opener, or the browser refused to close the window. Land
  // where a plain redirect would have.
  window.setTimeout(function () {
    window.location.replace(fallback);
  }, delivered ? 500 : 0);
})();
</script>
<noscript><a href="${escapeAttribute(fallbackUrl)}">Continue</a></noscript>
</body>
</html>
`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

/** JSON that is safe inside a <script> element. */
function embed(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type ItemRevisionStatus = Database["public"]["Enums"]["itemRevisionStatus"];
const onshapeDraftMethodLogger = getLogger("erp", "onshape", "draft-method");

/**
 * Why the assembly push must not write a parent's BOM, per item id. A Draft a
 * change notice holds is the notice's to change, whatever its stage. A
 * released (Production) revision follows `plmReleaseControl` through
 * `getLockVerdict`, as the BOM editor's `checkRevisionLock` does: `enforce`
 * refuses, `warn` and `off` write. Two reads in all, not one per method.
 */
export async function loadMethodWriteRefusals(
  client: Client,
  companyId: string,
  targets: Array<{
    itemId: string;
    method: { changeOrderId?: string | null };
    revisionStatus: ItemRevisionStatus | null | undefined;
  }>
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  const changeOrderIds = [
    ...new Set(
      targets
        .map((target) => target.method.changeOrderId)
        .filter((id): id is string => !!id)
    )
  ];
  const anyProduction = targets.some(
    (target) =>
      !target.method.changeOrderId && target.revisionStatus === "Production"
  );
  const [notices, settings] = await Promise.all([
    selectInBatches(changeOrderIds, (batch) =>
      client
        .from("changeOrder")
        .select("id, changeOrderId")
        .eq("companyId", companyId)
        .in("id", batch)
    ),
    anyProduction ? getCompanySettings(client, companyId) : null
  ]);
  // The notice's number is for the message only; the refusal stands without it.
  const noticeNumber = new Map(
    (notices.data ?? []).map((notice) => [notice.id, notice.changeOrderId])
  );
  const releaseControl = (settings?.data?.plmReleaseControl ??
    "enforce") as ReleaseControl;
  for (const target of targets) {
    const changeOrderId = target.method.changeOrderId;
    if (changeOrderId) {
      const number = noticeNumber.get(changeOrderId);
      reasons.set(
        target.itemId,
        `its make method is a Draft on ${number ? `change notice ${number}` : "a change notice"}. Change the BOM there.`
      );
      continue;
    }
    const verdict = getLockVerdict({
      isLocked: target.revisionStatus === "Production",
      releaseControl
    });
    if (!verdict.ok) reasons.set(target.itemId, verdict.message);
  }
  return reasons;
}

/**
 * The Draft a push writes into when the item's method is Active: the one this
 * integration made from that method (`pickReusableDraft`), else a new copy. The
 * reusable marker is written last; a failure before it deletes the new Draft.
 */
export async function ensureDraftMakeMethod(
  client: Client,
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    activeMethodId: string;
    companyId: string;
    userId: string;
    /** Preloaded with `loadReusableDrafts`; null when none, omitted to read it here. */
    reusableDraft?: DraftCandidate | null;
  }
): Promise<
  | { ok: true; id: string; created: boolean; version: number | null }
  | { ok: false; error: string }
> {
  const { itemId, activeMethodId, companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();

  let existing = args.reusableDraft;
  if (existing === undefined) {
    try {
      const reusable = await loadReusableDrafts(
        client,
        serviceRole,
        companyId,
        new Map([[itemId, activeMethodId]])
      );
      existing = reusable.get(itemId) ?? null;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "could not read Drafts"
      };
    }
  }
  if (existing) {
    return {
      ok: true,
      id: existing.id,
      created: false,
      version: existing.version
    };
  }

  // max(version) + 1, not Active + 1: parallel Drafts collide on (itemId, version).
  const highest = await client
    .from("makeMethod")
    .select("version")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (highest.error) {
    return { ok: false, error: highest.error.message };
  }
  const version = (highest.data?.version ?? 0) + 1;

  const draft = await upsertMakeMethodVersion(client, {
    copyFromId: activeMethodId,
    // No `activeVersionId`: it sets a version Active, and the push leaves live methods alone.
    version,
    companyId,
    createdBy: userId
  });
  if (draft.error || !draft.data?.id) {
    return {
      ok: false,
      error: draft.error?.message ?? "could not create a draft version"
    };
  }
  const draftId = draft.data.id;

  // `upsertMakeMethodVersion` copies only the method row; the BOM and routing come here.
  const copied = await copyMakeMethod(client, db, {
    sourceId: activeMethodId,
    targetId: draftId,
    companyId,
    userId,
    billOfMaterial: true,
    billOfProcess: true,
    parameters: true,
    tools: true,
    steps: true,
    workInstructions: true
  });
  const failure = copied.error
    ? `its method could not be copied (${copied.error.message})`
    : await carryLineOwnership(client, serviceRole, {
        sourceMethodId: activeMethodId,
        targetMethodId: draftId,
        companyId,
        userId
      });
  const marked = failure
    ? null
    : await client.from("externalIntegrationMapping").insert({
        entityType: DRAFT_MARKER_ENTITY_TYPE,
        entityId: draftId,
        integration: ONSHAPE_V2_INTEGRATION_ID,
        // Not the source id: two Drafts of one method would collide on the unique index.
        externalId: draftId,
        metadata: { sourceMethodId: activeMethodId, itemId } as Json,
        lastSyncedAt: datetime.timestamp(),
        companyId,
        createdBy: userId
      });
  const problem =
    failure ??
    (marked?.error
      ? `it could not be marked as Onshape's (${marked.error.message})`
      : null);
  if (!problem) {
    return { ok: true, id: draftId, created: true, version };
  }

  // A half-built Draft, released, would ship without what failed to copy. Service
  // role: line mappings have no user DELETE policy. The lines cascade.
  const discarded = await discardDraft(serviceRole, {
    draftId,
    companyId
  });
  return {
    ok: false,
    error: discarded
      ? `a draft version was created but ${problem}, so it was removed; push again`
      : `a draft version was created but ${problem}, and it could not be removed — delete version ${version} before pushing again`
  };
}

async function discardDraft(
  serviceRole: Client,
  args: { draftId: string; companyId: string }
): Promise<boolean> {
  const { draftId, companyId } = args;
  const mappings = await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "methodMaterial")
    .eq("metadata->>makeMethodId", draftId);
  const removed = await serviceRole
    .from("makeMethod")
    .delete()
    .eq("id", draftId)
    .eq("companyId", companyId);
  const error = mappings.error ?? removed.error;
  if (error) {
    onshapeDraftMethodLogger.error(
      "Failed to discard a half-built Onshape Draft",
      {
        companyId,
        draftId,
        error
      }
    );
    return false;
  }
  return true;
}

/**
 * Copy this integration's line mappings onto the copied lines: ownership is
 * keyed on line id, and unmapped copies would read as manual and be duplicated.
 */
async function carryLineOwnership(
  client: Client,
  serviceRole: Client,
  args: {
    sourceMethodId: string;
    targetMethodId: string;
    companyId: string;
    userId: string;
  }
): Promise<string | null> {
  const { sourceMethodId, targetMethodId, companyId, userId } = args;

  const mappings = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata, lastSyncedAt")
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "methodMaterial")
    .eq("metadata->>makeMethodId", sourceMethodId);
  if (mappings.error) return mappings.error.message;
  if ((mappings.data ?? []).length === 0) return null;

  const [sourceLines, targetLines] = await Promise.all([
    client
      .from("methodMaterial")
      .select("id, itemId, order, quantity")
      .eq("makeMethodId", sourceMethodId)
      .eq("companyId", companyId),
    client
      .from("methodMaterial")
      .select("id, itemId, order")
      .eq("makeMethodId", targetMethodId)
      .eq("companyId", companyId)
  ]);
  if (sourceLines.error) return sourceLines.error.message;
  if (targetLines.error) return targetLines.error.message;

  const owned = new Set((mappings.data ?? []).map((row) => row.entityId));
  const paired = pairOwnedCopiedLines(
    sourceLines.data ?? [],
    targetLines.data ?? [],
    owned
  );

  const inserts = [];
  for (const mapping of mappings.data ?? []) {
    const targetLineId = paired.get(mapping.entityId);
    // Unpaired: left unmapped, so it reads as manual and is kept, not duplicated.
    if (!targetLineId) continue;
    const metadata = {
      ...((mapping.metadata as Record<string, unknown> | null) ?? {}),
      makeMethodId: targetMethodId
    };
    inserts.push({
      entityType: "methodMaterial",
      entityId: targetLineId,
      integration: ONSHAPE_V2_INTEGRATION_ID,
      externalId: mapping.externalId,
      metadata: metadata as Json,
      lastSyncedAt: mapping.lastSyncedAt,
      companyId,
      createdBy: userId
    });
  }
  if (inserts.length === 0) return null;

  const written = await client
    .from("externalIntegrationMapping")
    .insert(inserts);
  if (written.error) {
    return `${inserts.length} of its lines could not be linked to Onshape (${written.error.message})`;
  }
  return null;
}

type MethodMaterialInsert =
  Database["public"]["Tables"]["methodMaterial"]["Insert"];

export type OwnedMethodLine = {
  row: Omit<MethodMaterialInsert, "companyId" | "createdBy">;
  /** Ownership row metadata; `makeMethodId` names the line's method. */
  metadata: Record<string, unknown>;
};
const onshapePushLogger = getLogger("erp", "onshape", "push");

/**
 * Replace an item's Onshape link in one transaction: delete any row for this
 * item or this externalId, then insert. Both unique indexes need the deletes first.
 */
export async function swapItemMapping(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    itemId: string;
    externalId: string;
    metadata: Record<string, unknown>;
  }
): Promise<{ id: string; error: null } | { id: null; error: string }> {
  const { companyId, userId, itemId, externalId } = args;
  const now = datetime.timestamp();
  try {
    const inserted = await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("externalIntegrationMapping")
        .where("companyId", "=", companyId)
        .where("integration", "=", ONSHAPE_V2_INTEGRATION_ID)
        .where("entityType", "=", "item")
        .where((eb) =>
          eb.or([
            eb("entityId", "=", itemId),
            eb("externalId", "=", externalId)
          ])
        )
        .execute();
      return trx
        .insertInto("externalIntegrationMapping")
        .values({
          entityType: "item",
          entityId: itemId,
          integration: ONSHAPE_V2_INTEGRATION_ID,
          externalId,
          metadata: args.metadata as Json,
          lastSyncedAt: now,
          companyId,
          createdBy: userId,
          updatedBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    });
    return { id: inserted.id, error: null };
  } catch (error) {
    onshapePushLogger.error("Failed to link an item to Onshape", {
      companyId,
      itemId,
      error
    });
    return {
      id: null,
      error: error instanceof Error ? error.message : "link failed"
    };
  }
}

/**
 * Insert BOM lines and their ownership rows in one transaction. A line without
 * its ownership row reads as manual, so the next push keeps it and adds a copy.
 */
export async function insertOwnedMethodLines(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    lines: OwnedMethodLine[];
  }
): Promise<
  { mappingIds: string[]; error: null } | { mappingIds: null; error: string }
> {
  const { companyId, userId, lines } = args;
  if (lines.length === 0) return { mappingIds: [], error: null };
  const now = datetime.timestamp();
  try {
    const mappingIds = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto("methodMaterial")
        .values(
          lines.map((line) => ({
            ...line.row,
            companyId,
            createdBy: userId,
            updatedBy: userId
          }))
        )
        .returning("id")
        .execute();
      // Mappings pair with lines by index (RETURNING follows VALUES order).
      if (inserted.length !== lines.length) {
        throw new Error(
          `wrote ${inserted.length} of ${lines.length} lines; nothing was kept`
        );
      }
      const mappings = await trx
        .insertInto("externalIntegrationMapping")
        .values(
          lines.map((line, index) => ({
            entityType: "methodMaterial",
            entityId: inserted[index]!.id,
            integration: ONSHAPE_V2_INTEGRATION_ID,
            metadata: line.metadata as Json,
            lastSyncedAt: now,
            companyId,
            createdBy: userId,
            updatedBy: userId
          }))
        )
        .returning("id")
        .execute();
      return mappings.map((mapping) => mapping.id);
    });
    return { mappingIds, error: null };
  } catch (error) {
    onshapePushLogger.error("Failed to write Onshape BOM lines", {
      companyId,
      count: lines.length,
      error
    });
    return {
      mappingIds: null,
      error: error instanceof Error ? error.message : "line insert failed"
    };
  }
}

/**
 * Take over a manual line in one transaction: set the Onshape-owned columns and
 * write its ownership row. Operation, scrap, tags and kit are kept.
 */
export async function claimManualMethodLine(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    lineId: string;
    update: {
      itemId: string;
      quantity: number;
      order: number;
      materialMakeMethodId: string | null;
    };
    metadata: Record<string, unknown>;
  }
): Promise<
  { mappingId: string; error: null } | { mappingId: null; error: string }
> {
  const { companyId, userId, lineId } = args;
  const now = datetime.timestamp();
  try {
    const mappingId = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable("methodMaterial")
        .set({ ...args.update, updatedBy: userId, updatedAt: now })
        .where("id", "=", lineId)
        .where("companyId", "=", companyId)
        .returning("id")
        .executeTakeFirst();
      if (!updated) throw new Error("the line no longer exists");
      const mapping = await trx
        .insertInto("externalIntegrationMapping")
        .values({
          entityType: "methodMaterial",
          entityId: lineId,
          integration: ONSHAPE_V2_INTEGRATION_ID,
          metadata: args.metadata as Json,
          lastSyncedAt: now,
          companyId,
          createdBy: userId,
          updatedBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return mapping.id;
    });
    return { mappingId, error: null };
  } catch (error) {
    onshapePushLogger.error("Failed to take over a BOM line for Onshape", {
      companyId,
      lineId,
      error
    });
    return {
      mappingId: null,
      error: error instanceof Error ? error.message : "line takeover failed"
    };
  }
}

export type OpenReleaseNotice = {
  id: string;
  changeNoticeId: string;
  affectedCount: number;
};

/**
 * The notice an earlier push of this release made, while it still takes items:
 * a release spanning two documents is pushed once per document into one notice.
 * Fails closed: a read that fails is an error, never "no open notice", which
 * would open a second notice for the release.
 */
export async function findOpenReleaseNotice(
  client: SupabaseClient<Database>,
  companyId: string,
  releaseId: string
): Promise<
  | { data: OpenReleaseNotice | null; error: null }
  | { data: null; error: string }
> {
  const failed = (what: string, error: unknown) => {
    onshapePushLogger.error("Could not read a release's earlier push", {
      companyId,
      releaseId,
      read: what,
      error
    });
    return {
      data: null,
      error: `Carbon couldn't read this release's earlier ${what}`
    };
  };

  // Matched on the release id the link's metadata carries, not a LIKE on the
  // key: a synthetic release id holds a part number, which may contain % or _.
  const links = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "item")
    .like("externalId", "release:%")
    .eq("metadata->>releaseId", releaseId);
  if (links.error) return failed("links", links.error);
  if (!links.data?.length) return { data: null, error: null };

  const items = await selectInBatches(
    links.data.map((link) => link.entityId),
    (batch) =>
      client
        .from("item")
        .select("changeOrderId")
        .eq("companyId", companyId)
        .in("id", batch)
        .not("changeOrderId", "is", null)
  );
  if (items.error) return failed("items", items.error);
  const noticeIds = [
    ...new Set(
      items.data
        .map((item) => item.changeOrderId)
        .filter((id): id is string => !!id)
    )
  ];
  if (noticeIds.length === 0) return { data: null, error: null };

  const notices = await selectInBatches(noticeIds, (batch) =>
    client
      .from("changeOrder")
      .select(
        "id, changeOrderId, status, createdAt, changeOrderAffectedItem(id)"
      )
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (notices.error) return failed("change notices", notices.error);
  // Batches arrive in batch order: the oldest open notice wins.
  const editable = notices.data
    .filter((notice) => canEditChangeNoticeEngineering(notice.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // A pending approval freezes the notice's engineering content; one can be
  // pending only at Engineering Complete. approvalRequest is service-role only.
  const awaitingIds = editable
    .filter((notice) => notice.status === "Engineering Complete")
    .map((notice) => notice.id);
  const awaiting = new Set<string>();
  if (awaitingIds.length > 0) {
    const pending = await selectInBatches(awaitingIds, (batch) =>
      getCarbonServiceRole()
        .from("approvalRequest")
        .select("documentId")
        .eq("companyId", companyId)
        .eq("documentType", "changeOrder")
        .eq("status", "Pending")
        .in("documentId", batch)
    );
    if (pending.error) return failed("change notice approvals", pending.error);
    for (const row of pending.data) awaiting.add(row.documentId);
  }
  const open = editable.find((notice) => !awaiting.has(notice.id));
  return {
    data: open
      ? {
          id: open.id,
          changeNoticeId: open.changeOrderId,
          affectedCount: open.changeOrderAffectedItem?.length ?? 0
        }
      : null,
    error: null
  };
}

/**
 * Stage a created item under a change notice as `createChangeNoticeDraftMethod`
 * does: item inactive, item and Draft method stamped, one affected-item row.
 */
export async function stageChangeNoticeItem(
  db: Kysely<KyselyDatabase>,
  args: {
    /** `changeOrder.id`, not its readable id. */
    changeOrderId: string;
    companyId: string;
    userId: string;
    itemId: string;
    /** The revision this one replaces; null for a New Part. */
    baseItemId: string | null;
    sortOrder: number;
  }
): Promise<{ error: string | null }> {
  const { changeOrderId, companyId, userId, itemId, baseItemId } = args;
  const now = datetime.timestamp();
  try {
    await db.transaction().execute(async (trx) => {
      const draft = await trx
        .selectFrom("makeMethod")
        .select("id")
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .orderBy("version", "desc")
        .executeTakeFirst();
      // Release refuses an affected item with no Draft to activate.
      if (!draft) throw new Error("the item has no Draft make method");
      const base = baseItemId
        ? await trx
            .selectFrom("activeMakeMethods")
            .select("id")
            .where("itemId", "=", baseItemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : undefined;

      await trx
        .updateTable("item")
        .set({
          active: false,
          changeOrderId,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", itemId)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .updateTable("makeMethod")
        .set({ changeOrderId, updatedBy: userId, updatedAt: now })
        .where("id", "=", draft.id)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .insertInto("changeOrderAffectedItem")
        .values({
          changeOrderId,
          itemId: baseItemId ?? itemId,
          changeType: baseItemId ? "Revision" : "New Part",
          sortOrder: args.sortOrder,
          draftMakeMethodId: draft.id,
          baseMakeMethodId: base?.id ?? null,
          newItemId: itemId,
          companyId,
          createdBy: userId
        })
        .execute();
    });
    return { error: null };
  } catch (error) {
    onshapePushLogger.error("Failed to stage an item under a change notice", {
      companyId,
      changeOrderId,
      itemId,
      error
    });
    return {
      error: error instanceof Error ? error.message : "staging failed"
    };
  }
}

type ItemEnums = Database["public"]["Enums"];

/** Item field values a push writes; an absent key is not written. */
export type ItemFieldWrite = {
  replenishmentSystem?: ItemEnums["itemReplenishmentSystem"];
  defaultMethodType?: ItemEnums["methodType"];
  sourcingType?: ItemEnums["sourcingType"];
  itemTrackingType?: ItemEnums["itemTrackingType"];
  unitOfMeasureCode?: string;
  mpn?: string | null;
};

type WriterContext = {
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  itemId: string;
  companyId: string;
  userId: string;
};

export async function updateItemColumns(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    values: Pick<ItemFieldWrite, "mpn" | "unitOfMeasureCode">;
  }
) {
  return client
    .from("item")
    .update({
      ...(args.values.mpn !== undefined ? { mpn: args.values.mpn } : {}),
      ...(args.values.unitOfMeasureCode !== undefined
        ? { unitOfMeasureCode: args.values.unitOfMeasureCode }
        : {}),
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.itemId)
    .eq("companyId", args.companyId);
}

/**
 * One writer per `StandardFieldWriter` key. Each writes as the item page does,
 * so the cascades onto Draft method lines and open documents follow.
 */
const STANDARD_FIELD_WRITERS: Record<
  StandardFieldWriter,
  (ctx: WriterContext, write: ItemFieldWrite) => Promise<string | null>
> = {
  itemMethod: async (ctx, write) => {
    const { replenishmentSystem, defaultMethodType, sourcingType } = write;
    await updateItemMethodAndSourcing(ctx.db, {
      itemIds: [ctx.itemId],
      companyId: ctx.companyId,
      userId: ctx.userId,
      itemUpdate: { replenishmentSystem, defaultMethodType, sourcingType },
      cascade: {
        ...(defaultMethodType !== undefined
          ? { methodType: defaultMethodType }
          : {}),
        ...(sourcingType !== undefined ? { sourcingType } : {})
      }
    });
    return null;
  },
  itemTracking: async (ctx, write) => {
    if (write.itemTrackingType === undefined) return null;
    const updated = await ctx.client
      .from("item")
      .update({
        itemTrackingType: write.itemTrackingType,
        updatedBy: ctx.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", ctx.itemId)
      .eq("companyId", ctx.companyId);
    if (updated.error) return updated.error.message;
    await cascadeItemTrackingType(ctx.db, {
      itemIds: [ctx.itemId],
      companyId: ctx.companyId,
      newType: write.itemTrackingType,
      userId: ctx.userId
    });
    return null;
  },
  itemColumn: async (ctx, write) => {
    const updated = await updateItemColumns(ctx.client, {
      itemId: ctx.itemId,
      companyId: ctx.companyId,
      userId: ctx.userId,
      values: write
    });
    return updated.error ? updated.error.message : null;
  }
};

const WRITER_ORDER: StandardFieldWriter[] = [
  "itemMethod",
  "itemTracking",
  "itemColumn"
];

/** Values must be final: this applies no interlock. Returns an error message, or null. */
export async function applyItemFieldWrites(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    changed: ItemFieldWrite;
  }
): Promise<string | null> {
  const { itemId, companyId, userId } = args;
  const ctx: WriterContext = { client, db, itemId, companyId, userId };
  try {
    for (const writer of WRITER_ORDER) {
      const write: ItemFieldWrite = {};
      for (const [field, value] of Object.entries(args.changed)) {
        if (value === undefined) continue;
        if (standardField(field)?.writer !== writer) continue;
        (write as Record<string, unknown>)[field] = value;
      }
      if (Object.keys(write).length === 0) continue;
      const error = await STANDARD_FIELD_WRITERS[writer](ctx, write);
      if (error) return error;
    }
    return null;
  } catch (error) {
    onshapePushLogger.error("Failed to write item fields from Onshape", {
      companyId,
      itemId,
      error
    });
    return error instanceof Error ? error.message : "Failed to update the item";
  }
}

/**
 * Write to an item the push did not create: the "everyPush" descriptions, then
 * the plan's target with the reviewer's edits on top. Returns the fields after
 * the write, which a BOM line written later copies its method and unit from.
 */
export async function applyExistingItemFields(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    current: ItemFieldSnapshot | null | undefined;
    target?: ItemFieldSnapshot;
    edit?: ItemEdit;
    descriptions?: OwnedFieldChange[];
  }
): Promise<{ values: ItemFieldSnapshot | null; error: string | null }> {
  const { itemId, companyId, userId } = args;
  const merged = args.current
    ? mergeExistingItemEdits(args.current, args.edit, args.target)
    : null;
  if (merged && !merged.ok) {
    return { values: null, error: merged.errors.join("; ") };
  }

  const text: { name?: string; description?: string } = {};
  for (const change of args.descriptions ?? []) {
    if (change.to !== null) text[change.field] = change.to;
  }
  if (Object.keys(text).length > 0) {
    const updated = await client
      .from("item")
      .update({ ...text, updatedBy: userId, updatedAt: datetime.timestamp() })
      .eq("id", itemId)
      .eq("companyId", companyId);
    if (updated.error) {
      return { values: null, error: updated.error.message };
    }
  }

  if (merged?.ok && Object.keys(merged.changed).length > 0) {
    const error = await applyItemFieldWrites(client, db, {
      itemId,
      companyId,
      userId,
      changed: merged.changed
    });
    if (error) return { values: null, error };
  }
  return { values: merged?.ok ? merged.values : null, error: null };
}
const onshapeOauthLogger = getLogger("erp", "onshape", "oauth");

/** Absolute integrations-page URL on this request's origin. */
function integrationsUrl(request: Request) {
  const requestUrl = new URL(request.url);

  if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
    requestUrl.protocol = "http";
  }

  return `${requestUrl.origin}${path.to.integrations}`;
}

/**
 * The OAuth callback for every Onshape grant (`onshape`, `onshape-government`,
 * `onshape-v2`); `loadOnshapeOAuthConfig` picks the client. Onshape redirects
 * the browser here, in the install popup or the whole tab, so the outcome
 * renders through `oauthPopupResponse`. Only an error code crosses;
 * `integrationErrors` owns the copy.
 */
export async function completeOnshapeAuthorization({
  request,
  integrationId,
  userId,
  companyId
}: {
  request: Request;
  integrationId: OnshapeOAuthIntegrationId;
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

  // Every Onshape integration declares the same codes, each with its copy.
  const connectionFailed = (
    reason: IntegrationErrorCode<OnshapeOAuthIntegrationId>
  ) =>
    withCookie(
      oauthPopupResponse(
        { integration: integrationId, ok: false, error: reason },
        `${integrationsUrl(request)}${integrationErrorSearch<OnshapeOAuthIntegrationId>(integrationId, reason)}`
      ),
      consumedState.cookie
    );

  if (!consumedState.valid) {
    onshapeOauthLogger.error("Invalid Onshape OAuth state", {
      integrationId,
      companyId
    });
    return connectionFailed("invalid-state");
  }

  // Onshape reports a refused authorization by redirecting here with `error`
  // (and usually `error_description`) in place of `code`. `invalid_scope`
  // means the OAuth application isn't granted a scope we asked for — in
  // practice `OAuth2Write` ("Application can write to your documents"), so the
  // UI can name the exact fix instead of echoing Onshape's wording.
  if (searchParams.error) {
    onshapeOauthLogger.error("Onshape authorization refused", {
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
    onshapeOauthLogger.error("Invalid Onshape auth response", {
      integrationId,
      params: Object.keys(searchParams)
    });
    return connectionFailed("invalid-response");
  }

  const serviceRole = getCarbonServiceRole();

  // A company holds one Onshape sync connection at a time; two would leave
  // every background job guessing which tenant to talk to. The panel's grant
  // is outside that rule.
  if (
    isOnshapeIntegrationId(integrationId) &&
    (await getConflictingOnshapeIntegration(
      serviceRole,
      companyId,
      integrationId
    ))
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
      onshapeOauthLogger.error("Onshape token exchange failed", {
        integrationId,
        error
      });
      return connectionFailed("token-exchange");
    }

    if (!tokenData.access_token) {
      onshapeOauthLogger.error("Onshape token response had no access token", {
        integrationId
      });
      return connectionFailed("token-exchange");
    }

    // The scope actually granted by this authorization. Onshape returns it on
    // the token response; fall back to what we requested. A token minted
    // without write can't export assets or manage the release webhook, and a
    // refresh can't widen it, so the grant patch turns asset sync off. The
    // patch writes only the grant's keys, so settings survive a reconnect.
    const scope = tokenData.scope ?? ONSHAPE_OAUTH_SCOPES.join(" ");
    let saved: Awaited<ReturnType<typeof patchOnshapeOAuthGrant>>;
    try {
      saved = await patchOnshapeOAuthGrant(
        serviceRole,
        companyId,
        integrationId,
        {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: parseAbsolute(datetime.timestamp(), "UTC")
            .add({ seconds: tokenData.expires_in ?? 3600 })
            .toAbsoluteString(),
          scope,
          baseUrl: oauth.baseUrl,
          canWrite: onshapeConnectionHasWriteScope({ scope }),
          updatedBy: userId
        }
      );
    } catch (error) {
      onshapeOauthLogger.error("Failed to save Onshape integration", {
        integrationId,
        error
      });
      return connectionFailed("save-failed");
    }
    await clearCompanyIntegrationCache(companyId);
    const metadata = (saved.metadata ?? {}) as Record<string, unknown>;

    // A Government connection is configured BEFORE it is authorized, so asset
    // sync may already be on: subscribe to releases now that there is a token.
    // Best-effort — the settings save retries it and reports a failure there.
    if (metadata.assetSyncEnabled === true) {
      const webhook = await ensureOnshapeReleaseWebhook(companyId, true);
      if (!webhook.ok) {
        onshapeOauthLogger.error(
          "Onshape release webhook registration failed",
          {
            integrationId,
            error: webhook.error
          }
        );
      }
    }

    return withCookie(
      oauthPopupResponse(
        { integration: integrationId, ok: true },
        integrationsUrl(request)
      ),
      consumedState.cookie
    );
  } catch (error) {
    onshapeOauthLogger.error("Onshape OAuth Error", { integrationId, error });
    return connectionFailed("unexpected");
  }
}

function withCookie(response: Response, cookie: string) {
  response.headers.append("Set-Cookie", cookie);
  return response;
}

/**
 * What an Onshape panel operation answers. The panel reads the HTTP status
 * and the JSON body (`error`, `fieldErrors`, `code`), so its route sends both
 * as given (`panelResponse`).
 */
export type PanelReply = { status: number; body: unknown };

export function panelReply(
  body: unknown,
  init?: { status?: number; headers?: HeadersInit }
): PanelReply {
  return { status: init?.status ?? 200, body };
}
const itemEditSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  replenishmentSystem: z.string().optional(),
  defaultMethodType: z.string().optional(),
  itemTrackingType: z.string().optional(),
  unitOfMeasureCode: z.string().optional()
});

export const onshapePartPushInput = z.object({
  planId: z.string().min(1),
  selected: z.array(z.string().min(1)).min(1).max(50),
  edits: z.record(z.string(), itemEditSchema).default({})
});

type ApplyResult = {
  partId: string;
  action: "created" | "adopted" | "updated" | "unchanged" | "skipped" | "error";
  itemId?: string;
  readableId?: string;
  message?: string;
};

/** Apply a reviewed part plan: create or adopt items, link them, queue model exports. */
export async function pushOnshapePart(
  ctx: ServiceContext,
  input: z.infer<typeof onshapePartPushInput>
): Promise<PanelReply> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { planId } = input;
  const selected = [...new Set(input.selected)];
  const edits = input.edits as Record<string, ItemEdit>;

  const stored = await peekPanelPlan(planId, { companyId, userId });
  if (!stored) {
    return panelReply(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }
  if (stored.plan.kind !== "part") {
    return panelReply(
      { error: "This review is not a part push" },
      { status: 400 }
    );
  }
  const plan: PartPlan = stored.plan;
  const { documentId, wv, wvId, elementId, options } = plan;
  const configuration = plan.configuration ?? null;

  const rowByPartId = new Map(plan.rows.map((row) => [row.partId, row]));
  const selectedRows = selected
    .map((partId) => rowByPartId.get(partId))
    .filter((row): row is PartPlanRow => !!row);

  const merged = mergeEditsForCreates(
    selectedRows
      .filter((row) => row.action === "create" && row.partNumber)
      .map((row) => ({ key: row.partId, proposed: proposedFor(row, plan) })),
    edits,
    options
  );
  const fieldErrors = merged.errors;
  if (fieldErrors.length > 0) {
    return panelReply(
      { error: "Some edits are not valid", fieldErrors },
      { status: 422 }
    );
  }

  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return panelReply(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  // A create whose number now exists adopts it: `upsertPart` reads its new id
  // back by readableId and could get another revision.
  const partNumbers = [
    ...new Set(
      selectedRows
        .map((row) => row.partNumber)
        .filter((number): number is string => !!number)
    )
  ];
  const targetItemIds = [
    ...new Set(
      selectedRows
        .filter((row) => row.action === "adopt" || row.action === "update")
        .map((row) => row.itemId)
        .filter((id): id is string => !!id)
    )
  ];
  const [byNumber, byId] = await Promise.all([
    selectInBatches(partNumbers, (batch) =>
      client
        .from("item")
        .select("id, readableId, revision, active, name, type")
        .eq("companyId", companyId)
        .in("readableId", batch)
        .order("revision")
    ),
    selectInBatches(targetItemIds, (batch) =>
      client
        .from("item")
        .select("id, readableId, revision, active, name, type")
        .eq("companyId", companyId)
        .in("id", batch)
    )
  ]);
  if (byNumber.error || byId.error) {
    return panelReply(
      { error: "Failed to read Carbon items" },
      { status: 500 }
    );
  }
  const rowsByReadableId = new Map<string, PlanItemRow[]>();
  for (const item of (byNumber.data ?? []) as PlanItemRow[]) {
    const list = rowsByReadableId.get(item.readableId) ?? [];
    list.push(item);
    rowsByReadableId.set(item.readableId, list);
  }
  const itemById = new Map(
    ((byId.data ?? []) as PlanItemRow[]).map((item) => [item.id, item])
  );

  const serviceRole = getCarbonServiceRole();
  const db = ctx.asSystem.pg;

  const resolveTarget = (row: PartPlanRow): PlanItemRow | undefined => {
    let target: PlanItemRow | undefined;
    if (row.action === "adopt" || row.action === "update") {
      target = row.itemId ? itemById.get(row.itemId) : undefined;
    }
    if (!target && row.partNumber) {
      target = pickAdoptTarget(
        rowsByReadableId.get(row.partNumber) ?? [],
        row.revision
      );
    }
    return target;
  };

  // `part.id` is the readableId, shared across revisions. Kept current as the
  // loop writes, so a later row cannot clobber a create.
  const partCustomFieldsByReadableId = new Map<string, unknown>();
  const ownedReadableIds = [
    ...new Set(
      selectedRows.flatMap((row) => {
        if (existingCustomFieldValues(row) === null) return [];
        const ids: string[] = [];
        if (row.partNumber) ids.push(row.partNumber);
        const target = row.itemId ? itemById.get(row.itemId) : undefined;
        if (target) ids.push(target.readableId);
        return ids;
      })
    )
  ];
  const partRows = await selectInBatches(ownedReadableIds, (batch) =>
    client
      .from("part")
      .select("id, customFields")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (partRows.error) {
    return panelReply(
      { error: "Failed to read Carbon parts" },
      { status: 500 }
    );
  }
  for (const partRow of partRows.data) {
    partCustomFieldsByReadableId.set(partRow.id, partRow.customFields);
  }

  const results: ApplyResult[] = [];

  for (const partId of selected) {
    const row = rowByPartId.get(partId);
    if (!row) {
      results.push({
        partId,
        action: "error",
        message: "Part is not in this review"
      });
      continue;
    }

    if (row.action === "skip-no-part-number") {
      results.push({
        partId,
        action: "skipped",
        message: "Set a part number in Onshape first"
      });
      continue;
    }

    if (row.action === "released") {
      results.push({
        partId,
        action: "skipped",
        message: `Released in Onshape as Rev ${row.item?.revision ?? "?"}: changes come through a release`
      });
      continue;
    }

    if (row.action === "unchanged") {
      // A reviewer edit is still written; no link re-stamp, no export.
      if (row.itemId && edits[partId]) {
        const applied = await applyExistingItemFields(client, db, {
          itemId: row.itemId,
          companyId,
          userId,
          current: row.current,
          edit: edits[partId]
        });
        if (applied.error) {
          results.push({ partId, action: "error", message: applied.error });
          continue;
        }
        results.push({
          partId,
          action: "updated",
          itemId: row.itemId,
          readableId: row.item?.readableId
        });
        continue;
      }
      results.push({
        partId,
        action: "unchanged",
        itemId: row.itemId ?? undefined,
        readableId: row.item?.readableId
      });
      continue;
    }

    const target = resolveTarget(row);
    const resolved: "create" | "adopt" | "update" = target
      ? row.action === "update" && target.id === row.itemId
        ? "update"
        : "adopt"
      : "create";

    let itemId: string;
    let readableId: string;
    if (resolved === "create") {
      const item = merged.items.get(row.partId) ?? proposedFor(row, plan);
      const fieldValues = planCustomFieldValues(row);
      const created = await upsertPart(client, {
        id: item.readableId,
        name: item.name,
        description: item.description ?? undefined,
        revision: item.revision,
        replenishmentSystem: item.replenishmentSystem,
        defaultMethodType: item.defaultMethodType,
        itemTrackingType: item.itemTrackingType,
        unitOfMeasureCode: item.unitOfMeasureCode,
        companyId,
        createdBy: userId,
        ...(Object.keys(fieldValues).length > 0 && {
          customFields: fieldValues
        })
        // partValidator carries many optional form-only fields the panel never sets
      } as any);
      if (created.error || !created.data) {
        results.push({
          partId,
          action: "error",
          message: created.error?.message ?? "Failed to create the item"
        });
        continue;
      }
      itemId = created.data.id as string;
      readableId = item.readableId;
      const extras = createdItemExtras(item);
      if (Object.keys(extras).length > 0) {
        const error = await applyItemFieldWrites(client, db, {
          itemId,
          companyId,
          userId,
          changed: extras
        });
        if (error) {
          results.push({
            partId,
            action: "error",
            itemId,
            readableId,
            message: `Item created, but its mapped fields were not written (${error})`
          });
          continue;
        }
      }
      // A later row with the same number adopts this item, not a second create.
      rowsByReadableId.set(readableId, [
        ...(rowsByReadableId.get(readableId) ?? []),
        {
          id: itemId,
          readableId,
          revision: item.revision,
          name: item.name,
          type: "Part"
        }
      ]);
      if (Object.keys(fieldValues).length > 0) {
        partCustomFieldsByReadableId.set(readableId, fieldValues);
      }
    } else {
      itemId = (target as PlanItemRow).id;
      readableId = (target as PlanItemRow).readableId;
      const applied = await applyExistingItemFields(client, db, {
        itemId,
        companyId,
        userId,
        current: row.current,
        target: row.target,
        edit: edits[partId],
        descriptions: row.changes
      });
      if (applied.error) {
        results.push({ partId, action: "error", message: applied.error });
        continue;
      }
      const owned = existingCustomFieldValues(row);
      if (owned) {
        const mergedFields = mergeCustomFieldValues(
          partCustomFieldsByReadableId.get(readableId),
          owned.values,
          owned.fieldIds
        );
        const partUpdate = await client
          .from("part")
          .update({
            customFields: mergedFields as Json,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .eq("id", readableId)
          .eq("companyId", companyId);
        if (partUpdate.error) {
          results.push({
            partId,
            action: "error",
            message: partUpdate.error.message
          });
          continue;
        }
        partCustomFieldsByReadableId.set(readableId, mergedFields);
      }
    }

    const externalId = externalIdForPart(
      documentId,
      elementId,
      partId,
      configuration
    );
    const now = datetime.timestamp();
    const linked = await swapItemMapping(db, {
      companyId,
      userId,
      itemId,
      externalId,
      metadata: {
        documentId,
        elementId,
        partId,
        configuration,
        wv,
        wvId,
        // A later plan's only "unchanged" signal.
        microversionId: row.microversionId,
        partNumber: row.partNumber,
        name: row.name,
        revision: row.revision,
        pushedBy: userId,
        pushedAt: now,
        planId
      }
    });
    if (linked.error !== null) {
      results.push({
        partId,
        action: "error",
        message: "Item saved but the Onshape link failed; push again"
      });
      continue;
    }

    if (row.cadUnchanged && resolved === "update") {
      results.push({ partId, action: "updated", itemId, readableId });
      continue;
    }

    try {
      await trigger(
        "onshape-panel-sync",
        {
          companyId,
          userId,
          itemId,
          documentId,
          wvm: wv,
          wvmId: wvId,
          elementId,
          elementKind: "partstudio",
          partId,
          ...(configuration ? { configuration } : {}),
          ...(wv === "w" && row.microversionId
            ? { microversionId: row.microversionId }
            : {}),
          assetBaseName: row.partNumber ?? row.name
        },
        { id: `${planId}:${itemId}:${elementId}` }
      );
    } catch (error) {
      // Unlink so the next plan does not read "unchanged" and skip the export.
      // By id, not externalId: a concurrent push may have replaced the row.
      const rolledBack = await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .eq("companyId", companyId)
        .eq("id", linked.id);
      results.push({
        partId,
        action: "error",
        itemId,
        readableId,
        message: rolledBack.error
          ? `Item saved but the model export could not be queued, and the Onshape link could not be rolled back (${rolledBack.error.message}); detach this item before pushing again`
          : `Item saved but the model export could not be queued; push again (${
              error instanceof Error ? error.message : "event send failed"
            })`
      });
      continue;
    }

    results.push({
      partId,
      action:
        resolved === "create"
          ? "created"
          : resolved === "adopt"
            ? "adopted"
            : "updated",
      itemId,
      readableId
    });
  }

  return panelReply(
    { results },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}

/** The plan's proposal, or one built from the row when the target vanished. */
function proposedFor(row: PartPlanRow, plan: PartPlan): ProposedItem {
  if (row.proposed) return row.proposed;
  return proposeItem(
    {
      partNumber: row.partNumber as string,
      name: row.name,
      description: row.description,
      revision: row.revision
    },
    plan.options
  );
}

function planCustomFieldValues(
  row: PartPlanRow
): Record<string, string | number | boolean | null> {
  return mappedFieldValues(row.customFields ?? [], true).values;
}

/** The "everyPush" values an adopt or update writes; a null value deletes the key. */
function existingCustomFieldValues(row: PartPlanRow): {
  values: Record<string, string | number | boolean | null>;
  fieldIds: Set<string>;
} | null {
  if (row.action === "create") return null;
  const mapped = mappedFieldValues(row.customFields ?? [], false);
  return mapped.fieldIds.size > 0 ? mapped : null;
}
// Shape only: `mergeItemEdits` validates values, so a bad one is a 422 naming the row.

export const onshapeAssemblyPushInput = z.object({
  planId: z.string().min(1),
  edits: z.record(z.string(), itemEditSchema).default({}),
  excluded: z.array(z.string().min(1)).default([])
});

type AssemblyPushSummary = {
  assemblyItemId: string | null;
  itemsCreated: number;
  itemsReused: number;
  linesWritten: number;
  linesUnchanged: number;
  /** Manual lines now following Onshape; also counted in `linesWritten`. */
  linesTakenOver: number;
  descriptionsUpdated: number;
  /** Reused items whose mapped fields this push wrote. */
  fieldsUpdated: number;
  methodsTouched: number;
  /** Parent part numbers whose BOM went into a new Draft. */
  draftVersionsCreated: string[];
  skipped: string[];
  errors: string[];
};

type AssemblyPushItemRow = {
  id: string;
  readableId: string;
  revision: string | null;
  /** Absent on an item this push created (Design). */
  revisionStatus?: Database["public"]["Enums"]["itemRevisionStatus"] | null;
  active?: boolean | null;
  type: string | null;
  defaultMethodType: string | null;
  sourcingType: string | null;
  unitOfMeasureCode: string | null;
};

/** Apply a reviewed assembly plan: items, BOM lines per method, links, model export. */
export async function pushOnshapeAssembly(
  ctx: ServiceContext,
  input: z.infer<typeof onshapeAssemblyPushInput>
): Promise<PanelReply> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { planId } = input;
  const edits = input.edits as Record<string, ItemEdit>;
  const excluded = new Set(input.excluded);

  // Peek, not take: a 422 on the edits leaves the plan for a retry.
  const stored = await peekPanelPlan(planId, { companyId, userId });
  if (!stored) {
    return panelReply(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }
  if (stored.plan.kind !== "assembly") {
    return panelReply(
      { error: "This review is not an assembly push" },
      { status: 400 }
    );
  }
  const plan = stored.plan;
  const { documentId, wv, wvId, elementId, root, options } = plan;
  const configuration = plan.configuration ?? null;

  if (excluded.has(root.partNumber)) {
    return panelReply(
      { error: "The assembly itself cannot be excluded" },
      { status: 400 }
    );
  }

  const creates: Array<{ key: string; proposed: ProposedItem }> = [];
  if (root.action === "create" && root.proposed) {
    creates.push({ key: root.partNumber, proposed: root.proposed });
  }
  for (const item of plan.items) {
    if (
      item.action === "create" &&
      item.proposed &&
      !excluded.has(item.partNumber)
    ) {
      creates.push({ key: item.partNumber, proposed: item.proposed });
    }
  }
  const merged = mergeEditsForCreates(creates, edits, options);
  if (merged.errors.length > 0) {
    return panelReply(
      { error: "Some edits are not valid", fieldErrors: merged.errors },
      { status: 422 }
    );
  }

  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return panelReply(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  const summary: AssemblyPushSummary = {
    assemblyItemId: null,
    itemsCreated: 0,
    itemsReused: 0,
    linesWritten: 0,
    linesUnchanged: 0,
    linesTakenOver: 0,
    descriptionsUpdated: 0,
    fieldsUpdated: 0,
    methodsTouched: 0,
    draftVersionsCreated: [],
    skipped: [...plan.skipped],
    errors: []
  };
  for (const item of plan.items) {
    if (excluded.has(item.partNumber)) {
      summary.skipped.push(`${item.partNumber}: excluded`);
    }
  }

  const includedItems = plan.items.filter(
    (item) => !excluded.has(item.partNumber)
  );
  const partNumbers = [
    ...new Set([root.partNumber, ...includedItems.map((i) => i.partNumber)])
  ];
  const existing = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, revisionStatus, active, type, defaultMethodType, sourcingType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return panelReply(
      { error: "Failed to read Carbon items" },
      { status: 500 }
    );
  }
  const rowsByReadableId = new Map<string, AssemblyPushItemRow[]>();
  for (const row of (existing.data ?? []) as AssemblyPushItemRow[]) {
    const list = rowsByReadableId.get(row.readableId) ?? [];
    list.push(row);
    rowsByReadableId.set(row.readableId, list);
  }

  // A reuse whose row vanished becomes a create, described from the BOM row.
  const allNodes = flattenNodes(plan.nodes);
  const nodeByPartNumber = new Map<string, OnshapeBomNode>();
  for (const node of allNodes) {
    if (node.partNumber && !nodeByPartNumber.has(node.partNumber)) {
      nodeByPartNumber.set(node.partNumber, node);
    }
  }

  const itemByReadableId = new Map<string, AssemblyPushItemRow>();
  const fallbackUnit = defaultUnitOfMeasureCode(options);

  const serviceRole = getCarbonServiceRole();
  const db = ctx.asSystem.pg;

  type PlannedItem = MappedRowPlan & {
    itemId: string | null;
    current?: ItemFieldSnapshot | null;
    changes?: OwnedFieldChange[];
  };

  const customFieldReadIds = [root, ...includedItems]
    .filter(
      (row) =>
        row.action === "reuse" &&
        mappedFieldValues(row.customFields ?? [], false).fieldIds.size > 0
    )
    .map((row) => row.partNumber);
  const heldParts = await selectInBatches(customFieldReadIds, (batch) =>
    client
      .from("part")
      .select("id, customFields")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (heldParts.error) {
    return panelReply(
      { error: "Failed to read Carbon parts" },
      { status: 500 }
    );
  }
  const heldCustomFields = new Map<string, unknown>(
    (heldParts.data ?? []).map((part) => [part.id, part.customFields])
  );

  const ensureItem = async (
    partNumber: string,
    planned: PlannedItem,
    propose: () => ProposedItem
  ): Promise<AssemblyPushItemRow | null> => {
    const rows = rowsByReadableId.get(partNumber) ?? [];
    const found =
      rows.find((row) => row.id === planned.itemId) ??
      pickReuseRow(rows) ??
      null;
    if (found) {
      summary.itemsReused += 1;
      if (planned.itemId === null) {
        summary.skipped.push(
          `${partNumber}: added to Carbon since the review; reused as is`
        );
      }
      // Only the row the review was about takes its values and edits.
      if (planned.itemId !== found.id) {
        itemByReadableId.set(partNumber, found);
        return found;
      }
      const applied = await applyExistingItemFields(client, db, {
        itemId: found.id,
        companyId,
        userId,
        current: planned.current,
        target: planned.target,
        edit: edits[partNumber],
        descriptions: planned.changes
      });
      let fieldsWritten = false;
      if (applied.error) {
        summary.errors.push(`${partNumber}: ${applied.error}`);
      } else {
        if (planned.changes?.length) summary.descriptionsUpdated += 1;
        fieldsWritten = (planned.itemFieldChanges?.length ?? 0) > 0;
      }
      const values = mappedFieldValues(planned.customFields ?? [], false);
      if (values.fieldIds.size > 0) {
        const updatedPart = await client
          .from("part")
          .update({
            customFields: mergeCustomFieldValues(
              heldCustomFields.get(partNumber),
              values.values,
              values.fieldIds
            ) as Json,
            updatedAt: datetime.timestamp(),
            updatedBy: userId
          })
          .eq("id", partNumber)
          .eq("companyId", companyId);
        if (updatedPart.error) {
          summary.errors.push(
            `${partNumber}: failed to write custom fields (${updatedPart.error.message})`
          );
        } else {
          fieldsWritten = true;
        }
      }
      if (fieldsWritten) summary.fieldsUpdated += 1;
      const row: AssemblyPushItemRow = applied.values
        ? {
            ...found,
            defaultMethodType: applied.values.defaultMethodType,
            sourcingType: applied.values.sourcingType ?? found.sourcingType,
            unitOfMeasureCode:
              applied.values.unitOfMeasureCode ?? found.unitOfMeasureCode
          }
        : found;
      itemByReadableId.set(partNumber, row);
      return row;
    }

    const item = merged.items.get(partNumber) ?? propose();
    const customFields = mappedFieldValues(
      planned.customFields ?? [],
      true
    ).values;
    const created = await upsertPart(client, {
      id: item.readableId,
      name: item.name,
      description: item.description ?? undefined,
      revision: item.revision,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      itemTrackingType: item.itemTrackingType,
      unitOfMeasureCode: item.unitOfMeasureCode,
      ...(Object.keys(customFields).length > 0
        ? { customFields: customFields as Json }
        : {}),
      companyId,
      createdBy: userId
    } as any);
    if (created.error || !created.data) {
      summary.errors.push(
        `${partNumber}: ${created.error?.message ?? "failed to create"}`
      );
      return null;
    }
    const row: AssemblyPushItemRow = {
      id: created.data.id as string,
      readableId: partNumber,
      revision: item.revision,
      type: "Part",
      defaultMethodType: item.defaultMethodType,
      sourcingType: item.sourcingType ?? null,
      unitOfMeasureCode: item.unitOfMeasureCode
    };
    const extras = createdItemExtras(item);
    if (Object.keys(extras).length > 0) {
      const error = await applyItemFieldWrites(client, db, {
        itemId: row.id,
        companyId,
        userId,
        changed: extras
      });
      if (error) {
        summary.errors.push(
          `${partNumber}: created, but its mapped fields were not written (${error})`
        );
      }
    }
    itemByReadableId.set(partNumber, row);
    summary.itemsCreated += 1;
    return row;
  };

  const rootItem = await ensureItem(root.partNumber, root, () =>
    proposeItem(
      {
        partNumber: root.partNumber,
        name: root.name,
        description: root.description,
        revision: root.revision
      },
      options
    )
  );
  if (!rootItem) {
    return panelReply(
      { error: summary.errors.join("; ") || "Failed to create the assembly" },
      { status: 500 }
    );
  }
  summary.assemblyItemId = rootItem.id;

  for (const item of includedItems) {
    await ensureItem(item.partNumber, item, () =>
      proposeItem(
        {
          partNumber: item.partNumber,
          name: item.name,
          description: nodeByPartNumber.get(item.partNumber)?.description,
          revision: item.revision,
          hasChildren: item.isAssembly
        },
        options
      )
    );
  }

  const isAssemblyByPartNumber = new Map(
    plan.items.map((item) => [item.partNumber, item.isAssembly])
  );

  // Every sub-assembly, even one this push writes no lines into: its parent's line
  // points at its method, and a null pointer flattens a `top` push's tree.
  const parentItemIds = [
    ...new Set(
      [
        ...plan.methods.map(
          (method) => itemByReadableId.get(method.parentPartNumber)?.id
        ),
        ...plan.items
          .filter((item) => item.isAssembly)
          .map((item) => itemByReadableId.get(item.partNumber)?.id)
      ].filter((id): id is string => !!id)
    )
  ];
  // A failed read must stop the writes, or a `top` push writes null child pointers.
  let methodByItemId: Awaited<ReturnType<typeof loadActiveMakeMethods>>;
  try {
    methodByItemId = await loadActiveMakeMethods(
      client,
      companyId,
      parentItemIds
    );
  } catch (error) {
    return panelReply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the make methods"
      },
      { status: 500 }
    );
  }
  // A Make to Order line points at its component's make method, as the BOM
  // editor does; this reads it for made parts that are not sub-assemblies.
  const madePartIds = [
    ...new Set(
      plan.items
        .filter((item) => !item.isAssembly && !excluded.has(item.partNumber))
        .map((item) => itemByReadableId.get(item.partNumber))
        .filter(
          (row): row is AssemblyPushItemRow =>
            !!row &&
            row.defaultMethodType === "Make to Order" &&
            !methodByItemId.has(row.id)
        )
        .map((row) => row.id)
    )
  ];
  let madePartMethodByItemId: Awaited<ReturnType<typeof loadActiveMakeMethods>>;
  try {
    madePartMethodByItemId = await loadActiveMakeMethods(
      client,
      companyId,
      madePartIds
    );
  } catch (error) {
    return panelReply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the make methods"
      },
      { status: 500 }
    );
  }
  const childMethodFor = (
    childItem: AssemblyPushItemRow,
    childMade: boolean
  ) =>
    childMade
      ? methodByItemId.get(childItem.id)
      : childItem.defaultMethodType === "Make to Order"
        ? (madePartMethodByItemId.get(childItem.id) ??
          methodByItemId.get(childItem.id))
        : null;

  // Not written: a change notice's Draft, or a released revision under
  // `enforce`. Rechecked here; the plan only listed them.
  const refusalByItemId = await loadMethodWriteRefusals(
    client,
    companyId,
    plan.methods.flatMap((planned) => {
      const parentItem = itemByReadableId.get(planned.parentPartNumber);
      const method = parentItem ? methodByItemId.get(parentItem.id) : undefined;
      return parentItem && method
        ? [
            {
              itemId: parentItem.id,
              method,
              revisionStatus: parentItem.revisionStatus
            }
          ]
        : [];
    })
  );

  // An Active method is written through a Draft, made before ownership is read:
  // ownership is keyed by method id, so a later Draft's lines would read as manual.
  const targetMethodByItemId = new Map<string, string>();
  const methodErrorByItemId = new Map<string, string>();
  const activeMethodIdByItemId = new Map<string, string>();
  for (const planned of plan.methods) {
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    const method = parentItem ? methodByItemId.get(parentItem.id) : undefined;
    if (parentItem && method?.status === "Active") {
      activeMethodIdByItemId.set(parentItem.id, method.id);
    }
  }
  let reusableDraftByItemId: Awaited<ReturnType<typeof loadReusableDrafts>>;
  try {
    reusableDraftByItemId = await loadReusableDrafts(
      client,
      serviceRole,
      companyId,
      activeMethodIdByItemId
    );
  } catch (error) {
    return panelReply(
      {
        error:
          error instanceof Error ? error.message : "Failed to read the Drafts"
      },
      { status: 500 }
    );
  }
  // An Active method whose Onshape lines already match gets no Draft. The
  // check pairs lines as the write loop does.
  let activeOwnership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    activeOwnership = await loadMethodLineOwnership(
      client,
      serviceRole,
      companyId,
      [...activeMethodIdByItemId.entries()]
        .filter(([itemId]) => !reusableDraftByItemId.has(itemId))
        .map(([, methodId]) => methodId)
    );
  } catch (error) {
    return panelReply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the existing BOM lines"
      },
      { status: 500 }
    );
  }
  const linesWouldChange = (
    planned: (typeof plan.methods)[number],
    methodId: string
  ) => {
    const reusable = new Map<string, MappedLineRow[]>();
    for (const row of activeOwnership.mappedRows.get(methodId) ?? []) {
      const queue = reusable.get(row.itemId) ?? [];
      queue.push(row);
      reusable.set(row.itemId, queue);
    }
    let order = 0;
    for (const write of planned.writes) {
      if (excluded.has(write.partNumber)) continue;
      const childItem = itemByReadableId.get(write.partNumber);
      if (!childItem || !bomLineItemType(childItem)) continue;
      const childMethod = childMethodFor(
        childItem,
        isAssemblyByPartNumber.get(write.partNumber) === true
      );
      const reuse = reusable.get(childItem.id)?.shift();
      if (!reuse) return true;
      if (
        reuse.quantity !== write.quantity ||
        reuse.order !== order ||
        reuse.materialMakeMethodId !== (childMethod?.id ?? null)
      ) {
        return true;
      }
      order += 1;
    }
    // A leftover line would be removed.
    return [...reusable.values()].some((queue) => queue.length > 0);
  };
  const unchangedItemIds = new Set<string>();

  for (const planned of plan.methods) {
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    if (!parentItem) continue;
    if (
      targetMethodByItemId.has(parentItem.id) ||
      unchangedItemIds.has(parentItem.id)
    ) {
      continue;
    }
    const method = methodByItemId.get(parentItem.id);
    if (!method) continue; // reported in the write loop
    if (method.status !== "Active") {
      if (!refusalByItemId.has(parentItem.id)) {
        targetMethodByItemId.set(parentItem.id, method.id);
      }
      continue;
    }
    if (
      !reusableDraftByItemId.has(parentItem.id) &&
      !linesWouldChange(planned, method.id)
    ) {
      unchangedItemIds.add(parentItem.id);
      continue;
    }
    // Checked before a Draft is made, so a refusal leaves no Draft behind.
    if (refusalByItemId.has(parentItem.id)) continue;
    const draft = await ensureDraftMakeMethod(client, ctx.asSystem.pg, {
      itemId: parentItem.id,
      activeMethodId: method.id,
      companyId,
      userId,
      reusableDraft: reusableDraftByItemId.get(parentItem.id) ?? null
    });
    if (!draft.ok) {
      methodErrorByItemId.set(parentItem.id, draft.error);
      continue;
    }
    targetMethodByItemId.set(parentItem.id, draft.id);
    if (draft.created) {
      summary.draftVersionsCreated.push(
        draft.version === null
          ? planned.parentPartNumber
          : `${planned.parentPartNumber} (version ${draft.version})`
      );
    }
  }

  // A failed read must stop the writes, or every Onshape line is duplicated.
  let ownership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    ownership = await loadMethodLineOwnership(client, serviceRole, companyId, [
      ...new Set([
        ...[...methodByItemId.values()].map((method) => method.id),
        ...targetMethodByItemId.values()
      ])
    ]);
  } catch (error) {
    return panelReply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the existing BOM lines"
      },
      { status: 500 }
    );
  }

  for (const planned of plan.methods) {
    const parentLabel = planned.parentPartNumber;
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    if (!parentItem) continue;

    const method = methodByItemId.get(parentItem.id);
    if (!method) {
      summary.errors.push(`${parentLabel}: no make method found`);
      continue;
    }
    if (unchangedItemIds.has(parentItem.id)) {
      summary.linesUnchanged += planned.writes.filter(
        (write) => !excluded.has(write.partNumber)
      ).length;
      continue;
    }
    const refusal = refusalByItemId.get(parentItem.id);
    if (refusal) {
      summary.skipped.push(`${parentLabel}: ${refusal}`);
      continue;
    }
    const methodId = targetMethodByItemId.get(parentItem.id);
    if (!methodId) {
      summary.errors.push(
        `${parentLabel}: ${methodErrorByItemId.get(parentItem.id) ?? "no make method to write to"}`
      );
      continue;
    }

    // Owned lines are updated in place so Carbon's columns (operation, scrap,
    // tags, kit, customFields) survive; FIFO per item keeps a repeated component's lines.
    const reusableByItemId = new Map<string, MappedLineRow[]>();
    for (const row of ownership.mappedRows.get(methodId) ?? []) {
      const queue = reusableByItemId.get(row.itemId) ?? [];
      queue.push(row);
      reusableByItemId.set(row.itemId, queue);
    }
    // Manual lines pair by part number in line order, as `pairManualLines` does at plan.
    const manualByReadableId = new Map<string, ManualLineRow[]>();
    for (const row of ownership.manualRows.get(methodId) ?? []) {
      const queue = manualByReadableId.get(row.readableId) ?? [];
      queue.push(row);
      manualByReadableId.set(row.readableId, queue);
    }
    // Mapping rows this method still owns; any other is cleared as an orphan.
    const liveMappingIds: string[] = [];
    const pendingInserts: Array<{
      row: OwnedMethodLine["row"];
      metadata: Record<string, unknown>;
    }> = [];

    summary.methodsTouched += 1;

    let order = 0;
    for (const write of planned.writes) {
      if (excluded.has(write.partNumber)) continue;
      const childItem = itemByReadableId.get(write.partNumber);
      if (!childItem) continue;

      const itemType = bomLineItemType(childItem);
      if (!itemType) {
        summary.errors.push(
          `${parentLabel} → ${write.partNumber}: a ${childItem.type ?? "Part"} cannot be a BOM line`
        );
        continue;
      }

      const childMade = isAssemblyByPartNumber.get(write.partNumber) === true;
      const childMethod = childMethodFor(childItem, childMade);
      const lineSyncedAt = datetime.timestamp();
      const lineMetadata = {
        makeMethodId: methodId,
        documentId,
        elementId,
        partNumber: write.partNumber,
        index: write.index
      };

      // Onshape owns quantity, order and the child-method pointer; method type,
      // sourcing and unit come from the item, at insert only.
      const reuse = reusableByItemId.get(childItem.id)?.shift();
      if (reuse) {
        // Unchanged lines are not written, so the audit log shows no edit.
        const unchanged =
          reuse.quantity === write.quantity &&
          reuse.order === order &&
          reuse.materialMakeMethodId === (childMethod?.id ?? null);
        if (unchanged) {
          liveMappingIds.push(reuse.mappingId);
          order += 1;
          summary.linesUnchanged += 1;
          continue;
        }
        const updated = await client
          .from("methodMaterial")
          .update({
            quantity: write.quantity,
            materialMakeMethodId: childMethod?.id ?? null,
            order,
            updatedBy: userId,
            updatedAt: lineSyncedAt
          })
          .eq("id", reuse.lineId)
          .eq("companyId", companyId);
        if (updated.error) {
          summary.errors.push(
            `${parentLabel} → ${write.partNumber}: ${updated.error.message}`
          );
          // Keep its ownership row, or the next push reads it as manual.
          liveMappingIds.push(reuse.mappingId);
          order += 1;
          continue;
        }
        const remapped = await serviceRole
          .from("externalIntegrationMapping")
          .update({
            metadata: lineMetadata,
            lastSyncedAt: lineSyncedAt,
            updatedBy: userId,
            updatedAt: lineSyncedAt
          })
          .eq("id", reuse.mappingId)
          .eq("companyId", companyId);
        if (remapped.error) {
          summary.errors.push(
            `${parentLabel} → ${write.partNumber}: line updated but its Onshape link was not refreshed (${remapped.error.message})`
          );
        }
        liveMappingIds.push(reuse.mappingId);
        order += 1;
        summary.linesWritten += 1;
        continue;
      }

      // Same item type only: a Material sharing a Part's number is a different item.
      const queue = manualByReadableId.get(write.partNumber);
      const claimIndex =
        queue?.findIndex((row) => !row.itemType || row.itemType === itemType) ??
        -1;
      const claim =
        queue && claimIndex >= 0 ? queue.splice(claimIndex, 1)[0] : undefined;
      if (claim) {
        const claimed = await claimManualMethodLine(db, {
          companyId,
          userId,
          lineId: claim.lineId,
          update: {
            itemId: childItem.id,
            quantity: write.quantity,
            order,
            materialMakeMethodId: childMethod?.id ?? null
          },
          metadata: lineMetadata
        });
        if (claimed.error !== null) {
          summary.errors.push(
            `${parentLabel} → ${write.partNumber}: the line added by hand was not taken over (${claimed.error})`
          );
          continue;
        }
        liveMappingIds.push(claimed.mappingId);
        order += 1;
        summary.linesWritten += 1;
        summary.linesTakenOver += 1;
        continue;
      }

      pendingInserts.push({
        row: {
          itemId: childItem.id,
          quantity: write.quantity,
          makeMethodId: methodId,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as OwnedMethodLine["row"]["methodType"]) ??
            (childMade ? "Make to Order" : "Pull from Inventory"),
          sourcingType:
            (childItem.sourcingType as OwnedMethodLine["row"]["sourcingType"]) ??
            "Specified",
          order,
          itemType,
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? fallbackUnit
        },
        metadata: lineMetadata
      });
      order += 1;
    }

    if (pendingInserts.length > 0) {
      const written = await insertOwnedMethodLines(db, {
        companyId,
        userId,
        lines: pendingInserts.map((pending) => ({
          row: pending.row,
          metadata: pending.metadata
        }))
      });
      if (written.error !== null) {
        summary.errors.push(
          `${parentLabel}: ${pendingInserts.length} new lines were not written (${written.error})`
        );
      } else {
        summary.linesWritten += pendingInserts.length;
        liveMappingIds.push(...written.mappingIds);
      }
    }

    // Anything still queued is a component the Onshape BOM no longer has.
    const removed = [...reusableByItemId.values()].flat();
    if (removed.length > 0) {
      for (const batch of chunkFilterValues(removed.map((row) => row.lineId))) {
        const removedLines = await client
          .from("methodMaterial")
          .delete()
          .eq("companyId", companyId)
          .in("id", batch);
        if (removedLines.error) {
          summary.errors.push(
            `${parentLabel}: could not remove the lines Onshape no longer lists (${removedLines.error.message})`
          );
          const failed = new Set(batch);
          for (const row of removed) {
            if (failed.has(row.lineId)) liveMappingIds.push(row.mappingId);
          }
        }
      }
    }

    // Orphans are filtered here: a `not in` filter puts every live id in the URL.
    const methodMappings = await serviceRole
      .from("externalIntegrationMapping")
      .select("id")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "methodMaterial")
      .eq("metadata->>makeMethodId", methodId);
    if (methodMappings.error) {
      summary.errors.push(
        `${parentLabel}: could not read the existing line ownership records (${methodMappings.error.message})`
      );
    } else {
      const live = new Set(liveMappingIds);
      const orphaned = (methodMappings.data ?? [])
        .map((row) => row.id)
        .filter((id) => !live.has(id));
      for (const batch of chunkFilterValues(orphaned)) {
        const clearedMappings = await serviceRole
          .from("externalIntegrationMapping")
          .delete()
          .eq("companyId", companyId)
          .in("id", batch);
        if (clearedMappings.error) {
          summary.errors.push(
            `${parentLabel}: could not clear orphaned line ownership records (${clearedMappings.error.message})`
          );
        }
      }
    }
  }

  // A root released in Carbon keeps the link and model its release gave it.
  if (root.released) {
    summary.skipped.push(
      `${root.partNumber}: released in Carbon as Rev ${root.released.revision}; its fields, link and model stay as its release left them`
    );
    const childLinkProblems = await linkChildParts(client, serviceRole, {
      companyId,
      userId,
      nodes: allNodes,
      itemByReadableId
    });
    summary.errors.push(...childLinkProblems);
    return panelReply(
      { summary },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const pushedAt = datetime.timestamp();
  const assemblyExternalId = externalIdForAssembly(
    documentId,
    elementId,
    configuration
  );
  const assemblyMapping = await swapItemMapping(db, {
    companyId,
    userId,
    itemId: rootItem.id,
    externalId: assemblyExternalId,
    metadata: {
      documentId,
      elementId,
      configuration,
      wv,
      wvId,
      kind: "assembly",
      partNumber: root.partNumber,
      name: root.name,
      pushedBy: userId,
      pushedAt,
      planId
    }
  });
  if (assemblyMapping.error !== null) {
    summary.errors.push(
      `${root.partNumber}: pushed, but not linked to Onshape (${assemblyMapping.error}); the next push will not recognise it`
    );
  }

  const childLinkProblems = await linkChildParts(client, serviceRole, {
    companyId,
    userId,
    nodes: allNodes,
    itemByReadableId
  });
  summary.errors.push(...childLinkProblems);

  try {
    await trigger(
      "onshape-panel-sync",
      {
        companyId,
        userId,
        itemId: rootItem.id,
        documentId,
        wvm: wv,
        wvmId: wvId,
        elementId,
        elementKind: "assembly",
        ...(configuration ? { configuration } : {}),
        assetBaseName: root.partNumber
      },
      { id: `${planId}:${rootItem.id}:${elementId}` }
    );
  } catch {
    summary.errors.push(
      `${root.partNumber}: pushed, but the model export couldn't be queued. Push again to retry the export.`
    );
  }

  return panelReply({ summary }, { headers: { "Cache-Control": "no-store" } });
}

async function linkChildParts(
  client: SupabaseClient<Database>,
  serviceRole: SupabaseClient<Database>,
  input: {
    companyId: string;
    userId: string;
    nodes: OnshapeBomNode[];
    itemByReadableId: Map<string, { id: string; readableId: string }>;
  }
) {
  // Links only where neither the item nor the source is linked: a part push owns that link.
  const candidates: Array<{
    itemId: string;
    externalId: string;
    partNumber: string;
    source: NonNullable<OnshapeBomNode["itemSource"]>;
  }> = [];
  const seen = new Set<string>();
  for (const node of input.nodes) {
    const source = node.itemSource;
    if (!node.partNumber) continue;
    const externalId = externalIdForBomLine(source);
    if (!source || !externalId) continue;
    const item = input.itemByReadableId.get(node.partNumber);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push({
      itemId: item.id,
      externalId,
      partNumber: node.partNumber,
      source
    });
  }
  if (candidates.length === 0) return [];

  // One Onshape source claimed by two items is reported, not guessed at.
  const itemsByExternalId = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const items = itemsByExternalId.get(candidate.externalId) ?? new Set();
    items.add(candidate.itemId);
    itemsByExternalId.set(candidate.externalId, items);
  }
  const problems: string[] = [];
  const ambiguous = new Set(
    [...itemsByExternalId.entries()]
      .filter(([, items]) => items.size > 1)
      .map(([externalId]) => externalId)
  );
  for (const externalId of ambiguous) {
    const numbers = candidates
      .filter((candidate) => candidate.externalId === externalId)
      .map((candidate) => candidate.partNumber);
    problems.push(
      `${numbers.join(" and ")} come from the same Onshape part, so neither was linked to it`
    );
  }
  const unambiguous = candidates.filter(
    (candidate) => !ambiguous.has(candidate.externalId)
  );
  if (unambiguous.length === 0) return problems;

  const [byEntity, byExternal] = await Promise.all([
    selectInBatches(
      unambiguous.map((candidate) => candidate.itemId),
      (batch) =>
        serviceRole
          .from("externalIntegrationMapping")
          .select("entityId")
          .eq("companyId", input.companyId)
          .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
          .eq("entityType", "item")
          .in("entityId", batch)
    ),
    selectInBatches(
      unambiguous.map((candidate) => candidate.externalId),
      (batch) =>
        serviceRole
          .from("externalIntegrationMapping")
          .select("externalId")
          .eq("companyId", input.companyId)
          .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
          .eq("entityType", "item")
          .in("externalId", batch)
    )
  ]);
  // A failed read is not "no links": that would claim links a part push owns.
  if (byEntity.error || byExternal.error) {
    return [
      ...problems,
      `child parts were not linked to Onshape: ${
        (byEntity.error ?? byExternal.error)?.message ?? "lookup failed"
      }`
    ];
  }
  const linkedItemIds = new Set(
    (byEntity.data ?? []).map((row) => row.entityId)
  );
  const usedExternalIds = new Set(
    (byExternal.data ?? []).map((row) => row.externalId)
  );

  const linkedAt = datetime.timestamp();
  const rows = unambiguous
    .filter(
      (candidate) =>
        !linkedItemIds.has(candidate.itemId) &&
        !usedExternalIds.has(candidate.externalId)
    )
    .map((candidate) => ({
      entityType: "item" as const,
      entityId: candidate.itemId,
      integration: ONSHAPE_V2_INTEGRATION_ID,
      externalId: candidate.externalId,
      metadata: {
        documentId: candidate.source.documentId,
        elementId: candidate.source.elementId,
        partId: candidate.source.partId ?? null,
        configuration: normalizeConfiguration(candidate.source.configuration),
        kind: candidate.source.partId ? "part" : "assembly",
        partNumber: candidate.partNumber,
        viaAssemblyPush: true,
        pushedBy: input.userId,
        pushedAt: linkedAt
      },
      lastSyncedAt: linkedAt,
      companyId: input.companyId,
      createdBy: input.userId
    }));
  if (rows.length === 0) return problems;

  // The bulk insert is all-or-nothing; on refusal retry row by row, so one
  // conflicting row (a concurrent push's link) does not block the rest.
  const linked = await client.from("externalIntegrationMapping").insert(rows);
  if (!linked.error) return problems;

  const failed: string[] = [];
  for (const row of rows) {
    const single = await client.from("externalIntegrationMapping").insert(row);
    if (single.error) failed.push(row.metadata.partNumber);
  }
  if (failed.length > 0) {
    problems.push(
      `${failed.length} part${failed.length === 1 ? "" : "s"} could not be linked to Onshape (${failed
        .slice(0, 5)
        .join(", ")}${failed.length > 5 ? ", …" : ""}); push again to retry`
    );
  }
  return problems;
}

export const onshapeReleasePushInput = z.object({
  planId: z.string().min(1),
  edits: z.record(z.string(), itemEditSchema).default({}),
  changeNotice: z
    .object({
      name: z.string().optional(),
      description: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  makeDefault: z.boolean().optional(),
  createChangeNotice: z.boolean().optional()
});

type ReleasePushSummary = {
  releaseName: string | null;
  revisionsCreated: number;
  itemsCreated: number;
  /** BOM children the push created; not on the change notice. */
  childrenCreated: number;
  drawingsQueued: number;
  drawingsOnly: boolean;
  reused: number;
  linesWritten: number;
  methodsTouched: number;
  defaultsUpdated: number;
  changeNotice: string | null;
  alreadyPushed: boolean;
  skipped: string[];
  errors: string[];
};

type ReleasePushItemRow = {
  id: string;
  readableId: string;
  revision: string;
  active?: boolean | null;
  name: string;
  type: string | null;
  defaultMethodType: string | null;
  sourcingType: string | null;
  unitOfMeasureCode: string | null;
};

type CreatedEntry = {
  partNumber: string;
  revision: string;
  itemId: string;
  baseItemId: string | null;
};

function partInsert(
  proposed: ProposedItem,
  companyId: string,
  userId: string,
  customFields: PlanCustomField[] | undefined
) {
  const values = mappedFieldValues(customFields ?? [], true).values;
  return {
    id: proposed.readableId,
    name: proposed.name,
    description: proposed.description ?? undefined,
    revision: proposed.revision,
    replenishmentSystem: proposed.replenishmentSystem,
    defaultMethodType: proposed.defaultMethodType,
    itemTrackingType: proposed.itemTrackingType,
    unitOfMeasureCode: proposed.unitOfMeasureCode,
    ...(Object.keys(values).length > 0 ? { customFields: values as Json } : {}),
    companyId,
    createdBy: userId
  } as any;
}

/** Apply a reviewed release plan; Carbon's state at apply time outranks the plan. */
export async function pushOnshapeRelease(
  ctx: ServiceContext,
  input: z.infer<typeof onshapeReleasePushInput>
): Promise<PanelReply> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { planId, changeNotice: changeNoticeEdit } = input;
  const edits = input.edits as Record<string, ItemEdit>;

  const stored = await peekPanelPlan(planId, { companyId, userId });
  if (!stored) {
    return panelReply(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }
  if (stored.plan.kind !== "release") {
    return panelReply(
      { error: "This review is not a release push" },
      { status: 400 }
    );
  }
  const plan = stored.plan as StoredReleasePlan;
  const makeDefault = input.makeDefault ?? plan.makeDefault;
  // Unset: a notice whenever this push creates something.
  const createChangeNoticeChoice = input.createChangeNotice;

  const merged = mergeEditsForCreates(
    [
      ...plan.items
        .filter((item) => item.action === "create" && item.proposed)
        .map((item) => ({
          key: item.partNumber,
          proposed: item.proposed as ProposedItem
        })),
      ...plan.children
        .filter((child) => child.action === "create" && child.proposed)
        .map((child) => ({
          key: child.partNumber,
          proposed: child.proposed as ProposedItem
        }))
    ],
    edits,
    plan.options
  );
  // A row that vanished since review becomes a create, so even a re-push needs notice values.
  const changeNoticeMerge = mergeChangeNoticeEdit(
    plan.changeNotice ?? {
      name: plan.releaseName ?? `Onshape release ${plan.releaseId}`,
      description: null
    },
    changeNoticeEdit
  );
  if (!changeNoticeMerge.ok) {
    return panelReply(
      {
        error: "Some edits are not valid",
        fieldErrors: [
          ...merged.errors,
          { key: "changeNotice", errors: changeNoticeMerge.errors }
        ]
      },
      { status: 422 }
    );
  }
  if (merged.errors.length > 0) {
    return panelReply(
      { error: "Some edits are not valid", fieldErrors: merged.errors },
      { status: 422 }
    );
  }
  const changeNoticeValues = changeNoticeMerge.changeNotice;

  const modelItems = plan.items.filter(isModelReleaseItem);
  const drawingItems = plan.items.filter((item) => !isModelReleaseItem(item));

  const summary: ReleasePushSummary = {
    releaseName: plan.releaseName,
    revisionsCreated: 0,
    itemsCreated: 0,
    childrenCreated: 0,
    drawingsQueued: 0,
    drawingsOnly: modelItems.length === 0,
    reused: 0,
    linesWritten: 0,
    methodsTouched: 0,
    defaultsUpdated: 0,
    changeNotice: null,
    alreadyPushed: false,
    skipped: [],
    errors: []
  };

  // A part number that is both a release item and a BOM child uses the release item's plan.
  type PlannedRow = MappedRowPlan & {
    current?: ItemFieldSnapshot | null;
    changes?: OwnedFieldChange[];
  };
  const plannedByPartNumber = new Map<string, PlannedRow>();
  for (const child of plan.children) {
    if (child.current) plannedByPartNumber.set(child.partNumber, child);
  }
  for (const item of plan.items) {
    if (item.current) plannedByPartNumber.set(item.partNumber, item);
  }
  // Written at insert. A revision shares its base's `part` row: no create-time values.
  const createdFieldsByPartNumber = new Map<string, PlanCustomField[]>();
  for (const row of [...plan.children, ...plan.items]) {
    if (row.action === "create" && row.customFields) {
      createdFieldsByPartNumber.set(row.partNumber, row.customFields);
    }
  }
  const fieldEditsApplied = new Set<string>();
  /** Writes the plan's values to an item the push did not create; updates `row` in place. */
  const applyItemFieldEdit = async (
    partNumber: string,
    row: ReleasePushItemRow
  ) => {
    if (fieldEditsApplied.has(partNumber)) return;
    const planned = plannedByPartNumber.get(partNumber);
    if (!planned?.current) return;
    fieldEditsApplied.add(partNumber);
    const applied = await applyExistingItemFields(client, db, {
      itemId: row.id,
      companyId,
      userId,
      current: planned.current,
      target: planned.target,
      edit: edits[partNumber],
      descriptions: planned.changes
    });
    if (applied.error) {
      summary.errors.push(`${partNumber}: ${applied.error}`);
      return;
    }
    if (applied.values) {
      row.defaultMethodType = applied.values.defaultMethodType;
      row.sourcingType = applied.values.sourcingType ?? row.sourcingType;
      row.unitOfMeasureCode =
        applied.values.unitOfMeasureCode ?? row.unitOfMeasureCode;
    }
    const values = mappedFieldValues(planned.customFields ?? [], false);
    if (values.fieldIds.size === 0) return;
    const held = await client
      .from("part")
      .select("customFields")
      .eq("id", partNumber)
      .eq("companyId", companyId)
      .maybeSingle();
    if (held.error) {
      summary.errors.push(
        `${partNumber}: failed to read custom fields (${held.error.message})`
      );
      return;
    }
    const updated = await client
      .from("part")
      .update({
        customFields: mergeCustomFieldValues(
          held.data?.customFields,
          values.values,
          values.fieldIds
        ) as Json,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .eq("id", partNumber)
      .eq("companyId", companyId);
    if (updated.error) {
      summary.errors.push(
        `${partNumber}: failed to write custom fields (${updated.error.message})`
      );
    }
  };
  /** The values `upsertPart` does not take: MPN and Sourcing. */
  const writeCreatedExtras = async (
    label: string,
    itemId: string,
    proposed: ProposedItem
  ) => {
    const extras = createdItemExtras(proposed);
    if (Object.keys(extras).length === 0) return;
    const error = await applyItemFieldWrites(client, db, {
      itemId,
      companyId,
      userId,
      changed: extras
    });
    if (error) {
      summary.errors.push(
        `${label}: created, but its mapped fields were not written (${error})`
      );
    }
  };

  // Every revision of every part number, re-read: the plan may be minutes old.
  const partNumbers = [
    ...new Set([
      ...modelItems.map((item) => item.partNumber),
      ...Object.values(plan.bomLinesByElementId)
        .flatMap((lines) => (lines ?? []).map((line) => line.partNumber))
        .filter((partNumber): partNumber is string => !!partNumber)
    ])
  ];
  const existing = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, name, type, defaultMethodType, sourcingType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return panelReply(
      { error: "Failed to read Carbon items" },
      { status: 500 }
    );
  }
  const byReadable = new Map<string, ReleasePushItemRow[]>();
  const rememberRow = (row: ReleasePushItemRow) => {
    const list = byReadable.get(row.readableId) ?? [];
    list.push(row);
    byReadable.set(row.readableId, list);
  };
  for (const row of (existing.data ?? []) as ReleasePushItemRow[])
    rememberRow(row);
  const letterRowFor = (partNumber: string, revision: string) =>
    (byReadable.get(partNumber) ?? []).find((row) => row.revision === revision);

  const created: CreatedEntry[] = [];
  const revisionItemByPartNumber = new Map<string, ReleasePushItemRow>();

  // The base the plan pinned is honoured while its row exists.
  type Decision =
    | { item: ReleasePlanItem; kind: "reuse"; row: ReleasePushItemRow }
    | { item: ReleasePlanItem; kind: "revision"; base: ReleasePushItemRow }
    | { item: ReleasePlanItem; kind: "create"; proposed: ProposedItem };
  const decisions: Decision[] = modelItems.map((item): Decision => {
    const existingLetter = letterRowFor(item.partNumber, item.revision);
    if (existingLetter) return { item, kind: "reuse", row: existingLetter };
    const bases = byReadable.get(item.partNumber) ?? [];
    const base =
      bases.find((row) => row.id === item.baseItemId) ??
      pickRevisionBase(bases, item.revision);
    if (base) return { item, kind: "revision", base };
    return {
      item,
      kind: "create",
      proposed:
        merged.items.get(item.partNumber) ??
        proposeItem(
          { partNumber: item.partNumber, name: null, revision: item.revision },
          plan.options
        )
    };
  });

  // An assembly whose BOM was not read at review is not minted: a revision would
  // carry the base's Onshape lines unmapped, and a new item would have no BOM.
  for (const decision of decisions) {
    if (
      decision.kind !== "reuse" &&
      decision.item.elementType === 1 &&
      plan.bomLinesByElementId[releaseBomKey(decision.item)] === null
    ) {
      summary.errors.push(
        `${decision.item.partNumber} Rev ${decision.item.revision}: the BOM was not read at review — review and push again`
      );
    }
  }
  const applicable = decisions.filter(
    (decision) =>
      decision.kind === "reuse" ||
      decision.item.elementType !== 1 ||
      plan.bomLinesByElementId[releaseBomKey(decision.item)] !== null
  );
  decisions.length = 0;
  decisions.push(...applicable);

  const baseIds = [
    ...new Set(
      decisions.flatMap((decision) =>
        decision.kind === "revision" ? [decision.base.id] : []
      )
    )
  ];
  type FullItem = NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>;
  const fullBaseById = new Map<string, FullItem>();
  const bases = await selectInBatches(baseIds, (batch) =>
    client.from("item").select("*").eq("companyId", companyId).in("id", batch)
  );
  // A failed read would look like "no base" and skip revisions: a partial push.
  if (bases.error) {
    return panelReply(
      { error: "Failed to read the base revisions" },
      { status: 500 }
    );
  }
  for (const row of bases.data as FullItem[]) {
    fullBaseById.set(row.id, row);
  }

  // `createRevision` copies the base's lines without mapping rows. Key the base's
  // Onshape lines now: after the revision exists, a failed read leaves manual-looking copies.
  const assemblyBaseIds = [
    ...new Set(
      decisions.flatMap((decision) =>
        decision.kind === "revision" && decision.item.elementType === 1
          ? [decision.base.id]
          : []
      )
    )
  ];
  const lineKey = (line: { itemId: string; order: number; quantity: number }) =>
    `${line.itemId}:${line.order}:${line.quantity}`;
  let baseMethodByItemId: Awaited<ReturnType<typeof loadActiveMakeMethods>>;
  try {
    baseMethodByItemId = await loadActiveMakeMethods(
      client,
      companyId,
      assemblyBaseIds
    );
  } catch (error) {
    return panelReply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the base revisions' make methods"
      },
      { status: 500 }
    );
  }
  const serviceRole = getCarbonServiceRole();
  const db = ctx.asSystem.pg;
  const copiedKeysByBaseMethodId = new Map<string, Set<string>>();
  const baseMethodIds = [
    ...new Set([...baseMethodByItemId.values()].map((method) => method.id))
  ];
  if (baseMethodIds.length > 0) {
    const baseMapped = await selectInBatches(baseMethodIds, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("entityId")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
        .eq("entityType", "methodMaterial")
        .in("metadata->>makeMethodId", batch)
    );
    const baseLines = baseMapped.error
      ? null
      : await selectInBatches(
          baseMapped.data.map((mapping) => mapping.entityId),
          (batch) =>
            client
              .from("methodMaterial")
              .select("makeMethodId, itemId, order, quantity")
              .eq("companyId", companyId)
              .in("id", batch)
        );
    const baseReadError = baseMapped.error ?? baseLines?.error;
    if (baseReadError || !baseLines) {
      return panelReply(
        {
          error: `Couldn't identify the Onshape lines on the base revisions (${
            baseReadError?.message ?? "read failed"
          }); nothing was written. Try again.`
        },
        { status: 500 }
      );
    }
    for (const line of baseLines.data) {
      const keys =
        copiedKeysByBaseMethodId.get(line.makeMethodId) ?? new Set<string>();
      keys.add(lineKey(line));
      copiedKeysByBaseMethodId.set(line.makeMethodId, keys);
    }
  }

  // A reused revision held by a change notice whose engineering content is
  // locked (Implementation onward, or awaiting approval) takes no writes: not
  // its fields, not its BOM. A method's changeOrderId is cleared at release, so
  // a set one means a notice holds the item now.
  const lockedByItemId = new Map<string, string>();
  const reusedItemIds = decisions.flatMap((decision) =>
    decision.kind === "reuse" ? [decision.row.id] : []
  );
  if (reusedItemIds.length > 0) {
    const held = await selectInBatches(reusedItemIds, (batch) =>
      client
        .from("makeMethod")
        .select("itemId, changeOrderId, changeOrder(changeOrderId)")
        .eq("companyId", companyId)
        .in("itemId", batch)
        .not("changeOrderId", "is", null)
    );
    if (held.error) {
      return panelReply(
        {
          error: `Couldn't check the change notices that hold the existing revisions (${held.error.message}); nothing was written. Try again.`
        },
        { status: 500 }
      );
    }
    const noticeIds = [
      ...new Set(
        held.data.flatMap((method) =>
          method.changeOrderId ? [method.changeOrderId] : []
        )
      )
    ];
    // One check per notice; a release's revisions share one or two.
    const lockByNoticeId = new Map(
      await Promise.all(
        noticeIds.map(
          async (changeNoticeId) =>
            [
              changeNoticeId,
              (
                await requireChangeNoticeEditable(client, {
                  changeNoticeId,
                  companyId,
                  scope: "engineering"
                })
              )?.error.message ?? null
            ] as const
        )
      )
    );
    for (const method of held.data) {
      const lock = method.changeOrderId
        ? lockByNoticeId.get(method.changeOrderId)
        : null;
      if (!lock || lockedByItemId.has(method.itemId)) continue;
      const notice = method.changeOrder?.changeOrderId;
      lockedByItemId.set(
        method.itemId,
        notice ? `change notice ${notice}: ${lock}` : lock
      );
    }
  }

  // The notice exists before the first item write, so each item is staged as it
  // is written. A second document of the same release reuses the open notice.
  // Read before the take: a failed read must not open a second notice.
  const needsNotice =
    (createChangeNoticeChoice ?? true) &&
    decisions.some((decision) => decision.kind !== "reuse");
  const openNotice = needsNotice
    ? await findOpenReleaseNotice(client, companyId, plan.releaseId)
    : { data: null, error: null };
  if (openNotice.error !== null) {
    return panelReply(
      {
        error: `${openNotice.error}, so it can't tell which change notice to add to; nothing was written. Try again.`
      },
      { status: 500 }
    );
  }

  // Taken after the reads the writes depend on, so a failed read keeps the review;
  // one-shot, so a concurrent apply of the same review finds nothing.
  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return panelReply(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  let changeNotice: { id: string; changeNoticeId: string } | null = null;
  let noticeReused = false;
  let noticeSortOrder = 0;
  if (openNotice.data) {
    changeNotice = {
      id: openNotice.data.id,
      changeNoticeId: openNotice.data.changeNoticeId
    };
    noticeReused = true;
    noticeSortOrder = openNotice.data.affectedCount;
    summary.changeNotice = openNotice.data.changeNoticeId;
  } else if (needsNotice) {
    const description = changeNoticeDescriptionJson(
      changeNoticeValues.description
    );
    const inserted = await insertChangeNotice(client, {
      companyId,
      createdBy: userId,
      name: changeNoticeValues.name,
      // Tiptap JSON; omitted, not nulled, when empty.
      ...(description ? { description: description as Json } : {}),
      openDate: datetime
        .today(await sharedService.getCompanyTimeZone(client, companyId))
        .toString()
    });
    if (inserted.error || !inserted.data) {
      return panelReply(
        {
          error: `Couldn't create the change notice (${
            inserted.error?.message ?? "no row returned"
          }); nothing was written. Review and push again.`
        },
        { status: 500 }
      );
    }
    changeNotice = inserted.data;
    summary.changeNotice = inserted.data.changeNoticeId;
  }
  // An item the notice could not take is removed: left in place it is outside
  // change control, and a re-push would reuse it instead of staging it. The
  // service role removes it because the pusher may lack parts_delete.
  const stageInNotice = async (
    label: string,
    itemId: string,
    baseItemId: string | null
  ): Promise<boolean> => {
    if (!changeNotice) return true;
    const staged = await stageChangeNoticeItem(db, {
      changeOrderId: changeNotice.id,
      companyId,
      userId,
      itemId,
      baseItemId,
      sortOrder: noticeSortOrder
    });
    if (!staged.error) {
      noticeSortOrder += 1;
      return true;
    }
    const notice = changeNotice.changeNoticeId;
    const removed = await deleteItem(serviceRole, db, itemId, companyId);
    summary.errors.push(
      removed.error
        ? `${label}: created but not added to change notice ${notice} (${staged.error}), and could not be removed (${removed.error.message}). Delete it in Carbon, then push again.`
        : `${label}: not created, because it could not be added to change notice ${notice} (${staged.error}). Push again.`
    );
    return false;
  };

  for (const decision of decisions) {
    const { item } = decision;
    if (decision.kind === "reuse") {
      summary.reused += 1;
      revisionItemByPartNumber.set(item.partNumber, decision.row);
      const lock = lockedByItemId.get(decision.row.id);
      if (lock) {
        // Also keeps the BOM-child pass from writing its fields.
        fieldEditsApplied.add(item.partNumber);
        summary.skipped.push(
          `${item.partNumber} Rev ${item.revision}: ${lock} Its fields and BOM were left as they are.`
        );
        continue;
      }
      await applyItemFieldEdit(item.partNumber, decision.row);
      continue;
    }

    let row: ReleasePushItemRow | null = null;
    if (decision.kind === "revision") {
      const full = fullBaseById.get(decision.base.id);
      if (!full) {
        summary.errors.push(`${item.partNumber}: failed to read the base item`);
        continue;
      }
      const inserted = await createRevision(client, db, {
        item: full,
        revision: item.revision,
        createdBy: userId,
        active: !changeNotice
      });
      if (inserted.error || !inserted.data) {
        summary.errors.push(
          `${item.partNumber}: ${
            inserted.error?.message ?? "failed to create the revision"
          }`
        );
        continue;
      }
      if (
        !(await stageInNotice(
          `${item.partNumber} Rev ${item.revision}`,
          inserted.data.id,
          decision.base.id
        ))
      ) {
        continue;
      }
      row = {
        id: inserted.data.id,
        readableId: item.partNumber,
        revision: item.revision,
        name: full.name,
        type: full.type,
        defaultMethodType: full.defaultMethodType ?? "Make to Order",
        sourcingType: full.sourcingType ?? null,
        unitOfMeasureCode: full.unitOfMeasureCode ?? "EA"
      };
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: decision.base.id
      });
      summary.revisionsCreated += 1;
    } else {
      // Safe with `upsertPart`'s readback by readableId: no other revision exists.
      const { proposed } = decision;
      const insertedItem = await upsertPart(
        client,
        partInsert(
          proposed,
          companyId,
          userId,
          createdFieldsByPartNumber.get(item.partNumber)
        )
      );
      if (insertedItem.error || !insertedItem.data) {
        summary.errors.push(
          `${item.partNumber}: ${
            insertedItem.error?.message ?? "failed to create the item"
          }`
        );
        continue;
      }
      row = {
        id: insertedItem.data.id as string,
        readableId: item.partNumber,
        revision: item.revision,
        name: proposed.name,
        type: "Part",
        defaultMethodType: proposed.defaultMethodType,
        sourcingType: proposed.sourcingType ?? null,
        unitOfMeasureCode: proposed.unitOfMeasureCode
      };
      await writeCreatedExtras(item.partNumber, row.id, proposed);
      if (
        !(await stageInNotice(
          `${item.partNumber} Rev ${item.revision}`,
          row.id,
          null
        ))
      ) {
        continue;
      }
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: null
      });
      summary.itemsCreated += 1;
    }

    revisionItemByPartNumber.set(item.partNumber, row);
    rememberRow(row);
    await applyItemFieldEdit(item.partNumber, row);
  }

  summary.alreadyPushed = created.length === 0;
  if (changeNotice && !noticeReused && created.length === 0) {
    const dropped = await deleteChangeNotice(
      client,
      db,
      changeNotice.id,
      companyId
    );
    if (dropped.error) {
      summary.errors.push(
        `Change notice ${changeNotice.changeNoticeId} is empty and could not be removed (${dropped.error.message})`
      );
    } else {
      summary.changeNotice = null;
    }
    changeNotice = null;
  }

  // Any BOM read failure skips every BOM write: writing on a partial read
  // duplicates or orphans lines.
  let bomReadFailure: string | null = null;

  const methodByItemId = new Map(baseMethodByItemId);
  try {
    for (const [itemId, method] of await loadActiveMakeMethods(
      client,
      companyId,
      [
        ...[...revisionItemByPartNumber.values()].map((row) => row.id),
        ...created.flatMap((entry) =>
          entry.baseItemId ? [entry.baseItemId] : []
        )
      ]
    )) {
      methodByItemId.set(itemId, method);
    }
  } catch (error) {
    bomReadFailure =
      error instanceof Error ? error.message : "failed to read make methods";
  }

  type BomTarget = {
    item: ReleasePlanItem;
    label: string;
    methodId: string;
    lines: OnshapeBomNode[];
    /** The base method whose Onshape-origin lines the revision copy carries. */
    baseMethodId: string | null;
  };
  const bomTargets: BomTarget[] = [];
  for (const item of bomReadFailure
    ? []
    : modelItems.filter((candidate) => candidate.elementType === 1)) {
    const target = revisionItemByPartNumber.get(item.partNumber);
    if (!target) continue; // creation failed above; error already recorded
    const label = `${item.partNumber} Rev ${item.revision}`;

    const method = methodByItemId.get(target.id);
    if (!method) {
      summary.errors.push(`${label}: no make method found`);
      continue;
    }
    if (method.status === "Active") {
      summary.skipped.push(
        `${label}: make method is released in Carbon, so its BOM was left as it is`
      );
      continue;
    }
    // Reported with its fields above.
    if (lockedByItemId.has(target.id)) continue;

    // null: the review could not read the BOM, so the method is left alone. An
    // empty BOM is [] and is applied.
    const lines = plan.bomLinesByElementId[releaseBomKey(item)];
    if (!lines) {
      summary.skipped.push(
        `${label}: the BOM was not read at review — review and push again`
      );
      continue;
    }

    const createdEntry = created.find(
      (candidate) =>
        candidate.partNumber === item.partNumber &&
        candidate.revision === item.revision
    );
    bomTargets.push({
      item,
      label,
      methodId: method.id,
      lines,
      baseMethodId: createdEntry?.baseItemId
        ? (methodByItemId.get(createdEntry.baseItemId)?.id ?? null)
        : null
    });
  }

  const childItemByPartNumber = new Map<string, ReleasePushItemRow>();
  const childFailed = new Set<string>();
  const releaseItemByPartNumber = new Map(
    modelItems.map((item) => [item.partNumber, item])
  );
  for (const target of bomTargets) {
    for (const child of target.lines) {
      if (!child.partNumber) continue;
      if (
        childItemByPartNumber.has(child.partNumber) ||
        childFailed.has(child.partNumber)
      ) {
        continue;
      }
      // A release item that was held back or failed (its error is reported
      // above) is neither created off the notice nor swapped for another revision.
      const releaseItem = releaseItemByPartNumber.get(child.partNumber);
      if (releaseItem && !revisionItemByPartNumber.has(child.partNumber)) {
        summary.errors.push(
          `${target.label} → ${child.partNumber}: line not written, because ${child.partNumber} Rev ${releaseItem.revision} was not pushed`
        );
        childFailed.add(child.partNumber);
        continue;
      }
      const existingChild =
        revisionItemByPartNumber.get(child.partNumber) ??
        pickBomChildRow(byReadable.get(child.partNumber) ?? [], child.revision)
          .row;
      if (existingChild) {
        childItemByPartNumber.set(child.partNumber, existingChild);
        await applyItemFieldEdit(child.partNumber, existingChild);
        continue;
      }
      const proposed =
        merged.items.get(child.partNumber) ??
        proposeItem(
          {
            partNumber: child.partNumber,
            name: child.name,
            description: child.description,
            revision: child.revision,
            hasChildren: child.children.length > 0,
            standardContent: child.standardContent === true
          },
          plan.options
        );
      const createdChild = await upsertPart(
        client,
        partInsert(
          proposed,
          companyId,
          userId,
          createdFieldsByPartNumber.get(child.partNumber)
        )
      );
      if (createdChild.error || !createdChild.data) {
        summary.errors.push(
          `${target.label} → ${child.partNumber}: ${
            createdChild.error?.message ?? "failed to create the item"
          }`
        );
        childFailed.add(child.partNumber);
        continue;
      }
      const childRow: ReleasePushItemRow = {
        id: createdChild.data.id as string,
        readableId: child.partNumber,
        revision: proposed.revision,
        name: proposed.name,
        type: "Part",
        defaultMethodType: proposed.defaultMethodType,
        sourcingType: proposed.sourcingType ?? null,
        unitOfMeasureCode: proposed.unitOfMeasureCode
      };
      await writeCreatedExtras(child.partNumber, childRow.id, proposed);
      childItemByPartNumber.set(child.partNumber, childRow);
      rememberRow(childRow);
      summary.childrenCreated += 1;
    }
  }

  const madeChildItemIds = [
    ...new Set(
      bomTargets.flatMap((target) =>
        target.lines.flatMap((child) => {
          if (!child.partNumber) return [];
          const row = childItemByPartNumber.get(child.partNumber);
          if (
            child.children.length === 0 &&
            row?.defaultMethodType !== "Make to Order"
          ) {
            return [];
          }
          return row && !methodByItemId.has(row.id) ? [row.id] : [];
        })
      )
    )
  ];
  if (!bomReadFailure) {
    try {
      for (const [itemId, method] of await loadActiveMakeMethods(
        client,
        companyId,
        madeChildItemIds
      )) {
        methodByItemId.set(itemId, method);
      }
    } catch (error) {
      // Without them every sub-assembly line gets a null method and flattens the tree.
      bomReadFailure =
        error instanceof Error
          ? error.message
          : "failed to read the sub-assemblies' make methods";
    }
  }

  // Delete the revision's copies of the base's Onshape lines (manual lines stay),
  // then the lines a previous push of this release wrote.
  const baseMethodIdByTargetMethodId = new Map<string, string>(
    bomTargets.flatMap(
      (target): Array<[string, string]> =>
        target.baseMethodId ? [[target.methodId, target.baseMethodId]] : []
    )
  );
  const copyTargetMethodIds = [...baseMethodIdByTargetMethodId.entries()]
    .filter(([, baseMethodId]) => copiedKeysByBaseMethodId.has(baseMethodId))
    .map(([targetMethodId]) => targetMethodId);
  const targetMethodIds = bomTargets.map((target) => target.methodId);
  const [copies, mapped] = bomReadFailure
    ? [null, null]
    : await Promise.all([
        selectInBatches(copyTargetMethodIds, (batch) =>
          client
            .from("methodMaterial")
            .select("id, makeMethodId, itemId, order, quantity")
            .eq("companyId", companyId)
            .in("makeMethodId", batch)
        ),
        selectInBatches(targetMethodIds, (batch) =>
          serviceRole
            .from("externalIntegrationMapping")
            .select("id, entityId")
            .eq("companyId", companyId)
            .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
            .eq("entityType", "methodMaterial")
            .in("metadata->>makeMethodId", batch)
        )
      ]);
  if (!bomReadFailure && (copies?.error || mapped?.error)) {
    bomReadFailure =
      (copies?.error ?? mapped?.error)?.message ?? "failed to read BOM lines";
  }

  if (bomReadFailure) {
    const carriesCopies = created.some((entry) => {
      const baseMethod = entry.baseItemId
        ? baseMethodByItemId.get(entry.baseItemId)
        : undefined;
      return !!baseMethod && copiedKeysByBaseMethodId.has(baseMethod.id);
    });
    summary.errors.push(
      `The released BOMs were not written: Carbon couldn't read what they replace (${bomReadFailure}). Push the release again.${
        carriesCopies
          ? " A revision this push created still carries its base revision's lines — check its bill of materials before pushing again."
          : ""
      }`
    );
    bomTargets.length = 0;
  }

  const toDelete = (copies?.data ?? [])
    .filter((line) => {
      const baseMethodId = baseMethodIdByTargetMethodId.get(line.makeMethodId);
      return (
        !!baseMethodId &&
        copiedKeysByBaseMethodId.get(baseMethodId)?.has(lineKey(line))
      );
    })
    .map((line) => line.id);
  for (const batch of bomReadFailure ? [] : chunkFilterValues(toDelete)) {
    const deduped = await client
      .from("methodMaterial")
      .delete()
      .eq("companyId", companyId)
      .in("id", batch);
    if (deduped.error) {
      summary.errors.push(
        `Could not remove the lines copied from the base revisions (${deduped.error.message}); released BOMs may contain duplicates`
      );
    }
  }

  if (mapped && !bomReadFailure) {
    const failedLineIds = new Set<string>();
    for (const batch of chunkFilterValues(
      mapped.data.map((mapping) => mapping.entityId)
    )) {
      const removedLines = await client
        .from("methodMaterial")
        .delete()
        .eq("companyId", companyId)
        .in("id", batch);
      if (removedLines.error) {
        for (const id of batch) failedLineIds.add(id);
        summary.errors.push(
          `Could not replace the lines a previous release push wrote (${removedLines.error.message}); this push may add a second copy of them`
        );
      }
    }
    for (const batch of chunkFilterValues(
      mapped.data
        .filter((mapping) => !failedLineIds.has(mapping.entityId))
        .map((mapping) => mapping.id)
    )) {
      const removedMappings = await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .eq("companyId", companyId)
        .in("id", batch);
      if (removedMappings.error) {
        summary.errors.push(
          `Could not clear the ownership records for the replaced released lines (${removedMappings.error.message})`
        );
      }
    }
  }
  summary.methodsTouched += bomTargets.length;

  // One level only: a sub-assembly gets its lines from its own release item.
  for (const target of bomTargets) {
    const { item, label, methodId } = target;
    const lines: OwnedMethodLine[] = [];
    for (const child of target.lines) {
      if (!child.partNumber) {
        summary.skipped.push(
          `${label} → ${child.name ?? child.index}: no part number in Onshape`
        );
        continue;
      }
      const childItem = childItemByPartNumber.get(child.partNumber);
      if (!childItem) continue; // creation failed above; error already recorded

      // A reused Material or Consumable keeps its type; a Tool or Service cannot be a line.
      const itemType = bomLineItemType(childItem);
      if (!itemType) {
        summary.errors.push(
          `${label} → ${child.partNumber}: a ${
            childItem.type ?? "Part"
          } item cannot be a BOM line`
        );
        continue;
      }

      const childMethod =
        child.children.length > 0 ||
        childItem.defaultMethodType === "Make to Order"
          ? methodByItemId.get(childItem.id)
          : null;
      lines.push({
        row: {
          itemId: childItem.id,
          quantity: child.quantity,
          makeMethodId: methodId,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as OwnedMethodLine["row"]["methodType"]) ??
            (child.children.length > 0
              ? "Make to Order"
              : "Pull from Inventory"),
          sourcingType:
            (childItem.sourcingType as OwnedMethodLine["row"]["sourcingType"]) ??
            "Specified",
          order: lines.length,
          itemType,
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? "EA"
        },
        metadata: {
          makeMethodId: methodId,
          documentId: plan.documentId,
          elementId: item.elementId,
          partNumber: child.partNumber,
          index: child.index,
          releaseId: plan.releaseId
        }
      });
    }
    const written = await insertOwnedMethodLines(db, {
      companyId,
      userId,
      lines
    });
    if (written.error !== null) {
      summary.errors.push(
        `${label}: the released BOM lines were not written (${written.error}); push the release again`
      );
    } else {
      summary.linesWritten += lines.length;
    }
  }

  // An item holds one Onshape link: a reused revision linked to its part or
  // assembly keeps that link, which status and change detection read.
  const reusedIds = decisions
    .filter((decision) => decision.kind === "reuse")
    .map((decision) => decision.row.id);
  const keepsLink = new Set<string>();
  if (reusedIds.length > 0) {
    const links = await selectInBatches(reusedIds, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("entityId, externalId")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
        .eq("entityType", "item")
        .in("entityId", batch)
    );
    if (links.error) {
      for (const id of reusedIds) keepsLink.add(id);
      summary.errors.push(
        `Could not read the Onshape links of existing revisions (${links.error.message}); they keep their current links`
      );
    } else {
      for (const link of links.data) {
        if (!link.externalId?.startsWith("release:")) {
          keepsLink.add(link.entityId);
        }
      }
    }
  }
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row || keepsLink.has(row.id)) continue;
    const externalId = `release:${plan.releaseId}:${item.partNumber}`;
    const pushedAt = datetime.timestamp();
    const releaseMapping = await swapItemMapping(db, {
      companyId,
      userId,
      itemId: row.id,
      externalId,
      metadata: {
        kind: "release",
        releaseId: plan.releaseId,
        releaseName: plan.releaseName,
        documentId: plan.documentId,
        elementId: item.elementId,
        wv: "v",
        wvId: item.versionId,
        partNumber: item.partNumber,
        revision: item.revision,
        pushedBy: userId,
        pushedAt,
        planId
      }
    });
    if (releaseMapping.error !== null) {
      summary.errors.push(
        `${item.partNumber} Rev ${item.revision}: revision written but not linked to Onshape (${releaseMapping.error}); it is invisible to change detection and to Detach`
      );
    }
  }

  // Make Default repoints every BOM line using a sibling revision to the new one.
  // Not for a staged revision: releasing its notice supersedes the old one instead.
  if (makeDefault && !changeNotice) {
    for (const entry of created) {
      if (!entry.baseItemId) continue; // brand-new item: it is the only revision
      const updated = await updateDefaultRevision(client, {
        id: entry.itemId,
        updatedBy: userId
      });
      if (updated.error) {
        summary.errors.push(
          `${entry.partNumber}: failed to make Rev ${entry.revision} the default`
        );
      } else {
        summary.defaultsUpdated += 1;
      }
    }
  }

  const assetTargets: Array<{
    item: ReleasePlanItem;
    itemId: string;
    kind: "partstudio" | "assembly" | "drawing";
  }> = [];
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row) continue;
    assetTargets.push({
      item,
      itemId: row.id,
      kind: item.elementType === 1 ? "assembly" : "partstudio"
    });
  }
  for (const drawing of drawingItems) {
    // The drawing's model: in this release, or in Carbon at the revision the plan named.
    const model = drawing.drawingOf;
    const targetId = model
      ? (revisionItemByPartNumber.get(model.partNumber)?.id ??
        model.itemId ??
        null)
      : null;
    if (!targetId) {
      summary.skipped.push(
        model
          ? `${drawing.partNumber}: drawing waits for ${model.partNumber}${
              model.revision ? ` Rev ${model.revision}` : ""
            }, which isn't in Carbon; push its release first`
          : `${drawing.partNumber}: drawing has no matching model item in this release`
      );
      continue;
    }
    assetTargets.push({ item: drawing, itemId: targetId, kind: "drawing" });
  }
  for (const target of assetTargets) {
    const selection: ReleaseExportSelection =
      target.kind === "drawing"
        ? { ok: true }
        : releaseExportSelection(target.item);
    if (!selection.ok) {
      summary.skipped.push(
        `${target.item.partNumber} Rev ${target.item.revision}: ${selection.reason}`
      );
      continue;
    }
    // The event id dedupes a retried apply (each run spends Onshape quota). The
    // writes have landed, so a queue failure is reported, not thrown.
    try {
      await trigger(
        "onshape-panel-sync",
        {
          companyId,
          userId,
          itemId: target.itemId,
          documentId: plan.documentId,
          wvm: "v",
          wvmId: target.item.versionId,
          elementId: target.item.elementId,
          elementKind: target.kind,
          ...(selection.partId ? { partId: selection.partId } : {}),
          ...(selection.configuration
            ? { configuration: selection.configuration }
            : {}),
          assetBaseName: `${target.item.partNumber}-${target.item.revision}`
        },
        { id: `${planId}:${target.itemId}:${target.item.elementId}` }
      );
      if (target.kind === "drawing") summary.drawingsQueued += 1;
    } catch {
      summary.errors.push(
        `${target.item.partNumber} Rev ${target.item.revision}: pushed, but the ${
          target.kind === "drawing" ? "drawing" : "model"
        } export couldn't be queued. Push again to retry the export.`
      );
    }
  }

  return panelReply({ summary }, { headers: { "Cache-Control": "no-store" } });
}
export const onshapePanelFieldsLogger = getLogger(
  "erp",
  "onshape",
  "panel-fields"
);

const modeSchema = z.enum(MAPPING_MODES);

const entrySchema = z.object({
  onshapePropertyId: z.string().min(1),
  onshapeName: z.string(),
  valueType: z.string().min(1),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("customField"), fieldId: z.string().min(1) }),
    z.object({ kind: z.literal("item"), field: z.enum(STANDARD_FIELD_IDS) })
  ]),
  mode: modeSchema,
  translations: z
    .array(
      z.object({
        onshape: z.string().max(255),
        carbon: z.string().nullable()
      })
    )
    .max(100)
    .optional()
});

export const onshapePropertyMapInput = z.object({
  entries: z
    .array(entrySchema)
    .max(100)
    // A duplicate propertyId would make one entry silently win.
    .refine(
      (entries) =>
        new Set(entries.map((e) => e.onshapePropertyId)).size === entries.length
    ),
  descriptionModes: z.object({ name: modeSchema, description: modeSchema }),
  pushDefaults: z.object({
    replenishmentSystem: z.enum(ITEM_REPLENISHMENT_SYSTEMS),
    methodTypeForMake: z.enum(ITEM_METHOD_TYPES),
    methodTypeForBuy: z.enum(ITEM_METHOD_TYPES),
    itemTrackingType: z.enum(ITEM_TRACKING_TYPES),
    unitOfMeasureCode: z.string().min(1).nullable()
  })
});

// The metadata keys `parsePushDefaults` reads. No unit key when the unit is
// left to the company's list.
function pushDefaultsMetadata(defaults: OnshapePushDefaults) {
  return {
    defaultReplenishmentSystem: defaults.replenishmentSystem,
    defaultMethodTypeForMake: defaults.methodTypeForMake,
    defaultMethodTypeForBuy: defaults.methodTypeForBuy,
    defaultItemTrackingType: defaults.itemTrackingType,
    ...(defaults.unitOfMeasureCode
      ? { defaultUnitOfMeasureCode: defaults.unitOfMeasureCode }
      : {})
  };
}

type PropertyMapFieldError = { key: string; errors: string[] };

/** "A, B or C". */
function orList(values: readonly string[]): string {
  return values.length > 1
    ? `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`
    : (values[0] ?? "");
}

/** Replace the property map, the description modes and the push defaults. */
export async function saveOnshapePropertyMap(
  ctx: ServiceContext,
  input: z.infer<typeof onshapePropertyMapInput>
): Promise<PanelReply> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const { entries } = input;
  const descriptionModes: DescriptionModes = input.descriptionModes;
  const pushDefaults: OnshapePushDefaults = input.pushDefaults;

  // The same pairs the Part form allows; refused here so the saved value is
  // the value pushes use, not one the plan quietly corrects.
  const reconciled = reconcilePushDefaults(pushDefaults);
  if (reconciled.methodTypeForMake !== pushDefaults.methodTypeForMake) {
    return panelReply(
      {
        error: `${pushDefaults.methodTypeForMake} isn't allowed with ${pushDefaults.replenishmentSystem}`
      },
      { status: 422 }
    );
  }
  if (reconciled.methodTypeForBuy !== pushDefaults.methodTypeForBuy) {
    return panelReply(
      {
        error: `${pushDefaults.methodTypeForBuy} isn't allowed for Buy items`
      },
      { status: 422 }
    );
  }

  const fieldErrors: PropertyMapFieldError[] = [];

  // The editor hides unmappable rows; this guards a hand-made payload.
  for (const entry of entries) {
    if (!Object.hasOwn(MAPPABLE_VALUE_TYPES, entry.valueType)) {
      fieldErrors.push({
        key: entry.onshapePropertyId,
        errors: [`${entry.valueType} properties cannot be mapped`]
      });
    }
  }

  // A target takes one property; each clashing entry names the others.
  const namesByTarget = new Map<string, string[]>();
  for (const entry of entries) {
    const key = targetKey(entry.target);
    namesByTarget.set(key, [
      ...(namesByTarget.get(key) ?? []),
      entry.onshapeName || entry.onshapePropertyId
    ]);
  }
  for (const entry of entries) {
    const own = entry.onshapeName || entry.onshapePropertyId;
    const others = (namesByTarget.get(targetKey(entry.target)) ?? []).filter(
      (name) => name !== own
    );
    if (others.length > 0) {
      fieldErrors.push({
        key: entry.onshapePropertyId,
        errors: [
          `${others.join(", ")} already maps to this Carbon field. A Carbon field takes one property.`
        ]
      });
    }
  }

  const itemEntries = entries.filter((entry) => entry.target.kind === "item");
  let units: Awaited<ReturnType<typeof loadPlanOptions>>["unitsOfMeasure"] = [];
  if (itemEntries.length > 0 || pushDefaults.unitOfMeasureCode) {
    units = (await loadPlanOptions(client, companyId)).unitsOfMeasure;
  }
  if (
    pushDefaults.unitOfMeasureCode &&
    !units.some((unit) => unit.code === pushDefaults.unitOfMeasureCode)
  ) {
    return panelReply(
      {
        error: `${pushDefaults.unitOfMeasureCode} is not a unit of measure in Carbon`
      },
      { status: 422 }
    );
  }
  for (const entry of itemEntries) {
    if (entry.target.kind !== "item") continue;
    const field = standardField(entry.target.field);
    if (!field) continue;
    const errors: string[] = [];
    if (!field.valueTypes.includes(entry.valueType)) {
      errors.push(
        `An Onshape ${entry.valueType} property can't set ${field.label}. It takes ${orList(field.valueTypes)} properties.`
      );
    }
    errors.push(...translationErrors(field, entry.translations ?? [], units));
    if (errors.length > 0) {
      fieldErrors.push({ key: entry.onshapePropertyId, errors });
    }
  }

  const customFieldIds = entries.flatMap((entry) =>
    entry.target.kind === "customField" ? [entry.target.fieldId] : []
  );
  const existingIds = [...new Set(customFieldIds)];
  if (existingIds.length > 0) {
    const existing = await client
      .from("customField")
      .select("id, name, dataTypeId")
      .eq("companyId", companyId)
      .eq("table", "part")
      .in("id", existingIds);
    if (existing.error) {
      onshapePanelFieldsLogger.error("Failed to read custom fields", {
        companyId,
        error: existing.error
      });
      return panelReply(
        { error: "Failed to read custom fields" },
        { status: 500 }
      );
    }
    const fields = new Map((existing.data ?? []).map((row) => [row.id, row]));
    for (const entry of entries) {
      if (entry.target.kind !== "customField") continue;
      const field = fields.get(entry.target.fieldId);
      const dataTypeId = field?.dataTypeId;
      if (field === undefined || dataTypeId === undefined) {
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: ["The mapped Carbon field no longer exists"]
        });
      } else if (
        Object.hasOwn(MAPPABLE_VALUE_TYPES, entry.valueType) &&
        !MAPPABLE_VALUE_TYPES[entry.valueType]?.includes(dataTypeId)
      ) {
        const needed = orList(
          (MAPPABLE_VALUE_TYPES[entry.valueType] ?? []).map(
            (id) => CUSTOM_FIELD_TYPE_LABELS[id] ?? String(id)
          )
        );
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: [
            `${field.name} is a ${CUSTOM_FIELD_TYPE_LABELS[dataTypeId] ?? "different"} field. An Onshape ${entry.valueType} property needs a ${needed} field.`
          ]
        });
      }
    }
  }
  if (fieldErrors.length > 0) {
    return panelReply(
      { error: "Some field mappings are not valid", fieldErrors },
      { status: 422 }
    );
  }

  // Translations are kept for list item fields only.
  const mapEntries: PropertyMapEntry[] = entries.map((entry) => {
    const field =
      entry.target.kind === "item" ? standardField(entry.target.field) : null;
    return {
      onshapePropertyId: entry.onshapePropertyId,
      onshapeName: entry.onshapeName,
      valueType: entry.valueType,
      target: entry.target,
      mode: entry.mode,
      ...(field?.kind === "list"
        ? {
            translations: (entry.translations ?? []).map((row) => ({
              onshape: row.onshape.trim(),
              carbon: row.carbon
            }))
          }
        : {})
    };
  });

  // Writes only this page's keys (map, modes, push defaults); other writers own
  // the sibling keys. The column is json, hence the casts.
  const db = ctx.asSystem.pg;
  let updatedRows: bigint;
  try {
    const updated = await db
      .updateTable("companyIntegration")
      .set({
        metadata: sql<Json>`((jsonb_set(jsonb_set(metadata::jsonb, '{propertyMap}', ${JSON.stringify(
          mapEntries
        )}::jsonb, true), '{descriptionModes}', ${JSON.stringify(
          descriptionModes
        )}::jsonb, true) || ${JSON.stringify(
          pushDefaultsMetadata(pushDefaults)
        )}::jsonb)${
          pushDefaults.unitOfMeasureCode
            ? sql``
            : sql` - 'defaultUnitOfMeasureCode'`
        })::json`
      })
      .where("id", "=", ONSHAPE_V2_INTEGRATION_ID)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    updatedRows = updated.numUpdatedRows;
  } catch (error) {
    onshapePanelFieldsLogger.error("Failed to save the property map", {
      companyId,
      error
    });
    return panelReply(
      { error: "Failed to save the property map" },
      { status: 500 }
    );
  }
  if (Number(updatedRows) === 0) {
    return panelReply(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  // The map is saved; a failed re-read is a warning, not a failed save.
  let definitions: PlanCustomFieldDefinition[] | null = null;
  let warning: string | undefined;
  try {
    definitions = await loadPartCustomFieldDefinitions(client, companyId);
  } catch (error) {
    onshapePanelFieldsLogger.error(
      "Failed to re-read custom fields after saving the map",
      {
        companyId,
        error
      }
    );
    warning =
      "Saved. The custom field list couldn't be refreshed — press Refresh to see the latest fields.";
  }

  return panelReply(
    {
      map: mapEntries,
      descriptionModes,
      pushDefaults,
      definitions,
      ...(warning ? { warning } : {})
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** A panel operation's result, as its route sends it to the panel. */
export function panelResponse(
  result:
    | { data: PanelReply; error: null }
    | { data: null; error: { message: string; status: number } }
) {
  const headers = { "Cache-Control": "no-store" };
  return result.error
    ? data(
        { error: result.error.message },
        { status: result.error.status, headers }
      )
    : data(result.data.body, { status: result.data.status, headers });
}

// Strict backflush gaps. Each count and its drawer list share one query, the
// SQL form of `needsPullFrom`, so they cannot disagree.

function methodLinesMissingPullFrom(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  locationIds: string[]
) {
  return db
    .selectFrom("methodMaterial")
    .innerJoin("makeMethod", (join) =>
      join
        .onRef("makeMethod.id", "=", "methodMaterial.makeMethodId")
        .on("makeMethod.companyId", "=", companyId)
        .on("makeMethod.status", "=", "Active")
    )
    .innerJoin("item as component", (join) =>
      join
        .onRef("component.id", "=", "methodMaterial.itemId")
        .on("component.companyId", "=", companyId)
    )
    .where("methodMaterial.companyId", "=", companyId)
    .where("methodMaterial.methodType", "!=", "Make to Order")
    .where("methodMaterial.itemType", "in", [...PULLED_ITEM_TYPES])
    .where(
      sql<boolean>`COALESCE("component"."itemTrackingType", 'Inventory') <> 'Non-Inventory'`
    )
    .where(
      sql<boolean>`EXISTS (SELECT 1 FROM unnest(${locationIds}::text[]) AS loc WHERE COALESCE("methodMaterial"."storageUnitIds" ->> loc, '') = '')`
    );
}

function jobLinesMissingStorageUnit(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  locationIds: string[]
) {
  return db
    .selectFrom("jobMaterial")
    .innerJoin("job", (join) =>
      join
        .onRef("job.id", "=", "jobMaterial.jobId")
        .on("job.companyId", "=", companyId)
        .on("job.status", "in", [...activeJobStatuses])
    )
    .innerJoin("item as component", (join) =>
      join
        .onRef("component.id", "=", "jobMaterial.itemId")
        .on("component.companyId", "=", companyId)
    )
    .where("job.locationId", "in", locationIds)
    .where("jobMaterial.companyId", "=", companyId)
    .where("jobMaterial.storageUnitId", "is", null)
    .where("jobMaterial.methodType", "!=", "Make to Order")
    .where("jobMaterial.itemType", "in", [...PULLED_ITEM_TYPES])
    .where("jobMaterial.requiresBatchTracking", "=", false)
    .where("jobMaterial.requiresSerialTracking", "=", false)
    .where("jobMaterial.quantityToIssue", ">", 0)
    .where(
      sql<boolean>`COALESCE("component"."itemTrackingType", 'Inventory') <> 'Non-Inventory'`
    );
}

export async function getStrictBackflushGapCounts(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{
  data: { methods: number; jobs: number } | null;
  error: Error | null;
}> {
  try {
    // One query at a time: each would otherwise take its own pooled connection.
    const locationIds = (await getPullFromLocations(db, companyId)).map(
      (location) => location.id
    );
    if (locationIds.length === 0) {
      return { data: { methods: 0, jobs: 0 }, error: null };
    }
    const methods = await methodLinesMissingPullFrom(db, companyId, locationIds)
      .select(
        sql<string>`count(DISTINCT "methodMaterial"."makeMethodId")`.as("count")
      )
      .executeTakeFirst();
    const jobs = await jobLinesMissingStorageUnit(db, companyId, locationIds)
      .select(sql<string>`count(DISTINCT "job"."id")`.as("count"))
      .executeTakeFirst();
    return {
      data: {
        methods: Number(methods?.count ?? 0),
        jobs: Number(jobs?.count ?? 0)
      },
      error: null
    };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

export async function getActiveMethodsMissingPullFrom(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ data: MethodMissingPullFrom[] | null; error: Error | null }> {
  try {
    const locations = await getPullFromLocations(db, companyId);
    if (locations.length === 0) return { data: [], error: null };
    const locationIds = locations.map((location) => location.id);
    const locationName = new Map(
      locations.map((location) => [location.id, location.name])
    );

    const lines = await methodLinesMissingPullFrom(db, companyId, locationIds)
      .innerJoin("item as parent", (join) =>
        join
          .onRef("parent.id", "=", "makeMethod.itemId")
          .on("parent.companyId", "=", companyId)
      )
      .select([
        "makeMethod.id as makeMethodId",
        "makeMethod.version",
        "parent.id as itemId",
        "parent.type as itemType",
        "parent.readableIdWithRevision as readableId",
        "parent.name",
        "methodMaterial.storageUnitIds",
        "component.id as componentId",
        "component.readableIdWithRevision as componentReadableId"
      ])
      .execute();

    const methods = new Map<
      string,
      Omit<MethodMissingPullFrom, "materials" | "locations"> & {
        materials: Set<string>;
        locations: Set<string>;
      }
    >();
    for (const line of lines) {
      const method = methods.get(line.makeMethodId) ?? {
        makeMethodId: line.makeMethodId,
        itemId: line.itemId,
        itemType: line.itemType,
        readableId: line.readableId ?? line.itemId,
        name: line.name,
        version: Number(line.version),
        materials: new Set<string>(),
        locations: new Set<string>()
      };
      method.materials.add(line.componentReadableId ?? line.componentId);
      for (const id of missingPullFromLocations(
        line.storageUnitIds,
        locationIds
      ))
        method.locations.add(locationName.get(id) ?? id);
      methods.set(line.makeMethodId, method);
    }

    return {
      data: [...methods.values()]
        .map((method) => ({
          ...method,
          materials: [...method.materials].sort(),
          locations: [...method.locations].sort()
        }))
        .sort((a, b) => a.readableId.localeCompare(b.readableId)),
      error: null
    };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

export async function getOpenJobsMissingStorageUnit(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ data: JobMissingStorageUnit[] | null; error: Error | null }> {
  try {
    const locationIds = (await getPullFromLocations(db, companyId)).map(
      (location) => location.id
    );
    if (locationIds.length === 0) return { data: [], error: null };

    const lines = await jobLinesMissingStorageUnit(db, companyId, locationIds)
      .leftJoin("item as jobItem", (join) =>
        join
          .onRef("jobItem.id", "=", "job.itemId")
          .on("jobItem.companyId", "=", companyId)
      )
      .leftJoin("location", (join) =>
        join
          .onRef("location.id", "=", "job.locationId")
          .on("location.companyId", "=", companyId)
      )
      .select([
        "job.id",
        "job.jobId",
        "job.status",
        "jobItem.readableIdWithRevision as readableId",
        "location.name as locationName",
        "component.id as componentId",
        "component.readableIdWithRevision as componentReadableId"
      ])
      .execute();

    const jobs = new Map<
      string,
      Omit<JobMissingStorageUnit, "materials"> & { materials: Set<string> }
    >();
    for (const line of lines) {
      const job = jobs.get(line.id) ?? {
        id: line.id,
        jobId: line.jobId,
        status: line.status,
        readableId: line.readableId,
        locationName: line.locationName,
        materials: new Set<string>()
      };
      job.materials.add(line.componentReadableId ?? line.componentId);
      jobs.set(line.id, job);
    }

    return {
      data: [...jobs.values()]
        .map((job) => ({ ...job, materials: [...job.materials].sort() }))
        .sort((a, b) => a.jobId.localeCompare(b.jobId)),
      error: null
    };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}
