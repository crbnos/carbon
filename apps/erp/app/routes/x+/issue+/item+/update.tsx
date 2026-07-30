import { requirePermissions } from "@carbon/auth/auth.server";
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
    .select("nonConformance(status)")
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
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }
}
