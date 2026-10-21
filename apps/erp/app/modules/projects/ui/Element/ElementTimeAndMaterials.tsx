// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  LuChevronDown,
  LuPackageMinus,
  LuReceipt,
  LuTimer
} from "react-icons/lu";
import {
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter
} from "~/hooks";
import { useItems, usePeople } from "~/stores";
import type {
  ProjectCostType,
  TimesheetEntryStatus as TimesheetEntryStatusType
} from "../../projects.models";
import type {
  ElementLedgerRow,
  ElementOpenTimeRow
} from "../../projects.server";
import {
  CostCard,
  CostToolbar,
  FigureSeparator,
  NoMatchingCosts,
  useCostTypeLabels
} from "./CostCards";
import {
  type ActualSort,
  type CostTypeFilter,
  ledgerLineType,
  matchesSearch,
  sortActualCards
} from "./cost-cards";
import { OpenTimeAction } from "./OpenTimeAction";
import type { PlanLineType } from "./plan-rows";
import { TimesheetEntryStatus } from "./TimesheetEntryStatus";

type ActualCard = {
  key: string;
  type: PlanLineType;
  date: string;
  amount: number;
  searchText: (string | null | undefined)[];
  ledger?: ElementLedgerRow;
  openTime?: ElementOpenTimeRow;
};

/**
 * What has been charged to an element and every element below it, as
 * cards: the project ledger rows, then the timesheet entries that are not
 * Posted yet (Posted time is in the ledger), each with its next step. The
 * Charge menu issues material, logs time or charges a cost to the element.
 */
