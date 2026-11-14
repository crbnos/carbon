// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getApprovalRulesForApprover } from "@carbon/ee/approvals.server";
import {
  HStack,
  RecordOutlet,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { New } from "~/components";
import { SettingsPageHeading } from "~/components/SettingsPage";
import { usePersistentPageTab } from "~/hooks/usePersistentPageTab";
import { getCostCentersTree } from "~/modules/accounting/accounting.service";
import {
  CostCentersListView,
  CostCentersTreeView
} from "~/modules/accounting/ui/CostCenters";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringTabDisplay } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Cost Centers`,
  to: path.to.costCenters
};

export const shouldRevalidate = revalidateIgnoringTabDisplay;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const [costCenters, approvalRules] = await Promise.all([
    getCostCentersTree(client, companyId),
    getApprovalRulesForApprover(client, "purchaseOrder", companyId)
  ]);

  if (costCenters.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(costCenters.error, "Failed to load cost centers")
      )
    );
  }

  return {
    costCenters: costCenters.data ?? [],
    purchaseOrderApprovalsActive: (approvalRules.data?.length ?? 0) > 0
  };
}

export default function Route() {
  const { t } = useLingui();
  const [, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = usePersistentPageTab(
    "view",
    ["tree", "list"],
    "tree",
    "tab"
  );
  const { costCenters } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handleEdit = useCallback(
    (id: string) => {
      navigate(path.to.costCenter(id));
    },
    [navigate]
  );

  const handleDelete = useCallback(
    (id: string) => {
      navigate(path.to.deleteCostCenter(id));
    },
    [navigate]
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      navigate(`${path.to.newCostCenter}?parentCostCenterId=${parentId}`);
    },
    [navigate]
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => {
        setActiveTab(tab);
        setSearchParams(
          (previous) => {
            const next = new URLSearchParams(previous);
            if (tab === "list") next.set("tab", "list");
            else next.delete("tab");
            return next;
          },
          { replace: true, preventScrollReset: true }
        );
      }}
      className="w-full"
    >
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <SettingsPageHeading>
          <Trans>Cost Centers</Trans>
        </SettingsPageHeading>
        <HStack>
          <TabsList>
            <TabsTrigger value="tree">Tree View</TabsTrigger>
            <TabsTrigger value="list">List View</TabsTrigger>
          </TabsList>
          <New
            label={t`Cost Center`}
            to={path.to.newCostCenter}
            variant="primary"
          />
        </HStack>
      </div>

      <TabsContent value="tree">
        <CostCentersTreeView
          costCenters={costCenters}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
        />
      </TabsContent>

      <TabsContent value="list">
        <CostCentersListView
          costCenters={costCenters}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
        />
      </TabsContent>

      <RecordOutlet />
    </Tabs>
  );
}
