import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ConditionAst } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getItemRule,
  itemRuleValidator,
  upsertItemRule
} from "~/modules/items";
import ItemRuleForm from "~/modules/items/ui/ItemRules/ItemRuleForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { requirePlan } from "~/utils/planGate.server";
import { getCompanyId, itemRulesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const rule = await getItemRule(client, id);

  return { rule: rule.data ?? null };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    redirectTo: path.to.itemRules
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(itemRuleValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertItemRule(client, {
    id,
    ...validation.data,
    description: validation.data.description ?? null,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update item rule"))
    );
  }

  throw redirect(
    `${path.to.itemRules}?${getParams(request)}`,
    await flash(request, success("Updated item rule"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    itemRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditItemRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: rule?.id ?? undefined,
    name: rule?.name ?? "",
    description: rule?.description ?? "",
    message: rule?.message ?? "",
    severity: (rule?.severity as "error" | "warn") ?? "error",
    active: rule?.active ?? true,
    conditionAst: (rule?.conditionAst as ConditionAst | undefined) ?? {
      kind: "all" as const,
      conditions: []
    },
    ...getCustomFields(rule?.customFields)
  };

  return (
    <ItemRuleForm
      key={initialValues.id}
      // ConditionAst.value is `unknown` to keep the AST permissive at the
      // type level, but the validator narrows it to scalars/arrays. Cast
      // through `unknown` since the runtime values are produced by the same
      // validator on save.
      initialValues={
        initialValues as unknown as React.ComponentProps<
          typeof ItemRuleForm
        >["initialValues"]
      }
      onClose={() => navigate(-1)}
    />
  );
}
