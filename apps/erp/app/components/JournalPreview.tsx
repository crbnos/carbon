// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Table, Tbody, Td, Tfoot, Th, Thead, Tr } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import Money from "~/components/Money";

export type JournalPreviewRow = {
  account: string;
  debit: number;
  credit: number;
};

/** A journal before it posts: one row per account and side, as an Account /
 *  Debit / Credit table. Rows with nothing on either side are left out.
 *  `total` adds a row with the sums of both sides. */
const JournalPreview = ({
  rows,
  currencyCode,
  total = false
}: {
  rows: JournalPreviewRow[];
  currencyCode: string | null | undefined;
  total?: boolean;
}) => {
  const visible = rows.filter((row) => row.debit !== 0 || row.credit !== 0);
  if (visible.length === 0) return null;
  const debitTotal = visible.reduce((sum, row) => sum + row.debit, 0);
  const creditTotal = visible.reduce((sum, row) => sum + row.credit, 0);
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Account</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Debit</Trans>
          </Th>
          <Th className="text-right">
            <Trans>Credit</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {visible.map((row, index) => (
          // Two rows can name the same account (a purchase both relieves
          // and adds to the lease liability), so the index keys them.
          <Tr key={index}>
            <Td>{row.account}</Td>
            <Td className="text-right">
              {row.debit !== 0 && (
                <Money value={row.debit} currencyCode={currencyCode} />
              )}
            </Td>
            <Td className="text-right">
              {row.credit !== 0 && (
                <Money value={row.credit} currencyCode={currencyCode} />
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
      {total && (
        <Tfoot>
          <Tr>
            <Th>
              <Trans>Total</Trans>
            </Th>
            <Th className="text-right">
              <Money value={debitTotal} currencyCode={currencyCode} />
            </Th>
            <Th className="text-right">
              <Money value={creditTotal} currencyCode={currencyCode} />
            </Th>
          </Tr>
        </Tfoot>
      )}
    </Table>
  );
};

export default JournalPreview;
