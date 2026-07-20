import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { isIssueLocked } from "~/modules/quality";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

const logger = getLogger("erp", "update");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
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

  // Per-ID locked check
  const issues = await client
    .from("nonConformance")
    .select("id, status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (issues.data ?? []).map((i) => i.status),
    checkFn: isIssueLocked,
    message: "Cannot modify a closed issue. Reopen it first."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "requiredActionIds":
    case "approvalRequirements":
      const arrayValue = value ? value.split(",") : [];
      const update = await client
        .from("nonConformance")
        .update({
          [field]: arrayValue,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

      if (update.error) {
        logger.error(update.error);
        return {
          error: { message: "Failed to update issue" },
          data: null
        };
      }

      const serviceRole = await getCarbonServiceRole();
      await Promise.all(
        ids.map(async (id) => {
          await serviceRole.functions.invoke("create", {
            body: {
              type: "nonConformanceTasks",
              id,
              companyId,
              userId
            }
          });
        })
      );

      return { data: update.data };
    case "source":
    case "priority":
    case "name":
    case "description":
    case "locationId":
    case "nonConformanceTypeId":
    case "openDate":
    case "dueDate":
    case "closeDate":
    case "quantity":
    case "itemId":
    case "supplierId":
      return await client
        .from("nonConformance")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }
}
