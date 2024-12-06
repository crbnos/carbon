import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  getItemFiles,
  getMaterial,
  getPickMethods,
  getSupplierParts,
} from "~/modules/items";
import {
  MaterialHeader,
  MaterialProperties,
} from "~/modules/items/ui/Materials";

import { getTagsList } from "~/modules/shared";
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

  const [materialSummary, supplierParts, pickMethods, tags] = await Promise.all(
    [
      getMaterial(serviceRole, itemId, companyId),
      getSupplierParts(serviceRole, itemId, companyId),
      getPickMethods(serviceRole, itemId, companyId),
      getTagsList(serviceRole, companyId, "material"),
    ]
  );

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
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function MaterialRoute() {
  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] w-full">
      <MaterialHeader />
      <div className="flex h-[calc(100dvh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          <VStack spacing={2} className="p-2 w-full h-full">
            <Outlet />
          </VStack>
        </div>
        <MaterialProperties />
      </div>
    </div>
  );
}
