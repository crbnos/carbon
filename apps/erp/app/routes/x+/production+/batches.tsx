// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getJobOperationBatchMemberStats,
  getJobOperationBatchMembers
} from "~/modules/production/production.service";
import BatchesTable from "~/modules/production/ui/Batches/BatchesTable";
import type { Handle } from "~/utils/handle";
import { fetchListPage } from "~/utils/list-registry/index.server";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { operationBatchesList } from "~/utils/list-registry/production.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "batches");

export const handle: Handle = {
  breadcrumb: msg`Batches`,
  to: path.to.operationBatches
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(
    request,
    operationBatchesList.permission
  );

  const searchParams = new URL(request.url).searchParams;
  const batches = await fetchListPage(
    operationBatchesList,
    client,
    companyId,
    searchParams
  );

  if (batches.error && searchParams.get("after")) {
    logger.error("Failed to load a later page of batches", {
      companyId,
      error: batches.error
    });
    return listErrorPage("batches");
  }

  // The member stats and rows of this page's batches only. A later page
  // (`?after=`) brings its own, in its rows.
  const batchIds = batches.rows.map((b) => b.id);
  const [stats, members] = await Promise.all([
    getJobOperationBatchMemberStats(client, companyId, batchIds),
    getJobOperationBatchMembers(client, companyId, batchIds)
  ]);

  return {
    count: batches.count,
    exactCount: batches.exactCount,
    nextCursor: batches.nextCursor,
    batches: batches.rows.map((b) => ({
      ...b,
      memberCount: stats.data[b.id]?.memberCount ?? 0,
      totalQuantity: stats.data[b.id]?.totalQuantity ?? 0,
      // Header work center when assigned; else the members' shared one (the
      // board's own fallback) — a board-created batch has no header WC until
      // its card is dragged.
      workCenterName:
        b.workCenter?.name ?? stats.data[b.id]?.workCenterName ?? null,
      // Member rows for the expandable sub-list.
      members: members.data[b.id] ?? []
    }))
  };
}

export default function BatchesRoute() {
  const { batches, count, nextCursor } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <BatchesTable data={batches} count={count} nextCursor={nextCursor} />
      <RecordOutlet />
    </VStack>
  );
}
