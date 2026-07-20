import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ApprovalRules, getCompanySettings } from "~/modules/settings";
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

  const [rules, groupsResult, companySettings] = await Promise.all([
    getApprovalRules(serviceRole, companyId),
    client
      .from("group")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isCustomerOrgGroup", false)
      .eq("isCustomerTypeGroup", false)
      .eq("isSupplierOrgGroup", false)
      .eq("isSupplierTypeGroup", false),
    getCompanySettings(client, companyId)
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

  const byFloor = (a: (typeof enrichedRules)[number], b: typeof a) =>
    (a.lowerBoundAmount ?? 0) - (b.lowerBoundAmount ?? 0);

  const jeRules = enrichedRules
    .filter((r) => r.documentType === "journalEntry")
    .sort(byFloor);

  const paymentRules = enrichedRules
    .filter((r) => r.documentType === "payment")
    .sort(byFloor);

  const purchaseInvoiceRules = enrichedRules
    .filter((r) => r.documentType === "purchaseInvoice")
    .sort(byFloor);

  const memoRules = enrichedRules
    .filter((r) => r.documentType === "memo")
    .sort(byFloor);

  const enforceNoSelfApproval =
    (companySettings.data as { enforceNoSelfApproval?: boolean } | null)
      ?.enforceNoSelfApproval ?? true;

  return {
    poRules,
    qdRules,
    supplierRules,
    jeRules,
    paymentRules,
    purchaseInvoiceRules,
    memoRules,
    enforceNoSelfApproval
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "enforceNoSelfApproval") {
    const enabled = formData.get("enabled") === "true";
    const update = await client
      .from("companySettings")
      // @ts-ignore - enforceNoSelfApproval column added in the document-approvals migration
      .update({ enforceNoSelfApproval: enabled })
      .eq("id", companyId);

    if (update.error) return { success: false, message: update.error.message };

    return {
      success: true,
      message: `Self-approval prevention ${enabled ? "enabled" : "disabled"}`
    };
  }

  return { success: false, message: "Invalid intent" };
}

export default function ApprovalSettingsRoute() {
  const {
    poRules,
    qdRules,
    supplierRules,
    jeRules,
    paymentRules,
    purchaseInvoiceRules,
    memoRules,
    enforceNoSelfApproval
  } = useLoaderData<typeof loader>();

  return (
    <>
      <ApprovalRules
        poRules={poRules}
        qdRules={qdRules}
        supplierRules={supplierRules}
        jeRules={jeRules}
        paymentRules={paymentRules}
        purchaseInvoiceRules={purchaseInvoiceRules}
        memoRules={memoRules}
        enforceNoSelfApproval={enforceNoSelfApproval}
      />
      <Outlet />
    </>
  );
}
