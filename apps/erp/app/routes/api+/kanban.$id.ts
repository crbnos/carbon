import { badRequest, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";

import { getKanban } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id);

  if (kanban.error || !kanban.data) {
    throw notFound("Kanban is not active");
  }

  if (kanban.data.companyId !== companyId) {
    throw notFound("Kanban is not active");
  }

  if (kanban.data.replenishmentSystem === "Make") {
    console.log("Make");
  } else if (kanban.data.replenishmentSystem === "Buy") {
    console.log("Buy");
  } else {
    throw badRequest(`${kanban.data.replenishmentSystem} is not supported`);
  }

  throw redirect(path.to.authenticatedRoot);
}
