import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  budgetValidator,
  copyBudgetLines,
  seedBudgetLinesFromActuals,
  upsertBudget
} from "~/modules/accounting";
import { BudgetForm } from "~/modules/accounting/ui/Budgets";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(budgetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    source,
    sourceBudgetId,
    sourceFiscalYear,
    adjustmentFactor,
    spread,
    ...d
  } = validation.data;

  const createBudget = await upsertBudget(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createBudget.error || !createBudget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(createBudget.error, "Failed to create budget"))
    );
  }

  const budgetId = createBudget.data.id;

  if (source === "budget" && sourceBudgetId) {
    const copied = await copyBudgetLines(client, {
      companyId,
      sourceBudgetId,
      targetBudgetId: budgetId,
      adjustmentFactor: adjustmentFactor ?? 1,
      userId
    });
    if (copied.error) {
      throw redirect(
        path.to.budget(budgetId),
        await flash(
          request,
          error(copied.error, "Budget created, but copying lines failed")
        )
      );
    }
  }

  if (source === "actuals" && sourceFiscalYear) {
    const seeded = await seedBudgetLinesFromActuals(client, {
      companyId,
      sourceFiscalYear,
      targetBudgetId: budgetId,
      adjustmentFactor: adjustmentFactor ?? 1,
      spread: spread ?? "source",
      userId
    });
    if (seeded.error) {
      throw redirect(
        path.to.budget(budgetId),
        await flash(
          request,
          error(seeded.error, "Budget created, but seeding from actuals failed")
        )
      );
    }
  }

  throw redirect(
    path.to.budget(budgetId),
    await flash(request, success("Budget created"))
  );
}

export default function NewBudgetRoute() {
  const navigate = useNavigate();

  const initialValues = {
    name: "",
    fiscalYear: new Date().getFullYear() + 1,
    source: "none" as const
  };

  return (
    <BudgetForm onClose={() => navigate(-1)} initialValues={initialValues} />
  );
}
