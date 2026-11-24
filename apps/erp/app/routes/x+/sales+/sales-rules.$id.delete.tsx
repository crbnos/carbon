// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getEnforcementRule } from "~/modules/shared/shared.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getEnforcementRule(client, "sales", id, companyId);
  if (rule.error || !rule.data) {
    throw redirect(
      path.to.salesRules,
      await flash(request, error(rule.error, "Rule not found"))
    );
  }
  return { rule: rule.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { request } = args;
  const api = await carbon(request);
  const result = await api.sales.deleteSalesRule({ id: input.params.id });
  const list = `${path.to.salesRules}?${getParams(request)}`;
  return respond(request, result).redirect(list, {
    message: "Rule deleted",
    onError: list
  });
}

export default function DeleteSalesRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const id = rule?.id ?? "";
  const dialog = useRouteDialog(path.to.salesRules);
  return (
    <ConfirmDelete
      action={path.to.deleteSalesRule(id)}
      name={rule?.name ?? "this rule"}
      text="Are you sure you want to delete this rule? Assignments will also be removed."
      isOpen={dialog.open}
      onCancel={dialog.close}
    />
  );
}
