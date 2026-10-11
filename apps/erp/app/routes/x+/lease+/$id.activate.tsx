// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getLease } from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lease = await getLease(client, id, companyId);
  if (lease.error || lease.data?.companyId !== companyId) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Lease not found"))
    );
  }

  if (lease.data.status !== "Draft") {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(request, error(null, "Only a Draft lease can be activated"))
    );
  }

  // Classifies, measures, posts the commencement journal and writes the
  // monthly schedule — one transaction in the server function.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-lease", { type: "activate", leaseId: id });

  if (result.error) {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to activate lease")
        )
      )
    );
  }

  throw redirect(
    path.to.leaseDetails(id),
    await flash(request, success("Lease activated"))
  );
}
