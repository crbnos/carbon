import { assertIsPost, error } from "@carbon/auth";
import { hashApiKey, requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useNavigate } from "react-router";
import { useRouteData } from "~/hooks";
import { ApiKeyForm, apiKeyValidator, upsertApiKey } from "~/modules/settings";
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

  const formData = await request.formData();
  const validation = await validator(apiKeyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, scopes: scopesJson, expiresAt, ...d } = validation.data;

  // Parse scopes from JSON string
  const scopes = scopesJson ? JSON.parse(scopesJson) : {};

  // Generate key + hash in the route action (server-only context)
  const rawKey = `crbn_${nanoid()}`;
  const keyHash = hashApiKey(rawKey);
  const keyPreview = rawKey.slice(-5);

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
