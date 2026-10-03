// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recordStep } from "~/services/commands.steps.server";
import { stepRecordValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(stepRecordValidator).validate(formData);
  const serviceRole = await getCarbonServiceRole();

  if (validation.error) {
    return validationError(validation.error);
  }

  // `recordStep` also runs the untracked-material backflush, whose failure is
  // logged and never blocks the record — see the command.
  const result = await recordStep(
    serviceRole,
    { companyId, userId },
    validation.data
  );

  if (!result.ok) {
    return data(
      {},
      await flash(
        request,
        error(result.failure.details, result.failure.message)
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Attribute recorded successfully"))
  );
}
