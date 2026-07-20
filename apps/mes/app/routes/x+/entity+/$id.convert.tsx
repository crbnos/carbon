import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { convertEntityValidator } from "~/services/models";

const log = getLogger("mes");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const newRevision = formData.get("newRevision");
  const quantity = formData.get("quantity");

  const validation = convertEntityValidator.safeParse({
    trackedEntityId: id,
    newRevision,
    quantity
  });

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const {
    trackedEntityId,
    newRevision: revision,
    quantity: newQuantity
  } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const convert = await serviceRole.functions.invoke("issue", {
    body: {
      type: "convertEntity",
      trackedEntityId,
      newRevision: revision,
      quantity: newQuantity,
      companyId,
      userId
    }
  });

  if (convert.error) {
    log.error("Failed to convert entity", { error: convert.error });
    return data(
      { success: false, message: "Failed to convert entity" },
      { status: 400 }
    );
  }

  const converted = convert.data as {
    success: boolean;
    message: string;
    convertedEntity?: {
      trackedEntityId: string;
      readableId: string;
      quantity: number;
    };
  };

  return {
    success: true,
    message: "Entity converted successfully",
    convertedEntity: converted.convertedEntity
  };
}
