// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import {
  Badge,
  Copy,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { datetime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendarX,
  LuExternalLink,
  LuPencil,
  LuSquareUser,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, DateTime, Hyperlink, New, Table } from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import { useCompanyTimeZone, usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import {
  customerPortalExpired,
  customerPortalExpiryDate
} from "../../sales.utils";

type CustomerPortal = Database["public"]["Tables"]["externalLink"]["Row"];

type CustomerPortalsTableProps = {
  appUrl: string;
  data: CustomerPortal[];
  count: number;
  infinite: InfiniteOptions;
};

const CustomerPortalsTable = memo(
  ({ appUrl, data, count, infinite }: CustomerPortalsTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const companyTimeZone = useCompanyTimeZone();

    const columns = useMemo<ColumnDef<CustomerPortal>[]>(() => {
      const defaultColumns: ColumnDef<CustomerPortal>[] = [
        {
          accessorKey: "customer.name",
          header: t`Customer`,
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.customer(
                row.original.customerId ?? row.original.documentId ?? ""
              )}
            >
              <CustomerAvatar
                customerId={
                  row.original.customerId ?? row.original.documentId ?? ""
                }
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuSquareUser />,
            mobile: "P1"
          }
        },
        {
          accessorKey: "portalLink",
          header: t`Portal Link`,
          // The link is built from the id; `externalLink` has no such column to sort by.
          enableSorting: false,
          cell: ({ row }) => {
            const portalUrl = `${appUrl}/share/customer/${row.original.id}`;
            return (
              <div className="flex items-center gap-2">
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono underline"
                >
                  {portalUrl}
                </a>
                <Copy text={portalUrl} />
              </div>
            );
          },
          meta: {
            icon: <LuExternalLink />,
            mobile: "P3"
          }
        },
        {
          accessorKey: "expiresAt",
          header: t`Expires On`,
          cell: ({ row }) =>
            row.original.expiresAt ? (
              <div className="flex items-center gap-2">
                {/* The day in the company's calendar, as the form shows it. */}
                <DateTime
                  value={
                    customerPortalExpiryDate(
                      row.original.expiresAt,
                      companyTimeZone
                    ) ?? null
                  }
                  variant="date"
                />
                {customerPortalExpired(
                  row.original.expiresAt,
                  datetime.timestamp()
                ) && (
                  <Badge variant="red">
                    <Trans>Expired</Trans>
                  </Badge>
                )}
              </div>
            ) : null,
          meta: {
            icon: <LuCalendarX />
          }
        }
      ];
      return defaultColumns;
    }, [appUrl, companyTimeZone, t]);

    const renderContextMenu = useCallback(
      (row: CustomerPortal) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              onClick={() => {
                navigate(
                  `${path.to.customerPortal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Portal</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteCustomerPortal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Portal</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<CustomerPortal>
        data={data}
        columns={columns}
        count={count}
        infinite={infinite}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label={t`Customer Portal`}
              to={`${path.to.newCustomerPortal}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Customer Portals`}
      />
    );
  }
);

CustomerPortalsTable.displayName = "CustomerPortalsTable";
export default CustomerPortalsTable;
