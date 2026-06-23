import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  getRuleAssignmentCounts,
  getStorageRules
} from "~/modules/storage-rules";
import StorageRulesGroups from "~/modules/storage-rules/ui/StorageRulesGroups";
import StorageRulesUpgradeOverlay from "~/modules/storage-rules/ui/StorageRulesUpgradeOverlay";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Storage Rules`,
  to: path.to.storageRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const rules = await getStorageRules(client, companyId, {
    search: null,
    limit: 1000,
    offset: 0,
    sorts: []
  });

  if (rules.error) {
    throw redirect(
      path.to.storageUnits,
      await flash(request, error(rules.error, "Failed to load storage rules"))
    );
  }

  const ids = (rules.data ?? []).map((r) => r.id);
  const counts = await getRuleAssignmentCounts(client, ids);

  const countsData = (counts.data ?? {}) as Record<string, number>;
  const rows = (rules.data ?? []).map((r) => ({
    ...r,
    assignmentCount: countsData[r.id] ?? 0
  }));

  return { rows };
}

export default function StorageRulesRoute() {
  const { rows } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "STORAGE_RULES" });

  if (isGated) {
    return <StorageRulesUpgradeOverlay />;
  }

  return (
    <>
      <StorageRulesGroups rules={rows as never} />
      <Outlet />
    </>
  );
}
