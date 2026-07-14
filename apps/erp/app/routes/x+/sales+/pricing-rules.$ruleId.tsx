import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  duplicatePricingRule,
  getPricingRule,
  pricingRuleValidator,
  updatePricingRule
} from "~/modules/sales";
import PricingRuleForm from "~/modules/sales/ui/Pricing/PricingRuleForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { ruleId } = params;
  if (!ruleId) throw notFound("ruleId not found");

  const pricingRule = await getPricingRule(client, ruleId);
  if (pricingRule.error) {
    throw redirect(
      path.to.salesPricingRules,
      await flash(
        request,
        error(pricingRule.error, "Failed to load pricing rule")
      )
    );
  }

  return { pricingRule: pricingRule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { ruleId } = params;
  if (!ruleId) throw notFound("ruleId not found");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "duplicate") {
    const result = await duplicatePricingRule(
      client,
      ruleId,
      companyId,
      userId
    );
    if (result.error) {
      throw redirect(
        `${path.to.salesPricingRules}?${getParams(request)}`,
        await flash(
          request,
          error(result.error, "Failed to duplicate pricing rule")
        )
      );
    }
    throw redirect(
      `${path.to.pricingRule(result.data!.id)}?${getParams(request)}`,
      await flash(request, success("Pricing rule duplicated"))
    );
  }

  const validation = await validator(pricingRuleValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updatePricingRule(
    client,
    ruleId,
    userId,
    validation.data
  );

  if (result.error) {
    throw redirect(
      `${path.to.salesPricingRules}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to update pricing rule"))
    );
  }

  throw redirect(
    `${path.to.salesPricingRules}?${getParams(request)}`,
    await flash(request, success("Pricing rule updated"))
  );
}

export default function EditPricingRuleRoute() {
  const { pricingRule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!pricingRule) return null;

  const initialValues = {
    id: pricingRule.id,
    name: pricingRule.name,
    ruleType: pricingRule.ruleType,
    amountType: pricingRule.amountType,
    amount: pricingRule.amount,
    minQuantity: pricingRule.minQuantity ?? undefined,
    maxQuantity: pricingRule.maxQuantity ?? undefined,
    customerIds: pricingRule.customerIds ?? [],
    customerTypeIds: pricingRule.customerTypeIds ?? [],
    itemIds: pricingRule.itemIds ?? [],
    itemPostingGroupId: pricingRule.itemPostingGroupId ?? undefined,
    validFrom: pricingRule.validFrom ?? undefined,
    validTo: pricingRule.validTo ?? undefined,
    priority: pricingRule.priority ?? 0,
    active: pricingRule.active
  };

  return (
    <PricingRuleForm
      key={pricingRule.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
