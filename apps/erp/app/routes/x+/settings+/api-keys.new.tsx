import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useNavigate } from "react-router";
import { useRouteData } from "~/hooks";
import { ApiKeyForm, apiKeyValidator, upsertApiKey } from "~/modules/settings";
import { mintApiKey } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "users"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "API_KEYS",
    redirectTo: path.to.apiKeys
  });

  const formData = await request.formData();
  const validation = await validator(apiKeyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, scopes: scopesJson, expiresAt, ...d } = validation.data;

  // Parse scopes from JSON string
  const scopes = scopesJson ? JSON.parse(scopesJson) : {};

  // Generated in the route action (server-only context), never persisted raw
  const { rawKey, keyHash, keyPreview } = mintApiKey();

  const insertApiKey = await upsertApiKey(client, {
    ...d,
    scopes,
    expiresAt: expiresAt || undefined,
    rawKey,
    keyHash,
    keyPreview,
    companyId,
    createdBy: userId
  });
  if (insertApiKey.error) {
    return data(
      {},
      await flash(
        request,
        error(insertApiKey.error, "Failed to create API key")
      )
    );
  }

  const key = insertApiKey.data?.key;
  if (!key) {
    return data(
      {},
      await flash(request, error(insertApiKey, "Failed to create API key"))
    );
  }

  return data({ key }, { status: 201 });
}

export default function NewApiKeyRoute() {
  const navigate = useNavigate();
  const routeData = useRouteData<{ companyId: string }>(path.to.apiKeys);

  const initialValues = {
    name: ""
  };

  return (
    <ApiKeyForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
      companyId={routeData?.companyId}
    />
  );
}
