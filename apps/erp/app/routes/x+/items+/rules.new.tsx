import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { itemRuleValidator, upsertItemRule } from "~/modules/items";
import ItemRuleForm from "~/modules/items/ui/ItemRules/ItemRuleForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { requirePlan } from "~/utils/planGate.server";
import { getCompanyId, itemRulesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "parts" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    redirectTo: path.to.itemRules
  });

  const formData = await request.formData();
  const validation = await validator(itemRuleValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id excluded on insert
  const { id, ...rest } = validation.data;

  const insert = await upsertItemRule(client, {
    ...rest,
    description: rest.description ?? null,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insert.error) {
    return data(
      {},
      await flash(request, error(insert.error, "Failed to create item rule"))
    );
  }

  return redirect(
    `${path.to.itemRules}?${getParams(request)}`,
    await flash(request, success("Item rule created"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    itemRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewItemRuleRoute() {
  const navigate = useNavigate();
  return (
    <ItemRuleForm
      onClose={() => navigate(-1)}
      initialValues={{
        name: "",
        description: "",
        message: "",
        severity: "error",
        active: true
      }}
    />
  );
}
