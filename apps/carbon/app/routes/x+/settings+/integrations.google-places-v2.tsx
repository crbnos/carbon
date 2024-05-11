import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  GooglePlacesForm,
  apiKey,
  getIntegration,
  googlePlacesFormValidator,
  upsertIntegration,
} from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

const defaultValue = {
  apiKey: "",
  active: false,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const integration = await getIntegration(
    client,
    "google-places-v2",
    companyId
  );
  if (integration.error) {
    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(integration.error, "Failed to load Google Places integration")
      )
    );
  }

  const validIntegration = apiKey.safeParse(integration.data?.metadata);

  return json({
    integration: validIntegration.success
      ? {
          active: integration.data?.active ?? false,
          ...validIntegration.data,
        }
      : defaultValue,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings",
  });

  const validation = await validator(googlePlacesFormValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { active, ...data } = validation.data;

  const update = await upsertIntegration(client, {
    id: "google-places-v2",
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
        error(update.error, "Failed to update Google Places integration")
      )
    );
  }

  throw redirect(
    path.to.integrations,
    await flash(request, success("Updated Google Places integration"))
  );
}

export default function GooglePlacesIntegrationRoute() {
  const { integration } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  return (
    <GooglePlacesForm
      initialValues={integration}
      onClose={() => navigate(path.to.integrations)}
    />
  );
}
