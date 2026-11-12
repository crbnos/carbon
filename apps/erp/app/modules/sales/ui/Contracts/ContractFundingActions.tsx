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
  EditableNumber,
  EditableText,
  useStableEditableComponents
} from "~/components/Editable";
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
import ContractMoney from "./ContractMoney";

export type ContractFundingAction = {
  id: string;
  modificationNumber: string;
  fundedDate: string;
  acrn: string;
  fundedCost: number;
  fundedFee: number;
  expiresOn: string | null;
};

/** One grid row; a draft has no `id` until it saves. */
type FundingRow = Omit<ContractFundingAction, "id"> & {
  key: string;
  id: string | null;
};

/**
 * The funding actions of a billing line as a grid: one row per contract
 * modification that funds it, under an ACRN, with the totals in the
 * footer. In DCAA mode their sums are the line's funded cost and funded
 * amount (cost + fee).
 */
export default function ContractFundingActions({
  lineId,
  actions,
  currencyCode,
  action,
  isDisabled
}: {
  lineId: string;
  actions: ContractFundingAction[];
  currencyCode: string;
  /** The funding-actions route of the line. */
  action: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const today = useCompanyToday();
  const decimals = useCurrencyDecimals(currencyCode);
  const save = useCellSave();
  const [drafts, setDrafts] = useState<FundingRow[]>([]);
  const draftCount = useRef(0);
  const [deleting, setDeleting] = useState<FundingRow | null>(null);

  const rows = useMemo<FundingRow[]>(
    () => [
      ...actions.map((row) => ({
        ...row,
        key: row.id,
        fundedCost: Number(row.fundedCost),
        fundedFee: Number(row.fundedFee)
      })),
      ...drafts
    ],
    [actions, drafts]
  );
  const totalCost = actions.reduce(
    (sum, row) => sum + Number(row.fundedCost),
    0
  );
  const totalFee = actions.reduce((sum, row) => sum + Number(row.fundedFee), 0);

  // A cell posts the whole funding action with the change. A draft saves
  // once it has a modification number and an ACRN.
  const onCellEdit = useCallback(
    async (key: string, value: unknown, row: FundingRow) => {
      const next: FundingRow = { ...row };
      const text = value === null || value === undefined ? "" : String(value);
      if (key === "modificationNumber") next.modificationNumber = text;
      if (key === "acrn") next.acrn = text.trim().toUpperCase();
      if (key === "fundedDate") next.fundedDate = text;
      if (key === "expiresOn") next.expiresOn = text || null;
      if (key === "fundedCost" || key === "fundedFee") {
        next[key] = text === "" ? 0 : Number(text);
      }
      if (next.id === null && (!next.modificationNumber || !next.acrn)) {
        setDrafts((previous) =>
          previous.map((draft) => (draft.key === row.key ? next : draft))
        );
        return { data: null, error: null } as Awaited<ReturnType<typeof save>>;
      }
      const result = await save(action, {
        intent: "upsert",
        id: next.id ?? "",
        customerContractLineId: lineId,
        modificationNumber: next.modificationNumber,
        fundedDate: next.fundedDate,
        acrn: next.acrn,
        fundedCost: String(next.fundedCost),
        fundedFee: String(next.fundedFee),
        expiresOn: next.expiresOn ?? ""
      });
      if (next.id === null && !result.error) {
        setDrafts((previous) => previous.filter((d) => d.key !== row.key));
      }
      return result;
    },
    [action, lineId, save]
  );

  const editableComponents = useStableEditableComponents(
    (latest) => {
      const edit = (key: string, value: unknown, row: FundingRow) =>
        latest.current.onCellEdit(key, value, row);
      const money = EditableNumber<FundingRow>(
        edit,
        {
          minValue: 0,
          formatOptions: INPUT_FORMAT.money(currencyCode, decimals),
          step: INPUT_STEP.money(decimals)
        },
        { inputClassName: "text-right" }
      );
      return {
        modificationNumber: EditableText<FundingRow>(edit),
        fundedDate: EditableDate<FundingRow>(edit, { label: t`Funded` }),
        acrn: EditableText<FundingRow>(edit),
        expiresOn: EditableDate<FundingRow>(edit, {
          label: t`Expires`,
          clearable: true
        }),
        fundedCost: money,
        fundedFee: money
      };
    },
    { onCellEdit }
  );

  const columns = useMemo<ColumnDef<FundingRow>[]>(
    () => [
      {
        accessorKey: "modificationNumber",
        header: t`Modification`,
        size: 160,
        cell: ({ row }) =>
          row.original.modificationNumber ? (
            <span className="block truncate">
              {row.original.modificationNumber}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Trans>Modification number</Trans>
            </span>
          ),
        footer: () => (
          <span className="font-medium">
            <Trans>Total</Trans>
          </span>
        )
      },
      {
        accessorKey: "fundedDate",
        header: t`Funded`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(row.original.fundedDate)}
          </span>
        )
      },
      {
        accessorKey: "acrn",
        header: () => (
          <LabelWithHelp termId="acrn" variant="inline">
            <Trans>ACRN</Trans>
          </LabelWithHelp>
        ),
        size: 96,
        cell: ({ row }) =>
          row.original.acrn ? (
            <span className="tabular-nums">{row.original.acrn}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "expiresOn",
        header: t`Expires`,
        cell: ({ row }) =>
          row.original.expiresOn ? (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(row.original.expiresOn)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "fundedCost",
        header: t`Funded Cost`,
        cell: ({ row }) => (
          <span className="block text-right">
            <ContractMoney
              value={row.original.fundedCost}
              currencyCode={currencyCode}
            />
          </span>
        ),
        footer: () => (
          <span className="block text-right font-medium">
            <ContractMoney value={totalCost} currencyCode={currencyCode} />
          </span>
        )
      },
      {
        accessorKey: "fundedFee",
        header: t`Funded Fee`,
        cell: ({ row }) => (
          <span className="block text-right">
            <ContractMoney
              value={row.original.fundedFee}
              currencyCode={currencyCode}
            />
          </span>
        ),
        footer: () => (
          <span className="block text-right font-medium">
            <ContractMoney value={totalFee} currencyCode={currencyCode} />
          </span>
        )
      }
    ],
    [t, formatDate, currencyCode, totalCost, totalFee]
  );

  const renderMenu = useCallback(
    (row: FundingRow) => (
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
        <Trans>Delete Funding</Trans>
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
            <LabelWithHelp termId="funding-action" variant="inline">
              <Trans>Funding Actions</Trans>
            </LabelWithHelp>
          </CardTitle>
          <CardDescription>
            <Trans>
              Each contract modification that funds this line, by ACRN.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {rows.length > 0 ? (
            <div
              className="w-full overflow-hidden rounded-lg border border-border"
              style={{ height: setupGridHeight(rows.length, 49) }}
            >
              <Table<FundingRow>
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
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>No funding actions yet.</Trans>
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
                  modificationNumber: "",
                  fundedDate: today,
                  acrn: "",
                  fundedCost: 0,
                  fundedFee: 0,
                  expiresOn: null
                }
              ]);
            }}
          >
            <Trans>Add Funding</Trans>
          </Button>
        </CardContent>
      </Card>

      {deleting && deleting.id && (
        <ConfirmDelete
          action={action}
          isOpen
          name={deleting.modificationNumber}
          text={t`Are you sure you want to delete this funding action?`}
          fields={{ intent: "delete", id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
}
