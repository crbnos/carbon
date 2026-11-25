// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Table, Tbody, Td, Tfoot, Th, Thead, Tr } from "@carbon/react";
import type { RentalInvoiceLineValues } from "@carbon/utils";
import { formatPercent } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import RentalMoney from "./RentalMoney";

type RentalInvoiceLinesTableProps = {
  lines: RentalInvoiceLineValues[];
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  currencyCode: string | null;
};

/** A rental invoice before it is saved: its lines, then Subtotal, Tax and
 *  Total. Shared by the Next Invoice card and the Invoice dialog. */
const RentalInvoiceLinesTable = ({
  lines,
  subtotal,
  totalTax,
  totalAmount,
  currencyCode
}: RentalInvoiceLinesTableProps) => {
  const { locale } = useLocale();

  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Description</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Tax</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Amount</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {lines.map((line) => (
          <Tr key={line.rentalBillingPeriodId ?? line.rentalAgreementChargeId}>
            <Td>{line.description}</Td>
            <Td className="text-right tabular-nums">
              {formatPercent(line.taxPercent, locale)}
            </Td>
            <Td className="text-right">
              <RentalMoney value={line.unitPrice} currencyCode={currencyCode} />
            </Td>
          </Tr>
        ))}
      </Tbody>
      <Tfoot>
        <Tr>
          <Td colSpan={2}>
            <Trans>Subtotal</Trans>
          </Td>
          <Td className="text-right">
            <RentalMoney value={subtotal} currencyCode={currencyCode} />
          </Td>
        </Tr>
        <Tr>
          <Td colSpan={2}>
            <Trans>Tax</Trans>
          </Td>
          <Td className="text-right">
            <RentalMoney value={totalTax} currencyCode={currencyCode} />
          </Td>
        </Tr>
        <Tr>
          <Td colSpan={2} className="font-medium">
            <Trans>Total</Trans>
          </Td>
          <Td className="text-right font-medium">
            <RentalMoney value={totalAmount} currencyCode={currencyCode} />
          </Td>
        </Tr>
      </Tfoot>
    </Table>
  );
};

export default RentalInvoiceLinesTable;
