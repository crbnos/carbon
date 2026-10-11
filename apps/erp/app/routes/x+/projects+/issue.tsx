// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useNavigate } from "react-router";
import { projectIssueValidator } from "~/modules/projects";
import {
  checkProjectBudget,
  postProjectIssue
} from "~/modules/projects/projects.server";
import { IssueMaterialModal } from "~/modules/projects/ui/Element/IssueMaterialModal";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Issue to Project`,
  to: path.to.projectIssue
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { update: ["inventory", "projects"] });
  return null;
}

/**
 * Issues stock to a project, or returns it, through `post-project-issue`.
 * A refusal (a closed element, too little stock) is returned as fetcher
 * data, so the modal shows it and stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: ["inventory", "projects"]
  });

  const validation = await validator(projectIssueValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  // Budget control (Government Contracting 5c, C4). An Issue charges the
  // item's unit cost to the element; a Return is never checked. Block keeps
  // the modal open with the overrun; Warn posts and flashes it.
  let budgetNote = "";
  if (validation.data.direction === "Issue") {
    const db = getDatabaseClient();
    const cost = await db
      .selectFrom("itemCost")
      .select("unitCost")
      .where("itemId", "=", validation.data.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    const budget = await checkProjectBudget(db, client, {
      companyId,
      source: "issue",
      charges: [
        {
          projectId: validation.data.projectId,
          projectElementId: validation.data.projectElementId ?? null,
          amount: validation.data.quantity * Number(cost?.unitCost ?? 0)
        }
      ]
    });
    if (budget.status === "block") {
      return data({ success: false, error: { message: budget.message } });
    }
    if (budget.status === "warn") budgetNote = `. ${budget.message}`;
  }

  const postingError = await postProjectIssue({
    ...validation.data,
    companyId,
    userId
  });
  if (postingError) {
    return data({ success: false, error: { message: postingError } });
  }

  return data(
    { success: true, error: null },
    await flash(
      request,
      success(
        validation.data.direction === "Issue"
          ? `Material issued${budgetNote}`
          : "Material returned"
      )
    )
  );
}

/** Inventory → Issue to Project: the modal with a charge number picker. */
export default function IssueToProjectRoute() {
  const navigate = useNavigate();
  return <IssueMaterialModal onClose={() => navigate(path.to.inventory)} />;
}
