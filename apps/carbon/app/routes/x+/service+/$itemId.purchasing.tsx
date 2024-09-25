import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getBuyMethods } from "~/modules/items";
import BuyMethods from "~/modules/items/ui/Item/BuyMethods/BuyMethods";
import { path } from "~/utils/path";

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
