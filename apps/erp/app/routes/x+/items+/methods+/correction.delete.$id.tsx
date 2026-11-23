// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteMethodCorrection,
  methodCorrectionEditRefusal
} from "~/modules/items/items.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const correction = await client
    .from("methodCorrection")
    .select("makeMethodId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (correction.error || !correction.data) {
    return data(
      { success: false },
      await flash(request, error(correction.error, "Correction not found"))
    );
  }

  const refusal = await methodCorrectionEditRefusal(
    client,
    correction.data.makeMethodId,
    companyId
  );
  if (refusal) {
    return data({ success: false }, await flash(request, error(null, refusal)));
  }

  const deleted = await deleteMethodCorrection(client, id, companyId);
  if (deleted.error) {
    return data(
      { success: false },
      await flash(request, error(deleted.error, "Failed to delete correction"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Correction deleted"))
  );
}
