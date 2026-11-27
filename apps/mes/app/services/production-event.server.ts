// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A timer Start or End from an operation screen (`x+/event.tsx`). The route
// authenticates and passes its clients in. The checks and the writes are
// `startOperationTimer` / `endOperationTimer` (@carbon/lib), which the ERP's
// API and MCP tools run too; this file parses the form and flashes the result.

import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { PageGate } from "@carbon/database/access";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { validationError, validator } from "@carbon/form";
import {
  endOperationTimer,
  startOperationTimer,
  type TimerDeps,
  type TimerRefusal
} from "@carbon/lib/production/timer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import { productionEventValidator } from "~/services/models";
import { postEndedProductionEvents } from "~/services/operations.service";
import type { assignSerialNumberOnFirstTouch } from "~/services/serial-number.server";

export type ProductionEventDeps = {
  /** The operator's client. */
  client: SupabaseClient<Database>;
  serviceRole: SupabaseClient<Database>;
  db: () => Kysely<KyselyDatabase>;
  /** Whether the operator holds a gate (a Machine press). */
  permitted: (gate: PageGate) => Promise<boolean>;
  /** Numbers a unit on its first touch (`assignSerialNumberOnFirstTouch`). */
  numberUnit: typeof assignSerialNumberOnFirstTouch;
};

export async function productionEventAction(
  deps: ProductionEventDeps,
  {
    request,
    companyId,
    userId
  }: { request: Request; companyId: string; userId: string }
) {
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

  // A refusal stays on the page as a message; a failed write logs its cause.
  const refused = async (refusal: TimerRefusal) =>
    data(
      {},
      await flash(request, error(refusal.cause ?? null, refusal.message))
    );

  // A machine has one machine time. A Machine press ends every open Machine
  // event on the work center, from any operator or the sensor, in the same
  // transaction as the write it belongs to: the new event on a Start, the
  // end of this event on an End. Every event it ended is posted.
  const timer: TimerDeps = {
    ...deps,
    postEnded: (ids) =>
      postEndedProductionEvents(deps.client, { companyId, userId, ids })
  };

  if (productionAction === "Start") {
    const started = await startOperationTimer(timer, {
      companyId,
      employeeId: userId,
      jobOperationId: d.jobOperationId,
      type: d.type,
      workCenterId: d.workCenterId,
      trackedEntityId,
      unitIndex,
      exclusive: exclusive === "true"
    });
    if (!started.ok) return refused(started);

    const label = `Started ${d.type.toLowerCase()}`;
    return data(
      started.event,
      await flash(
        request,
        success(
          !started.dropped
            ? label
            : started.unitId
              ? `${label} on the next open unit: the unit shown is not open here`
              : `${label} with no unit: the unit shown is not open here`
        )
      )
    );
  }

  if (!id) {
    return data({}, await flash(request, error(null, "No event id provided")));
  }
  // End on the event's own work center and type, not the form's.
  const ended = await endOperationTimer(timer, {
    companyId,
    userId,
    eventId: id
  });
  if (!ended.ok) return refused(ended);
  const typeLabel = (ended.type ?? d.type).toLowerCase();
  return data(
    ended.event,
    await flash(request, success(`Paused ${typeLabel}`))
  );
}
