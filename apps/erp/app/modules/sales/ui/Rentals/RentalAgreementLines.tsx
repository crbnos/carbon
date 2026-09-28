import {
  Card,
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
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuBadgeDollarSign,
  LuEllipsisVertical,
  LuPencil,
  LuTrash,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { path } from "~/utils/path";
import { LeaseClassificationBadge } from "./RentalLeaseClassification";
import RentalMoney from "./RentalMoney";
import RentalStatus from "./RentalStatus";
import type { RentalAgreement, RentalAgreementLine } from "./types";
import { useRentalLineActions } from "./useRentalLineActions";

type RentalAgreementLinesProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
};

const RentalAgreementLines = ({
  rentalAgreement,
  lines
}: RentalAgreementLinesProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const actions = useRentalLineActions(rentalAgreement);

  const id = rentalAgreement.id!;
  const isDraft = rentalAgreement.status === "Draft";

  const unitLabel = (line: RentalAgreementLine) =>
    line.fixedAsset?.fixedAssetId ?? line.fixedAsset?.name ?? "";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Units</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No units yet. Add a fleet unit from the Units list before
                activating the agreement.
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
                  const state = actions.stateOf(line);
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
                          <LeaseClassificationBadge
                            value={line.lessorClassification}
                          />
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <DateTime
                          value={line.deliveredAt}
                          variant="date"
                          fallback="—"
                        />
                      </Td>
                      <Td>
                        <DateTime
                          value={line.returnedAt}
                          variant="date"
                          fallback="—"
                        />
                      </Td>
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
                            {state.canDeliver && (
                              <DropdownMenuItem
                                disabled={state.deliverDisabled}
                                onClick={() => actions.open("deliver", line)}
                              >
                                <DropdownMenuIcon icon={<LuTruck />} />
                                <Trans>Deliver</Trans>
                              </DropdownMenuItem>
                            )}
                            {state.canReturn && (
                              <DropdownMenuItem
                                disabled={state.returnDisabled}
                                onClick={() => actions.open("return", line)}
                              >
                                <DropdownMenuIcon icon={<LuUndo2 />} />
                                <Trans>Return</Trans>
                              </DropdownMenuItem>
                            )}
                            {state.canSell && (
                              <DropdownMenuItem
                                disabled={state.sellDisabled}
                                onClick={() => actions.open("sell", line)}
                              >
                                <DropdownMenuIcon
                                  icon={<LuBadgeDollarSign />}
                                />
                                <Trans>Sell to Customer</Trans>
                              </DropdownMenuItem>
                            )}
                            {state.canDelete && (
                              <DropdownMenuItem
                                destructive
                                disabled={state.deleteDisabled}
                                onClick={() => actions.open("delete", line)}
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

      {actions.modals}
    </>
  );
};

export default RentalAgreementLines;
