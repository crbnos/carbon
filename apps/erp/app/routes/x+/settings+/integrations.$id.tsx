import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  getAccountingIntegration,
  getAccountMappings,
  getProviderIntegration,
  getSyncOperations,
  getUnmappedPostingAccounts,
  matchAccountsByCode,
  POSTING_SYNC_DEFAULT_SOURCE_TYPES,
  ProviderID,
  type QboProvider,
  type RilletProvider,
  resolvePostingSyncSettings,
  type SyncOperation,
  type SyncOperationStatus,
  SyncOperationStatusSchema,
  transitionOperation,
  upsertAccountMapping,
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
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";
import {
  getIntegration,
  IntegrationForm,
  SyncActivity,
  syncOperationTransitionValidator
} from "~/modules/settings";
import {
  accountMappingBulkUpsertValidator,
  accountMappingUpsertValidator,
  postingSyncSettingsValidator
} from "~/modules/settings/settings.models";
import {
  invalidateIntegrationHealthCache,
  upsertCompanyIntegration
} from "~/modules/settings/settings.server";
import { AccountMapping } from "~/modules/settings/ui/Integrations/AccountMapping";
import type { IntegrationFormTab } from "~/modules/settings/ui/Integrations/IntegrationForm";
import { PostingSyncSettings } from "~/modules/settings/ui/Integrations/PostingSyncSettings";
import type { SyncReconciliationReport } from "~/modules/settings/ui/Integrations/SyncActivity";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "integrations-id");

/**
 * Transforms flat owner settings (customerOwner, vendorOwner, etc.) into
 * the nested syncConfig.entities structure expected by the accounting sync.
 */
/**
 * Rillet authenticates with an API key entered on the standard install
 * form. The engine reads credentials exclusively from
 * `metadata.credentials` (top-level metadata keys are stripped by
 * ProviderIntegrationMetadataSchema and would echo back into the form's
 * password field), so fold the form fields into the canonical apiKey
 * credentials variant. What's submitted is what's stored: a blank
 * webhookToken turns inbound payments off; re-saving requires re-entering
 * the key (sandbox and production keys differ anyway).
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

function buildIntegrationMetadata(
  existingMetadata: Record<string, unknown>,
  formData: Record<string, unknown>
): Record<string, unknown> {
  // Extract owner settings from form data
  const ownerSettings = {
    customerOwner: formData.customerOwner as string | undefined,
    vendorOwner: formData.vendorOwner as string | undefined,
    itemOwner: formData.itemOwner as string | undefined,
    invoiceOwner: formData.invoiceOwner as string | undefined,
    billOwner: formData.billOwner as string | undefined
  };

  // Check if any owner settings are present
  const hasOwnerSettings = Object.values(ownerSettings).some(
    (v) => v !== undefined
  );

  if (!hasOwnerSettings) {
    // No owner settings, just merge as-is
    return { ...existingMetadata, ...formData };
  }

  // Build syncConfig.entities from owner settings
  const existingSyncConfig =
    (existingMetadata.syncConfig as Record<string, unknown>) ?? {};
  const existingEntities =
    (existingSyncConfig.entities as Record<string, unknown>) ?? {};

  const syncConfig = {
    ...existingSyncConfig,
    entities: {
      ...existingEntities,
      ...(ownerSettings.customerOwner && {
        customer: {
          ...(existingEntities.customer as Record<string, unknown>),
          owner: ownerSettings.customerOwner
        }
      }),
      ...(ownerSettings.vendorOwner && {
        vendor: {
          ...(existingEntities.vendor as Record<string, unknown>),
          owner: ownerSettings.vendorOwner
        }
      }),
      ...(ownerSettings.itemOwner && {
        item: {
          ...(existingEntities.item as Record<string, unknown>),
          owner: ownerSettings.itemOwner
        }
      }),
      ...(ownerSettings.invoiceOwner && {
        invoice: {
          ...(existingEntities.invoice as Record<string, unknown>),
          owner: ownerSettings.invoiceOwner
        }
      }),
      ...(ownerSettings.billOwner && {
        bill: {
          ...(existingEntities.bill as Record<string, unknown>),
          owner: ownerSettings.billOwner
        }
      })
    }
  };

  // Remove owner settings from formData since they're now in syncConfig
  const {
    customerOwner: _customerOwner,
    vendorOwner: _vendorOwner,
    itemOwner: _itemOwner,
    invoiceOwner: _invoiceOwner,
    billOwner: _billOwner,
    ...restFormData
  } = formData;

  return {
    ...existingMetadata,
    ...restFormData,
    syncConfig
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

  const [mappings, unmapped, proposals] = await Promise.all([
    getAccountMappings(db, { companyId, integration: integrationId }),
    getUnmappedPostingAccounts(db, { companyId, integration: integrationId }),
    chart.length > 0
      ? matchAccountsByCode(db, {
          companyId,
          integration: integrationId,
          providerAccounts: chart
        })
      : Promise.resolve({ data: [], error: null })
  ]);

  // Don't block the settings drawer on a mapping load failure — render
  // what loaded and log the cause.
  for (const result of [mappings, unmapped, proposals]) {
    if (result.error) {
      console.error("Failed to load account mapping data:", result.error);
    }
  }

  return {
    mappings: mappings.data ?? [],
    unmapped: unmapped.data ?? [],
    chart,
    proposals: proposals.data ?? []
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

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
      postingSync: null
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

    const operations = await getSyncOperations(client, {
      companyId,
      integration: integrationId,
      status: statusFilter.success ? statusFilter.data : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize
    });

    if (operations.error) {
      // Don't block the settings drawer on an inbox failure — render the
      // tab empty and log the cause.
      console.error("Failed to load sync operations:", operations.error);
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
      lastReconciliation
    };
  }

  // Extract owner settings from syncConfig back into flat fields for the form
  const metadata = (integrationData.data.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const flattenedMetadata = flattenSyncConfigToOwnerSettings(metadata);

  // Fetch dynamic options for Xero integration (chart of accounts)
  let dynamicOptions: Record<
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

      const accountOptions = accounts.map((account) => ({
        value: account.Code ?? account.AccountID,
        label: account.Code
          ? `${account.Code} - ${account.Name}`
          : account.Name,
        description: account.Type
      }));

      dynamicOptions = {
        defaultSalesAccountCode: accountOptions,
        defaultPurchaseAccountCode: accountOptions
      };

      chartAccounts = accounts.flatMap((account) =>
        account.Code
          ? [{ id: account.AccountID, code: account.Code, name: account.Name }]
          : []
      );
    } catch (error) {
      logger.error("Failed to fetch Xero accounts for settings", {
        error: error
      });
      // Continue without dynamic options - form will show empty selects
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

  const postingSync = isAccountingInstalled
    ? {
        settings: resolvePostingSyncSettings(metadata),
        sourceTypeOptions: [...POSTING_SYNC_DEFAULT_SOURCE_TYPES]
      }
    : null;

  return {
    installed: integrationData.data.active,
    metadata: flattenedMetadata,
    dynamicOptions,
    syncActivity,
    accountMapping,
    postingSync
  };
}

/**
 * Extracts owner settings from nested syncConfig.entities back into
 * flat fields (customerOwner, vendorOwner, etc.) for the form.
 */
