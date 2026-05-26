import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { webhookValidator } from "~/modules/settings";
import {
  getWebhook,
  upsertWebhook
} from "~/modules/settings/settings.service.server";
import { WebhookForm } from "~/modules/settings/ui/Webhooks";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const webhook = await getWebhook(id);
  if (webhook.error) {
    throw redirect(
      path.to.webhooks,
      await flash(request, error(webhook.error, "Failed to load webhook"))
    );
  }

  return {
    webhook: webhook.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "WEBHOOKS",
    redirectTo: path.to.webhooks
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(webhookValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateWebhook = await upsertWebhook({
    id,
    ...validation.data
  });

  if (updateWebhook.error) {
    return data(
      {},
      await flash(
        request,
        error(updateWebhook.error, "Failed to update webhook")
      )
    );
  }

  throw redirect(
    `${path.to.webhooks}?${getParams(request)}`,
    await flash(request, success("Updated webhook"))
  );
}

export default function EditWebhookRoute() {
  const navigate = useNavigate();
  const { webhook } = useLoaderData<typeof loader>();

  const initialValues = {
    id: webhook?.id ?? undefined,
    name: webhook?.name ?? "",
    url: webhook?.url ?? "",
    table: webhook?.table ?? "",
    onInsert: webhook?.onInsert ?? false,
    onUpdate: webhook?.onUpdate ?? false,
    onDelete: webhook?.onDelete ?? false,
    active: webhook?.active ?? false
  };

  return (
    <WebhookForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
