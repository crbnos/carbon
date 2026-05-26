import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { webhookValidator } from "~/modules/settings";
import { upsertWebhook } from "~/modules/settings/settings.service.server";
import { WebhookForm } from "~/modules/settings/ui/Webhooks";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "settings"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "WEBHOOKS",
    redirectTo: path.to.webhooks
  });

  const formData = await request.formData();
  const validation = await validator(webhookValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createWebhook = await upsertWebhook({
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (createWebhook.error) {
    return data(
      {},
      await flash(
        request,
        error(createWebhook.error, "Failed to create webhook")
      )
    );
  }

  throw redirect(
    `${path.to.webhooks}?${getParams(request)}`,
    await flash(request, success("Created webhook"))
  );
}

export default function NewWebhookRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    url: "",
    table: "",
    onInsert: false,
    onUpdate: false,
    onDelete: false,
    active: false
  };

  return (
    <WebhookForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
