import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getWebhook,
  upsertWebhook,
  webhookValidator,
} from "~/modules/settings";
import { WebhookForm } from "~/modules/settings/ui/Webhooks";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "settings",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const webhook = await getWebhook(client, id);
  if (webhook.error) {
    throw redirect(
      path.to.webhooks,
      await flash(request, error(webhook.error, "Failed to load webhook"))
    );
  }

  return json({
    webhook: webhook.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    view: "settings",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(webhookValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateWebhook = await upsertWebhook(client, {
    id,
    ...validation.data,
  });

  if (updateWebhook.error) {
    return json(
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
    active: webhook?.active ?? false,
  };

  return (
    <WebhookForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
