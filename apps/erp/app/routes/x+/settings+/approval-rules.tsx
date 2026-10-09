// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getApprovalRules } from "@carbon/ee/approvals.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { ApprovalRules, ApprovalRulesUpgradeOverlay } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Approval Rules`,
  to: path.to.approvalRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const serviceRole = getCarbonServiceRole();

  const [rules, groupsResult] = await Promise.all([
    getApprovalRules(serviceRole, companyId),
    client
      .from("group")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isCustomerOrgGroup", false)
      .eq("isCustomerTypeGroup", false)
      .eq("isSupplierOrgGroup", false)
      .eq("isSupplierTypeGroup", false)
  ]);

  if (rules.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(rules.error, "Failed to load approval rules"))
    );
  }

  const groupMap = new Map(
    (groupsResult.data || []).map((g) => [g.id, g.name])
  );

  const enrichedRules = (rules.data || []).map((rule) => ({
    ...rule,
    approverGroupNames: rule.approverGroupIds
      ? rule.approverGroupIds
          .map((id) => groupMap.get(id))
          .filter((name): name is string => !!name)
      : []
  }));

  const poRules = enrichedRules
    .filter((r) => r.documentType === "purchaseOrder")
    .sort((a, b) => (a.lowerBoundAmount ?? 0) - (b.lowerBoundAmount ?? 0));

  const qdRules = enrichedRules.filter(
    (r) => r.documentType === "qualityDocument"
  );

  const supplierRules = enrichedRules.filter(
    (r) => r.documentType === "supplier"
  );

  const changeOrderRules = enrichedRules.filter(
    (r) => r.documentType === "changeOrder"
  );

  return {
    poRules,
    qdRules,
    supplierRules,
    changeOrderRules
  };
}

export default function ApprovalSettingsRoute() {
  const { poRules, qdRules, supplierRules, changeOrderRules } =
    useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "APPROVAL_RULES" });

  if (isGated) {
    return <ApprovalRulesUpgradeOverlay />;
  }

  return (
    <>
      <ApprovalRules
        poRules={poRules}
        qdRules={qdRules}
        supplierRules={supplierRules}
        changeOrderRules={changeOrderRules}
      />
      <RecordOutlet />
    </>
  );
}
