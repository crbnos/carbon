// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyScreen } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { BigNumber } from "~/components/BigNumber";
import { Card, Muted } from "~/components/ui";
import { formatDuration } from "~/features/operations/duration";
import type { OpenEvents, WorkType } from "~/features/operations/logic";
import { closedDurations } from "~/features/operations/logic";
import { isOverdue } from "~/features/operations/OperationHeader";
import { elapsedSince } from "~/features/operations/useTimer";

/**
 * Web's left sidebar — PROGRESS and STATUS — plus the right one's parameters
 * and quality issues, as one scrolling page.
 *
 * Progress is time spent against time planned, per kind of time, exactly as
 * web lays it out: closed events at the duration the server stored, plus the
 * running one live. A planned figure of zero is shown only when time has been
 * spent against it, so a labour-only operation does not list an empty Setup.
 */
export function AssemblyDetails({
  screen,
  openEvents
}: {
  screen: AssemblyScreen;
  openEvents: OpenEvents;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const { operation, job } = screen;

  const spent = closedDurations(screen.events);
  const rows: { type: WorkType; label: string; planned: number }[] = [
    { type: "Setup", label: t`Setup`, planned: operation.setupDuration ?? 0 },
    { type: "Labor", label: t`Labor`, planned: operation.laborDuration ?? 0 },
    {
      type: "Machine",
      label: t`Machine`,
      planned: operation.machineDuration ?? 0
    }
  ];
  const progress = rows
    .map((row) => {
      const open = openEvents[row.type];
      const actual =
        spent[row.type] + (open?.startTime ? elapsedSince(open.startTime) : 0);
      return { ...row, actual };
    })
    .filter((row) => row.planned > 0 || row.actual > 0);

  const due = operation.operationDueDate ?? job.dueDate ?? null;
  const deadlineType = operation.jobDeadlineType ?? job.deadlineType ?? null;
  const overdue = isOverdue(due, deadlineType);
  const deadline =
    deadlineType === "ASAP" || deadlineType === "No Deadline"
      ? deadlineType
      : due
        ? formatDate(due.slice(0, 10), undefined, locale)
        : null;
  const planned =
    (operation.setupDuration ?? 0) +
    ((operation.laborDuration ?? 0) > (operation.machineDuration ?? 0)
      ? (operation.laborDuration ?? 0)
      : (operation.machineDuration ?? 0));
  const scrapped = operation.quantityScrapped ?? 0;
  const reworked = operation.quantityReworked ?? 0;
  const quantity = (value: number) => formatQuantity(value, locale);

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-4 pb-8 pt-3"
    >
      <Section title={t`Progress`}>
        <BigNumber
          value={operation.quantityComplete ?? 0}
          of={operation.operationQuantity ?? null}
        />
        {scrapped > 0 || reworked > 0 ? (
          <Muted className="text-sm">
            {[
              scrapped > 0 ? t`${quantity(scrapped)} scrapped` : null,
              reworked > 0 ? t`${quantity(reworked)} reworked` : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </Muted>
        ) : null}
        {progress.map((row) => (
          <Fact
            key={row.type}
            label={row.label}
            value={`${formatDuration(row.actual) ?? "0s"} / ${
              formatDuration(row.planned) ?? "–"
            }`}
          />
        ))}
      </Section>

      <Section title={t`Status`}>
        <Fact label={t`Job`} value={job.jobId ?? operation.jobReadableId} />
        <Fact label={t`Operation`} value={operation.description} />
        <Fact label={t`Status`} value={operation.operationStatus} />
        <Fact label={t`Duration`} value={formatDuration(planned)} />
        <Fact
          label={t`Deadline`}
          value={deadline}
          tone={overdue ? "bad" : undefined}
        />
        <Fact label={t`Customer`} value={job.customer?.name} />
        <Fact label={t`Sales order`} value={job.salesOrderReadableId} />
        <Fact label={t`Work center`} value={screen.workCenter?.name} />
      </Section>

      <Section title={t`Product`}>
        <Fact
          label={t`Item`}
          value={job.itemReadableIdWithRevision ?? operation.itemReadableId}
        />
        <Fact
          label={t`Description`}
          value={operation.itemDescription ?? job.name}
        />
      </Section>

      {screen.procedure.parameters.length ? (
        <Section title={t`Parameters`}>
          {screen.procedure.parameters.map((parameter) => (
            <Fact
              key={parameter.id}
              label={parameter.key}
              value={parameter.value}
            />
          ))}
        </Section>
      ) : null}

      {screen.ncrs.length ? (
        <Section title={t`Quality issues`}>
          {screen.ncrs.map((ncr) => (
            <Fact
              key={ncr.nonConformanceId}
              label={
                ncr.nonConformance?.nonConformanceId ?? ncr.nonConformanceId
              }
              value={ncr.nonConformance?.status}
            />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-3">
      <Text className="text-sm font-semibold uppercase text-muted-foreground">
        {title}
      </Text>
      {children}
    </Card>
  );
}

/** One label and its value on a line. Nothing renders for a missing value. */
function Fact({
  label,
  value,
  tone
}: {
  label: string;
  value: string | null | undefined;
  tone?: "bad";
}) {
  if (!value) return null;
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Muted className="text-sm">{label}</Muted>
      <Text
        className={`shrink text-right text-sm font-medium ${
          tone === "bad" ? "text-red-600 dark:text-red-400" : "text-foreground"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}
