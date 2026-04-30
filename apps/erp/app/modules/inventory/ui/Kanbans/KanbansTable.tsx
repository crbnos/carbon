import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  copyToClipboard,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  MenuItem,
  PulsingDot,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCheck,
  LuContainer,
  LuHash,
  LuLink,
  LuMapPin,
  LuPackage,
  LuPencil,
  LuPrinter,
  LuQrCode,
  LuRefreshCw,
  LuSettings,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  New,
  SupplierAvatar,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUrlParams } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { kanbanOutputTypes } from "~/modules/settings/settings.models";
import { useSuppliers } from "~/stores";
import { useItems } from "~/stores/items";
import { usePeople } from "~/stores/people";
import { path } from "~/utils/path";
import type { Kanban } from "../../types";

type KanbansTableProps = {
  data: Kanban[];
  count: number;
  locationId: string;
  kanbanOutput: (typeof kanbanOutputTypes)[number];
};

const defaultColumnVisibility = {
  createdBy: false,
  supplierName: false,
  createdAt: false,
  updatedBy: false,
  updatedAt: false
};

const KanbansTable = memo(
  ({ data, count, locationId, kanbanOutput }: KanbansTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const { locale } = useLocale();

    const permissions = usePermissions();
    const [people] = usePeople();
    const [items] = useItems();
    const [suppliers] = useSuppliers();
    const locations = useLocations();

    const columns = useMemo<ColumnDef<Kanban>[]>(
      () => [
        {
          accessorKey: "itemId",
          header: t`Item`,
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
              />

              <Hyperlink to={`${path.to.kanban(row.original.id!)}?${params}`}>
                <VStack spacing={0}>
                  <div className="flex gap-1 items-center">
                    <span>{row.original.name}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {row.original.readableIdWithRevision}
                  </div>
                </VStack>
              </Hyperlink>
            </HStack>
          ),
          meta: {
            filter: {
              type: "static",
              options: items?.map((item) => ({
                value: item.id,
                label: item.readableIdWithRevision
              }))
            },
            icon: <LuPackage />
          }
        },
        {
          id: "job",
          header: "",
          cell: ({ row }) => {
            if (!row.original.jobReadableId || !row.original.jobId) return null;
            return (
              <Badge variant="outline">
                <Link
                  to={path.to.job(row.original.jobId)}
                  className="flex flex-row items-center gap-1"
                >
                  {row.original.jobReadableId}
                  <PulsingDot />
                </Link>
              </Badge>
            );
          }
        },
        {
          id: "links",
          header: "",
          cell: ({ row }) => (
            <>
              {kanbanOutput === "label" && (
                <HStack>
                  <Tooltip>
                    <TooltipTrigger>
                      <a
                        href={path.to.file.kanbanLabelsPdf(
                          [row.original.id!],
                          "order"
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Badge
                          variant="outline"
                          className="flex flex-row items-center gap-1"
                        >
                          <LuTag />
                          Create
                        </Badge>
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>
                      Label to create a{" "}
                      {row.original.replenishmentSystem === "Make"
                        ? "Job"
                        : "Order"}{" "}
                      for this kanban
                    </TooltipContent>
                  </Tooltip>
                  {row.original.replenishmentSystem === "Make" && (
                    <>
                      <Tooltip>
                        <TooltipTrigger>
                          <a
                            href={path.to.file.kanbanLabelsPdf(
                              [row.original.id!],
                              "start"
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Badge
                              variant="outline"
                              className="flex flex-row items-center gap-1"
                            >
                              <LuTag />
                              Start
                            </Badge>
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>
                          Label to start the next operation for this kanban
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <a
                            href={path.to.file.kanbanLabelsPdf(
                              [row.original.id!],
                              "complete"
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Badge
                              variant="outline"
                              className="flex flex-row items-center gap-1"
                            >
                              <LuTag />
                              Complete
                            </Badge>
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>
                          Label to complete the current operation for this
                          kanban
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </HStack>
              )}
              {kanbanOutput === "qrcode" && (
                <HStack>
                  <HoverCard>
                    <Tooltip>
                      <TooltipTrigger>
                        <HoverCardTrigger>
                          <Badge
                            variant="outline"
                            className="flex flex-row items-center gap-1 cursor-pointer"
                          >
                            <LuQrCode />
                            Create
                          </Badge>
                        </HoverCardTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        QR Code to create a{" "}
                        {row.original.replenishmentSystem === "Make"
                          ? "Job"
                          : "Order"}{" "}
                        for this kanban
                      </TooltipContent>
                    </Tooltip>
                    <HoverCardContent
                      align="center"
                      className="size-[236px] overflow-hidden z-[100] bg-white p-4"
                    >
                      <iframe
                        seamless
                        title={"Kanban QR Code"}
                        width="198"
                        height="198"
                        src={path.to.file.kanbanQrCode(
                          row.original.id!,
                          "order"
                        )}
                      />
                    </HoverCardContent>
                  </HoverCard>
                  {row.original.replenishmentSystem === "Make" && (
                    <>
                      <HoverCard>
                        <Tooltip>
                          <TooltipTrigger>
                            <HoverCardTrigger>
                              <Badge
                                variant="outline"
                                className="flex flex-row items-center gap-1 cursor-pointer"
                              >
                                <LuQrCode />
                                Start
                              </Badge>
                            </HoverCardTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            QR Code to start the next operation for this kanban
                          </TooltipContent>
                        </Tooltip>
                        <HoverCardContent
                          align="center"
                          className="size-[236px] overflow-hidden z-[100] bg-white p-4"
                        >
                          <iframe
                            seamless
                            title={"Kanban QR Code"}
                            width="198"
                            height="198"
                            src={path.to.file.kanbanQrCode(
                              row.original.id!,
                              "start"
                            )}
                          />
                        </HoverCardContent>
                      </HoverCard>

                      <HoverCard>
                        <Tooltip>
                          <TooltipTrigger>
                            <HoverCardTrigger>
                              <Badge
                                variant="outline"
                                className="flex flex-row items-center gap-1 cursor-pointer"
                              >
                                <LuQrCode />
                                Complete
                              </Badge>
                            </HoverCardTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            QR Code to complete the current operation for this
                            kanban
                          </TooltipContent>
                        </Tooltip>
                        <HoverCardContent
                          align="center"
                          className="size-[236px] overflow-hidden z-[100] bg-white p-4"
                        >
                          <iframe
                            seamless
                            title={"Kanban QR Code"}
                            width="198"
                            height="198"
                            src={path.to.file.kanbanQrCode(
                              row.original.id!,
                              "complete"
                            )}
                          />
                        </HoverCardContent>
                      </HoverCard>
                    </>
                  )}
                </HStack>
              )}
              {kanbanOutput === "url" && (
                <HStack>
                  <CopyBadge
                    text="Create"
                    url={path.to.api.kanban(row.original.id!)}
                    tooltip={`Copy link to create a ${
                      row.original.replenishmentSystem === "Make"
                        ? "Job"
                        : "Order"
                    } for this kanban`}
                  />
                  {row.original.replenishmentSystem === "Make" && (
                    <>
                      <CopyBadge
                        text="Start"
                        url={path.to.api.kanbanStart(row.original.id!)}
                        tooltip={`Copy link to start the next operation for this kanban`}
                      />

                      <CopyBadge
                        text="Complete"
                        url={path.to.api.kanbanComplete(row.original.id!)}
                        tooltip={`Copy link to complete the current operation for this kanban`}
                      />
                    </>
                  )}
                </HStack>
              )}
            </>
          )
        },
        {
          accessorKey: "quantity",
          header: t`Reorder Qty.`,
          cell: ({ row }) => {
            const { quantity, purchaseUnitOfMeasureCode } = row.original;
            const baseQuantity = quantity || 0;

            return (
              <span>
                {baseQuantity}
                {purchaseUnitOfMeasureCode && ` ${purchaseUnitOfMeasureCode}`}
              </span>
            );
          },
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "replenishmentSystem",
          header: t`Replenishment`,
          cell: ({ row }) => (
            <Enumerable value={row.original.replenishmentSystem} />
          ),
          meta: {
            filter: {
              type: "static",
              options: ["Buy", "Make"].map((type) => ({
                value: type,
                label: <Enumerable value={type} />
              }))
            },
            icon: <LuRefreshCw />
          }
        },
        {
          accessorKey: "supplierId",
          header: t`Supplier`,
          cell: ({ row }) => (
            <SupplierAvatar supplierId={row.original.supplierId} />
          ),
          meta: {
            icon: <LuContainer />,
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              }))
            }
          }
        },
        {
          accessorKey: "storageUnitName",
          header: t`Storage Unit`,
          cell: ({ row }) => row.original.storageUnitName || "",
          meta: {
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "autoRelease",
          header: t`Release`,
          cell: ({ row }) =>
            row.original.replenishmentSystem === "Make" ? (
              <div className="flex w-full items-center justify-center">
                <Checkbox isChecked={row.original.autoRelease ?? false} />
              </div>
            ) : null,
          meta: {
            icon: <LuCheck />,
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" }
              ]
            }
          }
        },
        {
          accessorKey: "autoStartJob",
          header: t`Start`,
          cell: ({ row }) =>
            row.original.replenishmentSystem === "Make" ? (
              <div className="flex w-full items-center justify-center">
                <Checkbox isChecked={row.original.autoRelease ?? false} />
              </div>
            ) : null,
          meta: {
            icon: <LuCheck />,
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" }
              ]
            }
          }
        },
        {
          accessorKey: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: ({ row }) =>
            row.original.createdAt
              ? new Date(row.original.createdAt).toLocaleDateString(locale)
              : "",
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "updatedBy",
          header: t`Updated By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: <Enumerable value={employee.name} />
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: ({ row }) =>
            row.original.updatedAt
              ? new Date(row.original.updatedAt).toLocaleDateString(locale)
              : "",
          meta: {
            icon: <LuCalendar />
          }
        }
      ],
      [items, kanbanOutput, params, people, suppliers, t]
    );

    const renderContextMenu = useCallback(
      (row: Kanban) => {
        const canUpdate = permissions.can("update", "inventory");
        const canDelete = permissions.can("delete", "inventory");
        const canViewItems = permissions.can("view", "inventory");

        return (
          <>
            {canUpdate && (
              <MenuItem asChild>
                <Link to={`${path.to.kanban(row.id!)}?${params}`}>
                  <LuPencil className="mr-2 size-4" />
                  Edit
                </Link>
              </MenuItem>
            )}
            {canViewItems &&
              row.itemId &&
              (() => {
                const item = items.find((i) => i.id === row.itemId);
                const itemType = item?.type;
                // Only show link for supported types (Service and Fixture not yet supported)
                if (
                  itemType === "Service" ||
                  itemType === "Fixture" ||
                  !itemType
                )
                  return null;
                return (
                  <MenuItem asChild>
                    <Link to={getLinkToItemDetails(itemType, row.itemId)}>
                      <MethodItemTypeIcon
                        type={itemType}
                        className="mr-2 size-4"
                      />
                      View Item Master
                    </Link>
                  </MenuItem>
                );
              })()}
            {canDelete && (
              <MenuItem destructive asChild>
                <Link to={`${path.to.deleteKanban(row.id!)}?${params}`}>
                  <LuTrash className="mr-2 size-4" />
                  Delete
                </Link>
              </MenuItem>
            )}
          </>
        );
      },
      [params, permissions, items.find]
    );

    const renderActions = useCallback((selectedRows: typeof data) => {
      const handlePrintLabels = () => {
        const selectedIds = selectedRows
          .map((row) => row.id)
          .filter(Boolean) as string[];
        if (selectedIds.length > 0) {
          window.open(
            path.to.file.kanbanLabelsPdf(selectedIds, "order"),
            "_blank"
          );
        }
      };

      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>
            <Trans>Actions</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={handlePrintLabels}>
              <LuPrinter className="mr-2 size-4" />
              Print Labels ({selectedRows.length})
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      );
    }, []);

    return (
      <Table<Kanban>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        primaryAction={
          <div className="flex items-center gap-2">
            <Combobox
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(selected);
              }}
            />
            <Button variant="secondary" asChild leftIcon={<LuSettings />}>
              <Link to={path.to.inventorySettings}>Settings</Link>
            </Button>
            {permissions.can("create", "inventory") && (
              <New label={t`Kanban`} to={path.to.newKanban} />
            )}
          </div>
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title={t`Kanbans`}
        table="kanban"
        withSavedView
        withSelectableRows
      />
    );
  }
);

KanbansTable.displayName = "KanbansTable";

export default KanbansTable;

function getLocationPath(locationId: string) {
  return `${path.to.kanbans}?location=${locationId}`;
}

function CopyBadge({
  text,
  url,
  tooltip
}: {
  text: string;
  url: string;
  tooltip: string;
}) {
  const { t } = useLingui();
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(window.location.origin + url);
    setIsCopied(true);
    toast.success(t`Copied link to clipboard`);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge
          variant="outline"
          className="flex flex-row items-center gap-1 cursor-pointer"
          onClick={handleCopy}
        >
          {isCopied ? <LuCheck className="text-emerald-500" /> : <LuLink />}
          {text}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
