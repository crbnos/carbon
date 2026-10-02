// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { useLingui } from "@lingui/react/macro";
import { CalendarClock, TriangleAlert } from "lucide-react-native";
import { View } from "react-native";
import { BigNumber } from "~/components/BigNumber";
import { StatusBadge } from "~/components/StatusBadge";
import { Body, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";

/**
 * What the operator needs to know before touching anything, in the order web
 * MES's header shows it: the part, how far through it is, its status, where it
 * is being made and when it is due.
 *
 * The due date is formatted through `formatDate`, which parses the stored
 * `YYYY-MM-DD` as a calendar date rather than an instant. A `new Date(…)` here
 * would render the day BEFORE for any operator west of UTC — the exact bug
 * `.claude/rules/date-handling.md` was written about, and on a shop floor a
 * due date that is a day early is a job expedited for nothing.
 */
export function OperationHeader({
  detail,
  blockedReason
}: {
  detail: OperationDetail;
  /** The work center is blocked, or the operation is part of a batch. */
  blockedReason?: string;
}) {
  const { t, i18n } = useLingui();
  const colors = useThemeColors();
  const { operation, job } = detail;
  const locale = i18n.locale || "en";
  const due = operation.operationDueDate ?? job.dueDate;

  return (
    <View className="gap-3 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Body className="text-xl font-semibold">
            {operation.itemReadableId ?? t`Operation`}
          </Body>
          {operation.itemDescription ? (
            <Muted numberOfLines={2}>{operation.itemDescription}</Muted>
          ) : null}
        </View>
        <StatusBadge entity="jobOperation" status={operation.status} />
      </View>

      <View className="flex-row items-end justify-between gap-3">
        <BigNumber
          value={operation.quantityComplete ?? 0}
          of={operation.operationQuantity ?? 0}
        />
        <View className="items-end gap-1">
          {job.jobId ? <Muted className="text-sm">{job.jobId}</Muted> : null}
          {detail.workCenter?.data?.name ? (
            <Muted className="text-sm">{detail.workCenter.data.name}</Muted>
          ) : null}
        </View>
      </View>

      {due ? (
        <View className="flex-row items-center gap-2">
          <CalendarClock size={16} color={colors.mutedForeground} />
          <Muted className="text-sm">
            {t`Due ${formatDate(due.slice(0, 10), undefined, locale)}`}
          </Muted>
        </View>
      ) : null}

      {blockedReason ? (
        <View className="flex-row items-center gap-2 rounded-lg border border-border bg-muted p-3">
          <TriangleAlert size={18} color={colors.destructive} />
          <Muted className="flex-1 text-sm">{blockedReason}</Muted>
        </View>
      ) : null}
    </View>
  );
}
