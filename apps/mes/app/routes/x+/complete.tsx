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
import { reportQuantity } from "~/services/commands.quantities.server";
import { nonScrapQuantityValidator } from "~/services/models";
import { path } from "~/utils/path";

/**
 * Report good parts. The work is in the `reportQuantity` command
 * (`~/services/commands.quantities.server`), which `/api/v1` calls too —
 * including the auto-print that is wrapped in a try/catch so it can never
 * block the completion.
 *
 * The command reports WHICH branch ran, which is what keeps the four distinct
 * responses below:
 *   - finished → back to the operations list with the finish flash;
 *   - Serial, not finished → `{ completed: true }`, so the client (useOperation
 *     / AssemblyView) stays the single unit-advancement authority and nothing
 *     races it; the marker is how AssemblyView tells a success from a failure
 *     (which returns an empty `{}`);
 *   - Batch, not finished → a plain redirect back to the operation;
 *   - untracked, not finished → the inserted `productionQuantity` rows.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, sessionUserId } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const reported = await reportQuantity(
    client,
    { companyId, userId, sessionUserId, source: "mes" },
    validation.data
  );

  if (!reported.ok) {
    return data({}, await flash(request, reported.failure.details as Result));
  }

  if (reported.data.finished) {
    return redirect(
      path.to.operations,
      await flash(request, {
        ...success("Operation finished successfully"),
        flash: "success"
      })
    );
  }

  if (reported.data.tracking === "Serial") {
    return data(
      { completed: true },
      await flash(request, {
        ...success("Completed"),
        flash: "success"
      })
    );
  }

  if (reported.data.tracking === "Batch") {
    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  }

  return data(
    reported.data.productionQuantities,
    await flash(request, {
      ...success("Successfully completed part"),
      flash: "success"
    })
  );
}
