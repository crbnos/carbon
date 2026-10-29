// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { datetime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  ActiveWorkPanel,
  DeviceStateBadge,
  DisplayFrame,
  QueueTable
} from "~/components/Display";
import { userContext } from "~/context";
import {
  getDisplayDeviceState,
  getDisplayLoadedOperation,
  getDisplayWorkCenter,
  getWorkDisplayData
} from "~/services/display.service";
import type { WorkAlertReason } from "~/utils/display";
import { getWorkDisplayState } from "~/utils/display";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId not found");

  const serviceRole = getCarbonServiceRole();

  // Tenancy gate: proves the work center belongs to this company before any
  // other service-role read runs.
  const workCenter = await getDisplayWorkCenter(serviceRole, {
    workCenterId,
    companyId
  });
  if (!workCenter) throw notFound("Work center not found");

  // The work center's own location wins over the viewer's cookie — a display
  // hung on a machine shows that machine's queue regardless of who last set the
  // location on this browser.
  const locationId =
    workCenter.locationId ?? context.get(userContext)?.locationId;
  if (!locationId) throw notFound("Location not found");

  const [
    { activeWork, queue, lastEventEndedAt },
    loadedOperation,
    deviceState
  ] = await Promise.all([
    getWorkDisplayData(serviceRole, { workCenterId, companyId, locationId }),
    // The operation loaded on the machine (the last timer started here), and
    // the OEE device's live state when a device is mapped and its sync is
    // current.
    workCenter.loadedJobOperationId
      ? getDisplayLoadedOperation(serviceRole, {
          jobOperationId: workCenter.loadedJobOperationId,
          companyId
        })
      : null,
    getDisplayDeviceState(serviceRole, {
      workCenterId,
      companyId,
      now: datetime.timestamp()
    })
  ]);

  return {
    workCenter,
    activeWork,
    queue,
    lastEventEndedAt,
    loadedOperation,
    deviceState
  };
}

export default function WorkDisplayRoute() {
  const { t } = useLingui();
  const {
    workCenter,
    activeWork,
    queue,
    lastEventEndedAt,
    loadedOperation,
    deviceState
  } = useLoaderData<typeof loader>();

  const loadedLabel = loadedOperation
    ? [loadedOperation.jobReadableId, loadedOperation.description]
        .filter(Boolean)
        .join(" · ")
    : null;

  const state = getWorkDisplayState({
    activeEventCount: activeWork.length,
    isBlocked: workCenter.isBlocked
  });

  const alertLabels: Record<WorkAlertReason, string> = {
    blocked: workCenter.blockingDispatchReadableId
      ? t`Down for maintenance · ${workCenter.blockingDispatchReadableId}`
      : t`Down for maintenance`,
    idle: t`Nothing running`
  };

  return (
    <DisplayFrame
      workCenterName={workCenter.name}
      title={<Trans>Current work</Trans>}
      status={state.status}
      alertLabel={state.reasons.map((r) => alertLabels[r]).join(" · ")}
      okLabel={
        activeWork.length > 1 ? (
          <Trans>{activeWork.length} running</Trans>
        ) : (
          <Trans>Running</Trans>
        )
      }
      refreshInterval={15_000}
    >
      {loadedLabel || deviceState ? (
        <div
          className="flex min-w-0 items-center gap-[1vw] px-[2vw] pt-[1.5vw] text-white/70"
          style={{ fontSize: "clamp(0.8rem, 1.4vw, 1.6rem)" }}
        >
          {loadedLabel ? (
            <span className="truncate">
              <Trans>Loaded: {loadedLabel}</Trans>
            </span>
          ) : null}
          {deviceState ? <DeviceStateBadge state={deviceState} /> : null}
        </div>
      ) : null}
      <ActiveWorkPanel
        activeWork={activeWork}
        lastEventEndedAt={lastEventEndedAt}
      />
      <QueueTable rows={queue} />
    </DisplayFrame>
  );
}
