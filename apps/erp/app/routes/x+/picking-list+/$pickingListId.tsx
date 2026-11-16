// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import { getPickingListLiveBins } from "~/modules/inventory/inventory.service";
import {
  PickingListDocuments,
  PickingListHeader
} from "~/modules/inventory/ui/PickingLists";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const handle: Handle = {
  appBarSubtitle: msg`Picking List`,
  realtime: [
    { table: "pickingList", column: "id", param: "pickingListId" },
    {
      table: "pickingListLine",
      column: "pickingListId",
      param: "pickingListId"
    },
    {
      table: "itemLedger",
      filter: ({ data }) => {
        const itemIds = [
          ...new Set(
            (data?.pickingListLines ?? [])
              .map((line: { itemId?: string | null }) => line.itemId)
              .filter((id: string | null | undefined): id is string => !!id)
          )
        ];
        return itemIds.length ? `itemId=in.(${itemIds.join(",")})` : false;
      }
    }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Picking List`, to: path.to.pickingLists },
    (data) => data?.pickingList?.pickingListId
  )
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.pickingList?.pickingListId, "Picking List");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, client, companyId } = await authorize(request, {
    "inventory.pickingLists": "View"
  });

  const { pickingListId } = params;
  if (!pickingListId) throw new Response("Not found", { status: 404 });

  const [pickingList, pickingListLines, liveBins] = await Promise.all([
    api.inventory.getPickingList({ pickingListId }),
    api.inventory.getPickingListLines({ pickingListId }),
    getPickingListLiveBins(client, pickingListId, companyId)
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

  if (liveBins.error) {
    throw redirect(
      path.to.pickingLists,
      await flash(request, error(liveBins.error, "Failed to load current bins"))
    );
  }

  return {
    pickingList: pickingList.data,
    pickingListLines: (pickingListLines.data ?? []).map((line) => ({
      ...line,
      liveStorageUnits: liveBins.data.get(line.id) ?? []
    })),
    // Deferred (not awaited): recommended serial/batch lots per line, streamed in
    // after the list paints so the at-a-glance subtext never blocks first render.
    recommendations: api.inventory
      .getPickingListRecommendations({ pickingListId })
      .then(dataOrThrow),
    // Deferred: the jobs the list picks for, listed under Documents.
    relatedItems: api.inventory
      .getPickingListRelatedItems({ pickingListId })
      .then(dataOrThrow)
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
