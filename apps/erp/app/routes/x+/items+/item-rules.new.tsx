import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useNavigate } from "react-router";
import { itemRuleValidator, upsertItemRule } from "~/modules/items";
import { ItemRuleForm } from "~/modules/items/ui/ItemRules";
import { getParams, path } from "~/utils/path";
import { getCompanyId, itemRulesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "parts" });
  return {};
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
    feature: "ITEM_RULES",
    redirectTo: path.to.itemRules
  });

  const formData = await request.formData();
  const validation = await validator(itemRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const insert = await upsertItemRule(client, {
    ...validation.data,
    description: validation.data.description ?? null,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    return await flash(
      request,
      error(insert.error, "Failed to create rule")
    ).then(() => null);
  }

  throw redirect(`${path.to.itemRules}?${getParams(request)}`);
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
  // navigate(-1) breaks when the page was opened directly (no history entry
  // to pop). Always navigate forward to the parent list route — closes the
  // drawer regardless of how the user got here.
  return (
    <ItemRuleForm
      initialValues={{}}
      onClose={() => navigate(path.to.itemRules)}
    />
  );
}
