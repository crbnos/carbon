// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { SINGLE_TENANT } from "@carbon/env";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { apiKeyValidator } from "~/modules/settings/settings.models";
import { ApiKeyForm } from "~/modules/settings/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "settings.apiKeys": "Edit" });

  return { canSetRateLimit: SINGLE_TENANT };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(apiKeyValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.settings.createApiKey(input.data);
}

export default function NewApiKeyRoute() {
  const dialog = useRouteDialog();
  const { canSetRateLimit } = useLoaderData<typeof loader>();

  const initialValues = {
    name: "",
    // The column's default for a new key.
    rateLimit: 20
  };

  return (
    <ApiKeyForm
      open={dialog.open}
      onClose={dialog.close}
      initialValues={initialValues}
      canSetRateLimit={canSetRateLimit}
    />
  );
}
