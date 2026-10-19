// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { ApiKey } from "~/modules/settings/types";
import { getParams, path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.revokeApiKey({ id: input.params.id });
  return respond(args.request, result).redirect(
    `${path.to.apiKeys}?${getParams(args.request)}`,
    { message: "Successfully deleted API key" }
  );
}

export default function DeleteApiKeyRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const routeData = useRouteData<{ apiKeys: ApiKey[] }>(path.to.apiKeys);
  const closeRoute = useCloseRoute();
  const { t } = useLingui();

  const apiKey = routeData?.apiKeys.find((apiKey) => apiKey.id === id);
  if (!apiKey) return null;

  const onCancel = () => closeRoute();

  return (
    <ConfirmDelete
      action={path.to.deleteApiKey(id)}
      name={apiKey.name}
      text={t`Are you sure you want to delete the API key: ${apiKey.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
