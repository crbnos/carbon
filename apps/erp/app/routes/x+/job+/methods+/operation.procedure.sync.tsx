// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { procedureSyncValidator } from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const validation = await validator(procedureSyncValidator).validate(formData);

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Invalid form data"))
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const sync = await serviceRole.functions.invoke("get-method", {
    body: {
      type: "procedureToOperation",
      sourceId: validation.data.procedureId,
      targetId: validation.data.operationId,
      companyId,
      userId
    }
  });

  if (sync.error) {
    return data(
      { success: false },
      await flash(request, error(sync.error, "Failed to sync procedure"))
    );
  }

  return { success: true };
}
