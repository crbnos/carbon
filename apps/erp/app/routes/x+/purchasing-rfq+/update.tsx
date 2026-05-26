import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { isRfqLocked } from "~/modules/purchasing";
import { upsertPurchasingRFQSuppliers } from "~/modules/purchasing/purchasing.service.server";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");

  if (typeof field !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // Check if any of the selected RFQs are locked
  const purchasingRfqs = await client
    .from("purchasingRfq")
    .select("id, status")
    .in("id", ids as string[]);
  const lockedError = requireUnlockedBulk({
    statuses: (purchasingRfqs.data ?? []).map((r) => r.status),
    checkFn: isRfqLocked,
    message: "Cannot modify a locked RFQ."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "employeeId":
    case "expirationDate":
    case "locationId":
    case "rfqDate": {
      const value = formData.get("value");
      if (typeof value !== "string" && value !== null) {
        return { error: { message: "Invalid form data" }, data: null };
      }
      return await client
        .from("purchasingRfq")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    }
    case "supplierIds": {
      const supplierIds = formData.getAll("value") as string[];
      // Apply to each RFQ
      for (const id of ids as string[]) {
        const result = await upsertPurchasingRFQSuppliers(
          id as string,
          supplierIds
        );
        if (result.error) {
          return result;
        }
      }
      return { data: null, error: null };
    }
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
