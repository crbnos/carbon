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
import { postProjectIssue } from "~/modules/projects/projects.server";
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
 * Issues stock to a project, or returns it, through `post-project-issue`.
 * A refusal (a closed element, too little stock) is returned as fetcher
 * data, so the modal shows it and stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: ["inventory", "projects"]
  });

  const validation = await validator(projectIssueValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

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
          ? "Material issued"
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
