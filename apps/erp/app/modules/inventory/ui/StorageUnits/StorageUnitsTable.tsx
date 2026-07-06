import { LabelDownloadModal } from "@carbon/printing/ui";
import {
  Button,
  Checkbox,
  Combobox,
  HStack,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  toast,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuBookMarked,
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuLayers,
  LuMapPin,
  LuPencil,
  LuPlus,
  LuPrinter,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useStorageTypes } from "~/components/Form/StorageTypes";
import { IndeterminateCheckbox } from "~/components/Table/components";
import { usePermissions, usePrinting, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type StorageUnit = {
  id: string;
  name: string;
  locationId: string | null;
  active: boolean;
  parentId: string | null;
  depth: number | null;
  ancestorPath: string[] | null;
  storageTypeIds: string[] | null;
};

type StorageUnitsTableProps = {
  data: StorageUnit[];
  count: number;
  locations: { id: string; name: string }[];
  locationId: string;
  storageTypes: { id: string; name: string }[];
  parentIdsWithChildren: string[];
  initialExpanded: string[];
};

const StorageUnitsTable = memo(
  ({
    data,
    count,
    locations: serverLocations,
    locationId,
    storageTypes: serverStorageTypes,
    parentIdsWithChildren,
    initialExpanded
  }: StorageUnitsTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();

    // Locations come from the server loader so the Location column resolves
    // names on first paint. Fall back to the client-side useLocations() hook
    // only if the server payload is somehow missing.
    const clientLocations = useLocations();
    const locations = useMemo(() => {
      if (serverLocations && serverLocations.length > 0) {
        return serverLocations.map((l) => ({ value: l.id, label: l.name }));
      }
      return clientLocations;
    }, [serverLocations, clientLocations]);

    // Storage types come from the server loader so the Storage Types column
    // resolves names on first paint. Fall back to the client-side
    // useStorageTypes() hook only if the server payload is somehow missing.
    const clientStorageTypes = useStorageTypes();
    const storageTypes = useMemo(() => {
      if (serverStorageTypes && serverStorageTypes.length > 0) {
        return serverStorageTypes.map((st) => ({
          value: st.id,
          label: st.name
        }));
      }
      return clientStorageTypes;
    }, [serverStorageTypes, clientStorageTypes]);

    const hasChildrenSet = useMemo(
      () => new Set(parentIdsWithChildren),
      [parentIdsWithChildren]
    );

    // Partition `data` into children-by-parentId. In root-mode (no search)
    // every row is a root and this map is empty. In search-mode it contains
    // the ancestor chains for each match so the tree can render without
    // additional fetches.
    const initialChildrenCache = useMemo(() => {
      const map: Record<string, StorageUnit[]> = {};
      for (const row of data) {
        if (row.parentId) {
          (map[row.parentId] ??= []).push(row);
        }
      }
      return map;
    }, [data]);

    const [childrenCache, setChildrenCache] =
      useState<Record<string, StorageUnit[]>>(initialChildrenCache);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(
      () => new Set(initialExpanded)
    );
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Reset tree state only when the loader payload MEANINGFULLY changes
    // (location switch, search, pagination). Keying on object identity would
    // also fire on every revalidation (e.g. after a fetcher POST or opening
    // a drawer route), collapsing the tree and wiping the selection.
    const dataSignature = useMemo(
      () =>
        `${locationId}::${data.map((r) => r.id).join(",")}::${initialExpanded.join(",")}`,
      [locationId, data, initialExpanded]
    );
    const prevSignature = useRef(dataSignature);
    useEffect(() => {
      if (prevSignature.current === dataSignature) return;
      prevSignature.current = dataSignature;
      setChildrenCache(initialChildrenCache);
      setExpandedIds(new Set(initialExpanded));
      setLoadingIds(new Set());
      setSelectedIds(new Set());
    }, [dataSignature, initialChildrenCache, initialExpanded]);

    // Keep a ref to the cache so the recursive descendant walk always sees
    // the latest children without stale-closure issues.
    const childrenCacheRef = useRef(childrenCache);
    childrenCacheRef.current = childrenCache;

    const collectDescendantIds = useCallback((id: string): string[] => {
      const cache = childrenCacheRef.current;
      const out: string[] = [];
      const walk = (parentId: string) => {
        for (const kid of cache[parentId] ?? []) {
          out.push(kid.id);
          walk(kid.id);
        }
      };
      walk(id);
      return out;
    }, []);

    const toggleExpand = useCallback(
      async (id: string) => {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });

        // Only fetch if not collapsing and we don't already have children.
        const isExpanding = !expandedIds.has(id);
        if (!isExpanding) return;
        if (childrenCache[id]) return;

        setLoadingIds((prev) => new Set(prev).add(id));
        try {
          const res = await fetch(path.to.api.storageUnitChildren(id));
          const body = (await res.json()) as { data: StorageUnit[] };
          const kids = body.data ?? [];
          setChildrenCache((prev) => ({ ...prev, [id]: kids }));
          // Newly loaded children inherit a selected parent's selection
          setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            for (const kid of kids) next.add(kid.id);
            return next;
          });
        } finally {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      },
      [expandedIds, childrenCache]
    );

    // Checking a unit cascades to all loaded descendants; unchecking removes
    // them. A parent with some (but not all of) its subtree selected renders
    // as indeterminate.
    const toggleSelected = useCallback(
      (id: string) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          const isSelecting = !next.has(id);
          if (isSelecting) {
            next.add(id);
            for (const descId of collectDescendantIds(id)) next.add(descId);
          } else {
            next.delete(id);
            for (const descId of collectDescendantIds(id)) next.delete(descId);
          }
          return next;
        });
      },
      [collectDescendantIds]
    );

    // Build the displayed flat-row list by walking roots and recursing into
    // expanded subtrees. Roots = depth-1 rows in `data` (true for both
    // root-mode and search-mode payloads).
    const displayRows = useMemo(() => {
      const out: StorageUnit[] = [];
      const roots = data.filter((r) => (r.depth ?? 1) === 1);

      const walk = (node: StorageUnit) => {
        out.push(node);
        if (!expandedIds.has(node.id)) return;
        const kids = childrenCache[node.id];
        if (!kids) return;
        for (const kid of kids) walk(kid);
      };

      for (const root of roots) walk(root);
      return out;
    }, [data, expandedIds, childrenCache]);

    const allSelected =
      displayRows.length > 0 && displayRows.every((r) => selectedIds.has(r.id));
    const someSelected = selectedIds.size > 0 && !allSelected;

    const toggleAllSelected = useCallback(() => {
      setSelectedIds((prev) => {
        const visible = displayRows.map((r) => r.id);
        const everyVisibleSelected =
          visible.length > 0 && visible.every((id) => prev.has(id));
        return everyVisibleSelected ? new Set() : new Set(visible);
      });
    }, [displayRows]);

    const columns = useMemo<ColumnDef<StorageUnit>[]>(() => {
      return [
        {
          // The id "Select" opts into the Table's compact checkbox-column
          // styling (px-2, shrink-to-fit width).
          id: "Select",
          size: 50,
          minSize: 1,
          header: () => (
            <IndeterminateCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={toggleAllSelected}
            />
          ),
          cell: ({ row }) => {
            const id = row.original.id;
            const isChecked = selectedIds.has(id);
            const isIndeterminate =
              !isChecked &&
              collectDescendantIds(id).some((descId) =>
                selectedIds.has(descId)
              );
            return (
              <IndeterminateCheckbox
                checked={isChecked}
                indeterminate={isIndeterminate}
                onChange={() => toggleSelected(id)}
              />
            );
          }
        },
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => {
            const depth = Math.max(0, (row.original.depth ?? 1) - 1);
            const isExpanded = expandedIds.has(row.original.id);
            const isLoading = loadingIds.has(row.original.id);
            const hasChildren = hasChildrenSet.has(row.original.id);

            return (
              <div className="flex flex-1">
                {Array.from({ length: depth }).map((_, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="w-5 shrink-0 border-l border-border -my-2"
                  />
                ))}
                <div className="w-5 shrink-0 flex items-center justify-center self-center">
                  {hasChildren ? (
                    isLoading ? (
                      <Spinner className="size-3" />
                    ) : (
                      <button
                        type="button"
                        aria-label={
                          isExpanded ? t`Collapse subtree` : t`Expand subtree`
                        }
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          toggleExpand(row.original.id);
                        }}
                      >
                        {isExpanded ? (
                          <LuChevronDown className="size-4" />
                        ) : (
                          <LuChevronRight className="size-4" />
                        )}
                      </button>
                    )
                  ) : null}
                </div>
                <div className="flex items-center py-1">
                  <Hyperlink
                    to={`${path.to.storageUnit(row.original.id)}?${params}`}
                  >
                    <span
                      className={
                        depth === 0 ? "font-medium" : "text-foreground/90"
                      }
                    >
                      {row.original.name}
                    </span>
                  </Hyperlink>
                </div>
              </div>
            );
          },
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => {
            const location = locations.find(
              (l) => l.value === row.original.locationId
            );
            return (
              <Enumerable value={location?.label ?? row.original.locationId} />
            );
          },
          meta: {
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "storageTypeIds",
          header: t`Storage Types`,
          cell: ({ row }) => {
            if (!row.original.storageTypeIds?.length) return null;
            return (
              <HStack spacing={1}>
                {row.original.storageTypeIds.map((id) => {
                  const label =
                    storageTypes?.find((st) => st.value === id)?.label ?? id;
                  return <Enumerable key={id} value={label} />;
                })}
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: storageTypes?.map((st) => ({
                value: st.value,
                label: <Enumerable value={st.label} />
              })),
              isArray: true
            },
            pluralHeader: t`Storage Types`,
            icon: <LuLayers />
          }
        },

        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" }
              ]
            },
            pluralHeader: t`Active Statuses`,
            icon: <LuCheck />
          }
        }
      ];
    }, [
      locations,
      params,
      storageTypes,
      t,
      expandedIds,
      loadingIds,
      hasChildrenSet,
      toggleExpand,
      selectedIds,
      allSelected,
      someSelected,
      toggleAllSelected,
      toggleSelected,
      collectDescendantIds
    ]);

    /* Bulk printing */
    const { printerRoutes, resolvePrinterRoute } = usePrinting();
    const printerModal = useDisclosure();
    const downloadModal = useDisclosure();
    const defaultPrinter = resolvePrinterRoute(locationId, "inventory");
    const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
    const [isPrinting, setIsPrinting] = useState(false);

    const handlePrintLabels = useCallback(() => {
      if (printerRoutes.length > 0) {
        setSelectedPrinterId(defaultPrinter?.id ?? printerRoutes[0]?.id ?? "");
        printerModal.onOpen();
      } else {
        downloadModal.onOpen();
      }
    }, [printerRoutes, defaultPrinter?.id, printerModal, downloadModal]);

    // Raw fetch (not a fetcher): parallel submissions don't abort each other
    // and nothing revalidates, so the tree and selection stay intact.
    const handleConfirmPrint = useCallback(async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0 || !selectedPrinterId) return;

      setIsPrinting(true);
      try {
        const results = await Promise.allSettled(
          ids.map((id) =>
            fetch(path.to.manualPrint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceDocument: "StorageUnit",
                sourceDocumentId: id,
                locationId,
                printerRouteId: selectedPrinterId
              })
            })
          )
        );

        const failed = results.filter(
          (r) => r.status === "rejected" || !r.value.ok
        ).length;

        if (failed > 0) {
          toast.error(
            `${failed} of ${ids.length} print job${ids.length === 1 ? "" : "s"} failed`
          );
        } else {
          toast.success(
            `Queued ${ids.length} label${ids.length === 1 ? "" : "s"} for printing`
          );
        }
      } finally {
        setIsPrinting(false);
        printerModal.onClose();
      }
    }, [selectedIds, selectedPrinterId, locationId, printerModal]);

    const defaultColumnVisibility = {
      active: false
    };

    const defaultColumnPinning = {
      left: ["Select", "name"]
    };

    const actions = useMemo(() => {
      return (
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="secondary"
              leftIcon={<LuPrinter />}
              onClick={handlePrintLabels}
            >
              <Trans>Print {selectedIds.size} Labels</Trans>
            </Button>
          )}
          <Combobox
            asButton
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              window.location.href = getLocationPath(selected);
            }}
          />

          <New
            label={t`Storage Unit`}
            to={`${path.to.newStorageUnit}?location=${locationId}`}
          />
        </div>
      );
    }, [locationId, locations, t, selectedIds.size, handlePrintLabels]);

    const renderContextMenu = useCallback(
      (row: StorageUnit) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(`${path.to.storageUnit(row.id)}?${params.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Storage Unit</Trans>
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("create", "inventory")}
              onClick={() => {
                const newParams = new URLSearchParams(params);
                newParams.set("parentId", row.id);
                if (row.locationId) newParams.set("location", row.locationId);
                navigate(`${path.to.newStorageUnit}?${newParams.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPlus />} />
              <Trans>Add Child Storage Unit</Trans>
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "inventory")}
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteStorageUnit(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Storage Unit</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <>
        <Table<StorageUnit>
          count={count}
          columns={columns}
          data={displayRows}
          defaultColumnVisibility={defaultColumnVisibility}
          defaultColumnPinning={defaultColumnPinning}
          primaryAction={actions}
          renderContextMenu={renderContextMenu}
          title={t`Storage Units`}
          table="storageUnit"
          withSavedView
        />
        {printerModal.isOpen && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open) printerModal.onClose();
            }}
          >
            <ModalContent>
              <ModalHeader>
                <ModalTitle>
                  <Trans>Select Printer</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-1">
                  {printerRoutes.map((route) => (
                    <button
                      type="button"
                      key={route.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selectedPrinterId === route.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      }`}
                      onClick={() => setSelectedPrinterId(route.id)}
                    >
                      <LuPrinter className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">
                          {route.name}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2 uppercase">
                          {route.format}
                        </span>
                        {route.mediaSizeId && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {route.mediaSizeId}
                          </span>
                        )}
                      </div>
                      {selectedPrinterId === route.id && (
                        <LuCheck className="size-4 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </ModalBody>
              <ModalFooter>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    leftIcon={<LuPrinter />}
                    disabled={!selectedPrinterId || isPrinting}
                    onClick={handleConfirmPrint}
                  >
                    <Trans>Print {selectedIds.size} Labels</Trans>
                  </Button>
                  <Button variant="solid" onClick={printerModal.onClose}>
                    <Trans>Cancel</Trans>
                  </Button>
                </div>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
        {downloadModal.isOpen && selectedIds.size > 0 && (
          <StorageUnitDownloadModal
            ids={Array.from(selectedIds)}
            isOpen={downloadModal.isOpen}
            onClose={downloadModal.onClose}
          />
        )}
      </>
    );
  }
);

StorageUnitsTable.displayName = "StorageUnitsTable";

export default StorageUnitsTable;

function StorageUnitDownloadModal({
  ids,
  isOpen,
  onClose
}: {
  ids: string[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <LabelDownloadModal
      sourceDocumentId=""
      fileRoutes={{
        pdf: (_id: string, opts?: { labelSize?: string }) =>
          path.to.file.storageUnitLabelsPdf(ids, opts),
        zpl: (_id: string, opts?: { labelSize?: string }) =>
          path.to.file.storageUnitLabelsZpl(ids, opts)
      }}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function getLocationPath(locationId: string) {
  return `${path.to.storageUnits}?location=${locationId}`;
}
