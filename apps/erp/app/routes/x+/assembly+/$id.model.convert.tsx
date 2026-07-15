import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getAssemblyModelState } from "~/modules/production";
import { isAssemblerServiceHealthy } from "~/modules/production/production.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const instruction = await client
    .from("assemblyInstruction")
    .select(
      "modelUploadId, modelUpload(id, processingStatus, glbPath, graphPath, modelPath)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (instruction.error || !instruction.data.modelUpload) {
    return data(
      { success: false },
      await flash(
        request,
        error(instruction.error, "Could not find the instruction's model")
      )
    );
  }

  const modelState = getAssemblyModelState(instruction.data.modelUpload);

  // Only kick a conversion for unconverted or failed models — "processing"
  // means a job is already in flight, "converted" needs nothing.
  if (modelState !== "convertible" && modelState !== "failed") {
    return data(
      { success: false },
      await flash(
        request,
        error(
          null,
          modelState === "processing"
            ? "Model conversion is already in progress"
            : modelState === "converted"
              ? "The model is already converted"
              : "This model cannot be converted (only STEP files are supported)"
        )
      )
    );
  }

  if (!(await isAssemblerServiceHealthy())) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          null,
          "The geometry service is unavailable — model conversion can't run right now."
        )
      )
    );
  }

  await trigger("assembly-convert", {
    companyId,
    modelUploadId: instruction.data.modelUpload.id,
    userId
  });

  return data(
    { success: true },
    await flash(request, success("Model conversion started"))
  );
}
