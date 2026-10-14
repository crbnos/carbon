// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  lockWorkCenterDevice,
  recordManualMachinePress
} from "@carbon/database/machine-time";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { productionEventValidator } from "~/services/models";
import {
  endProductionEvent,
  getOperationEligibility,
  insertMachineEventWithPress,
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

  // One press time for the device rules and the event itself.
  const pressedAt = datetime.timestamp();

  // A machine has one machine time. A Machine press ends every open Machine
  // event on the work center at the press, from any operator or the sensor.
  // On a work center with a device it also ends the open unattributed time and
  // records the press, so an older sensor change cannot undo it. The press
  // commits with the write it belongs to: the new event on a Start, the check
  // that the event is still open on an End.
  const press = (workCenterId: string) => ({
    workCenterId,
    companyId,
    userId,
    pressedAt
  });

  if (productionAction === "Start") {
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
      return data(
        {},
        await flash(request, error(null, OUTSIDE_PROCESSING_REFUSAL))
      );
    }

    const eligibility = await getOperationEligibility(serviceRole, {
      operationId: d.jobOperationId,
      employeeId: userId,
      companyId
    });
    if (!eligibility.eligible) {
      return data(
        {},
        await flash(
          request,
          error(
            null,
            eligibility.reason ?? "Not qualified to start this operation"
          )
        )
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
        .is("endTime", null)
        .neq("type", d.type);
      if (openOthers.data && openOthers.data.length > 0) {
        const endTime = datetime.timestamp();
        for (const ev of openOthers.data) {
          const ended = await endProductionEvent(client, {
            id: ev.id,
            endTime,
            employeeId: userId
          });
          if (ended.data && ended.data.length > 0) {
            await serverFns
              .system({
                db: getDatabaseClient(),
                companyId,
                userId
              })
              .invoke("post-production-event", {
                productionEventId: ended.data[0].id
              });
          }
        }
      }
    }

    const machineWorkCenterId =
      d.type === "Machine" ? d.workCenterId : undefined;
    // The Machine insert skips RLS (it shares the press's transaction), so
    // the permission RLS would check is checked here.
    if (machineWorkCenterId) {
      await requirePermissions(request, { create: "production" });
    }

    const startEvent = await startProductionEvent(
      client,
      {
        ...d,
        startTime: pressedAt,
        employeeId: userId,
        companyId,
        createdBy: userId
      },
      trackedEntityId,
      unitIndex,
      "mes",
      machineWorkCenterId
        ? insertMachineEventWithPress(
            getDatabaseClient(),
            press(machineWorkCenterId)
          )
        : undefined
    );

    if (startEvent.error) {
      return data(
        {},
        await flash(request, error(startEvent.error, "Failed to start event"))
      );
    }

    return data(
      startEvent.data,
      await flash(request, success(`Started ${d.type.toLowerCase()} operation`))
    );
  } else {
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
    // A repeated End must not end it again, nor end a newer event through
    // the press.
    const alreadyEnded = async () =>
      data(
        {},
        await flash(request, error(null, "This event has already ended"))
      );
    if (event.data.endTime) return alreadyEnded();

    const machineWorkCenterId =
      event.data.type === "Machine" ? event.data.workCenterId : null;

    let endEvent: Awaited<ReturnType<typeof endProductionEvent>>;
    if (machineWorkCenterId) {
      await requirePermissions(request, { update: "production" });
      // The press ends this event with every other open Machine event on the
      // work center. It runs only while this event is still open, under the
      // device lock first, as the sync takes it.
      let ended = true;
      try {
        await getDatabaseClient()
          .transaction()
          .execute(async (trx) => {
            await lockWorkCenterDevice(trx, {
              workCenterId: machineWorkCenterId,
              companyId
            });
            const open = await trx
              .selectFrom("productionEvent")
              .select("id")
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .where("endTime", "is", null)
              .forUpdate()
              .executeTakeFirst();
            if (!open) {
              ended = false;
              return;
            }
            await recordManualMachinePress(trx, press(machineWorkCenterId));
          });
      } catch (err) {
        return data(
          {},
          await flash(request, error(err, "Failed to end event"))
        );
      }
      if (!ended) return alreadyEnded();
      endEvent = await client
        .from("productionEvent")
        .select("*")
        .eq("id", id)
        .eq("companyId", companyId);
    } else {
      endEvent = await endProductionEvent(client, {
        id,
        endTime: pressedAt,
        employeeId: userId
      });
      if (!endEvent.error && endEvent.data?.length === 0) {
        return alreadyEnded();
      }
    }
    if (endEvent.error) {
      return data(
        {},
        await flash(request, error(endEvent.error, "Failed to end event"))
      );
    }
    if (endEvent.data && endEvent.data.length > 0) {
      // Batch timers post cost at batch completion, when the aggregate event is
      // sliced per member (batch-operations). Posting it here too would
      // double-book the cost, so skip post-production-event for a batch event.
      if (!endEvent.data[0].jobOperationBatchId) {
        await serverFns
          .system({
            db: getDatabaseClient(),
            companyId,
            userId
          })
          .invoke("post-production-event", {
            productionEventId: endEvent.data[0].id
          });
      }
    }
    return data(
      endEvent.data,
      await flash(request, success(`Ended ${d.type.toLowerCase()} operation`))
    );
  }
}
