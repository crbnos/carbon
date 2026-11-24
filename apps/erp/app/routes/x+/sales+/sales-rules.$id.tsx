// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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
import { getEnforcementRule } from "~/modules/shared/shared.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getEnforcementRule(client, "sales", id, companyId);
  if (rule.error || !rule.data) throw notFound("Rule not found");
  return { rule: rule.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesRuleValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
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
      // Per-field mapping from the DB row; the three casts below are genuine
      // DB-boundary narrowings (severity/surfaces are CHECK-constrained TEXT/
      // shared-enum columns, conditionAst is Json).
      initialValues={{
        id: rule.id,
        name: rule.name,
        description: rule.description ?? undefined,
        message: rule.message,
        severity: rule.severity as (typeof salesRuleSeverities)[number],
        filteredItemTypes: rule.filteredItemTypes ?? undefined,
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
