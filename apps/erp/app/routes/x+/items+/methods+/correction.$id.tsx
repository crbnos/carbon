// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { methodCorrectionValidator } from "~/modules/items/items.models";
import {
  methodCorrectionEditRefusal,
  upsertMethodCorrection
} from "~/modules/items/items.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(methodCorrectionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...correction } = validation.data;

  // The lock is the correction's own make method's, never the one in the
  // form: a correction on a released method must not be editable by naming a
  // draft one.
  const existing = await client
    .from("methodCorrection")
    .select("makeMethodId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    return data(
      { id: null },
      await flash(request, error(existing.error, "Correction not found"))
    );
  }
  if (existing.data.makeMethodId !== correction.makeMethodId) {
    return validationError({
      fieldErrors: { name: "The correction is not on this make method" }
    });
  }

  const refusal = await methodCorrectionEditRefusal(
    client,
    existing.data.makeMethodId,
    companyId
  );
  if (refusal) {
    return validationError({ fieldErrors: { name: refusal } });
  }

  const updated = await upsertMethodCorrection(client, {
    ...correction,
    id,
    companyId,
    updatedBy: userId
  });
  if (updated.error) {
    return data(
      { id: null },
      await flash(request, error(updated.error, "Failed to update correction"))
    );
  }

  return data({ id }, await flash(request, success("Correction updated")));
}
