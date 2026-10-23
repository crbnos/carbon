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
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  LuChevronDown,
  LuEllipsis,
  LuFactory,
  LuPencil,
  LuPlus,
  LuShoppingCart,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  Combobox,
  DatePicker,
  Hidden,
  Input,
  Location,
  NumberControlled,
  Number as NumberField,
  Select,
  Submit,
  Supplier
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
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
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  remainingMaterialQuantity
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.service";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useElementRoutes } from "../Elements/ElementRoutes";
import {
  CostCard,
  CostToolbar,
  FigureSeparator,
  NoMatchingCosts,
  useCostTypeLabels
} from "./CostCards";
import {
  type CostTypeFilter,
  costDescriptionKey,
  type EstimatedSort,
  isOverBudget,
  keyOwners,
  matchesSearch,
  planProgress,
  sortPlanCards
} from "./cost-cards";
import { orderPlanRows, type PlanLineType } from "./plan-rows";

type PlanLines = ProjectElementPage["planLines"];
type PlanActuals = ProjectElementPage["planActuals"];
type MaterialLine = PlanLines["materials"][number];

export type { PlanLineType };

type MethodType = (typeof methodType)[number];

/**
 * One plan line as the edit modal reads it. `line` is the item (material),
 * the labor category (labor) or the description (cost); `quantity` is a
 * material's quantity or a labor line's hours; `date` is a material's
 * required date or a labor line's start. A line with no `id` is new.
 */
type PlanRow = {
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
};

/** One Estimated card: the plan line, its estimate and what it has had. */
type PlanCard = PlanRow & {
  key: string;
  id: string;
  createdAt: string | null;
  draft: false;
  title: string;
  subtitle: string | null;
  searchText: (string | null | undefined)[];
  plannedQuantity: number | null;
  actualQuantity: number | null;
  /** Labor only: hours logged but not posted yet. */
  openQuantity: number;
  plannedAmount: number | null;
  actualAmount: number;
  material?: MaterialLine;
};

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
function newRow(type: PlanLineType): PlanRow {
  return {
    id: null,
    type,
    line: "",
    methodType: type === "material" ? "Pull from Inventory" : null,
    quantity: type === "cost" ? null : 1,
    unitOfMeasureCode: null,
    unitCost: null,
    amount: null,
    date: null,
    endDate: null
  };
}

/**
 * The plan of one element as cards: materials, labor and other costs, each
 * with its estimate, what has been charged against it, and the button that
 * charges more (Issue, Log time, Charge). A card opens its line's edit
 * modal; "Add line" opens the same modal for a new line. Each line posts
 * to the plan route.
 *
 * A charge finds its line by key: a material by its item, labor by its
 * category, a cost by its description. When two lines share a key, the
 * oldest takes the whole actual (`keyOwners`), as `post-project-issue`
 * raises the oldest line's issued quantity.
 */
