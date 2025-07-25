import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getMaterialFinishList } from "~/modules/items";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  if (!params.substanceId) {
    return json({ error: "Substance ID is required" }, { status: 400 });
  }

  return json(
    await getMaterialFinishList(client, params.substanceId, companyId)
  );
}
