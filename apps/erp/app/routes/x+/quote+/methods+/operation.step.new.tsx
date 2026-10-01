// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertQuoteOperationStep } from "~/modules/sales";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertQuoteOperationStep(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert quote operation step")
      )
    );
  }

  const quoteOperationStepId = insert.data?.id;
  if (!quoteOperationStepId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert quote operation step")
      )
    );
  }

  return { id: quoteOperationStepId };
}
