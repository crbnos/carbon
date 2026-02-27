import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ApiKey } from "~/modules/settings";
import { ApiKeyForm, apiKeyValidator, upsertApiKey } from "~/modules/settings";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "users"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(apiKeyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: we destructure to omit id from validation
  const { id: _id, scopes: scopesJson, expiresAt, ...d } = validation.data;

  // Parse scopes from JSON string
  const scopes = scopesJson ? JSON.parse(scopesJson) : {};

  const updateApiKey = await upsertApiKey(client, {
    id,
    ...d,
    scopes,
    expiresAt: expiresAt || undefined
  });

  if (updateApiKey.error) {
    return data(
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
  const routeData = useRouteData<{ apiKeys: ApiKey[]; companyId: string }>(
    path.to.apiKeys
  );

  const apiKey = routeData?.apiKeys.find((apiKey) => apiKey.id === params.id);
  if (!apiKey) throw new Error("API key not found");

  const initialValues = {
    id: apiKey?.id ?? undefined,
    name: apiKey?.name ?? "",
    expiresAt: (apiKey as any)?.expiresAt ?? undefined
  };

  return (
    <ApiKeyForm
      key={initialValues.id}
      initialValues={initialValues}
      companyId={routeData?.companyId}
      existingScopes={(apiKey as any)?.scopes ?? null}
      onClose={() => navigate(-1)}
    />
  );
}
