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
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { getIntegration, IntegrationForm } from "~/modules/settings";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

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
  // biome-ignore lint/correctness/noUnusedVariables: destructuring to exclude from restFormData
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
      console.error("Failed to fetch Xero accounts for settings:", error);
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

  const integration = availableIntegrations.find((i) => i.id === integrationId);

  if (!integration) throw new Error("Integration not found");

  const validation = await validator(integration.schema).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { active, ...d } = validation.data;

  // Fetch existing metadata so we merge form settings without
  // overwriting credentials and syncConfig
  const existing = await getIntegration(client, integrationId, companyId);
  const existingMetadata =
    (existing.data?.metadata as Record<string, unknown>) ?? {};

  // Build metadata, transforming owner settings into syncConfig structure
  const metadata = buildIntegrationMetadata(existingMetadata, d);

  const update = await upsertCompanyIntegration(client, {
    id: integrationId,
    active: true,
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
