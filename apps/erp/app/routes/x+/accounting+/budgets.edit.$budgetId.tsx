import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { budgetValidator, getBudget, upsertBudget } from "~/modules/accounting";
import { BudgetForm } from "~/modules/accounting/ui/Budgets";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { budgetId } = params;
  if (!budgetId) throw notFound("Budget ID was not found");

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
  if (!budgetId) throw notFound("Budget ID was not found");

  const formData = await request.formData();
  const validation = await validator(budgetValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    source: _source,
    sourceBudgetId: _sourceBudgetId,
    sourceFiscalYear: _sourceFiscalYear,
    adjustmentFactor: _adjustmentFactor,
    spread: _spread,
    ...d
  } = validation.data;

  const updateBudget = await upsertBudget(client, {
    id: budgetId,
    ...d,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateBudget.error) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(updateBudget.error, "Failed to update budget"))
    );
  }

  throw redirect(
    path.to.budgets,
    await flash(request, success("Budget updated"))
  );
}

export default function EditBudgetRoute() {
  const { budget } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: budget.id,
    name: budget.name,
    description: budget.description ?? undefined,
    fiscalYear: budget.fiscalYear
  };

  return (
    <BudgetForm
      onClose={() => navigate(-1)}
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
