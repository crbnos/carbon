// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import { Hyperlink } from "~/components";
import { useDateFormatter } from "~/hooks";
import type { ProjectContractRevenue } from "~/modules/projects";
import { path } from "~/utils/path";
import { isProjectBillingMethod } from "../../sales.models";
import { useBillingMethodLabels } from "./ContractLineBillingFields";
import ContractMoney from "./ContractMoney";
import FundingBar, { type ContractLineFundingPosition } from "./FundingBar";
import type { ContractLine } from "./types";

export type ContractProjectBillingInvoice = {
  id: string;
  invoiceId: string;
  status: string;
  dateIssued: string | null;
  amount: number;
};

/**
 * The contract's Time & Materials and Cost Plus lines with their funding and
 * the revenue recognized for them, and the invoices that billed them, each
 * with its backup report. Shown only when the contract has a billing line.
 */
export default function ContractProjectBilling({
  contractId,
  lines,
  funding,
  invoices,
  revenue,
  currencyCode
}: {
  contractId: string;
  lines: ContractLine[];
  funding: Record<string, ContractLineFundingPosition>;
  invoices: ContractProjectBillingInvoice[];
  /** Revenue recognized per line (`getProjectContractRevenue`). */
  revenue: Record<string, ProjectContractRevenue>;
  currencyCode: string;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const billingLabels = useBillingMethodLabels();
  const billingLines = lines.filter((line) =>
    isProjectBillingMethod(line.billingMethod)
  );
  if (billingLines.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Project Billing</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Lines billed from project work, and the invoices that billed them.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          <Table>
            <Thead>
              <Tr>
                <Th className="w-full">
                  <Trans>Line</Trans>
                </Th>
                <Th>
                  <Trans>Method</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Billed</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Unbilled</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Funded</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Revenue Recognized</Trans>
                </Th>
                <Th className="min-w-32">
                  <Trans>Funding</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {billingLines.map((line) => {
                const position = funding[line.id] ?? {
                  billed: 0,
                  unbilled: 0,
                  incurred: 0
                };
                return (
                  <Tr key={line.id}>
                    <Td>
                      <Link
                        to={path.to.contractLineBilling(contractId, line.id)}
                        className="block truncate font-medium hover:underline"
                      >
                        {line.description || line.item?.name || line.itemId}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {billingLabels[line.billingMethod]}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={position.billed}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={position.unbilled}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={line.fundedAmount}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={revenue[line.id]?.recognizedToDate ?? 0}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td>
                      <FundingBar
                        position={position}
                        terms={line}
                        currencyCode={currencyCode}
                        compact
                      />
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>

          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No project billing invoices yet. The nightly billing run drafts
                one per billing period.
              </Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-full">
                    <Trans>Invoice</Trans>
                  </Th>
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Billed</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {invoices.map((invoice) => (
                  <Tr key={invoice.id}>
                    <Td>
                      <Hyperlink to={path.to.salesInvoiceDetails(invoice.id)}>
                        {invoice.invoiceId}
                      </Hyperlink>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {invoice.dateIssued
                        ? formatDate(invoice.dateIssued)
                        : "—"}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={invoice.amount}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={path.to.contractBillingBackup(
                          contractId,
                          invoice.id
                        )}
                        className="text-sm hover:underline"
                        aria-label={t`Backup for ${invoice.invoiceId}`}
                      >
                        <Trans>Backup</Trans>
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
