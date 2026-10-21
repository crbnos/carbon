// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectExpenseValidator } from "~/modules/projects";
import {
  addProjectExpense,
  checkProjectBudget
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

/**
 * Charges a cost to an element from its page (the Charge button of a cost
 * card, or Charge cost on the Actual tab), posted at once through
 * `post-project-expense`. A refusal (a closed element, a budget block) is
 * returned as fetcher data, so the modal shows it and stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const validation = await validator(projectExpenseValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  // Budget control (Government Contracting 5c): Block keeps the modal open
  // with the overrun; Warn posts and flashes it.
  const db = getDatabaseClient();
  const budget = await checkProjectBudget(db, client, {
    companyId,
    source: "purchase",
    charges: [
      {
        projectId: validation.data.projectId,
        projectElementId: validation.data.projectElementId,
        amount: validation.data.amount
      }
    ]
  });
  if (budget.status === "block") {
    return data({ success: false, error: { message: budget.message } });
  }
  const budgetNote = budget.status === "warn" ? `. ${budget.message}` : "";

  const postingError = await addProjectExpense(db, {
    ...validation.data,
    companyId,
    userId
  });
  if (postingError) {
    return data({ success: false, error: { message: postingError } });
  }

  return data(
    { success: true, error: null },
    await flash(request, success(`Cost charged${budgetNote}`))
  );
}
