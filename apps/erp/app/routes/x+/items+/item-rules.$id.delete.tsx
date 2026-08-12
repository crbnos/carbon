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
import { deleteItemRule, getItemRule } from "~/modules/items";
import { getParams, path } from "~/utils/path";
import { getCompanyId, itemRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { delete: "parts" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getItemRule(client, id);
  if (rule.error || !rule.data) {
    throw redirect(
      path.to.itemRules,
      await flash(request, error(rule.error, "Rule not found"))
    );
  }
  return { rule: rule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "ITEM_RULES",
    redirectTo: path.to.itemRules
  });

  const { id } = params;
  if (!id) throw new Error("id required");

  const result = await deleteItemRule(client, id);
  if (result.error) {
    throw redirect(
      `${path.to.itemRules}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to delete rule"))
    );
  }

  throw redirect(
    `${path.to.itemRules}?${getParams(request)}`,
    await flash(request, success("Rule deleted"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    itemRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteItemRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const { id } = (rule as { id: string }) ?? { id: "" };
  const navigate = useNavigate();
  return (
    <ConfirmDelete
      action={path.to.deleteItemRule(id)}
      name={(rule as { name?: string })?.name ?? "this rule"}
      text="Are you sure you want to delete this rule? Assignments will also be removed."
      onCancel={() => navigate(path.to.itemRules)}
    />
  );
}
