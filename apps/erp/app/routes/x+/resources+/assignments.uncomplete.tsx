// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteTrainingCompletion } from "~/modules/resources";
import { path } from "~/utils/path";

const logger = getLogger("erp", "training-assignment-uncomplete");

// Removes a wrong completion. The employee keeps any ability the completion
// granted: the grant trigger only adds abilities, and the person may hold the
// ability for another reason.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  const formData = await request.formData();
  const completionId = Number(formData.get("completionId"));

  if (!Number.isInteger(completionId) || completionId <= 0) {
    return data(
      { error: "Missing completion" },
      {
        status: 400,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(request, error(null, "Missing completion"))
      }
    );
  }

  const result = await deleteTrainingCompletion(
    client,
    completionId,
    companyId
  );

  if (result.error) {
    logger.error("Failed to remove training completion", {
      companyId,
      completionId,
      error: result.error
    });
    return data(
      { error: result.error.message },
      {
        status: 500,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(
          request,
          error(result.error, "Failed to remove the completion")
        )
      }
    );
  }

  // The certificate holds employee data; nothing points at it any more.
  const certificatePaths = (result.data ?? [])
    .map((row) => row.certificatePath)
    .filter((path): path is string => !!path);
  if (certificatePaths.length > 0) {
    const removed = await storage(client)
      .company(companyId)
      .remove(certificatePaths);
    if (removed.error) {
      logger.error("Failed to remove training certificate", {
        companyId,
        completionId,
        error: removed.error
      });
    }
  }

  return data(
    { success: true },
    {
      // @ts-expect-error TS2322 - TODO: fix type
      headers: await flash(request, success("Completion removed"))
    }
  );
}

export async function loader() {
  return redirect(path.to.trainingAssignments);
}
