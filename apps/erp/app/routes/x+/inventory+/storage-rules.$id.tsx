import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ConditionAst } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { storageRuleValidator } from "~/modules/inventory";
import StorageRuleForm from "~/modules/inventory/ui/StorageRules/StorageRuleForm";
import { getEnforcementRule, upsertEnforcementRule } from "~/modules/shared";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const { id } = params;
  if (!id) throw notFound("id required");
  const rule = await getEnforcementRule(client, "storage", id, companyId);
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
  if (validation.error) return validationError(validation.error);

  const update = await upsertEnforcementRule(client, "storage", companyId, {
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
