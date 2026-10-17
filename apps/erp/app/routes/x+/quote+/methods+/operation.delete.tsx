// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recalculateQuoteLinePrices } from "~/modules/sales";

// Deletes one or more operations of ONE quote line: the form carries an `id`
// per operation, so the bill of process's "Delete Selected" is a single request and
// the line's prices are recalculated once.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "sales"
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

  // Fetch the operations' quoteId/quoteLineId before deleting
  const ops = await client
    .from("quoteOperation")
    .select("quoteId, quoteLineId")
    .in("id", ids)
    .eq("companyId", companyId);

  const lines = new Map(
    (ops.data ?? []).map((op) => [op.quoteLineId, op.quoteId])
  );
  if (ops.error || lines.size !== 1) {
    return data(
      {
        success: false,
        error:
          ops.error?.message ?? "Operations must belong to one bill of process"
      },
      {
        status: 400
      }
    );
  }
  const [[quoteLineId, quoteId]] = lines;

  const { error } = await client
    .from("quoteOperation")
    .delete()
    .in("id", ids)
    .eq("quoteLineId", quoteLineId)
    .eq("companyId", companyId);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
    );
  }

  const serviceRole = getCarbonServiceRole();
  await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    quoteLineId,
    userId
  );

  return { success: true };
}
