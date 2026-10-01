// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { nonScrapQuantityValidator } from "~/services/models";
import { insertReworkQuantity } from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertRework = await insertReworkQuantity(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (insertRework.error) {
    return data(
      {},
      await flash(
        request,
        error(insertRework.error, "Failed to record rework quantity")
      )
    );
  }

  return data(
    insertRework.data,
    await flash(request, success("Rework quantity recorded successfully"))
  );
}
