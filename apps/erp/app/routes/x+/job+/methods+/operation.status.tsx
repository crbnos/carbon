import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import type { JobOperation } from "~/modules/production";
import {
  returnPickedRemaindersForOperation,
  updateJobOperationStatus
} from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const status = formData.get("status") as JobOperation["status"];

  const update = await updateJobOperationStatus(client, id, status, userId);
  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update status"))
    );
  }

  if (status === "Done") {
    // Marking an operation Done may have completed the job via the SQL
    // interceptor. Return any picked-but-unconsumed material staged at
    // lineside; service role so the sweep can read picking lines regardless of
    // the caller's inventory permissions. Idempotent — a failure here doesn't
    // undo the status change, so surface it as a flash only.
    const sweep = await returnPickedRemaindersForOperation(
      getCarbonServiceRole(),
      { jobOperationId: id, userId, companyId }
    );
    if (sweep?.error) {
      return data(
        {},
        await flash(
          request,
          error(
            sweep.error,
            "Operation updated, but returning picked material failed"
          )
        )
      );
    }
  }

  return {};
}
