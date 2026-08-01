import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { productionEventValidator } from "~/services/models";
import {
  endProductionEvent,
  startProductionEvent
} from "~/services/operations.service";

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
    timezone,
    trackedEntityId,
    unitIndex,
    exclusive,
    ...d
  } = validation.data;

  if (productionAction === "Start") {
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
        const serviceRole = await getCarbonServiceRole();
        const endTime = now(timezone ?? getLocalTimeZone()).toAbsoluteString();
        for (const ev of openOthers.data) {
          const ended = await endProductionEvent(client, {
            id: ev.id,
            endTime,
            employeeId: userId
          });
          if (ended.data && ended.data.length > 0) {
            await serviceRole.functions.invoke("post-production-event", {
              body: { productionEventId: ended.data[0].id, userId, companyId }
            });
          }
        }
      }
    }
    const startEvent = await startProductionEvent(
      client,
      {
        ...d,
        startTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
        employeeId: userId,
        companyId,
        createdBy: userId
      },
      trackedEntityId,
      unitIndex
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
    const endEvent = await endProductionEvent(client, {
      id,
      endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId
    });
    if (endEvent.error) {
      return data(
        {},
        await flash(request, error(endEvent.error, "Failed to end event"))
      );
    }
    if (endEvent.data && endEvent.data.length > 0) {
      const serviceRole = await getCarbonServiceRole();
      await serviceRole.functions.invoke("post-production-event", {
        body: {
          productionEventId: endEvent.data[0].id,
          userId,
          companyId
        }
      });
    }
    return data(
      endEvent.data,
      await flash(request, success(`Ended ${d.type.toLowerCase()} operation`))
    );
  }
}
