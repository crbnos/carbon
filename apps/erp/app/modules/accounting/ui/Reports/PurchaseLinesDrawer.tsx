import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Spinner,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import type { PurchaseLinePivotLine } from "../../types";

// The drill-through RPC caps results at 500 lines; surface the cap when hit.
const LINE_LIMIT = 500;

type PurchaseLinesDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: PurchaseLinePivotLine[] | null;
  isLoading: boolean;
};

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Presentational drill-through drawer for one Purchases pivot cell — mirrors
 * PivotLinesDrawer but with purchase-invoice columns (invoice / supplier /
 * item) instead of the journal columns. The route owns the fetcher.
 */
const PurchaseLinesDrawer = ({
  open,
  onClose,
  title,
  lines,
  isLoading
}: PurchaseLinesDrawerProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();

  const totals = useMemo(
    () =>
      (lines ?? []).reduce(
        (acc, line) => {
          acc.amount += line.amount;
          acc.quantity += line.quantity;
          return acc;
        },
        { amount: 0, quantity: 0 }
      ),
    [lines]
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0">
          {isLoading ? (
            <div className="flex w-full items-center justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : !lines || lines.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Trans>No purchases in this period</Trans>
            </div>
          ) : (
            <>
              {lines.length === LINE_LIMIT && (
                <div className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
                  {t`Showing the first 500 lines`}
                </div>
              )}
              <Table>
                <Thead>
                  <Tr>
                    <Th className="px-4">
                      <Trans>Date</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Invoice</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Supplier</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Item</Trans>
                    </Th>
                    <Th className="px-4 w-full">
                      <Trans>Description</Trans>
                    </Th>
                    <Th className="px-4 text-right">
                      <Trans>Amount</Trans>
                    </Th>
                    <Th className="px-4 text-right">
                      <Trans>Quantity</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lines.map((line) => (
                    <Tr key={line.id} className="hover:bg-muted/50">
                      <Td className="px-4 whitespace-nowrap text-muted-foreground">
                        {formatDate(line.postingDate, undefined, locale)}
                      </Td>
                      <Td className="px-4 whitespace-nowrap font-mono text-xs">
                        {line.invoiceReadableId}
                      </Td>
                      <Td className="px-4 whitespace-nowrap">
                        <span className="line-clamp-1">
                          {line.supplierName || "–"}
                        </span>
                      </Td>
                      <Td className="px-4 whitespace-nowrap font-mono text-xs">
                        {line.itemReadableId || "–"}
                      </Td>
                      <Td className="px-4">
                        <p className="line-clamp-1">
                          {line.description || "–"}
                        </p>
                      </Td>
                      <Td className="px-4 text-right tabular-nums">
                        {formatAmount(line.amount)}
                      </Td>
                      <Td className="px-4 text-right tabular-nums">
                        {formatQuantity(line.quantity)}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
                <Tfoot>
                  <Tr className="font-medium">
                    <Td className="px-4" colSpan={5}>
                      <Trans>Total</Trans>
                    </Td>
                    <Td className="px-4 text-right tabular-nums">
                      {formatAmount(totals.amount)}
                    </Td>
                    <Td className="px-4 text-right tabular-nums">
                      {formatQuantity(totals.quantity)}
                    </Td>
                  </Tr>
                </Tfoot>
              </Table>
            </>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

export default PurchaseLinesDrawer;
