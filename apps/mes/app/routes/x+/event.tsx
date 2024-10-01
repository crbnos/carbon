import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  endProductionEvent,
  productionEventValidator,
  startProductionEvent,
} from "~/services/jobs.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { action: productionAction, timezone, ...data } = validation.data;

  if (productionAction === "Start") {
    const startEvent = await startProductionEvent(client, {
      ...data,
      startTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId,
      companyId,
      createdBy: userId,
    });
    if (startEvent.error) {
      return json(
        {},
        await flash(request, error(startEvent.error, "Failed to start event"))
      );
    }

    return json(
      startEvent.data,
      await flash(request, success("Started operation"))
    );
  } else {
    const endEvent = await endProductionEvent(client, {
      ...data,
      endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId,
    });
    if (endEvent.error) {
      return json(
        {},
        await flash(request, error(endEvent.error, "Failed to end event"))
      );
    }
  }
}
