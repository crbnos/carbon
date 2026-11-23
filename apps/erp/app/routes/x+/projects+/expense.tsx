// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { projectExpenseValidator } from "~/modules/projects/projects.models";

/**
 * Charges a cost to an element from its page (the Charge button of a cost
 * card, or Charge cost on the Actual tab), posted at once
 * (`createProjectExpense`). A refusal (a closed element, a budget block) is
 * returned as fetcher data, so the modal shows it and stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(projectExpenseValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.createProjectExpense(validation.data);
  if (result.error) {
    return data({ success: false, error: { message: result.error.message } });
  }

  // Budget control (Government Contracting 5c): Warn posts and flashes the
  // overrun.
  const { budgetWarning } = result.data;
  const budgetNote = budgetWarning ? `. ${budgetWarning}` : "";
  return data(
    { success: true, error: null },
    await flash(request, success(`Cost charged${budgetNote}`))
  );
}