export function ElementTimeAndMaterials({
  ledger,
  openTime,
  elementReadableId,
  laborCategories,
  onIssue,
  onLogTime,
  onCharge
}: {
  ledger: ElementLedgerRow[];
  openTime: ElementOpenTimeRow[];
  /** The element's own id: a row of an element below it names its element. */
  elementReadableId: string;
  laborCategories: { id: string; name: string }[];
  onIssue?: () => void;
  onLogTime?: () => void;
  onCharge?: () => void;
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const typeLabels = useCostTypeLabels();
  const [items] = useItems();
  const [people] = usePeople();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CostTypeFilter>("all");
  const [sort, setSort] = useState<ActualSort>("newest");

  const costTypeLabels: Record<ProjectCostType, string> = {
    Material: t`Material`,
    Labor: t`Labor`,
    Machine: t`Machine`,
    Overhead: t`Overhead`,
    "Outside Processing": t`Outside Processing`,
    "Purchased Service": t`Purchased Service`,
    "Other Direct": t`Other Direct`,
    "Material Variance": t`Material Variance`,
    "Payback Variance": t`Payback Variance`,
    Burden: t`Burden`
  };
  const costTypeLabel = (costType: string) =>
    costTypeLabels[costType as ProjectCostType] ?? costType;

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people]
  );
  const categoriesById = useMemo(
    () => new Map(laborCategories.map((c) => [c.id, c.name])),
    [laborCategories]
  );

  const ledgerCards = useMemo<ActualCard[]>(
    () =>
      ledger.map((row) => {
        const item = row.itemId ? itemsById.get(row.itemId) : undefined;
        return {
          key: row.id,
          type: ledgerLineType(row.costType),
          date: row.postingDate,
          amount: row.amount,
          searchText: [
            item?.readableIdWithRevision,
            item?.name,
            row.laborCategoryId
              ? categoriesById.get(row.laborCategoryId)
              : null,
            row.employeeId ? peopleById.get(row.employeeId) : null,
            row.documentType,
            row.costType,
            row.description,
            row.readableId
          ],
          ledger: row
        };
      }),
    [ledger, itemsById, categoriesById, peopleById]
  );
  const openTimeCards = useMemo<ActualCard[]>(
    () =>
      openTime.map((row) => ({
        key: row.id,
        type: "labor",
        date: row.entryDate,
        amount: 0,
        searchText: [
          categoriesById.get(row.laborCategoryId),
          peopleById.get(row.employeeId),
          row.status,
          row.readableId
        ],
        openTime: row
      })),
    [openTime, categoriesById, peopleById]
  );

  const visible = (cards: ActualCard[]) =>
    sortActualCards(
      cards.filter(
        (card) =>
          (typeFilter === "all" || card.type === typeFilter) &&
          matchesSearch([...card.searchText, typeLabels[card.type]], search)
      ),
      sort
    );
  const visibleLedger = visible(ledgerCards);
  const visibleOpenTime = visible(openTimeCards);

  const sorts = useMemo<{ value: ActualSort; label: string }[]>(
    () => [
      { value: "newest", label: t`Newest` },
      { value: "oldest", label: t`Oldest` },
      { value: "amount", label: t`Amount` }
    ],
    [t]
  );

  const hasActions = Boolean(onIssue || onLogTime || onCharge);
  const chargeMenu = hasActions ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" rightIcon={<LuChevronDown />}>
          <Trans>Charge</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {onIssue && (
          <DropdownMenuItem onClick={onIssue}>
            <DropdownMenuIcon icon={<LuPackageMinus />} />
            <Trans>Issue material</Trans>
          </DropdownMenuItem>
        )}
        {onLogTime && (
          <DropdownMenuItem onClick={onLogTime}>
            <DropdownMenuIcon icon={<LuTimer />} />
            <Trans>Log time</Trans>
          </DropdownMenuItem>
        )}
        {onCharge && (
          <DropdownMenuItem onClick={onCharge}>
            <DropdownMenuIcon icon={<LuReceipt />} />
            <Trans>Charge cost</Trans>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const withSeparators = (parts: ReactNode[]) =>
    parts
      .filter(Boolean)
      .flatMap((part, index) =>
        index === 0 ? [part] : [<FigureSeparator key={`sep-${index}`} />, part]
      );

  // A row of an element below this one names that element.
  const elementBadge = (readableId: string | null) =>
    readableId && readableId !== elementReadableId ? (
      <span className="font-mono">{readableId}</span>
    ) : null;

  const ledgerCard = (card: ActualCard, row: ElementLedgerRow) => {
    const item = row.itemId ? itemsById.get(row.itemId) : undefined;
    const employee = row.employeeId ? peopleById.get(row.employeeId) : null;
    const title =
      card.type === "material" && item
        ? item.readableIdWithRevision
        : card.type === "labor" && row.laborCategoryId
          ? (categoriesById.get(row.laborCategoryId) ?? costTypeLabel("Labor"))
          : (row.description ?? row.documentType);
    const subtitle =
      card.type === "material" && item
        ? item.name
        : card.type === "labor"
          ? employee
          : costTypeLabel(row.costType);
    return (
      <CostCard
        key={card.key}
        type={card.type}
        title={title}
        subtitle={subtitle}
        badges={elementBadge(row.readableId)}
        figures={withSeparators([
          <span key="date">{formatDate(row.postingDate)}</span>,
          title !== row.documentType && (
            <span key="document">{row.documentType}</span>
          ),
          row.quantity !== null &&
            (card.type === "labor" || row.unitOfMeasureCode) && (
              <span key="quantity">
                {card.type === "labor"
                  ? t`${formatQuantity(row.quantity)} h`
                  : `${formatQuantity(row.quantity)} ${row.unitOfMeasureCode ?? ""}`}
              </span>
            ),
          row.costType === "Material Variance" && (
            <span key="costType">{costTypeLabel(row.costType)}</span>
          )
        ])}
        actions={
          <span className="px-1 text-sm font-medium tabular-nums">
            {formatMoney.format(row.amount)}
          </span>
        }
      />
    );
  };

  const openTimeCard = (card: ActualCard, row: ElementOpenTimeRow) => (
    <CostCard
      key={card.key}
      type="labor"
      title={categoriesById.get(row.laborCategoryId) ?? costTypeLabel("Labor")}
      subtitle={peopleById.get(row.employeeId)}
      badges={
        <>
          {elementBadge(row.readableId)}
          <TimesheetEntryStatus
            status={row.status as TimesheetEntryStatusType}
          />
        </>
      }
      figures={withSeparators([
        <span key="date">{formatDate(row.entryDate)}</span>,
        <span key="hours">{t`${formatQuantity(row.hours)} h`}</span>
      ])}
      actions={<OpenTimeAction entry={row} />}
    />
  );

  if (ledger.length === 0 && openTime.length === 0) {
    return (
      <div className="flex w-full flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          <Trans>
            Nothing has been charged yet. Log time, issue material, or charge a
            job or purchase order to this element.
          </Trans>
        </p>
        {chargeMenu}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <CostToolbar
        search={search}
        onSearchChange={setSearch}
        type={typeFilter}
        onTypeChange={setTypeFilter}
        sort={sort}
        sorts={sorts}
        onSortChange={setSort}
        action={chargeMenu}
      />

      {visibleLedger.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {visibleLedger.map((card) =>
            card.ledger ? ledgerCard(card, card.ledger) : null
          )}
        </div>
      )}

      {visibleOpenTime.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Time not posted yet</Trans>
          </span>
          {visibleOpenTime.map((card) =>
            card.openTime ? openTimeCard(card, card.openTime) : null
          )}
        </div>
      )}

      {visibleLedger.length === 0 && visibleOpenTime.length === 0 && (
        <NoMatchingCosts>
          <Trans>No charges match the filters.</Trans>
        </NoMatchingCosts>
      )}
    </div>
  );
}
