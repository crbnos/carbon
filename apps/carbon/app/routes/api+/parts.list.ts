import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ItemReplenishmentSystem } from "~/modules/parts";
import { getPartsList } from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const replenishmentSystem = searchParams.get(
    "replenishmentSystem"
  ) as ItemReplenishmentSystem | null;

  const parts = await getPartsList(client, companyId, replenishmentSystem);
  if (parts.error) {
    return json(
      parts,
      await flash(request, error(parts.error, "Failed to get parts"))
    );
  }

  return json(parts);
}
