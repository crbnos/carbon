import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database, Json } from "@carbon/database";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  buildDimensionValueMappingEntityId,
  buildRilletFieldTarget,
  buildXeroTrackingTarget,
  getAccountingIntegration,
  getAccountMappings,
  getDimensionValueMappings,
  getProviderIntegration,
  getSyncOperations,
  getUnmappedPostingAccounts,
  getUnmappedSlottedDimensionValues,
  JOURNAL_ENTRY_SOURCE_TYPES,
  loadAccountDefaultAccountIds,
  matchAccountsByCode,
  matchDimensionValuesByName,
  POSTING_POLICY,
  ProviderID,
  QBO_DIMENSION_TARGET_CLASS,
  QBO_DIMENSION_TARGET_DEPARTMENT,
  type QboProvider,
  // Aliased: the PostingSyncSettings component is imported below.
  type PostingSyncSettings as ResolvedPostingSyncSettings,
  type RilletProvider,
  resolveDimensionValueLabels,
  resolvePostingSyncSettings,
  type SyncOperation,
  type SyncOperationStatus,
  SyncOperationStatusSchema,
  suggestAccountMatchesWithAI,
  transitionOperation,
  upsertAccountMapping,
  upsertDimensionValueMapping,
  validateDimensionSlots,
  XERO_MAX_JOURNAL_DIMENSION_SLOTS,
  type XeroProvider
} from "@carbon/ee/accounting";
import {
  ensureOnshapeReleaseWebhook,
  getIntegrationServerHooks,
  onshapeConnectionHasWriteScope
} from "@carbon/ee/hooks.server";
import { isIntegrationWhitelisted } from "@carbon/ee/plan";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";
// Deep service import (not the ~/modules/accounting barrel) to keep this
// route's type graph light — see the TS2589 note in
// ~/modules/settings/ui/Integrations/index.ts.
import { getActiveDimensionsWithValues } from "~/modules/accounting/accounting.ee.service";
import {
  getIntegration,
  IntegrationForm,
  SyncActivity,
  syncOperationTransitionValidator
} from "~/modules/settings";
import {
  accountMappingAiSuggestValidator,
  accountMappingBulkUpsertValidator,
  accountMappingUpsertValidator,
  dimensionSlotsUpdateValidator,
  dimensionValueMappingBulkUpsertValidator,
  dimensionValueMappingUpsertValidator,
  postingSyncSettingsValidator
} from "~/modules/settings/settings.models";
import {
  invalidateIntegrationHealthCache,
  upsertCompanyIntegration
} from "~/modules/settings/settings.server";
import { AccountMapping } from "~/modules/settings/ui/Integrations/AccountMapping";
import { DimensionMapping } from "~/modules/settings/ui/Integrations/DimensionMapping";
import type { IntegrationFormTab } from "~/modules/settings/ui/Integrations/IntegrationForm";
import { PostingSyncSettings } from "~/modules/settings/ui/Integrations/PostingSyncSettings";
import type { SyncReconciliationReport } from "~/modules/settings/ui/Integrations/SyncActivity";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "integrations-id");

/**
 * Rillet authenticates with an API key entered on the standard install
 * form. The engine reads credentials exclusively from
 * `metadata.credentials` (top-level metadata keys are stripped by
 * ProviderIntegrationMetadataSchema), so fold the form fields into the
 * canonical apiKey credentials variant. The loader mirrors this with
 * `unfoldRilletCredentials`, so the drawer prefills from stored
 * credentials — meaning a re-save round-trips the real values instead of
 * wiping environment/subsidiaryId/webhookToken back to their defaults.
 * What's submitted is what's stored: clearing the webhook token turns
 * inbound payments off.
 */
function foldRilletCredentials(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const { apiKey, environment, subsidiaryId, webhookToken, ...rest } = metadata;
  if (typeof apiKey !== "string" || apiKey.length === 0) return metadata;

  const providerMetadata = {
    ...(typeof subsidiaryId === "string" && subsidiaryId.length > 0
      ? { subsidiaryId }
      : {}),
    ...(typeof webhookToken === "string" && webhookToken.length > 0
      ? { webhookToken }
      : {})
  };

  return {
    ...rest,
    credentials: {
      type: "apiKey",
      apiKey,
      environment: environment === "sandbox" ? "sandbox" : "production",
      ...(Object.keys(providerMetadata).length > 0 ? { providerMetadata } : {})
    }
  };
}

/**
 * Inverse of `foldRilletCredentials`: unfold the stored
 * `metadata.credentials` back into the flat apiKey/environment/
 * subsidiaryId/webhookToken fields the settings form binds to. Without
 * this the drawer opens with every Connection/Webhooks field blank, and
 * re-saving (which requires the API key) rebuilds credentials from those
 * blank defaults — silently wiping the environment, subsidiary, and
 * webhook token. The loader reads raw metadata (getIntegration does not
 * strip `credentials`), so the values are available here.
 */
function unfoldRilletCredentials(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const credentials = metadata.credentials as
    | Record<string, unknown>
    | undefined;
  if (!credentials || credentials.type !== "apiKey") return metadata;

  const providerMetadata =
    (credentials.providerMetadata as Record<string, unknown> | undefined) ?? {};

  return {
    ...metadata,
    apiKey: typeof credentials.apiKey === "string" ? credentials.apiKey : "",
    environment:
      credentials.environment === "sandbox" ? "sandbox" : "production",
    subsidiaryId:
      typeof providerMetadata.subsidiaryId === "string"
        ? providerMetadata.subsidiaryId
        : "",
    webhookToken:
      typeof providerMetadata.webhookToken === "string"
        ? providerMetadata.webhookToken
        : ""
  };
}

