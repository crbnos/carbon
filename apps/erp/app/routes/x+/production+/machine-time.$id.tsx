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
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  assignMachineTimeValidator,
  dismissMachineTimeValidator,
  getJob,
  getJobOperation,
  getMachineTimeOperationCandidates,
  getUnattributedMachineTime,
  isJobLocked
} from "~/modules/production";
import MachineTimeDrawer from "~/modules/production/ui/MachineTime/MachineTimeDrawer.ee";
import { getDatabaseClient } from "~/services/database.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const machineTime = await getUnattributedMachineTime(client, id, companyId);
  if (machineTime.error || !machineTime.data) {
    throw redirect(
      path.to.unattributedMachineTimes,
      await flash(
        request,
        error(machineTime.error, "Failed to get unattributed machine time")
      )
    );
  }

  const candidates = await getMachineTimeOperationCandidates(client, {
    workCenterId: machineTime.data.workCenterId,
    companyId
  });

  return {
    machineTime: machineTime.data,
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

  const detailPath = `${path.to.unattributedMachineTime(id)}?${getParams(request)}`;
  const listPath = `${path.to.unattributedMachineTimes}?${getParams(request)}`;

  await requireFeature({
    request,
    client,
    companyId,
    feature: "INTEGRATIONS",
    redirectTo: listPath
  });

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
      listPath,
      await flash(request, success("Assigned machine time"))
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
      {
        companyId,
        userId,
        unattributedMachineTimeId: id,
        dismissReason: validation.data.dismissReason
      }
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

    throw redirect(
      listPath,
      await flash(request, success("Dismissed machine time"))
    );
  }

  return data({}, await flash(request, error(null, "Unknown intent")));
}

export default function MachineTimeDetailRoute() {
  const { machineTime, operationOptions } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  return (
    <MachineTimeDrawer
      key={machineTime.id}
      machineTime={machineTime}
      operationOptions={operationOptions}
      onClose={() => closeRoute()}
    />
  );
}
