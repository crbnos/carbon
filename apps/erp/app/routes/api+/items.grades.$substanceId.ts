import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getMaterialGradeList } from "~/modules/items/items.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  if (!params.substanceId) {
    return data({ error: "Substance ID is required" }, { status: 400 });
  }

  return await getMaterialGradeList(params.substanceId);
}
