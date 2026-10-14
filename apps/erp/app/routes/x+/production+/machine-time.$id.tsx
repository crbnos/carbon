// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  assignUnattributedMachineTime,
  dismissUnattributedMachineTime
} from "@carbon/ee/oee.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import {
  parseAbsolute,
  toCalendarDate,
  toZoned
} from "@internationalized/date";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  assignMachineTimeValidator,
  dismissMachineTimeValidator,
  getJob,
  getJobOperation,
  getMachineTimeOperationCandidates,
  getUnattributedMachineTime,
  getUnattributedMachineTimeNeighbors,
  getWorkCenterDayEvents,
  isJobLocked
} from "~/modules/production";
import MachineTimeDrawer from "~/modules/production/ui/MachineTime/MachineTimeDrawer.ee";
import { parseMachineTimeListFilters } from "~/modules/production/ui/MachineTime/machine-time-filters.ee";
import { suggestMachineTimeOperations } from "~/modules/production/ui/MachineTime/machine-time-suggestions.ee";
import {
  getCompanyTimeZone,
  getLocationTimeZone
} from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { getParams, path } from "~/utils/path";

const logger = getLogger("erp", "production", "machine-time");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const machineTime = await getUnattributedMachineTime(client, id, companyId);
  if (machineTime.error) {
    logger.error("Failed to load machine time", {
      companyId,
      id,
      error: machineTime.error
    });
    throw redirect(
      `${path.to.unattributedMachineTimes}?${getParams(request)}`,
      await flash(
        request,
        error(machineTime.error, "Failed to load machine time")
      )
    );
  }
  if (!machineTime.data) {
    // Assigned, dismissed or aged out since the link was made.
    throw redirect(
      `${path.to.unattributedMachineTimes}?${getParams(request)}`,
      await flash(request, error(null, "That machine time is no longer open"))
    );
  }

  const { workCenterId, startTime, endTime, workCenter } = machineTime.data;
  const companyTimeZone = await getCompanyTimeZone(client, companyId);
  const timeZone = workCenter.locationId
    ? await getLocationTimeZone(client, workCenter.locationId, companyId)
    : companyTimeZone;

  // The queue walks the list's rows: the same search and filters, read from
  // the list's query string.
  const filters = parseMachineTimeListFilters(
    new URL(request.url).searchParams
  );

  // The work center's calendar day the time started on.
  const date = toCalendarDate(parseAbsolute(startTime, timeZone));
  const day = {
    start: toZoned(date, timeZone).toAbsoluteString(),
    end: toZoned(date.add({ days: 1 }), timeZone).toAbsoluteString()
  };

  const [neighbors, events, candidates] = await Promise.all([
    getUnattributedMachineTimeNeighbors(client, {
      companyId,
      id,
      startTime,
      endTime,
      filters
    }),
    getWorkCenterDayEvents(client, {
      companyId,
      workCenterId,
      dayStart: day.start,
      dayEnd: day.end
    }),
    getMachineTimeOperationCandidates(client, {
      workCenterId,
      locationId: workCenter.locationId,
      companyId
    })
  ]);

  return {
    machineTime: machineTime.data,
    timeZone,
    queue: neighbors.data ?? {
      position: endTime ? 1 : null,
      total: 1,
      previousId: null,
      nextId: null
    },
    suggestions: suggestMachineTimeOperations({
      events: events.data ?? [],
      interval: { startTime, endTime },
      day,
      nowMs: Date.now()
    }),
    operationOptions: candidates.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const query = getParams(request);
  const detailPath = `${path.to.unattributedMachineTime(id)}?${query}`;
  const listPath = `${path.to.unattributedMachineTimes}?${query}`;

  await requireFeature({
    request,
    client,
    companyId,
    feature: "INTEGRATIONS",
    redirectTo: listPath
  });

  // Answering one moves on: to the row below, else the row above, else the
  // list. Read before the write, which deletes this row.
  const machineTime = await getUnattributedMachineTime(client, id, companyId);
  const filters = parseMachineTimeListFilters(
    new URL(request.url).searchParams
  );
  const neighbors = machineTime.data
    ? await getUnattributedMachineTimeNeighbors(client, {
        companyId,
        id,
        startTime: machineTime.data.startTime,
        endTime: machineTime.data.endTime,
        filters
      })
    : null;
  const nextId = neighbors?.data?.nextId ?? neighbors?.data?.previousId;
  const nextPath = nextId
    ? `${path.to.unattributedMachineTime(nextId)}?${query}`
    : listPath;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "assign") {
    const validation = await validator(assignMachineTimeValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }

    const { jobOperationId } = validation.data;
    const operation = await getJobOperation(client, jobOperationId);
    if (operation.error || !operation.data) {
      return data(
        {},
        await flash(request, error(operation.error, "Failed to get operation"))
      );
    }

    const job = await getJob(client, operation.data.jobId);
    if (job.error || !job.data) {
      return data(
        {},
        await flash(request, error(job.error, "Failed to get job"))
      );
    }
    // A friendly redirect only: the service re-checks the lock under a row
    // lock inside its transaction.
    await requireUnlocked({
      request,
      isLocked: isJobLocked(job.data?.status),
      redirectTo: detailPath,
      message: "Cannot modify a locked job. Reopen it first."
    });

    // Sensor-derived time is NOT posted to the GL here: the operation's
    // machine time posts when the operation finishes.
    const assignment = await assignUnattributedMachineTime(
      client,
      getDatabaseClient(),
      {
        companyId,
        userId,
        unattributedMachineTimeId: id,
        jobOperationId
      }
    );
    if (assignment.error) {
      return data(
        {},
        await flash(
          request,
          error(
            assignment.error,
            `Failed to assign machine time: ${assignment.error}`
          )
        )
      );
    }

    throw redirect(
      nextPath,
      await flash(
        request,
        success(`Assigned to ${job.data?.jobId ?? "the job"}`)
      )
    );
  }

  if (intent === "dismiss") {
    const validation = await validator(dismissMachineTimeValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }

    const dismissal = await dismissUnattributedMachineTime(
      client,
      getDatabaseClient(),
      { companyId, unattributedMachineTimeId: id }
    );
    if (dismissal.error) {
      return data(
        {},
        await flash(
          request,
          error(
            dismissal.error,
            `Failed to dismiss machine time: ${dismissal.error}`
          )
        )
      );
    }

    throw redirect(nextPath, await flash(request, success("Dismissed")));
  }

  return data({}, await flash(request, error(null, "Unknown intent")));
}

export default function MachineTimeDetailRoute() {
  const { machineTime, timeZone, queue, suggestions, operationOptions } =
    useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  return (
    <MachineTimeDrawer
      key={machineTime.id}
      machineTime={machineTime}
      timeZone={timeZone}
      queue={queue}
      suggestions={suggestions}
      operationOptions={operationOptions}
      onClose={() => closeRoute()}
    />
  );
}
