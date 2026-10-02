// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { endEvent, startEvent } from "~/services/commands.time.server";
import { productionEventValidator } from "~/services/models";

/**
 * The in-app Start/Stop button. The work is in the `startEvent` / `endEvent`
 * commands (`~/services/commands.time.server`), which `/api/v1` calls too;
 * this route only parses the form and renders the outcome as a flash.
 *
 * Note this path is deliberately NOT the QR-traveller path: `startEvent` runs
 * the ability gate and nothing else, while `x+/start.$operationId.tsx` carries
 * the floor gate, the blocked-work-center check and the `operationStart` rules.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, sessionUserId } = await requirePermissions(
    request,
    {}
  );

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

  if (productionAction === "Start") {
    const started = await startEvent(client, {
      companyId,
      userId,
      sessionUserId,
      source: "mes",
      body: {
        ...d,
        trackedEntityId,
        unitIndex,
        exclusive: exclusive === "true"
      }
    });

    if (!started.ok) {
      return data({}, await flash(request, started.failure.details as Result));
    }

    return data(
      started.data,
      await flash(request, success(`Started ${d.type.toLowerCase()} operation`))
    );
  } else {
    if (!id) {
      return data({}, await flash(request, error("No event id provided")));
    }
    const ended = await endEvent(client, {
      companyId,
      userId,
      sessionUserId,
      eventId: id,
      source: "mes"
    });
    if (!ended.ok) {
      return data({}, await flash(request, ended.failure.details as Result));
    }
    return data(
      ended.data,
      await flash(request, success(`Ended ${d.type.toLowerCase()} operation`))
    );
  }
}
