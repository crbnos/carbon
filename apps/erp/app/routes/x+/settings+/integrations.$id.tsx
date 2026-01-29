import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { integrations as availableIntegrations } from "@carbon/ee";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { getIntegration, IntegrationForm } from "~/modules/settings";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

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
      metadata: {}
    };
  }

  return {
    installed: integrationData.data.active,
    metadata: (integrationData.data.metadata ?? {}) as Record<string, unknown>
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

  const update = await upsertCompanyIntegration(client, {
    id: integrationId,
    active: true,
    metadata: {
      ...existingMetadata,
      ...d
    },
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
  const { installed, metadata } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  return (
    <IntegrationForm
      installed={installed}
      metadata={metadata}
      onClose={() => navigate(path.to.integrations)}
    />
  );
}
