import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { LuBanknote, LuCircleCheck, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { CompanyBankAccountListItem } from "../../types";

type CompanyBankAccountsTableProps = {
  data: CompanyBankAccountListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const CompanyBankAccountsTable = memo(
  ({ data, count, primaryAction }: CompanyBankAccountsTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [selected, setSelected] = useState<CompanyBankAccountListItem | null>(
      null
    );
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<CompanyBankAccountListItem>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.bankAccount(row.original.id)}>
              <Enumerable
                value={row.original.name}
                className="cursor-pointer"
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuBanknote />
          }
        },
        {
          accessorKey: "currencyCode",
          header: t`Currency`,
          cell: ({ row }) => row.original.currencyCode
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: ({ row }) => (row.original.active ? t`Yes` : t`No`),
          meta: {
            icon: <LuCircleCheck />
          }
        }
      ],
      [t]
    );

    const renderContextMenu = useCallback(
      (row: CompanyBankAccountListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => navigate(path.to.bankAccount(row.id))}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Bank Account</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            destructive
            onClick={() => {
              setSelected(row);
              deleteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Bank Account</Trans>
          </MenuItem>
        </>
      ),
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<CompanyBankAccountListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title={t`Bank Accounts`}
        />
        {selected && (
          <ConfirmDelete
            action={path.to.deleteBankAccount(selected.id)}
            isOpen={deleteModal.isOpen}
            name={selected.name}
            text={t`Are you sure you want to delete the bank account: ${selected.name}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelected(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelected(null);
            }}
          />
        )}
      </>
    );
  }
);

CompanyBankAccountsTable.displayName = "CompanyBankAccountsTable";
export default CompanyBankAccountsTable;
