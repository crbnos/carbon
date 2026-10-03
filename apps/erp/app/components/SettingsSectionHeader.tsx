// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Subheading } from "@carbon/react";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Small uppercase label that groups related settings cards into a section.
 * Use it above a run of `<Card>`s on a settings page so related settings read
 * as one group (see the purchasing settings page for the reference layout).
 *
 * Thin wrapper around the standardized `Subheading` (light) that keeps the
 * settings-specific top margin.
 */
export default function SettingsSectionHeader({ children, className }: Props) {
  return (
    <Subheading variant="light" className={cn("mt-4", className)}>
      {children}
    </Subheading>
  );
}