export function ElementPlanLines({
  projectId,
  elementId,
  planLines,
  planActuals,
  laborCategories,
  defaultLocationId,
  isDisabled,
  canSupply = true,
  addDisabledReason,
  onIssue,
  onLogTime,
  onCharge
}: {
  projectId: string;
  elementId: string;
  planLines: PlanLines;
  planActuals: PlanActuals;
  /** The active categories, each with its cost rate in effect today. */
  laborCategories: { id: string; name: string; costRate?: number | null }[];
  /** The project's location: where a job made from a material is built. */
  defaultLocationId?: string | null;
  isDisabled: boolean;
  /** Offers Create Job and Create PO Line on a material (not on a template). */
  canSupply?: boolean;
  /** Why "Add line" is off (a locked plan); shown as its tooltip. */
  addDisabledReason?: string | null;
  /** Issue material against a line; absent when the user cannot. */
  onIssue?: (line: { itemId: string; quantity: number }) => void;
  /** Log time against a labor line; absent when the user cannot. */
  onLogTime?: (line: { laborCategoryId: string }) => void;
  /** Charge a cost against a cost line; absent when the user cannot. */
  onCharge?: (line: { description: string; amount: number }) => void;
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const typeLabels = useCostTypeLabels();
  const methodLabels = useMethodTypeLabels();
  const [items] = useItems();
  const permissions = usePermissions();
  const canCreateJob = permissions.can("create", "production");
  const canCreatePurchaseOrderLine = permissions.can("create", "purchasing");
  const changeRequestId = useActiveChangeRequestId();
  const routes = useElementRoutes(projectId);
  const action = withChangeRequest(routes.plan(elementId), changeRequestId);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CostTypeFilter>("all");
  const [sort, setSort] = useState<EstimatedSort>("plan");
  const [deleting, setDeleting] = useState<PlanCard | null>(null);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [creatingJob, setCreatingJob] = useState<MaterialLine | null>(null);
  const [creatingLine, setCreatingLine] = useState<MaterialLine | null>(null);

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const categoriesById = useMemo(
    () => new Map(laborCategories.map((c) => [c.id, c])),
    [laborCategories]
  );

  const cards = useMemo<PlanCard[]>(() => {
    const materialOwners = keyOwners(planLines.materials, (l) => l.itemId);
    const laborOwners = keyOwners(planLines.labor, (l) => l.laborCategoryId);
    const costOwners = keyOwners(planLines.costs, (l) =>
      costDescriptionKey(l.description)
    );
    const materialActuals = new Map(
      planActuals.materials.map((a) => [a.itemId, a.amount])
    );
    const laborActuals = new Map(
      planActuals.labor.map((a) => [a.laborCategoryId, a])
    );
    const costActuals = new Map(
      planActuals.costs.map((a) => [a.description, a.amount])
    );

    return orderPlanRows<PlanCard>([
      ...planLines.materials.map<PlanCard>((line) => {
        const item = itemsById.get(line.itemId);
        const quantity = Number(line.quantity);
        const unitCost = line.unitCost === null ? null : Number(line.unitCost);
        const title =
          item?.readableIdWithRevision ??
          line.item?.readableIdWithRevision ??
          "";
        const name = item?.name ?? line.item?.name ?? null;
        return {
          key: line.id,
          id: line.id,
          createdAt: line.createdAt ?? null,
          draft: false,
          type: "material",
          line: line.itemId,
          methodType: line.methodType,
          quantity,
          unitOfMeasureCode: line.unitOfMeasureCode ?? null,
          unitCost,
          amount: unitCost === null ? null : quantity * unitCost,
          date: line.requiredDate ?? null,
          endDate: null,
          title,
          subtitle: name,
          searchText: [title, name, methodLabels[line.methodType]],
          plannedQuantity: quantity,
          actualQuantity: Number(line.quantityIssued ?? 0),
          openQuantity: 0,
          plannedAmount: unitCost === null ? null : quantity * unitCost,
          actualAmount: materialOwners.has(line.id)
            ? (materialActuals.get(line.itemId) ?? 0)
            : 0,
          material: line
        };
      }),
      ...planLines.labor.map<PlanCard>((line) => {
        const category = categoriesById.get(line.laborCategoryId);
        const hours = Number(line.hours);
        const costRate = category?.costRate ?? null;
        const actual = laborOwners.has(line.id)
          ? laborActuals.get(line.laborCategoryId)
          : undefined;
        const title =
          category?.name ?? line.laborCategory?.name ?? line.laborCategoryId;
        return {
          key: line.id,
          id: line.id,
          createdAt: line.createdAt ?? null,
          draft: false,
          type: "labor",
          line: line.laborCategoryId,
          methodType: null,
          quantity: hours,
          unitOfMeasureCode: null,
          unitCost: costRate,
          amount: costRate === null ? null : hours * costRate,
          date: line.startDate ?? null,
          endDate: line.endDate ?? null,
          title,
          subtitle: null,
          searchText: [title],
          plannedQuantity: hours,
          actualQuantity: actual?.hours ?? 0,
          openQuantity: actual?.openHours ?? 0,
          plannedAmount: costRate === null ? null : hours * costRate,
          actualAmount: actual?.amount ?? 0
        };
      }),
      ...planLines.costs.map<PlanCard>((line) => ({
        key: line.id,
        id: line.id,
        createdAt: line.createdAt ?? null,
        draft: false,
        type: "cost",
        line: line.description,
        methodType: null,
        quantity: null,
        unitOfMeasureCode: null,
        unitCost: null,
        amount: Number(line.amount),
        date: null,
        endDate: null,
        title: line.description,
        subtitle: null,
        searchText: [line.description],
        plannedQuantity: null,
        actualQuantity: null,
        openQuantity: 0,
        plannedAmount: Number(line.amount),
        actualAmount: costOwners.has(line.id)
          ? (costActuals.get(costDescriptionKey(line.description)) ?? 0)
          : 0
      }))
    ]);
  }, [planLines, planActuals, itemsById, categoriesById, methodLabels]);

  const visibleCards = useMemo(
    () =>
      sortPlanCards(
        cards.filter(
          (card) =>
            (typeFilter === "all" || card.type === typeFilter) &&
            matchesSearch([...card.searchText, typeLabels[card.type]], search)
        ),
        sort
      ),
    [cards, typeFilter, search, sort, typeLabels]
  );

  const sorts = useMemo<{ value: EstimatedSort; label: string }[]>(
    () => [
      { value: "plan", label: t`Plan order` },
      { value: "amount", label: t`Estimate` },
      { value: "remaining", label: t`Remaining` },
      { value: "over", label: t`Over estimate first` }
    ],
    [t]
  );

  const chargeButton = useCallback(
    (card: PlanCard) => {
      if (card.type === "material") {
        const item = itemsById.get(card.line);
        // Only stocked items can be issued: Non-Inventory items have no stock.
        if (!onIssue || item?.itemTrackingType === "Non-Inventory") return null;
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onIssue({
                itemId: card.line,
                quantity: card.material
                  ? remainingMaterialQuantity(card.material)
                  : 0
              })
            }
          >
            <Trans>Issue</Trans>
          </Button>
        );
      }
      if (card.type === "labor") {
        if (!onLogTime) return null;
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onLogTime({ laborCategoryId: card.line })}
          >
            <Trans>Log time</Trans>
          </Button>
        );
      }
      if (!onCharge) return null;
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onCharge({
              description: card.line,
              amount: Math.max(0, (card.plannedAmount ?? 0) - card.actualAmount)
            })
          }
        >
          <Trans>Charge</Trans>
        </Button>
      );
    },
    [itemsById, onIssue, onLogTime, onCharge]
  );

  const menu = (card: PlanCard) => {
    const material = card.material;
    const canMakeJob =
      canSupply && material?.methodType === "Make to Order" && !material.jobId;
    const canMakeLine =
      canSupply &&
      material?.methodType === "Purchase to Order" &&
      !material.purchaseOrderLineId;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`More options`}
            icon={<LuEllipsis />}
            variant="ghost"
            size="sm"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={isDisabled}
            onClick={() => setEditing(card)}
          >
            <DropdownMenuIcon icon={<LuPencil />} />
            <Trans>Edit</Trans>
          </DropdownMenuItem>
          {canMakeJob && material && (
            <DropdownMenuItem
              disabled={!canCreateJob}
              onClick={() => setCreatingJob(material)}
            >
              <DropdownMenuIcon icon={<LuFactory />} />
              <Trans>Create Job</Trans>
            </DropdownMenuItem>
          )}
          {canMakeLine && material && (
            <DropdownMenuItem
              disabled={!canCreatePurchaseOrderLine}
              onClick={() => setCreatingLine(material)}
            >
              <DropdownMenuIcon icon={<LuShoppingCart />} />
              <Trans>Create PO Line</Trans>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={isDisabled}
            onClick={() => setDeleting(card)}
          >
            <DropdownMenuIcon icon={<LuTrash />} />
            <Trans>Delete</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const figures = (card: PlanCard) => {
    const money = (value: number) => formatMoney.format(value);
    const parts: ReactNode[] = [];
    if (card.type === "material") {
      parts.push(
        <span key="quantity">
          {t`${formatQuantity(card.actualQuantity ?? 0)} of ${formatQuantity(
            card.plannedQuantity ?? 0
          )} ${card.unitOfMeasureCode ?? ""} issued`}
        </span>
      );
    }
    if (card.type === "labor") {
      parts.push(
        <span key="hours">
          {t`${formatQuantity(card.actualQuantity ?? 0)} of ${formatQuantity(
            card.plannedQuantity ?? 0
          )} h`}
        </span>
      );
    }
    // A line with no cost (a material with no unit cost, a category with no
    // rate) shows money only once something is charged.
    if (card.plannedAmount !== null || card.actualAmount !== 0) {
      parts.push(
        <span key="amount">
          {card.plannedAmount === null
            ? money(card.actualAmount)
            : t`${money(card.actualAmount)} of ${money(card.plannedAmount)}`}
        </span>
      );
    }
    if (card.openQuantity > 0) {
      parts.push(
        <span key="open">
          {t`${formatQuantity(card.openQuantity)} h not posted yet`}
        </span>
      );
    }
    if (card.type === "material" && card.date) {
      parts.push(<span key="date">{t`Needed ${formatDate(card.date)}`}</span>);
    }
    if (card.type === "labor" && (card.date || card.endDate)) {
      parts.push(
        <span key="dates">
          {[card.date, card.endDate]
            .map((date) => (date ? formatDate(date) : "…"))
            .join(" – ")}
        </span>
      );
    }
    return parts.flatMap((part, index) =>
      index === 0 ? [part] : [<FigureSeparator key={`sep-${index}`} />, part]
    );
  };

  const badges = (card: PlanCard) => {
    const material = card.material;
    if (!material) return null;
    const purchaseOrder = material.purchaseOrderLine?.purchaseOrder;
    const showMethod = material.methodType !== "Pull from Inventory";
    if (!showMethod && !material.job && !purchaseOrder) return null;
    return (
      <>
        {showMethod && <span>{methodLabels[material.methodType]}</span>}
        {material.job && (
          <Link
            to={path.to.job(material.job.id)}
            className="hover:text-foreground hover:underline"
          >
            {material.job.jobId}
          </Link>
        )}
        {purchaseOrder && (
          <Link
            to={path.to.purchaseOrderDetails(purchaseOrder.id)}
            className="hover:text-foreground hover:underline"
          >
            {purchaseOrder.purchaseOrderId}
          </Link>
        )}
      </>
    );
  };

  const addLine = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuPlus />}
          rightIcon={<LuChevronDown />}
          isDisabled={Boolean(addDisabledReason)}
        >
          <Trans>Add line</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(["material", "labor", "cost"] as const).map((type) => (
          <DropdownMenuItem key={type} onClick={() => setEditing(newRow(type))}>
            {typeLabels[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const addAction = isDisabled ? null : addDisabledReason ? (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button fires no pointer events: the span does. */}
        <span tabIndex={0} className="inline-flex">
          {addLine}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{addDisabledReason}</TooltipContent>
    </Tooltip>
  ) : (
    addLine
  );

  const deletingName =
    deleting === null ? "" : deleting.title || typeLabels[deleting.type];

  return (
    <div className="flex w-full flex-col gap-3">
      {cards.length > 0 ? (
        <CostToolbar
          search={search}
          onSearchChange={setSearch}
          type={typeFilter}
          onTypeChange={setTypeFilter}
          sort={sort}
          sorts={sorts}
          onSortChange={setSort}
          action={addAction}
        />
      ) : (
        addAction && <div className="self-start">{addAction}</div>
      )}

      {cards.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {visibleCards.map((card) => {
            const isOver = isOverBudget(card);
            const charge = chargeButton(card);
            return (
              <CostCard
                key={card.key}
                type={card.type}
                title={card.title}
                subtitle={card.subtitle}
                badges={badges(card)}
                figures={figures(card)}
                isOver={isOver}
                progress={planProgress(card)}
                onOpen={isDisabled ? undefined : () => setEditing(card)}
                actions={
                  <>
                    {charge}
                    {menu(card)}
                  </>
                }
              />
            );
          })}
          {visibleCards.length === 0 && (
            <NoMatchingCosts>
              <Trans>No lines match the filters.</Trans>
            </NoMatchingCosts>
          )}
        </div>
      )}

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
      {deleting && (
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
 * One whole plan line, new or saved: a material's item, method, quantity,
 * unit cost and required date; a labor line's category, hours and dates; a
 * cost's description and amount. It posts the line's upsert intent to the
 * plan route.
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

  // A new item brings its own unit and its current cost
  // (`itemCost.unitCost`), as the job and quote material forms read it.
  const { carbon } = useCarbon();
  const [unitCost, setUnitCost] = useState<number | null>(row.unitCost);
  const [unitOfMeasureCode, setUnitOfMeasureCode] = useState(
    row.unitOfMeasureCode ?? ""
  );
  const onItemChange = async (itemId: string | undefined) => {
    if (!itemId) return;
    setUnitOfMeasureCode(
      items.find((item) => item.id === itemId)?.unitOfMeasureCode ?? ""
    );
    if (!carbon) return;
    const cost = await carbon
      .from("itemCost")
      .select("unitCost")
      .eq("itemId", itemId)
      .eq("companyId", company.id)
      .maybeSingle();
    setUnitCost(
      cost.error || cost.data?.unitCost == null
        ? null
        : Number(cost.data.unitCost)
    );
  };

  const isNew = row.id === null;
  const title =
    row.type === "material"
      ? isNew
        ? t`Add material`
        : t`Edit material`
      : row.type === "labor"
        ? isNew
          ? t`Add labor`
          : t`Edit labor`
        : isNew
          ? t`Add cost`
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
                onChange={(option) => onItemChange(option?.value)}
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
              <NumberControlled
                name="unitCost"
                label={t`Unit Cost`}
                value={unitCost ?? Number.NaN}
                onChange={(value) =>
                  setUnitCost(Number.isNaN(value) ? null : value)
                }
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(currency, decimals)}
                step={INPUT_STEP.rate}
              />
              <DatePicker name="requiredDate" label={t`Required Date`} />
              <Hidden name="unitOfMeasureCode" value={unitOfMeasureCode} />
            </>
          )
        };
      case "labor":
        return {
          validator: projectElementLaborValidator,
          defaultValues: {
            id: row.id ?? undefined,
            projectElementId: elementId,
            laborCategoryId: row.line || laborCategories[0]?.id || "",
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
            amount: row.amount ?? undefined
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
              {isNew ? <Trans>Add</Trans> : <Trans>Save</Trans>}
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
