// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteLease, getLease } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lease = await getLease(client, id, companyId);
  if (lease.error || lease.data?.companyId !== companyId) {
    return data(
      {},
      await flash(request, error(lease.error, "Lease not found"))
    );
  }

  // An activated lease has a journal and a schedule; it is cancelled or
  // terminated instead.
  if (lease.data.status !== "Draft") {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          "Only a Draft lease can be deleted. Cancel or terminate it instead."
        )
      )
    );
  }

  const result = await deleteLease(client, id, companyId);
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to delete lease"))
    );
  }

  throw redirect(
    path.to.leases,
    await flash(request, success("Deleted lease"))
  );
}
