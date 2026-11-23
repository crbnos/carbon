// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { SERVICE_COVERAGE_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ServiceCoverage } from "../../service.models";

export function useCoverageLabels(): Record<ServiceCoverage, string> {
  const { t } = useLingui();
  return {
    Billable: t`Billable`,
    Warranty: t`Warranty`,
    Contract: t`Contract`
  };
}

/** Who pays for a service job: the customer, the warranty, or a contract. */
function CoverageBadge({
  coverage,
  className
}: {
  coverage?: ServiceCoverage | null;
  className?: string;
}) {
  const labels = useCoverageLabels();
  if (!coverage) return null;
  return (
    <Badge variant={SERVICE_COVERAGE_COLOR_MAP[coverage]} className={className}>
      {labels[coverage]}
    </Badge>
  );
}

export default CoverageBadge;
