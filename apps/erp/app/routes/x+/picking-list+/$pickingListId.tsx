// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getPickingList,
  getPickingListAvailability,
  getPickingListLines,
  getPickingListRecommendations,
  getPickingListRelatedItems
} from "~/modules/inventory";
import {
  PickingListDocuments,
  PickingListHeader
} from "~/modules/inventory/ui/PickingLists";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  appBarSubtitle: msg`Picking List`,
  realtime: [
    { table: "pickingList", column: "id", param: "pickingListId" },
    {
      table: "pickingListLine",
      column: "pickingListId",
      param: "pickingListId"
    }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Picking List`, to: path.to.pickingLists },
    (data) => data?.pickingList?.pickingListId
  ),
  module: "inventory"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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
    recommendations: getPickingListRecommendations(client, pickingListId),
    // Deferred: the jobs the list picks for, listed under Documents.
    relatedItems: getPickingListRelatedItems(client, companyId, pickingListId)
  };
}

export default function PickingListDetailRoute() {
  const { pickingList } = useLoaderData<typeof loader>();
  return (
    <DocumentPage
      header={<PickingListHeader />}
      sidebar={
        <DocumentSidebar
          documents={<PickingListDocuments />}
          activity={{
            entityType: "pickingList",
            entityId: pickingList.id,
            refreshKey: `${pickingList.updatedAt ?? ""}:${pickingList.status}`
          }}
        />
      }
    >
      <RecordOutlet />
    </DocumentPage>
  );
}
