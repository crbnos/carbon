// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { productionEventValidator } from "~/services/models";
import {
  endMachineProductionEvent,
  endProductionEvent,
  getOperationEligibility,
  postEndedProductionEvents,
  startMachineProductionEvent,
  startProductionEvent
} from "~/services/operations.service";
import { OUTSIDE_PROCESSING_REFUSAL } from "~/utils/operationView";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id,
    action: productionAction,
    trackedEntityId,
    unitIndex,
    exclusive,
    ...d
  } = validation.data;

  // A Machine press writes over Kysely, which skips RLS, so the permission RLS
  // would check is checked here, before anything is written. A refusal stays
  // on the page as a message.
  const permitted = async (
    permission: { create: "production" } | { update: "production" }
  ) => {
    try {
      await requirePermissions(request, permission);
      return true;
    } catch (thrown) {
      if (thrown instanceof Response) return false;
      throw thrown;
    }
  };
  const refused = async (message: string) =>
    data({}, await flash(request, error(null, message)));

  // A machine has one machine time. A Machine press ends every open Machine
  // event on the work center, from any operator or the sensor, in the same
  // transaction as the write it belongs to: the new event on a Start, the
  // end of this event on an End. The routes post every event it ended.
  const db = getDatabaseClient();
  const postEnded = (ids: string[]) =>
    postEndedProductionEvents(client, { companyId, userId, ids });

  if (productionAction === "Start") {
    const machineWorkCenterId =
      d.type === "Machine" ? d.workCenterId : undefined;
    if (machineWorkCenterId && !(await permitted({ create: "production" }))) {
      return refused("You do not have permission to start machine time");
    }

    // Ability gate: the shop-floor Start button posts here, so the
    // qualification check must run on this path (not only in the
    // start.$operationId loader)
    const serviceRole = await getCarbonServiceRole();
    const operation = await serviceRole
      .from("jobOperation")
      .select("operationType")
      .eq("id", d.jobOperationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (operation.data?.operationType === "Outside Processing") {
      return refused(OUTSIDE_PROCESSING_REFUSAL);
    }

    const eligibility = await getOperationEligibility(serviceRole, {
      operationId: d.jobOperationId,
      employeeId: userId,
      companyId
    });
    if (!eligibility.eligible) {
      return refused(
        eligibility.reason ?? "Not qualified to start this operation"
      );
    }

    // Single-phase (assembly) clocking: end any other open work type for this
    // operator on this operation before starting, so Setup and Labor can never
    // run simultaneously. Post each ended event so its cost still books.
    if (exclusive === "true") {
      const openOthers = await client
        .from("productionEvent")
        .select("id")
        .eq("jobOperationId", d.jobOperationId)
        .eq("employeeId", userId)
        .eq("companyId", companyId)
        .is("endTime", null)
        .neq("type", d.type);
      if (openOthers.data && openOthers.data.length > 0) {
        const endTime = datetime.timestamp();
        const ended: string[] = [];
        for (const ev of openOthers.data) {
          const result = await endProductionEvent(client, {
            id: ev.id,
            endTime,
            employeeId: userId,
            companyId
          });
          const row = result.data?.[0];
          if (row) ended.push(row.id);
        }
        await postEnded(ended);
      }
    }

    const event = {
      ...d,
      startTime: datetime.timestamp(),
      employeeId: userId,
      companyId,
      createdBy: userId
    };
    const startEvent = machineWorkCenterId
      ? await startMachineProductionEvent(
          db,
          client,
          { ...event, workCenterId: machineWorkCenterId },
          trackedEntityId,
          unitIndex
        )
      : await startProductionEvent(client, event, trackedEntityId, unitIndex);

    if (startEvent.error) {
      return data(
        {},
        await flash(request, error(startEvent.error, "Failed to start event"))
      );
    }
    if (startEvent.data && "endedEventIds" in startEvent.data) {
      await postEnded(startEvent.data.endedEventIds);
    }

    return data(
      startEvent.data,
      await flash(request, success(`Started ${d.type.toLowerCase()} operation`))
    );
  }

  if (!id) {
    return data({}, await flash(request, error("No event id provided")));
  }
  // End on the event's own work center and type, not the form's.
  const event = await client
    .from("productionEvent")
    .select("workCenterId, type, endTime")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (event.error || !event.data) {
    return data(
      {},
      await flash(request, error(event.error, "Failed to end event"))
    );
  }
  const typeLabel = (event.data.type ?? d.type).toLowerCase();
  // A repeated End must not end it again, nor end a newer event through the
  // press.
  if (event.data.endTime) return refused("This event has already ended");

  if (event.data.type === "Machine" && event.data.workCenterId) {
    if (!(await permitted({ update: "production" }))) {
      return refused("You do not have permission to end machine time");
    }
    let press: Awaited<ReturnType<typeof endMachineProductionEvent>>;
    try {
      press = await endMachineProductionEvent(db, {
        id,
        workCenterId: event.data.workCenterId,
        companyId,
        userId
      });
    } catch (err) {
      return data({}, await flash(request, error(err, "Failed to end event")));
    }
    if (!press) return refused("This event has already ended");
    // The press ended this event with every other one on the work center.
    await postEnded(press.endedEventIds);
    const ended = await client
      .from("productionEvent")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId);
    return data(
      ended.data,
      await flash(request, success(`Ended ${typeLabel} operation`))
    );
  }

  const endEvent = await endProductionEvent(client, {
    id,
    endTime: datetime.timestamp(),
    employeeId: userId,
    companyId
  });
  if (endEvent.error) {
    return data(
      {},
      await flash(request, error(endEvent.error, "Failed to end event"))
    );
  }
  const ended = endEvent.data?.[0];
  if (!ended) {
    // Open when read, but the update matched nothing: another End won the
    // race, or RLS refused the update.
    return refused("This event has already ended, or you cannot end it");
  }
  // Batch timers post cost at batch completion, when the aggregate event is
  // sliced per member (batch-operations). Posting it here too would
  // double-book the cost, so postEnded skips a batch event.
  await postEnded([ended.id]);
  return data(
    endEvent.data,
    await flash(request, success(`Ended ${typeLabel} operation`))
  );
}
