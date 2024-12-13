import {
  Checkbox,
  DropdownMenuContent,
  DropdownMenuItem,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBan,
  LuMail,
  LuMailCheck,
  LuStar,
  LuUser,
  LuUserCheck,
  LuUserSquare,
} from "react-icons/lu";
import { Avatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Customer } from "~/modules/users";
import {
  DeactivateUsersModal,
  ResendInviteModal,
  RevokeInviteModal,
} from "~/modules/users";
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
    const revokeInviteModal = useDisclosure();
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
          meta: {
            icon: <LuUser />,
          },
        },

        {
          accessorKey: "user.firstName",
          header: "First Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />,
          },
        },
        {
          accessorKey: "user.lastName",
          header: "Last Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />,
          },
        },
        {
          accessorKey: "user.email",
          header: "Email",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuMail />,
          },
        },
        {
          accessorKey: "customer.name",
          header: "Customer",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserSquare />,
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
            icon: <LuStar />,
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
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            icon: <LuUserCheck />,
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

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter((row) => row.active === false)
                    .map((row) => row.user.id)
                );
                resendInviteModal.onOpen();
              }}
              disabled={
                !permissions.can("create", "users") ||
                selectedRows.every((row) => row.active === true)
              }
            >
              <LuMailCheck className="mr-2 h-4 w-4" />
              <span>Resend Invite</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter((row) => row.active === true)
                    .map((row) => row.user.id)
                );
                deactivateCustomerModal.onOpen();
              }}
              disabled={
                !permissions.can("delete", "users") ||
                selectedRows.every((row) => row.active === false)
              }
            >
              <LuBan className="mr-2 h-4 w-4" />
              <span>Deactivate Users</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [permissions, deactivateCustomerModal, resendInviteModal]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            {row.active === true ? (
              <>
                <MenuItem
                  onClick={(e) => {
                    setSelectedUserIds([row.user.id]);
                    deactivateCustomerModal.onOpen();
                  }}
                  className="text-red-500 hover:text-red-500"
                >
                  <MenuIcon icon={<LuBan />} />
                  Deactivate Account
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem
                  onClick={() => {
                    setSelectedUserIds([row.user.id]);
                    resendInviteModal.onOpen();
                  }}
                >
                  <MenuIcon icon={<LuMailCheck />} />
                  Resend Account Invite
                </MenuItem>
                {permissions.can("delete", "users") && (
                  <MenuItem
                    onClick={() => {
                      setSelectedUserIds([row.user.id]);
                      revokeInviteModal.onOpen();
                    }}
                    destructive
                  >
                    <MenuIcon icon={<LuBan />} />
                    Revoke Invite
                  </MenuItem>
                )}
              </>
            )}
          </>
        );
      },
      [
        deactivateCustomerModal,
        permissions,
        resendInviteModal,
        revokeInviteModal,
      ]
    );

    return (
      <>
        <Table<(typeof rows)[number]>
          count={count}
          columns={columns}
          data={rows}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "users") && (
              <New label="Customer" to={`new?${params.toString()}`} />
            )
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          withSelectableRows={canEdit}
        />

        {deactivateCustomerModal.isOpen && (
          <DeactivateUsersModal
            userIds={selectedUserIds}
            isOpen={deactivateCustomerModal.isOpen}
            redirectTo={path.to.customerAccounts}
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
        {revokeInviteModal.isOpen && (
          <RevokeInviteModal
            userIds={selectedUserIds}
            isOpen={revokeInviteModal.isOpen}
            onClose={revokeInviteModal.onClose}
          />
        )}
      </>
    );
  }
);

CustomerAccountsTable.displayName = "CustomerTable";

export default CustomerAccountsTable;
