import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  ConsumableHeader,
  ConsumableProperties,
  getBuyMethods,
  getConsumable,
  getItemFiles,
  getPickMethods,
} from "~/modules/items";
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

  const [consumableSummary, buyMethods, pickMethods, tags] = await Promise.all([
    getConsumable(serviceRole, itemId, companyId),
    getBuyMethods(serviceRole, itemId, companyId),
    getPickMethods(serviceRole, itemId, companyId),
    getTagsList(serviceRole, companyId, "consumable"),
  ]);

  if (consumableSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(consumableSummary.error, "Failed to load consumable summary")
      )
    );
  }

  return defer({
    consumableSummary: consumableSummary.data,
    files: getItemFiles(serviceRole, itemId, companyId),
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function ConsumableRoute() {
  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <ConsumableHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <VStack spacing={2} className="p-2 w-full h-full">
            <Outlet />
          </VStack>
        </div>
        <ConsumableProperties />
      </div>
    </div>
  );
}
