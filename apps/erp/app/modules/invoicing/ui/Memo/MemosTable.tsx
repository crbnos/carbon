import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCircleDot,
  LuCoins,
  LuEye,
  LuHash,
  LuLandmark,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  DateTime,
  Hyperlink,
  New,
  SupplierAvatar,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useAccounts } from "~/components/Form/Account";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { useCustomers, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { memoDirection, memoStatus } from "../../invoicing.models";
import MemoStatus from "./MemoStatus";

// The `memo` table is not present in the committed (cloud-generated) DB types, so
// declare the row shape locally from the migration schema.
type MemoRow = {
  id: string;
  memoId: string;
  direction: "Credit" | "Debit";
  status: "Draft" | "Posted" | "Voided";
  customerId: string | null;
  supplierId: string | null;
  memoDate: string;
  currencyCode: string;
  amount: number;
  reasonAccount: string | null;
  reference: string | null;
};

type MemosTableProps = {
  data: MemoRow[];
  count: number;
  // Which party this list is scoped to. "customer" → Credit Memos (AR),
  // "supplier" → Vendor Credits (AP). Drives the counterparty column, the
  // title, and the New-button label/default party.
  party: "customer" | "supplier";
};

const MemosTable = memo(({ data, count, party }: MemosTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const currencyFormatter = useCurrencyFormatter();
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  const accounts = useAccounts();
  const deleteModal = useDisclosure();
  const [selectedMemo, setSelectedMemo] = useState<MemoRow | null>(null);

  const renderContextMenu = useCallback(
    (row: MemoRow) => (
      <>
        <MenuItem onClick={() => navigate(path.to.memo(row.id))}>
          <MenuIcon icon={row.status === "Draft" ? <LuPencil /> : <LuEye />} />
          {row.status === "Draft" ? (
            <Trans>Edit Memo</Trans>
          ) : (
            <Trans>View Memo</Trans>
          )}
        </MenuItem>
        <MenuItem
          destructive
          disabled={
            row.status !== "Draft" || !permissions.can("delete", "invoicing")
          }
          onClick={() => {
            setSelectedMemo(row);
            deleteModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete Memo</Trans>
        </MenuItem>
      </>
    ),
    [navigate, permissions, deleteModal]
  );

  const columns = useMemo<ColumnDef<MemoRow>[]>(
    () => [
      {
        accessorKey: "memoId",
        header: t`Memo ID`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.memo(row.original.id)}>
            {row.original.memoId}
          </Hyperlink>
        ),
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "direction",
        header: t`Direction`,
        cell: ({ row }) => <Enumerable value={row.original.direction} />,
        meta: {
          icon: <LuCircleDot />,
          filter: {
            type: "static",
            options: memoDirection.map((direction) => ({
              value: direction,
              label: <Enumerable value={direction} />
            }))
          },
          pluralHeader: t`Directions`
        }
      },
      {
        id: "counterparty",
        header: party === "supplier" ? t`Supplier` : t`Customer`,
        cell: ({ row }) =>
          party === "supplier" ? (
            row.original.supplierId ? (
              <SupplierAvatar supplierId={row.original.supplierId} />
            ) : null
          ) : row.original.customerId ? (
            <CustomerAvatar customerId={row.original.customerId} />
          ) : null,
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            // Only this list's party; the loader maps the chosen ids onto the
            // matching customerId / supplierId column.
            options:
              party === "supplier"
                ? (suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))
                : (customers ?? []).map((c) => ({ value: c.id, label: c.name }))
          },
          pluralHeader: party === "supplier" ? t`Suppliers` : t`Customers`
        }
      },
      {
        accessorKey: "memoDate",
        header: t`Memo Date`,
        cell: (item) => (
          <DateTime value={item.getValue<string>()} variant="date" />
        ),
        meta: { icon: <LuCalendar /> }
      },
      {
        accessorKey: "amount",
        header: t`Amount`,
        cell: (item) => (
          <span className="tabular-nums">
            {currencyFormatter.format(item.getValue<number>())}
          </span>
        ),
        meta: {
          icon: <LuCoins />,
          renderTotal: true,
          formatter: currencyFormatter.format
        }
      },
      {
        accessorKey: "reasonAccount",
        header: t`Reason Account`,
        cell: ({ row }) => {
          const account = accounts.find(
            (a) => a.id === row.original.reasonAccount
          );
          if (!account) return row.original.reasonAccount;
          return (
            <span className="truncate">
              <span className="text-muted-foreground">{account.number}</span>{" "}
              {account.name}
            </span>
          );
        },
        meta: { icon: <LuLandmark /> }
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: ({ row }) => <Enumerable value={row.original.currencyCode} />
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <MemoStatus status={row.original.status} />,
        meta: {
          icon: <LuCircleDot />,
          filter: {
            type: "static",
            options: memoStatus.map((status) => ({
              value: status,
              label: <MemoStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`
        }
      },
      {
        accessorKey: "reference",
        header: t`Reference`,
        cell: ({ row }) => row.original.reference ?? null
      }
    ],
    [t, currencyFormatter, customers, suppliers, accounts, party]
  );

  return (
    <>
      <Table<MemoRow>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{ left: ["memoId"] }}
        defaultColumnVisibility={{
          reference: false
        }}
        primaryAction={
          permissions.can("create", "invoicing") && (
            <New
              label={party === "supplier" ? t`Vendor Credit` : t`Credit Memo`}
              to={`${path.to.memoNew}?party=${party}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={party === "supplier" ? t`Vendor Credits` : t`Credit Memos`}
        table="memo"
        withSavedView
      />
      {selectedMemo && (
        <ConfirmDelete
          action={path.to.memoDelete(selectedMemo.id)}
          isOpen={deleteModal.isOpen}
          name={selectedMemo.memoId}
          text={t`Are you sure you want to delete ${selectedMemo.memoId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
            setSelectedMemo(null);
          }}
          onSubmit={() => {
            deleteModal.onClose();
            setSelectedMemo(null);
          }}
        />
      )}
    </>
  );
});

MemosTable.displayName = "MemosTable";

export default MemosTable;
