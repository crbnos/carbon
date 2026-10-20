// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuFactory,
  LuPencil,
  LuPlus,
  LuShoppingCart,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { Table } from "~/components";
import {
  EditableByRow,
  EditableList,
  EditableNumber,
  EditableText,
  useStableEditableComponents
} from "~/components/Editable";
import {
  Combobox,
  DatePicker,
  Hidden,
  Input,
  Location,
  Number as NumberField,
  Select,
  Submit,
  Supplier
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { rowMenuColumn, useCellSave } from "~/components/Setup";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { methodType } from "~/modules/shared/shared.models";
import type { loader as createPurchaseOrderLineLoader } from "~/routes/x+/project+/$projectId.elements.$elementId.create-po-line";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import {
  createJobFromMaterialValidator,
  createPurchaseOrderLineFromMaterialValidator,
  NEW_PURCHASE_ORDER,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  remainingMaterialQuantity
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useElementRoutes } from "../Elements/ElementRoutes";
import { orderPlanRows, type PlanLineType } from "./plan-rows";

type PlanLines = ProjectElementPage["planLines"];
type MaterialLine = PlanLines["materials"][number];
type LaborLine = PlanLines["labor"][number];
type CostLine = PlanLines["costs"][number];

export type { PlanLineType };
type MethodType = (typeof methodType)[number];

/**
 * One row of the plan grid. `line` is the item (material), the labor
 * category (labor) or the description (cost); `quantity` is a material's
 * quantity or a labor line's hours; `date` is a material's required date or
 * a labor line's start. A `draft` row comes from "Add line": it saves once
 * its line is set, and keeps its place (with the new `id`) until the saved
 * line is back from the server.
 */
type PlanRow = {
  key: string;
  id: string | null;
  draft: boolean;
  createdAt: string | null;
  type: PlanLineType;
  line: string;
  methodType: MethodType | null;
  quantity: number | null;
  unitOfMeasureCode: string | null;
  unitCost: number | null;
  amount: number | null;
  date: string | null;
  endDate: string | null;
  material?: MaterialLine;
};

const dash = <span className="text-muted-foreground">—</span>;

const INTENT = {
  material: "upsertMaterial",
  labor: "upsertLabor",
  cost: "upsertCost"
} as const;

const DELETE_INTENT = {
  material: "deleteMaterial",
  labor: "deleteLabor",
  cost: "deleteCost"
} as const;

/** A new line: one each of quantity and hours, pulled from inventory. */
function draftRow(type: PlanLineType, key: string): PlanRow {
  return {
    key,
    id: null,
    draft: true,
    createdAt: null,
    type,
    line: "",
    methodType: type === "material" ? "Pull from Inventory" : null,
    quantity: type === "cost" ? null : 1,
    unitOfMeasureCode: null,
    unitCost: null,
    amount: type === "cost" ? 0 : null,
    date: null,
    endDate: null
  };
}

/** A material line's amount: quantity × unit cost, unrounded (display rounds). */
function materialAmount(quantity: number | null, unitCost: number | null) {
  return unitCost === null ? null : (quantity ?? 0) * unitCost;
}

/** A labor line's amount: its hours at the category's cost rate today, as
 *  the plan cost on the Costs page reads it. No rate, no amount. */
function laborAmount(hours: number | null, costRate: number | null) {
  return costRate === null ? null : (hours ?? 0) * costRate;
}

/** The id the plan route answers for a line it created. */
function savedLineId(body: unknown) {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : null;
}

/** The fields a row posts: the whole line, so a save never clears a column. */
function rowFields(row: PlanRow): Record<string, string> {
  const text = (value: string | number | null) =>
    value === null || value === undefined ? "" : String(value);
  const fields: Record<string, string> = {
    intent: INTENT[row.type],
    id: row.id ?? ""
  };
  switch (row.type) {
    case "material":
      return {
        ...fields,
        itemId: row.line,
        methodType: row.methodType ?? "Pull from Inventory",
        quantity: text(row.quantity),
        unitOfMeasureCode: text(row.unitOfMeasureCode),
        unitCost: text(row.unitCost),
        requiredDate: text(row.date)
      };
    case "labor":
      return {
        ...fields,
        laborCategoryId: row.line,
        hours: text(row.quantity),
        startDate: text(row.date),
        endDate: text(row.endDate)
      };
    case "cost":
      return {
        ...fields,
        description: row.line,
        amount: text(row.amount)
      };
  }
}

/**
 * The plan of one element in ONE grid: materials, labor and other costs,
 * with a Type column. Each cell saves on its own through the plan route
 * (`quiet`), posting the whole line. "Add line" appends a draft row, which
 * saves once its line (item, labor category or description) is set.
 */
export function ElementPlanLines({
  projectId,
  elementId,
  planLines,
  laborCategories,
  defaultLocationId,
  isDisabled,
  action: actionOverride,
  canSupply = true,
  addRequest,
  addDisabledReason
}: {
  projectId: string;
  elementId: string;
  planLines: PlanLines;
  /** The active categories, each with its cost rate in effect today. */
  laborCategories: { id: string; name: string; costRate?: number | null }[];
  /** The project's location: where a job made from a material is built. */
  defaultLocationId?: string | null;
  isDisabled: boolean;
  /** The plan route; a service template posts to its own. */
  action?: string;
  /** Offers Create Job and Create PO Line on a material (not on a template). */
  canSupply?: boolean;
  /** Each new value adds a draft material row (a service template's
   *  "Add plan line" menu item). */
  addRequest?: number;
  /** Why "Add line" is off (a locked plan); shown as its tooltip. */
  addDisabledReason?: string | null;
}) {
  const { t } = useLingui();
  const save = useCellSave();
  const formatMoney = useCurrencyFormatter();
  const formatRate = useCurrencyFormatter({ rate: true });
  const formatQuantity = useQuantityFormatter();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const typeLabels = useMemo<Record<PlanLineType, string>>(
    () => ({ material: t`Material`, labor: t`Labor`, cost: t`Cost` }),
    [t]
  );
  const [items] = useItems();
  const permissions = usePermissions();
  const canCreateJob = permissions.can("create", "production");
  const canCreatePurchaseOrderLine = permissions.can("create", "purchasing");
  const changeRequestId = useActiveChangeRequestId();
  const routes = useElementRoutes(projectId);
  const action =
    actionOverride ??
    withChangeRequest(routes.plan(elementId), changeRequestId);

  const [drafts, setDrafts] = useState<PlanRow[]>([]);
  const draftCount = useRef(0);
  const addDraft = useCallback((type: PlanLineType) => {
    draftCount.current += 1;
    setDrafts((previous) => [
      ...previous,
      draftRow(type, `draft-${draftCount.current}`)
    ]);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per request
  useEffect(() => {
    if (addRequest) addDraft("material");
  }, [addRequest]);

  // A saved material line whose item just changed: its new unit and cost
  // show at once, until the saved line is back from the server.
  const [itemChanges, setItemChanges] = useState<
    Record<string, Pick<PlanRow, "line" | "unitOfMeasureCode" | "unitCost">>
  >({});

  const [deleting, setDeleting] = useState<PlanRow | null>(null);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [creatingJob, setCreatingJob] = useState<MaterialLine | null>(null);
  const [creatingLine, setCreatingLine] = useState<MaterialLine | null>(null);

  // The ids of the saved lines: a saved draft leaves the drafts once its
  // line is among them.
  const savedIds = useMemo(
    () =>
      new Set([
        ...planLines.materials.map((line) => line.id),
        ...planLines.labor.map((line) => line.id),
        ...planLines.costs.map((line) => line.id)
      ]),
    [planLines]
  );
  const landedItemIds = useMemo(
    () => new Map(planLines.materials.map((line) => [line.id, line.itemId])),
    [planLines]
  );
  useEffect(() => {
    const landed = Object.entries(itemChanges).filter(
      ([id, change]) => landedItemIds.get(id) === change.line
    );
    if (landed.length > 0) {
      setItemChanges((previous) => {
        const next = { ...previous };
        for (const [id] of landed) delete next[id];
        return next;
      });
    }
  }, [itemChanges, landedItemIds]);
  useEffect(() => {
    if (drafts.some((d) => d.id !== null && savedIds.has(d.id))) {
      setDrafts((previous) =>
        previous.filter((d) => d.id === null || !savedIds.has(d.id))
      );
    }
  }, [drafts, savedIds]);

  const costRateById = useMemo(
    () => new Map(laborCategories.map((c) => [c.id, c.costRate ?? null])),
    [laborCategories]
  );

  const rows = useMemo<PlanRow[]>(
    () =>
      orderPlanRows([
        ...planLines.materials.map<PlanRow>((line) => {
          const change =
            itemChanges[line.id]?.line !== line.itemId
              ? itemChanges[line.id]
              : undefined;
          const quantity = Number(line.quantity);
          const unitCost = change
            ? change.unitCost
            : line.unitCost === null
              ? null
              : Number(line.unitCost);
          return {
            key: line.id,
            id: line.id,
            draft: false,
            createdAt: line.createdAt ?? null,
            type: "material",
            line: change?.line ?? line.itemId,
            methodType: line.methodType,
            quantity,
            unitOfMeasureCode: change
              ? change.unitOfMeasureCode
              : (line.unitOfMeasureCode ?? null),
            unitCost,
            amount: materialAmount(quantity, unitCost),
            date: line.requiredDate ?? null,
            endDate: null,
            material: line
          };
        }),
        ...planLines.labor.map<PlanRow>((line: LaborLine) => ({
          key: line.id,
          id: line.id,
          draft: false,
          createdAt: line.createdAt ?? null,
          type: "labor",
          line: line.laborCategoryId,
          methodType: null,
          quantity: Number(line.hours),
          unitOfMeasureCode: null,
          unitCost: costRateById.get(line.laborCategoryId) ?? null,
          amount: laborAmount(
            Number(line.hours),
            costRateById.get(line.laborCategoryId) ?? null
          ),
          date: line.startDate ?? null,
          endDate: line.endDate ?? null
        })),
        ...planLines.costs.map<PlanRow>((line: CostLine) => ({
          key: line.id,
          id: line.id,
          draft: false,
          createdAt: line.createdAt ?? null,
          type: "cost",
          line: line.description,
          methodType: null,
          quantity: null,
          unitOfMeasureCode: null,
          unitCost: null,
          amount: Number(line.amount),
          date: null,
          endDate: null
        })),
        ...drafts.filter((d) => d.id === null || !savedIds.has(d.id))
      ]),
    [planLines, drafts, savedIds, itemChanges, costRateById]
  );

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const categoriesById = useMemo(
    () => new Map(laborCategories.map((c) => [c.id, c.name])),
    [laborCategories]
  );

  // The item's current cost (`itemCost.unitCost`), as the job and quote
  // material forms read it; null when the item has no cost row.
  const { carbon } = useCarbon();
  const loadItemUnitCost = useCallback(
    async (itemId: string) => {
      if (!carbon) return null;
      const cost = await carbon
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle();
      if (cost.error || cost.data?.unitCost == null) return null;
      return Number(cost.data.unitCost);
    },
    [carbon, company.id]
  );

  // A cell edit posts the whole row with the change. A draft keeps each
  // change; once its line is set it posts, takes the new line's id (so a
  // second edit updates that line), and stays in its place until the saved
  // line is back from the server.
  const onCellEdit = useCallback(
    async (accessorKey: string, value: unknown, row: PlanRow) => {
      const raw = value === null || value === undefined ? null : value;
      const next: PlanRow = { ...row, [accessorKey]: raw };
      if (accessorKey === "quantity" || accessorKey === "unitCost") {
        next[accessorKey] = raw === null || raw === "" ? null : Number(raw);
      }
      if (accessorKey === "amount") {
        next.amount = raw === null || raw === "" ? 0 : Number(raw);
      }
      // A new item brings its own unit and its current cost.
      if (accessorKey === "line" && row.type === "material" && raw) {
        const itemId = String(raw);
        next.unitOfMeasureCode =
          itemsById.get(itemId)?.unitOfMeasureCode ?? null;
        next.unitCost = await loadItemUnitCost(itemId);
      }
      if (row.type === "material") {
        next.amount = materialAmount(next.quantity, next.unitCost);
      }
      if (row.type === "labor") {
        next.unitCost = costRateById.get(String(next.line)) ?? null;
        next.amount = laborAmount(next.quantity, next.unitCost);
      }
      if (!row.draft) {
        const changesItem = accessorKey === "line" && row.type === "material";
        const id = row.id;
        if (changesItem && id) {
          setItemChanges((previous) => ({
            ...previous,
            [id]: {
              line: next.line,
              unitOfMeasureCode: next.unitOfMeasureCode,
              unitCost: next.unitCost
            }
          }));
        }
        const result = await save(action, rowFields(next));
        if (result.error && changesItem && id) {
          setItemChanges((previous) => {
            const { [id]: _failed, ...rest } = previous;
            return rest;
          });
        }
        return result;
      }

      const putDraft = (draft: PlanRow) =>
        setDrafts((previous) =>
          previous.map((d) => (d.key === row.key ? draft : d))
        );
      putDraft(next);
      if (!next.line) {
        return { data: null, error: null } as Awaited<ReturnType<typeof save>>;
      }
      const result = await save(action, rowFields(next));
      if (result.error) {
        putDraft(row);
      } else if (next.id === null) {
        const savedId = savedLineId(result.data);
        if (savedId) {
          putDraft({ ...next, id: savedId });
        } else {
          setDrafts((previous) => previous.filter((d) => d.key !== row.key));
        }
      }
      return result;
    },
    [action, save, itemsById, loadItemUnitCost, costRateById]
  );

  const stable = useStableEditableComponents(
    (latest) => {
      const edit = (key: string, value: unknown, row: PlanRow) =>
        latest.current.onCellEdit(key, value, row);
      return {
        description: EditableText<PlanRow>(edit),
        quantity: EditableNumber<PlanRow>(edit, {
          minValue: 0,
          formatOptions: INPUT_FORMAT.quantity,
          step: INPUT_STEP.quantity
        }),
        unitCost: EditableNumber<PlanRow>(edit, {
          minValue: 0,
          formatOptions: INPUT_FORMAT.rate(currency, decimals),
          step: INPUT_STEP.rate
        }),
        amount: EditableNumber<PlanRow>(edit, {
          formatOptions: INPUT_FORMAT.money(currency, decimals),
          step: INPUT_STEP.money(decimals)
        })
      };
    },
    { onCellEdit }
  );

  // A list editor takes its options when it is built: rebuilt only when the
  // options change (a pick commits at once; nothing is typed).
  const latestOnCellEdit = useRef(onCellEdit);
  useEffect(() => {
    latestOnCellEdit.current = onCellEdit;
  });
  const lists = useMemo(() => {
    const edit = (key: string, value: string, row: PlanRow) =>
      latestOnCellEdit.current(key, value, row);
    return {
      item: EditableList<PlanRow>(
        edit,
        items.map((item) => ({
          value: item.id,
          label: `${item.readableIdWithRevision} ${item.name}`
        }))
      ),
      laborCategory: EditableList<PlanRow>(
        edit,
        laborCategories.map((c) => ({ value: c.id, label: c.name }))
      )
    };
  }, [items, laborCategories]);

  const editableComponents = useMemo(() => {
    const none = () => <span className="text-muted-foreground">—</span>;
    return {
      line: EditableByRow<PlanRow>(
        (row) =>
          row.type === "material"
            ? lists.item
            : row.type === "labor"
              ? lists.laborCategory
              : stable.description,
        none
      ),
      quantity: EditableByRow<PlanRow>(
        (row) => (row.type === "cost" ? null : stable.quantity),
        none
      ),
      // A material's unit cost is typed; a labor line's is its category's
      // cost rate, read-only; a cost line has none.
      unitCost: EditableByRow<PlanRow>(
        (row) => (row.type === "material" ? stable.unitCost : null),
        ({ row }) =>
          row.unitCost === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">
              {formatRate.format(row.unitCost)}
            </span>
          )
      ),
      amount: EditableByRow<PlanRow>(
        (row) => (row.type === "cost" ? stable.amount : null),
        ({ row }) =>
          row.amount === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">
              {formatMoney.format(row.amount)}
            </span>
          )
      )
    };
  }, [lists, stable, formatMoney, formatRate]);

  const columns = useMemo<ColumnDef<PlanRow>[]>(
    () => [
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {typeLabels[row.original.type]}
          </span>
        )
      },
      {
        accessorKey: "line",
        header: t`Line`,
        cell: ({ row }) => {
          const { type, line } = row.original;
          if (!line) {
            return (
              <span className="text-muted-foreground">
                {type === "material"
                  ? t`Choose an item`
                  : type === "labor"
                    ? t`Choose a labor category`
                    : t`Describe the cost`}
              </span>
            );
          }
          if (type === "material") {
            const item = itemsById.get(line);
            const material = row.original.material;
            const purchaseOrder = material?.purchaseOrderLine?.purchaseOrder;
            // Capped, so a long item name truncates instead of pushing
            // Amount and the row menu past the grid's edge.
            return (
              <span
                className="flex min-w-0 max-w-56 items-center gap-2"
                title={item?.name ?? material?.item?.name}
              >
                <span className="shrink-0 whitespace-nowrap">
                  {item?.readableIdWithRevision ??
                    material?.item?.readableIdWithRevision}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {item?.name ?? material?.item?.name}
                </span>
                {material?.job && (
                  <Link
                    to={path.to.job(material.job.id)}
                    className="shrink-0 text-xs text-muted-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {material.job.jobId}
                  </Link>
                )}
                {purchaseOrder && (
                  <Link
                    to={path.to.purchaseOrderDetails(purchaseOrder.id)}
                    className="shrink-0 text-xs text-muted-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {purchaseOrder.purchaseOrderId}
                  </Link>
                )}
              </span>
            );
          }
          return (
            <span className="block max-w-56 truncate">
              {type === "labor" ? (categoriesById.get(line) ?? line) : line}
            </span>
          );
        }
      },
      {
        accessorKey: "quantity",
        header: t`Quantity`,
        cell: ({ row }) =>
          row.original.quantity === null ? (
            dash
          ) : (
            <span className="whitespace-nowrap tabular-nums">
              {formatQuantity(row.original.quantity)}{" "}
              <span className="text-muted-foreground">
                {row.original.type === "labor"
                  ? t`h`
                  : (row.original.unitOfMeasureCode ?? "")}
              </span>
            </span>
          )
      },
      {
        accessorKey: "unitCost",
        header: t`Unit Cost`,
        cell: ({ row }) =>
          row.original.unitCost === null ? (
            dash
          ) : (
            <span className="tabular-nums">
              {formatRate.format(row.original.unitCost)}
            </span>
          )
      },
      {
        accessorKey: "amount",
        header: t`Amount`,
        cell: ({ row }) =>
          row.original.amount === null ? (
            dash
          ) : (
            <span className="tabular-nums">
              {formatMoney.format(row.original.amount)}
            </span>
          )
      }
    ],
    [
      t,
      typeLabels,
      itemsById,
      categoriesById,
      formatQuantity,
      formatMoney,
      formatRate
    ]
  );

  const renderMenu = useCallback(
    (row: PlanRow) => {
      const material = row.material;
      const canMakeJob =
        canSupply &&
        material?.methodType === "Make to Order" &&
        !material.jobId;
      const canMakeLine =
        canSupply &&
        material?.methodType === "Purchase to Order" &&
        !material.purchaseOrderLineId;
      return (
        <>
          {row.id !== null && (
            <MenuItem disabled={isDisabled} onClick={() => setEditing(row)}>
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit</Trans>
            </MenuItem>
          )}
          {canMakeJob && material && (
            <MenuItem
              disabled={!canCreateJob}
              onClick={() => setCreatingJob(material)}
            >
              <MenuIcon icon={<LuFactory />} />
              <Trans>Create Job</Trans>
            </MenuItem>
          )}
          {canMakeLine && material && (
            <MenuItem
              disabled={!canCreatePurchaseOrderLine}
              onClick={() => setCreatingLine(material)}
            >
              <MenuIcon icon={<LuShoppingCart />} />
              <Trans>Create PO Line</Trans>
            </MenuItem>
          )}
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={isDisabled}
            onClick={() => {
              if (row.id === null) {
                setDrafts((previous) =>
                  previous.filter((d) => d.key !== row.key)
                );
              } else {
                setDeleting(row);
              }
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete</Trans>
          </MenuItem>
        </>
      );
    },
    [canSupply, canCreateJob, canCreatePurchaseOrderLine, isDisabled]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderMenu, t`Actions`)],
    [columns, renderMenu, t]
  );

  const addLine = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuPlus />}
          rightIcon={<LuChevronDown />}
          className="self-start"
          isDisabled={Boolean(addDisabledReason)}
        >
          <Trans>Add line</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(["material", "labor", "cost"] as const).map((type) => (
          <DropdownMenuItem key={type} onClick={() => addDraft(type)}>
            {typeLabels[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const deletingName =
    deleting === null
      ? ""
      : deleting.type === "material"
        ? (itemsById.get(deleting.line)?.readableIdWithRevision ?? t`Material`)
        : deleting.type === "labor"
          ? (categoriesById.get(deleting.line) ?? t`Labor`)
          : deleting.line;

  return (
    <div className="flex w-full flex-col gap-2">
      {rows.length > 0 && (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <Table<PlanRow>
            autoHeight
            compact
            columns={gridColumns}
            data={rows}
            count={rows.length}
            getRowId={(row) => row.key}
            editableComponents={editableComponents}
            withInlineEditing={!isDisabled}
            forceEditMode={!isDisabled}
            withPagination={false}
            withSearch={false}
            withSimpleSorting={false}
            withSidebarTrigger={false}
            withColumnOrdering={false}
            withCsvExport={false}
            sort={null}
          />
        </div>
      )}
      {!isDisabled &&
        (addDisabledReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button fires no pointer events: the span does. */}
              <span tabIndex={0} className="self-start">
                {addLine}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {addDisabledReason}
            </TooltipContent>
          </Tooltip>
        ) : (
          addLine
        ))}

      {editing && (
        <PlanLineModal
          row={editing}
          elementId={elementId}
          action={action}
          laborCategories={laborCategories}
          onClose={() => setEditing(null)}
        />
      )}
      {creatingJob && (
        <CreateJobModal
          projectId={projectId}
          elementId={elementId}
          line={creatingJob}
          defaultLocationId={defaultLocationId}
          onClose={() => setCreatingJob(null)}
        />
      )}
      {creatingLine && (
        <CreatePurchaseOrderLineModal
          projectId={projectId}
          elementId={elementId}
          line={creatingLine}
          onClose={() => setCreatingLine(null)}
        />
      )}
      {deleting && deleting.id && (
        <ConfirmDelete
          action={action}
          name={deletingName}
          text={t`Remove ${deletingName} from the plan?`}
          fields={{ intent: DELETE_INTENT[deleting.type], id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => {
            // A saved draft whose line is not back yet goes with it.
            setDrafts((previous) =>
              previous.filter((d) => d.key !== deleting.key)
            );
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function useMethodTypeLabels(): Record<MethodType, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      "Purchase to Order": t`Purchase to Order`,
      "Pull from Inventory": t`Pull from Inventory`,
      "Make to Order": t`Make to Order`
    }),
    [t]
  );
}

/**
 * The whole plan line, for the fields the grid leaves out: a material's
 * method and unit cost and required date, a labor line's dates. It posts
 * the same upsert intent as a grid cell, without `quiet`.
 */
function PlanLineModal({
  row,
  elementId,
  action,
  laborCategories,
  onClose
}: {
  row: PlanRow;
  elementId: string;
  action: string;
  laborCategories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const methodLabels = useMethodTypeLabels();
  const fetcher = useAction<{ success?: boolean }>({
    onSuccess: () => onClose()
  });

  const title =
    row.type === "material"
      ? t`Edit material`
      : row.type === "labor"
        ? t`Edit labor`
        : t`Edit cost`;

  const form = (() => {
    switch (row.type) {
      case "material":
        return {
          validator: projectElementMaterialValidator,
          defaultValues: {
            id: row.id ?? undefined,
            projectElementId: elementId,
            itemId: row.line,
            methodType: row.methodType ?? "Pull from Inventory",
            quantity: row.quantity ?? 1,
            unitOfMeasureCode: row.unitOfMeasureCode ?? undefined,
            unitCost: row.unitCost ?? undefined,
            requiredDate: row.date ?? undefined
          },
          fields: (
            <>
              <Combobox
                name="itemId"
                label={t`Item`}
                options={items.map((item) => ({
                  value: item.id,
                  label: item.readableIdWithRevision,
                  helper: item.name
                }))}
              />
              <Select
                name="methodType"
                label={t`Method`}
                options={methodType.map((value) => ({
                  value,
                  label: methodLabels[value]
                }))}
              />
              <NumberField
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <NumberField
                name="unitCost"
                label={t`Unit Cost`}
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(currency, decimals)}
                step={INPUT_STEP.rate}
              />
              <DatePicker name="requiredDate" label={t`Required Date`} />
              <Hidden name="unitOfMeasureCode" />
            </>
          )
        };
      case "labor":
        return {
          validator: projectElementLaborValidator,
          defaultValues: {
            id: row.id ?? undefined,
            projectElementId: elementId,
            laborCategoryId: row.line,
            hours: row.quantity ?? 1,
            startDate: row.date ?? undefined,
            endDate: row.endDate ?? undefined
          },
          fields: (
            <>
              <Select
                name="laborCategoryId"
                label={t`Labor Category`}
                termId="labor-category"
                options={laborCategories.map((category) => ({
                  value: category.id,
                  label: category.name
                }))}
              />
              <NumberField
                name="hours"
                label={t`Hours`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <DatePicker name="startDate" label={t`Start Date`} />
              <DatePicker name="endDate" label={t`End Date`} />
            </>
          )
        };
      case "cost":
        return {
          validator: projectElementCostValidator,
          defaultValues: {
            id: row.id ?? undefined,
            projectElementId: elementId,
            description: row.line,
            amount: row.amount ?? 0
          },
          fields: (
            <>
              <Input name="description" label={t`Description`} />
              <NumberField
                name="amount"
                label={t`Amount`}
                formatOptions={INPUT_FORMAT.money(currency, decimals)}
                step={INPUT_STEP.money(decimals)}
              />
            </>
          )
        };
    }
  })();

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          // The three line shapes share one form element.
          validator={form.validator as typeof projectElementMaterialValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={form.defaultValues}
        >
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value={INTENT[row.type]} />
            <Hidden name="id" />
            <Hidden name="projectElementId" />
            <VStack spacing={4}>{form.fields}</VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * Create Job for a Make to Order material: the quantity still needed, by the
 * plan line's required date, at the project's location. The action
 * redirects to the new job; a refusal shows in the modal.
 */
function CreateJobModal({
  projectId,
  elementId,
  line,
  defaultLocationId,
  onClose
}: {
  projectId: string;
  elementId: string;
  line: MaterialLine;
  defaultLocationId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { defaults } = useUser();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={createJobFromMaterialValidator}
          method="post"
          action={path.to.projectElementCreateJob(projectId, elementId)}
          fetcher={fetcher}
          defaultValues={{
            materialId: line.id,
            quantity: remainingMaterialQuantity(line) || Number(line.quantity),
            dueDate: line.requiredDate ?? undefined,
            locationId: defaultLocationId ?? defaults?.locationId ?? ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create Job</Trans>
            </ModalTitle>
            <ModalDescription>
              {line.item?.readableIdWithRevision} {line.item?.name}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="materialId" />
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <NumberField
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <DatePicker name="dueDate" label={t`Due Date`} />
              <Location name="locationId" label={t`Location`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Create Job</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * Create PO line for a Purchase to Order material: the supplier (the item's
 * preferred one first), the quantity still needed in the plan line's unit,
 * the required date, and the supplier's Draft purchase order at the
 * project's location to add to, or a new one. The action redirects to the
 * purchase order; a refusal shows in the modal.
 */
function CreatePurchaseOrderLineModal({
  projectId,
  elementId,
  line,
  onClose
}: {
  projectId: string;
  elementId: string;
  line: MaterialLine;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const resource = path.to.projectElementCreatePurchaseOrderLine(
    projectId,
    elementId
  );
  const optionsFetcher = useFetcher<typeof createPurchaseOrderLineLoader>();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;
  // Undefined until the user picks a supplier: the loader's preferred one.
  const [pickedSupplierId, setPickedSupplierId] = useState<string>();

  const load = optionsFetcher.load;
  useEffect(() => {
    const params = new URLSearchParams({ materialId: line.id });
    if (pickedSupplierId) params.set("supplierId", pickedSupplierId);
    load(`${resource}?${params}`);
  }, [load, resource, line.id, pickedSupplierId]);

  const options = optionsFetcher.data;
  const purchaseOrderOptions = [
    { value: NEW_PURCHASE_ORDER, label: t`New purchase order` },
    ...(options?.purchaseOrders ?? []).map((po) => ({
      value: po.id,
      label: po.purchaseOrderId
    }))
  ];

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        {options === undefined ? (
          <ModalBody>
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          </ModalBody>
        ) : (
          <ValidatedForm
            // The options of a newly picked supplier restart the form with
            // its purchase orders.
            key={options.supplierId ?? ""}
            validator={createPurchaseOrderLineFromMaterialValidator}
            method="post"
            action={resource}
            fetcher={fetcher}
            defaultValues={{
              materialId: line.id,
              supplierId: options.supplierId ?? "",
              quantity:
                remainingMaterialQuantity(line) || Number(line.quantity),
              requiredDate: line.requiredDate ?? undefined,
              purchaseOrderId:
                options.purchaseOrders[0]?.id ?? NEW_PURCHASE_ORDER
            }}
          >
            <ModalHeader>
              <ModalTitle>
                <Trans>Create PO Line</Trans>
              </ModalTitle>
              <ModalDescription>
                {line.item?.readableIdWithRevision} {line.item?.name}
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              <Hidden name="materialId" />
              <VStack spacing={4}>
                {errorMessage && (
                  <Alert variant="destructive">
                    <LuTriangleAlert />
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                )}
                <Supplier
                  name="supplierId"
                  label={t`Supplier`}
                  onChange={(option) => {
                    if (option?.value && option.value !== options.supplierId) {
                      setPickedSupplierId(option.value);
                    }
                  }}
                />
                <NumberField
                  name="quantity"
                  label={t`Quantity`}
                  helperText={
                    line.unitOfMeasureCode
                      ? t`In ${line.unitOfMeasureCode}; the supplier part's conversion factor gives the purchase quantity`
                      : t`The supplier part's conversion factor gives the purchase quantity`
                  }
                  minValue={0}
                  formatOptions={INPUT_FORMAT.quantity}
                  step={INPUT_STEP.quantity}
                />
                <DatePicker name="requiredDate" label={t`Required Date`} />
                <Select
                  name="purchaseOrderId"
                  label={t`Add to`}
                  options={purchaseOrderOptions}
                />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false}>
                <Trans>Create PO Line</Trans>
              </Submit>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}
