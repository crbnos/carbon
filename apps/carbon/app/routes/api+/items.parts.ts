import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getPartsList } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

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