/**
 * Account-mapping data for the integration drawer's Account Mapping tab.
 * The @carbon/ee account-mapping services are Kysely-based (DISTINCT +
 * unbounded reads that supabase-js can't express), so they get the app's
 * Kysely client. Kysely bypasses RLS — safe here because the route has
 * already passed requirePermissions and every query is companyId-scoped.
 */
async function getAccountMappingTabData(
  companyId: string,
  integrationId: string,
  chart: Array<{ id: string; code: string; name: string }>
) {
  const db = getDatabaseClient();

  const [mappings, unmapped, proposals, accountDefaultIds] = await Promise.all([
    getAccountMappings(db, { companyId, integration: integrationId }),
    getUnmappedPostingAccounts(db, { companyId, integration: integrationId }),
    chart.length > 0
      ? matchAccountsByCode(db, {
          companyId,
          integration: integrationId,
          providerAccounts: chart
        })
      : Promise.resolve({ data: [], error: null }),
    loadAccountDefaultAccountIds(db, companyId)
  ]);

  // Don't block the settings drawer on a mapping load failure — render
  // what loaded and log the cause.
  for (const result of [mappings, unmapped, proposals]) {
    if (result.error) {
      console.error("Failed to load account mapping data:", result.error);
    }
  }

  // The tab manages only accountDefault accounts (the mappable set — every
  // automated posting runs through one), so hide any legacy mapping for an
  // account outside that set: it never syncs and would only inflate the list.
  // getAccountMappings itself is left untouched so the journal/bill/invoice
  // syncers' account resolution keeps seeing every mapping. Unmapped and
  // proposals are already accountDefault-scoped in @carbon/ee.
  const mappableIds = new Set(accountDefaultIds);
  const scopedMappings = (mappings.data ?? []).filter((mapping) =>
    mappableIds.has(mapping.accountId)
  );

  return {
    mappings: scopedMappings,
    unmapped: unmapped.data ?? [],
    chart,
    proposals: proposals.data ?? []
  };
}

/** One provider analytics target with its selectable option values. */
type DimensionTargetWithValues = {
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
async function getProviderDimensionTargets(
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
        maxSlots: provider.capabilities?.maxJournalDimensionSlots ?? null,
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
        maxSlots: qbo.capabilities?.maxJournalDimensionSlots ?? null,
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
    console.error("Failed to load provider dimension targets:", err);
    return { supported: true, targets: [], maxSlots: null, targetsError: true };
  }
}

/**
 * Dimension-sync data for the integration drawer's Dimensions tab: the
 * provider targets (+ values), the company's dimensions with value counts
 * (high-cardinality warning), the stored slot config, the per-slot value
 * mappings with resolved Carbon labels, the unmapped slotted values, and
 * exact name-match proposals. Returns null when the provider doesn't
 * implement journalDimensionTargets (no tab). The dimension-mapping
 * services are Kysely-based (RLS bypassed) — same auth stance as
 * getAccountMappingTabData.
 */
