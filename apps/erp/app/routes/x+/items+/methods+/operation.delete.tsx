// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { checkRevisionLock } from "~/modules/items/items.server";

// Deletes one or more operations of ONE make method: the form carries an `id`
// per operation, so the bill of process's "Delete Selected" is a single request.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const formData = await request.formData();
  const ids = formData.getAll("id").map(String).filter(Boolean);

  if (ids.length === 0) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  const operations = await client
    .from("methodOperation")
    .select("makeMethodId")
    .in("id", ids)
    .eq("companyId", companyId);
  const makeMethodIds = new Set(
    (operations.data ?? []).map((o) => o.makeMethodId)
  );
  if (operations.error || makeMethodIds.size !== 1) {
    return data(
      {
        success: false,
        error:
          operations.error?.message ??
          "Operations must belong to one bill of process"
      },
      {
        status: 400
      }
    );
  }
  const [makeMethodId] = makeMethodIds;

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "makeMethod",
    id: makeMethodId,
    companyId
  });
  if (!lock.ok) {
    return data(
      { success: false, error: lock.message },
      {
        status: 400
      }
    );
  }

  const { error } = await client
    .from("methodOperation")
    .delete()
    .in("id", ids)
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
    );
  }

  if (lock.warn) {
    return data({ success: true }, await flash(request, success(lock.message)));
  }

  return { success: true };
}
