// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  STATUS_COLOR_HEX,
  type StatusColor,
  type StatusEntity,
  statusColor
} from "@carbon/utils/status-colors";
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  CircleX,
  Clock,
  type LucideIcon,
  Pause,
  Play,
  TriangleAlert
} from "lucide-react-native";
import { Text, View } from "react-native";

/**
 * A status as text AND colour AND shape.
 *
 * The colour comes from `@carbon/utils/status-colors`, which the web renders
 * from too, so the two apps cannot drift on what "In Progress" looks like. The
 * icon mirrors `apps/mes/app/components/Icons.tsx` `OperationStatusIcon`.
 *
 * Shape as well as colour because a shop floor is not a design review: tablets
 * sit under work lights, screens get glare, and roughly one man in twelve
 * cannot tell this red from this green.
 */

const BADGE_CLASSES: Record<StatusColor, string> = {
  green: "bg-emerald-500/15 border-emerald-500/40",
  orange: "bg-orange-500/15 border-orange-500/40",
  red: "bg-red-500/15 border-red-500/40",
  yellow: "bg-yellow-500/15 border-yellow-500/40",
  blue: "bg-blue-500/15 border-blue-500/40",
  gray: "bg-muted border-border",
  purple: "bg-violet-500/15 border-violet-500/40"
};

const TEXT_CLASSES: Record<StatusColor, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  orange: "text-orange-600 dark:text-orange-400",
  red: "text-red-600 dark:text-red-400",
  yellow: "text-yellow-700 dark:text-yellow-400",
  blue: "text-blue-600 dark:text-blue-400",
  gray: "text-muted-foreground",
  purple: "text-violet-600 dark:text-violet-400"
};

/**
 * Status to icon. The operation statuses match `OperationStatusIcon`; the rest
 * follow the same house reading — a dash for not started, a clock for waiting,
 * a tick for finished, a cross for dead.
 *
 * Every status this app can render needs an entry, because the icon is not
 * decoration: it is the second channel this component exists for, and a badge
 * that falls back to colour-and-text alone is exactly the case a glare-lit
 * tablet and a red-green-blind operator cannot read. Picking statuses were
 * missing when the picking screens landed, so Partial and Short — the two a
 * kitter most needs to tell apart — were colour-only.
 */
const STATUS_ICONS: Record<string, LucideIcon> = {
  // job
  Planned: CircleDashed,
  "Due Today": Clock,
  Closed: CircleCheck,
  Overdue: TriangleAlert,
  // jobOperation
  Todo: Circle,
  Waiting: Clock,
  Done: CircleCheck,
  Canceled: CircleX,
  // pickingList
  Draft: CircleDashed,
  Partial: TriangleAlert,
  // pickingListLine
  Pending: CircleDashed,
  Picked: CircleCheck,
  Short: TriangleAlert,
  // inspection (the lot) and its samples
  Passed: CircleCheck,
  Failed: CircleX,
  // trackedEntity
  Available: CircleCheck,
  Reserved: Clock,
  "On Hold": Pause,
  Rejected: Ban,
  Consumed: CircleCheck,
  Scrapped: Ban,
  // shared across the maps above
  Ready: CirclePlay,
  "In Progress": Play,
  Paused: Pause,
  Completed: CircleCheck,
  Cancelled: CircleX
};

export function StatusBadge({
  entity,
  status,
  className
}: {
  entity: StatusEntity;
  status: string | null | undefined;
  className?: string;
}) {
  if (!status) return null;
  const color: StatusColor = (status && statusColor(entity, status)) || "gray";
  const Icon = STATUS_ICONS[status];

  return (
    <View
      className={`flex-row items-center gap-2 self-start rounded-full border px-3 py-1.5 ${BADGE_CLASSES[color]} ${className ?? ""}`}
      accessibilityRole="text"
      accessibilityLabel={status}
    >
      {Icon ? <Icon size={16} color={STATUS_COLOR_HEX[color]} /> : null}
      <Text className={`text-base font-medium ${TEXT_CLASSES[color]}`}>
        {status}
      </Text>
    </View>
  );
}
