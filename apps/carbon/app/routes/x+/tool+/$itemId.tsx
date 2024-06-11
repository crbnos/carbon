import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { ToolHeader, ToolNavigation, getTool } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [toolSummary] = await Promise.all([getTool(client, itemId, companyId)]);

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
  });
}

export default function ToolRoute() {
  return (
    <>
      <ToolHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <ToolNavigation />
        <Outlet />
      </div>
    </>
  );
}
