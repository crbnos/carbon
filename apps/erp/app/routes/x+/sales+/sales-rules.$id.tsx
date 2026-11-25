// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { SalesRuleSurface } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { z } from "zod";
import {
  type salesRuleSeverities,
  salesRuleValidator
} from "~/modules/sales/sales.models";
import { SalesRuleForm } from "~/modules/sales/ui/SalesRules";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "sales.salesRules": "View" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await api.shared.getEnforcementRule({ family: "sales", id });
  if (rule.error || !rule.data) throw notFound("Rule not found");
  return { rule: rule.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesRuleValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.sales.updateSalesRule({
    ...input.data,
    id: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.salesRules}?${getParams(args.request)}`
  );
}

export default function EditSalesRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.salesRules);
  return (
    <SalesRuleForm
      // Per-field mapping from the DB row; the casts below are genuine
      // DB-boundary narrowings (severity/surfaces are CHECK-constrained TEXT/
      // shared-enum columns, the item types a text array, conditionAst Json).
      initialValues={{
        id: rule.id,
        name: rule.name,
        description: rule.description ?? undefined,
        message: rule.message,
        severity: rule.severity as (typeof salesRuleSeverities)[number],
        filteredItemTypes: (rule.filteredItemTypes ?? undefined) as z.infer<
          typeof salesRuleValidator
        >["filteredItemTypes"],
        filteredItemGroupIds: rule.filteredItemGroupIds ?? undefined,
        filteredItemMatchAll: rule.filteredItemMatchAll,
        active: rule.active,
        surfaces: rule.surfaces as SalesRuleSurface[],
        conditionAst: rule.conditionAst as unknown as z.infer<
          typeof salesRuleValidator
        >["conditionAst"]
      }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
