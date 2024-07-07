import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import {
  MaterialHeader,
  MaterialProperties,
  getBuyMethods,
  getItemFiles,
  getMaterial,
  getPickMethods,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Materials",
  to: path.to.materials,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [materialSummary, files, buyMethods, pickMethods] = await Promise.all([
    getMaterial(client, itemId, companyId),
    getItemFiles(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
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

  return json({
    materialSummary: materialSummary.data,
    files: files.data ?? [],
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
