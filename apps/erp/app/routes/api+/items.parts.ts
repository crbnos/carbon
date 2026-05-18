import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getPartsList } from "~/modules/items";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const parts = await getPartsList();
  if (parts.error) {
    return data(
      parts,
      await flash(request, error(parts.error, "Failed to get parts"))
    );
  }

  return parts;
}
