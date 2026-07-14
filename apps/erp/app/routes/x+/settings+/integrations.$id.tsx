import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  type XeroProvider
} from "@carbon/ee/accounting";
import { getIntegrationServerHooks } from "@carbon/ee/hooks.server";
import { isIntegrationWhitelisted } from "@carbon/ee/plan";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { getIntegration, IntegrationForm } from "~/modules/settings";
import {
  invalidateIntegrationHealthCache,
  upsertCompanyIntegration
} from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "integrations-id");

/**
 * Transforms flat owner settings (customerOwner, vendorOwner, etc.) into
 * the nested syncConfig.entities structure expected by the accounting sync.
 */
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
      dynamicOptions: {}
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
    } catch (error) {
      logger.error("Failed to fetch Xero accounts for settings", {
        error: error
      });
      // Continue without dynamic options - form will show empty selects
    }
  }

  return {
    installed: integrationData.data.active,
    metadata: flattenedMetadata,
    dynamicOptions
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
  ).validate(await request.formData());

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
  const metadata = buildIntegrationMetadata(existingMetadata, d);

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

  await invalidateIntegrationHealthCache(integrationId, companyId);

  throw redirect(
    path.to.integrations,
    await flash(request, success(`Installed ${integration.name} integration`))
  );
}

export default function IntegrationRoute() {
  const { installed, metadata, dynamicOptions } =
    useLoaderData<typeof loader>();

  const navigate = useNavigate();

  return (
    <IntegrationForm
      installed={installed}
      metadata={metadata}
      dynamicOptions={dynamicOptions}
      onClose={() => navigate(path.to.integrations)}
    />
  );
}
