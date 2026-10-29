// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import Money from "~/components/Money";
import type { LeaseJournalPreviewRow } from "./utils";

/** The journal a lifecycle action would post, before the user confirms.
 *  Rows with nothing on either side are left out. */
const LeaseJournalPreview = ({
  rows,
  currencyCode
}: {
  rows: LeaseJournalPreviewRow[];
  currencyCode: string | null | undefined;
}) => {
  const visible = rows.filter((row) => row.debit !== 0 || row.credit !== 0);
  if (visible.length === 0) return null;
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
    </Table>
  );
};

export default LeaseJournalPreview;
