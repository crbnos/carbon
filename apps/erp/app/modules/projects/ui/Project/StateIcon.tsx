// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ProjectStateGroup } from "../../projects.models";

type StateIconProps = {
  group: ProjectStateGroup;
  color: string;
  className?: string;
};

/**
 * The icon of a project state, drawn in the state's color. Each group has
 * its own shape: a dashed ring (Backlog), a ring (Unstarted), a half-filled
 * ring (Started), a filled check (Completed) and a filled cross (Cancelled).
 * The ring and the half fill follow TodoStatusIcon and InProgressStatusIcon.
 */
export function StateIcon({ group, color, className }: StateIconProps) {
  switch (group) {
    case "Backlog":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={className}
          aria-hidden
        >
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        </svg>
      );
    case "Unstarted":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={className}
          aria-hidden
        >
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke={color}
            strokeWidth="2"
          />
        </svg>
      );
    case "Started":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={className}
          aria-hidden
        >
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke={color}
            strokeWidth="2"
          />
          <circle
            cx="7"
            cy="7"
            r="2"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray="6.2517693806436885 100"
            transform="rotate(-90 7 7)"
          />
        </svg>
      );
    case "Completed":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={className}
          aria-hidden
        >
          <circle cx="7" cy="7" r="7" fill={color} />
          <path
            d="M4 7.2 6.1 9.2 10 5"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "Cancelled":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={className}
          aria-hidden
        >
          <circle cx="7" cy="7" r="7" fill={color} />
          <path
            d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

export default StateIcon;
