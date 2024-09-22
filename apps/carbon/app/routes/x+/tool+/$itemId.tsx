import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ToolHeader,
  ToolProperties,
  getBuyMethods,
  getItemFiles,
  getPickMethods,
  getTool,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Tools",
  to: path.to.tools,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [toolSummary, files, buyMethods, pickMethods] = await Promise.all([
    getTool(client, itemId, companyId),
    getItemFiles(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
  ]);

  if (toolSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(toolSummary.error, "Failed to load tool summary")
      )
    );
  }

  return json({
    toolSummary: toolSummary.data,
    files: files.data ?? [],
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function ToolRoute() {
  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <ToolHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <VStack spacing={2} className="p-2 w-full h-full">
            <Outlet />
          </VStack>
        </div>
        <ToolProperties />
      </div>
    </div>
  );
}
