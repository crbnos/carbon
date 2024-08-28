import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Table } from "~/components";
import { EditableList } from "~/components/Editable";
import { Enumerable } from "~/components/Enumerable";
import type {
  AccountListItem,
  PurchasingPostingGroup,
} from "~/modules/accounting";
import type { ListItem } from "~/types";
import usePostingGroups from "./usePostingGroups";

type PurchasingPostingGroupsTableProps = {
  data: PurchasingPostingGroup[];
  count: number;
  itemPostingGroups: ListItem[];
  supplierTypes: ListItem[];
  balanceSheetAccounts: AccountListItem[];
  incomeStatementAccounts: AccountListItem[];
};

const PurchasingPostingGroupsTable = ({
  data,
  count,
  itemPostingGroups,
  supplierTypes,
  balanceSheetAccounts,
  incomeStatementAccounts,
}: PurchasingPostingGroupsTableProps) => {
  const { canEdit, onCellEdit } = usePostingGroups("postingGroupPurchasing");

  const balanceSheetAccountOptions = useMemo(() => {
    return balanceSheetAccounts.map((account) => ({
      label: account.number,
      value: account.number,
    }));
  }, [balanceSheetAccounts]);

  const incomeStatementAccountOptions = useMemo(() => {
    return incomeStatementAccounts.map((account) => ({
      label: account.number,
      value: account.number,
    }));
  }, [incomeStatementAccounts]);

  const columns = useMemo<ColumnDef<PurchasingPostingGroup>[]>(() => {
    return [
      {
        id: "itemPostingGroupId",
        header: "Posting Group",
        cell: ({ row }) => (
          <Enumerable
            value={
              itemPostingGroups.find(
                (group) => group.id === row.original.itemPostingGroupId
              )?.name ?? null
            }
          />
        ),
        meta: {
          filter: {
            type: "static",
            options: itemPostingGroups.map((group) => ({
              label: <Enumerable value={group.name} />,
              value: group.id,
            })),
          },
        },
      },
      {
        id: "supplierTypeId",
        header: "Supplier Type",
        cell: ({ row }) => (
          <Enumerable
            value={
              supplierTypes.find(
                (type) => type.id === row.original.supplierTypeId
              )?.name ?? null
            }
          />
        ),
        meta: {
          filter: {
            type: "static",
            options: supplierTypes.map((t) => ({
              label: <Enumerable value={t.name} />,
              value: t.id,
            })),
          },
        },
      },
      {
        accessorKey: "payablesAccount",
        header: "Payables",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "purchaseAccount",
        header: "Purchase",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "purchaseDiscountAccount",
        header: "Purchase Discount",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "purchaseCreditAccount",
        header: "Purchase Credit",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "purchasePrepaymentAccount",
        header: "Purchase Prepayment",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "purchaseTaxPayableAccount",
        header: "Purchase Tax Payable",
        cell: (item) => item.getValue(),
      },
    ];
  }, [supplierTypes, itemPostingGroups]);

  const editableComponents = useMemo(
    () => ({
      payablesAccount: EditableList(onCellEdit, balanceSheetAccountOptions),
      purchaseAccount: EditableList(onCellEdit, incomeStatementAccountOptions),
      purchaseDiscountAccount: EditableList(
        onCellEdit,
        incomeStatementAccountOptions
      ),
      purchaseCreditAccount: EditableList(
        onCellEdit,
        balanceSheetAccountOptions
      ),
      purchasePrepaymentAccount: EditableList(
        onCellEdit,
        balanceSheetAccountOptions
      ),
      purchaseTaxPayableAccount: EditableList(
        onCellEdit,
        balanceSheetAccountOptions
      ),
    }),
    [onCellEdit, balanceSheetAccountOptions, incomeStatementAccountOptions]
  );

  return (
    <Table<PurchasingPostingGroup>
      data={data}
      columns={columns}
      count={count}
      editableComponents={editableComponents}
      withInlineEditing={canEdit}
      withSearch={false}
    />
  );
};

export default PurchasingPostingGroupsTable;
