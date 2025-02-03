import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
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
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true,
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [materialSummary, supplierParts, pickMethods, tags] = await Promise.all(
    [
      getMaterial(client, itemId, companyId),
      getSupplierParts(client, itemId, companyId),
      getPickMethods(client, itemId, companyId),
      getTagsList(client, companyId, "material"),
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
    files: getItemFiles(client, itemId, companyId),
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
          <Outlet />
        </div>
        <MaterialProperties />
      </div>
    </div>
  );
}
