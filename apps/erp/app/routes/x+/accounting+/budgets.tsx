import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Heading, HStack } from "@carbon/react";
import { useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { New } from "~/components";
import { getBudgets } from "~/modules/accounting";
import { BudgetsTable } from "~/modules/accounting/ui/Budgets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Budgets",
  to: path.to.budgets
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const budgets = await getBudgets(client, companyId);

  if (budgets.error) {
    throw redirect(
      path.to.accounting,
      await flash(request, error(budgets.error, "Failed to load budgets"))
    );
  }

  return {
    budgets: budgets.data ?? []
  };
}

export default function BudgetsRoute() {
  const { budgets } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handleEdit = useCallback(
    (id: string) => navigate(path.to.editBudget(id)),
    [navigate]
  );
  const handleDelete = useCallback(
    (id: string) => navigate(path.to.deleteBudget(id)),
    [navigate]
  );
  const handleApprove = useCallback(
    (id: string) => navigate(path.to.approveBudget(id)),
    [navigate]
  );

  return (
    <div className="w-full">
      <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
        <Heading size="h3">Budgets</Heading>
        <HStack>
          <New label="Budget" to={path.to.newBudget} variant="primary" />
        </HStack>
      </div>
      <BudgetsTable
        budgets={budgets}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onApprove={handleApprove}
      />
      <Outlet />
    </div>
  );
}
