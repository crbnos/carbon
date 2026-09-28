import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { upsertInspectionSample } from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionSampleValidator } from "~/services/models";

const logger = getLogger("mes", "inspection-lot-sample");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  // Quiet saves come from the measurement matrix's "Overall result" cells via
  // a raw fetch (no revalidation), so a flash cookie would surface as a stray
  // toast on the next navigation — suppress it and just return the sample id.
  const quiet = formData.get("quiet") === "true";
  const validation = await validator(inspectionSampleValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const db = getDatabaseClient();

  // The sample write runs as the superuser and links the tracked entity, so
  // the entity must belong to this company.
  const { trackedEntityId } = validation.data;
  if (trackedEntityId) {
    const entity = await db
      .selectFrom("trackedEntity")
      .select("id")
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!entity) {
      logger.warn("Tracked entity not found for company", {
        companyId,
        inspectionId: id,
        trackedEntityId
      });
      return data(
        { error: { message: "Tracked entity not found" } },
        await flash(request, error(null, "Tracked entity not found"))
      );
    }
  }

  const result = await upsertInspectionSample(db, {
    ...validation.data,
    companyId,
    inspectedBy: userId
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, "Failed to save sample"))
    );
  }

  if (quiet) {
    return data({ success: true, sampleId: result.data.id });
  }

  return data(
    { success: true, sampleId: result.data.id },
    await flash(request, success("Sample recorded"))
  );
}
