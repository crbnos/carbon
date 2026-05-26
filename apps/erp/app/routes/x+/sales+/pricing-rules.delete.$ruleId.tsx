import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deletePricingRule,
  getPricingRule
} from "~/modules/sales/sales.service.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { ruleId } = params;
  if (!ruleId) throw notFound("ruleId not found");

  const pricingRule = await getPricingRule(ruleId);
  if (pricingRule.error) {
    throw redirect(
      `${path.to.salesPricingRules}?${getParams(request)}`,
      await flash(
        request,
        error(pricingRule.error, "Failed to get pricing rule")
      )
    );
  }

  return { pricingRule: pricingRule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "sales"
  });

  const { ruleId } = params;
  if (!ruleId) {
    throw redirect(
      path.to.salesPricingRules,
      await flash(request, error(params, "Failed to get pricing rule id"))
    );
  }

  const { error: deleteError } = await deletePricingRule(ruleId);
  if (deleteError) {
    throw redirect(
      path.to.salesPricingRules,
      await flash(request, error(deleteError, "Failed to delete pricing rule"))
    );
  }

  throw redirect(
    path.to.salesPricingRules,
    await flash(request, success("Pricing rule deleted"))
  );
}

export default function DeletePricingRuleRoute() {
  const { ruleId } = useParams();
  const { pricingRule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { t } = useLingui();

  if (!pricingRule) return null;
  if (!ruleId) throw notFound("ruleId not found");

  return (
    <ConfirmDelete
      action={path.to.deletePricingRule(ruleId)}
      name={pricingRule.name}
      text={t`Are you sure you want to delete the pricing rule: ${pricingRule.name}? This cannot be undone.`}
      onCancel={() => navigate(path.to.salesPricingRules)}
    />
  );
}
