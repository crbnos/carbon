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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const validation = await validator(methodCorrectionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...correction } = validation.data;

  const refusal = await methodCorrectionEditRefusal(
    client,
    correction.makeMethodId,
    companyId
  );
  if (refusal) {
    return validationError({ fieldErrors: { name: refusal } });
  }

  const created = await upsertMethodCorrection(client, {
    ...correction,
    companyId,
    createdBy: userId
  });
  if (created.error) {
    return data(
      { id: null },
      await flash(request, error(created.error, "Failed to create correction"))
    );
  }

  return data(
    { id: created.data.id },
    await flash(request, success("Correction created"))
  );
}
