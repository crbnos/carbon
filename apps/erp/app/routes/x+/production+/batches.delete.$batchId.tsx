import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { updateJobOperationBatch } from "~/modules/production";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
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

  // "Delete" is the edge fn's dissolve: members return to the schedule un-run
  // and the batch row is removed. It refuses once production has been recorded
  // — that refusal message surfaces here as the flash.
  const result = await updateJobOperationBatch(client, {
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
          await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to dissolve batch"
          )
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
  if (!batchId) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteOperationBatch(batchId)}
      name={batch.readableId}
      deleteText={t`Dissolve`}
      text={t`Dissolving ${batch.readableId} returns its ${memberCount} operations to the schedule un-run and deletes the batch. A batch with recorded production must be completed instead.`}
      onCancel={() => navigate(-1)}
      onSubmit={() => navigate(path.to.operationBatches)}
    />
  );
}
