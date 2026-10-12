// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LabelWithHelp, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import { useCurrencyFormatter, useUser } from "~/hooks";
import { usePercentFormatter } from "~/hooks/usePercentFormatter";
import { FundingBar } from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";
import type { ProjectContractRevenue } from "../../projects.service";
import type { ContractBillingLine } from "../../types";

type Position = { billed: number; unbilled: number; incurred: number };

/**
 * A project's contract billing lines: the contract, the line, its billing
 * element, method and funding, and with `revenue` the percent complete and
 * the revenue recognized to date. A Right to Invoice line has no percent
 * complete.
 */
export default function ProjectBillingLines({
  lines,
  funding,
  revenue
}: {
  lines: ContractBillingLine[];
  funding: Record<string, Position>;
  /** Progress and revenue to date per line (`getProjectContractRevenue`). */
  revenue?: Record<string, ProjectContractRevenue>;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  // Billing lines need the contract currency to be the base currency (P5).
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const formatMoney = useCurrencyFormatter({ currency: currencyCode });
  const formatPercent = usePercentFormatter();
  // A Right to Invoice line has no progress: it recognizes what it bills.
  const formatProgress = (line: ContractBillingLine) => {
    const progress = revenue?.[line.id]?.percentComplete ?? null;
    return line.revenueMethod === "Percent Complete" && progress !== null
      ? formatPercent.format(progress)
      : "—";
  };
  const methodLabels: Record<ContractBillingLine["billingMethod"], string> = {
    Fixed: t`Fixed`,
    "Time & Materials": t`Time & Materials`,
    "Cost Plus": t`Cost Plus`
  };

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>
          No contract bills this project. A Time & Materials or Cost Plus
          contract line names a billing element of it.
        </Trans>
      </p>
    );
  }

  return (
    <div className="min-h-0 overflow-auto rounded-md border border-border">
      <Table full>
        <Thead>
          <Tr>
            <Th>
              <Trans>Contract</Trans>
            </Th>
            <Th>
              <Trans>Line</Trans>
            </Th>
            <Th>
              <LabelWithHelp termId="billing-element" variant="inline">
                <Trans>Billing Element</Trans>
              </LabelWithHelp>
            </Th>
            <Th>
              <LabelWithHelp termId="billing-method" variant="inline">
                <Trans>Method</Trans>
              </LabelWithHelp>
            </Th>
            <Th className="min-w-40">
              <Trans>Funding</Trans>
            </Th>
            {revenue && (
              <Th className="text-right">
                <Trans>Percent Complete</Trans>
              </Th>
            )}
            {revenue && (
              <Th className="text-right">
                <Trans>Revenue Recognized</Trans>
              </Th>
            )}
          </Tr>
        </Thead>
        <Tbody>
          {lines.map((line) => (
            <Tr key={line.id}>
              <Td className="whitespace-nowrap">
                {line.contract ? (
                  <Hyperlink to={path.to.contractDetails(line.contract.id)}>
                    {line.contract.customerContractId}
                  </Hyperlink>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Hyperlink
                  to={path.to.contractLineBilling(
                    line.customerContractId,
                    line.id
                  )}
                >
                  {line.description || line.item?.name || line.id}
                </Hyperlink>
              </Td>
              <Td>
                {line.element ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 whitespace-nowrap font-medium">
                      {line.element.readableId}
                    </span>
                    <span className="truncate">{line.element.name}</span>
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {methodLabels[line.billingMethod]}
              </Td>
              <Td>
                <FundingBar
                  position={
                    funding[line.id] ?? { billed: 0, unbilled: 0, incurred: 0 }
                  }
                  terms={line}
                  currencyCode={currencyCode}
                  compact
                />
              </Td>
              {revenue && (
                <Td className="text-right tabular-nums">
                  {formatProgress(line)}
                </Td>
              )}
              {revenue && (
                <Td className="text-right tabular-nums">
                  {formatMoney.format(revenue[line.id]?.recognizedToDate ?? 0)}
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
