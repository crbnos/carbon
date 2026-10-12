// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
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
  SplitButton,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuFactory,
  LuPlus,
  LuShoppingCart,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { Table } from "~/components";
import {
  EditableByRow,
  EditableDate,
  EditableList,
  EditableNumber,
  EditableText,
  useStableEditableComponents
} from "~/components/Editable";
import {
  DatePicker,
  Hidden,
  Location,
  Number as NumberField,
  Select,
  Submit,
  Supplier
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
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
  remainingMaterialQuantity
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";

type PlanLines = ProjectElementPage["planLines"];
type MaterialLine = PlanLines["materials"][number];
type LaborLine = PlanLines["labor"][number];
type CostLine = PlanLines["costs"][number];

export type PlanLineType = "material" | "labor" | "cost";
type MethodType = (typeof methodType)[number];

/**
 * One row of the plan grid. `line` is the item (material), the labor
 * category (labor) or the description (cost); `quantity` is a material's
 * quantity or a labor line's hours; `date` is a material's required date or
 * a labor line's start. A row with no `id` is a draft: it saves once its
 * line is set.
 */
type PlanRow = {
  key: string;
  id: string | null;
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
  addRequest
}: {
  projectId: string;
  elementId: string;
  planLines: PlanLines;
  laborCategories: { id: string; name: string }[];
  /** The project's location: where a job made from a material is built. */
  defaultLocationId?: string | null;
  isDisabled: boolean;
  /** The plan route; a service template posts to its own. */
  action?: string;
  /** Offers Create Job and Create PO Line on a material (not on a template). */
  canSupply?: boolean;
  /** Each new value adds a draft material row ("Add plan line" in a menu). */
  addRequest?: number;
}) {
  const { t } = useLingui();
  const save = useCellSave();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const methodLabels = useMethodTypeLabels();
  const typeLabels = useMemo<Record<PlanLineType, string>>(
    () => ({ material: t`Material`, labor: t`Labor`, cost: t`Cost` }),
    [t]
  );
  const [items] = useItems();
  const permissions = usePermissions();
  const canCreateJob = permissions.can("create", "production");
  const canCreatePurchaseOrderLine = permissions.can("create", "purchasing");
  const changeRequestId = useActiveChangeRequestId();
  const action =
    actionOverride ??
    withChangeRequest(
      path.to.projectElementPlan(projectId, elementId),
      changeRequestId
    );

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

  const [deleting, setDeleting] = useState<PlanRow | null>(null);
  const [creatingJob, setCreatingJob] = useState<MaterialLine | null>(null);
  const [creatingLine, setCreatingLine] = useState<MaterialLine | null>(null);

  const rows = useMemo<PlanRow[]>(
    () => [
      ...planLines.materials.map<PlanRow>((line) => ({
        key: line.id,
        id: line.id,
        type: "material",
        line: line.itemId,
        methodType: line.methodType,
        quantity: Number(line.quantity),
        unitOfMeasureCode: line.unitOfMeasureCode ?? null,
        unitCost: line.unitCost === null ? null : Number(line.unitCost),
        amount:
          line.unitCost === null
            ? null
            : Number(line.quantity) * Number(line.unitCost),
        date: line.requiredDate ?? null,
        endDate: null,
        material: line
      })),
      ...planLines.labor.map<PlanRow>((line: LaborLine) => ({
        key: line.id,
        id: line.id,
        type: "labor",
        line: line.laborCategoryId,
        methodType: null,
        quantity: Number(line.hours),
        unitOfMeasureCode: null,
        unitCost: null,
        amount: null,
        date: line.startDate ?? null,
        endDate: line.endDate ?? null
      })),
      ...planLines.costs.map<PlanRow>((line: CostLine) => ({
        key: line.id,
        id: line.id,
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
      ...drafts
    ],
    [planLines, drafts]
  );

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const categoriesById = useMemo(
    () => new Map(laborCategories.map((c) => [c.id, c.name])),
    [laborCategories]
  );

  // A cell edit posts the whole row with the change. A draft only keeps the
  // change until its line is set; then it posts and leaves the drafts.
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
      if (accessorKey === "line" && row.type === "material") {
        next.unitOfMeasureCode =
          itemsById.get(String(raw))?.unitOfMeasureCode ?? null;
      }
      if (row.id === null) {
        if (!next.line) {
          setDrafts((previous) =>
            previous.map((d) => (d.key === row.key ? next : d))
          );
          return { data: null, error: null } as Awaited<
            ReturnType<typeof save>
          >;
        }
        const result = await save(action, rowFields(next));
        if (!result.error) {
          setDrafts((previous) => previous.filter((d) => d.key !== row.key));
        }
        return result;
      }
      return save(action, rowFields(next));
    },
    [action, save, itemsById]
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
        unitCost: EditableNumber<PlanRow>(
          edit,
          {
            minValue: 0,
            formatOptions: INPUT_FORMAT.rate(currency, decimals),
            step: INPUT_STEP.rate
          },
          { clearable: true }
        ),
        amount: EditableNumber<PlanRow>(edit, {
          formatOptions: INPUT_FORMAT.money(currency, decimals),
          step: INPUT_STEP.money(decimals)
        }),
        date: EditableDate<PlanRow>(edit, {
          label: t`Date`,
          clearable: true
        }),
        endDate: EditableDate<PlanRow>(edit, {
          label: t`End`,
          clearable: true,
          bounds: (row) => ({ minValue: row.date ?? undefined })
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
      ),
      method: EditableList<PlanRow>(
        edit,
        methodType.map((value) => ({ value, label: methodLabels[value] }))
      )
    };
  }, [items, laborCategories, methodLabels]);

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
      methodType: EditableByRow<PlanRow>(
        (row) => (row.type === "material" ? lists.method : null),
        none
      ),
      quantity: EditableByRow<PlanRow>(
        (row) => (row.type === "cost" ? null : stable.quantity),
        none
      ),
      unitCost: EditableByRow<PlanRow>(
        (row) => (row.type === "material" ? stable.unitCost : null),
        none
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
      ),
      date: EditableByRow<PlanRow>(
        (row) => (row.type === "cost" ? null : stable.date),
        none
      ),
      endDate: EditableByRow<PlanRow>(
        (row) => (row.type === "labor" ? stable.endDate : null),
        none
      )
    };
  }, [lists, stable, formatMoney]);

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
            return (
              <span className="flex min-w-0 max-w-[260px] items-center gap-2">
                <span className="shrink-0 whitespace-nowrap">
                  {item?.readableIdWithRevision ??
                    row.original.material?.item?.readableIdWithRevision}
                </span>
                <span className="truncate text-muted-foreground">
                  {item?.name ?? row.original.material?.item?.name}
                </span>
              </span>
            );
          }
          return (
            <span className="block max-w-[260px] truncate">
              {type === "labor" ? (categoriesById.get(line) ?? line) : line}
            </span>
          );
        }
      },
      {
        accessorKey: "methodType",
        header: t`Method`,
        cell: ({ row }) => {
          const { methodType: method, material } = row.original;
          if (!method) return dash;
          const purchaseOrder = material?.purchaseOrderLine?.purchaseOrder;
          return (
            <span className="flex items-center gap-2 whitespace-nowrap">
              {methodLabels[method]}
              {material?.job && (
                <Link
                  to={path.to.job(material.job.id)}
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {material.job.jobId}
                </Link>
              )}
              {purchaseOrder && (
                <Link
                  to={path.to.purchaseOrderDetails(purchaseOrder.id)}
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {purchaseOrder.purchaseOrderId}
                </Link>
              )}
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
              {formatMoney.format(row.original.unitCost)}
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
      },
      {
        accessorKey: "date",
        header: t`Date`,
        cell: ({ row }) =>
          row.original.date ? (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(row.original.date)}
            </span>
          ) : (
            dash
          )
      },
      {
        accessorKey: "endDate",
        header: t`End`,
        cell: ({ row }) =>
          row.original.endDate ? (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(row.original.endDate)}
            </span>
          ) : (
            dash
          )
      }
    ],
    [
      t,
      typeLabels,
      itemsById,
      categoriesById,
      methodLabels,
      formatQuantity,
      formatMoney,
      formatDate
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
        <div
          className="w-full overflow-hidden rounded-lg border border-border"
          style={{ height: setupGridHeight(rows.length, 49) - 44 }}
        >
          <Table<PlanRow>
            compact
            columns={gridColumns}
            data={rows}
            count={rows.length}
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
      {!isDisabled && (
        <SplitButton
          variant="ghost"
          size="sm"
          leftIcon={<LuPlus />}
          className="self-start"
          onClick={() => addDraft("material")}
          dropdownItems={(["material", "labor", "cost"] as const).map(
            (type) => ({
              label: typeLabels[type],
              onClick: () => addDraft(type)
            })
          )}
        >
          <Trans>Add line</Trans>
        </SplitButton>
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
          onSubmit={() => setDeleting(null)}
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
