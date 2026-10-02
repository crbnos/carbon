// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail, ProductionEvent } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { ScrollView, View } from "react-native";
import { StatusBadge } from "~/components/StatusBadge";
import { Body, Card, Muted } from "~/components/ui";
import {
  closedDurations,
  type OpenEvents,
  WORK_TYPES,
  type WorkType
} from "./logic";
import { formatElapsed, useTimer } from "./useTimer";

/**
 * The Details tab: time, quantities, and the job the operation belongs to — in
 * web MES's own order so the two screens read the same.
 *
 * Time is shown as elapsed AGAINST planned, never elapsed alone. "01:22:40" is
 * a number; "01:22:40 of 02:00:00" tells the operator whether they are ahead,
 * which is the decision they are actually making.
 */

function Row({
  label,
  value,
  muted = false
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View className="min-h-[44px] flex-row items-center justify-between gap-4">
      <Muted className="text-sm">{label}</Muted>
      <Body className={muted ? "text-muted-foreground" : "font-medium"}>
        {value}
      </Body>
    </View>
  );
}

function TimeRow({
  label,
  planned,
  openEvent,
  closedTotal
}: {
  label: string;
  planned: number;
  openEvent: ProductionEvent | undefined;
  /** Milliseconds already banked by this type's closed events. */
  closedTotal: number;
}) {
  const live = useTimer(openEvent);
  const elapsed = closedTotal + (live ?? 0);
  return (
    <Row
      label={label}
      value={`${formatElapsed(elapsed)} / ${formatElapsed(planned)}`}
    />
  );
}

export function DetailsTab({
  detail,
  openEvents
}: {
  detail: OperationDetail;
  openEvents: OpenEvents;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const { operation, job, quantities } = detail;
  const closed = closedDurations(detail.events);

  const planned: Record<WorkType, number> = {
    Setup: operation.setupDuration ?? 0,
    Labor: operation.laborDuration ?? 0,
    Machine: operation.machineDuration ?? 0
  };
  const types = WORK_TYPES.filter(
    (type) => planned[type] > 0 || closed[type] > 0 || openEvents[type]
  );

  const quantity = (value: number) => formatQuantity(value, locale);

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-4 pb-8 pt-2"
    >
      {types.length ? (
        <Card className="gap-1">
          <Muted className="pb-1 text-sm font-semibold">{t`Time`}</Muted>
          {types.map((type) => (
            <TimeRow
              key={type}
              label={
                type === "Setup"
                  ? t`Setup`
                  : type === "Labor"
                    ? t`Labor`
                    : t`Machine`
              }
              planned={planned[type]}
              openEvent={openEvents[type]}
              closedTotal={closed[type]}
            />
          ))}
        </Card>
      ) : null}

      <Card className="gap-1">
        <Muted className="pb-1 text-sm font-semibold">{t`Quantities`}</Muted>
        <Row
          label={t`Completed`}
          value={`${quantity(operation.quantityComplete ?? 0)} / ${quantity(
            operation.operationQuantity ?? 0
          )}`}
        />
        <Row
          label={t`Scrapped`}
          value={quantity(operation.quantityScrapped ?? quantities.scrap)}
          muted={(operation.quantityScrapped ?? quantities.scrap) === 0}
        />
        <Row
          label={t`Reworked`}
          value={quantity(operation.quantityReworked ?? quantities.rework)}
          muted={(operation.quantityReworked ?? quantities.rework) === 0}
        />
      </Card>

      <Card className="gap-1">
        <Muted className="pb-1 text-sm font-semibold">{t`Job`}</Muted>
        {job.jobId ? <Row label={t`Job`} value={job.jobId} /> : null}
        {job.customerId ? (
          <Row label={t`Customer`} value={job.customerId} />
        ) : null}
        {job.status ? (
          <View className="min-h-[44px] flex-row items-center justify-between gap-4">
            <Muted className="text-sm">{t`Job status`}</Muted>
            <StatusBadge entity="job" status={job.status} />
          </View>
        ) : null}
        {detail.workCenter?.data?.name ? (
          <Row label={t`Work center`} value={detail.workCenter.data.name} />
        ) : null}
      </Card>
    </ScrollView>
  );
}