async function getDimensionSyncTabData(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    companyGroupId: string;
    integrationId: string;
    settings: ResolvedPostingSyncSettings;
  }
) {
  const { companyId, companyGroupId, integrationId, settings } = args;

  const providerTargets = await getProviderDimensionTargets(
    client,
    companyId,
    integrationId
  );
  if (!providerTargets.supported) return null;

  const db = getDatabaseClient();
  const slots = settings.dimensionSlots;

  const [dimensionsResult, mappingsResult, unmappedResult] = await Promise.all([
    getActiveDimensionsWithValues(client, companyGroupId, companyId),
    getDimensionValueMappings(db, { companyId, integration: integrationId }),
    getUnmappedSlottedDimensionValues(db, {
      companyId,
      integration: integrationId,
      slots
    })
  ]);

  // Don't block the settings drawer on a load failure — render what
  // loaded and log the cause.
  for (const result of [dimensionsResult, mappingsResult, unmappedResult]) {
    if (result.error) {
      console.error("Failed to load dimension sync data:", result.error);
    }
  }

  const dimensions = (dimensionsResult.error ? [] : dimensionsResult.data).map(
    (dimension) => ({
      id: dimension.dimensionId,
      name: dimension.dimensionName,
      entityType: String(dimension.entityType),
      valueCount: dimension.values.length
    })
  );

  const mappingRows = mappingsResult.data ?? [];

  // Readable Carbon labels for the mapped rows (engine-resolved per the
  // dimension's entityType). A resolution failure degrades to raw ids.
  let mappedLabels = new Map<string, string>();
  try {
    mappedLabels = await resolveDimensionValueLabels(db, {
      values: mappingRows.map(({ dimensionId, valueId }) => ({
        dimensionId,
        valueId
      }))
    });
  } catch (err) {
    console.error("Failed to resolve dimension value labels:", err);
  }

  const mappings = mappingRows.map((mapping) => ({
    id: mapping.id,
    dimensionId: mapping.dimensionId,
    valueId: mapping.valueId,
    label:
      mappedLabels.get(
        buildDimensionValueMappingEntityId(mapping.dimensionId, mapping.valueId)
      ) ?? null,
    externalId: mapping.externalId,
    externalName: mapping.externalName
  }));

  const unmapped = unmappedResult.data ?? [];

  // Exact name-match proposals, per slot: each slot pairs one dimension's
  // unmapped values with its provider target's option list. Provider
  // options already used by a mapping on the SAME dimension are excluded
  // (an option may legitimately back several dimensions).
  const targetsById = new Map(
    providerTargets.targets.map((target) => [target.id, target])
  );
  const mappedValueKeys = mappingRows
    .filter((mapping) => mapping.externalId)
    .map((mapping) =>
      buildDimensionValueMappingEntityId(mapping.dimensionId, mapping.valueId)
    );
  const proposals = slots.flatMap((slot) => {
    const target = targetsById.get(slot.target);
    if (!target) return [];
    const values = unmapped.filter(
      (value) => value.dimensionId === slot.dimensionId
    );
    if (values.length === 0) return [];
    const mappedExternalIds = mappingRows.flatMap((mapping) =>
      mapping.dimensionId === slot.dimensionId && mapping.externalId
        ? [mapping.externalId]
        : []
    );
    return matchDimensionValuesByName({
      values,
      providerOptions: target.values,
      mappedValueKeys,
      mappedExternalIds
    });
  });

  return {
    targets: providerTargets.targets,
    targetsError: providerTargets.targetsError,
    maxSlots: providerTargets.maxSlots,
    // Rillet's Field-value upsert flow defaults auto-create ON; QBO/Xero
    // stay opt-in (see resolveDimensionSlotAutoCreate in @carbon/ee).
    autoCreateDefault: integrationId === ProviderID.RILLET,
    dimensions,
    slots,
    onUnmappedDimensionValue: settings.onUnmappedDimensionValue,
    mappings,
    unmapped,
    proposals
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      update: "settings"
    }
  );

  const { id: integrationId } = params;
  if (!integrationId) throw new Error("Integration ID not found");

  const integration = availableIntegrations.find((i) => i.id === integrationId);
  if (!integration) throw new Error("Integration not found");

  const integrationData = await getIntegration(
    client,
    integrationId,
    companyId
  );

  if (integrationData.error || !integrationData.data) {
    return {
      installed: false,
      metadata: {},
      dynamicOptions: {},
      syncActivity: null,
      accountMapping: null,
      postingSync: null,
      dimensionSync: null
    };
  }

  const isAccountingInstalled =
    integration.category === "Accounting" && integrationData.data.active;

  // Sync-operation inbox for accounting integrations (RLS SELECT covers
  // employees, so the user-scoped client is enough). Params are prefixed
  // (syncStatus/syncPage) to avoid clashing with other search params.
  let syncActivity: {
    operations: SyncOperation[];
    count: number;
    status: SyncOperationStatus | null;
    page: number;
    pageSize: number;
    lastReconciliation: SyncReconciliationReport | null;
    /** Failed + Warning operations — the tab-label badge. */
    failingCount: number;
    /**
     * Tie-out summary: latest computedAt + how many (period × account)
     * cells carry a nonzero internal or external delta. Null when no
     * tie-out rows exist (or the viewer lacks accounting_view — the
     * table's RLS SELECT — in which case the rows read back empty).
     */
    tieOut: {
      computedAt: string | null;
      deltaCellCount: number;
      cellCount: number;
    } | null;
  } | null = null;

  if (isAccountingInstalled) {
    const url = new URL(request.url);
    const statusFilter = SyncOperationStatusSchema.safeParse(
      url.searchParams.get("syncStatus")
    );
    const page = Math.max(
      1,
      Number.parseInt(url.searchParams.get("syncPage") ?? "1", 10) || 1
    );
    const pageSize = 25;

    const [operations, failingOps, tieOutRows] = await Promise.all([
      getSyncOperations(client, {
        companyId,
        integration: integrationId,
        status: statusFilter.success ? statusFilter.data : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize
      }),
      // Failed + Warning count for the tab badge — only the exact count is
      // used, so fetch a single row.
      getSyncOperations(client, {
        companyId,
        integration: integrationId,
        status: ["Failed", "Warning"],
        limit: 1
      }),
      // Tie-out cells for this integration. The table is not in the
      // generated DB types yet — cast, same pattern as
      // @carbon/ee/accounting core/operations.ts.
      (client.from("accountingSyncTieOut" as any) as any)
        .select("internalDelta, externalDelta, computedAt")
        .eq("companyId", companyId)
        .eq("integration", integrationId)
    ]);

    if (operations.error) {
      // Don't block the settings drawer on an inbox failure — render the
      // tab empty and log the cause.
      console.error("Failed to load sync operations:", operations.error);
    }

    let tieOut: {
      computedAt: string | null;
      deltaCellCount: number;
      cellCount: number;
    } | null = null;
    const tieOutCells = (tieOutRows.error ? [] : (tieOutRows.data ?? [])) as {
      internalDelta: number | null;
      externalDelta: number | null;
      computedAt: string | null;
    }[];
    if (tieOutCells.length > 0) {
      tieOut = {
        computedAt: tieOutCells.reduce<string | null>(
          (latest, row) =>
            row.computedAt && (latest == null || row.computedAt > latest)
              ? row.computedAt
              : latest,
          null
        ),
        deltaCellCount: tieOutCells.filter(
          (row) =>
            Math.abs(Number(row.internalDelta ?? 0)) > 0.001 ||
            Math.abs(Number(row.externalDelta ?? 0)) > 0.001
        ).length,
        cellCount: tieOutCells.length
      };
    }

    // Latest weekly reconciliation report, written by the
    // accounting-reconciliation cron to
    // metadata.settings.postingSync.lastReconciliation. Shape-guarded so
    // stored garbage renders as "no report" instead of crashing the tab.
    const storedReconciliation = (
      (integrationData.data.metadata as Record<string, any> | null)?.settings
        ?.postingSync as Record<string, any> | undefined
    )?.lastReconciliation;
    const lastReconciliation: SyncReconciliationReport | null =
      storedReconciliation &&
      typeof storedReconciliation.runAt === "string" &&
      Array.isArray(storedReconciliation.drift)
        ? (storedReconciliation as SyncReconciliationReport)
        : null;

    syncActivity = {
      operations: operations.data,
      count: operations.count ?? 0,
      status: statusFilter.success ? statusFilter.data : null,
      page,
      pageSize,
      lastReconciliation,
      failingCount: failingOps.error ? 0 : (failingOps.count ?? 0),
      tieOut
    };
  }

  const metadata = (integrationData.data.metadata ?? {}) as Record<
    string,
    unknown
  >;
  let flattenedMetadata: Record<string, unknown> = metadata;
  // Rillet keeps its API credentials under metadata.credentials; unfold
  // them into the flat form fields so the drawer prefills instead of
  // showing blanks (which a re-save would then persist over the real
  // stored connection).
  if (integrationId === "rillet") {
    flattenedMetadata = unfoldRilletCredentials(flattenedMetadata);
  }

  // Server-fetched options for "options"-type settings fields. No current
  // integration config populates this, but IntegrationForm still accepts it
  // generically for a future provider-fetched choice list.
  const dynamicOptions: Record<
    string,
    Array<{ value: string; label: string; description?: string }>
  > = {};

  // Provider chart of accounts for the Account Mapping tab. Xero manual
  // journals reference accounts by code, so only coded accounts are
  // mappable.
  let chartAccounts: Array<{ id: string; code: string; name: string }> = [];

  if (integrationId === "xero" && integrationData.data.active) {
    try {
      const xeroIntegration = await getAccountingIntegration(
        client,
        companyId,
        ProviderID.XERO
      );

      const provider = getProviderIntegration(
        client,
        companyId,
        xeroIntegration.id,
        xeroIntegration.metadata
      ) as XeroProvider;

      const accounts = await provider.listChartOfAccounts();

      chartAccounts = accounts.flatMap((account) =>
        account.Code
          ? [{ id: account.AccountID, code: account.Code, name: account.Name }]
          : []
      );
    } catch (error) {
      logger.error("Failed to fetch Xero accounts for settings", {
        error: error
      });
      // Continue without chart accounts — the Account Mapping tab renders
      // with Carbon accounts only
    }
  }

  if (integrationId === "quickbooks" && integrationData.data.active) {
    try {
      const qboIntegration = await getAccountingIntegration(
        client,
        companyId,
        ProviderID.QUICKBOOKS
      );

      const provider = getProviderIntegration(
        client,
        companyId,
        qboIntegration.id,
        qboIntegration.metadata
      ) as QboProvider;

      // Already normalized to { id, code, name } with code = AcctNum ?? Id.
      // QBO journal lines reference accounts by Id, so every account is
      // mappable — no coded-accounts filter like Xero. (The quickbooks
      // config defines no account-code settings fields, so dynamicOptions
      // stays empty.)
      chartAccounts = await provider.listChartOfAccounts();
    } catch (error) {
      console.error(
        "Failed to fetch QuickBooks Online accounts for settings:",
        error
      );
      // Continue without chart accounts — the Account Mapping tab renders
      // with Carbon accounts only
    }
  }

  if (integrationId === "rillet" && integrationData.data.active) {
    try {
      const rilletIntegration = await getAccountingIntegration(
        client,
        companyId,
        ProviderID.RILLET
      );

      const provider = getProviderIntegration(
        client,
        companyId,
        rilletIntegration.id,
        rilletIntegration.metadata
      ) as RilletProvider;

      // Already normalized to { id, code, name }. Rillet journal items
      // reference accounts by CODE, so only coded, ACTIVE accounts are
      // returned by listChartOfAccounts.
      chartAccounts = await provider.listChartOfAccounts();
    } catch (error) {
      console.error("Failed to fetch Rillet accounts for settings:", error);
      // Continue without chart accounts — the Account Mapping tab renders
      // with Carbon accounts only
    }
  }

  const accountMapping = isAccountingInstalled
    ? await getAccountMappingTabData(companyId, integrationId, chartAccounts)
    : null;

  const resolvedPostingSettings = isAccountingInstalled
    ? resolvePostingSyncSettings(metadata)
    : null;
  const mappedAccountCount =
    accountMapping?.mappings.filter((mapping) => mapping.externalId).length ??
    0;
  const postingSync = resolvedPostingSettings
    ? {
        settings: {
          families: resolvedPostingSettings.families,
          sourceTypes: resolvedPostingSettings.sourceTypes,
          periodLockPolicy: resolvedPostingSettings.periodLockPolicy,
          lockDate: resolvedPostingSettings.lockDate
        },
        // Manual never syncs (POSTING_POLICY syncable: false) and is never
        // rendered as a configurable row.
        policy: JOURNAL_ENTRY_SOURCE_TYPES.filter(
          (sourceType) => sourceType !== "Manual"
        ).map((sourceType) => ({
          sourceType,
          representation: POSTING_POLICY[sourceType].representation,
          family: POSTING_POLICY[sourceType].family ?? null
        })),
        mappingReadiness: accountMapping
          ? {
              mapped: mappedAccountCount,
              required: mappedAccountCount + accountMapping.unmapped.length
            }
          : null
      }
    : null;

  // Dimension-sync tab data — accounting integrations whose provider
  // implements journalDimensionTargets (guarded inside the helper).
  const dimensionSync = resolvedPostingSettings
    ? await getDimensionSyncTabData(client, {
        companyId,
        companyGroupId,
        integrationId,
        settings: resolvedPostingSettings
      })
    : null;

  return {
    installed: integrationData.data.active,
    metadata: flattenedMetadata,
    dynamicOptions,
    syncActivity,
    accountMapping,
    postingSync,
    dimensionSync
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const { id: integrationId } = params;
  if (!integrationId) throw new Error("Integration ID not found");

  const formData = await request.formData();

  // Retry / Skip / Re-send on sync operations (Sync Activity tab). Stays on
  // the page so the inbox revalidates in place — no redirect.
  if (formData.get("intent") === "transition-sync-operation") {
    const validation = await validator(
      syncOperationTransitionValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const { ids, to } = validation.data;
    const failures: string[] = [];

    for (const operationId of ids) {
      const result = await transitionOperation(client, {
        id: operationId,
        companyId,
        to,
        userId
      });
      if (result.error) {
        failures.push(result.error);
      }
    }

    if (failures.length > 0) {
      const succeeded = ids.length - failures.length;
      return data(
        {},
        await flash(
          request,
          error(
            failures[0],
            succeeded > 0
              ? `Updated ${succeeded} of ${ids.length} sync operations`
              : "Failed to update sync operation"
          )
        )
      );
    }

    const noun =
      ids.length === 1 ? "sync operation" : `${ids.length} sync operations`;
    return data(
      {},
      await flash(
        request,
        success(
          to === "Skipped" ? `Skipped ${noun}` : `Queued ${noun} for sync`
        )
      )
    );
  }

  // Save one account mapping row (Account Mapping tab). The mapping
  // services are Kysely-based (RLS bypassed) — requirePermissions above +
  // companyId scoping is the auth gate. Stays on the page so the tab
  // revalidates in place.
  if (formData.get("intent") === "upsert-account-mapping") {
    const validation = await validator(accountMappingUpsertValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { accountId, externalId, externalCode, externalName } =
      validation.data;

    const result = await upsertAccountMapping(getDatabaseClient(), {
      companyId,
      integration: integrationId,
      accountId,
      externalId,
      externalCode,
      externalName,
      userId
    });

    if (result.error) {
      return data(
        {},
        await flash(
          request,
          error(result.error, "Failed to save account mapping")
        )
      );
    }

    return data({}, await flash(request, success("Saved account mapping")));
  }

  // "Suggest with AI" from the Account Mapping tab: ask gpt-4o for a
  // best-guess pairing of the still-unmapped Carbon accounts to the
  // provider chart. Writes nothing — returns proposals for the confirm
  // step, which posts them back as `bulk-upsert-account-mappings`.
  if (formData.get("intent") === "ai-suggest-account-mappings") {
    const validation = await validator(
      accountMappingAiSuggestValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const { accounts, providerAccounts } = validation.data;

    const result = await suggestAccountMatchesWithAI({
      accounts,
      providerAccounts
    });

    if (result.error || !result.data) {
      return data(
        {},
        await flash(
          request,
          error(result.error, "Failed to suggest account mappings")
        )
      );
    }

    return data({ proposals: result.data });
  }

  // Confirm-all from the match-by-code drawer: repeated JSON-encoded
  // `mappings` fields, one upsert per proposal.
  if (formData.get("intent") === "bulk-upsert-account-mappings") {
    const validation = await validator(
      accountMappingBulkUpsertValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const { mappings } = validation.data;
    const db = getDatabaseClient();
    const failures: string[] = [];

    for (const mapping of mappings) {
      const result = await upsertAccountMapping(db, {
        companyId,
        integration: integrationId,
        ...mapping,
        userId
      });
      if (result.error) {
        failures.push(result.error);
      }
    }

    if (failures.length > 0) {
      const succeeded = mappings.length - failures.length;
      return data(
        {},
        await flash(
          request,
          error(
            failures[0],
            succeeded > 0
              ? `Saved ${succeeded} of ${mappings.length} account mappings`
              : "Failed to save account mappings"
          )
        )
      );
    }

    const mappingNoun =
      mappings.length === 1
        ? "account mapping"
        : `${mappings.length} account mappings`;
    return data({}, await flash(request, success(`Saved ${mappingNoun}`)));
  }

  // Save the dimension-slot configuration (Dimensions tab): validate the
  // slots against the provider's declared targets server-side, then
  // read-modify-write the postingSync fragment. Unlike the Posting intent,
  // the v2 shim-marker keys are deliberately LEFT in place — this intent
  // doesn't write the v3 sourceTypes record, so stripping the markers here
  // would make the schema shim lose the stored v2 enabled set on the next
  // read. Stays on the page so the tab revalidates in place.
  if (formData.get("intent") === "update-dimension-slots") {
    const validation = await validator(dimensionSlotsUpdateValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { slots, onUnmappedDimensionValue } = validation.data;

    const providerTargets = await getProviderDimensionTargets(
      client,
      companyId,
      integrationId
    );
    if (!providerTargets.supported) {
      return data(
        {},
        await flash(
          request,
          error(
            "unsupported integration",
            "This integration does not support dimension sync"
          )
        )
      );
    }
    // Clearing every slot is always allowed; validating a non-empty config
    // against a failed target fetch would reject every target as unknown.
    if (slots.length > 0 && providerTargets.targetsError) {
      return data(
        {},
        await flash(
          request,
          error(
            "provider targets unavailable",
            "Couldn't load the provider's dimension targets — try again"
          )
        )
      );
    }
    const slotErrors = validateDimensionSlots({
      slots,
      targets: providerTargets.targets,
      maxSlots: providerTargets.maxSlots ?? undefined
    });
    if (slotErrors.length > 0) {
      return data(
        {},
        await flash(
          request,
          error(slotErrors.join(" "), "Invalid dimension slot configuration")
        )
      );
    }

    const existing = await getIntegration(client, integrationId, companyId);
    if (existing.error || !existing.data) {
      return data(
        {},
        await flash(
          request,
          error(existing.error, "Failed to load integration settings")
        )
      );
    }

    const existingMetadata =
      (existing.data.metadata as Record<string, unknown>) ?? {};
    const existingSettings =
      (existingMetadata.settings as Record<string, unknown> | undefined) ?? {};
    const existingPostingSync =
      (existingSettings.postingSync as Record<string, unknown> | undefined) ??
      {};

    const metadata = {
      ...existingMetadata,
      settings: {
        ...existingSettings,
        postingSync: {
          ...existingPostingSync,
          dimensionSlots: slots,
          onUnmappedDimensionValue
        }
      }
    };

    const update = await upsertCompanyIntegration(client, {
      id: integrationId,
      active: existing.data.active ?? true,
      metadata: metadata as Json,
      companyId,
      updatedBy: userId
    });

    if (update.error) {
      return data(
        {},
        await flash(
          request,
          error(update.error, "Failed to update dimension sync settings")
        )
      );
    }

    await invalidateIntegrationHealthCache(integrationId, companyId);

    return data(
      {},
      await flash(request, success("Updated dimension sync settings"))
    );
  }

  // Save one dimension-value mapping row (Dimensions tab). The mapping
  // services are Kysely-based (RLS bypassed) — requirePermissions above +
  // companyId scoping is the auth gate. Stays on the page so the tab
  // revalidates in place.
  if (formData.get("intent") === "upsert-dimension-value-mapping") {
    const validation = await validator(
      dimensionValueMappingUpsertValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const { dimensionId, valueId, externalId, externalName } = validation.data;

    const result = await upsertDimensionValueMapping(getDatabaseClient(), {
      companyId,
      integration: integrationId,
      dimensionId,
      valueId,
      externalId,
      externalName,
      userId
    });

    if (result.error) {
      return data(
        {},
        await flash(
          request,
          error(result.error, "Failed to save dimension value mapping")
        )
      );
    }

    return data(
      {},
      await flash(request, success("Saved dimension value mapping"))
    );
  }

  // Confirm-all from the match-by-name drawer: repeated JSON-encoded
  // `mappings` fields, one upsert per proposal.
  if (formData.get("intent") === "bulk-upsert-dimension-value-mappings") {
    const validation = await validator(
      dimensionValueMappingBulkUpsertValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const { mappings } = validation.data;
    const db = getDatabaseClient();
    const failures: string[] = [];

    for (const mapping of mappings) {
      const result = await upsertDimensionValueMapping(db, {
        companyId,
        integration: integrationId,
        ...mapping,
        userId
      });
      if (result.error) {
        failures.push(result.error);
      }
    }

    if (failures.length > 0) {
      const succeeded = mappings.length - failures.length;
      return data(
        {},
        await flash(
          request,
          error(
            failures[0],
            succeeded > 0
              ? `Saved ${succeeded} of ${mappings.length} dimension value mappings`
              : "Failed to save dimension value mappings"
          )
        )
      );
    }

    const dimensionMappingNoun =
      mappings.length === 1
        ? "dimension value mapping"
        : `${mappings.length} dimension value mappings`;
    return data(
      {},
      await flash(request, success(`Saved ${dimensionMappingNoun}`))
    );
  }

  // Persist posting-sync settings (Posting tab): read-modify-write the
  // companyIntegration metadata JSONB, deep-merging the postingSync
  // fragment under metadata.settings so credentials and other settings
  // keys are never clobbered. Stays on the page.
  if (formData.get("intent") === "update-posting-settings") {
    const validation = await validator(postingSyncSettingsValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const {
      sourceTypeConfigs,
      familyAr,
      familyAp,
      periodLockPolicy,
      lockDate
    } = validation.data;

    // "<sourceType>|<granularity>" hidden fields → the v3 per-source-type
    // record. Always-on: every non-Manual journal-represented type is
    // enabled; the form only carries granularity. Manual is hard-excluded
    // (POSTING_POLICY marks it syncable: false; resolution fills its entry
    // from defaults). Document-represented types fill from POSTING_POLICY
    // defaults at resolution time.
    const sourceTypes: Record<
      string,
      { enabled: boolean; granularity: "individual" | "daily-summary" }
    > = {};
    const granularityBySourceType = new Map(
      sourceTypeConfigs.map((config) => {
        const separator = config.lastIndexOf("|");
        return [
          config.slice(0, separator),
          config.slice(separator + 1) as "individual" | "daily-summary"
        ] as const;
      })
    );
    for (const sourceType of JOURNAL_ENTRY_SOURCE_TYPES) {
      if (POSTING_POLICY[sourceType].representation !== "journal") continue;
      if (sourceType === "Manual") continue;
      sourceTypes[sourceType] = {
        enabled: true,
        granularity:
          granularityBySourceType.get(sourceType) ??
          POSTING_POLICY[sourceType].defaultGranularity
      };
    }

    const existing = await getIntegration(client, integrationId, companyId);
    if (existing.error || !existing.data) {
      return data(
        {},
        await flash(
          request,
          error(existing.error, "Failed to load integration settings")
        )
      );
    }

    const existingMetadata =
      (existing.data.metadata as Record<string, unknown>) ?? {};
    const existingSettings =
      (existingMetadata.settings as Record<string, unknown> | undefined) ?? {};
    // Spread the existing postingSync so keys this form doesn't own —
    // lastReconciliation is written by the weekly reconciliation cron —
    // survive a settings save. The v2 shim-marker keys (includeManual,
    // consolidation, the legacy sourceTypes array) are stripped: saving
    // writes the v3 shape, and leaving a marker behind would make the
    // schema shim mis-read the stored fragment as v2.
    const {
      includeManual: _legacyIncludeManual,
      consolidation: _legacyConsolidation,
      sourceTypes: _legacySourceTypes,
      ...existingPostingSync
    } = ((existingSettings.postingSync as
      | Record<string, unknown>
      | undefined) ?? {}) as Record<string, unknown>;

    // Always-on: posting sync has no master toggle anymore. `enabled` is no
    // longer written to postingSync (the stored-schema default is true, and
    // the decision core doesn't read it), and there is no
    // syncConfig.entities.journalEntry mirror to maintain — the provider
    // configs force journalEntry on. Writing the v3 shape strips a stale
    // stored postingSync.enabled on the next save; a stale
    // syncConfig.entities.journalEntry.enabled === false (if any) is left as-is
    // and still honored at the isJournalEntryPostingEnabled seam.
    const { enabled: _legacyEnabled, ...postingSyncWithoutEnabled } =
      existingPostingSync;

    const metadata = {
      ...existingMetadata,
      settings: {
        ...existingSettings,
        postingSync: {
          ...postingSyncWithoutEnabled,
          families: { ar: familyAr, ap: familyAp },
          sourceTypes,
          periodLockPolicy,
          ...(lockDate ? { lockDate } : {})
        }
      }
    };

    const update = await upsertCompanyIntegration(client, {
      id: integrationId,
      active: existing.data.active ?? true,
      metadata: metadata as Json,
      companyId,
      updatedBy: userId
    });

    if (update.error) {
      return data(
        {},
        await flash(
          request,
          error(update.error, "Failed to update posting sync settings")
        )
      );
    }

    await invalidateIntegrationHealthCache(integrationId, companyId);

    return data(
      {},
      await flash(request, success("Updated posting sync settings"))
    );
  }

  if (!isIntegrationWhitelisted(integrationId)) {
    await requirePlan({
      request,
      client,
      companyId,
      feature: "INTEGRATIONS",
      redirectTo: path.to.integrations
    });
  }

  const integration = availableIntegrations.find((i) => i.id === integrationId);

  if (!integration) throw new Error("Integration not found");

  const validation = await validator(
    // integration.schema is a union across all integrations (incl. a
    // discriminated union for Email). Cast to a generic ZodType so the
    // validator signature accepts it.
    integration.schema as unknown as Parameters<typeof validator>[0]
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // @ts-expect-error TS2339 - TODO: fix type
  const { active: _active, ...d } = validation.data;

  // Fetch existing metadata so we merge form settings without
  // overwriting credentials and syncConfig
  const existing = await getIntegration(client, integrationId, companyId);
  const existingMetadata =
    (existing.data?.metadata as Record<string, unknown>) ?? {};

  let metadata: Record<string, unknown> = { ...existingMetadata, ...d };
  if (integrationId === "rillet") {
    metadata = foldRilletCredentials(metadata);
  }

  // Onshape asset sync needs the OAuth2Write scope (export jobs + webhook). A
  // connection authorized read-only can't run it, and a refresh can't widen the
  // scope — only a reconnect can. If a read-only user is turning the feature ON,
  // don't persist an on-but-non-functional toggle: force it back off here and
  // tell them to reconnect first (below). Leaving it off imposes nothing.
  const onshapeActivatingWithoutWrite =
    integrationId === "onshape" &&
    (metadata as Record<string, unknown>).assetSyncEnabled === true &&
    !onshapeConnectionHasWriteScope(existingMetadata);
  if (onshapeActivatingWithoutWrite) {
    (metadata as Record<string, unknown>).assetSyncEnabled = false;
  }

  const wasInstalled = existing.data?.active === true;

  const update = await upsertCompanyIntegration(client, {
    id: integrationId,
    active: true,
    // @ts-expect-error TS2322 - TODO: fix type
    metadata,
    companyId,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.integrations,
      await flash(request, error(update.error, "Failed to install integration"))
    );
  }

  // Fire `onInstall` on the transition from uninstalled → installed.
  // Prefer the server-hooks registry (used by integrations whose install
  // logic needs server-only modules, e.g. Xero), fall back to any inline
  // hook defined via `defineIntegration({ onInstall })`. Run it best-effort:
  // the row is already persisted, so a hook failure shouldn't roll that
  // back — just surface it as a flashed error and let the user retry.
  if (!wasInstalled) {
    const serverHooks = getIntegrationServerHooks(integrationId);
    const onInstall = (serverHooks?.onInstall ?? integration.onInstall) as
      | ((companyId: string) => void | Promise<void>)
      | undefined;
    if (onInstall) {
      try {
        await onInstall(companyId);
      } catch (hookError) {
        logger.error("onInstall hook failed for integration", {
          integrationId,
          error: hookError
        });
        throw redirect(
          path.to.integrations,
          await flash(
            request,
            error(
              hookError,
              `Installed ${integration.name}, but setup hook failed`
            )
          )
        );
      }
    }
  } else {
    // Settings save on an already-installed integration: run `onUpdate` so
    // derived server state (e.g. accounting event subscriptions) converges
    // without a reinstall. Best-effort — the save is already persisted, so
    // a hook failure is logged rather than surfaced as a save failure.
    const onUpdate = getIntegrationServerHooks(integrationId)?.onUpdate;
    if (onUpdate) {
      try {
        await onUpdate(companyId);
      } catch (hookError) {
        logger.error("onUpdate hook failed for integration", {
          integrationId,
          error: hookError
        });
      }
    }
  }

  // Onshape: keep the release-webhook subscription in lockstep with the
  // asset-sync toggle. Registering here (not just on connect) also covers
  // already-connected installs when they enable the feature — but connections
  // authorized before the OAuth2Write scope was requested hold Read-only tokens
  // and need a reconnect, so surface a registration failure instead of flashing
  // success while the sync silently never fires. The settings themselves are
  // already saved either way.
  if (integrationId === "onshape") {
    // Read-only connection trying to turn asset sync on: we already forced the
    // toggle back off above, so just tell them exactly what to do. Explicit and
    // scope-accurate — not inferred from a downstream webhook failure.
    if (onshapeActivatingWithoutWrite) {
      await invalidateIntegrationHealthCache(integrationId, companyId);
      throw redirect(
        path.to.integrations,
        await flash(
          request,
          error(
            "onshape connection is read-only",
            "Onshape is connected with read-only access. Reconnect Onshape to grant write access, then enable asset sync."
          )
        )
      );
    }

    const assetSyncEnabled =
      (metadata as Record<string, unknown>).assetSyncEnabled === true;
    const webhookResult = await ensureOnshapeReleaseWebhook(
      companyId,
      assetSyncEnabled
    );
    if (assetSyncEnabled && !webhookResult.ok) {
      await invalidateIntegrationHealthCache(integrationId, companyId);
      throw redirect(
        path.to.integrations,
        await flash(
          request,
          error(
            webhookResult.error,
            "Saved Onshape settings, but couldn't register the release webhook. Reconnect Onshape to grant write access, then save again."
          )
        )
      );
    }
  }

  await invalidateIntegrationHealthCache(integrationId, companyId);

  throw redirect(
    path.to.integrations,
    await flash(request, success(`Installed ${integration.name} integration`))
  );
}

export default function IntegrationRoute() {
  const {
    installed,
    metadata,
    dynamicOptions,
    syncActivity,
    accountMapping,
    postingSync,
    dimensionSync
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Accounting-category integrations get Account Mapping, Posting, Dimensions
  // and Sync Activity tabs next to the Settings form (deep-linkable via
  // ?tab=<value>).
  const tabs: IntegrationFormTab[] = [];
  if (accountMapping) {
    tabs.push({
      value: "account-mapping",
      label: <Trans>Account Mapping</Trans>,
      content: (tabBar) => (
        <AccountMapping
          tabs={tabBar}
          mappings={accountMapping.mappings}
          unmapped={accountMapping.unmapped}
          chart={accountMapping.chart}
          proposals={accountMapping.proposals}
        />
      )
    });
  }
  if (postingSync) {
    tabs.push({
      value: "posting",
      label: <Trans>Posting</Trans>,
      content: (tabBar) => (
        <PostingSyncSettings
          tabs={tabBar}
          settings={postingSync.settings}
          policy={postingSync.policy}
          mappingReadiness={postingSync.mappingReadiness}
        />
      )
    });
  }
  if (dimensionSync) {
    tabs.push({
      value: "dimensions",
      label: <Trans>Dimensions</Trans>,
      content: (tabBar) => (
        <DimensionMapping
          tabs={tabBar}
          targets={dimensionSync.targets}
          targetsError={dimensionSync.targetsError}
          maxSlots={dimensionSync.maxSlots}
          autoCreateDefault={dimensionSync.autoCreateDefault}
          dimensions={dimensionSync.dimensions}
          slots={dimensionSync.slots}
          onUnmappedDimensionValue={dimensionSync.onUnmappedDimensionValue}
          mappings={dimensionSync.mappings}
          unmapped={dimensionSync.unmapped}
          proposals={dimensionSync.proposals}
        />
      )
    });
  }
  if (syncActivity) {
    tabs.push({
      value: "sync-activity",
      label:
        syncActivity.failingCount > 0 ? (
          <span className="flex items-center gap-1.5">
            <Trans>Sync Activity</Trans>
            <Badge variant="orange">{syncActivity.failingCount}</Badge>
          </span>
        ) : (
          <Trans>Sync Activity</Trans>
        ),
      content: (tabBar) => (
        <SyncActivity
          tabs={tabBar}
          operations={syncActivity.operations}
          count={syncActivity.count}
          status={syncActivity.status}
          page={syncActivity.page}
          pageSize={syncActivity.pageSize}
          lastReconciliation={syncActivity.lastReconciliation}
          tieOut={syncActivity.tieOut}
        />
      )
    });
  }

  const tabParam = searchParams.get("tab");
  const defaultTab = tabs.some((tab) => tab.value === tabParam)
    ? (tabParam ?? undefined)
    : undefined;

  return (
    <IntegrationForm
      installed={installed}
      metadata={metadata}
      dynamicOptions={dynamicOptions}
      tabs={tabs.length > 0 ? tabs : undefined}
      defaultTab={defaultTab}
      onClose={() => navigate(path.to.integrations)}
    />
  );
}
