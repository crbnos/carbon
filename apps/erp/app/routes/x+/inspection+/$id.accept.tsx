// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import invariant from "tiny-invariant";
import { dispositionInspection } from "~/modules/quality/quality.server";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const result = await dispositionInspection({
    id,
    decision: "Accept",
    companyId,
    dispositionedBy: userId,
    // ERP verdict carries no production posting — Receipt lots only. Job Operation
    // lots are dispositioned (with their physical outcome) by the MES route.
    requireSource: "Receipt"
  });

  if (result.error) {
    throw redirect(
      path.to.inspection(id),
      await flash(request, error(result.error, "Failed to accept lot"))
    );
  }

  throw redirect(
    `${path.to.inspections}?${getParams(request)}`,
    await flash(request, success("Lot accepted"))
  );
}
