import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  getConsumable,
  getItemFiles,
  getPickMethods,
  getSupplierParts,
} from "~/modules/items";
import {
  ConsumableHeader,
  ConsumableProperties,
} from "~/modules/items/ui/Consumables";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Consumables",
  to: path.to.consumables,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const serviceRole = await getCarbonServiceRole();

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [consumableSummary, supplierParts, pickMethods, tags] =
    await Promise.all([
      getConsumable(serviceRole, itemId, companyId),
      getSupplierParts(serviceRole, itemId, companyId),
      getPickMethods(serviceRole, itemId, companyId),
      getTagsList(serviceRole, companyId, "consumable"),
    ]);

  if (consumableSummary.error) {
    throw redirect(
      path.to.consumables,
      await flash(
        request,
        error(consumableSummary.error, "Failed to load consumable summary")
      )
    );
  }

  return defer({
    consumableSummary: consumableSummary.data,
    files: getItemFiles(serviceRole, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function ConsumableRoute() {
  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ConsumableHeader />
      <div className="flex h-[calc(100dvh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto scrollbar-hide">
          <Outlet />
        </div>
        <ConsumableProperties />
      </div>
    </div>
  );
}
