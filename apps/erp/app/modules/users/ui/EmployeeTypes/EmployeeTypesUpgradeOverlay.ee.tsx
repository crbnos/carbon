// Plan-gate overlay for Users → Configure → Employee Types. Mirrors
// `SalesRulesUpgradeOverlay`: shared overlay chrome via
// `~/components/RulesUpgradeOverlay`, with an employee-types preview table,
// mock fixtures, and copy specific to this feature.

import { Trans } from "@lingui/react/macro";
import RulesUpgradeOverlay from "~/components/RulesUpgradeOverlay";
import type { EmployeeType } from "~/modules/users";
import EmployeeTypesTable from "./EmployeeTypesTable.ee";

const mockEmployeeTypes: EmployeeType[] = [
  {
    id: "mock-1",
    name: "Administrator",
    companyId: "mock",
    protected: true,
    systemType: null,
    createdAt: "2026-05-04T10:00:00Z",
    updatedAt: null
  },
  {
    id: "mock-2",
    name: "Purchasing",
    companyId: "mock",
    protected: false,
    systemType: null,
    createdAt: "2026-04-29T14:22:00Z",
    updatedAt: null
  },
  {
    id: "mock-3",
    name: "Shop Floor",
    companyId: "mock",
    protected: false,
    systemType: null,
    createdAt: "2026-04-21T09:15:00Z",
    updatedAt: null
  }
];

export default function EmployeeTypesUpgradeOverlay() {
  return (
    <RulesUpgradeOverlay
      preview={
        <EmployeeTypesTable
          data={mockEmployeeTypes}
          count={mockEmployeeTypes.length}
        />
      }
      title={<Trans>Employee Types</Trans>}
      description={
        <Trans>
          Define custom roles with fine-grained, per-module permissions and
          assign them to your team.
        </Trans>
      }
    />
  );
}
