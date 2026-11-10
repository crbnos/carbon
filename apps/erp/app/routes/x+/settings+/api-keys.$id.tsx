// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { SINGLE_TENANT } from "@carbon/env";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  apiKeyFields,
  apiKeyValidator
} from "~/modules/settings/settings.models";
import { getApiKey } from "~/modules/settings/settings.service";
import { ApiKeyForm } from "~/modules/settings/ui";
import { getParams, path } from "~/utils/path";

// The list holds only the rows scrolled so far, so the drawer reads its own key.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await authorize(request, {
    "settings.apiKeys": "Edit"
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

  return { apiKey: apiKey.data, canSetRateLimit: SINGLE_TENANT };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(apiKeyValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.settings.updateApiKey({
    ...apiKeyFields(input.data),
    id: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.apiKeys}?${getParams(args.request)}`,
    { message: "Updated API key" }
  );
}

export default function EditApiKeyRoute() {
  const dialog = useRouteDialog();
  const { apiKey, canSetRateLimit } = useLoaderData<typeof loader>();

  const initialValues = {
    id: apiKey.id,
    name: apiKey.name,
    expiresAt: apiKey.expiresAt ?? undefined,
    rateLimit: apiKey.rateLimit
  };

  return (
    <ApiKeyForm
      key={initialValues.id}
      initialValues={initialValues}
      existingGrants={apiKey.permission ?? []}
      canSetRateLimit={canSetRateLimit}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
