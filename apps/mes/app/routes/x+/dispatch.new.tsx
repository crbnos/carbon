import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { notifyTask } from "@carbon/jobs/trigger/notify";
import { NotificationEvent } from "@carbon/notifications";
import { getLocalTimeZone, now } from "@internationalized/date";
import { tasks } from "@trigger.dev/sdk";
import { type ActionFunctionArgs, data, redirect } from "react-router";
import { maintenanceDispatchValidator } from "~/services/models";
import { endProductionEventsByWorkCenter } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(maintenanceDispatchValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  // Get the next sequence for maintenance dispatch
  const nextSequence = await serviceRole.rpc("get_next_sequence", {
    sequence_name: "maintenanceDispatch",
    company_id: companyId
  });

  if (nextSequence.error) {
    return data(
      {},
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const content = validation.data.content
    ? JSON.parse(validation.data.content)
    : {};

  // If operator performed, set status to Completed
  const isOperatorPerformed = validation.data.severity === "Operator Performed";
  const status = isOperatorPerformed
    ? validation.data.actualEndTime
      ? "Completed"
      : "In Progress"
    : "Open";

  const currentTime = now(getLocalTimeZone()).toAbsoluteString();

  // Get locationId from work center
  let locationId: string | undefined;
  if (validation.data.workCenterId) {
    const workCenter = await serviceRole
      .from("workCenter")
      .select("locationId")
      .eq("id", validation.data.workCenterId)
      .single();
    if (!workCenter.error && workCenter.data?.locationId) {
      locationId = workCenter.data.locationId;
    }
  }

  const insertDispatch = await serviceRole
    .from("maintenanceDispatch")
    .insert([
      {
        maintenanceDispatchId: nextSequence.data,
        status,
        priority: validation.data.priority,
        severity: validation.data.severity,
        oeeImpact: validation.data.oeeImpact,
        source: "Reactive", // Coming from MES is always reactive
        workCenterId: validation.data.workCenterId,
        locationId,
        assignee: isOperatorPerformed ? userId : undefined,
        suspectedFailureModeId:
          validation.data.suspectedFailureModeId || undefined,
        actualFailureModeId: validation.data.actualFailureModeId || undefined,
        plannedStartTime: currentTime, // Set plannedStartTime to today for reactive maintenance
        actualStartTime: validation.data.actualStartTime || undefined,
        actualEndTime: validation.data.actualEndTime || undefined,
        content,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();

  if (insertDispatch.error) {
    return data(
      {},
      await flash(
        request,
        error(insertDispatch.error, "Failed to create maintenance dispatch")
      )
    );
  }

  // End all production events for the work center if oeeImpact is Down
  if (validation.data.oeeImpact === "Down") {
    await endProductionEventsByWorkCenter(serviceRole, {
      workCenterId: validation.data.workCenterId,
      companyId,
      endTime: now(getLocalTimeZone()).toAbsoluteString()
    });
  }

  // Send notification based on failure mode type
  if (insertDispatch.data?.id) {
    try {
      // Get company settings
      const companySettings = await serviceRole
        .from("companySettings")
        .select(
          "maintenanceDispatchNotificationGroup, qualityDispatchNotificationGroup, operationsDispatchNotificationGroup, otherDispatchNotificationGroup"
        )
        .eq("id", companyId)
        .single();

      if (!companySettings.error && companySettings.data) {
        let notificationGroup: string[] = [];

        // If there's a suspected failure mode, look up its type
        if (validation.data.suspectedFailureModeId) {
          const failureMode = await serviceRole
            .from("maintenanceFailureMode")
            .select("type")
            .eq("id", validation.data.suspectedFailureModeId)
            .single();

          if (!failureMode.error && failureMode.data?.type) {
            // Route to the appropriate notification group based on type
            switch (failureMode.data.type) {
              case "Maintenance":
                notificationGroup =
                  companySettings.data.maintenanceDispatchNotificationGroup ??
                  [];
                break;
              case "Quality":
                notificationGroup =
                  companySettings.data.qualityDispatchNotificationGroup ?? [];
                break;
              case "Operations":
                notificationGroup =
                  companySettings.data.operationsDispatchNotificationGroup ??
                  [];
                break;
              case "Other":
                notificationGroup =
                  companySettings.data.otherDispatchNotificationGroup ?? [];
                break;
            }
          }
        }

        // Default to maintenance group if no failure mode or no notification group found
        if (notificationGroup.length === 0) {
          notificationGroup =
            companySettings.data.maintenanceDispatchNotificationGroup ?? [];
        }

        // Send notification if there's a notification group configured
        if (notificationGroup.length > 0) {
          await tasks.trigger<typeof notifyTask>("notify", {
            companyId,
            documentId: insertDispatch.data.id,
            event: NotificationEvent.MaintenanceDispatchCreated,
            recipient: {
              type: "group",
              groupIds: notificationGroup
            },
            from: userId
          });
        }
      }
    } catch (err) {
      console.error("Failed to trigger maintenance dispatch notification", err);
    }
  }

  if (insertDispatch.data?.id && isOperatorPerformed) {
    throw redirect(path.to.maintenanceDetail(insertDispatch.data.id));
  }

  return data(
    { id: insertDispatch.data?.id },
    await flash(request, success("Maintenance dispatch created"))
  );
}
