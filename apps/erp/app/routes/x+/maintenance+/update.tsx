import { requirePermissions } from "@carbon/auth/auth.server";
import { type ActionFunctionArgs } from "react-router";
import { upsertMaintenanceDispatch } from "~/modules/resources";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const updateData: Record<string, unknown> = {
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  };

  switch (field) {
    case "priority":
    case "severity":
    case "source":
    case "status":
    case "oeeImpact":
    case "suspectedFailureModeId":
    case "actualFailureModeId":
    case "workCenterId":
      updateData[field] = value || null;
      break;
    case "plannedStartTime":
    case "plannedEndTime":
    case "actualStartTime":
    case "actualEndTime":
      updateData[field] = value ? new Date(value).toISOString() : null;
      break;
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }

  // Handle special status updates with timestamps
  if (field === "status") {
    if (value === "In Progress") {
      updateData.actualStartTime = new Date().toISOString();
    } else if (value === "Completed") {
      updateData.actualEndTime = new Date().toISOString();
    }
  }

  // Update each maintenance dispatch individually since upsertMaintenanceDispatch expects single records
  const results = await Promise.all(
    ids.map(async (id) => {
      return await upsertMaintenanceDispatch(client, {
        id: id as string,
        ...updateData
      } as Parameters<typeof upsertMaintenanceDispatch>[1]);
    })
  );

  // Check if any updates failed
  const errors = results.filter((result) => result.error);
  if (errors.length > 0) {
    return {
      error: { message: "Failed to update maintenance dispatch(es)" },
      data: null
    };
  }

  return { data: results.map((result) => result.data) };
}
