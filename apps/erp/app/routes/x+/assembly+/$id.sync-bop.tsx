import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  isJobLocked,
  syncAssemblyInstructionToOperation,
  syncAssemblyToBopValidator
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

// Targets the sync modal can offer for this instruction's item: the active make
// method's operations (steps flow to future jobs via get-method) and recent
// unlocked jobs' operations (steps land on the live job directly).
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const instruction = await client
    .from("assemblyInstruction")
    .select("id, itemId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (instruction.error || !instruction.data.itemId) {
    return { methodOperations: [], jobs: [] };
  }
  const itemId = instruction.data.itemId;

  const makeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("rn", { ascending: true })
    .limit(1)
    .maybeSingle();

  const [methodOperations, jobs] = await Promise.all([
    makeMethod.data?.id
      ? client
          .from("methodOperation")
          .select("id, description, operationKind")
          .eq("makeMethodId", makeMethod.data.id)
          .order("order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("job")
      .select("id, jobId, status")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(20)
  ]);

  const openJobs = (jobs.data ?? []).filter((job) => !isJobLocked(job.status));

  const jobOperations =
    openJobs.length > 0
      ? await client
          .from("jobOperation")
          .select("id, description, operationKind, jobId")
          .in(
            "jobId",
            openJobs.map((job) => job.id)
          )
          .order("order", { ascending: true })
      : { data: [], error: null };

  return {
    methodOperations: methodOperations.data ?? [],
    jobs: openJobs.map((job) => ({
      id: job.id,
      jobId: job.jobId,
      operations: (jobOperations.data ?? []).filter(
        (operation) => operation.jobId === job.id
      )
    }))
  };
}

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
  const { targetKind, operationId } = validation.data;

  // Method steps are parts-module authoring; job steps are production-module
  // authoring — gate on the permission matching what actually gets written.
  const { client, companyId, userId } = await requirePermissions(
    request,
    targetKind === "method" ? { update: "parts" } : { update: "production" }
  );

  if (targetKind === "method") {
    const operation = await client
      .from("methodOperation")
      .select("id, makeMethod(status)")
      .eq("id", operationId)
      .single();
    if (operation.error) {
      return data(
        { success: false },
        await flash(request, error(operation.error, "Operation not found"))
      );
    }
    const status = (operation.data.makeMethod as { status: string } | null)
      ?.status;
    if (status !== "Draft") {
      return data(
        { success: false },
        await flash(
          request,
          error(
            null,
            "Steps can only be synced to a Draft method — create a new method version first"
          )
        )
      );
    }
  } else {
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
  }

  try {
    const summary = await syncAssemblyInstructionToOperation(
      getDatabaseClient(),
      {
        assemblyInstructionId: id,
        target: { kind: targetKind, operationId },
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
          `Synced ${summary.created + summary.updated} steps to the BOP (${summary.created} new, ${summary.updated} updated, ${summary.deleted} removed)${unmatched}`
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
