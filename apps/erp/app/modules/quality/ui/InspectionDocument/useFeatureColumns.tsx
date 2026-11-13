// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Button,
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import {
  LuCrosshair,
  LuEllipsisVertical,
  LuRectangleHorizontal,
  LuTrash2
} from "react-icons/lu";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import { EditableList, EditableText } from "~/components/Editable";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { materialConditions } from "~/modules/quality/quality.models";
import { procedureStepType } from "~/modules/shared/shared.models";
import {
  type FeatureOfSize,
  type FeatureRow,
  hasBonusTolerance,
  LOCAL_EDIT_RESULT
} from "./editorModel";
import type { SamplingRule } from "./SamplingRuleModal";

const featureTypeOptions = procedureStepType.map((t) => ({
  label: t,
  value: t
}));

const materialConditionOptions = materialConditions.map((condition) => ({
  label: condition,
  value: condition
}));

type FeatureMutationFn = (
  accessorKey: string,
  newValue: string,
  row: FeatureRow
) => Promise<typeof LOCAL_EDIT_RESULT>;

type EditableFeatureField =
  | "label"
  | "featureName"
  | "nominalValue"
  | "tolerancePlus"
  | "toleranceMinus"
  | "units"
  | "type"
  | "gaugeTypeId"
  | "designator"
  | "referenceLocation"
  | "materialCondition"
  | "featureOfSize"
  | "sizeFeatureId";

const ConditionalMeasurementText =
  (baseMutation: FeatureMutationFn) =>
  (props: EditableTableCellComponentProps<FeatureRow>) => {
    if (props.row.type !== "Measurement") {
      return <span className="text-muted-foreground text-sm">&mdash;</span>;
    }
    return EditableText(baseMutation)(props);
  };

const ConditionalMeasurementList =
  (
    baseMutation: FeatureMutationFn,
    options: { label: string; value: string }[]
  ) =>
  (props: EditableTableCellComponentProps<FeatureRow>) => {
    if (props.row.type !== "Measurement") {
      return <span className="text-muted-foreground text-sm">&mdash;</span>;
    }
    return EditableList(baseMutation, options)(props);
  };

/** Editable only on MMC/LMC Measurement rows; options may depend on the row. */
const ConditionalBonusList =
  (
    baseMutation: FeatureMutationFn,
    getOptions: (row: FeatureRow) => { label: string; value: string }[]
  ) =>
  (props: EditableTableCellComponentProps<FeatureRow>) => {
    if (!hasBonusTolerance(props.row)) {
      return <span className="text-muted-foreground text-sm">&mdash;</span>;
    }
    return EditableList(baseMutation, getOptions(props.row))(props);
  };

// Optional gauge type: a clearable list (cleared = any gauge may be used).
const EditableGaugeType =
  (
    baseMutation: FeatureMutationFn,
    options: { label: string; value: string }[]
  ) =>
  ({
    value,
    row,
    accessorKey,
    label,
    onUpdate
  }: EditableTableCellComponentProps<FeatureRow>) => (
    <Combobox
      autoFocus
      isClearable
      aria-label={label}
      className="rounded-none"
      size="sm"
      value={(value as string | null) ?? undefined}
      options={options}
      onChange={(newValue) => {
        onUpdate({ [accessorKey]: newValue || null });
        baseMutation(accessorKey, newValue, row);
      }}
    />
  );

/**
 * A sampling rule as the inspector would say it: "Inspect All", "First 2".
 * Null when the rule is unset (a characteristic then inherits the plan's).
 */
export function useSamplingRuleSummary() {
  const { t } = useLingui();
  return useCallback(
    (rule: SamplingRule): string | null => {
      switch (rule.samplingPlanType) {
        case "All":
          return t`Inspect All`;
        case "First": {
          const count = rule.samplingSampleSize ?? 1;
          return t`First ${count}`;
        }
        case "Percentage": {
          const percentage = rule.samplingPercentage ?? 100;
          return t`${percentage}%`;
        }
        case "AQL":
          return `AQL ${rule.samplingAql ?? 1} · ${rule.samplingInspectionLevel ?? "II"} · ${rule.samplingSeverity ?? "Normal"}`;
        default:
          return null;
      }
    },
    [t]
  );
}

type UseFeatureColumnsArgs = {
  /** The rows, for the MMC/LMC size feature choices. */
  featureRows: FeatureRow[];
  setFeatureRows: Dispatch<SetStateAction<FeatureRow[]>>;
  unitOfMeasures: Array<{ code: string; name: string }>;
  gaugeTypes: Array<{ id: string; name: string }>;
  canUpdate: boolean;
  /** A model plan shows Show (its PMI item) instead of Balloon. */
  hasModel: boolean;
  modelFeatureId: string | null;
  onShowOnModel: (featureId: string) => void;
  /** The drawing can take a selector: Balloon is enabled. */
  isOverlayReady: boolean;
  onPlaceOnDrawing: (featureId: string) => void;
  onUnballoon: (featureId: string) => void;
  onDelete: (featureId: string) => void;
  onEditSampling: (featureId: string) => void;
  samplingRuleSummary: (rule: SamplingRule) => string | null;
};

