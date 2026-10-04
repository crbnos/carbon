// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteGauge } from "~/modules/quality";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteGauge(client, id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(
          mutation.error,
          // A gauge recorded on a closed inspection is kept for traceability.
          mutation.error.code === "23503"
            ? "Gauge is used elsewhere. Set it to Inactive instead."
            : "Failed to delete gauge"
        )
      )
    );
  }

  throw redirect(
    path.to.gauges,
    await flash(request, success("Successfully deleted gauge"))
  );
}
