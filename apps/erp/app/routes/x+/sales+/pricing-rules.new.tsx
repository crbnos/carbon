import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { createPricingRule, pricingRuleValidator } from "~/modules/sales";
import PricingRuleForm from "~/modules/sales/ui/Pricing/PricingRuleForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(pricingRuleValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createPricingRule(validation.data);

  if (result.error) {
    throw redirect(
      `${path.to.salesPricingRules}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to create pricing rule"))
    );
  }

  throw redirect(
    `${path.to.salesPricingRules}?${getParams(request)}`,
    await flash(request, success("Pricing rule created"))
  );
}

export default function NewPricingRuleRoute() {
  const navigate = useNavigate();

  return (
    <PricingRuleForm
      initialValues={{
        name: "",
        ruleType: "Discount",
        amountType: "Percentage",
        amount: 0,
        priority: 0,
        active: true,
        customerIds: [],
        customerTypeIds: [],
        itemIds: []
      }}
      onClose={() => navigate(-1)}
    />
  );
}
