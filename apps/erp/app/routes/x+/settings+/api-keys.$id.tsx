// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  apiKeyFields,
  apiKeyValidator
} from "~/modules/settings/settings.models";
import type { ApiKey } from "~/modules/settings/types";
import { ApiKeyForm } from "~/modules/settings/ui";
import { getParams, path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(apiKeyValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
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
  const closeRoute = useCloseRoute();
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
      onClose={() => closeRoute()}
    />
  );
}
