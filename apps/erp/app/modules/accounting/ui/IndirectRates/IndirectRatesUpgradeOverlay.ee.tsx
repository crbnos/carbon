// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Plan-gate overlay for Accounting → Indirect Pools and Indirect Rates
// (GOVERNMENT_CONTRACTING). Shares the overlay chrome with the rule families
// via `~/components/RulesUpgradeOverlay`; only the preview and the copy are
// specific to indirect rates.

import type { IndirectPool } from "@carbon/ee/indirect-rates";
import { Trans } from "@lingui/react/macro";
import RulesUpgradeOverlay from "~/components/RulesUpgradeOverlay";
import IndirectPoolsTable from "./IndirectPoolsTable.ee";

const mockPool = {
  companyId: "mock",
  appliedAccountId: null,
  appliesToProjects: true,
  offsetAbsorbedOverhead: false,
  active: true,
  createdBy: "mock",
  createdAt: "2026-01-01T00:00:00Z",
  updatedBy: null,
  updatedAt: null
};

const mockPools: IndirectPool[] = [
  {
    ...mockPool,
    id: "mock-1",
    name: "Fringe",
    poolType: "Fringe",
    sequence: 1,
    baseType: "Total Labor Dollars"
  },
  {
    ...mockPool,
    id: "mock-2",
    name: "Overhead",
    poolType: "Overhead",
    sequence: 2,
    baseType: "Direct Labor Dollars"
  },
  {
    ...mockPool,
    id: "mock-3",
    name: "G&A",
    poolType: "G&A",
    sequence: 3,
    baseType: "Total Cost Input"
  }
];

export default function IndirectRatesUpgradeOverlay() {
  return (
    <RulesUpgradeOverlay
      preview={<IndirectPoolsTable data={mockPools} count={mockPools.length} />}
      title={<Trans>Indirect rates</Trans>}
      description={
        <Trans>
          Compute fringe, overhead and G&A rates, burden your projects and bill
          at provisional rates.
        </Trans>
      }
    />
  );
}
