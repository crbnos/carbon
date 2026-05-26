import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteWebhook,
  getWebhook
} from "~/modules/settings/settings.service.server";
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
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "WEBHOOKS",
    redirectTo: path.to.webhooks
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(request, error(params, "Failed to get an id"))
    );
  }

  const { error: deleteWebhookError } = await deleteWebhook(id);
  if (deleteWebhookError) {
    throw redirect(
      `${path.to.webhooks}?${getParams(request)}`,
      await flash(
        request,
        error(deleteWebhookError, "Failed to delete webhook")
      )
    );
  }

  throw redirect(
    `${path.to.webhooks}?${getParams(request)}`,
    await flash(request, success("Successfully deleted webhook"))
  );
}

export default function DeleteWebhookRoute() {
  const { webhook } = useLoaderData<typeof loader>();

  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const navigate = useNavigate();
  const { t } = useLingui();
  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteWebhook(id)}
      name={webhook.name}
      text={t`Are you sure you want to delete the webhook: ${webhook.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
