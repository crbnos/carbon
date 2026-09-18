import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
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

  const [batch, events] = await Promise.all([
    getJobOperationBatchWithMembers(client, batchId, companyId),
    getJobOperationBatchEvents(client, batchId, companyId)
  ]);
  if (batch.error || !batch.data) {
    throw redirect(
      path.to.operationBatches,
      await flash(request, error(batch.error, "Failed to get batch"))
    );
  }

  return { batch: batch.data, events: events.data ?? [] };
}

export default function BatchRoute() {
  const { batch, events } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <BatchDetailDrawer
      batch={batch}
      events={events}
      onClose={() => navigate(-1)}
    />
  );
}
