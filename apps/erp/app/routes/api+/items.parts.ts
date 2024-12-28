import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getPartsList } from "~/modules/items";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const parts = await getPartsList(client, companyId);
  if (parts.error) {
    return json(
      parts,
      await flash(request, error(parts.error, "Failed to get parts"))
    );
  }

  return json(parts);
}
