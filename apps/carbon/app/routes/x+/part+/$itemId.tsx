import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRealtime } from "~/hooks";
import {
  PartHeader,
  PartProperties,
  getBuyMethods,
  getItemFiles,
  getPart,
  getPickMethods,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Parts",
  to: path.to.parts,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partSummary, files, buyMethods, pickMethods] = await Promise.all([
    getPart(client, itemId, companyId),
    getItemFiles(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
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

  return json({
    partSummary: partSummary.data,
    files: files.data ?? [],
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
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
