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
  getStorageRule,
  storageRuleValidator,
  upsertStorageRule
} from "~/modules/storage-rules";
import StorageRuleForm from "~/modules/storage-rules/ui/StorageRuleForm";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "inventory" });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getStorageRule(client, id);
  if (rule.error || !rule.data) throw notFound("Rule not found");
  return { rule: rule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
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

  const formData = await request.formData();
  const validation = await validator(storageRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const update = await upsertStorageRule(client, {
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

  throw redirect(`${path.to.storageRules}?${getParams(request)}`);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    storageRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditStorageRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <StorageRuleForm
      initialValues={
        {
          ...((rule ?? {}) as Record<string, unknown>),
          conditionAst: (rule as { conditionAst: unknown })
            .conditionAst as unknown as ConditionAst
        } as never
      }
      onClose={() => navigate(path.to.storageRules)}
    />
  );
}
