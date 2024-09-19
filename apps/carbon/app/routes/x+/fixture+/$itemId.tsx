import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  FixtureHeader,
  FixtureProperties,
  getBuyMethods,
  getFixture,
  getItemFiles,
  getPickMethods,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Fixtures",
  to: path.to.fixtures,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [fixtureSummary, files, buyMethods, pickMethods] = await Promise.all([
    getFixture(client, itemId, companyId),
    getItemFiles(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
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

  return json({
    fixtureSummary: fixtureSummary.data,
    files: files.data ?? [],
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function FixtureRoute() {
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
