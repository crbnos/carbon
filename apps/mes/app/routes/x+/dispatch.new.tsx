import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { maintenanceDispatchValidator } from "~/services/models";
import { endProductionEventsByWorkCenter } from "~/services/operations.service";
import { path } from "~/utils/path";

const log = getLogger("mes");

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

  // The insert below is service-role, so every referenced id from the form
  // must belong to this company: one scoped query per id type. The work
  // center's location is read here too (it is stamped on the dispatch).
  const failureModeIds = [
    ...new Set(
      [
        validation.data.suspectedFailureModeId,
        validation.data.actualFailureModeId
      ].filter((id): id is string => Boolean(id))
    )
  ];
  const [workCenter, failureModes] = await Promise.all([
    serviceRole
      .from("workCenter")
      .select("locationId")
      .eq("id", validation.data.workCenterId)
      .eq("companyId", companyId)
      .maybeSingle(),
    failureModeIds.length
      ? serviceRole
          .from("maintenanceFailureMode")
          .select("id")
          .in("id", failureModeIds)
          .eq("companyId", companyId)
      : { data: [], error: null }
  ]);
  if (
    !workCenter.data ||
    failureModes.error ||
    (failureModes.data ?? []).length !== failureModeIds.length
  ) {
    log.warn("Dispatch references records outside the company", {
      companyId,
      workCenterId: validation.data.workCenterId,
      failureModeIds,
      error: workCenter.error ?? failureModes.error
    });
    return data(
      {},
      await flash(request, error(null, "Work center or failure mode not found"))
    );
  }
  const locationId = workCenter.data.locationId ?? undefined;

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

  const currentTime = datetime.timestamp();

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
      endTime: datetime.timestamp()
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
            .eq("companyId", companyId)
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
          await trigger("notify", {
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
      log.error("Failed to trigger maintenance dispatch notification", {
        error: err
      });
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
