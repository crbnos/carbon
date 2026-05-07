import {
  Checkbox,
  DropdownMenuContent,
  DropdownMenuItem,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBan,
  LuContainer,
  LuMail,
  LuMailCheck,
  LuStar,
  LuUser,
  LuUserCheck
} from "react-icons/lu";
import { Avatar, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Supplier } from "~/modules/users";
import {
  DeactivateUsersModal,
  ResendInviteModal,
  RevokeInviteModal
} from "~/modules/users";
import { useSuppliers } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type SupplierAccountsTableProps = {
  data: Supplier[];
  count: number;
  supplierTypes: ListItem[];
  unrevokedInviteEmails: string[];
};

const defaultColumnVisibility = {
  user_firstName: false,
  user_lastName: false
};

const SupplierAccountsTable = memo(
  ({
    data,
    count,
    supplierTypes,
    unrevokedInviteEmails
  }: SupplierAccountsTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const [params] = useUrlParams();

    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const deactivateSupplierModal = useDisclosure();
    const resendInviteModal = useDisclosure();
    const revokeInviteModal = useDisclosure();

    const [suppliers] = useSuppliers();

    const unrevokedInviteSet = useMemo(
      () => new Set(unrevokedInviteEmails),
      [unrevokedInviteEmails]
    );

    const hasUnrevokedInviteForRow = useCallback(
      (row: Supplier): boolean => {
        const email =
          row.user && !Array.isArray(row.user) ? row.user.email : null;
        return !!email && unrevokedInviteSet.has(email);
      },
      [unrevokedInviteSet]
    );

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
          header: t`User`,
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
            icon: <LuUser />
          }
        },

        {
          accessorKey: "user.firstName",
          header: t`First Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />
          }
        },
        {
          accessorKey: "user.lastName",
          header: t`Last Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />
          }
        },
        {
          accessorKey: "user.email",
          header: t`Email`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuMail />
          }
        },
        {
          accessorKey: "supplier.name",
          header: t`Supplier`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuContainer />,
            filter: {
              type: "static",
              options: suppliers.map(({ name }) => ({
                value: name,
                label: name
              }))
            }
          }
        },
        {
          accessorKey: "supplier.supplierTypeId",
          header: t`Supplier Type`,
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
                label: <Enumerable value={type.name} />
              }))
            }
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            icon: <LuUserCheck />,
            filter: {
              type: "static",
              options: [
                {
                  value: "true",
                  label: t`Active`
                },
                {
                  value: "false",
                  label: t`Inactive`
                }
              ]
            }
          }
        }
      ];
    }, [supplierTypes, suppliers, t]);

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter(
                      (row) =>
                        row.active === false && !hasUnrevokedInviteForRow(row)
                    )
                    .map((row) => row.user.id)
                );
                resendInviteModal.onOpen();
              }}
              disabled={
                !permissions.can("create", "users") ||
                !selectedRows.some(
                  (row) =>
                    row.active === false && !hasUnrevokedInviteForRow(row)
                )
              }
            >
              <LuMailCheck className="mr-2 h-4 w-4" />
              <span>
                <Trans>Send Invite</Trans>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter((row) => row.active === true)
                    .map((row) => row.user.id)
                );
                deactivateSupplierModal.onOpen();
              }}
              disabled={
                !permissions.can("delete", "users") ||
                selectedRows.every((row) => row.active === false)
              }
            >
              <LuBan className="mr-2 h-4 w-4" />
              <span>
                <Trans>Deactivate Users</Trans>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [
        permissions,
        deactivateSupplierModal,
        resendInviteModal,
        hasUnrevokedInviteForRow
      ]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        const hasUnrevokedInvite = hasUnrevokedInviteForRow(row);
        return (
          <>
            {row.active === true ? (
              <MenuItem
                onClick={(e) => {
                  setSelectedUserIds([row.user.id]);
                  deactivateSupplierModal.onOpen();
                }}
                destructive
              >
                <MenuIcon icon={<LuBan />} />
                <Trans>Deactivate Account</Trans>
              </MenuItem>
            ) : hasUnrevokedInvite ? (
              permissions.can("delete", "users") && (
                <MenuItem
                  onClick={() => {
                    setSelectedUserIds([row.user.id]);
                    revokeInviteModal.onOpen();
                  }}
                  destructive
                >
                  <MenuIcon icon={<LuBan />} />
                  <Trans>Revoke Invite</Trans>
                </MenuItem>
              )
            ) : (
              <MenuItem
                onClick={() => {
                  setSelectedUserIds([row.user.id]);
                  resendInviteModal.onOpen();
                }}
              >
                <MenuIcon icon={<LuMailCheck />} />
                <Trans>Send Invite</Trans>
              </MenuItem>
            )}
          </>
        );
      },
      [
        deactivateSupplierModal,
        hasUnrevokedInviteForRow,
        permissions,
        resendInviteModal,
        revokeInviteModal
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
              <New label={t`Supplier`} to={`new?${params.toString()}`} />
            )
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          title={t`Supplier Accounts`}
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

SupplierAccountsTable.displayName = "SupplierTable";

export default SupplierAccountsTable;
