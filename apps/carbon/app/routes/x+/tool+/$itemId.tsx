import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  ToolHeader,
  ToolProperties,
  getBuyMethods,
  getItemFiles,
  getPickMethods,
  getTool,
} from "~/modules/items";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Tools",
  to: path.to.tools,
  module: "items",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const serviceRole = await getCarbonServiceRole();
  const [toolSummary, buyMethods, pickMethods, tags] = await Promise.all([
    getTool(serviceRole, itemId, companyId),
    getBuyMethods(serviceRole, itemId, companyId),
    getPickMethods(serviceRole, itemId, companyId),
    getTagsList(serviceRole, companyId, "tool"),
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

  return defer({
    toolSummary: toolSummary.data,
    files: getItemFiles(serviceRole, itemId, companyId),
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function ToolRoute() {
  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ToolHeader />
      <div className="flex h-[calc(100dvh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          <VStack spacing={2} className="p-2 w-full h-full">
            <Outlet />
          </VStack>
        </div>
        <ToolProperties />
      </div>
    </div>
  );
}