/** The Characteristics grid's columns and its cell editors. */
export function useFeatureColumns({
  featureRows,
  setFeatureRows,
  unitOfMeasures,
  gaugeTypes,
  canUpdate,
  hasModel,
  modelFeatureId,
  onShowOnModel,
  isOverlayReady,
  onPlaceOnDrawing,
  onUnballoon,
  onDelete,
  onEditSampling,
  samplingRuleSummary
}: UseFeatureColumnsArgs) {
  const { t } = useLingui();

  const featureMutation = useCallback(
    async (accessorKey: string, newValue: string, row: FeatureRow) => {
      const field = accessorKey as EditableFeatureField;
      setFeatureRows((prev) =>
        prev.map((r) =>
          r.featureId !== row.featureId
            ? r
            : {
                ...r,
                [field]: field === "gaugeTypeId" ? newValue || null : newValue,
                featureDirty: true
              }
        )
      );
      return LOCAL_EDIT_RESULT;
    },
    [setFeatureRows]
  );

  const unitOfMeasureOptions = useMemo(
    () => unitOfMeasures.map((uom) => ({ value: uom.code, label: uom.name })),
    [unitOfMeasures]
  );

  const uomCodeToName = useMemo(
    () => new Map(unitOfMeasures.map((uom) => [uom.code, uom.name])),
    [unitOfMeasures]
  );

  const gaugeTypeOptions = useMemo(
    () => gaugeTypes.map((gt) => ({ value: gt.id, label: gt.name })),
    [gaugeTypes]
  );

  const gaugeTypeIdToName = useMemo(
    () => new Map(gaugeTypes.map((gt) => [gt.id, gt.name])),
    [gaugeTypes]
  );

  const featureOfSizeOptions = useMemo(
    () =>
      [
        { label: t`Internal`, value: "Internal" },
        { label: t`External`, value: "External" }
      ] satisfies { label: string; value: FeatureOfSize }[],
    [t]
  );

  // Measurement rows a MMC/LMC characteristic can take its size from. Keyed on
  // id + label only, so unrelated row edits don't rebuild the grid's editors.
  const sizeFeatureCandidatesKey = JSON.stringify(
    featureRows
      .filter((r) => r.type === "Measurement")
      .map((r) => [r.featureId, r.label])
  );
  const sizeFeatureCandidates = useMemo(
    () =>
      (JSON.parse(sizeFeatureCandidatesKey) as [string, string][]).map(
        ([value, label]) => ({ value, label })
      ),
    [sizeFeatureCandidatesKey]
  );
  const sizeFeatureLabelById = useMemo(
    () => new Map(sizeFeatureCandidates.map((c) => [c.value, c.label])),
    [sizeFeatureCandidates]
  );

  const featureEditableComponents = useMemo(
    () => ({
      type: EditableList(featureMutation, featureTypeOptions),
      label: EditableText(featureMutation),
      featureName: EditableText(featureMutation),
      nominalValue: ConditionalMeasurementText(featureMutation),
      tolerancePlus: ConditionalMeasurementText(featureMutation),
      toleranceMinus: ConditionalMeasurementText(featureMutation),
      units: ConditionalMeasurementList(featureMutation, unitOfMeasureOptions),
      gaugeTypeId: EditableGaugeType(featureMutation, gaugeTypeOptions),
      designator: EditableText(featureMutation),
      referenceLocation: EditableText(featureMutation),
      materialCondition: ConditionalMeasurementList(
        featureMutation,
        materialConditionOptions
      ),
      sizeFeatureId: ConditionalBonusList(featureMutation, (row) =>
        sizeFeatureCandidates.filter((c) => c.value !== row.featureId)
      ),
      featureOfSize: ConditionalBonusList(
        featureMutation,
        () => featureOfSizeOptions
      )
    }),
    [
      featureMutation,
      unitOfMeasureOptions,
      gaugeTypeOptions,
      sizeFeatureCandidates,
      featureOfSizeOptions
    ]
  );

  const featureColumns = useMemo<ColumnDef<FeatureRow>[]>(
    () => [
      { accessorKey: "label", header: t`Characteristic`, size: 80 },
      {
        accessorKey: "type",
        header: t`Type`,
        size: 140,
        cell: ({ row }) => (
          <HStack spacing={1} className="items-center">
            <ProcedureStepTypeIcon
              type={
                row.original
                  .type as Database["public"]["Enums"]["procedureStepType"]
              }
              className="h-4 w-4"
            />
            <span className="text-sm">{row.original.type}</span>
          </HStack>
        )
      },
      { accessorKey: "featureName", header: t`Description` },
      {
        accessorKey: "nominalValue",
        header: t`Nom`,
        size: 112,
        cell: ({ row }) =>
          row.original.type === "Measurement" ? row.original.nominalValue : null
      },
      {
        accessorKey: "tolerancePlus",
        header: t`Tol+`,
        size: 112,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? row.original.tolerancePlus
            : null
      },
      {
        accessorKey: "toleranceMinus",
        header: t`Tol-`,
        size: 112,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? row.original.toleranceMinus
            : null
      },
      {
        accessorKey: "units",
        header: t`Units`,
        size: 96,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? (uomCodeToName.get(row.original.units) ?? row.original.units)
            : null
      },
      {
        accessorKey: "gaugeTypeId",
        header: t`Gauge Type`,
        size: 160,
        cell: ({ row }) =>
          row.original.gaugeTypeId ? (
            (gaugeTypeIdToName.get(row.original.gaugeTypeId) ?? "—")
          ) : (
            <span className="text-muted-foreground">{t`Any`}</span>
          )
      },
      { accessorKey: "designator", header: t`Designator`, size: 120 },
      {
        accessorKey: "referenceLocation",
        header: t`Ref. location`,
        size: 120
      },
      {
        accessorKey: "materialCondition",
        header: t`Material condition`,
        size: 140,
        cell: ({ row }) =>
          row.original.type === "Measurement"
            ? row.original.materialCondition
            : null
      },
      {
        accessorKey: "sizeFeatureId",
        header: t`Size feature`,
        size: 128,
        cell: ({ row }) =>
          hasBonusTolerance(row.original)
            ? (sizeFeatureLabelById.get(row.original.sizeFeatureId) ?? null)
            : null
      },
      {
        accessorKey: "featureOfSize",
        header: t`Feature of size`,
        size: 128,
        cell: ({ row }) =>
          hasBonusTolerance(row.original)
            ? (featureOfSizeOptions.find(
                (o) => o.value === row.original.featureOfSize
              )?.label ?? null)
            : null
      },
      {
        id: "sampling",
        header: t`Sampling`,
        size: 148,
        cell: ({ row }) => {
          const summary = samplingRuleSummary(row.original);
          if (!canUpdate) {
            return (
              <span className="text-sm">
                {summary ?? (
                  <span className="text-muted-foreground">{t`Inherit`}</span>
                )}
              </span>
            );
          }
          return (
            <button
              type="button"
              className="text-left text-sm underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onEditSampling(row.original.featureId);
              }}
            >
              {summary ?? (
                <span className="text-muted-foreground">{t`Inherit`}</span>
              )}
            </button>
          );
        }
      },
      {
        id: "actions",
        header: t`Actions`,
        size: 148,
        cell: ({ row }) => (
          <HStack spacing={1} className="items-center">
            {hasModel && row.original.pmiItemId && (
              <Button
                type="button"
                variant={
                  modelFeatureId === row.original.featureId
                    ? "primary"
                    : "outline"
                }
                size="sm"
                leftIcon={<LuCrosshair className="h-3.5 w-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onShowOnModel(row.original.featureId);
                }}
              >
                {t`Show`}
              </Button>
            )}
            {canUpdate && !hasModel && !row.original.balloonId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<LuRectangleHorizontal className="h-3.5 w-3.5" />}
                isDisabled={!isOverlayReady}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaceOnDrawing(row.original.featureId);
                }}
              >
                {t`Balloon`}
              </Button>
            )}
            {canUpdate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t`More actions`}
                    icon={<LuEllipsisVertical />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {row.original.balloonId && (
                    <DropdownMenuItem
                      onClick={() => onUnballoon(row.original.featureId)}
                    >
                      <LuRectangleHorizontal className="mr-2 size-4" />
                      {t`Unballoon`}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    destructive
                    onClick={() => onDelete(row.original.featureId)}
                  >
                    <LuTrash2 className="mr-2 size-4" />
                    {t`Delete`}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </HStack>
        )
      }
    ],
    [
      canUpdate,
      onDelete,
      onPlaceOnDrawing,
      onUnballoon,
      isOverlayReady,
      hasModel,
      modelFeatureId,
      onShowOnModel,
      onEditSampling,
      uomCodeToName,
      gaugeTypeIdToName,
      sizeFeatureLabelById,
      featureOfSizeOptions,
      samplingRuleSummary,
      t
    ]
  );

  return { featureColumns, featureEditableComponents };
}
