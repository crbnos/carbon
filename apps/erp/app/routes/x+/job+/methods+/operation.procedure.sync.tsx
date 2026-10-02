// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { ServerFnContext } from "@carbon/server-functions";
import { getMethod } from "@carbon/server-functions/get-method";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { procedureSyncValidator } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

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

  const sync = await getMethod(
    ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
    {
      type: "procedureToOperation",
      sourceId: validation.data.procedureId,
      targetId: validation.data.operationId
    }
  );

  if (sync.error) {
    return data(
      { success: false },
      await flash(request, error(sync.error, "Failed to sync procedure"))
    );
  }

  return { success: true };
}
