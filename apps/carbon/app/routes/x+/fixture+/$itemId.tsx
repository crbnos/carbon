import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { useRealtime } from "~/hooks";
import {
  FixtureHeader,
  FixtureProperties,
  getBuyMethods,
  getFixture,
  getItemFiles,
  getPickMethods,
} from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Fixtures",
  to: path.to.fixtures,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const serviceRole = await getCarbonServiceRole();

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [fixtureSummary, buyMethods, pickMethods] = await Promise.all([
    getFixture(serviceRole, itemId, companyId),
    getBuyMethods(serviceRole, itemId, companyId),
    getPickMethods(serviceRole, itemId, companyId),
  ]);

  if (fixtureSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(fixtureSummary.error, "Failed to load fixture summary")
      )
    );
  }

  return defer({
    fixtureSummary: fixtureSummary.data,
    files: getItemFiles(serviceRole, itemId, companyId),
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function FixtureRoute() {
  const { fixtureSummary } = useLoaderData<typeof loader>();

  useRealtime("modelUpload", `modelPath=eq.${fixtureSummary.modelPath}`);

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <FixtureHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <Outlet />
        </div>
        <FixtureProperties />
      </div>
    </div>
  );
}
