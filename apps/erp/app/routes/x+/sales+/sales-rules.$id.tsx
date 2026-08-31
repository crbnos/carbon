import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { SalesRuleSurface } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import type { z } from "zod";
import { type salesRuleSeverities, salesRuleValidator } from "~/modules/sales";
import { SalesRuleForm } from "~/modules/sales/ui/SalesRules";
import { getEnforcementRule, upsertEnforcementRule } from "~/modules/shared";
import { getParams, path } from "~/utils/path";
import { getCompanyId, salesRulesQuery } from "~/utils/react-query";

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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "SALES_RULES",
    redirectTo: path.to.salesRules
  });

  const { id } = params;
  if (!id) throw new Error("id required");

  const formData = await request.formData();
  const validation = await validator(salesRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const update = await upsertEnforcementRule(client, "sales", companyId, {
    ...validation.data,
    id,
    description: validation.data.description ?? null,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update rule"))
    );
  }

  throw redirect(`${path.to.salesRules}?${getParams(request)}`);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    salesRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditSalesRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
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
      onClose={() => navigate(path.to.salesRules)}
    />
  );
}
