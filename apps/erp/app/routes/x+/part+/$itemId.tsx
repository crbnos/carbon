import { error } from "@carbon/auth";
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
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true,
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partSummary, supplierParts, pickMethods, tags] = await Promise.all([
    getPart(client, itemId, companyId),
    getSupplierParts(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
    getTagsList(client, companyId, "part"),
  ]);

  if (partSummary.data?.companyId !== companyId) {
    throw redirect(path.to.items);
  }

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
    files: getItemFiles(client, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    makeMethods: getMakeMethods(client, itemId, companyId),
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
