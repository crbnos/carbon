// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { reportRework } from "~/services/commands.quantities.server";
import { nonScrapQuantityValidator } from "~/services/models";

/**
 * Record rework. The work is in the `reportRework` command
 * (`~/services/commands.quantities.server`), which `/api/v1` calls too.
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

  const reworked = await reportRework(
    client,
    { companyId, userId, sessionUserId, source: "mes" },
    validation.data
  );

  if (!reworked.ok) {
    return data({}, await flash(request, reworked.failure.details as Result));
  }

  return data(
    reworked.data,
    await flash(request, success("Rework quantity recorded successfully"))
  );
}
