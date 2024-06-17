import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getBuyMethods } from "~/modules/items";
import BuyMethods from "~/modules/items/ui/Item/BuyMethods/BuyMethods";
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
    getBuyMethods(client, itemId, companyId),
  ]);

  if (suppliers.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(
        request,
        error(suppliers.error, "Failed to load service suppliers")
      )
    );
  }

  return json({
    suppliers: suppliers.data ?? [],
  });
}

export default function ServiceSuppliersRoute() {
  const { suppliers } = useLoaderData<typeof loader>();

  return <BuyMethods buyMethods={suppliers} />;
}
