import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuStar, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { CustomerStatus } from "../../types";

type CustomerStatusesTableProps = {
  data: CustomerStatus[];
  count: number;
};

const CustomerStatusesTable = memo(
  ({ data, count }: CustomerStatusesTableProps) => {
    const { t, i18n } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const translateStatus = useCallback(
      (value: string) => i18n._(value),
      [i18n]
    );

    const customColumns = useCustomColumns<CustomerStatus>("customerStatus");
    const columns = useMemo<ColumnDef<CustomerStatus>[]>(() => {
      const defaultColumns: ColumnDef<CustomerStatus>[] = [
        {
          accessorKey: "name",
          header: t`Customer Status`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={translateStatus(row.original.name ?? "")} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuStar />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, t, translateStatus]);

    const renderContextMenu = useCallback(
      (row: CustomerStatus) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(`${path.to.customers}?filter=status:eq:${row.name}`);
              }}
            >
              <MenuIcon icon={<BsPeopleFill />} />
              <Trans>View Customers</Trans>
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.customerStatus(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Customer Status</Trans>
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteCustomerStatus(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Customer Status</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<CustomerStatus>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label={t`Customer Status`}
              to={`${path.to.newCustomerStatus}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Customer Statuses`}
      />
    );
  }
);

CustomerStatusesTable.displayName = "CustomerStatusesTable";
export default CustomerStatusesTable;
