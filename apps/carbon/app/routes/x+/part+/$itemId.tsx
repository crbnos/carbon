import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { useRealtime } from "~/hooks";
import {
  PartHeader,
  PartProperties,
  getBuyMethods,
  getItemFiles,
  getPart,
  getPickMethods,
} from "~/modules/items";
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
  const [partSummary, buyMethods, pickMethods, tags] = await Promise.all([
    getPart(serviceRole, itemId, companyId),
    getBuyMethods(serviceRole, itemId, companyId),
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
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function PartRoute() {
  const { partSummary } = useLoaderData<typeof loader>();

  useRealtime("modelUpload", `modelPath=eq.${partSummary.modelPath}`);

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <PartHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <Outlet />
        </div>
        <PartProperties />
      </div>
    </div>
  );
}
