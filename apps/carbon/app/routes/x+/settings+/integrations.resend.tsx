import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ResendForm,
  getIntegration,
  resendFormValidator,
  upsertIntegration,
} from "~/modules/settings";
import { path } from "~/utils/path";

const defaultValue = {
  apiKey: "",
  active: false,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const integration = await getIntegration(client, "resend", companyId);

  const validIntegration = resendFormValidator.safeParse(
    integration.data?.metadata
  );

  return json({
    integration: validIntegration.success
      ? {
          active: integration.data?.active ?? false,
          apiKey: validIntegration.data.apiKey,
          fromEmail: validIntegration.data.fromEmail,
        }
      : defaultValue,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
  });

  const validation = await validator(resendFormValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { active, ...data } = validation.data;

  const update = await upsertIntegration(client, {
    id: "resend",
    active,
    metadata: {
      ...data,
    },
    companyId,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(update.error, "Failed to update Resend integration")
      )
    );
  }

  throw redirect(
    path.to.integrations,
    await flash(request, success("Updated Resend integration"))
  );
}

export default function ResendIntegrationRoute() {
  const { integration } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  return (
    <ResendForm
      initialValues={integration}
      onClose={() => navigate(path.to.integrations)}
    />
  );
}
