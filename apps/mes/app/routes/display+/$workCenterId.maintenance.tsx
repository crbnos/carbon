import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  countTone,
  DisplayFrame,
  Scoreboard,
  ScoreboardRow
} from "~/components/Display";
import {
  getDisplayWorkCenter,
  getMaintenanceDisplayData
} from "~/services/display.service";
import type { MaintenanceAlertReason } from "~/utils/display";
import {
  getInitials,
  getMaintenanceDisplayState,
  getMaintenanceScoreboard
} from "~/utils/display";

export async function loader({ params, request }: LoaderFunctionArgs) {
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

  const [
    { dispatches, schedules, unplannedCost, lastCompleted },
    company,
    location
  ] = await Promise.all([
    getMaintenanceDisplayData(serviceRole, { workCenterId, companyId }),
    serviceRole
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .maybeSingle(),
    workCenter.locationId
      ? serviceRole
          .from("location")
          .select("timezone")
          .eq("id", workCenter.locationId)
          .eq("companyId", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  return {
    workCenter,
    dispatches,
    schedules,
    unplannedCost,
    lastCompleted,
    currencyCode: company.data?.baseCurrencyCode ?? "USD",
    timeZone: location.data?.timezone ?? null
  };
}

export default function MaintenanceDisplayRoute() {
  const { t } = useLingui();
  const {
    workCenter,
    dispatches,
    schedules,
    unplannedCost,
    lastCompleted,
    currencyCode,
    timeZone
  } = useLoaderData<typeof loader>();

  const state = getMaintenanceDisplayState(dispatches, schedules);
  const board = getMaintenanceScoreboard({
    dispatches,
    schedules,
    unplannedCost,
    lastCompleted,
    timeZone: timeZone ?? undefined
  });

  const alertLabels: Record<MaintenanceAlertReason, string> = {
    "unplanned-downtime": t`Unplanned downtime`,
    "planned-downtime": t`Down for planned maintenance`,
    "overdue-maintenance": t`Maintenance overdue`,
    "overdue-schedule": t`PM schedule lapsed`
  };

  const yesNo = (value: boolean) => (value ? t`Yes` : t`No`);

  return (
    <DisplayFrame
      workCenterName={workCenter.name}
      title={<Trans>Maintenance</Trans>}
      status={state.status}
      alertLabel={state.reasons.map((r) => alertLabels[r]).join(" · ")}
      okLabel={<Trans>All clear</Trans>}
      refreshInterval={30_000}
    >
      <Scoreboard>
        <ScoreboardRow
          question={<Trans>Overdue PMs?</Trans>}
          answer={yesNo(board.overdue.count > 0)}
          tone={countTone(board.overdue.count, "danger")}
          emphasis={board.overdue.count > 0}
          detailLabel={<Trans>How many?</Trans>}
          detailValue={board.overdue.count}
        />
        <ScoreboardRow
          question={<Trans>Due today?</Trans>}
          answer={yesNo(board.dueToday.count > 0)}
          tone={countTone(board.dueToday.count, "warn")}
          detailLabel={<Trans>How many?</Trans>}
          detailValue={board.dueToday.count}
        />
        <ScoreboardRow
          question={<Trans>Due in the next {board.dueSoon.days} days?</Trans>}
          answer={yesNo(board.dueSoon.count > 0)}
          tone={countTone(board.dueSoon.count, "warn")}
          detailLabel={<Trans>How many?</Trans>}
          detailValue={board.dueSoon.count}
        />
        <ScoreboardRow
          question={<Trans>Machine down for maintenance now?</Trans>}
          answer={yesNo(board.downNow.active)}
          tone={board.downNow.active ? "danger" : "neutral"}
          emphasis={board.downNow.active}
          detailWide
          detailValue={
            board.downNow.active ? (board.downNow.dispatchId ?? "—") : null
          }
        />
        <ScoreboardRow
          question={
            <Trans>
              Unplanned maintenance items, last {board.unplannedCount.days} days
            </Trans>
          }
          answer={board.unplannedCount.count}
          tone={countTone(board.unplannedCount.count, "warn")}
        />
        <ScoreboardRow
          question={
            <Trans>
              Cost of unplanned maintenance, last {board.unplannedCost.days}{" "}
              days
            </Trans>
          }
          answer={formatCurrency(board.unplannedCost.total, currencyCode)}
          tone={board.unplannedCost.total > 0 ? "warn" : "neutral"}
        />
        <ScoreboardRow
          question={<Trans>Last completed</Trans>}
          answer={formatDate(board.lastCompleted.completedAt) ?? "—"}
          detailLabel={<Trans>By?</Trans>}
          detailValue={getInitials(board.lastCompleted.by) ?? "—"}
        />
      </Scoreboard>
    </DisplayFrame>
  );
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(timestamp: string | null) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit"
  }).format(new Date(parsed));
}
