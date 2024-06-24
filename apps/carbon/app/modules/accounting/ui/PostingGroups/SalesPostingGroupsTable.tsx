import { Enumerable } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Table } from "~/components";
import { EditableList } from "~/components/Editable";
import type { AccountListItem, SalesPostingGroup } from "~/modules/accounting";
import type { ListItem } from "~/types";
import usePostingGroups from "./usePostingGroups";

type SalesPostingGroupsTableProps = {
  data: SalesPostingGroup[];
  count: number;
  itemPostingGroups: ListItem[];
  customerTypes: ListItem[];
  balanceSheetAccounts: AccountListItem[];
  incomeStatementAccounts: AccountListItem[];
};

const SalesPostingGroupsTable = ({
  data,
  count,
  itemPostingGroups,
  customerTypes,
  balanceSheetAccounts,
  incomeStatementAccounts,
}: SalesPostingGroupsTableProps) => {
  const { canEdit, onCellEdit } = usePostingGroups("postingGroupSales");

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

  const columns = useMemo<ColumnDef<SalesPostingGroup>[]>(() => {
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
        id: "customerTypeId",
        header: "Customer Type",
        cell: ({ row }) => (
          <Enumerable
            value={
              customerTypes.find(
                (type) => type.id === row.original.customerTypeId
              )?.name ?? null
            }
          />
        ),
        meta: {
          filter: {
            type: "static",
            options: customerTypes.map((t) => ({
              label: <Enumerable value={t.name} />,
              value: t.id,
            })),
          },
        },
      },
      {
        accessorKey: "receivablesAccount",
        header: "Receivables",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "salesAccount",
        header: "Sales",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "salesDiscountAccount",
        header: "Sales Discount",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "salesCreditAccount",
        header: "Sales Credit",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "salesPrepaymentAccount",
        header: "Sales Prepayment",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "salesTaxPayableAccount",
        header: "Sales Tax Payable",
        cell: (item) => item.getValue(),
      },
    ];
  }, [customerTypes, itemPostingGroups]);

  const editableComponents = useMemo(
    () => ({
      receivablesAccount: EditableList(onCellEdit, balanceSheetAccountOptions),
      salesAccount: EditableList(onCellEdit, incomeStatementAccountOptions),
      salesDiscountAccount: EditableList(
        onCellEdit,
        incomeStatementAccountOptions
      ),
      salesCreditAccount: EditableList(onCellEdit, balanceSheetAccountOptions),
      salesPrepaymentAccount: EditableList(
        onCellEdit,
        balanceSheetAccountOptions
      ),
      salesTaxPayableAccount: EditableList(
        onCellEdit,
        balanceSheetAccountOptions
      ),
    }),
    [onCellEdit, balanceSheetAccountOptions, incomeStatementAccountOptions]
  );

  return (
    <Table<SalesPostingGroup>
      data={data}
      columns={columns}
      count={count}
      editableComponents={editableComponents}
      withInlineEditing={canEdit}
      withSearch={false}
    />
  );
};

export default SalesPostingGroupsTable;
