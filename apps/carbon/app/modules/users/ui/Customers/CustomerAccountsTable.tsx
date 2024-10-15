import {
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { BsEnvelope } from "react-icons/bs";
import { FaBan } from "react-icons/fa";
import { Avatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Customer } from "~/modules/users";
import { DeactivateUsersModal, ResendInviteModal } from "~/modules/users";
import { useCustomers } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type CustomerAccountsTableProps = {
  data: Customer[];
  count: number;
  customerTypes: ListItem[];
};

const defaultColumnVisibility = {
  user_firstName: false,
  user_lastName: false,
};

const CustomerAccountsTable = memo(
  ({ data, count, customerTypes }: CustomerAccountsTableProps) => {
    const permissions = usePermissions();
    const [params] = useUrlParams();
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const deactivateCustomerModal = useDisclosure();
    const resendInviteModal = useDisclosure();
    const [customers] = useCustomers();

    const canEdit = permissions.can("update", "users");

    const rows = useMemo(
      () =>
        data.map((d) => {
          // we should only have one user and customer per customer id
          if (
            d.user === null ||
            d.customer === null ||
            Array.isArray(d.user) ||
            Array.isArray(d.customer)
          ) {
            throw new Error("Expected user and customer to be objects");
          }

          return d;
        }),
      [data]
    );

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      return [
        {
          header: "User",
          cell: ({ row }) => (
            <HStack>
              <Avatar
                size="sm"
                // @ts-ignore
                name={row.original.user?.fullName}
                // @ts-ignore
                path={row.original.user?.avatarUrl}
              />

              <span>
                {row.original.user?.fullName ??
                  row.original.user?.email ??
                  "Unknown"}
              </span>
            </HStack>
          ),
        },

        {
          accessorKey: "user.firstName",
          header: "First Name",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "user.lastName",
          header: "Last Name",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "user.email",
          header: "Email",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "customer.name",
          header: "Customer",
          cell: (item) => item.getValue(),
          meta: {
            filter: {
              type: "static",
              options: customers.map(({ name }) => ({
                value: name,
                label: name,
              })),
            },
          },
        },
        {
          accessorKey: "customer.customerTypeId",
          header: "Customer Type",
          cell: ({ row }) => (
            // @ts-ignore
            <Enumerable value={row.original.customer?.customerType?.name} />
          ),
          meta: {
            filter: {
              type: "static",
              options: customerTypes.map((type) => ({
                value: type.id,
                label: <Enumerable value={type.name} />,
              })),
            },
          },
        },
        {
          accessorKey: "user.active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                {
                  value: "true",
                  label: "Active",
                },
                {
                  value: "false",
                  label: "Inactive",
                },
              ],
            },
          },
        },
      ];
    }, [customerTypes, customers]);

    const actions = useMemo(() => {
      return [
        {
          label: "Send Account Invite",
          icon: <BsEnvelope />,
          disabled: !permissions.can("create", "users"),
          onClick: (selected: typeof rows) => {
            setSelectedUserIds(
              selected.reduce<string[]>((acc, row) => {
                if (row.user && !Array.isArray(row.user)) {
                  acc.push(row.user.id);
                }
                return acc;
              }, [])
            );
            resendInviteModal.onOpen();
          },
        },
        {
          label: "Deactivate Users",
          icon: <FaBan />,
          disabled: !permissions.can("delete", "users"),
          onClick: (selected: typeof rows) => {
            setSelectedUserIds(
              selected.reduce<string[]>((acc, row) => {
                if (row.user && !Array.isArray(row.user)) {
                  acc.push(row.user.id);
                }
                return acc;
              }, [])
            );
            deactivateCustomerModal.onOpen();
          },
        },
      ];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        if (Array.isArray(row.user) || !row.user) {
          return null;
        }
        const userId = row.user.id as string;
        return (
          <>
            <MenuItem
              onClick={() => {
                setSelectedUserIds([userId]);
                resendInviteModal.onOpen();
              }}
            >
              <MenuIcon icon={<BsEnvelope />} />
              Send Account Invite
            </MenuItem>
            {row.user?.active === true && (
              <MenuItem
                onClick={(e) => {
                  setSelectedUserIds([userId]);
                  deactivateCustomerModal.onOpen();
                }}
              >
                <MenuIcon icon={<FaBan />} />
                Deactivate Customer
              </MenuItem>
            )}
          </>
        );
      },
      [deactivateCustomerModal, resendInviteModal]
    );

    return (
      <>
        <Table<(typeof rows)[number]>
          actions={actions}
          count={count}
          columns={columns}
          data={rows}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "users") && (
              <New label="Customer" to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
          withSelectableRows={canEdit}
        />

        {deactivateCustomerModal.isOpen && (
          <DeactivateUsersModal
            userIds={selectedUserIds}
            isOpen={deactivateCustomerModal.isOpen}
            redirectTo={path.to.supplierAccounts}
            onClose={deactivateCustomerModal.onClose}
          />
        )}
        {resendInviteModal.isOpen && (
          <ResendInviteModal
            userIds={selectedUserIds}
            isOpen={resendInviteModal.isOpen}
            onClose={resendInviteModal.onClose}
          />
        )}
      </>
    );
  }
);

CustomerAccountsTable.displayName = "CustomerTable";

export default CustomerAccountsTable;
