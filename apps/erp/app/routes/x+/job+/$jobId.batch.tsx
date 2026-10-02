// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateJobBatchNumber } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "production",
    bypassRls: true
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  const formData = await request.formData();
  const trackedEntityId = String(formData.get("id"));
  const rawValue = formData.get("value");
  const value = rawValue == null ? "" : String(rawValue).trim();

  // `client` is the service role (bypassRls) and the tracked entity id comes
  // from the form: scope the write to this company.
  const update = await updateJobBatchNumber(
    client,
    companyId,
    trackedEntityId,
    value === "" ? null : value
  );

  if (update.error) {
    return data(
      update,
      await flash(request, error(update.error, update.error.message))
    );
  }

  return update;
}
