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
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";
import { Empty } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, useDateFormatter } from "~/hooks";
import type { MemoApplication } from "~/modules/invoicing";
import { path } from "~/utils/path";

type MemoApplicationsPanelProps = {
  rows: MemoApplication[];
  // Applied amounts are in the memo's source currency.
  currencyCode: string;
};

const TARGET_LABEL: Record<MemoApplication["target"]["type"], string> = {
  salesInvoice: "Sales Invoice",
  purchaseInvoice: "Purchase Invoice",
  memo: "Memo"
};

function targetPath(target: MemoApplication["target"]): string {
  switch (target.type) {
    case "salesInvoice":
      return path.to.salesInvoice(target.id);
    case "purchaseInvoice":
      return path.to.purchaseInvoice(target.id);
    case "memo":
      return path.to.memo(target.id);
  }
}

// Where this credit/debit memo's balance went — the invoices (and memos) it has
// been applied to. The reverse of the invoice "Payments" panel.
const MemoApplicationsPanel = ({
  rows,
  currencyCode
}: MemoApplicationsPanelProps) => {
  const { formatDate } = useDateFormatter();
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Applied To</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Invoices this memo has been applied to. Click a row to open the
            document.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Date</Trans>
                </Th>
                <Th>
                  <Trans>Type</Trans>
                </Th>
                <Th>
                  <Trans>Document</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Applied</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDate(r.appliedDate)}</Td>
                  <Td>
                    <Enumerable value={TARGET_LABEL[r.target.type]} />
                  </Td>
                  <Td>
                    <Link
                      to={targetPath(r.target)}
                      className="text-primary hover:underline"
                    >
                      {r.target.readableId}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(r.appliedAmount))}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default MemoApplicationsPanel;
