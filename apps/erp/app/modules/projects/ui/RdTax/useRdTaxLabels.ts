// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type {
  RdActivityRole,
  RdComponentType,
  RdSoftwareType
} from "../../projects.models";

/** The translated name of each research role (R&D tax). */
export function useRdActivityRoleLabels() {
  const { t } = useLingui();
  return useMemo<Record<RdActivityRole, string>>(
    () => ({
      "Direct Research": t`Direct Research`,
      "Direct Supervision": t`Direct Supervision`,
      "Direct Support": t`Direct Support`,
      "Not Qualified": t`Not Qualified`
    }),
    [t]
  );
}

/** The translated name of each business component type (Form 6765 49(d)). */
export function useRdComponentTypeLabels() {
  const { t } = useLingui();
  return useMemo<Record<RdComponentType, string>>(
    () => ({
      Product: t`Product`,
      Process: t`Process`,
      "All Others": t`All Others`
    }),
    [t]
  );
}

/** The translated name of each software type (Form 6765 49(e)). */
export function useRdSoftwareTypeLabels() {
  const { t } = useLingui();
  return useMemo<Record<RdSoftwareType, string>>(
    () => ({
      "Internal Use": t`Internal Use`,
      "Dual Function": t`Dual Function`,
      "Non-Internal Use": t`Non-Internal Use`,
      Excepted: t`Excepted`
    }),
    [t]
  );
}