function flattenSyncConfigToOwnerSettings(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const syncConfig = metadata.syncConfig as Record<string, unknown> | undefined;
  const entities = syncConfig?.entities as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!entities) {
    return metadata;
  }

  return {
    ...metadata,
    customerOwner: entities.customer?.owner,
    vendorOwner: entities.vendor?.owner,
    itemOwner: entities.item?.owner,
    invoiceOwner: entities.invoice?.owner,
    billOwner: entities.bill?.owner
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
      enabled,
      sourceTypes,
      includeManual,
      consolidation,
      periodLockPolicy,
      lockDate
    } = validation.data;

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
    // survive a settings save
    const existingPostingSync =
      (existingSettings.postingSync as Record<string, unknown> | undefined) ??
      {};

    // The Posting toggle must flip BOTH gates: the syncers' shouldSync
    // reads settings.postingSync.enabled, while the enqueue path
    // (isJournalEntryPostingEnabled in @carbon/jobs) reads the resolved
    // syncConfig.entities.journalEntry.enabled (default false). Mirroring
    // the flag here keeps one switch in the UI.
    const existingSyncConfig =
      (existingMetadata.syncConfig as Record<string, unknown> | undefined) ??
      {};
    const existingSyncEntities =
      (existingSyncConfig.entities as Record<string, unknown> | undefined) ??
      {};

    const metadata = {
      ...existingMetadata,
      settings: {
        ...existingSettings,
        postingSync: {
          ...existingPostingSync,
          enabled,
          sourceTypes,
          includeManual,
          consolidation,
          periodLockPolicy,
          ...(lockDate ? { lockDate } : {})
        }
      },
      syncConfig: {
        ...existingSyncConfig,
        entities: {
          ...existingSyncEntities,
          journalEntry: {
            ...(existingSyncEntities.journalEntry as Record<string, unknown>),
            enabled
          }
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

  // Build metadata, transforming owner settings into syncConfig structure
  let metadata = buildIntegrationMetadata(existingMetadata, d);
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
    postingSync
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Accounting-category integrations get Account Mapping, Posting and
  // Sync Activity tabs next to the Settings form (deep-linkable via
  // ?tab=<value>).
  const tabs: IntegrationFormTab[] = [];
  if (accountMapping) {
    tabs.push({
      value: "account-mapping",
      label: <Trans>Account Mapping</Trans>,
      content: (
        <AccountMapping
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
      content: (
        <PostingSyncSettings
          settings={postingSync.settings}
          sourceTypeOptions={postingSync.sourceTypeOptions}
        />
      )
    });
  }
  if (syncActivity) {
    tabs.push({
      value: "sync-activity",
      label: <Trans>Sync Activity</Trans>,
      content: (
        <SyncActivity
          operations={syncActivity.operations}
          count={syncActivity.count}
          status={syncActivity.status}
          page={syncActivity.page}
          pageSize={syncActivity.pageSize}
          lastReconciliation={syncActivity.lastReconciliation}
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
