// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useNavigate
} from "react-router";
import { projectIssueValidator } from "~/modules/projects/projects.models";
import { IssueMaterialModal } from "~/modules/projects/ui/Element/IssueMaterialModal";
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
 * Issues stock to a project, or returns it (`postProjectIssue`). A refusal
 * (a closed element, too little stock, a budget block) is returned as
 * fetcher data, so the modal shows it and stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(projectIssueValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.postProjectIssue(validation.data);
  if (result.error) {
    return data({ success: false, error: { message: result.error.message } });
  }

  // Budget control (Government Contracting 5c, C4): Warn posts and flashes
  // the overrun.
  const { budgetWarning } = result.data;
  const budgetNote = budgetWarning ? `. ${budgetWarning}` : "";
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
