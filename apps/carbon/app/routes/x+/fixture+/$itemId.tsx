import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useMatches } from "@remix-run/react";
import {
  FixtureHeader,
  FixtureProperties,
  getBuyMethods,
  getFixture,
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

  const [fixtureSummary, buyMethods, pickMethods] = await Promise.all([
    getFixture(client, itemId, companyId),
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
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function FixtureRoute() {
  const matches = useMatches();
  const isManufacturing = matches.some(
    (match) => match.id === "routes/x+/fixture+/$itemId.manufacturing"
  );

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <FixtureHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <Outlet />
        </div>
        {!isManufacturing && <FixtureProperties />}
      </div>
    </div>
  );
}
