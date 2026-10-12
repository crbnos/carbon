// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useCloseRoute } from "@carbon/react";
import { getErrorMessage, redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { updateJobOperationBatch } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "production"
  });
  const { batchId } = params;
  if (!batchId) throw notFound("batchId not found");

  const batch = await client
    .from("jobOperationBatch")
    .select("id, readableId, status")
    .eq("id", batchId)
    .eq("companyId", companyId)
    .single();
  if (batch.error || !batch.data) {
    throw redirect(
      path.to.operationBatches,
      await flash(request, error(batch.error, "Failed to get batch"))
    );
  }

  const memberCount = await client
    .from("jobOperation")
    .select("id", { count: "exact", head: true })
    .eq("jobOperationBatchId", batchId)
    .eq("companyId", companyId);

  return { batch: batch.data, memberCount: memberCount.count ?? 0 };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });
  const { batchId } = params;
  if (!batchId) throw notFound("batchId not found");

  // "Delete" is the server fn's dissolve: members return to the schedule un-run
  // and the batch row is removed. It refuses once production has been recorded
  // — that refusal message surfaces here as the flash.
  const result = await updateJobOperationBatch(client, getDatabaseClient(), {
    type: "dissolve",
    batchId,
    companyId,
    userId
  });
  if (result.error) {
    throw redirect(
      path.to.operationBatches,
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to dissolve batch")
        )
      )
    );
  }

  throw redirect(
    path.to.operationBatches,
    await flash(request, success("Batch dissolved"))
  );
}

export default function DeleteBatchRoute() {
  const { batch, memberCount } = useLoaderData<typeof loader>();
  const { batchId } = useParams();
  const { t } = useLingui();
  const navigate = useNavigate();
  const closeRoute = useCloseRoute();
  if (!batchId) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteOperationBatch(batchId)}
      name={batch.readableId}
      deleteText={t`Dissolve`}
      text={t`Dissolving ${batch.readableId} returns its ${memberCount} operations to the schedule un-run and deletes the batch. A batch with recorded production must be completed instead.`}
      onCancel={() => closeRoute()}
      onSubmit={() => navigate(path.to.operationBatches)}
    />
  );
}
