import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table as ReactTable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus, LuHandCoins, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import RepairChargeForm from "./RepairChargeForm";
import type { RepairOrderCharge, RepairOrderLine } from "./types";

type RepairChargesTableProps = {
  repairOrderId: string;
  status: string;
  currencyCode: string;
  charges: RepairOrderCharge[];
  lines: RepairOrderLine[];
};

const RepairChargesTable = ({
  repairOrderId,
  status,
  currencyCode,
  charges,
  lines
}: RepairChargesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });
  const fetcher = useFetcher();
  const newCharge = useDisclosure();

  const canUpdate = permissions.can("update", "sales");
  const isOpen = !["Completed", "Cancelled"].includes(status);

  // What the customer actually pays. Warranty and no-charge work is absorbed,
  // so it deliberately does not appear in this total.
  const billableTotal = charges
    .filter((charge) => charge.billingCode === "Billable")
    .reduce(
      (sum, charge) => sum + Number(charge.quantity) * Number(charge.unitPrice),
      0
    );

  return (
    <>
      <Card>
        <CardHeader>
          <HStack className="w-full justify-between">
            <CardTitle>
              <Trans>Parts & Charges</Trans>
            </CardTitle>
            {isOpen && (
              <Button
                size="sm"
                leftIcon={<LuCirclePlus />}
                isDisabled={!canUpdate}
                onClick={newCharge.onOpen}
              >
                <Trans>Add Charge</Trans>
              </Button>
            )}
          </HStack>
        </CardHeader>
        <CardContent>
          <ReactTable>
            <Thead>
              <Tr>
                <Th>{t`Type`}</Th>
                <Th>{t`Item / Description`}</Th>
                <Th>{t`Qty`}</Th>
                <Th>{t`Unit Price`}</Th>
                <Th>{t`Billing`}</Th>
                <Th>{t`Issued`}</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {charges.length === 0 && (
                <Tr>
                  <Td colSpan={7} className="text-muted-foreground text-center">
                    <Trans>No parts or charges recorded yet</Trans>
                  </Td>
                </Tr>
              )}
              {charges.map((charge) => (
                <Tr key={charge.id}>
                  <Td>{charge.chargeType}</Td>
                  <Td>
                    <div className="flex flex-col">
                      <span>
                        {charge.item?.readableIdWithRevision ??
                          charge.description}
                      </span>
                      {charge.item?.readableIdWithRevision &&
                        charge.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {charge.description}
                          </span>
                        )}
                    </div>
                  </Td>
                  <Td className="tabular-nums">{charge.quantity}</Td>
                  <Td className="tabular-nums">
                    {currencyFormatter.format(Number(charge.unitPrice))}
                  </Td>
                  <Td>{charge.billingCode}</Td>
                  <Td>
                    {charge.issuedAt ? (
                      <Trans>Yes</Trans>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td>
                    <HStack spacing={1}>
                      {/* Issuing consumes shop stock and posts the GL: warranty
                          and no-charge parts hit Warranty Expense, billable
                          parts hit COGS. */}
                      {isOpen &&
                        charge.chargeType === "Part" &&
                        !charge.issuedAt && (
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<LuHandCoins />}
                            isDisabled={!canUpdate}
                            onClick={() =>
                              fetcher.submit(
                                {},
                                {
                                  method: "post",
                                  action: path.to.repairOrderChargeIssue(
                                    repairOrderId,
                                    charge.id
                                  )
                                }
                              )
                            }
                          >
                            <Trans>Issue Part</Trans>
                          </Button>
                        )}
                      {isOpen && !charge.issuedAt && (
                        <Button
                          size="sm"
                          variant="destructive"
                          isIcon
                          aria-label={t`Delete charge`}
                          leftIcon={<LuTrash />}
                          isDisabled={!canUpdate}
                          onClick={() =>
                            fetcher.submit(
                              {},
                              {
                                method: "post",
                                action: path.to.repairOrderChargeDelete(
                                  repairOrderId,
                                  charge.id
                                )
                              }
                            )
                          }
                        />
                      )}
                    </HStack>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </ReactTable>

          <HStack className="w-full justify-end pt-4">
            <span className="text-sm text-muted-foreground">
              <Trans>Billable total</Trans>
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {currencyFormatter.format(billableTotal)}
            </span>
          </HStack>
        </CardContent>
      </Card>

      {newCharge.isOpen && (
        <RepairChargeForm
          repairOrderId={repairOrderId}
          lines={lines}
          onClose={newCharge.onClose}
        />
      )}
    </>
  );
};

export default RepairChargesTable;
