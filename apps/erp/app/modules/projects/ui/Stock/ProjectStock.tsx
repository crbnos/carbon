// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import {
  Button,
  cn,
  LabelWithHelp,
  MenuIcon,
  MenuItem,
  SplitButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import {
  LuArrowLeftRight,
  LuArrowRight,
  LuHandCoins,
  LuUndo2
} from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router";
import { DateTime, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { rowMenuColumn } from "~/components/Setup";
import { useCompanyToday, usePermissions, useQuantityFormatter } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isBorrowOverdue } from "../../projects.models";
import type { ProjectBorrow, ProjectStockTransfer } from "../../types";
import ProjectBorrowStatus from "../Transfers/ProjectBorrowStatus";
import ProjectStockTransferStatus from "../Transfers/ProjectStockTransferStatus";
import { StockOwner } from "../Transfers/StockOwner";
import { useStockTransferTypeLabels } from "../Transfers/useStockTransferTypeLabels";

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
  /** The project's latest transfers, from or to it. */
  transfers: ProjectStockTransfer[];
};

/** A list row with an item's id and name on two lines. */
const TWO_LINE_ROW = 58;
/** A list row with one line. */
const ONE_LINE_ROW = 40;

/** The height a compact list needs: its header row and its rows. */
function listHeight(rowCount: number, rowHeight: number) {
  return 48 + rowHeight * rowCount + 2;
}

function newTransferUrl(params: Record<string, string>) {
  return `${path.to.newProjectStockTransfer}?${new URLSearchParams(params)}`;
}

/**
 * The project Stock page, under Costs: one toolbar row with the Transfer
 * split button (Borrow and Payback in its menu), then four lists: what the
 * project owns, what it owes, what it has lent, and its transfers.
 */
export default function ProjectStock({
  onHand,
  borrows,
  transfers
}: ProjectStockProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const permissions = usePermissions();
  const canTransfer = permissions.can("update", "projects");

  const owed = borrows.filter((b) => b.borrowerProjectId === projectId);
  const lent = borrows.filter((b) => b.lenderProjectId === projectId);
  const firstOwed = owed[0];

  return (
    <div className="flex w-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          <Trans>
            Only this project's demand draws its stock. Another project needs a
            transfer or a borrow first.
          </Trans>
        </p>
        <SplitButton
          leftIcon={<LuArrowLeftRight />}
          isDisabled={!canTransfer}
          onClick={() =>
            navigate(newTransferUrl({ type: "Transfer", to: projectId }))
          }
          dropdownItems={[
            {
              label: t`Borrow`,
              icon: <LuHandCoins />,
              disabled: !canTransfer,
              onClick: () =>
                navigate(newTransferUrl({ type: "Borrow", to: projectId }))
            },
            {
              label: t`Payback`,
              icon: <LuUndo2 />,
              disabled: !canTransfer || !firstOwed,
              onClick: () =>
                firstOwed &&
                navigate(
                  newTransferUrl({ type: "Payback", borrow: firstOwed.id })
                )
            }
          ]}
        >
          <Trans>Transfer</Trans>
        </SplitButton>
      </div>

      <Section title={t`Project stock`} termId="project-stock">
        <OnHandList rows={onHand} />
      </Section>
      <Section title={t`Borrowed by this project`} termId="borrow-payback">
        <BorrowList
          rows={owed}
          side="owed"
          emptyTitle={t`Nothing owed`}
          canTransfer={canTransfer}
        />
      </Section>
      <Section title={t`Lent by this project`} termId="borrow-payback">
        <BorrowList
          rows={lent}
          side="lent"
          emptyTitle={t`Nothing lent`}
          canTransfer={canTransfer}
        />
      </Section>
      <Section
        title={t`Transfers`}
        action={
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<LuArrowRight />}
            asChild
          >
            <Link to={path.to.projectStockTransfers}>
              <Trans>All transfers</Trans>
            </Link>
          </Button>
        }
      >
        <TransferList rows={transfers} />
      </Section>
    </div>
  );
}

