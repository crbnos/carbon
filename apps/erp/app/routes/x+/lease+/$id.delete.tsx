// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteLease } from "~/modules/purchasing/purchasing.service";
import { path } from "~/utils/path";

/** Deletes a Draft lease. An activated lease has a journal and a schedule:
 *  `deleteLease` refuses it, and it is cancelled or terminated instead. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await deleteLease(client, id, companyId);
  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to delete lease", {
          leaseId: id
        })
      )
    );
  }

  throw redirect(
    path.to.leases,
    await flash(request, success("Deleted lease"))
  );
}
