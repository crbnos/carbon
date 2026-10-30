// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getFederationRule } from "~/modules/settings/settings.service";
import { getParams, path } from "~/utils/path";

// The list holds only the rows scrolled so far, so the modal reads its own rule.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const rule = await getFederationRule(client, id, companyId);
  if (rule.error) {
    throw redirect(
      `${path.to.federationRules}?${getParams(request)}`,
      await flash(request, error(rule.error, "Failed to load federation rule"))
    );
  }

  return { rule: { name: rule.data.name } };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.deleteFederationRule({
    id: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.federationRules}?${getParams(args.request)}`,
    { message: "Deleted federation rule" }
  );
}

export default function DeleteFederationRuleRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { rule } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const { t } = useLingui();

  return (
    <ConfirmDelete
      action={path.to.deleteFederationRule(id)}
      name={rule.name}
      text={t`Are you sure you want to delete the federation rule: ${rule.name}? Every API key it issued stops working at once.`}
      onCancel={() => closeRoute()}
    />
  );
}
