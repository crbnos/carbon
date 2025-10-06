import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { convertEntityValidator } from "~/services/models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const newRevision = formData.get("newRevision");

  const validation = convertEntityValidator.safeParse({
    trackedEntityId: id,
    newRevision,
  });

  if (!validation.success) {
    return json(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { trackedEntityId, newRevision: revision } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const convert = await serviceRole.functions.invoke("issue", {
    body: {
      type: "convertEntity",
      trackedEntityId,
      newRevision: revision,
      companyId,
      userId,
    },
    region: FunctionRegion.UsEast1,
  });

  if (convert.error) {
    console.error(convert.error);
    return json(
      { success: false, message: "Failed to convert entity" },
      { status: 400 }
    );
  }

  console.log(convert.data);

  const data = convert.data as {
    success: boolean;
    message: string;
    convertedEntity?: {
      trackedEntityId: string;
      readableId: string;
      quantity: number;
    };
  };

  return json({
    success: true,
    message: "Entity converted successfully",
    convertedEntity: data.convertedEntity,
  });
}
