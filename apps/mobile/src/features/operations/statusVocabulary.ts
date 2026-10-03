// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Circle,
  CircleCheck,
  CircleX,
  type LucideIcon,
  Pause,
  Play
} from "lucide-react-native";

/**
 * One status vocabulary for the whole app.
 *
 * A port of `OperationStatusIcon` from `apps/mes/app/components/Icons.tsx`,
 * living here rather than in a screen because the board card and the operation
 * header both render it. Two copies drifted apart would mean a card saying one
 * thing and the screen it opens saying another — which an operator would read
 * as the app being wrong about their job, not as a styling slip.
 *
 * The hues are hardcoded on purpose. They are SEMANTIC — blue is ready, green
 * is done, red is dead — not theme tokens, so they must not change with the
 * light/dark preference; the same red has to mean the same thing on a
 * night-shift tablet.
 */

export type StatusTone = "foreground" | "blue" | "red" | "green" | "orange";

export function statusIcon(status: string | null | undefined): {
  Icon: LucideIcon;
  tone: StatusTone;
} {
  switch (status) {
    case "Ready":
      return { Icon: Circle, tone: "blue" };
    case "Waiting":
    case "Canceled":
    case "Cancelled":
      return { Icon: CircleX, tone: "red" };
    case "Done":
      return { Icon: CircleCheck, tone: "green" };
    case "In Progress":
      return { Icon: Play, tone: "orange" };
    case "Paused":
      return { Icon: Pause, tone: "orange" };
    default:
      return { Icon: Circle, tone: "foreground" };
  }
}

/** The one red in this app: an overdue deadline and a dead status share it. */
export const OVERDUE_COLOR = "#dc2626";

export function statusColorFor(tone: StatusTone, foreground: string) {
  switch (tone) {
    case "blue":
      return "#2563eb";
    case "red":
      return OVERDUE_COLOR;
    case "green":
      return "#16a34a";
    case "orange":
      return "#ea580c";
    default:
      return foreground;
  }
}
