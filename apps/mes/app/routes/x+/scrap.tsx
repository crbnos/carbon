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
import { reportScrap } from "~/services/commands.quantities.server";
import { scrapQuantityValidator } from "~/services/models";

/**
 * Record scrap. The work is in the `reportScrap` command
 * (`~/services/commands.quantities.server`), which `/api/v1` calls too — and
 * which stays ONE transactional `issue` `jobOperationScrap` invoke.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, sessionUserId } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const validation = await validator(scrapQuantityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const scrapped = await reportScrap(
    { companyId, userId, sessionUserId, source: "mes" },
    validation.data
  );

  if (!scrapped.ok) {
    return data({}, await flash(request, scrapped.failure.details as Result));
  }

  // The client (useOperation / AssemblyView) advances to the spawned
  // replacement serial the same way the complete flow does.
  return data(
    scrapped.data,
    await flash(request, success("Scrap quantity recorded successfully"))
  );
}
