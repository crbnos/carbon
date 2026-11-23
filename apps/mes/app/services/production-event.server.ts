// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A timer Start or End from an operation screen (`x+/event.tsx`). The route
// authenticates and passes its clients in.

import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import { productionEventValidator } from "~/services/models";
import {
  abilityBlockRefusal,
  endMachineProductionEvent,
  endProductionEvent,
  postEndedProductionEvents,
  startMachineProductionEvent,
  startProductionEvent
} from "~/services/operations.service";
import type { generateFirstArticlesForStartedJob } from "~/services/quality.server";
import type { assignSerialNumberOnFirstTouch } from "~/services/serial-number.server";
import { resolveWorkUnit } from "~/services/work-unit.server";
import { OUTSIDE_PROCESSING_REFUSAL } from "~/utils/operationView";

export type ProductionEventDeps = {
  /** The operator's client. */
  client: SupabaseClient<Database>;
  serviceRole: SupabaseClient<Database>;
  db: () => Kysely<KyselyDatabase>;
  /** Whether the operator holds a permission (a Machine press). */
  permitted: (
    permission: { create: "production" } | { update: "production" }
  ) => Promise<boolean>;
  /** Numbers a unit on its first touch (`assignSerialNumberOnFirstTouch`). */
  numberUnit: typeof assignSerialNumberOnFirstTouch;
  /**
   * Creates the first article lots of a job this start released (a Draft /
   * Planned job auto-started here), `generateFirstArticlesForStartedJob`.
   */
  generateFirstArticles?: typeof generateFirstArticlesForStartedJob;
};

export async function productionEventAction(
  deps: ProductionEventDeps,
  {
    request,
    companyId,
    userId
  }: { request: Request; companyId: string; userId: string }
) {
  const { client } = deps;
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
  // would check is checked here (`deps.permitted`), before anything is
  // written. A refusal stays on the page as a message.
  const { permitted } = deps;
  const refused = async (message: string) =>
    data({}, await flash(request, error(null, message)));

  // A machine has one machine time. A Machine press ends every open Machine
  // event on the work center, from any operator or the sensor, in the same
  // transaction as the write it belongs to: the new event on a Start, the
  // end of this event on an End. The routes post every event it ended.
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
    const { serviceRole } = deps;
    const operation = await serviceRole
      .from("jobOperation")
      .select("operationType")
      .eq("id", d.jobOperationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (operation.data?.operationType === "Outside Processing") {
      return refused(OUTSIDE_PROCESSING_REFUSAL);
    }

    const abilityRefusal = await abilityBlockRefusal(serviceRole, {
      operationId: d.jobOperationId,
      employeeId: userId,
      companyId
    });
    if (abilityRefusal) return refused(abilityRefusal);

    // A timer names a unit only when the screen held one open here. With
    // none, or one done here, a first operation runs on the next open unit
    // and a later operation names none.
    const work = await resolveWorkUnit({
      client: serviceRole,
      companyId,
      operationId: d.jobOperationId,
      requestedUnitId: trackedEntityId,
      mode: "optional"
    });
    if (work.kind === "refuse") return refused(work.message);
    // Not serial: a batch lot passes through (`lotId`).
    const unitId = work.kind === "unit" ? work.unitId : work.lotId;
    const unitAt = work.kind === "unit" ? work.unitIndex : unitIndex;
    // The unit the screen named is not open here: say what the timer runs on.
    const dropped = !!trackedEntityId && unitId !== trackedEntityId;

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
    const onJobReleased = deps.generateFirstArticles
      ? (jobId: string) =>
          deps.generateFirstArticles!(deps.serviceRole, {
            jobId,
            companyId,
            userId
          })
      : undefined;
    const startEvent = machineWorkCenterId
      ? await startMachineProductionEvent(
          deps.db(),
          client,
          { ...event, workCenterId: machineWorkCenterId },
          unitId,
          unitAt,
          "mes",
          onJobReleased
        )
      : await startProductionEvent(
          client,
          event,
          unitId,
          unitAt,
          "mes",
          onJobReleased
        );

    if (startEvent.error) {
      return data(
        {},
        await flash(request, error(startEvent.error, "Failed to start event"))
      );
    }
    if (startEvent.data && "endedEventIds" in startEvent.data) {
      await postEnded(startEvent.data.endedEventIds);
    }

    // First touch: number the unit if it has no serial number yet.
    if (unitId) {
      await deps.numberUnit({
        trackedEntityId: unitId,
        jobOperationId: d.jobOperationId,
        companyId
      });
    }

    const started = `Started ${d.type.toLowerCase()}`;
    return data(
      startEvent.data,
      await flash(
        request,
        success(
          !dropped
            ? started
            : unitId
              ? `${started} on the next open unit: the unit shown is not open here`
              : `${started} with no unit: the unit shown is not open here`
        )
      )
    );
  }

  if (!id) {
    return data({}, await flash(request, error(null, "No event id provided")));
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
      press = await endMachineProductionEvent(deps.db(), {
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
      await flash(request, success(`Paused ${typeLabel}`))
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
    await flash(request, success(`Paused ${typeLabel}`))
  );
}
