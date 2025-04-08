import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { getItemFiles } from "~/modules/items";
import { getNonConformance } from "~/modules/quality";
import NonConformanceHeader from "~/modules/quality/ui/NonConformance/NonConformanceHeader";
import NonConformanceProperties from "~/modules/quality/ui/NonConformance/NonConformanceProperties";
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
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [nonConformance, tags] = await Promise.all([
    getNonConformance(client, id),
    getTagsList(client, companyId, "nonConformance"),
  ]);

  if (nonConformance.error) {
    throw redirect(
      path.to.nonConformances,
      await flash(
        request,
        error(nonConformance.error, "Failed to load non-conformance")
      )
    );
  }

  return defer({
    nonConformance: nonConformance.data,
    files: getItemFiles(client, id, companyId),
    tags: tags.data ?? [],
  });
}

export default function NonConformanceRoute() {
  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <NonConformanceHeader />
      <div className="flex h-[calc(100dvh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto scrollbar-hide">
          <Outlet />
        </div>
        <NonConformanceProperties />
      </div>
    </div>
  );
}
