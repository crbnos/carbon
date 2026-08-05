import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  ActiveWorkPanel,
  DisplayFrame,
  QueueTable
} from "~/components/Display";
import { userContext } from "~/context";
import {
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

  const { activeWork, queue, lastEventEndedAt } = await getWorkDisplayData(
    serviceRole,
    { workCenterId, companyId, locationId }
  );

  return { workCenter, activeWork, queue, lastEventEndedAt };
}

export default function WorkDisplayRoute() {
  const { t } = useLingui();
  const { workCenter, activeWork, queue, lastEventEndedAt } =
    useLoaderData<typeof loader>();

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
      <ActiveWorkPanel
        activeWork={activeWork}
        lastEventEndedAt={lastEventEndedAt}
      />
      <QueueTable rows={queue} />
    </DisplayFrame>
  );
}
