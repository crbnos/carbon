import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { scrapTrackedEntityValidator } from "~/services/models";
import { getTrackedEntity } from "~/services/operations.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { trackedEntityId, materialId } = params;
  if (!materialId) throw new Error("Could not find materialId");
  if (!trackedEntityId) throw new Error("Could not find trackedEntityId");

  // Get optional parentId from query params
  const url = new URL(request.url);
  const parentTrackedEntityId = url.searchParams.get("parentId") || undefined;

  const formData = await request.formData();
  const validation = await validator(scrapTrackedEntityValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const trackedEntity = await getTrackedEntity(client, trackedEntityId);
  if (trackedEntity.error) {
    return data(
      { success: false, message: "Failed to get tracked entity" },
      { status: 400 }
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      trackedEntityId,
      materialId,
      parentTrackedEntityId,
      type: "scrapTrackedEntity",
      scrapReasonId: validation.data.scrapReasonId,
      makeReplacement: validation.data.makeReplacement,
      companyId,
      userId
    }
  });

  if (issue.error) {
    return data(
      { success: false, message: "Failed to scrap entity" },
      { status: 400 }
    );
  }

  return { success: true, message: "Entity scrapped successfully" };
}