function Section({
  title,
  termId,
  action,
  children
}: {
  title: string;
  termId?: TermId;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col border-b border-border">
      <div className="flex h-12 items-center gap-2 px-4">
        <h3 className="min-w-0 flex-1 text-sm font-medium">
          <LabelWithHelp termId={termId} variant="inline">
            {title}
          </LabelWithHelp>
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A read-only compact list: no toolbar of its own, sized to its rows. An
 * empty list is one muted line, as on the Overview: four stacked lists with
 * the cabinet illustration each were louder than the data.
 */
function CompactList<T extends object>({
  columns,
  rows,
  rowHeight,
  emptyTitle
}: {
  columns: ColumnDef<T>[];
  rows: T[];
  rowHeight: number;
  emptyTitle: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">{emptyTitle}</p>
    );
  }
  return (
    <div style={{ height: listHeight(rows.length, rowHeight) }}>
      <Table<T>
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        sort={null}
        withPagination={false}
        withSearch={false}
        withColumnOrdering={false}
        withCsvExport={false}
        withSidebarTrigger={false}
      />
    </div>
  );
}

function useItemLabel() {
  const [items] = useItems();
  return useCallback(
    (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      return {
        readableId: item?.readableIdWithRevision ?? itemId,
        name: item?.name ?? ""
      };
    },
    [items]
  );
}

function OnHandList({ rows }: { rows: OnHandRow[] }) {
  const { t } = useLingui();
  const itemLabel = useItemLabel();
  const locations = useLocations();
  const formatQuantity = useQuantityFormatter();

  const columns = useMemo<ColumnDef<OnHandRow>[]>(
    () => [
      {
        id: "item",
        header: t`Item`,
        cell: ({ row }) => {
          const item = itemLabel(row.original.itemId);
          return (
            <div className="flex min-w-0 flex-col">
              <Hyperlink to={path.to.inventoryItem(row.original.itemId)}>
                <span className="whitespace-nowrap">{item.readableId}</span>
              </Hyperlink>
              <span className="truncate text-xs text-muted-foreground">
                {item.name}
              </span>
            </div>
          );
        }
      },
      {
        id: "location",
        header: t`Location`,
        cell: ({ row }) => (
          <Enumerable
            value={
              locations.find((l) => l.value === row.original.locationId)
                ?.label ?? null
            }
          />
        )
      },
      {
        id: "storageUnit",
        header: t`Storage Unit`,
        cell: ({ row }) => row.original.storageUnitName ?? ""
      },
      {
        id: "lot",
        header: t`Lot or Serial`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs">
            {row.original.trackedEntityReadableId ?? ""}
          </span>
        )
      },
      {
        id: "quantity",
        header: t`Quantity`,
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums",
              row.original.quantity < 0 && "text-destructive"
            )}
          >
            {formatQuantity(row.original.quantity)}
          </span>
        )
      }
    ],
    [t, itemLabel, locations, formatQuantity]
  );

  return (
    <CompactList
      columns={columns}
      rows={rows}
      rowHeight={TWO_LINE_ROW}
      emptyTitle={t`No project stock`}
    />
  );
}

function BorrowList({
  rows,
  side,
  emptyTitle,
  canTransfer
}: {
  rows: ProjectBorrow[];
  side: "owed" | "lent";
  emptyTitle: string;
  canTransfer: boolean;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const itemLabel = useItemLabel();
  const formatQuantity = useQuantityFormatter();
  const today = useCompanyToday();

  const renderRowMenu = useCallback(
    (borrow: ProjectBorrow) => (
      <MenuItem
        disabled={!canTransfer}
        onClick={() =>
          navigate(newTransferUrl({ type: "Payback", borrow: borrow.id }))
        }
      >
        <MenuIcon icon={<LuUndo2 />} />
        <Trans>Pay Back</Trans>
      </MenuItem>
    ),
    [canTransfer, navigate]
  );

  const columns = useMemo<ColumnDef<ProjectBorrow>[]>(() => {
    const base: ColumnDef<ProjectBorrow>[] = [
      {
        id: "item",
        header: t`Item`,
        cell: ({ row }) => {
          const item = itemLabel(row.original.itemId);
          return (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {item.readableId}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {item.name}
              </span>
            </div>
          );
        }
      },
      {
        id: "owner",
        header: side === "owed" ? t`Lender` : t`Borrower`,
        cell: ({ row }) => (
          <StockOwner
            project={
              side === "owed" ? row.original.lender : row.original.borrower
            }
          />
        )
      },
      {
        id: "borrowed",
        header: t`Borrowed`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(Number(row.original.quantity))}
          </span>
        )
      },
      {
        id: "owed",
        header: t`Still Owed`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(
              Number(row.original.quantity) -
                Number(row.original.quantityPaidBack)
            )}
          </span>
        )
      },
      {
        id: "paybackDueDate",
        header: t`Payback Due`,
        cell: ({ row }) => (
          <span
            className={cn(
              "whitespace-nowrap",
              isBorrowOverdue(row.original, today) && "text-destructive"
            )}
          >
            <DateTime value={row.original.paybackDueDate} variant="date" />
          </span>
        )
      },
      {
        id: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <ProjectBorrowStatus
            status={row.original.status}
            isOverdue={isBorrowOverdue(row.original, today)}
          />
        )
      }
    ];
    return side === "owed"
      ? [...base, rowMenuColumn(renderRowMenu, t`Actions`)]
      : base;
  }, [t, side, itemLabel, formatQuantity, today, renderRowMenu]);

  return (
    <CompactList
      columns={columns}
      rows={rows}
      rowHeight={TWO_LINE_ROW}
      emptyTitle={emptyTitle}
    />
  );
}

function TransferList({ rows }: { rows: ProjectStockTransfer[] }) {
  const { t } = useLingui();
  const typeLabels = useStockTransferTypeLabels();

  const columns = useMemo<ColumnDef<ProjectStockTransfer>[]>(
    () => [
      {
        id: "projectStockTransferId",
        header: t`Transfer ID`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.projectStockTransfer(row.original.id)}>
            <span className="whitespace-nowrap">
              {row.original.projectStockTransferId}
            </span>
          </Hyperlink>
        )
      },
      {
        id: "type",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={typeLabels[row.original.type]} />
      },
      {
        id: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <ProjectStockTransferStatus status={row.original.status} />
        )
      },
      {
        id: "from",
        header: t`From`,
        cell: ({ row }) => (
          <StockOwner project={row.original.fromProject} withHelp />
        )
      },
      {
        id: "to",
        header: t`To`,
        cell: ({ row }) => (
          <StockOwner project={row.original.toProject} withHelp />
        )
      },
      {
        id: "createdAt",
        header: t`Created`,
        cell: ({ row }) => (
          <DateTime value={row.original.createdAt} variant="date" />
        )
      }
    ],
    [t, typeLabels]
  );

  return (
    <CompactList
      columns={columns}
      rows={rows}
      rowHeight={ONE_LINE_ROW}
      emptyTitle={t`No transfers`}
    />
  );
}
