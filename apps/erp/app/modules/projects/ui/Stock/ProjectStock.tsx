// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuArrowLeftRight, LuHandCoins, LuUndo2 } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useCompanyToday, usePermissions, useQuantityFormatter } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isBorrowOverdue } from "../../projects.models";
import type { ProjectBorrow } from "../../types";
import ProjectBorrowStatus from "../Transfers/ProjectBorrowStatus";
import { StockOwner } from "../Transfers/StockOwner";

type OnHandRow = {
  itemId: string;
  locationId: string | null;
  storageUnitId: string | null;
  storageUnitName: string | null;
  trackedEntityId: string | null;
  trackedEntityReadableId: string | null;
  quantity: number;
};

type ProjectStockProps = {
  onHand: OnHandRow[];
  borrows: ProjectBorrow[];
};

function newTransferUrl(params: Record<string, string>) {
  return `${path.to.newProjectStockTransfer}?${new URLSearchParams(params)}`;
}

/**
 * The project Stock tab: what the project owns, by item, bin and lot; the
 * borrows it owes and has lent, overdue ones in red; and the buttons that
 * open a prefilled Draft Transfer, Borrow or Payback.
 */
export default function ProjectStock({ onHand, borrows }: ProjectStockProps) {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const permissions = usePermissions();
  const canTransfer = permissions.can("update", "projects");
  const [items] = useItems();
  const locations = useLocations();
  const formatQuantity = useQuantityFormatter();
  const today = useCompanyToday();

  const owed = borrows.filter((b) => b.borrowerProjectId === projectId);
  const lent = borrows.filter((b) => b.lenderProjectId === projectId);
  const firstOwed = owed[0];

  const itemLabel = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    return {
      readableId: item?.readableIdWithRevision ?? itemId,
      name: item?.name ?? ""
    };
  };

  const renderBorrows = (rows: ProjectBorrow[], side: "owed" | "lent") => (
    <TableBase full>
      <Thead>
        <Tr>
          <Th>
            <Trans>Item</Trans>
          </Th>
          <Th>
            {side === "owed" ? <Trans>Lender</Trans> : <Trans>Borrower</Trans>}
          </Th>
          <Th>
            <Trans>Borrowed</Trans>
          </Th>
          <Th>
            <Trans>Still Owed</Trans>
          </Th>
          <Th>
            <Trans>Payback Due</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
          {side === "owed" && (
            <Th className="w-12">
              <span className="sr-only">
                <Trans>Actions</Trans>
              </span>
            </Th>
          )}
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((borrow) => {
          const item = itemLabel(borrow.itemId);
          const overdue = isBorrowOverdue(borrow, today);
          return (
            <Tr key={borrow.id}>
              <Td>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {item.readableId}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.name}
                  </span>
                </div>
              </Td>
              <Td>
                <StockOwner
                  project={side === "owed" ? borrow.lender : borrow.borrower}
                />
              </Td>
              <Td className="tabular-nums">
                {formatQuantity(Number(borrow.quantity))}
              </Td>
              <Td className="tabular-nums">
                {formatQuantity(
                  Number(borrow.quantity) - Number(borrow.quantityPaidBack)
                )}
              </Td>
              <Td
                className={cn(
                  "whitespace-nowrap",
                  overdue && "text-destructive"
                )}
              >
                <DateTime value={borrow.paybackDueDate} variant="date" />
              </Td>
              <Td>
                <ProjectBorrowStatus
                  status={borrow.status}
                  isOverdue={overdue}
                />
              </Td>
              {side === "owed" && (
                <Td>
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={!canTransfer}
                    asChild={canTransfer}
                  >
                    {canTransfer ? (
                      <Link
                        to={newTransferUrl({
                          type: "Payback",
                          borrow: borrow.id
                        })}
                      >
                        <Trans>Pay Back</Trans>
                      </Link>
                    ) : (
                      <Trans>Pay Back</Trans>
                    )}
                  </Button>
                </Td>
              )}
            </Tr>
          );
        })}
      </Tbody>
    </TableBase>
  );

  return (
    <div className="@container mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Project Stock</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Only this project's demand draws its stock. Another project needs
              a transfer or a borrow first.
            </Trans>
          </CardDescription>
          <CardAction>
            <HStack className="flex-wrap justify-end">
              <TransferButton
                isDisabled={!canTransfer}
                to={newTransferUrl({ type: "Transfer", to: projectId })}
                icon={<LuArrowLeftRight />}
                label={t`Transfer`}
              />
              <TransferButton
                isDisabled={!canTransfer}
                to={newTransferUrl({ type: "Borrow", to: projectId })}
                icon={<LuHandCoins />}
                label={t`Borrow`}
              />
              <TransferButton
                isDisabled={!canTransfer || !firstOwed}
                to={newTransferUrl({
                  type: "Payback",
                  borrow: firstOwed?.id ?? ""
                })}
                icon={<LuUndo2 />}
                label={t`Payback`}
              />
            </HStack>
          </CardAction>
        </CardHeader>
        <CardContent>
          {onHand.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              <Trans>
                The project owns no stock. Receive a purchase order line or a
                job into it, or transfer stock in.
              </Trans>
            </p>
          ) : (
            <TableBase full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <Trans>Location</Trans>
                  </Th>
                  <Th>
                    <Trans>Storage Unit</Trans>
                  </Th>
                  <Th>
                    <Trans>Lot or Serial</Trans>
                  </Th>
                  <Th>
                    <Trans>Quantity</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {onHand.map((row) => {
                  const item = itemLabel(row.itemId);
                  return (
                    <Tr
                      key={`${row.itemId}:${row.locationId}:${row.storageUnitId}:${row.trackedEntityId}`}
                    >
                      <Td>
                        <div className="flex min-w-0 flex-col">
                          <Hyperlink to={path.to.inventoryItem(row.itemId)}>
                            <span className="whitespace-nowrap">
                              {item.readableId}
                            </span>
                          </Hyperlink>
                          <span className="truncate text-xs text-muted-foreground">
                            {item.name}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <Enumerable
                          value={
                            locations.find((l) => l.value === row.locationId)
                              ?.label ?? null
                          }
                        />
                      </Td>
                      <Td>{row.storageUnitName ?? ""}</Td>
                      <Td className="whitespace-nowrap font-mono text-xs">
                        {row.trackedEntityReadableId ?? ""}
                      </Td>
                      <Td
                        className={cn(
                          "tabular-nums",
                          row.quantity < 0 && "text-destructive"
                        )}
                      >
                        {formatQuantity(row.quantity)}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableBase>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Borrowed by this project</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Stock the project owes another project.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {owed.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              <Trans>Nothing owed</Trans>
            </p>
          ) : (
            renderBorrows(owed, "owed")
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Lent by this project</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Stock another project owes this one.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lent.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              <Trans>Nothing lent</Trans>
            </p>
          ) : (
            renderBorrows(lent, "lent")
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TransferButton({
  to,
  icon,
  label,
  isDisabled
}: {
  to: string;
  icon: JSX.Element;
  label: string;
  isDisabled: boolean;
}) {
  if (isDisabled) {
    return (
      <Button variant="secondary" leftIcon={icon} isDisabled>
        {label}
      </Button>
    );
  }
  return (
    <Button variant="secondary" leftIcon={icon} asChild>
      <Link to={to}>{label}</Link>
    </Button>
  );
}
