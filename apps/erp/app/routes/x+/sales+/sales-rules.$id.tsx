import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { ConditionAst } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  getSalesRule,
  salesRuleValidator,
  upsertSalesRule
} from "~/modules/sales";
import { SalesRuleForm } from "~/modules/sales/ui/SalesRules";
import { getParams, path } from "~/utils/path";
import { getCompanyId, salesRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "sales" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getSalesRule(client, id);
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

  const update = await upsertSalesRule(client, {
    ...validation.data,
    id,
    description: validation.data.description ?? null,
    updatedBy: userId
  });

  if (update.error) {
    return await flash(
      request,
      error(update.error, "Failed to update rule")
    ).then(() => null);
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
      initialValues={
        {
          ...((rule ?? {}) as Record<string, unknown>),
          conditionAst: (rule as { conditionAst: unknown })
            .conditionAst as unknown as ConditionAst
        } as never
      }
      onClose={() => navigate(path.to.salesRules)}
    />
  );
}
