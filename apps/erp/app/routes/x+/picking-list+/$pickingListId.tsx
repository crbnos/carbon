import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import {
  getPickingList,
  getPickingListAvailability,
  getPickingListLines,
  getPickingListRecommendations
} from "~/modules/inventory";
import { PickingListHeader } from "~/modules/inventory/ui/PickingLists";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Picking List`,
  to: path.to.pickingLists
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });

  const { pickingListId } = params;
  if (!pickingListId) throw new Response("Not found", { status: 404 });

  const [pickingList, pickingListLines, availability] = await Promise.all([
    getPickingList(client, pickingListId),
    getPickingListLines(client, pickingListId),
    getPickingListAvailability(client, pickingListId)
  ]);

  if (pickingList.error) {
    throw redirect(
      path.to.pickingLists,
      await flash(
        request,
        error(pickingList.error, "Failed to load picking list")
      )
    );
  }

  if (pickingListLines.error) {
    throw redirect(
      path.to.pickingLists,
      await flash(
        request,
        error(pickingListLines.error, "Failed to load picking list lines")
      )
    );
  }

  return {
    pickingList: pickingList.data,
    pickingListLines: (pickingListLines.data ?? []).map((line) => ({
      ...line,
      availableQuantity: availability.get(line.id) ?? 0
    })),
    // Deferred (not awaited): recommended serial/batch lots per line, streamed in
    // after the list paints so the at-a-glance subtext never blocks first render.
    recommendations: getPickingListRecommendations(client, pickingListId)
  };
}

export default function PickingListDetailRoute() {
  const params = useParams();
  const { pickingListId } = params;
  if (!pickingListId) throw new Error("Could not find pickingListId");

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <PickingListHeader />
      <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
        <div className="h-full p-4 w-full max-w-5xl mx-auto flex flex-col gap-4 pb-16">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
