// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ServiceCoverage } from "../../service.models";

const COVERAGE_VARIANT: Record<
  ServiceCoverage,
  "blue" | "purple" | "green" | "gray"
> = {
  Warranty: "blue",
  Contract: "purple",
  Billable: "green",
  Capitalized: "gray"
};

export function useCoverageLabels(): Record<ServiceCoverage, string> {
  const { t } = useLingui();
  return {
    Warranty: t`Warranty`,
    Contract: t`Contract`,
    Billable: t`Billable`,
    Capitalized: t`Capitalized`
  };
}

/** Who pays for a charge: the warranty, a contract, the customer, or us. */
export function CoveragePill({ coverage }: { coverage: ServiceCoverage }) {
  const labels = useCoverageLabels();
  return <Badge variant={COVERAGE_VARIANT[coverage]}>{labels[coverage]}</Badge>;
}
