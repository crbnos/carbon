import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  getItemFiles,
  getMakeMethods,
  getPart,
  getPickMethods,
  getSupplierParts,
} from "~/modules/items";
import { PartHeader } from "~/modules/items/ui/Parts";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Parts",
  to: path.to.parts,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const serviceRole = await getCarbonServiceRole();
  const [partSummary, supplierParts, pickMethods, tags] = await Promise.all([
    getPart(serviceRole, itemId, companyId),
    getSupplierParts(serviceRole, itemId, companyId),
    getPickMethods(serviceRole, itemId, companyId),
    getTagsList(serviceRole, companyId, "part"),
  ]);

  if (partSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partSummary.error, "Failed to load part summary")
      )
    );
  }

  return defer({
    partSummary: partSummary.data,
    files: getItemFiles(serviceRole, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    makeMethods: getMakeMethods(serviceRole, itemId, companyId),
    tags: tags.data ?? [],
  });
}

export default function PartRoute() {
  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <PartHeader />
      <Outlet />
    </div>
  );
}
