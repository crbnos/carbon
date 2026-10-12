// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectBaseType } from "@carbon/ee/indirect-rates";
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
import { LuPercent, LuPlus, LuTrash } from "react-icons/lu";
import { Table } from "~/components";
import {
  EditableList,
  EditableNumber,
  useStableEditableComponents
} from "~/components/Editable";
import { ConfirmDelete } from "~/components/Modals";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePercentFormatter,
  useUser
} from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";

export type ContractRateCeiling = {
  id: string;
  indirectPoolId: string;
  ceilingRate: number;
  indirectPool: { name: string; sequence: number } | null;
};

export type CeilingPool = {
  id: string;
  name: string;
  baseType: IndirectBaseType;
};

type ContractRateCeilingsProps = {
  lineId: string;
  ceilings: ContractRateCeiling[];
  /** The active pools that apply to projects: the choices for a ceiling. */
  pools: CeilingPool[];
  /** The labor-rates action route of the line. */
  action: string;
  isDisabled: boolean;
};

/** One grid row; a draft has no `id` until it names a pool. */
type CeilingRow = {
  key: string;
  id: string | null;
  indirectPoolId: string;
  ceilingRate: number;
  sequence: number;
};

/**
 * The indirect rate ceilings of a Cost Plus line. Burden bills at the lower
 * of the billing rate and the line's ceiling for the pool. A company without
 * government contracting sees the section behind the upgrade overlay.
 */
export default function ContractRateCeilings(props: ContractRateCeilingsProps) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  if (isGated) {
    return (
      <UpgradeOverlaySection
        icon={<LuPercent className="size-6 text-muted-foreground" />}
        title={<Trans>Rate Ceilings</Trans>}
        description={
          <Trans>
            Cap the indirect rates a Cost Plus line bills, and bill burden at
            provisional rates.
          </Trans>
        }
      >
        <RateCeilingsCard {...props} ceilings={[]} isDisabled />
      </UpgradeOverlaySection>
    );
  }

  return <RateCeilingsCard {...props} />;
}

