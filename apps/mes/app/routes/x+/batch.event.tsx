import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { batchProductionEventValidator } from "~/services/models";
import {
  endProductionEvent,
  getJobOperationBatch,
  startBatchProductionEvent
} from "~/services/operations.service";

// Start/end an aggregate batch timer. Unlike a single operation event, the batch
// timer is recorded ONCE against the whole batch (tagged with jobOperationBatchId)
// and is NOT posted to GL on End — completion slices it into per-member events and
// posts each of those. So this route deliberately skips the post-production-event
// invocation that `x+/event.tsx` performs for single operations.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(batchProductionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, action: productionAction, timezone, ...d } = validation.data;

  // Only an Active batch may run its timer. A Completed/Cancelled batch is
  // terminal, and a 'Completing' batch has already committed its timer slice —
  // starting or ending an aggregate timer against any of those would record time
  // that completion can never account for (and could spawn a duplicate timer).
  const batch = await getJobOperationBatch(
    client,
    d.jobOperationBatchId,
    companyId
  );

  if (batch.error || !batch.data) {
    return data(
      {},
      await flash(request, error(batch.error, "Failed to load batch"))
    );
  }

  if (batch.data.status !== "Active") {
    return data({}, await flash(request, error("Batch is not active")));
  }

  if (productionAction === "Start") {
    const startEvent = await startBatchProductionEvent(client, {
      ...d,
      startTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId,
      companyId,
      createdBy: userId
    });

    if (startEvent.error) {
      return data(
        {},
        await flash(
          request,
          error(startEvent.error, "Failed to start batch event")
        )
      );
    }

    return data(
      startEvent.data,
      await flash(request, success(`Started ${d.type.toLowerCase()} batch`))
    );
  }

  if (!id) {
    return data({}, await flash(request, error("No event id provided")));
  }

  const endEvent = await endProductionEvent(client, {
    id,
    endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
    employeeId: userId,
    companyId
  });

  if (endEvent.error) {
    return data(
      {},
      await flash(request, error(endEvent.error, "Failed to end batch event"))
    );
  }

  return data(
    endEvent.data,
    await flash(request, success(`Ended ${d.type.toLowerCase()} batch`))
  );
}
