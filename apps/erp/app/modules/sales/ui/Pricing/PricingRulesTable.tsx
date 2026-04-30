import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuBoxes,
  LuCalendar,
  LuCopy,
  LuPackage,
  LuPencil,
  LuSquareUser,
  LuTag,
  LuToggleLeft,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { CustomerAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  usePermissions,
  useUrlParams
} from "~/hooks";
import { useCustomers } from "~/stores/customers";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { pricingRuleTypes } from "../../sales.models";
import type { PricingRule } from "../../types";

type PricingRulesTableProps = {
  data: PricingRule[];
  count: number;
};

const defaultColumnVisibility = {
  customerIds: false,
  customerTypeIds: false,
  itemIds: false,
  itemPostingGroupId: false
};

const PricingRulesTable = memo(({ data, count }: PricingRulesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const canCreate = permissions.can("create", "sales");
  const canUpdate = permissions.can("update", "sales");
  const canDelete = permissions.can("delete", "sales");
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const fetcher = useFetcher();
  const [customers] = useCustomers();
  const customerTypes = useCustomerTypes();
  const itemPostingGroups = useItemPostingGroups();
  const [items] = useItems();

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.pricingRule(row.original.id)}?${params.toString()}`}
          >
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          icon: <LuTag />
        }
      },
      {
        accessorKey: "ruleType",
        header: t`Type`,
        cell: ({ row }) => {
          const { amount, amountType, ruleType } = row.original;
          return (
            <Badge
              variant={ruleType === "Discount" ? "red" : "green"}
              className=" items-center gap-1"
            >
              {amountType === "Percentage" ? (
                <span>{percentFormatter.format(amount)}</span>
              ) : (
                <span>{currencyFormatter.format(amount)}</span>
              )}
              {ruleType === "Discount" ? <LuArrowDown /> : <LuArrowUp />}
            </Badge>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: pricingRuleTypes.map((type) => ({
              value: type,
              label: type
            }))
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "customerIds",
        header: t`Customers`,
        cell: ({ row }) => {
          if (!row.original.customerIds?.length) return null;
          return (
            <div className="flex flex-col items-start gap-1">
              {row.original.customerIds.map((id) => (
                <CustomerAvatar key={id} customerId={id} />
              ))}
            </div>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: customers?.map((c) => ({
              value: c.id,
              label: c.name
            })),
            isArray: true
          },
          icon: <LuSquareUser />
        }
      },
      {
        accessorKey: "customerTypeIds",
        header: t`Customer Type`,
        cell: ({ row }) => {
          if (!row.original.customerTypeIds?.length) return null;
          return (
            <div className="flex flex-col items-start gap-1">
              {row.original.customerTypeIds.map((id) => {
                const label =
                  customerTypes?.find((ct) => ct.value === id)?.label ?? "Type";
                return <Enumerable key={id} value={label} />;
              })}
            </div>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: customerTypes?.map((ct) => ({
              value: ct.value,
              label: <Enumerable value={ct.label} />
            })),
            isArray: true
          },
          icon: <LuUsers />
        }
      },
      {
        accessorKey: "itemIds",
        header: t`Items`,
        cell: ({ row }) => {
          if (!row.original.itemIds?.length) return null;
          return (
            <div className="flex flex-col items-start gap-1">
              {row.original.itemIds.map((id) => {
                const item = items?.find((i) => i.id === id);
                return (
                  <Badge key={id} variant="outline">
                    {item?.readableIdWithRevision ?? id}
                  </Badge>
                );
              })}
            </div>
          );
        },
        meta: {
          filter: {
            type: "static",
            options: items?.map((item) => ({
              value: item.id,
              label: item.readableIdWithRevision
            })),
            isArray: true
          },
          pluralHeader: t`Items`,
          icon: <LuPackage />
        }
      },
      {
        accessorKey: "itemPostingGroupId",
        header: t`Item Group`,
        cell: ({ row }) => {
          if (!row.original.itemPostingGroupId) return null;
          const label =
            itemPostingGroups?.find(
              (g) => g.value === row.original.itemPostingGroupId
            )?.label ?? "Item Group";
          return <Enumerable value={label} />;
        },
        meta: {
          filter: {
            type: "static",
            options: itemPostingGroups?.map((g) => ({
              value: g.value,
              label: <Enumerable value={g.label} />
            }))
          },
          icon: <LuBoxes />
        }
      },
      {
        id: "customerScope",
        header: t`Customers`,
        cell: ({ row }) => {
          const rule = row.original;
          const parts: React.ReactNode[] = [];

          if (rule.customerIds?.length) {
            rule.customerIds.forEach((id) => {
              parts.push(<CustomerAvatar key={`c-${id}`} customerId={id} />);
            });
          }
          if (rule.customerTypeIds?.length) {
            rule.customerTypeIds.forEach((id) => {
              const label =
                customerTypes?.find((ct) => ct.value === id)?.label ?? "Type";
              parts.push(<Enumerable key={`ct-${id}`} value={label} />);
            });
          }

          if (parts.length === 0) {
            return (
              <span className="text-muted-foreground text-sm">{t`All`}</span>
            );
          }
          return <div className="flex flex-col items-start gap-1">{parts}</div>;
        },
        meta: {
          icon: <LuSquareUser />
        }
      },
      {
        id: "itemScope",
        header: t`Items`,
        cell: ({ row }) => {
          const rule = row.original;
          const groupLabel = rule.itemPostingGroupId
            ? (itemPostingGroups?.find(
                (g) => g.value === rule.itemPostingGroupId
              )?.label ?? "Item Group")
            : null;
          const itemIds = rule.itemIds ?? [];
          const firstItem = itemIds[0]
            ? items?.find((i) => i.id === itemIds[0])
            : null;
          const remainingItems = itemIds.slice(1);

          if (!groupLabel && itemIds.length === 0) {
            return (
              <span className="text-muted-foreground text-sm">{t`All`}</span>
            );
          }

          return (
            <HStack spacing={1} className="flex-wrap">
              {groupLabel && <Enumerable value={groupLabel} />}
              {itemIds[0] && (
                <Badge variant="outline">
                  {firstItem?.readableIdWithRevision ?? itemIds[0]}
                </Badge>
              )}
              {remainingItems.length > 0 && (
                <HoverCard>
                  <HoverCardTrigger>
                    <Badge variant="secondary" className="cursor-pointer">
                      +{remainingItems.length}
                    </Badge>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-[260px]">
                    <div className="flex flex-col items-start gap-1 text-sm">
                      {remainingItems.map((id) => {
                        const item = items?.find((i) => i.id === id);
                        return (
                          <Badge key={`i-${id}`} variant="outline">
                            {item?.readableIdWithRevision ?? id}
                          </Badge>
                        );
                      })}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </HStack>
          );
        },
        meta: {
          icon: <LuPackage />
        }
      },
      {
        id: "dates",
        header: t`Dates`,
        cell: ({ row }) => {
          const { validFrom, validTo } = row.original;
          if (!validFrom && !validTo) {
            return (
              <span className="text-muted-foreground text-sm">{t`Always`}</span>
            );
          }
          const from = validFrom ? formatDate(validFrom) : "…";
          const to = validTo ? formatDate(validTo) : "…";
          return <span className="text-sm">{`${from} – ${to}`}</span>;
        },
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "green" : "gray"}>
            {row.original.active ? t`Active` : t`Inactive`}
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: t`Active` },
              { value: "false", label: t`Inactive` }
            ]
          },
          icon: <LuToggleLeft />
        }
      }
    ];
    return defaultColumns;
  }, [
    currencyFormatter,
    customers,
    customerTypes,
    itemPostingGroups,
    items,
    params,
    percentFormatter,
    t
  ]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            disabled={!canUpdate}
            onClick={() => {
              navigate(`${path.to.pricingRule(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {t`Edit Pricing Rule`}
          </MenuItem>
          <MenuItem
            disabled={!canCreate}
            onClick={() => {
              fetcher.submit(
                { intent: "duplicate" },
                {
                  method: "POST",
                  action: path.to.pricingRule(row.id)
                }
              );
            }}
          >
            <MenuIcon icon={<LuCopy />} />
            {t`Duplicate Pricing Rule`}
          </MenuItem>
          <MenuItem
            destructive
            disabled={!canDelete}
            onClick={() => {
              navigate(
                `${path.to.deletePricingRule(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            {t`Delete Pricing Rule`}
          </MenuItem>
        </>
      );
    },
    [canCreate, canDelete, canUpdate, fetcher, navigate, params, t]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      columns={columns}
      count={count}
      defaultColumnVisibility={defaultColumnVisibility}
      primaryAction={
        canCreate && (
          <New
            label={t`Pricing Rule`}
            to={`${path.to.newPricingRule}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Pricing Rules`}
    />
  );
});

PricingRulesTable.displayName = "PricingRulesTable";
export default PricingRulesTable;
