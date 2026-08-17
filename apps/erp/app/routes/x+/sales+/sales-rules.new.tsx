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
import { salesRuleValidator } from "~/modules/sales";
import { SalesRuleForm } from "~/modules/sales/ui/SalesRules";
import { upsertEnforcementRule } from "~/modules/shared";
import { getParams, path } from "~/utils/path";
import { getCompanyId, salesRulesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales" });
  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "SALES_RULES",
    redirectTo: path.to.salesRules
  });

  const formData = await request.formData();
  const validation = await validator(salesRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const insert = await upsertEnforcementRule(client, "sales", {
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

  throw redirect(`${path.to.salesRules}?${getParams(request)}`);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    salesRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewSalesRuleRoute() {
  const navigate = useNavigate();
  // navigate(-1) breaks when the page was opened directly (no history entry
  // to pop). Always navigate forward to the parent list route — closes the
  // drawer regardless of how the user got here.
  return (
    <SalesRuleForm
      initialValues={{}}
      onClose={() => navigate(path.to.salesRules)}
    />
  );
}
