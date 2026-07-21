import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { approveBudget, archiveBudget, getBudget } from "~/modules/accounting";
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
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
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

  const transition =
    budget.data.status === "Draft"
      ? await approveBudget(client, { budgetId, companyId, userId })
      : await archiveBudget(client, { budgetId, companyId, userId });

  if (transition.error) {
    throw redirect(
      path.to.budgets,
      await flash(
        request,
        error(transition.error, "Failed to update budget status")
      )
    );
  }

  throw redirect(
    path.to.budgets,
    await flash(
      request,
      success(
        budget.data.status === "Draft" ? "Budget approved" : "Budget archived"
      )
    )
  );
}

export default function ApproveBudgetRoute() {
  const { budgetId } = useParams();
  const { budget } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!budget || !budgetId) return null;

  const isDraft = budget.status === "Draft";

  return (
    <ConfirmDelete
      action={path.to.approveBudget(budgetId)}
      name={budget.name}
      deleteText={isDraft ? "Approve" : "Archive"}
      text={
        isDraft
          ? `Approve the budget: ${budget.name}? Approved budgets are locked — revise by copying to a new draft.`
          : `Archive the budget: ${budget.name}?`
      }
      onCancel={() => navigate(path.to.budgets)}
    />
  );
}
