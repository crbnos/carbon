// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import { useCurrencyFormatter, useUser } from "~/hooks";
import { FundingBar } from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";
import type { ContractBillingLine } from "../../types";

type Position = { billed: number; unbilled: number; incurred: number };

/**
 * A project's contract billing lines: the contract, the line, its billing
 * element, method and funding. Phase 4b adds the percent complete and the
 * revenue recognized to date through `revenue`.
 */
export default function ProjectBillingLines({
  lines,
  funding,
  revenue
}: {
  lines: ContractBillingLine[];
  funding: Record<string, Position>;
  /** Phase 4b: progress and revenue to date per line. */
  revenue?: Record<
    string,
    { percentComplete: number | null; recognizedToDate: number }
  >;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  // Billing lines need the contract currency to be the base currency (P5).
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const formatMoney = useCurrencyFormatter({ currency: currencyCode });
  const methodLabels: Record<ContractBillingLine["billingMethod"], string> = {
    Fixed: t`Fixed`,
    "Time & Materials": t`Time & Materials`,
    "Cost Plus": t`Cost Plus`
  };

  if (lines.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
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
              <Trans>Billing Element</Trans>
            </Th>
            <Th>
              <Trans>Method</Trans>
            </Th>
            <Th className="min-w-40">
              <Trans>Funding</Trans>
            </Th>
            {revenue && (
              <Th className="text-right">
                <Trans>Recognized</Trans>
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
                  {revenue[line.id]
                    ? formatMoney.format(revenue[line.id].recognizedToDate)
                    : "—"}
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
