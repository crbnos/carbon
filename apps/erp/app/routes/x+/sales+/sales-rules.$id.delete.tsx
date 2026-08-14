import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteSalesRule, getSalesRule } from "~/modules/sales";
import { getParams, path } from "~/utils/path";
import { getCompanyId, salesRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { delete: "sales" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getSalesRule(client, id);
  if (rule.error || !rule.data) {
    throw redirect(
      path.to.salesRules,
      await flash(request, error(rule.error, "Rule not found"))
    );
  }
  return { rule: rule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
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

  const result = await deleteSalesRule(client, id);
  if (result.error) {
    throw redirect(
      `${path.to.salesRules}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to delete rule"))
    );
  }

  throw redirect(
    `${path.to.salesRules}?${getParams(request)}`,
    await flash(request, success("Rule deleted"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    salesRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteSalesRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const { id } = (rule as { id: string }) ?? { id: "" };
  const navigate = useNavigate();
  return (
    <ConfirmDelete
      action={path.to.deleteSalesRule(id)}
      name={(rule as { name?: string })?.name ?? "this rule"}
      text="Are you sure you want to delete this rule? Assignments will also be removed."
      onCancel={() => navigate(path.to.salesRules)}
    />
  );
}
