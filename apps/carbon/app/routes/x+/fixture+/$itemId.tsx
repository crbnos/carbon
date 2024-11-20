import { error } from "@carbon/auth";
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
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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

  const [fixtureSummary, buyMethods, pickMethods, tags] = await Promise.all([
    getFixture(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
    getTagsList(client, companyId, "fixture"),
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
    files: getItemFiles(client, itemId, companyId),
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function FixtureRoute() {
  const { fixtureSummary } = useLoaderData<typeof loader>();

  useRealtime("modelUpload", `modelPath=eq.${fixtureSummary.modelPath}`);

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <FixtureHeader />
      <div className="flex h-[calc(100dvh-99px)] w-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
        <Outlet />
        <FixtureProperties />
      </div>
    </div>
  );
}
