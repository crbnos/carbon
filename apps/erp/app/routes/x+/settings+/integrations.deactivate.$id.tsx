import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { integrations as availableIntegrations } from "@carbon/ee";
import { redirect } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deactivateIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
  });

  const { id: integrationId } = params;
  if (!integrationId) throw new Error("Integration ID not found");

  const integration = availableIntegrations.find((i) => i.id === integrationId);

  if (!integration) throw new Error("Integration not found");

  const update = await deactivateIntegration(client, {
    id: integrationId,
    companyId,
    updatedBy: userId,
  });

  if (update.error) {
    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(update.error, "Failed to disconnect integration")
      )
    );
  }

  throw redirect(
    path.to.integrations,
    await flash(
      request,
      success(`Disconnected ${integration.name} integration`)
    )
  );
}
