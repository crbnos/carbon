import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ApprovalRules } from "~/modules/settings";
import { getApprovalRules } from "~/modules/shared";
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

  return {
    poRules,
    qdRules,
    supplierRules
  };
}

export default function ApprovalSettingsRoute() {
  const { poRules, qdRules, supplierRules } = useLoaderData<typeof loader>();

  return (
    <>
      <ApprovalRules
        poRules={poRules}
        qdRules={qdRules}
        supplierRules={supplierRules}
      />
      <Outlet />
    </>
  );
}
