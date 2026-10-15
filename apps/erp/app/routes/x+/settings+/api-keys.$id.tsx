// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { upsertApiKey } from "@carbon/ee/api-keys.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { ApiKeyForm, apiKeyValidator, getApiKey } from "~/modules/settings";
import { invalidateApiKeyCache } from "~/modules/settings/settings.server";
import { getParams, path } from "~/utils/path";

// The list holds only the rows scrolled so far, so the drawer reads its own key.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const apiKey = await getApiKey(client, id, companyId);
  if (apiKey.error) {
    throw redirect(
      `${path.to.apiKeys}?${getParams(request)}`,
      await flash(request, error(apiKey.error, "Failed to load API key"))
    );
  }

  return { apiKey: apiKey.data, companyId };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  await requireFeature({
    request,
    client,
    companyId,
    feature: "API_KEYS",
    redirectTo: path.to.apiKeys
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(apiKeyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

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

  // A scope/expiry edit must not keep authenticating from the 30s auth cache.
  await invalidateApiKeyCache(id, companyId);

  throw redirect(
    `${path.to.apiKeys}?${getParams(request)}`,
    await flash(request, success("Updated API key"))
  );
}

export default function EditApiKeyRoute() {
  const closeRoute = useCloseRoute();
  const { apiKey, companyId } = useLoaderData<typeof loader>();

  const initialValues = {
    id: apiKey.id,
    name: apiKey.name,
    expiresAt: apiKey.expiresAt ?? undefined
  };

  return (
    <ApiKeyForm
      key={initialValues.id}
      initialValues={initialValues}
      companyId={companyId}
      existingScopes={apiKey.scopes as Record<string, string[]> | null}
      onClose={() => closeRoute()}
    />
  );
}
