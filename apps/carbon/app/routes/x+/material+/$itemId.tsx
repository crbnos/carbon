import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  MaterialHeader,
  MaterialProperties,
  getBuyMethods,
  getItemFiles,
  getMaterial,
  getPickMethods,
} from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Materials",
  to: path.to.materials,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const serviceRole = await getCarbonServiceRole();

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [materialSummary, buyMethods, pickMethods] = await Promise.all([
    getMaterial(serviceRole, itemId, companyId),
    getBuyMethods(serviceRole, itemId, companyId),
    getPickMethods(serviceRole, itemId, companyId),
  ]);

  if (materialSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(materialSummary.error, "Failed to load material summary")
      )
    );
  }

  return defer({
    materialSummary: materialSummary.data,
    files: getItemFiles(serviceRole, itemId, companyId),
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function MaterialRoute() {
  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <MaterialHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <VStack spacing={2} className="p-2 w-full h-full">
            <Outlet />
          </VStack>
        </div>
        <MaterialProperties />
      </div>
    </div>
  );
}
