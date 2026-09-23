import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuBadgeDollarSign,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuTrash,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import RentalMoney from "./RentalMoney";
import RentalStatus from "./RentalStatus";
import type { RentalAgreement, RentalAgreementLine } from "./types";

type RentalAgreementLinesProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
};

type LineAction = {
  kind: "deliver" | "delete" | "sell";
  line: RentalAgreementLine;
};

const RentalAgreementLines = ({
  rentalAgreement,
  lines
}: RentalAgreementLinesProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();
  const disclosure = useDisclosure();
  const [pending, setPending] = useState<LineAction | null>(null);

  const id = rentalAgreement.id!;
  const isDraft = rentalAgreement.status === "Draft";
  const isActive = rentalAgreement.status === "Active";
  const canUpdate = permissions.can("update", "sales");
  // Selling bills a charge and drafts its invoice.
  const canSell =
    canUpdate &&
    permissions.can("create", "sales") &&
    permissions.can("create", "invoicing");
  const purchaseOptionAmount = rentalAgreement.purchaseOptionAmount ?? 0;
  const currencyFormatter = useCurrencyFormatter({
    currency: rentalAgreement.currencyCode ?? undefined
  });
  const formatOptionAmount = currencyFormatter.format(purchaseOptionAmount);

  const unitLabel = (line: RentalAgreementLine) =>
    line.fixedAsset?.fixedAssetId ?? line.fixedAsset?.name ?? "";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Units</Trans>
          </CardTitle>
          {isDraft && (
            <CardAction>
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                isDisabled={!permissions.can("create", "sales")}
                asChild
              >
                <Link to={path.to.newRentalAgreementLine(id)}>
                  <Trans>Add Unit</Trans>
                </Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No units yet. Add a fleet unit before activating the agreement.
              </Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Unit</Trans>
                  </Th>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <Trans>Rate</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Day</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Week</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Month</Trans>
                  </Th>
                  <Th>
                    <Trans>Classification</Trans>
                  </Th>
                  <Th>
                    <Trans>Delivered</Trans>
                  </Th>
                  <Th>
                    <Trans>Returned</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {lines.map((line) => {
                  const canDeliver = isActive && line.status === "Pending";
                  // Returned and Sold lines are finished; only a unit on rent
                  // comes back.
                  const canReturn = isActive && line.status === "On Rent";
                  // The purchase option ends a sales-type lease by sale.
                  const canExerciseOption =
                    canReturn &&
                    line.lessorClassification === "Sales-Type" &&
                    purchaseOptionAmount > 0;
                  return (
                    <Tr key={line.id}>
                      <Td>
                        {line.fixedAssetId ? (
                          <Hyperlink to={path.to.fixedAsset(line.fixedAssetId)}>
                            {unitLabel(line)}
                          </Hyperlink>
                        ) : (
                          "—"
                        )}
                        {line.fixedAsset?.serialNumber && (
                          <span className="block text-xs text-muted-foreground">
                            {line.fixedAsset.serialNumber}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="block">
                          {line.item?.readableIdWithRevision}
                        </span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {line.item?.name}
                        </span>
                      </Td>
                      <Td>
                        <Enumerable
                          value={
                            line.rateMode === "Fixed" && line.rateUnit
                              ? t`Fixed · ${line.rateUnit}`
                              : line.rateMode
                          }
                        />
                      </Td>
                      <Td className="text-right">
                        <RentalMoney
                          value={line.dayRate}
                          currencyCode={rentalAgreement.currencyCode}
                          rate
                        />
                      </Td>
                      <Td className="text-right">
                        <RentalMoney
                          value={line.weekRate}
                          currencyCode={rentalAgreement.currencyCode}
                          rate
                        />
                      </Td>
                      <Td className="text-right">
                        <RentalMoney
                          value={line.monthRate}
                          currencyCode={rentalAgreement.currencyCode}
                          rate
                        />
                      </Td>
                      <Td>
                        {line.lessorClassification ? (
                          <Enumerable value={line.lessorClassification} />
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>{formatDate(line.deliveredAt) || "—"}</Td>
                      <Td>{formatDate(line.returnedAt) || "—"}</Td>
                      <Td>
                        <RentalStatus status={line.status} />
                      </Td>
                      <Td className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label={t`Line actions`}
                              icon={<LuEllipsisVertical />}
                              variant="ghost"
                              size="sm"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  path.to.rentalAgreementLine(id, line.id)
                                )
                              }
                            >
                              <DropdownMenuIcon icon={<LuPencil />} />
                              {isDraft ? (
                                <Trans>Edit</Trans>
                              ) : (
                                <Trans>View</Trans>
                              )}
                            </DropdownMenuItem>
                            {canDeliver && (
                              <DropdownMenuItem
                                disabled={!canUpdate}
                                onClick={() => {
                                  setPending({ kind: "deliver", line });
                                  disclosure.onOpen();
                                }}
                              >
                                <DropdownMenuIcon icon={<LuTruck />} />
                                <Trans>Deliver</Trans>
                              </DropdownMenuItem>
                            )}
                            {canReturn && (
                              <DropdownMenuItem
                                disabled={!canUpdate}
                                onClick={() =>
                                  navigate(
                                    path.to.rentalAgreementLineReturn(
                                      id,
                                      line.id
                                    )
                                  )
                                }
                              >
                                <DropdownMenuIcon icon={<LuUndo2 />} />
                                <Trans>Return</Trans>
                              </DropdownMenuItem>
                            )}
                            {canExerciseOption && (
                              <DropdownMenuItem
                                disabled={!canSell}
                                onClick={() => {
                                  setPending({ kind: "sell", line });
                                  disclosure.onOpen();
                                }}
                              >
                                <DropdownMenuIcon
                                  icon={<LuBadgeDollarSign />}
                                />
                                <Trans>Sell to Customer</Trans>
                              </DropdownMenuItem>
                            )}
                            {isDraft && (
                              <DropdownMenuItem
                                destructive
                                disabled={!permissions.can("delete", "sales")}
                                onClick={() => {
                                  setPending({ kind: "delete", line });
                                  disclosure.onOpen();
                                }}
                              >
                                <DropdownMenuIcon icon={<LuTrash />} />
                                <Trans>Delete</Trans>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pending?.kind === "deliver" && disclosure.isOpen && (
        <Confirm
          action={path.to.rentalAgreementLineDeliver(id, pending.line.id)}
          title={t`Deliver ${unitLabel(pending.line)}`}
          text={t`Mark the unit as delivered to the customer today. It goes on rent today; billing follows the agreement's start date and cycle.`}
          confirmText={t`Deliver`}
          confirmVariant="primary"
          onCancel={() => {
            disclosure.onClose();
            setPending(null);
          }}
          onSubmit={() => {
            disclosure.onClose();
            setPending(null);
          }}
        />
      )}

      {pending?.kind === "sell" && disclosure.isOpen && (
        <Confirm
          action={path.to.rentalAgreementLineSell(id, pending.line.id)}
          title={t`Sell ${unitLabel(pending.line)} to the customer`}
          text={t`The customer exercises the purchase option. A purchase option charge of ${formatOptionAmount} is billed today and its invoice drafted; posting that invoice transfers the unit and marks it Sold.`}
          confirmText={t`Sell to Customer`}
          confirmVariant="primary"
          onCancel={() => {
            disclosure.onClose();
            setPending(null);
          }}
          onSubmit={() => {
            disclosure.onClose();
            setPending(null);
          }}
        />
      )}

      {pending?.kind === "delete" && disclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteRentalAgreementLine(id, pending.line.id)}
          isOpen
          name={unitLabel(pending.line)}
          text={t`Are you sure you want to remove ${unitLabel(pending.line)} from this agreement?`}
          onCancel={() => {
            disclosure.onClose();
            setPending(null);
          }}
          onSubmit={() => {
            disclosure.onClose();
            setPending(null);
          }}
        />
      )}
    </>
  );
};

export default RentalAgreementLines;
