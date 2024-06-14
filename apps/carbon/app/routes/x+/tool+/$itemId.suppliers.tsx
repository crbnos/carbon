import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ItemSuppliers, getItemSuppliers } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [suppliers] = await Promise.all([
    getItemSuppliers(client, itemId, companyId),
  ]);

  if (suppliers.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(
        request,
        error(suppliers.error, "Failed to load tool suppliers")
      )
    );
  }

  return json({
    suppliers: suppliers.data ?? [],
  });
}

export default function ToolSuppliersRoute() {
  const { suppliers } = useLoaderData<typeof loader>();

  return <ItemSuppliers suppliers={suppliers} />;
}
