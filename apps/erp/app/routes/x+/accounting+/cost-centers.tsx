import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Heading,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { getCostCentersTree } from "~/modules/accounting";
import {
  CostCentersListView,
  CostCentersTreeView
} from "~/modules/accounting/ui/CostCenters";
import { getApprovalRulesForApprover } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Cost Centers`,
  to: path.to.costCenters
};

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
    <Tabs defaultValue="tree" className="w-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <Heading size="h3">Cost Centers</Heading>
        <HStack>
          <TabsList>
            <TabsTrigger value="tree">Tree View</TabsTrigger>
            <TabsTrigger value="list">List View</TabsTrigger>
          </TabsList>
          <New
            label="Cost Center"
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

      <Outlet />
    </Tabs>
  );
}
