// Plan-gate overlay for Settings → Approval Rules. Mirrors
// `SalesRulesUpgradeOverlay`: shared overlay chrome via
// `~/components/RulesUpgradeOverlay`, with an approval-rules preview, mock
// fixtures, and copy specific to this feature.

import type { ApprovalRule } from "@carbon/ee/approvals";
import { Trans } from "@lingui/react/macro";
import RulesUpgradeOverlay from "~/components/RulesUpgradeOverlay";
import ApprovalRules from "./ApprovalRules.ee";

const mockPoRules: (ApprovalRule & { approverGroupNames?: string[] })[] = [
  {
    id: "mock-1",
    companyId: "mock",
    documentType: "purchaseOrder",
    enabled: true,
    lowerBoundAmount: 5000,
    approverGroupIds: null,
    defaultApproverId: null,
    escalationDays: 2,
    createdAt: "2026-05-04T10:00:00Z",
    createdBy: "mock",
    updatedAt: null,
    updatedBy: null,
    approverGroupNames: ["Purchasing Managers"]
  },
  {
    id: "mock-2",
    companyId: "mock",
    documentType: "purchaseOrder",
    enabled: true,
    lowerBoundAmount: 25000,
    approverGroupIds: null,
    defaultApproverId: null,
    escalationDays: 3,
    createdAt: "2026-04-29T14:22:00Z",
    createdBy: "mock",
    updatedAt: null,
    updatedBy: null,
    approverGroupNames: ["Finance", "Executives"]
  }
];

export default function ApprovalRulesUpgradeOverlay() {
  return (
    <RulesUpgradeOverlay
      preview={
        <ApprovalRules poRules={mockPoRules} qdRules={[]} supplierRules={[]} />
      }
      title={<Trans>Approval Rules</Trans>}
      description={
        <Trans>
          Require tiered sign-off on purchase orders, quality documents, and
          suppliers based on amount thresholds and approver groups.
        </Trans>
      }
    />
  );
}
