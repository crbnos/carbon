import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { ApiKey } from "~/modules/settings";
import { ApiKeyForm, apiKeyValidator, upsertApiKey } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "users",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(apiKeyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateApiKey = await upsertApiKey(client, {
    id,
    ...validation.data,
  });

  if (updateApiKey.error) {
    return json(
      {},
      await flash(
        request,
        error(updateApiKey.error, "Failed to update API key")
      )
    );
  }

  throw redirect(
    `${path.to.apiKeys}?${getParams(request)}`,
    await flash(request, success("Updated API key"))
  );
}

export default function EditApiKeyRoute() {
  const navigate = useNavigate();
  const params = useParams();
  const routeData = useRouteData<{ apiKeys: ApiKey[] }>(path.to.apiKeys);

  const apiKey = routeData?.apiKeys.find((apiKey) => apiKey.id === params.id);
  if (!apiKey) throw new Error("API key not found");

  const initialValues = {
    id: apiKey?.id ?? undefined,
    name: apiKey?.name ?? "",
  };

  return (
    <ApiKeyForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
