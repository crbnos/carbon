import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { invalidateAssemblyModelCache } from "~/modules/production";

/**
 * Explicit cache invalidation for the instruction's model: drops the cached
 * motion plans and the conversion artifacts (glb/graph), then kicks a fresh
 * conversion. The escape hatch for stale caches — e.g. after a geometry
 * service upgrade whose output no longer matches previously stored artifacts.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const instruction = await client
    .from("assemblyInstruction")
    .select("modelUploadId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (instruction.error || !instruction.data.modelUploadId) {
    return data(
      { success: false },
      await flash(
        request,
        error(instruction.error, "This instruction has no model")
      )
    );
  }
  const modelUploadId = instruction.data.modelUploadId;

  const invalidated = await invalidateAssemblyModelCache(client, modelUploadId);
  if (invalidated.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(invalidated.error, "Could not invalidate the model cache")
      )
    );
  }

  await trigger("assembly-convert", { companyId, modelUploadId, userId });

  return data(
    { success: true },
    await flash(
      request,
      success("Model cache invalidated; re-converting from the source file")
    )
  );
}