/** The ceilings as a grid: the pool and its ceiling edit in place. */
function RateCeilingsCard({
  lineId,
  ceilings,
  pools,
  action,
  isDisabled
}: ContractRateCeilingsProps) {
  const { t } = useLingui();
  const percent = usePercentFormatter();
  const perHour = useCurrencyFormatter({ rate: true });
  const { company } = useUser();
  const currency = company?.baseCurrencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currency);
  const save = useCellSave();
  const [drafts, setDrafts] = useState<CeilingRow[]>([]);
  const draftCount = useRef(0);
  const [deleting, setDeleting] = useState<CeilingRow | null>(null);

  const poolById = useMemo(
    () => new Map(pools.map((pool) => [pool.id, pool])),
    [pools]
  );
  const rows = useMemo<CeilingRow[]>(
    () => [
      ...[...ceilings]
        .sort(
          (a, b) =>
            (a.indirectPool?.sequence ?? 0) - (b.indirectPool?.sequence ?? 0)
        )
        .map((ceiling) => ({
          key: ceiling.id,
          id: ceiling.id,
          indirectPoolId: ceiling.indirectPoolId,
          ceilingRate: Number(ceiling.ceilingRate),
          sequence: ceiling.indirectPool?.sequence ?? 0
        })),
      ...drafts
    ],
    [ceilings, drafts]
  );
  const isPerHour = useCallback(
    (row: CeilingRow) =>
      poolById.get(row.indirectPoolId)?.baseType === "Direct Labor Hours",
    [poolById]
  );

  // A cell posts the whole ceiling. A draft saves once it names a pool; a
  // pool that already has a ceiling is refused by the route.
  const onCellEdit = useCallback(
    async (key: string, value: unknown, row: CeilingRow) => {
      const next: CeilingRow = { ...row };
      if (key === "indirectPoolId") next.indirectPoolId = String(value ?? "");
      if (key === "ceilingRate") {
        next.ceilingRate =
          value === null || value === undefined || value === ""
            ? 0
            : Number(value);
      }
      if (next.id === null && !next.indirectPoolId) {
        setDrafts((previous) =>
          previous.map((draft) => (draft.key === row.key ? next : draft))
        );
        return { data: null, error: null } as Awaited<ReturnType<typeof save>>;
      }
      const result = await save(action, {
        intent: "ceiling-upsert",
        id: next.id ?? "",
        customerContractLineId: lineId,
        indirectPoolId: next.indirectPoolId,
        ceilingRate: String(next.ceilingRate)
      });
      if (next.id === null && !result.error) {
        setDrafts((previous) => previous.filter((d) => d.key !== row.key));
      }
      return result;
    },
    [action, lineId, save]
  );

  const stable = useStableEditableComponents(
    (latest) => ({
      // The format follows the pool: a share of the base, or a rate per hour.
      ceilingRate: EditableNumber<CeilingRow>(
        (key, value, row) => latest.current.onCellEdit(key, value, row),
        (row) =>
          latest.current.isPerHour(row)
            ? {
                minValue: 0,
                formatOptions: INPUT_FORMAT.rate(
                  latest.current.currency,
                  latest.current.decimals
                ),
                step: INPUT_STEP.rate
              }
            : {
                minValue: 0,
                formatOptions: INPUT_FORMAT.percent,
                step: INPUT_STEP.percent
              },
        { inputClassName: "text-right" }
      )
    }),
    { onCellEdit, isPerHour, currency, decimals }
  );
  const latestOnCellEdit = useRef(onCellEdit);
  latestOnCellEdit.current = onCellEdit;
  const editableComponents = useMemo(
    () => ({
      ...stable,
      indirectPoolId: EditableList<CeilingRow>(
        (key, value, row) => latestOnCellEdit.current(key, value, row),
        pools.map((pool) => ({ value: pool.id, label: pool.name }))
      )
    }),
    [stable, pools]
  );

  const columns = useMemo<ColumnDef<CeilingRow>[]>(
    () => [
      {
        accessorKey: "indirectPoolId",
        header: t`Pool`,
        size: 280,
        cell: ({ row }) =>
          row.original.indirectPoolId ? (
            <span className="block truncate">
              {poolById.get(row.original.indirectPoolId)?.name ??
                ceilings.find(
                  (c) => c.indirectPoolId === row.original.indirectPoolId
                )?.indirectPool?.name ??
                row.original.indirectPoolId}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Trans>Choose a pool</Trans>
            </span>
          )
      },
      {
        accessorKey: "ceilingRate",
        header: () => (
          <LabelWithHelp termId="rate-ceiling" variant="inline">
            <Trans>Ceiling</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {isPerHour(row.original)
              ? t`${perHour.format(row.original.ceilingRate)}/h`
              : percent.format(row.original.ceilingRate)}
          </span>
        )
      }
    ],
    [t, poolById, ceilings, isPerHour, perHour, percent]
  );

  const renderMenu = useCallback(
    (row: CeilingRow) => (
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
        <Trans>Delete Ceiling</Trans>
      </MenuItem>
    ),
    [isDisabled]
  );
  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderMenu, t`Actions`)],
    [columns, renderMenu, t]
  );

  const usedPools = new Set(rows.map((row) => row.indirectPoolId));
  const canAdd = pools.some((pool) => !usedPools.has(pool.id));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Rate Ceilings</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Burden bills at the lower of the billing rate and the ceiling.
              With no ceiling, a pool bills at its billing rate.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {rows.length > 0 ? (
            <div
              className="w-full overflow-hidden rounded-lg border border-border"
              style={{ height: setupGridHeight(rows.length, 49) - 44 }}
            >
              <Table<CeilingRow>
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
              <Trans>No ceilings. Burden bills at the billing rates.</Trans>
            </p>
          )}
          <Button
            variant="secondary"
            leftIcon={<LuPlus />}
            className="self-start"
            isDisabled={isDisabled || !canAdd}
            onClick={() => {
              draftCount.current += 1;
              setDrafts((previous) => [
                ...previous,
                {
                  key: `draft-${draftCount.current}`,
                  id: null,
                  indirectPoolId: "",
                  ceilingRate: 0,
                  sequence: Number.MAX_SAFE_INTEGER
                }
              ]);
            }}
          >
            <Trans>Add Ceiling</Trans>
          </Button>
        </CardContent>
      </Card>

      {deleting && deleting.id && (
        <ConfirmDelete
          action={action}
          isOpen
          name={poolById.get(deleting.indirectPoolId)?.name ?? t`Ceiling`}
          text={t`Are you sure you want to delete this rate ceiling?`}
          fields={{ intent: "ceiling-delete", id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
}
