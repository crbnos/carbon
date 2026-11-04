// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LabelWithHelp,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useRef, useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { Table } from "~/components";
import {
  EditableDate,
  EditableList,
  EditableNumber,
  useStableEditableComponents
} from "~/components/Editable";
import { useLaborCategories } from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter
} from "~/hooks";
import { usePeople } from "~/stores";
import ContractMoney from "./ContractMoney";

export type ContractLaborRate = {
  id: string;
  laborCategoryId: string | null;
  employeeId: string | null;
  billRate: number;
  effectiveFrom: string;
};

/** One grid row; `appliesTo` is `category:<id>` or `employee:<id>`. */
type RateRow = {
  key: string;
  id: string | null;
  appliesTo: string;
  billRate: number;
  effectiveFrom: string;
};

function appliesToValue(rate: ContractLaborRate) {
  return rate.employeeId
    ? `employee:${rate.employeeId}`
    : `category:${rate.laborCategoryId ?? ""}`;
}

/**
 * The bill rates of a Time & Materials line as a grid: per labor category,
 * and per employee (which wins), each effective from a date. With no rate
 * here, an hour bills at its labor category's default bill rate; with none
 * at all the item is held for "No bill rate".
 */
export default function ContractLaborRates({
  lineId,
  rates,
  currencyCode,
  action,
  isDisabled
}: {
  lineId: string;
  rates: ContractLaborRate[];
  currencyCode: string;
  /** The labor-rates action route of the line. */
  action: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const today = useCompanyToday();
  const decimals = useCurrencyDecimals(currencyCode);
  const save = useCellSave();
  const categories = useLaborCategories();
  const [people] = usePeople();
  const [drafts, setDrafts] = useState<RateRow[]>([]);
  const draftCount = useRef(0);
  const [deleting, setDeleting] = useState<RateRow | null>(null);

  const appliesToOptions = useMemo(
    () => [
      ...categories.map((category) => ({
        value: `category:${category.value}`,
        label: t`Labor category: ${category.label}`
      })),
      ...people.map((person) => ({
        value: `employee:${person.id}`,
        label: t`Employee: ${person.name}`
      }))
    ],
    [categories, people, t]
  );
  const appliesToLabel = useMemo(
    () =>
      new Map(appliesToOptions.map((option) => [option.value, option.label])),
    [appliesToOptions]
  );

  const rows = useMemo<RateRow[]>(
    () => [
      ...rates.map((rate) => ({
        key: rate.id,
        id: rate.id,
        appliesTo: appliesToValue(rate),
        billRate: Number(rate.billRate),
        effectiveFrom: rate.effectiveFrom
      })),
      ...drafts
    ],
    [rates, drafts]
  );

  // A cell posts the whole rate with the change; the choice maps to a labor
  // category or an employee. A draft saves once it names one.
  const onCellEdit = useCallback(
    async (key: string, value: unknown, row: RateRow) => {
      const next: RateRow = { ...row };
      if (key === "appliesTo") next.appliesTo = String(value ?? "");
      if (key === "effectiveFrom") next.effectiveFrom = String(value ?? "");
      if (key === "billRate") {
        next.billRate =
          value === null || value === undefined || value === ""
            ? 0
            : Number(value);
      }
      if (next.id === null && !next.appliesTo) {
        setDrafts((previous) =>
          previous.map((draft) => (draft.key === row.key ? next : draft))
        );
        return { data: null, error: null } as Awaited<ReturnType<typeof save>>;
      }
      const [kind, id] = next.appliesTo.split(":");
      const result = await save(action, {
        intent: "upsert",
        id: next.id ?? "",
        customerContractLineId: lineId,
        laborCategoryId: kind === "category" ? (id ?? "") : "",
        employeeId: kind === "employee" ? (id ?? "") : "",
        billRate: String(next.billRate),
        effectiveFrom: next.effectiveFrom
      });
      if (next.id === null && !result.error) {
        setDrafts((previous) => previous.filter((d) => d.key !== row.key));
      }
      return result;
    },
    [action, lineId, save]
  );

  const stable = useStableEditableComponents(
    (latest) => {
      const edit = (key: string, value: unknown, row: RateRow) =>
        latest.current.onCellEdit(key, value, row);
      return {
        billRate: EditableNumber<RateRow>(
          edit,
          {
            minValue: 0,
            formatOptions: INPUT_FORMAT.rate(currencyCode, decimals),
            step: INPUT_STEP.rate
          },
          { inputClassName: "text-right" }
        ),
        effectiveFrom: EditableDate<RateRow>(edit, {
          label: t`Effective From`
        })
      };
    },
    { onCellEdit }
  );
  // The list editor takes its options when built: rebuilt only when they
  // change (a pick commits at once).
  const latestOnCellEdit = useRef(onCellEdit);
  latestOnCellEdit.current = onCellEdit;
  const editableComponents = useMemo(
    () => ({
      ...stable,
      appliesTo: EditableList<RateRow>(
        (key, value, row) => latestOnCellEdit.current(key, value, row),
        appliesToOptions
      )
    }),
    [stable, appliesToOptions]
  );

  const columns = useMemo<ColumnDef<RateRow>[]>(
    () => [
      {
        accessorKey: "appliesTo",
        header: t`Applies To`,
        size: 280,
        cell: ({ row }) =>
          row.original.appliesTo ? (
            <span className="block truncate">
              {appliesToLabel.get(row.original.appliesTo) ??
                row.original.appliesTo}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Trans>Choose a labor category or an employee</Trans>
            </span>
          )
      },
      {
        accessorKey: "billRate",
        header: () => (
          <LabelWithHelp termId="bill-rate" variant="inline">
            <Trans>Bill Rate</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) => (
          <span className="block text-right">
            <ContractMoney
              value={row.original.billRate}
              currencyCode={currencyCode}
              rate
            />
          </span>
        )
      },
      {
        accessorKey: "effectiveFrom",
        header: t`Effective From`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(row.original.effectiveFrom)}
          </span>
        )
      }
    ],
    [t, appliesToLabel, currencyCode, formatDate]
  );

  const renderMenu = useCallback(
    (row: RateRow) => (
      <MenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={isDisabled}
        onClick={() =>
          row.id === null
            ? setDrafts((previous) => previous.filter((d) => d.key !== row.key))
            : setDeleting(row)
        }
      >
        <MenuIcon icon={<LuTrash />} />
        <Trans>Delete Rate</Trans>
      </MenuItem>
    ),
    [isDisabled]
  );
  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderMenu, t`Actions`)],
    [columns, renderMenu, t]
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Labor Rates</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              An employee's rate wins over a labor category's. With neither, an
              hour bills at the labor category's default bill rate.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {rows.length > 0 && (
            <div
              className="w-full overflow-hidden rounded-lg border border-border"
              style={{ height: setupGridHeight(rows.length, 49) - 44 }}
            >
              <Table<RateRow>
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
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <Trans>No contract rates. Hours bill at the default rates.</Trans>
            </p>
          )}
          <Button
            variant="secondary"
            leftIcon={<LuPlus />}
            className="self-start"
            isDisabled={isDisabled}
            onClick={() => {
              draftCount.current += 1;
              setDrafts((previous) => [
                ...previous,
                {
                  key: `draft-${draftCount.current}`,
                  id: null,
                  appliesTo: "",
                  billRate: 0,
                  effectiveFrom: today
                }
              ]);
            }}
          >
            <Trans>Add Rate</Trans>
          </Button>
        </CardContent>
      </Card>

      {deleting && deleting.id && (
        <ConfirmDelete
          action={action}
          isOpen
          name={t`Rate`}
          text={t`Are you sure you want to delete this bill rate?`}
          fields={{ intent: "delete", id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
}
