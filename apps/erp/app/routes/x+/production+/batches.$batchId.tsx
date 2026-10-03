// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getBatchOutputLots,
  getJobOperationBatchEvents,
  getJobOperationBatchWithMembers
} from "~/modules/production";
import { BatchDetailDrawer } from "~/modules/production/ui/Batches/BatchDetailDrawer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { batchId } = params;
  if (!batchId) throw notFound("batchId not found");

  const [batch, events, outputLots] = await Promise.all([
    getJobOperationBatchWithMembers(client, batchId, companyId),
    getJobOperationBatchEvents(client, batchId, companyId),
    getBatchOutputLots(client, batchId, companyId)
  ]);
  if (batch.error || !batch.data) {
    throw redirect(
      path.to.operationBatches,
      await flash(request, error(batch.error, "Failed to get batch"))
    );
  }

  return {
    batch: batch.data,
    events: events.data ?? [],
    outputLots: outputLots.data ?? []
  };
}

export default function BatchRoute() {
  const { batch, events, outputLots } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  return (
    <BatchDetailDrawer
      batch={batch}
      events={events}
      outputLots={outputLots}
      onClose={() => closeRoute()}
    />
  );
}
