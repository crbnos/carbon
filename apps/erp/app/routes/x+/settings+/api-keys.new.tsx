// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  apiKeyFields,
  apiKeyValidator
} from "~/modules/settings/settings.models";
import { ApiKeyForm } from "~/modules/settings/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, {
    update: "users"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(apiKeyValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.settings.createApiKey(apiKeyFields(input.data));
}

export default function NewApiKeyRoute() {
  const closeRoute = useCloseRoute();
  return (
    <ApiKeyForm onClose={() => closeRoute()} initialValues={{ name: "" }} />
  );
}
