import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getMaterialTypeList } from "~/modules/items";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  if (!params.substanceId || !params.formId) {
    return json(
      { error: "Substance ID and Form ID are required" },
      { status: 400 }
    );
  }

  return json(
    await getMaterialTypeList(
      client,
      params.substanceId,
      params.formId,
      companyId
    )
  );
}
