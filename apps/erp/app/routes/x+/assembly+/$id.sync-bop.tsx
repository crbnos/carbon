import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  isJobLocked,
  syncAssemblyInstructionToOperation,
  syncAssemblyToBopValidator
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

// Syncs a Published assembly instruction's steps onto a live job operation.
// The part's Bill of Process only stores the instruction pointer — job
// operations inherit the steps at get-method time and re-sync here on demand.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(syncAssemblyToBopValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }
  const { operationId } = validation.data;

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const operation = await client
    .from("jobOperation")
    .select("id, job(status)")
    .eq("id", operationId)
    .single();
  if (operation.error) {
    return data(
      { success: false },
      await flash(request, error(operation.error, "Operation not found"))
    );
  }
  const status = (operation.data.job as { status: string } | null)?.status;
  if (isJobLocked(status)) {
    return data(
      { success: false },
      await flash(
        request,
        error(null, "This job is locked — steps can't be synced to it")
      )
    );
  }

  try {
    const summary = await syncAssemblyInstructionToOperation(
      getDatabaseClient(),
      {
        assemblyInstructionId: id,
        operationId,
        companyId,
        userId
      }
    );
    const unmatched =
      summary.partsUnmatched > 0
        ? ` — ${summary.partsUnmatched} part link(s) had no matching BOM line on the operation`
        : "";
    return data(
      { success: true },
      await flash(
        request,
        success(
          `Synced ${summary.created + summary.updated} steps to the BOP (${summary.created} new, ${summary.updated} updated, ${summary.deleted} removed, ${summary.slidesSynced} slides, ${summary.toolsLinked} tool links)${unmatched}`
        )
      )
    );
  } catch (err) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to sync assembly to BOP"
        )
      )
    );
  }
}
