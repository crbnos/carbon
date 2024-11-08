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
  LuContainer,
  LuMail,
  LuMailCheck,
  LuStar,
  LuUser,
  LuUserCheck,
} from "react-icons/lu";
import { Avatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Supplier } from "~/modules/users";
import { DeactivateUsersModal, ResendInviteModal } from "~/modules/users";
import { useSuppliers } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type SupplierAccountsTableProps = {
  data: Supplier[];
  count: number;
  supplierTypes: ListItem[];
};

const defaultColumnVisibility = {
  user_firstName: false,
  user_lastName: false,
};

const SupplierAccountsTable = memo(
  ({ data, count, supplierTypes }: SupplierAccountsTableProps) => {
    const permissions = usePermissions();
    const [params] = useUrlParams();

    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const deactivateSupplierModal = useDisclosure();
    const resendInviteModal = useDisclosure();
    const [suppliers] = useSuppliers();

    const canEdit = permissions.can("update", "users");

    const rows = useMemo(
      () =>
        data.map((d) => {
          // we should only have one user and supplier per supplier id
          if (
            d.user === null ||
            d.supplier === null ||
            Array.isArray(d.user) ||
            Array.isArray(d.supplier)
          ) {
            throw new Error("Expected user and supplier to be objects");
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
                name={row.original.user?.fullName ?? undefined}
                path={row.original.user?.avatarUrl ?? undefined}
              />

              <span>{row.original.user?.fullName ?? ""}</span>
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
          accessorKey: "supplier.name",
          header: "Supplier",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuContainer />,
            filter: {
              type: "static",
              options: suppliers.map(({ name }) => ({
                value: name,
                label: name,
              })),
            },
          },
        },
        {
          accessorKey: "supplier.supplierTypeId",
          header: "Suppier Type",
          cell: ({ row }) => (
            // @ts-ignore
            <Enumerable value={row.original.supplier?.supplierType?.name} />
          ),
          meta: {
            icon: <LuStar />,
            filter: {
              type: "static",
              options: supplierTypes.map((type) => ({
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
    }, [supplierTypes, suppliers]);

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        const selectedUserIds = selectedRows.reduce<string[]>((acc, row) => {
          if (row.user && !Array.isArray(row.user)) {
            acc.push(row.user.id);
          }
          return acc;
        }, []);

        return (
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(selectedUserIds);
                resendInviteModal.onOpen();
              }}
              disabled={!permissions.can("create", "users")}
            >
              <LuMailCheck className="mr-2 h-4 w-4" />
              <span>Resend Account Invite</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(selectedUserIds);
                deactivateSupplierModal.onOpen();
              }}
              disabled={!permissions.can("delete", "users")}
            >
              <LuBan className="mr-2 h-4 w-4" />
              <span>Deactivate Users</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [permissions, resendInviteModal, deactivateSupplierModal]
    );

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
              <MenuIcon icon={<LuMailCheck />} />
              Resend Account Invite
            </MenuItem>
            {row.user?.active === true && (
              <MenuItem
                onClick={(e) => {
                  setSelectedUserIds([userId]);
                  deactivateSupplierModal.onOpen();
                }}
              >
                <MenuIcon icon={<LuBan />} />
                Deactivate Supplier
              </MenuItem>
            )}
          </>
        );
      },
      [deactivateSupplierModal, resendInviteModal]
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
              <New label="Supplier" to={`new?${params.toString()}`} />
            )
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          withSelectableRows={canEdit}
        />

        {deactivateSupplierModal.isOpen && (
          <DeactivateUsersModal
            userIds={selectedUserIds}
            isOpen={deactivateSupplierModal.isOpen}
            redirectTo={path.to.supplierAccounts}
            onClose={deactivateSupplierModal.onClose}
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

SupplierAccountsTable.displayName = "SupplierTable";

export default SupplierAccountsTable;
