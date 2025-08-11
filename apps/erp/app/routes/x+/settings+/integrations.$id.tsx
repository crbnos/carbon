import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { integrations as availableIntegrations } from "@carbon/integrations";
import { redirect, useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { IntegrationForm, getIntegration } from "~/modules/settings";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
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
    };
  }

  return {
    installed: integrationData.data.active,
    metadata: (integrationData.data.metadata ?? {}) as Record<string, unknown>,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
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

  const { active, ...data } = validation.data;

  const update = await upsertCompanyIntegration(client, {
    id: integrationId,
    active: true,
    metadata: {
      ...data,
    },
    companyId,
    updatedBy: userId,
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
