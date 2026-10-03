// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { finishOperation } from "~/services/commands.quantities.server";
import { finishValidator } from "~/services/models";
import { path } from "~/utils/path";

/**
 * Finish an operation. The work is in the `finishOperation` command
 * (`~/services/commands.quantities.server`), which `/api/v1` calls too.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, sessionUserId, companyId } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const validation = await validator(finishValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const finished = await finishOperation(
    { companyId, userId, sessionUserId, source: "mes" },
    validation.data
  );

  if (!finished.ok) {
    return data({}, await flash(request, finished.failure.details as Result));
  }

  throw redirect(
    path.to.operations,
    await flash(request, success("Operation finished successfully"))
  );
}
