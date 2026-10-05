// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OpenJob } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { Hash, Package, User } from "lucide-react-native";
import { Text, View } from "react-native";
import { StatusBadge } from "~/components/StatusBadge";
import { Card, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";

/**
 * One open job, as a card rather than a table row.
 *
 * Web lists jobs in an eight-column table. A table is the wrong shape on a
 * tablet held at a machine — eight columns at a legible size is wider than
 * the screen, and the horizontal scroll that follows means an operator loses
 * the job number while reading the due date. The card keeps the two things
 * that identify a job (its number and the part) on one line and lets the
 * rest wrap.
 *
 * It is NOT pressable. Web's job number links to the job DAG, which has no
 * mobile screen; a card that highlights on touch and then does nothing is
 * worse than one that plainly does not respond.
 */
export function JobCard({
  job,
  trackingId
}: {
  job: OpenJob;
  /** The serial or batch number this job is building, if it is tracked. */
  trackingId: string | null;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Muted className="text-xs">{job.itemReadableIdWithRevision}</Muted>
          <Text className="text-base font-semibold text-foreground">
            {job.jobId}
          </Text>
          {job.name ? (
            <Muted className="text-sm" numberOfLines={2}>
              {job.name}
            </Muted>
          ) : null}
        </View>
        {/* `job`, not `jobOperation`: these are jobs, and the two maps
            disagree — a job is Planned/Ready/Completed where an operation is
            Waiting/In Progress/Done. */}
        {job.status ? <StatusBadge entity="job" status={job.status} /> : null}
      </View>

      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        <Fact
          icon={<Package size={14} color={colors.mutedForeground} />}
          label={t`Quantity`}
          value={`${job.quantityComplete ?? 0} / ${job.quantity ?? 0}`}
        />
        {trackingId ? (
          <Fact
            icon={<Hash size={14} color={colors.mutedForeground} />}
            label={t`Tracking`}
            value={trackingId}
          />
        ) : null}
        {job.assignee ? (
          <Fact
            icon={<User size={14} color={colors.mutedForeground} />}
            label={t`Assignee`}
            value={job.assignee}
          />
        ) : null}
      </View>
    </Card>
  );
}

function Fact({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View
      className="flex-row items-center gap-1.5"
      accessibilityLabel={`${label}: ${value}`}
    >
      {icon}
      <Text className="text-sm text-muted-foreground">{value}</Text>
    </View>
  );
}
