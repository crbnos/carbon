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
import { deleteStorageRule, getStorageRule } from "~/modules/storageRules";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { delete: "inventory" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getStorageRule(client, id);
  if (rule.error || !rule.data) {
    throw redirect(
      path.to.storageRules,
      await flash(request, error(rule.error, "Rule not found"))
    );
  }
  return { rule: rule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "inventory"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "STORAGE_RULES",
    redirectTo: path.to.storageRules
  });

  const { id } = params;
  if (!id) throw new Error("id required");

  const result = await deleteStorageRule(client, id);
  if (result.error) {
    throw redirect(
      `${path.to.storageRules}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to delete rule"))
    );
  }

  throw redirect(
    `${path.to.storageRules}?${getParams(request)}`,
    await flash(request, success("Rule deleted"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    storageRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteStorageRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const { id } = (rule as { id: string }) ?? { id: "" };
  const navigate = useNavigate();
  return (
    <ConfirmDelete
      action={path.to.deleteStorageRule(id)}
      name={(rule as { name?: string })?.name ?? "this rule"}
      text="Are you sure you want to delete this rule? Assignments will also be removed."
      onCancel={() => navigate(path.to.storageRules)}
    />
  );
}
