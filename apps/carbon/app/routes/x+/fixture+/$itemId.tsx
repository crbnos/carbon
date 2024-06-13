import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { FixtureHeader, FixtureNavigation, getFixture } from "~/modules/items";
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

  const [fixtureSummary] = await Promise.all([
    getFixture(client, itemId, companyId),
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
  });
}

export default function FixtureRoute() {
  return (
    <>
      <FixtureHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <FixtureNavigation />
        <Outlet />
      </div>
    </>
  );
}
