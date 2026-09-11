import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime, round } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { isIssueLocked } from "~/modules/quality";
import { disposition } from "~/modules/quality/quality.models";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof id !== "string") {
    return {
      error: { message: "Invalid nonConformanceItem id" },
      data: null
    };
  }

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const parent = await client
    .from("nonConformanceItem")
    .select("nonConformanceId, nonConformance(status)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  const lockedError = requireUnlockedBulk({
    statuses: [(parent.data as any)?.nonConformance?.status ?? null],
    checkFn: isIssueLocked,
    message: "Cannot modify a closed issue. Reopen it first."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "disposition":
      if (
        value === null ||
        !disposition.includes(value as (typeof disposition)[number])
      ) {
        return {
          error: { message: "Invalid disposition" },
          data: null
        };
      }
      return await client
        .from("nonConformanceItem")
        .update({
          [field]: value ? (value as (typeof disposition)[number]) : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", id);
    case "quantity": {
      const quantity = Number(value);
      if (
        value === null ||
        value.trim() === "" ||
        !Number.isFinite(quantity) ||
        quantity < 0
      ) {
        return {
          error: { message: "Quantity must be zero or more" },
          data: null
        };
      }
      const expected = formData.get("expectedQuantity");
      const expectedQuantity = Number(expected);
      if (
        typeof expected !== "string" ||
        expected.trim() === "" ||
        !Number.isFinite(expectedQuantity)
      ) {
        return {
          error: { message: "Invalid expected quantity" },
          data: null
        };
      }
      if (parent.error || !parent.data) {
        return {
          error: { message: "Issue item not found" },
          data: null
        };
      }

      // A tracked row's quantity is the sum of its linked entities — editing
      // it directly would break the closure link-sum check. An inspection-
      // originated NCR already wrote off the lot at reject, and closeIssue
      // restores row.quantity on Use As Is / Rework, so a changed quantity
      // would restore a different amount than was written off.
      const [links, inspections] = await Promise.all([
        client
          .from("nonConformanceItemTrackedEntity")
          .select("id", { count: "exact", head: true })
          .eq("nonConformanceItemId", id)
          .eq("companyId", companyId),
        client
          .from("nonConformanceInspection")
          .select("id", { count: "exact", head: true })
          .eq("nonConformanceId", parent.data.nonConformanceId)
          .eq("companyId", companyId)
      ]);
      if (links.error || inspections.error) {
        return {
          error: { message: "Failed to load issue item" },
          data: null
        };
      }
      if ((links.count ?? 0) > 0) {
        return {
          error: {
            message:
              "This row's quantity comes from its linked tracked entities. Split or move entities instead."
          },
          data: null
        };
      }
      if ((inspections.count ?? 0) > 0) {
        return {
          error: {
            message:
              "Quantity is set by the rejected inspection lot and cannot be edited."
          },
          data: null
        };
      }

      // Compare-and-set on the quantity the client last saw. An older request
      // that finishes after a newer one matches no row instead of overwriting
      // it, and so does an edit that races a tracked-entity link — every link
      // writer also changes the row quantity.
      const updated = await client
        .from("nonConformanceItem")
        .update({
          quantity: round(quantity),
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", id)
        .eq("companyId", companyId)
        .eq("quantity", expectedQuantity)
        .select("id");
      if (updated.error) {
        return { error: updated.error, data: null };
      }
      if (!updated.data || updated.data.length === 0) {
        return {
          error: {
            message:
              "This quantity changed since the page loaded. Refresh and try again."
          },
          data: null
        };
      }
      return updated;
    }
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }
}
