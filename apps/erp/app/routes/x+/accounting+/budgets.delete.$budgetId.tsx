import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteBudget, getBudget } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("budgetId not found");

  const budget = await getBudget(client, budgetId, companyId);
  if (budget.error || !budget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(budget.error, "Failed to get budget"))
    );
  }

  return { budget: budget.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("budgetId not found");

  const remove = await deleteBudget(client, budgetId, companyId);
  if (remove.error) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(remove.error, "Failed to delete budget"))
    );
  }

  throw redirect(
    path.to.budgets,
    await flash(request, success("Budget deleted"))
  );
}

export default function DeleteBudgetRoute() {
  const { budgetId } = useParams();
  const { budget } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!budget || !budgetId) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteBudget(budgetId)}
      name={budget.name}
      text={`Are you sure you want to delete the budget: ${budget.name}? This cannot be undone. Only Draft budgets can be deleted.`}
      onCancel={() => navigate(path.to.budgets)}
    />
  );
}
